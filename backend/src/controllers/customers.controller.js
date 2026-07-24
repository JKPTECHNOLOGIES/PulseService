const prisma = require("../config/database");
const { paginatedResponse, generateNumber } = require("../utils/helpers");
const { geocode } = require("../services/geocode.service");
const quickbooksSync = require("../services/quickbooks/sync-queue.service");

// Never let a QuickBooks sync hiccup break the customer API.
async function enqueueQuickBooksSync(customerId) {
  try {
    await quickbooksSync.enqueueSync("customer", customerId);
  } catch (err) {
    console.error("quickbooks enqueueSync error:", err);
  }
}

// Per-row sort value for each sortable column -- shared by the real DB sort
// key names the frontend sends. Used against plain customer objects (either
// a row itself, or -- for a secondary -- its primary, so a whole FieldEdge
// "multiple customers under one primary" cluster sorts as a unit; see list()).
const CUSTOMER_SORT_VALUE = {
  name: (c) => `${c.firstName} ${c.lastName}`.toLowerCase(),
  type: (c) => c.type,
  email: (c) => (c.email ?? "").toLowerCase(),
  created: (c) => new Date(c.createdAt).getTime(),
  balance: (c) => c.balance,
};

function compareValues(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const list = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      letter,
      sortKey,
      sortDir,
    } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const dir = sortDir === "asc" ? 1 : -1;
    const getSortValue = CUSTOMER_SORT_VALUE[sortKey] ?? CUSTOMER_SORT_VALUE.name;

    const where = { isActive: true };
    if (type) where.type = type;
    // Powers the A-Z index on the customer list: filters to first names
    // starting with the given letter (matches the list's default sort).
    if (letter) where.firstName = { startsWith: letter, mode: "insensitive" };
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { mobilePhone: { contains: search, mode: "insensitive" } },
        { companyName: { contains: search, mode: "insensitive" } },
        { customerNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    // Every matching row is fetched (not paginated at the DB level) so a
    // FieldEdge "multiple customers under one primary" cluster -- a primary
    // plus all its secondaries -- always lands together, sorted as a unit by
    // the primary's value, regardless of where it would otherwise fall across
    // a page boundary. Customer counts here are small enough (low hundreds)
    // that this is cheap; revisit if that changes by orders of magnitude.
    const all = await prisma.customer.findMany({
      where,
      include: {
        _count: { select: { jobs: true, subCustomers: true } },
        locations: { where: { isPrimary: true }, take: 1 },
      },
    });

    const byId = new Map(all.map((c) => [c.id, c]));

    // A secondary can match the filters while its primary doesn't (e.g.
    // searching for one HOA member's name) -- fetch just the missing
    // primaries' names so the "Part of X" subtitle still renders correctly.
    // These don't affect clustering/sort/pagination, only display.
    const missingPrimaryIds = [
      ...new Set(
        all
          .filter((c) => c.primaryCustomerId && !byId.has(c.primaryCustomerId))
          .map((c) => c.primaryCustomerId),
      ),
    ];
    const missingPrimaries =
      missingPrimaryIds.length > 0
        ? await prisma.customer.findMany({
            where: { id: { in: missingPrimaryIds } },
            select: customerLinkSelect,
          })
        : [];
    const primaryDisplayById = new Map([
      ...all.map((c) => [c.id, c]),
      ...missingPrimaries.map((c) => [c.id, c]),
    ]);

    // The row whose value actually determines where a cluster sorts: the
    // primary's, if this row has one and it's part of the fetched set;
    // otherwise the row's own value.
    const sortSource = (c) => (c.primaryCustomerId && byId.get(c.primaryCustomerId)) || c;

    const sorted = [...all].sort((a, b) => {
      const cmp = compareValues(getSortValue(sortSource(a)), getSortValue(sortSource(b)));
      if (cmp !== 0) return cmp * dir;
      // Tied (same cluster, or coincidentally equal values): the primary row
      // always comes first, then secondaries sorted alphabetically among
      // themselves so a cluster's internal order is stable and predictable.
      const aIsPrimary = !a.primaryCustomerId;
      const bIsPrimary = !b.primaryCustomerId;
      if (aIsPrimary !== bIsPrimary) return aIsPrimary ? -1 : 1;
      if (!aIsPrimary && !bIsPrimary) {
        return compareValues(CUSTOMER_SORT_VALUE.name(a), CUSTOMER_SORT_VALUE.name(b));
      }
      return 0;
    });

    const total = sorted.length;
    const startIdx = (pageNum - 1) * limitNum;
    const pageRows = sorted.slice(startIdx, startIdx + limitNum);

    const data = pageRows.map((c) => {
      const primary = c.primaryCustomerId
        ? primaryDisplayById.get(c.primaryCustomerId)
        : null;
      return {
        ...c,
        primaryCustomer: primary
          ? {
              id: primary.id,
              customerNumber: primary.customerNumber,
              firstName: primary.firstName,
              lastName: primary.lastName,
              companyName: primary.companyName,
              type: primary.type,
              email: primary.email,
              createdAt: primary.createdAt,
              balance: primary.balance,
            }
          : null,
      };
    });

    return res.json({
      success: true,
      ...paginatedResponse(data, total, pageNum, limitNum),
    });
  } catch (err) {
    console.error("customers.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Shared select for the lightweight primary/secondary cross-links --
// deliberately small (no jobs/invoices/etc.) since this is only ever used to
// render a name + link, never a full customer record.
const customerLinkSelect = {
  id: true,
  customerNumber: true,
  firstName: true,
  lastName: true,
  companyName: true,
  // Included so the customer list can determine a secondary's cluster sort
  // position from its primary's values without a second round-trip.
  type: true,
  email: true,
  createdAt: true,
  balance: true,
};

const get = async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        primaryCustomer: { select: customerLinkSelect },
        subCustomers: {
          select: customerLinkSelect,
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        },
        locations: { orderBy: { isPrimary: "desc" } },
        contacts: { orderBy: { isPrimary: "desc" } },
        pricingTier: {
          select: {
            id: true,
            name: true,
            discountType: true,
            discountValue: true,
          },
        },
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            technicians: {
              include: {
                technician: {
                  include: {
                    user: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
          },
        },
        invoices: { orderBy: { createdAt: "desc" }, take: 5 },
        serviceAgreements: { where: { status: "active" }, take: 3 },
      },
    });

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }
    return res.json({ success: true, data: customer });
  } catch (err) {
    console.error("customers.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// FieldEdge "multiple customers under one primary": a secondary just points
// at its primary via primaryCustomerId, no data is merged. Keeps the
// relationship to one level -- a primary can't itself be someone else's
// secondary, and a customer can't be set as its own primary.
async function validatePrimaryCustomerId(primaryCustomerId, selfId) {
  if (!primaryCustomerId) return null;
  if (primaryCustomerId === selfId) {
    return "A customer can't be its own primary customer";
  }
  const target = await prisma.customer.findUnique({
    where: { id: primaryCustomerId },
    select: { id: true, primaryCustomerId: true },
  });
  if (!target) return "Primary customer not found";
  if (target.primaryCustomerId) {
    return "That customer is itself a secondary of another primary -- only one level of linking is supported";
  }
  if (selfId) {
    const hasSubCustomers = await prisma.customer.count({
      where: { primaryCustomerId: selfId },
    });
    if (hasSubCustomers > 0) {
      return "This customer already has its own linked secondary customers -- it can't also become a secondary";
    }
  }
  return null;
}

const create = async (req, res) => {
  try {
    if (req.body.primaryCustomerId) {
      const error = await validatePrimaryCustomerId(
        req.body.primaryCustomerId,
        null,
      );
      if (error) return res.status(400).json({ success: false, error });
    }

    const settings = await prisma.companySettings.findFirst();
    if (!settings) {
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });
    }

    const customerNumber = generateNumber(
      settings.customerPrefix,
      settings.nextCustomerNumber,
    );
    await prisma.companySettings.updateMany({
      data: { nextCustomerNumber: { increment: 1 } },
    });

    const { locations, contacts, ...customerData } = req.body;

    const customer = await prisma.customer.create({
      data: {
        ...customerData,
        customerNumber,
        ...(locations && {
          locations: { create: locations },
        }),
        ...(contacts && {
          contacts: { create: contacts },
        }),
      },
      include: { locations: true, contacts: true },
    });

    await enqueueQuickBooksSync(customer.id);
    return res.status(201).json({ success: true, data: customer });
  } catch (err) {
    console.error("customers.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Sync a customer's Location rows so the primary address plus any number of
// additional labeled addresses can all be edited from one form. Rows with an
// id that already belongs to this customer are updated in place (so jobs,
// equipment, etc. that reference a location keep pointing at it); rows
// without an id are created; any existing row no longer present in the
// incoming list is removed. The first entry in the list is always treated as
// the primary address.
async function syncLocations(tx, customerId, locations) {
  if (!Array.isArray(locations)) return;

  const existing = await tx.location.findMany({
    where: { customerId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((l) => l.id));
  const keepIds = new Set();

  for (let i = 0; i < locations.length; i++) {
    const {
      id,
      customerId: _cid,
      createdAt: _ca,
      updatedAt: _ua,
      ...rest
    } = locations[i];
    const data = { ...rest, isPrimary: i === 0 };
    if (id && existingIds.has(id)) {
      keepIds.add(id);
      await tx.location.update({ where: { id }, data });
    } else {
      const created = await tx.location.create({
        data: { ...data, customerId },
      });
      keepIds.add(created.id);
    }
  }

  const toRemove = [...existingIds].filter((id) => !keepIds.has(id));
  if (toRemove.length > 0) {
    await tx.location.deleteMany({ where: { id: { in: toRemove } } });
  }
}

// Sync a customer's Contact rows the same way. Nothing else references
// Contact rows, so removed ones can simply be deleted.
async function syncContacts(tx, customerId, contacts) {
  if (!Array.isArray(contacts)) return;

  const existing = await tx.contact.findMany({
    where: { customerId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((c) => c.id));
  const keepIds = new Set();

  for (const contact of contacts) {
    const {
      id,
      customerId: _cid,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = contact;
    if (id && existingIds.has(id)) {
      keepIds.add(id);
      await tx.contact.update({ where: { id }, data });
    } else {
      const created = await tx.contact.create({
        data: { ...data, customerId },
      });
      keepIds.add(created.id);
    }
  }

  const toRemove = [...existingIds].filter((id) => !keepIds.has(id));
  if (toRemove.length > 0) {
    await tx.contact.deleteMany({ where: { id: { in: toRemove } } });
  }
}

const update = async (req, res) => {
  try {
    const {
      customerNumber: _cn,
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      locations,
      contacts,
      ...data
    } = req.body;

    if ("primaryCustomerId" in data && data.primaryCustomerId) {
      const error = await validatePrimaryCustomerId(
        data.primaryCustomerId,
        req.params.id,
      );
      if (error) return res.status(400).json({ success: false, error });
    }

    await prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: req.params.id }, data });
      await syncLocations(tx, req.params.id, locations);
      await syncContacts(tx, req.params.id, contacts);
    });

    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: { locations: true, contacts: true },
    });
    await enqueueQuickBooksSync(req.params.id);
    return res.json({ success: true, data: customer });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }
    console.error("customers.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const deleteCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    // Hard delete: remove the customer and every dependent record. Jobs,
    // estimates, invoices, payments and agreements use Restrict/SetNull rather
    // than Cascade, so we clear them explicitly in dependency order inside a
    // transaction. Contacts and locations cascade when the customer is removed.
    await prisma.$transaction(async (tx) => {
      const jobs = await tx.job.findMany({
        where: { customerId: id },
        select: { id: true },
      });
      const jobIds = jobs.map((j) => j.id);

      // Payments reference invoices (Restrict), so remove them first.
      await tx.payment.deleteMany({
        where: { OR: [{ customerId: id }, { invoice: { customerId: id } }] },
      });
      // Invoice/estimate line items cascade with their parent.
      await tx.invoice.deleteMany({ where: { customerId: id } });
      await tx.estimate.deleteMany({ where: { customerId: id } });

      if (jobIds.length > 0) {
        // TimeEntry.jobId is SetNull; remove them so no orphans remain.
        await tx.timeEntry.deleteMany({ where: { jobId: { in: jobIds } } });
      }
      // Job technicians and forms cascade with the job.
      await tx.job.deleteMany({ where: { customerId: id } });

      // Agreement visits cascade with the agreement.
      await tx.serviceAgreement.deleteMany({ where: { customerId: id } });
      await tx.call.deleteMany({ where: { customerId: id } });
      await tx.equipment.deleteMany({ where: { customerId: id } });

      // Contacts and locations cascade via the schema.
      await tx.customer.delete({ where: { id } });
    });
    return res.json({
      success: true,
      message: "Customer deleted successfully",
    });
  } catch (err) {
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }
    console.error("customers.delete error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getLocations = async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      where: { customerId: req.params.id },
      orderBy: { isPrimary: "desc" },
    });
    return res.json({ success: true, data: locations });
  } catch (err) {
    console.error("customers.getLocations error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const createLocation = async (req, res) => {
  try {
    const data = { ...req.body, customerId: req.params.id };
    // Fill coordinates from the address (best-effort) so the location can be
    // plotted on the map without the user entering lat/lng manually.
    if (
      (data.lat === null ||
        data.lat === undefined ||
        data.lng === null ||
        data.lng === undefined) &&
      data.address
    ) {
      const geo = await geocode(
        [data.address, data.city, data.state, data.zip]
          .filter(Boolean)
          .join(", "),
      );
      if (geo) {
        data.lat = geo.lat;
        data.lng = geo.lng;
      }
    }
    const location = await prisma.location.create({ data });
    return res.status(201).json({ success: true, data: location });
  } catch (err) {
    console.error("customers.createLocation error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getContacts = async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { customerId: req.params.id },
      orderBy: { isPrimary: "desc" },
    });
    return res.json({ success: true, data: contacts });
  } catch (err) {
    console.error("customers.getContacts error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const createContact = async (req, res) => {
  try {
    const contact = await prisma.contact.create({
      data: { ...req.body, customerId: req.params.id },
    });
    return res.status(201).json({ success: true, data: contact });
  } catch (err) {
    console.error("customers.createContact error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Bulk-create customers from parsed CSV rows. Each row needs at least a name
// and phone; customer numbers are auto-assigned sequentially. Returns per-row
// results so the UI can report which rows failed and why.
const importCustomers = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No rows to import" });
    }
    if (rows.length > 1000) {
      return res
        .status(400)
        .json({ success: false, error: "Import is limited to 1000 rows" });
    }

    const settings = await prisma.companySettings.findFirst();
    if (!settings) {
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });
    }

    let next = settings.nextCustomerNumber;
    let created = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const firstName = (r.firstName || "").trim();
      const lastName = (r.lastName || "").trim();
      const phone = (r.phone || "").trim();
      if (!firstName || !lastName || !phone) {
        errors.push({
          row: i + 1,
          error: "Missing first name, last name, or phone",
        });
        continue;
      }
      try {
        await prisma.customer.create({
          data: {
            customerNumber: generateNumber(settings.customerPrefix, next),
            firstName,
            lastName,
            phone,
            email: r.email?.trim() || null,
            mobilePhone: r.mobilePhone?.trim() || null,
            type: r.type?.trim() || "residential",
            companyName: r.companyName?.trim() || null,
            source: r.source?.trim() || null,
          },
        });
        next += 1;
        created += 1;
      } catch (e) {
        errors.push({ row: i + 1, error: e.message || "Failed to create" });
      }
    }

    if (created > 0) {
      await prisma.companySettings.update({
        where: { id: settings.id },
        data: { nextCustomerNumber: next },
      });
    }

    return res.json({
      success: true,
      data: { created, failed: errors.length, errors },
    });
  } catch (err) {
    console.error("customers.importCustomers error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  delete: deleteCustomer,
  importCustomers,
  getLocations,
  createLocation,
  getContacts,
  createContact,
};
