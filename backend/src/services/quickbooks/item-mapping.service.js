/**
 * Resolves the QuickBooks Item an invoice line (or a synthetic tax/discount
 * line) should reference: an exact pricebook-item mapping first, then a
 * category (lineItemType) fallback. Throws a clear, actionable error when
 * nothing is mapped — better to fail loudly and flag it in the sync queue
 * than send QuickBooks a line it will reject, or mis-map a cost.
 */
const prisma = require("../../config/database");

async function resolveItemName({ pricebookItemId, lineItemType, label }) {
  if (pricebookItemId) {
    const specific = await prisma.quickBooksItemMapping.findFirst({
      where: { pricebookItemId, isActive: true },
    });
    if (specific) return specific.quickbooksItemName;
  }
  if (lineItemType) {
    const category = await prisma.quickBooksItemMapping.findFirst({
      where: { lineItemType, pricebookItemId: null, isActive: true },
    });
    if (category) return category.quickbooksItemName;
  }
  throw new Error(
    `No QuickBooks Item mapping for "${label}" (type: ${lineItemType || "unknown"}). ` +
      `Add one in Settings \u2192 QuickBooks \u2192 Item mapping.`,
  );
}

module.exports = { resolveItemName };
