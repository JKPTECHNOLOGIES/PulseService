function generateNumber(prefix, num) {
  return `${prefix}-${String(num).padStart(4, "0")}`;
}

function calculateTotals(lineItems, discountType, discountValue, taxRate) {
  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  let discount = 0;
  if (discountType === "percentage") {
    discount = subtotal * (discountValue / 100);
  } else if (discountType === "fixed") {
    discount = discountValue;
  }
  const taxableAmount = subtotal - discount;
  const taxAmount = taxableAmount * (taxRate / 100);
  const total = taxableAmount + taxAmount;
  return { subtotal, discount, taxAmount, total };
}

// Several Technician fields (skills, zones) are stored as comma-separated
// strings but exposed to clients as arrays. This normalizes either form.
function csvToArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function paginate(page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;
  return { skip, take: limitNum, page: pageNum, limit: limitNum };
}

function paginatedResponse(data, total, page, limit) {
  return {
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  generateNumber,
  calculateTotals,
  csvToArray,
  paginate,
  paginatedResponse,
};
