/**
 * SINGLE SOURCE OF TRUTH for permissions and the default permission set each
 * role starts with.
 *
 * Permissions are fine-grained capability keys (e.g. `invoices.void`) that gate
 * write / sensitive endpoints. Reads are generally left open to any
 * authenticated user, so only guarded actions appear here.
 *
 * The defaults below are seeded into the `RolePermission` table (see
 * prisma/seed.js). After seeding, an admin can freely re-map any role's
 * permissions from Settings → Roles & Permissions; this file only supplies the
 * initial state and the catalog the editor renders.
 */

// Grouped catalog — drives the permission-matrix UI.
const PERMISSION_GROUPS = [
  {
    group: "Users",
    permissions: [{ key: "users.manage", label: "Manage users & roles" }],
  },
  {
    group: "Customers",
    permissions: [
      { key: "customers.create", label: "Create customers" },
      { key: "customers.edit", label: "Edit customers" },
      { key: "customers.delete", label: "Delete customers" },
    ],
  },
  {
    group: "Jobs",
    permissions: [
      { key: "jobs.create", label: "Create jobs" },
      { key: "jobs.edit", label: "Edit jobs" },
      { key: "jobs.delete", label: "Delete jobs" },
      { key: "jobs.assign", label: "Assign technicians" },
      { key: "jobs.status", label: "Update job status" },
    ],
  },
  {
    group: "Dispatch",
    permissions: [
      { key: "dispatch.manage", label: "Reassign the dispatch board" },
    ],
  },
  {
    group: "Estimates",
    permissions: [
      { key: "estimates.manage", label: "Create & manage estimates" },
    ],
  },
  {
    group: "Invoices",
    permissions: [
      { key: "invoices.manage", label: "Create, edit, send & take payment" },
      { key: "invoices.void", label: "Void invoices" },
    ],
  },
  {
    group: "Payments",
    permissions: [{ key: "payments.view", label: "View payments" }],
  },
  {
    group: "Reports",
    permissions: [
      { key: "reports.financial", label: "View financial reports" },
      { key: "reports.operational", label: "View operational reports" },
    ],
  },
  {
    group: "Pricebook",
    permissions: [{ key: "pricebook.manage", label: "Manage the pricebook" }],
  },
  {
    group: "Inventory",
    permissions: [
      {
        key: "inventory.manage",
        label: "Manage items, adjust & transfer stock",
      },
    ],
  },
  {
    group: "Suppliers",
    permissions: [{ key: "suppliers.manage", label: "Manage suppliers" }],
  },
  {
    group: "Purchasing",
    permissions: [
      { key: "purchasing.manage", label: "Create & manage purchase orders" },
      { key: "purchasing.receive", label: "Receive goods against POs" },
    ],
  },
  {
    group: "Service Agreements",
    permissions: [
      { key: "agreements.manage", label: "Create & manage agreements" },
      { key: "agreements.visits", label: "Schedule & complete visits" },
    ],
  },
  {
    group: "Equipment",
    permissions: [{ key: "equipment.delete", label: "Delete equipment" }],
  },
  {
    group: "Marketing",
    permissions: [{ key: "calls.manage", label: "Log & manage calls" }],
  },
  {
    group: "Campaigns",
    permissions: [{ key: "campaigns.manage", label: "Manage campaigns" }],
  },
  {
    group: "Settings",
    permissions: [
      {
        key: "settings.manage",
        label: "Edit company settings & business units",
      },
    ],
  },
  {
    group: "Audit",
    permissions: [{ key: "audit.view", label: "View the activity log" }],
  },
];

// Flattened list of every permission key.
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
);

// Default permission set per role. `admin` always receives every permission.
const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  manager: [
    "customers.create",
    "customers.edit",
    "customers.delete",
    "jobs.create",
    "jobs.edit",
    "jobs.delete",
    "jobs.assign",
    "jobs.status",
    "dispatch.manage",
    "estimates.manage",
    "invoices.manage",
    "invoices.void",
    "payments.view",
    "reports.financial",
    "reports.operational",
    "pricebook.manage",
    "inventory.manage",
    "suppliers.manage",
    "purchasing.manage",
    "purchasing.receive",
    "agreements.manage",
    "agreements.visits",
    "equipment.delete",
    "calls.manage",
    "campaigns.manage",
    "settings.manage",
    "audit.view",
  ],
  dispatcher: [
    "customers.create",
    "customers.edit",
    "jobs.create",
    "jobs.edit",
    "jobs.assign",
    "jobs.status",
    "dispatch.manage",
    "estimates.manage",
    "invoices.manage",
    "payments.view",
    "reports.operational",
    "inventory.manage",
    "suppliers.manage",
    "purchasing.manage",
    "purchasing.receive",
    "agreements.manage",
    "agreements.visits",
    "calls.manage",
  ],
  csr: [
    "customers.create",
    "customers.edit",
    "jobs.create",
    "jobs.edit",
    "jobs.status",
    "estimates.manage",
    "invoices.manage",
    "payments.view",
    "agreements.manage",
    "calls.manage",
  ],
  technician: ["jobs.status"],
  exec: [
    "payments.view",
    "reports.financial",
    "reports.operational",
    "audit.view",
  ],
};

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
};
