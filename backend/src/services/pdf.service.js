const PDFDocument = require("pdfkit");

// Small, dependency-free formatters used only inside the generated document.
const money = (n) => "$" + Number(n || 0).toFixed(2);
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
const LEFT = 50;
const RIGHT_EDGE = 562; // Letter width (612) - 50 margin

/**
 * Renders an invoice or estimate to a PDF Buffer using pdfkit (pure-JS, no
 * headless browser). `kind` is "invoice" | "estimate". `doc` is the Prisma
 * record with `customer` and ordered `lineItems` included; `settings` is the
 * CompanySettings row used for branding.
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
      const title = isInvoice ? "INVOICE" : "ESTIMATE";
      const number = isInvoice ? doc.invoiceNumber : doc.estimateNumber;
      const customer = doc.customer || {};
      const lineItems = doc.lineItems || [];
      const company = settings || {};
      const rightBlockX = 320;
      const rightBlockW = RIGHT_EDGE - rightBlockX;

      // ── Header: company (left) + document title/meta (right) ──────────────
      const headY = 50;
      pdf
        .fontSize(20)
        .fillColor(INK)
        .font("Helvetica-Bold")
        .text(company.name || "PulseService", LEFT, headY, { width: 250 });

      pdf.font("Helvetica").fontSize(9).fillColor(MUTED);
      let cy = headY + 28;
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
        .fontSize(26)
        .fillColor(INK)
        .font("Helvetica-Bold")
        .text(title, rightBlockX, headY, { width: rightBlockW, align: "right" });
      pdf
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#374151")
        .text(`#${number}`, rightBlockX, headY + 32, {
          width: rightBlockW,
          align: "right",
        });
      pdf.fontSize(9).fillColor(MUTED);
      let my = headY + 48;
      const meta = [`Date: ${fmtDate(doc.createdAt)}`];
      if (isInvoice && doc.dueDate) meta.push(`Due: ${fmtDate(doc.dueDate)}`);
      if (!isInvoice && doc.validUntil)
        meta.push(`Valid until: ${fmtDate(doc.validUntil)}`);
      meta.push(`Status: ${String(doc.status || "").toUpperCase()}`);
      meta.forEach((m) => {
        pdf.text(m, rightBlockX, my, { width: rightBlockW, align: "right" });
        my += 13;
      });

      // ── Bill to ────────────────────────────────────────────────────────────
      const billY = 150;
      pdf.fontSize(8).fillColor(FAINT).font("Helvetica-Bold").text("BILL TO", LEFT, billY);
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

      if (doc.title) {
        pdf
          .fontSize(11)
          .fillColor(INK)
          .text(doc.title, rightBlockX, billY + 13, {
            width: rightBlockW,
            align: "right",
          });
      }

      // ── Line items table ─────────────────────────────────────────────────
      const COL = { name: LEFT, qty: 330, price: 400, total: 480 };
      const COLW = { qty: 50, price: 60, total: 82 };
      let ty = 240;

      const drawHeader = (yy) => {
        pdf.fontSize(8).fillColor(MUTED).font("Helvetica-Bold");
        pdf.text("DESCRIPTION", COL.name, yy);
        pdf.text("QTY", COL.qty, yy, { width: COLW.qty, align: "right" });
        pdf.text("PRICE", COL.price, yy, { width: COLW.price, align: "right" });
        pdf.text("TOTAL", COL.total, yy, { width: COLW.total, align: "right" });
        pdf
          .moveTo(LEFT, yy + 12)
          .lineTo(RIGHT_EDGE, yy + 12)
          .strokeColor(LINE)
          .stroke();
        pdf.font("Helvetica");
        return yy + 20;
      };
      ty = drawHeader(ty);

      lineItems.forEach((li) => {
        if (ty > 690) {
          pdf.addPage();
          ty = drawHeader(50);
        }
        const rowY = ty;
        pdf.fillColor(INK).fontSize(10).text(li.name || "", COL.name, rowY, {
          width: 260,
        });
        let h = pdf.heightOfString(li.name || "", { width: 260 });
        if (li.description) {
          pdf
            .fillColor(MUTED)
            .fontSize(8)
            .text(li.description, COL.name, rowY + h + 1, { width: 260 });
          h += pdf.heightOfString(li.description, { width: 260 }) + 1;
        }
        pdf.fillColor("#374151").fontSize(10);
        pdf.text(String(li.quantity ?? ""), COL.qty, rowY, {
          width: COLW.qty,
          align: "right",
        });
        pdf.text(money(li.unitPrice), COL.price, rowY, {
          width: COLW.price,
          align: "right",
        });
        pdf.text(money(li.total), COL.total, rowY, {
          width: COLW.total,
          align: "right",
        });
        ty = rowY + Math.max(h, 12) + 9;
      });

      pdf.moveTo(LEFT, ty).lineTo(RIGHT_EDGE, ty).strokeColor(LINE).stroke();
      ty += 12;

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
      rows.push([`Tax (${doc.taxRate || 0}%)`, money(doc.taxAmount)]);
      rows.push(["Total", money(doc.total)]);
      if (isInvoice) {
        rows.push(["Amount Paid", "-" + money(doc.amountPaid)]);
        rows.push(["Balance Due", money(doc.balance)]);
      }

      rows.forEach(([label, val]) => {
        const strong = label === "Total" || label === "Balance Due";
        pdf
          .fontSize(strong ? 11 : 10)
          .font(strong ? "Helvetica-Bold" : "Helvetica")
          .fillColor(strong ? INK : MUTED)
          .text(label, labelX, ty, { width: labelW, align: "right" });
        pdf
          .fillColor(INK)
          .text(val, valX, ty, { width: valW, align: "right" });
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
        pdf.fontSize(8).fillColor(FAINT).font("Helvetica-Bold").text(heading, LEFT, ty);
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

module.exports = {
  generateInvoicePdf: (invoice, settings) => render("invoice", invoice, settings),
  generateEstimatePdf: (estimate, settings) =>
    render("estimate", estimate, settings),
};
