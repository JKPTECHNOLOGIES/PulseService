/**
 * Resolves the price a specific customer pays for a pricebook item, based on
 * their assigned PricingTier. Resolution order:
 *   1. A per-item override on that tier (exact override price, or a
 *      percentage/fixed amount off the catalog price).
 *   2. The tier's own blanket discount (percentage or fixed) applied to the
 *      catalog price.
 *   3. The catalog price, unchanged, when no tier is assigned.
 */
const prisma = require("../config/database");

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function applyDiscount(basePrice, type, value) {
  if (type === "fixed_price") return round2(value);
  if (type === "fixed") return round2(Math.max(0, basePrice - value));
  // percentage
  return round2(basePrice * (1 - value / 100));
}

/** Pure function: computes one item's effective price given its tier/override context. */
function computeEffectivePrice(basePrice, tier, override) {
  if (override) return applyDiscount(basePrice, override.overrideType, override.overrideValue);
  if (tier) return applyDiscount(basePrice, tier.discountType, tier.discountValue);
  return round2(basePrice);
}

/** Loads a customer's tier (with overrides) — null if unassigned or not found. */
async function getCustomerTier(customerId) {
  if (!customerId) return null;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { pricingTier: { include: { overrides: true } } },
  });
  return customer?.pricingTier ?? null;
}

/**
 * Annotates a list of pricebook items with `effectivePrice` for a given
 * customer (or the unadjusted catalog price when `customerId` is omitted).
 */
async function withEffectivePrices(items, customerId) {
  const tier = await getCustomerTier(customerId);
  const overrideByItem = new Map((tier?.overrides ?? []).map((o) => [o.pricebookItemId, o]));
  return items.map((item) => ({
    ...item,
    effectivePrice: computeEffectivePrice(item.unitPrice, tier, overrideByItem.get(item.id)),
  }));
}

module.exports = { computeEffectivePrice, getCustomerTier, withEffectivePrices };
