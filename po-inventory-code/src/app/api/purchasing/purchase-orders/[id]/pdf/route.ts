import { NextRequest, NextResponse } from "next/server";
import {
  createGetHandlerWithParams,
  ApiContextWithParams,
} from "@/lib/api-middleware-v2";
import { prisma } from "@/lib/prisma";
import { launchBrowser } from "@/lib/puppeteer";
import { format } from "date-fns";
import { normalizeUTCDateToLocal } from "@/lib/date-utils";
import type { Prisma } from "@prisma/client";
import { getUserDetailsById } from "@/lib/microsoft-graph";
import { NotFoundError } from "@/lib/api-errors";
import {
  getBrandingSettings,
  formatCityStateZip,
  type BrandingSettingsData,
} from "@/services/admin/branding.service";
import { resolveShipTo } from "@/lib/purchasing/ship-to";

// Type for purchase order with all includes
type PurchaseOrderWithIncludes = Prisma.PurchaseOrderGetPayload<{
  include: {
    supplier: {
      include: {
        addresses: true;
      };
    };
    lines: {
      orderBy: [{ lineNumber: "asc" }, { createdAt: "asc" }];
      include: {
        inventoryItem: true;
      };
    };
    buyer: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        email: true;
        phone: true;
      };
    };
    creator: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        email: true;
        phone: true;
      };
    };
  };
}> & {
  // paymentTermsOverride is an optional PO-level field added by migration.
  // The Prisma generated type may not reflect it until `prisma generate` is run,
  // so we widen the type here so the PDF route compiles before the migration runs.
  paymentTermsOverride?: string | null;
};

export const dynamic = "force-dynamic";

export const GET = createGetHandlerWithParams(
  async (_request: NextRequest, context: ApiContextWithParams) => {
    const { id } = context.params;

    // Fetch the purchase order with all related data
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          include: {
            addresses: true,
          },
        },
        lines: {
          orderBy: [
            { lineNumber: "asc" as const },
            { createdAt: "asc" as const },
          ],
          include: {
            inventoryItem: true,
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!purchaseOrder) {
      throw new NotFoundError("Purchase order not found");
    }

    // Prefer buyer (assigned purchasing manager) over creator for contact info
    const contactUser = purchaseOrder.buyer ?? purchaseOrder.creator;

    // Fetch contact details from Microsoft Graph if available
    let creatorDetails = null;
    if (contactUser?.id) {
      try {
        const graphUser = await getUserDetailsById(contactUser.id);
        creatorDetails = {
          name:
            graphUser.displayName ||
            `${contactUser.firstName} ${contactUser.lastName}`,
          email: graphUser.mail ?? contactUser.email,
          phone:
            graphUser.businessPhones?.[0] ??
            graphUser.mobilePhone ??
            contactUser.phone,
        };
      } catch (_error) {
        // Fallback to database values
        creatorDetails = {
          name: `${contactUser.firstName} ${contactUser.lastName}`,
          email: contactUser.email,
          phone: contactUser.phone,
        };
      }
    }

    // Fetch branding settings for PDF header/footer
    const branding = await getBrandingSettings();

    // Generate HTML content for PDF
    const html = generatePurchaseOrderHTML(
      purchaseOrder,
      creatorDetails,
      branding,
    );

    // Launch Puppeteer and generate PDF
    const browser = await launchBrowser();

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Generate PDF
    const pdf = await page.pdf({
      format: "Letter",
      margin: {
        top: "0.5in",
        right: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
      },
      printBackground: true,
    });

    await browser.close();

    // Return PDF as response
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="PO-${purchaseOrder.poNumber}.pdf"`,
      },
    });
  },
);

/**
 * Generate HTML content for purchase order PDF
 */
function generatePurchaseOrderHTML(
  purchaseOrder: PurchaseOrderWithIncludes,
  creatorDetails: {
    name: string;
    email: string | null;
    phone: string | null;
  } | null,
  branding: BrandingSettingsData,
): string {
  // Resolve effective payment terms: PO-level override takes precedence over supplier default
  const effectivePaymentTerms =
    purchaseOrder.paymentTermsOverride ?? purchaseOrder.supplier.paymentTerms;
  const isCustomPaymentTerms = !!purchaseOrder.paymentTermsOverride;

  const isCancelled = purchaseOrder.status === "Cancelled";

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(amount);
  };

  // Display currency: zeroed out when cancelled
  const displayCurrency = (amount: number) => {
    return isCancelled ? formatCurrency(0) : formatCurrency(amount);
  };

  const formatDate = (date: Date | string | null | undefined): string => {
    if (!date) return "";
    return format(normalizeUTCDateToLocal(date), "MM/dd/yyyy");
  };

  // Delivery date logic: determine if all lines share the same date
  const lineDeliveryDates = purchaseOrder.lines.map((l) => l.deliveryDate);
  const uniqueDates = [
    ...new Set(lineDeliveryDates.filter(Boolean).map((d) => formatDate(d))),
  ];
  const allSameDate = uniqueDates.length === 1;
  const hasPerLineDates = lineDeliveryDates.some(Boolean);
  const hasDifferentDates = uniqueDates.length > 1;

  // If all lines have the same date, show that; otherwise fall back to PO expectedDate
  const headerDeliveryDate = allSameDate
    ? uniqueDates[0]
    : !hasPerLineDates && purchaseOrder.expectedDate
      ? formatDate(purchaseOrder.expectedDate)
      : null;

  // Show per-line column only when lines have different dates
  const showPerLineDeliveryDate = hasDifferentDates;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
    }

    .header {
      border-bottom: 4px solid #000;
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    h1 {
      font-size: 24pt;
      margin-bottom: 0.5rem;
    }

    h2 {
      font-size: 16pt;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
      border-bottom: 2px solid #666;
      padding-bottom: 0.25rem;
    }

    .po-number {
      font-size: 18pt;
      font-family: monospace;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .field {
      margin-bottom: 0.75rem;
    }

    .field-label {
      font-size: 10pt;
      font-weight: bold;
      color: #666;
      margin-bottom: 0.25rem;
    }

    .field-value {
      font-size: 12pt;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
    }

    th, td {
      border: 1px solid #666;
      padding: 0.5rem;
      text-align: left;
    }

    th {
      background: #f3f4f6;
      font-weight: bold;
    }

    .totals {
      margin-top: 1rem;
      text-align: right;
    }

    .totals-row {
      display: flex;
      justify-content: flex-end;
      padding: 0.5rem 0;
    }

    .totals-label {
      width: 150px;
      font-weight: bold;
    }

    .totals-value {
      width: 150px;
      text-align: right;
    }

    .total-final {
      border-top: 2px solid #000;
      font-size: 14pt;
      font-weight: bold;
    }

    .notes-box {
      border: 1px solid #666;
      border-radius: 0.25rem;
      padding: 1rem;
      margin-top: 1rem;
      background: #f9fafb;
    }

    .terms-section {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 2px solid #666;
    }

    .signature-section {
      margin-top: 2rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    .signature-line {
      border-bottom: 2px solid #666;
      height: 4rem;
      margin-bottom: 0.5rem;
    }

    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #666;
      text-align: center;
      font-size: 9pt;
      color: #666;
    }

    .no-break {
      page-break-inside: avoid;
    }

    /* Cancelled PO styles */
    .cancelled-watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 120px;
      font-weight: bold;
      color: rgba(220, 38, 38, 0.15);
      pointer-events: none;
      z-index: 1000;
      white-space: nowrap;
      letter-spacing: 0.1em;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .cancelled-banner {
      border: 3px solid #dc2626;
      background-color: #fef2f2;
      border-radius: 0.5rem;
      padding: 1rem 1.5rem;
      margin-bottom: 1.5rem;
      text-align: center;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .cancelled-banner-title {
      font-size: 28px;
      font-weight: bold;
      color: #dc2626;
      margin: 0 0 0.5rem 0;
      letter-spacing: 0.05em;
    }

    .cancelled-banner-details {
      font-size: 12px;
      color: #991b1b;
      margin: 0.25rem 0;
    }
  </style>
</head>
<body>
  ${isCancelled ? '<div class="cancelled-watermark">CANCELLED</div>' : ""}

  ${
    isCancelled
      ? `
  <div class="cancelled-banner">
    <div class="cancelled-banner-title">CANCELLED</div>
    ${purchaseOrder.cancelledAt ? `<div class="cancelled-banner-details">Cancelled on ${format(normalizeUTCDateToLocal(purchaseOrder.cancelledAt), "MMM dd, yyyy")}</div>` : ""}
    ${purchaseOrder.cancelledReason ? `<div class="cancelled-banner-details">Reason: ${purchaseOrder.cancelledReason}</div>` : ""}
  </div>
  `
      : ""
  }

  <div class="header no-break">
    <div class="header-content">
      <div>
        <h1>${branding.companyName}</h1>
        <div style="font-size: 10pt; color: #666;">${branding.addressLine1}</div>
        <div style="font-size: 10pt; color: #666;">${formatCityStateZip(branding)}</div>
        <div style="font-size: 10pt; color: #666;">Phone: ${branding.phone}</div>

        ${
          creatorDetails &&
          (creatorDetails.name || creatorDetails.email || creatorDetails.phone)
            ? `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #d1d5db;">
          <div style="font-size: 8pt; font-weight: bold; text-transform: uppercase; margin-bottom: 0.25rem; color: #374151;">
            Purchasing Manager
          </div>
          ${
            creatorDetails.name
              ? `
          <div style="font-size: 10pt; font-weight: 600; color: #000;">
            ${creatorDetails.name}
          </div>
          `
              : ""
          }
          ${
            creatorDetails.email
              ? `
          <div style="font-size: 10pt; color: #666;">
            ${creatorDetails.email}
          </div>
          `
              : ""
          }
          ${
            creatorDetails.phone
              ? `
          <div style="font-size: 10pt; color: #666;">
            Direct: ${creatorDetails.phone}
          </div>
          `
              : ""
          }
        </div>
        `
            : ""
        }
      </div>
      <div style="text-align: right;">
        <h2 style="margin: 0; border: none;">PURCHASE ORDER</h2>
        <div class="po-number">${purchaseOrder.poNumber}</div>
        <div style="font-size: 10pt; color: #666; margin-top: 0.5rem;">
          Date: ${format(normalizeUTCDateToLocal(purchaseOrder.orderDate), "MMM dd, yyyy")}
        </div>
        ${
          effectivePaymentTerms
            ? `
        <div style="font-size: 10pt; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: ${isCustomPaymentTerms ? "#fefce8" : "#f3f4f6"}; border: 1px solid ${isCustomPaymentTerms ? "#fde68a" : "#d1d5db"}; border-radius: 0.25rem;">
          <span style="font-weight: bold;">Payment Terms:</span> ${effectivePaymentTerms}
          ${isCustomPaymentTerms ? '<span style="font-size: 8pt; color: #92400e; margin-left: 0.5rem;">(custom)</span>' : ""}
        </div>
        `
            : ""
        }
        ${
          purchaseOrder.deliveryTerms
            ? `
        <div style="font-size: 10pt; margin-top: 0.35rem; padding: 0.25rem 0.5rem; background: #eff6ff; border: 1px solid #93c5fd; border-radius: 0.25rem;">
          <span style="font-weight: bold;">Delivery Terms:</span> ${purchaseOrder.deliveryTerms}
        </div>
        `
            : ""
        }
        ${
          headerDeliveryDate
            ? `
        <div style="font-size: 10pt; margin-top: 0.35rem; padding: 0.25rem 0.5rem; background: #fefce8; border: 1px solid #fde68a; border-radius: 0.25rem;">
          <span style="font-weight: bold;">Delivery Date:</span> ${headerDeliveryDate}
        </div>
        `
            : ""
        }
      </div>
    </div>
  </div>

  <div class="grid-2 no-break">
    <div>
      <h2>Vendor</h2>
      <div class="field">
        ${(() => {
          // Use the PO-level vendor address snapshot (set when user selects an address on the PO)
          // Fall back to supplier's default address only if no snapshot exists
          const hasSnapshot =
            purchaseOrder.vendorAddress1 !== null ||
            purchaseOrder.vendorCity !== null ||
            purchaseOrder.vendorState !== null;

          let vendorDisplayName: string;
          let vendorAddr1: string | null | undefined;
          let vendorAddr2: string | null | undefined;
          let vendorCity: string | null | undefined;
          let vendorState: string | null | undefined;
          let vendorZip: string | null | undefined;
          let vendorCountry: string | null | undefined;

          if (hasSnapshot) {
            vendorDisplayName =
              purchaseOrder.vendorName ?? purchaseOrder.supplier.name;
            vendorAddr1 = purchaseOrder.vendorAddress1;
            vendorAddr2 = purchaseOrder.vendorAddress2;
            vendorCity = purchaseOrder.vendorCity;
            vendorState = purchaseOrder.vendorState;
            vendorZip = purchaseOrder.vendorZip;
            vendorCountry = purchaseOrder.vendorCountry;
          } else {
            const addrs = purchaseOrder.supplier.addresses;
            const best =
              addrs.find((a) => a.isDefaultMailing) ??
              addrs.find((a) => a.isMailingAddress) ??
              addrs[0] ??
              null;
            vendorDisplayName = purchaseOrder.supplier.name;
            vendorAddr1 = best?.address1;
            vendorAddr2 = best?.address2;
            vendorCity = best?.city;
            vendorState = best?.state;
            vendorZip = best?.zip;
            vendorCountry = best?.country;
          }

          const hasAddr = vendorAddr1 ?? vendorCity ?? vendorState;
          return `
            <div class="field-value" style="font-weight: bold;">${vendorDisplayName}</div>
            ${purchaseOrder.supplier.code ? `<div style="font-size: 10pt; color: #666;">Legacy Code: ${purchaseOrder.supplier.code}</div>` : ""}
            ${purchaseOrder.supplier.internalVendorCode ? `<div style="font-size: 10pt; color: #666;">Vendor Code: ${purchaseOrder.supplier.internalVendorCode}</div>` : ""}
            ${
              hasAddr
                ? `
              ${vendorAddr1 ? `<div style="font-size: 10pt;">${vendorAddr1}</div>` : ""}
              ${vendorAddr2 ? `<div style="font-size: 10pt;">${vendorAddr2}</div>` : ""}
              ${(vendorCity ?? vendorState ?? vendorZip) ? `<div style="font-size: 10pt;">${[vendorCity, vendorState, vendorZip].filter(Boolean).join(", ")}</div>` : ""}
              ${vendorCountry && vendorCountry !== "USA" ? `<div style="font-size: 10pt;">${vendorCountry}</div>` : ""}
            `
                : ""
            }
          `;
        })()}
        ${purchaseOrder.supplier.contactPerson ? `<div style="font-size: 10pt; margin-top: 0.5rem;">${purchaseOrder.supplier.contactPerson}</div>` : ""}
        ${purchaseOrder.supplier.email ? `<div style="font-size: 10pt;">${purchaseOrder.supplier.email}</div>` : ""}
        ${purchaseOrder.supplier.phone ? `<div style="font-size: 10pt;">${purchaseOrder.supplier.phone}</div>` : ""}
      </div>
    </div>
    <div>
      <h2>Ship To</h2>
      <div class="field">
        ${(() => {
          const shipTo = resolveShipTo(purchaseOrder, {
            companyName: branding.companyName,
            addressLine1: branding.addressLine1,
            city: branding.city,
            state: branding.state,
            zip: branding.zip,
          });
          return `
            <div class="field-value" style="font-weight: bold;">${shipTo.name}</div>
            ${shipTo.attention ? `<div style="font-size: 10pt;">${shipTo.attention}</div>` : ""}
            ${shipTo.address1 ? `<div style="font-size: 10pt;">${shipTo.address1}</div>` : ""}
            ${shipTo.address2 ? `<div style="font-size: 10pt;">${shipTo.address2}</div>` : ""}
            ${shipTo.cityStateZip ? `<div style="font-size: 10pt;">${shipTo.cityStateZip}</div>` : ""}
            ${shipTo.country ? `<div style="font-size: 10pt;">${shipTo.country}</div>` : ""}
          `;
        })()}
      </div>
    </div>
  </div>

  ${
    purchaseOrder.notes
      ? `
  <div class="no-break" style="margin-bottom: 1rem;">
    <h2 style="font-size: 11pt; font-weight: 600; text-transform: uppercase; margin-top: 0; margin-bottom: 0.5rem; color: #374151;">Special Instructions</h2>
    <div style="border: 1px solid #d1d5db; padding: 0.75rem; border-radius: 0.25rem; background: #f9fafb;">
      <p style="font-size: 10pt; white-space: pre-wrap; margin: 0;">${purchaseOrder.notes}</p>
    </div>
  </div>
  `
      : ""
  }

  <div class="no-break" style="margin-bottom: 1.5rem; border: 3px solid #000; background: #f9fafb; padding: 1rem; border-radius: 0.25rem;">
    <div style="margin-bottom: 0.75rem;">
      <p style="font-size: 11pt; font-weight: bold; text-align: center; text-transform: uppercase; margin-bottom: 0.5rem;">
        ${branding.poFooterText || `By accepting this purchase order, you agree to the terms and conditions outlined on this purchase order or filed with ${branding.companyShortName}.`}
      </p>
      <p style="font-size: 10pt; font-weight: 600; text-align: center;">
        Please confirm receipt of this purchase order with your acknowledgement.
      </p>
    </div>

    <div style="border-top: 2px solid #9ca3af; padding-top: 0.75rem; margin-top: 0.75rem;">
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <div>
          <p style="font-size: 9pt; font-weight: bold; text-transform: uppercase; margin-bottom: 0.25rem; color: #374151;">Reply to Purchasing Manager:</p>
          ${
            creatorDetails
              ? `
            <p style="font-size: 10pt; font-weight: 600; margin-bottom: 0.25rem;">
              ${creatorDetails.name || "Purchasing Department"}
            </p>
            <p style="font-size: 10pt; font-family: monospace; background: #fff; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.25rem;">
              ${creatorDetails.email ?? "purchasing@columbiarivernitrogen.com"}
            </p>
            ${
              creatorDetails.phone
                ? `
            <p style="font-size: 8pt; color: #374151; margin-top: 0.25rem;">
              Direct: ${creatorDetails.phone}
            </p>
            `
                : ""
            }
          `
              : `
            <p style="font-size: 10pt; font-family: monospace; background: #fff; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.25rem;">
              purchasing@columbiarivernitrogen.com
            </p>
          `
          }
        </div>
        <div>
          <p style="font-size: 9pt; font-weight: bold; text-transform: uppercase; margin-bottom: 0.25rem; color: #374151;">Send Invoices to Accounts Payable:</p>
          <p style="font-size: 10pt; font-family: monospace; background: #fff; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.25rem;">
            accountspayable@columbiarivernitrogen.com
          </p>
          <p style="font-size: 8pt; color: #374151; margin-top: 0.25rem;">
            Phone: 503-366-8905
          </p>
        </div>
      </div>
    </div>
  </div>

  <div class="no-break">
    <h2>Line Items</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 5%;">#</th>
          <th style="width: ${showPerLineDeliveryDate ? "35%" : "45%"};">Description</th>
          ${showPerLineDeliveryDate ? '<th style="width: 12%; text-align: center;">Delivery Date</th>' : ""}
          <th style="width: ${showPerLineDeliveryDate ? "12%" : "15%"}; text-align: right;">Quantity</th>
          <th style="width: ${showPerLineDeliveryDate ? "16%" : "15%"}; text-align: right;">Unit Price</th>
          <th style="width: 20%; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${purchaseOrder.lines
          .map(
            (line, index: number) => `
          <tr>
            <td>${index + 1}</td>
            <td>
              <div style="font-weight: 600;">${line.description}</div>
              ${line.inventoryItem ? `<div style="font-size: 10pt; color: #666;">SKU: ${line.inventoryItem.sku}</div>` : ""}
              ${line.notes ? `<div style="font-size: 10pt; color: #666; margin-top: 0.25rem; white-space: pre-wrap;">${line.notes}</div>` : ""}
            </td>
            ${
              showPerLineDeliveryDate
                ? `
            <td style="text-align: center; font-size: 10pt; ${line.deliveryDate ? "background: #fefce8;" : ""}">
              ${line.deliveryDate ? formatDate(line.deliveryDate) : "—"}
            </td>
            `
                : ""
            }
            <td style="text-align: right;">${Number(line.quantity).toFixed(2)}</td>
            <td style="text-align: right;">${displayCurrency(Number(line.unitPrice))}</td>
            <td style="text-align: right; font-weight: 600;">${displayCurrency(Number(line.totalPrice))}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="totals no-break">
    <div class="totals-row total-final">
      <div class="totals-label">Total:</div>
      <div class="totals-value">${displayCurrency(Number(purchaseOrder.totalAmount))}</div>
    </div>
  </div>

  <div class="terms-section no-break" style="page-break-before: always;">
    <h2 style="background: #f3f4f6; padding: 0.5rem; margin-bottom: 1rem;">Purchase Order Terms and Conditions</h2>
    <div style="font-size: 8pt; line-height: 1.4;">
      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">1. ACCEPTANCE OF PURCHASE ORDER.</p>
        <p style="margin-left: 1rem;">Seller shall be deemed to have accepted each Purchase Order issued by the Buyer upon written acceptance by Seller, any performance by Seller, or the passage of five (5) days after the Seller&apos;s receipt of the Purchase Order without written notice to the Buyer that the Seller does not accept.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">2. ACCEPTANCE OF TERMS AND CONDITIONS.</p>
        <p style="margin-left: 1rem;">Seller&apos;s acceptance of the Purchase Order constitutes acceptance by Seller of all the terms and conditions contained both on the face of the Purchase Order and these Terms and Conditions. The terms and conditions contained in the Purchase Order, including these Terms and Conditions, supersede any inconsistent terms contained in any invoice, packing slip, shipping documents, or other instrument.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">3. SHIPPING TERMS.</p>
        <p style="margin-left: 1rem;">All product identified in this Purchase Order is being shipped DAP Buyer&apos;s designated point of delivery. Risk of loss shall pass upon Seller&apos;s delivery of the product to the Buyer, or Buyer&apos;s assignees. Insurance will be at the cost of and the sole responsibility of Seller.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">4. PAYMENT TERMS.</p>
        <p style="margin-left: 1rem;">Payment terms as specified on the Purchase Order.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">5. INVOICES.</p>
        <p style="margin-left: 1rem;">Unless otherwise specified in this Purchase Order, Seller shall invoice Buyer within thirty (30) days after delivery of the Products and/or provision of the services. Seller shall submit the invoice to the Buyer at the invoicing address for the Buyer shown on this Purchase Order. If Seller does not submit an invoice within one hundred and eighty (180) days after delivery of the products and/or services rendered, Seller waives right to payment for those products and/or services.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">6. INVOICE REQUIREMENTS.</p>
        <p style="margin-left: 1rem;">Invoices shall be in a form acceptable to the Buyer and include the Buyer&apos;s Purchase Order number and release number, if any; an itemization of, and the Prices (including calculation) for, the products and services covered by the invoice; the Seller&apos;s Invoice number and Invoice date to reference; the preferred remit to address for payment; and any further documentation or information as is reasonably required by the Buyer.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">7. INSPECTION.</p>
        <p style="margin-left: 1rem;">Buyer shall within reasonable time after receipt thereof, inspect the products and/or services and notify Seller if they are not in accordance with the Purchase Order or standards of quality specified by Buyer. Buyer shall have the right to reject such products and/or services and treat the Purchase Order as cancelled from the date of rejection or require Seller, upon notification and at Seller&apos;s sole cost and on such timeframe specified by Buyer, to remove such defective products and deliver the correct products, or replace, repair, reperform, or alter the faulty products and/or services to conform with Buyer&apos;s requirements or to seek such other remedies as may be available in the event of default of Seller. In the event that payment is made prior to inspection, Buyer reserves the right and Seller agrees that Buyer may reject faulty or improper products and/or services and secure adjustment or refund thereon.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">8. RETURNED PRODUCT.</p>
        <p style="margin-left: 1rem;">Exchanges and/or returns will be freely allowed on all defective or excess product or product shipped in error. Buyer will have a reasonable time to report all product defects, but not less than 60 days. No prior authorization need be obtained from Seller before returning any merchandise. No restocking fees will be charged against returns.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">9. WARRANTIES/DAMAGES.</p>
        <p style="margin-left: 1rem;">Seller warrants that it has good and marketable title to any products sold and that any products sold shall be free from defect in material, shall conform to the Purchase Order, shall be of good workmanship and quality, shall be fit for the purpose for which they are intended, and shall be in conformance with applicable law. Seller warrants that any services provided shall be in accordance with the Purchase Order, shall be performed in accordance with the methods, standards, codes and practices currently prevailing among leading parties in the fields to which the services relate, and shall be in conformance with applicable law. Seller is responsible for all damages at law or in equity upon a breach of this warranty.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">10. CANCELLATION.</p>
        <p style="margin-left: 1rem;">Buyer may cancel any outstanding portion of this Purchase Order without penalty in the event that any of the products or services are not received by the delivery date specified in this Purchase Order, or if the product or packaging or services are nonconforming.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">11. TAXES.</p>
        <p style="margin-left: 1rem;">Seller shall be solely responsible to pay all duty and taxes of any kind whatsoever incurred as a result of the purchase by Seller covered by the Invoice.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">12. CONFIDENTIALITY.</p>
        <p style="margin-left: 1rem;">Seller covenants and agrees to keep strictly confidential any and all trade secrets and other confidential information of Buyer which Seller may learn or discover in the course of its business relationship with Buyer, including the clients or customers of Buyer. Seller shall not disclose any confidential information or trade secrets to third parties and shall not use such information for any purpose other than providing products or services to Buyer under the Purchase Order.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">13. INTELLECTUAL PROPERTY RIGHTS.</p>
        <p style="margin-left: 1rem;">All intellectual property rights relating to the products and/or services covered by the Purchase Order, including without limitation all trademarks, patents, copyrights and trade secrets, are and shall remain the property of Buyer. Seller acknowledges and agrees that its business is not substantially associated with any trademark, service mark, trade name, logotype, advertising, or other commercial symbol designating Buyer or the products or services covered hereby.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">14. GOVERNING LAW AND VENUE.</p>
        <p style="margin-left: 1rem;">Any dispute regarding the products and/or services covered by the Purchase Order shall be governed by the laws of the United States of America and the state of New York. If any action, suit or proceeding is brought by either Buyer or Seller with respect to the products and/or services covered by this Purchase Order, such suit may be brought only in a state or federal court located in Oregon, and Seller hereby consents to the jurisdiction of said courts.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">15. WAIVERS.</p>
        <p style="margin-left: 1rem;">Any failure by Buyer to enforce or require strict performance by Seller of any terms or conditions of the Purchase Order shall not constitute a waiver, and Buyer may at any time avail itself of the remedies Buyer may have for breach of the terms hereof.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">16. ATTORNEYS FEES.</p>
        <p style="margin-left: 1rem;">If either party breaches the terms and conditions of the Purchase Order, the nonbreaching party may recover reasonable attorney&apos;s fees and costs in seeking to enforce, or recover damages resulting from the breach of, this Purchase Order.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">17. INSURANCE.</p>
        <p style="margin-left: 1rem;">Seller shall maintain, at its sole expense, the following insurance, which shall be underwritten by insurers having A.M. Best Company rating of at least A VII: (a) workers&apos; compensation insurance in accordance with applicable statutory limits required where the products or services are being performed and employer&apos;s liability coverage of not less than $500,000 per occurrence (if Seller utilizes personnel that are not its own employees, Seller shall provide a primary workers&apos; compensation policy in which Seller is a named insured); (b) commercial general liability insurance covering all liabilities with limits of liability of $1,000,000 for each occurrence and $2,000,000 in the aggregate; (c) excess/umbrella liability insurance covering all liabilities with limits of liability of $5,000,000 for each occurrence and in the aggregate; (d) if Seller (or a carrier engaged by Seller) will use or provide for use of motor vehicles in performing the products and/or services, motor vehicle liability insurance covering all liabilities arising from the use of such vehicles, with limits of liability of no less than $1,000,000 for each occurrence and in the aggregate; and (e) such other insurance as Buyer may require. All such insurance shall include endorsements naming Buyer and its directors, officers and employees as additional insureds and waiving all express or implied rights of subrogation against Buyer. Prior to the commencement of any services or delivery of any products hereunder, Seller shall provide Buyer with a certificate of insurance from Seller&apos;s insurer evidencing the insurance coverage required in this Agreement.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">18. INDEPENDENT CONTRACTOR.</p>
        <p style="margin-left: 1rem;">Seller specifically agrees and warrants that it is an independent contractor. Nothing in this Purchase Order creates a partnership, joint venture, or employment relationship.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">19. INTEGRATION.</p>
        <p style="margin-left: 1rem;">No other writing which is not referred to herein shall be deemed to be a part of this agreement or these Terms and Conditions. The Purchase Order and these Terms and Conditions constitute the entire agreement relating to the subject matter hereof and supersede all prior and contemporaneous understandings or statements unless expressly contained herein.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">20. MODIFICATION.</p>
        <p style="margin-left: 1rem;">No terms or conditions other than those stated herein, and no agreement or understanding in any way modifying these Terms and Conditions shall be binding upon Buyer unless made in writing and signed by a duly authorized agent of Buyer. Unless otherwise indicated on the face of the Purchase Order, the Purchase Order expressly limits acceptance to the price terms of this offer.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">21. INDEMNITY.</p>
        <p style="margin-left: 1rem;">Seller shall indemnify, reimburse, and defend Buyer from and with respect to any and all losses, damages, penalties, fines, fees, and expenses arising from: (a) a breach of the Purchase Order by Seller; (b) a defective product or product liability claim; (c) a breach of warranties; (d) a third-party claim of intellectual property infringement by Seller or any of its products or associated names or packaging; (e) personal injury or death alleged to have been caused by a product or service of Seller; and (f) any negligent or intentional act or omission by an officer, manager, director, employee, contractor, or agent of Seller.</p>
      </div>

      <div style="margin-bottom: 0.75rem;">
        <p style="font-weight: bold; margin-bottom: 0.25rem;">22. AFFIRMATIVE ACTION.</p>
        <p style="margin-left: 1rem;">Buyer is an Affirmative Action Employer. As such, we require all vendors and suppliers to comply with all laws and regulations concerning non-discrimination in employment, including, but not limited to 41 C.F.R. 60-1.4, 60-280.4 and 60-741.4 incorporated herein by reference.</p>
      </div>
    </div>
  </div>

  <div class="signature-section no-break">
    <div>
      <div style="font-size: 11pt; font-weight: bold; margin-bottom: 0.5rem;">Authorized By:</div>
      <div class="signature-line"></div>
      <div style="font-size: 9pt; color: #666;">Signature</div>
      <div style="margin-top: 1rem; font-size: 9pt; color: #666;">Date: _________________</div>
    </div>
    <div>
      <div style="font-size: 11pt; font-weight: bold; margin-bottom: 0.5rem;">Vendor Acknowledgment:</div>
      <div class="signature-line"></div>
      <div style="font-size: 9pt; color: #666;">Signature</div>
      <div style="margin-top: 1rem; font-size: 9pt; color: #666;">Date: _________________</div>
    </div>
  </div>

  <div class="footer">
    This is a computer-generated document. No signature is required.<br>
    Generated on ${format(new Date(), "MMM dd, yyyy HH:mm")}
  </div>
</body>
</html>
  `;
}
