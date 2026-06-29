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
    { value: "scheduled", label: "Scheduled", color: "bg-indigo-100 text-indigo-800" },
    { value: "dispatched", label: "Dispatched", color: "bg-purple-100 text-purple-800" },
    { value: "in_progress", label: "In Progress", color: "bg-yellow-100 text-yellow-800" },
    { value: "on_hold", label: "On Hold", color: "bg-orange-100 text-orange-800" },
    { value: "completed", label: "Completed", color: "bg-green-100 text-green-800" },
    { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-800" },
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
    { value: "assigned", label: "Assigned", color: "bg-blue-100 text-blue-800" },
    { value: "en_route", label: "En Route", color: "bg-indigo-100 text-indigo-800" },
    { value: "arrived", label: "Arrived", color: "bg-yellow-100 text-yellow-800" },
    { value: "completed", label: "Completed", color: "bg-green-100 text-green-800" },
  ],
  estimateStatus: [
    { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-800" },
    { value: "sent", label: "Sent", color: "bg-blue-100 text-blue-800" },
    { value: "viewed", label: "Viewed", color: "bg-indigo-100 text-indigo-800" },
    { value: "approved", label: "Approved", color: "bg-green-100 text-green-800" },
    { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
    { value: "expired", label: "Expired", color: "bg-orange-100 text-orange-800" },
  ],
  invoiceStatus: [
    { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-800" },
    { value: "sent", label: "Sent", color: "bg-blue-100 text-blue-800" },
    { value: "viewed", label: "Viewed", color: "bg-indigo-100 text-indigo-800" },
    { value: "partial", label: "Partial", color: "bg-yellow-100 text-yellow-800" },
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
    { value: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
    { value: "completed", label: "Completed", color: "bg-green-100 text-green-800" },
    { value: "failed", label: "Failed", color: "bg-red-100 text-red-800" },
    { value: "refunded", label: "Refunded", color: "bg-gray-100 text-gray-800" },
  ],
  userRole: [
    { value: "admin", label: "Administrator" },
    { value: "manager", label: "Manager" },
    { value: "dispatcher", label: "Dispatcher" },
    { value: "csr", label: "Customer Service Rep" },
    { value: "technician", label: "Technician" },
  ],
  customerType: [
    { value: "residential", label: "Residential" },
    { value: "commercial", label: "Commercial" },
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
  ],
  discountType: [
    { value: "percentage", label: "Percentage (%)" },
    { value: "fixed", label: "Fixed Amount" },
  ],
  agreementStatus: [
    { value: "active", label: "Active", color: "bg-green-100 text-green-800" },
    { value: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
    { value: "expired", label: "Expired", color: "bg-orange-100 text-orange-800" },
    { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-800" },
  ],
  billingFrequency: [
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "semi_annual", label: "Semi-Annual" },
    { value: "annual", label: "Annual" },
  ],
  agreementVisitStatus: [
    { value: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
    { value: "scheduled", label: "Scheduled", color: "bg-indigo-100 text-indigo-800" },
    { value: "completed", label: "Completed", color: "bg-green-100 text-green-800" },
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
    { value: "paused", label: "Paused", color: "bg-yellow-100 text-yellow-800" },
    { value: "completed", label: "Completed", color: "bg-gray-100 text-gray-800" },
  ],
  callDirection: [
    { value: "inbound", label: "Inbound" },
    { value: "outbound", label: "Outbound" },
  ],
  callStatus: [
    { value: "completed", label: "Completed", color: "bg-green-100 text-green-800" },
    { value: "missed", label: "Missed", color: "bg-red-100 text-red-800" },
    { value: "voicemail", label: "Voicemail", color: "bg-yellow-100 text-yellow-800" },
  ],
  inventoryTransactionType: [
    { value: "purchase", label: "Purchase" },
    { value: "usage", label: "Usage" },
    { value: "adjustment", label: "Adjustment" },
    { value: "transfer", label: "Transfer" },
    { value: "return", label: "Return" },
  ],
  pricebookItemType: [
    { value: "service", label: "Service" },
    { value: "part", label: "Part" },
    { value: "material", label: "Material" },
    { value: "equipment", label: "Equipment" },
  ],
  notificationType: [
    { value: "info", label: "Info" },
    { value: "success", label: "Success" },
    { value: "warning", label: "Warning" },
    { value: "error", label: "Error" },
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
