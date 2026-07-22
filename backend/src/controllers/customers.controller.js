const prisma = require("../config/database");
const {
  paginate,
  paginatedResponse,
  generateNumber,
} = require("../utils/helpers");
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

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, type, letter } = req.query;
    const { skip, take } = paginate(page, limit);

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

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        include: {
          _count: { select: { jobs: true } },
          locations: { where: { isPrimary: true }, take: 1 },
        },
        // Alphabetical by first name to match the "Customer" column's sort.
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      prisma.customer.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(customers, total, page, limit),
    });
  } catch (err) {
    console.error("customers.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
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

const create = async (req, res) => {
  try {
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
