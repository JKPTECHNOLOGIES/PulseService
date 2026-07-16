/**
 * SINGLE SOURCE OF TRUTH for every enumerated value in PulseService.
 *
 * These definitions are seeded into the `Lookup` table (see prisma/seed.js) and
 * served to the frontend from the database via `GET /api/v1/metadata`. Nothing
 * in the app should hardcode a status / type / role string or its display
 * color — read it from here (backend) or from the metadata endpoint (frontend).
 *
 * Each entry: { value, label, color?, sortOrder (implicit by array order) }
 * `color` holds the Tailwind utility classes used by status badges so the UI
 * styling is data-driven too.
 */

const LOOKUPS = {
  jobStatus: [
    { value: "new", label: "New", color: "bg-blue-100 text-blue-800" },
    {
      value: "scheduled",
      label: "Scheduled",
      color: "bg-indigo-100 text-indigo-800",
    },
    {
      value: "parts_on_hold",
      label: "Parts On Hold",
      color: "bg-purple-100 text-purple-800",
    },
    {
      value: "in_progress",
      label: "In Progress",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "on_hold",
      label: "On Hold",
      color: "bg-orange-100 text-orange-800",
    },
    {
      value: "completed",
      label: "Completed",
      color: "bg-green-100 text-green-800",
    },
    {
      value: "cancelled",
      label: "Cancelled",
      color: "bg-red-100 text-red-800",
    },
  ],
  jobPriority: [
    { value: "low", label: "Low", color: "bg-gray-100 text-gray-800" },
    { value: "normal", label: "Normal", color: "bg-blue-100 text-blue-800" },
    { value: "high", label: "High", color: "bg-orange-100 text-orange-800" },
    { value: "urgent", label: "Urgent", color: "bg-red-100 text-red-800" },
  ],
  jobType: [
    { value: "service", label: "Service" },
    { value: "installation", label: "Installation" },
    { value: "maintenance", label: "Maintenance" },
    { value: "inspection", label: "Inspection" },
    { value: "repair", label: "Repair" },
    { value: "emergency", label: "Emergency" },
  ],
  jobTechnicianStatus: [
    {
      value: "assigned",
      label: "Assigned",
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "en_route",
      label: "En Route",
      color: "bg-indigo-100 text-indigo-800",
    },
    {
      value: "arrived",
      label: "Arrived",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "completed",
      label: "Completed",
      color: "bg-green-100 text-green-800",
    },
  ],
  estimateStatus: [
    { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-800" },
    { value: "sent", label: "Sent", color: "bg-blue-100 text-blue-800" },
    {
      value: "viewed",
      label: "Viewed",
      color: "bg-indigo-100 text-indigo-800",
    },
    {
      value: "approved",
      label: "Approved",
      color: "bg-green-100 text-green-800",
    },
    { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
    {
      value: "expired",
      label: "Expired",
      color: "bg-orange-100 text-orange-800",
    },
  ],
  invoiceStatus: [
    { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-800" },
    { value: "sent", label: "Sent", color: "bg-blue-100 text-blue-800" },
    {
      value: "viewed",
      label: "Viewed",
      color: "bg-indigo-100 text-indigo-800",
    },
    {
      value: "partial",
      label: "Partial",
      color: "bg-yellow-100 text-yellow-800",
    },
    { value: "paid", label: "Paid", color: "bg-green-100 text-green-800" },
    { value: "overdue", label: "Overdue", color: "bg-red-100 text-red-800" },
    { value: "void", label: "Void", color: "bg-gray-100 text-gray-500" },
  ],
  paymentMethod: [
    { value: "cash", label: "Cash" },
    { value: "check", label: "Check" },
    { value: "card", label: "Credit / Debit Card" },
    { value: "ach", label: "ACH / Bank Transfer" },
    { value: "other", label: "Other" },
  ],
  paymentStatus: [
    {
      value: "pending",
      label: "Pending",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "completed",
      label: "Completed",
      color: "bg-green-100 text-green-800",
    },
    { value: "failed", label: "Failed", color: "bg-red-100 text-red-800" },
    {
      value: "refunded",
      label: "Refunded",
      color: "bg-gray-100 text-gray-800",
    },
    {
      // Distinct from an actual processor refund: this is a bookkeeping
      // correction (recorded in error, or unwound to void the invoice) where
      // no money necessarily moved. Kept separate so "Refunded" on a Payments
      // list / bank reconciliation always means money genuinely went back to
      // the customer.
      value: "reversed",
      label: "Reversed",
      color: "bg-gray-100 text-gray-600",
    },
  ],
  // "manager" and "csr" are retired for now (2026-07) -- this client doesn't
  // use them. Not deleted from the codebase, just no longer offered: removing
  // them here prunes them from the Lookup table (see sync-lookups.js) and the
  // role dropdown/Roles & Permissions editor, without touching any existing
  // user who happens to still have that role string.
  userRole: [
    { value: "admin", label: "Administrator" },
    { value: "exec", label: "Executive" },
    { value: "technician", label: "Technician" },
  ],
  customerType: [
    {
      value: "residential",
      label: "Residential",
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "commercial",
      label: "Commercial",
      color: "bg-red-100 text-red-800",
    },
  ],
  locationType: [
    { value: "service", label: "Service" },
    { value: "billing", label: "Billing" },
  ],
  lineItemType: [
    { value: "service", label: "Service" },
    { value: "part", label: "Part" },
    { value: "material", label: "Material" },
    { value: "labor", label: "Labor" },
    { value: "equipment", label: "Equipment" },
    { value: "fee", label: "Fee" },
    // Not a real invoice line-item type — a pseudo-category so an invoice-level
    // discount can be mapped to a QuickBooks Item the same way as any other
    // QuickBooksItemMapping category (see item-mapping.service.js).
    { value: "discount", label: "Discount (QuickBooks mapping only)" },
  ],
  discountType: [
    { value: "percentage", label: "Percentage (%)" },
    { value: "fixed", label: "Fixed Amount" },
  ],
  agreementStatus: [
    { value: "active", label: "Active", color: "bg-green-100 text-green-800" },
    {
      value: "pending",
      label: "Pending",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "expired",
      label: "Expired",
      color: "bg-orange-100 text-orange-800",
    },
    {
      value: "cancelled",
      label: "Cancelled",
      color: "bg-red-100 text-red-800",
    },
  ],
  billingFrequency: [
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "semi_annual", label: "Semi-Annual" },
    { value: "annual", label: "Annual" },
  ],
  agreementVisitStatus: [
    {
      value: "pending",
      label: "Pending",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "scheduled",
      label: "Scheduled",
      color: "bg-indigo-100 text-indigo-800",
    },
    {
      value: "completed",
      label: "Completed",
      color: "bg-green-100 text-green-800",
    },
    { value: "skipped", label: "Skipped", color: "bg-gray-100 text-gray-800" },
  ],
  campaignType: [
    { value: "google", label: "Google Ads" },
    { value: "facebook", label: "Facebook" },
    { value: "referral", label: "Referral" },
    { value: "direct_mail", label: "Direct Mail" },
    { value: "email", label: "Email" },
    { value: "other", label: "Other" },
  ],
  campaignStatus: [
    { value: "active", label: "Active", color: "bg-green-100 text-green-800" },
    {
      value: "paused",
      label: "Paused",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "completed",
      label: "Completed",
      color: "bg-gray-100 text-gray-800",
    },
  ],
  callDirection: [
    { value: "inbound", label: "Inbound" },
    { value: "outbound", label: "Outbound" },
  ],
  callStatus: [
    {
      value: "completed",
      label: "Completed",
      color: "bg-green-100 text-green-800",
    },
    { value: "missed", label: "Missed", color: "bg-red-100 text-red-800" },
    {
      value: "voicemail",
      label: "Voicemail",
      color: "bg-yellow-100 text-yellow-800",
    },
  ],
  inventoryTransactionType: [
    { value: "receipt", label: "Receipt" },
    { value: "issue", label: "Issue" },
    { value: "transfer_out", label: "Transfer Out" },
    { value: "transfer_in", label: "Transfer In" },
    { value: "adjustment", label: "Adjustment" },
    { value: "count", label: "Cycle Count" },
    { value: "reversal", label: "Reversal" },
  ],
  stockLocationType: [
    {
      value: "warehouse",
      label: "Warehouse",
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "truck",
      label: "Truck",
      color: "bg-green-100 text-green-800",
    },
  ],
  poStatus: [
    { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-800" },
    {
      value: "ordered",
      label: "Ordered",
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "partially_received",
      label: "Partially Received",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "received",
      label: "Received",
      color: "bg-green-100 text-green-800",
    },
    { value: "closed", label: "Closed", color: "bg-gray-100 text-gray-500" },
    {
      value: "cancelled",
      label: "Cancelled",
      color: "bg-red-100 text-red-800",
    },
  ],
  poLineType: [
    { value: "inventory", label: "Inventory" },
    { value: "non_stock", label: "Non-Stock" },
  ],
  poLineStatus: [
    { value: "open", label: "Open", color: "bg-blue-100 text-blue-800" },
    {
      value: "cancelled",
      label: "Cancelled",
      color: "bg-red-100 text-red-800",
    },
  ],
  receiptStatus: [
    {
      value: "active",
      label: "Active",
      color: "bg-green-100 text-green-800",
    },
    {
      value: "reversed",
      label: "Reversed",
      color: "bg-orange-100 text-orange-800",
    },
    { value: "voided", label: "Voided", color: "bg-gray-100 text-gray-500" },
  ],
  serializedUnitStatus: [
    {
      value: "in_stock",
      label: "In Stock",
      color: "bg-blue-100 text-blue-800",
    },
    {
      value: "reserved",
      label: "Reserved",
      color: "bg-yellow-100 text-yellow-800",
    },
    {
      value: "installed",
      label: "Installed",
      color: "bg-green-100 text-green-800",
    },
    {
      value: "returned",
      label: "Returned",
      color: "bg-gray-100 text-gray-800",
    },
    {
      value: "scrapped",
      label: "Scrapped",
      color: "bg-red-100 text-red-800",
    },
    {
      value: "in_repair",
      label: "In Repair",
      color: "bg-orange-100 text-orange-800",
    },
  ],
  costChangeSource: [
    { value: "receipt", label: "Receipt (WAC)" },
    { value: "manual", label: "Manual Adjustment" },
    { value: "count_adjustment", label: "Count Adjustment" },
  ],
  pricebookItemType: [
    { value: "service", label: "Service" },
    { value: "part", label: "Part" },
    { value: "material", label: "Material" },
    { value: "labor", label: "Labor" },
    { value: "equipment", label: "Equipment" },
  ],
  notificationType: [
    { value: "info", label: "Info" },
    { value: "success", label: "Success" },
    { value: "warning", label: "Warning" },
    { value: "error", label: "Error" },
  ],
  equipmentType: [
    { value: "hvac", label: "HVAC System" },
    { value: "ac_unit", label: "AC Unit" },
    { value: "heat_pump", label: "Heat Pump" },
    { value: "furnace", label: "Furnace" },
    { value: "boiler", label: "Boiler" },
    { value: "water_heater", label: "Water Heater" },
    { value: "thermostat", label: "Thermostat" },
  ],
  equipmentCondition: [
    {
      value: "excellent",
      label: "Excellent",
      color: "bg-green-100 text-green-800",
    },
    { value: "good", label: "Good", color: "bg-blue-100 text-blue-800" },
    { value: "fair", label: "Fair", color: "bg-yellow-100 text-yellow-800" },
    { value: "poor", label: "Poor", color: "bg-orange-100 text-orange-800" },
    {
      value: "needs_replacement",
      label: "Needs Replacement",
      color: "bg-red-100 text-red-800",
    },
  ],
  businessUnitType: [
    { value: "hvac", label: "HVAC" },
    { value: "plumbing", label: "Plumbing" },
    { value: "electrical", label: "Electrical" },
    { value: "general", label: "General" },
  ],
  messageDirection: [
    { value: "outbound", label: "Outbound" },
    { value: "inbound", label: "Inbound" },
  ],
  messageChannel: [
    { value: "sms", label: "Text (SMS)" },
    { value: "email", label: "Email" },
    { value: "other", label: "Other" },
  ],
  pricingOverrideType: [
    { value: "percentage", label: "Percentage Off" },
    { value: "fixed", label: "Fixed Amount Off" },
    { value: "fixed_price", label: "Fixed Price" },
  ],
  quickbooksEntityType: [
    { value: "customer", label: "Customer" },
    { value: "invoice", label: "Invoice" },
    { value: "payment", label: "Payment" },
  ],
  quickbooksSyncOperation: [
    { value: "add", label: "Add" },
    { value: "update", label: "Update" },
    { value: "void", label: "Void" },
  ],
  quickbooksSyncStatus: [
    {
      value: "pending",
      label: "Pending",
      color: "bg-gray-100 text-gray-800",
    },
    { value: "sent", label: "Sent", color: "bg-blue-100 text-blue-800" },
    {
      value: "synced",
      label: "Synced",
      color: "bg-green-100 text-green-800",
    },
    { value: "error", label: "Error", color: "bg-red-100 text-red-800" },
  ],
};

/** Array of all category keys. */
const LOOKUP_CATEGORIES = Object.keys(LOOKUPS);

/** Returns just the allowed values for a category (handy for validation). */
function valuesFor(category) {
  return (LOOKUPS[category] || []).map((entry) => entry.value);
}

/** True if `value` is a valid entry within `category`. */
function isValidLookup(category, value) {
  return valuesFor(category).includes(value);
}

module.exports = {
  LOOKUPS,
  LOOKUP_CATEGORIES,
  valuesFor,
  isValidLookup,
};
