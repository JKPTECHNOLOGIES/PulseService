const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Small, dependency-free formatters used only inside the generated document.
const money = (n) =>
  "$" +
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "-";

const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const LINE = "#e5e7eb";
const TABLE_HEAD_BG = "#bcdcec";
const LEFT = 50;
const RIGHT_EDGE = 562; // Letter width (612) - 50 margin

// Bundled wordmark shown top-left of every invoice/estimate. Wrapped in
// existsSync so a missing/renamed asset never breaks document generation -
// it just prints without a logo.
const LOGO_PATH = path.join(__dirname, "../assets/logo.jpg");
const LOGO_WIDTH = 150;
// Fixed aspect ratio of the bundled logo file (a wide wordmark banner), used
// to reserve vertical space for it without probing the file for dimensions.
const LOGO_HEIGHT = LOGO_WIDTH / 3.25;

// Street + city/state/zip lines for a Location, skipping anything missing.
function addressLines(loc) {
  if (!loc) return [];
  return [
    loc.address,
    [loc.city, loc.state, loc.zip].filter(Boolean).join(", "),
  ].filter(Boolean);
}

/**
 * Renders an invoice or estimate to a PDF Buffer using pdfkit (pure-JS, no
 * headless browser). `kind` is "invoice" | "estimate". `doc` is the Prisma
 * record with `customer` (incl. `locations`), `job` (incl. `location`), and
 * ordered `lineItems` included; `settings` is the CompanySettings row used
 * for branding.
 */
function render(kind, doc, settings) {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "LETTER", margin: 50 });
      const chunks = [];
      pdf.on("data", (c) => chunks.push(c));
      pdf.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      pdf.on("error", reject);

      const isInvoice = kind === "invoice";
      const titleLabel = isInvoice ? "Invoice" : "Estimate";
      const number = isInvoice ? doc.invoiceNumber : doc.estimateNumber;
      const customer = doc.customer || {};
      const job = doc.job || null;
      // Lines marked "not included" (invoice-only; estimate items never set
      // this) stay off the customer-facing document, matching the totals
      // below, which are computed from the same rule server-side.
      const lineItems = (doc.lineItems || []).filter(
        (li) => li.includeOnDocument !== false,
      );
      const company = settings || {};

      const customerName =
        customer.companyName ||
        `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
        "Customer";
      // Bill to: an explicit billing Location, else the primary one, else
      // whichever comes first. Ship to: the job's own service location (if
      // this document is tied to a job), else an explicit service Location,
      // else the same address used for Bill To.
      const locations = customer.locations || [];
      const billingLocation =
        locations.find((l) => l.type === "billing") ||
        locations.find((l) => l.isPrimary) ||
        locations[0] ||
        null;
      const serviceLocation =
        job?.location ||
        locations.find((l) => l.type === "service") ||
        billingLocation;

      // ── Header: logo (left) + company address (middle) + phone/email (right) ──
      const headY = 45;
      if (fs.existsSync(LOGO_PATH)) {
        try {
          pdf.image(LOGO_PATH, LEFT, headY, { width: LOGO_WIDTH });
        } catch {
          // Corrupt/unreadable image - skip it rather than fail the whole PDF.
        }
      }

      const midX = LEFT + LOGO_WIDTH + 24;
      const midW = 150;
      const rightX = midX + midW + 12;
      const rightW = RIGHT_EDGE - rightX;
      const companyName = company.name || "Prime Comfort Solutions";

      pdf.font("Helvetica-Bold").fontSize(10).fillColor(INK);
      pdf.text(companyName, midX, headY, { width: midW });
      pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
      let cy = headY + 14;
      [
        company.address,
        [company.city, company.state, company.zip].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .forEach((l) => {
          pdf.text(l, midX, cy, { width: midW });
          cy += 12;
        });

      let my = headY;
      [company.phone ? `Phone: ${company.phone}` : null, company.email]
        .filter(Boolean)
        .forEach((l) => {
          pdf.text(l, rightX, my, { width: rightW });
          my += 13;
        });

      // ── Bill to / Ship to ───────────────────────────────────────────────
      const shipX = 320;
      const shipW = RIGHT_EDGE - shipX;
      const billY = Math.max(headY + LOGO_HEIGHT, cy, my) + 20;

      pdf
        .font("Helvetica")
        .fontSize(9)
        .fillColor(MUTED)
        .text("Bill to", LEFT, billY);
      pdf
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(INK)
        .text(customerName, LEFT, billY + 13, { width: 250 });
      pdf.font("Helvetica").fontSize(9).fillColor("#374151");
      let by = billY + 27;
      addressLines(billingLocation).forEach((l) => {
        pdf.text(l, LEFT, by, { width: 250 });
        by += 12;
      });

      pdf
        .font("Helvetica")
        .fontSize(9)
        .fillColor(MUTED)
        .text("Ship to", shipX, billY, { width: shipW });
      pdf
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(INK)
        .text(customerName, shipX, billY + 13, { width: shipW });
      pdf.font("Helvetica").fontSize(9).fillColor("#374151");
      let sy = billY + 27;
      addressLines(serviceLocation).forEach((l) => {
        pdf.text(l, shipX, sy, { width: shipW });
        sy += 12;
      });

      // ── Work order description / summary (left) + terms (right) ─────────
      let ty = Math.max(by, sy) + 24;
      const workBlockY = ty;
      const workOrderDescription = job
        ? job.description || job.summary || null
        : null;
      const workSummary = job ? job.completionNotes || null : null;

      const workBlock = (heading, body) => {
        if (!body) return;
        pdf
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor(INK)
          .text(heading, LEFT, ty, { width: 400 });
        ty += 13;
        pdf.font("Helvetica").fontSize(9).fillColor("#374151");
        pdf.text(body, LEFT, ty, { width: 400 });
        ty += pdf.heightOfString(body, { width: 400 }) + 16;
      };
      workBlock("Work Order Description", workOrderDescription);
      workBlock("Work Summary", workSummary);
      if (ty === workBlockY) ty += 8; // neither block rendered - keep spacing sane

      // Short payment-terms line, right-aligned near the top of the work
      // order block (mirrors a compact "Terms: Net 30" summary line).
      if (isInvoice && doc.dueDate) {
        const days = Math.round(
          (new Date(doc.dueDate).getTime() - new Date(doc.createdAt).getTime()) /
            86400000,
        );
        const termsLabel = days > 0 ? `Net ${days}` : "Due on Receipt";
        pdf
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#374151")
          .text(`Terms: ${termsLabel}`, shipX, workBlockY, {
            width: shipW,
            align: "right",
          });
      } else if (!isInvoice && doc.validUntil) {
        pdf
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#374151")
          .text(`Valid until: ${fmtDate(doc.validUntil)}`, shipX, workBlockY, {
            width: shipW,
            align: "right",
          });
      }

      // ── Transaction date / document number ───────────────────────────────
      if (ty > 660) {
        pdf.addPage();
        ty = 50;
      }
      pdf
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#374151")
        .text(`Transaction Date: ${fmtDate(doc.createdAt)}`, LEFT, ty);
      ty += 20;
      pdf
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(INK)
        .text(`${titleLabel} #: ${number}`, LEFT, ty);
      ty += 26;

      // ── Line items table ─────────────────────────────────────────────────
      // Our line items store the full name in `name` (not a short SKU) and a
      // shorter blurb in `description`, so the Item column gets most of the
      // width rather than mirroring a source system that does the opposite.
      const COL = { item: LEFT, desc: 226, qty: 340, price: 400, total: 470 };
      const COLW = {
        item: 170,
        desc: 106,
        qty: 55,
        price: 65,
        total: RIGHT_EDGE - 470,
      };

      const drawHeader = (yy) => {
        pdf.rect(LEFT, yy, RIGHT_EDGE - LEFT, 20).fill(TABLE_HEAD_BG);
        pdf.fillColor(INK).font("Helvetica-Bold").fontSize(9);
        pdf.text("Item", COL.item + 6, yy + 6, { width: COLW.item - 6 });
        pdf.text("Description", COL.desc, yy + 6, { width: COLW.desc });
        pdf.text("Quantity", COL.qty, yy + 6, {
          width: COLW.qty,
          align: "right",
        });
        pdf.text("Price", COL.price, yy + 6, {
          width: COLW.price,
          align: "right",
        });
        pdf.text("Amount", COL.total, yy + 6, {
          width: COLW.total - 6,
          align: "right",
        });
        pdf.font("Helvetica");
        return yy + 24;
      };

      if (ty > 690) {
        pdf.addPage();
        ty = 50;
      }
      ty = drawHeader(ty);

      lineItems.forEach((li) => {
        if (ty > 690) {
          pdf.addPage();
          ty = drawHeader(50);
        }
        const rowY = ty;
        pdf
          .fillColor(INK)
          .fontSize(9)
          .text(li.name || "", COL.item + 6, rowY, { width: COLW.item - 6 });
        pdf
          .fillColor("#374151")
          .fontSize(9)
          .text(li.description || "", COL.desc, rowY, { width: COLW.desc });
        const h = Math.max(
          pdf.heightOfString(li.name || "", { width: COLW.item - 6 }),
          pdf.heightOfString(li.description || "", { width: COLW.desc }),
        );
        pdf.fillColor(INK).fontSize(9);
        pdf.text(String(li.quantity ?? ""), COL.qty, rowY, {
          width: COLW.qty,
          align: "right",
        });
        pdf.text(money(li.unitPrice), COL.price, rowY, {
          width: COLW.price,
          align: "right",
        });
        pdf.text(money(li.total), COL.total, rowY, {
          width: COLW.total - 6,
          align: "right",
        });
        ty = rowY + Math.max(h, 11) + 9;
        pdf
          .moveTo(LEFT, ty - 4)
          .lineTo(RIGHT_EDGE, ty - 4)
          .strokeColor(LINE)
          .stroke();
      });

      ty += 8;

      // ── Totals ──────────────────────────────────────────────────────────
      const labelX = 360;
      const labelW = 120;
      const valX = labelX + labelW;
      const valW = RIGHT_EDGE - valX;

      const rows = [["Subtotal", money(doc.subtotal)]];
      if (doc.discountValue) {
        const disc =
          doc.discountType === "percentage"
            ? (doc.subtotal * doc.discountValue) / 100
            : doc.discountValue;
        rows.push(["Discount", "-" + money(disc)]);
      }
      if (doc.taxAmount) {
        rows.push([`Tax (${doc.taxRate || 0}%)`, money(doc.taxAmount)]);
      }
      rows.push(["Total", money(doc.total)]);
      if (isInvoice) {
        rows.push(["Payments", money(doc.amountPaid)]);
        rows.push(["Balance Due", money(doc.balance)]);
      }

      rows.forEach(([label, val]) => {
        const strong = label === "Total" || label === "Balance Due";
        pdf
          .fontSize(strong ? 11 : 10)
          .font(strong ? "Helvetica-Bold" : "Helvetica")
          .fillColor(strong ? INK : MUTED)
          .text(label, labelX, ty, { width: labelW, align: "right" });
        pdf.fillColor(INK).text(val, valX, ty, { width: valW, align: "right" });
        ty += strong ? 18 : 15;
      });
      pdf.font("Helvetica");

      // ── Notes & terms ──────────────────────────────────────────────────
      ty += 14;
      const block = (heading, body) => {
        if (!body) return;
        if (ty > 700) {
          pdf.addPage();
          ty = 50;
        }
        pdf
          .fontSize(8)
          .fillColor(FAINT)
          .font("Helvetica-Bold")
          .text(heading, LEFT, ty);
        pdf.font("Helvetica").fontSize(9).fillColor("#374151");
        pdf.text(body, LEFT, ty + 12, { width: 500 });
        ty += 12 + pdf.heightOfString(body, { width: 500 }) + 12;
      };
      block("NOTES", doc.notes);
      block("TERMS", doc.terms);

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Title-cases a lookup value like "monthly" / "semi_annually" for display.
const titleCase = (s) =>
  String(s || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Renders a service agreement to a PDF Buffer. `agreement` is the Prisma record
 * with `customer` and ordered `visits` included; `settings` is the
 * CompanySettings row used for branding. Mirrors the invoice/estimate layout so
 * documents look like one family.
 */
function renderAgreement(agreement, settings) {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "LETTER", margin: 50 });
      const chunks = [];
      pdf.on("data", (c) => chunks.push(c));
      pdf.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      pdf.on("error", reject);

      const customer = agreement.customer || {};
      const visits = agreement.visits || [];
      const company = settings || {};
      const rightBlockX = 320;
      const rightBlockW = RIGHT_EDGE - rightBlockX;

      // ── Header: company (left) + document title/meta (right) ──────────────
      const headY = 50;
      const companyName = company.name || "Prime Comfort Solutions";
      pdf.fontSize(20).fillColor(INK).font("Helvetica-Bold");
      const nameHeight = pdf.heightOfString(companyName, { width: 250 });
      pdf.text(companyName, LEFT, headY, { width: 250 });

      pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
      let cy = headY + nameHeight + 6;
      [
        company.address,
        [company.city, company.state, company.zip].filter(Boolean).join(", "),
        company.phone,
        company.email,
      ]
        .filter(Boolean)
        .forEach((l) => {
          pdf.text(l, LEFT, cy, { width: 250 });
          cy += 12;
        });

      pdf
        .fontSize(22)
        .fillColor(INK)
        .font("Helvetica-Bold")
        .text("SERVICE AGREEMENT", rightBlockX, headY, {
          width: rightBlockW,
          align: "right",
        });
      pdf
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#374151")
        .text(`#${agreement.agreementNumber}`, rightBlockX, headY + 30, {
          width: rightBlockW,
          align: "right",
        });
      pdf.fontSize(9).fillColor(MUTED);
      let my = headY + 46;
      [
        `Date: ${fmtDate(agreement.createdAt)}`,
        `Status: ${String(agreement.status || "").toUpperCase()}`,
      ].forEach((m) => {
        pdf.text(m, rightBlockX, my, { width: rightBlockW, align: "right" });
        my += 13;
      });

      // ── Prepared for ──────────────────────────────────────────────────────
      const billY = Math.max(cy, my) + 12;
      pdf
        .fontSize(8)
        .fillColor(FAINT)
        .font("Helvetica-Bold")
        .text("PREPARED FOR", LEFT, billY);
      pdf
        .fontSize(11)
        .fillColor(INK)
        .text(
          `${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
            "Customer",
          LEFT,
          billY + 13,
        );
      pdf.font("Helvetica").fontSize(9).fillColor("#374151");
      let by = billY + 29;
      [customer.companyName, customer.email, customer.phone]
        .filter(Boolean)
        .forEach((l) => {
          pdf.text(l, LEFT, by, { width: 250 });
          by += 12;
        });

      pdf
        .fontSize(11)
        .fillColor(INK)
        .text(agreement.name || "Planned Service Agreement", rightBlockX, billY + 13, {
          width: rightBlockW,
          align: "right",
        });

      // ── Agreement details ─────────────────────────────────────────────────
      let ty = Math.max(by, billY + 40) + 16;
      pdf.moveTo(LEFT, ty).lineTo(RIGHT_EDGE, ty).strokeColor(LINE).stroke();
      ty += 14;

      const term =
        `${fmtDate(agreement.startDate)} \u2013 ${fmtDate(agreement.endDate)}`;
      const detailRows = [
        ["Term", term],
        [
          "Billing",
          `${money(agreement.amount)} per ${titleCase(agreement.billingFrequency)}`,
        ],
        ["Auto-renew", agreement.autoRenew ? "Yes" : "No"],
      ];
      if (agreement.nextBillingDate)
        detailRows.push(["Next billing", fmtDate(agreement.nextBillingDate)]);

      detailRows.forEach(([label, val]) => {
        pdf
          .fontSize(8)
          .fillColor(FAINT)
          .font("Helvetica-Bold")
          .text(label.toUpperCase(), LEFT, ty, { width: 120 });
        pdf
          .font("Helvetica")
          .fontSize(10)
          .fillColor(INK)
          .text(val, LEFT + 130, ty, { width: RIGHT_EDGE - LEFT - 130 });
        ty += 20;
      });

      // ── Terms & notes ─────────────────────────────────────────────────────
      ty += 6;
      const block = (heading, body) => {
        if (!body) return;
        if (ty > 700) {
          pdf.addPage();
          ty = 50;
        }
        pdf
          .fontSize(8)
          .fillColor(FAINT)
          .font("Helvetica-Bold")
          .text(heading, LEFT, ty);
        pdf.font("Helvetica").fontSize(9).fillColor("#374151");
        pdf.text(body, LEFT, ty + 12, { width: 500 });
        ty += 12 + pdf.heightOfString(body, { width: 500 }) + 12;
      };
      block("TERMS", agreement.terms);
      block("NOTES", agreement.notes);

      // ── Scheduled visits ──────────────────────────────────────────────────
      if (visits.length) {
        if (ty > 660) {
          pdf.addPage();
          ty = 50;
        }
        pdf
          .fontSize(8)
          .fillColor(FAINT)
          .font("Helvetica-Bold")
          .text("SCHEDULED VISITS", LEFT, ty);
        ty += 14;
        const vCol = { name: LEFT, date: 340, status: 470 };
        pdf.fontSize(8).fillColor(MUTED).font("Helvetica-Bold");
        pdf.text("VISIT", vCol.name, ty);
        pdf.text("SCHEDULED", vCol.date, ty, { width: 120 });
        pdf.text("STATUS", vCol.status, ty, { width: 92 });
        pdf
          .moveTo(LEFT, ty + 12)
          .lineTo(RIGHT_EDGE, ty + 12)
          .strokeColor(LINE)
          .stroke();
        ty += 20;
        pdf.font("Helvetica").fontSize(10);
        visits.forEach((v) => {
          if (ty > 720) {
            pdf.addPage();
            ty = 50;
          }
          pdf.fillColor(INK).text(v.name || "", vCol.name, ty, { width: 280 });
          pdf
            .fillColor("#374151")
            .text(fmtDate(v.scheduledDate), vCol.date, ty, { width: 120 });
          pdf
            .fillColor(MUTED)
            .text(titleCase(v.status), vCol.status, ty, { width: 92 });
          ty += 16;
        });
      }

      // ── Signature lines ───────────────────────────────────────────────────
      ty += 24;
      if (ty > 700) {
        pdf.addPage();
        ty = 60;
      }
      const sigW = 230;
      const sigGap = RIGHT_EDGE - LEFT - sigW;
      [
        [LEFT, `${companyName} Authorized Representative`],
        [LEFT + sigGap, "Customer Authorized Signature"],
      ].forEach(([x, label]) => {
        pdf
          .moveTo(x, ty)
          .lineTo(x + sigW, ty)
          .strokeColor("#9ca3af")
          .stroke();
        pdf
          .fontSize(8)
          .fillColor(MUTED)
          .font("Helvetica")
          .text(label, x, ty + 4, { width: sigW });
        pdf.text("Date: __________", x, ty + 18, { width: sigW });
      });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePdf: (invoice, settings) =>
    render("invoice", invoice, settings),
  generateEstimatePdf: (estimate, settings) =>
    render("estimate", estimate, settings),
  generateAgreementPdf: (agreement, settings) =>
    renderAgreement(agreement, settings),
};
