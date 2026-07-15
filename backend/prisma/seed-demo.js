/**
 * Additive demo/showcase data seed.
 *
 * Runs ON TOP of the base seed (prisma/seed.js) to fully populate the app for
 * demos: extra staff (manager/exec + more technicians), ~30 customers, dozens
 * of jobs spread across past/today/future, estimates & invoices across every
 * status, ~12 months of completed payments (so the revenue chart & reports look
 * real), equipment, calls, campaigns, and service agreements.
 *
 * Safe to run once on an already-seeded DB. It self-guards against double-runs
 * by checking the customer count, so re-running is a no-op.
 *
 *   docker compose exec backend node prisma/seed-demo.js
 *   # or, with DATABASE_URL set locally:  node prisma/seed-demo.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

// ── helpers ───────────────────────────────────────────────────────────────
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const money = (n) => Math.round(n * 100) / 100;
const chance = (p) => Math.random() < p;

function dayAt(offsetDays, hour = rnd(7, 16), min = pick([0, 30])) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, min, 0, 0);
  return d;
}
function monthsAgo(m) {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  d.setDate(rnd(2, 27));
  d.setHours(rnd(9, 16), pick([0, 15, 30, 45]), 0, 0);
  return d;
}
function generateNumber(prefix, n) {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// ── sample content ──────────────────────────────────────────────────────────
const FIRST = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Barbara",
  "William",
  "Susan",
  "Richard",
  "Jessica",
  "Joseph",
  "Karen",
  "Thomas",
  "Sarah",
  "Chris",
  "Nancy",
  "Daniel",
  "Lisa",
  "Paul",
  "Betty",
  "Mark",
  "Sandra",
  "Kevin",
  "Ashley",
  "Brian",
  "Emily",
];
const LAST = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Clark",
  "Lewis",
  "Walker",
  "Hall",
  "Young",
];
const COMPANIES = [
  "Peachtree Property Mgmt",
  "Southern Retail Group",
  "Atlanta Medical Plaza",
  "Summit Office Park",
  "Georgia Grille Co",
  "Blue Ridge Logistics",
  "Piedmont Dental",
  "Marietta Auto Group",
  "Downtown Lofts LLC",
  "Sandy Springs Hotel",
  "Northside Fitness",
  "Riverbend Apartments",
];
const STREETS = [
  "Peachtree St",
  "Oak Dr",
  "Maple Ave",
  "Elm Drive",
  "Riverside Rd",
  "Highland Ave",
  "Sycamore Ln",
  "Piedmont Rd",
  "Roswell Rd",
  "Ponce De Leon Ave",
  "Cascade Rd",
  "Buford Hwy",
  "Cheshire Bridge Rd",
  "Clairmont Rd",
];
const CITIES = [
  ["Atlanta", "30303"],
  ["Marietta", "30060"],
  ["Roswell", "30076"],
  ["Decatur", "30030"],
  ["Sandy Springs", "30328"],
  ["Alpharetta", "30009"],
  ["Smyrna", "30080"],
  ["Duluth", "30096"],
];
const SOURCES = [
  "google",
  "facebook",
  "referral",
  "direct_mail",
  "email",
  "other",
];

const SERVICES = [
  { type: "service", name: "Diagnostic & inspection", price: 89 },
  { type: "service", name: "System tune-up", price: 149 },
  { type: "labor", name: "Labor (per hour)", price: 110 },
  { type: "service", name: "Drain cleaning", price: 175 },
  { type: "service", name: "Refrigerant recharge", price: 240 },
  { type: "service", name: "Thermostat installation", price: 195 },
  { type: "service", name: "Water heater flush", price: 129 },
];
const PARTS = [
  { type: "part", name: "Run capacitor 45/5 MFD", price: 42 },
  { type: "part", name: "Contactor 2-pole", price: 58 },
  { type: "part", name: "Blower motor", price: 320 },
  { type: "part", name: "Igniter", price: 65 },
  { type: "material", name: "Copper line set", price: 180 },
  { type: "part", name: "Condensate pump", price: 95 },
  { type: "equipment", name: "Programmable thermostat", price: 149 },
];
const JOB_SUMMARIES = [
  "No cooling — AC not responding",
  "Annual maintenance visit",
  "Water heater leaking",
  "Furnace won't ignite",
  "Thermostat replacement",
  "Clogged main drain line",
  "New system installation",
  "Refrigerant leak diagnosis",
  "Noisy blower motor",
  "Seasonal tune-up",
  "Emergency no-heat call",
  "Ductwork inspection",
];
const BUSINESS_UNITS = ["HVAC", "Plumbing", "Electrical"];
const EQUIP = [
  { type: "ac_unit", mfr: "Carrier", model: "24ACC6" },
  { type: "furnace", mfr: "Trane", model: "S9V2" },
  { type: "heat_pump", mfr: "Lennox", model: "XP25" },
  { type: "water_heater", mfr: "Rheem", model: "XE50" },
  { type: "thermostat", mfr: "Ecobee", model: "SmartThermostat" },
  { type: "boiler", mfr: "Weil-McLain", model: "CGa" },
];

function buildLineItems() {
  const count = rnd(1, 4);
  const items = [];
  for (let i = 0; i < count; i++) {
    const src = chance(0.6) ? pick(SERVICES) : pick(PARTS);
    const quantity = src.type === "labor" ? rnd(1, 4) : rnd(1, 2);
    items.push({
      type: src.type,
      name: src.name,
      description: "",
      quantity,
      unitPrice: src.price,
      total: money(src.price * quantity),
      sortOrder: i,
    });
  }
  const subtotal = money(items.reduce((s, it) => s + it.total, 0));
  // Tax is not charged on estimates or invoices.
  const total = subtotal;
  return { items, subtotal, taxAmount: 0, total };
}

async function main() {
  console.log("🎬 Loading demo showcase data...");

  const customerCount = await prisma.customer.count();
  if (customerCount > 12) {
    console.log(
      `  Demo data appears to already be loaded (${customerCount} customers). Skipping.`,
    );
    return;
  }

  const settings = await prisma.companySettings.findFirst();
  let nextCustomer = settings?.nextCustomerNumber ?? 100;
  let nextJob = settings?.nextJobNumber ?? 100;
  let nextEstimate = settings?.nextEstimateNumber ?? 100;
  let nextInvoice = settings?.nextInvoiceNumber ?? 100;
  const custPrefix = settings?.customerPrefix ?? "CUST";
  const jobPrefix = settings?.jobPrefix ?? "JOB";
  const estPrefix = settings?.estimatePrefix ?? "EST";
  const invPrefix = settings?.invoicePrefix ?? "INV";

  const passHash = await bcrypt.hash("pass123", 10);
  const admin =
    (await prisma.user.findFirst({ where: { role: "admin" } })) ??
    (await prisma.user.findFirst());
  const adminId = admin.id;

  // ── Staff: manager, exec, and two extra technicians ────────────────────────
  console.log("  Ensuring manager + exec accounts...");
  async function ensureUser(email, firstName, lastName, role, phone) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    return prisma.user.create({
      data: { email, password: passHash, firstName, lastName, role, phone },
    });
  }
  await ensureUser(
    "manager@primecomfortac.com",
    "Morgan",
    "Reed",
    "manager",
    "(404) 555-0010",
  );
  await ensureUser(
    "exec@primecomfortac.com",
    "Erin",
    "Vaughn",
    "exec",
    "(404) 555-0011",
  );

  console.log("  Adding technicians...");
  async function ensureTech(
    email,
    firstName,
    lastName,
    employeeId,
    skills,
    zones,
  ) {
    const existingTech = await prisma.technician.findUnique({
      where: { employeeId },
    });
    if (existingTech) return existingTech;
    const user = await ensureUser(
      email,
      firstName,
      lastName,
      "technician",
      `(404) 555-0${rnd(200, 299)}`,
    );
    return prisma.technician.create({
      data: {
        userId: user.id,
        employeeId,
        skills,
        zones,
        isAvailable: true,
        currentLat: 33.749 + (Math.random() - 0.5) * 0.2,
        currentLng: -84.388 + (Math.random() - 0.5) * 0.2,
      },
    });
  }
  await ensureTech(
    "tech4@primecomfortac.com",
    "Dana",
    "Wells",
    "EMP-004",
    "Electrical,Panels,Wiring",
    "North,East",
  );
  await ensureTech(
    "tech5@primecomfortac.com",
    "Sam",
    "Ortega",
    "EMP-005",
    "HVAC,Ductwork",
    "South,West",
  );

  const technicians = await prisma.technician.findMany();
  const techIds = technicians.map((t) => t.id);

  // ── Customers ───────────────────────────────────────────────────────────────
  console.log("  Creating customers...");
  const customers = [];
  for (let i = 0; i < 30; i++) {
    const isCommercial = chance(0.35);
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const [city, zip] = pick(CITIES);
    const num = nextCustomer++;
    const c = await prisma.customer.create({
      data: {
        customerNumber: generateNumber(custPrefix, num),
        firstName,
        lastName,
        email: `${firstName}.${lastName}${num}@example.com`.toLowerCase(),
        phone: `(770) 555-${String(rnd(1000, 9999))}`,
        mobilePhone: chance(0.5)
          ? `(678) 555-${String(rnd(1000, 9999))}`
          : null,
        type: isCommercial ? "commercial" : "residential",
        companyName: isCommercial ? pick(COMPANIES) : null,
        source: pick(SOURCES),
        creditLimit: isCommercial ? pick([5000, 10000, 25000]) : null,
        notes: "demo-seed",
        locations: {
          create: [
            {
              name: isCommercial ? "Main Site" : null,
              address: `${rnd(100, 9999)} ${pick(STREETS)}`,
              city,
              state: "GA",
              zip,
              isPrimary: true,
              type: "service",
              lat: 33.749 + (Math.random() - 0.5) * 0.6,
              lng: -84.388 + (Math.random() - 0.5) * 0.6,
            },
          ],
        },
        contacts: isCommercial
          ? {
              create: [
                {
                  firstName: pick(FIRST),
                  lastName,
                  email: `facilities${num}@example.com`,
                  phone: `(404) 555-${String(rnd(1000, 9999))}`,
                  isPrimary: true,
                  role: "Facilities Manager",
                },
              ],
            }
          : undefined,
      },
      include: { locations: true },
    });
    customers.push(c);
  }

  // ── Jobs (spread across time, all statuses) ─────────────────────────────────
  console.log("  Creating jobs...");
  const jobs = [];
  function statusForOffset(offset) {
    if (offset < -3)
      return pick(["completed", "completed", "completed", "cancelled"]);
    if (offset < 0) return pick(["completed", "in_progress", "on_hold"]);
    if (offset === 0) return pick(["scheduled", "parts_on_hold", "in_progress"]);
    return pick(["scheduled", "new", "scheduled"]);
  }
  for (let i = 0; i < 70; i++) {
    const offset = rnd(-45, 14);
    const customer = pick(customers);
    const loc = customer.locations[0];
    const status = statusForOffset(offset);
    const start = dayAt(offset);
    const end = new Date(start.getTime() + rnd(1, 4) * 60 * 60 * 1000);
    const done = status === "completed";
    const num = nextJob++;
    const assignedTechs = chance(0.85)
      ? [...new Set([pick(techIds), ...(chance(0.3) ? [pick(techIds)] : [])])]
      : [];
    const job = await prisma.job.create({
      data: {
        jobNumber: generateNumber(jobPrefix, num),
        customerId: customer.id,
        locationId: loc.id,
        type: pick([
          "service",
          "maintenance",
          "repair",
          "installation",
          "inspection",
          "emergency",
        ]),
        status,
        priority: pick(["low", "normal", "normal", "high", "urgent"]),
        summary: pick(JOB_SUMMARIES),
        description: "Auto-generated demo job.",
        scheduledStart: start,
        scheduledEnd: end,
        actualStart: done ? start : null,
        actualEnd: done ? end : null,
        completedAt: done ? end : null,
        completionNotes: done ? "Work completed and tested." : null,
        businessUnit: pick(BUSINESS_UNITS),
        createdById: adminId,
        technicians:
          assignedTechs.length > 0
            ? {
                create: assignedTechs.map((tid, idx) => ({
                  technicianId: tid,
                  isLead: idx === 0,
                  status: done ? "completed" : "assigned",
                })),
              }
            : undefined,
      },
    });
    jobs.push(job);
  }

  // ── Estimates (every status) ─────────────────────────────────────────────────
  console.log("  Creating estimates...");
  const estStatuses = [
    "draft",
    "sent",
    "viewed",
    "approved",
    "rejected",
    "expired",
  ];
  for (let i = 0; i < 28; i++) {
    const customer = pick(customers);
    const status = pick(estStatuses);
    const { items, subtotal, taxAmount, total } = buildLineItems();
    const created = monthsAgo(rnd(0, 4));
    const num = nextEstimate++;
    await prisma.estimate.create({
      data: {
        estimateNumber: generateNumber(estPrefix, num),
        customerId: customer.id,
        status,
        title: pick([
          "System replacement proposal",
          "Repair estimate",
          "Maintenance plan quote",
          "Upgrade proposal",
        ]),
        summary: "Prepared for your review.",
        validUntil: new Date(created.getTime() + 30 * 86400000),
        subtotal,
        discountType: "percentage",
        discountValue: 0,
        taxRate: 0,
        taxAmount,
        total,
        notes: "Thank you for the opportunity.",
        terms: "Valid for 30 days.",
        createdById: adminId,
        createdAt: created,
        sentAt: status === "draft" ? null : created,
        approvedAt:
          status === "approved"
            ? new Date(created.getTime() + 2 * 86400000)
            : null,
        rejectedAt:
          status === "rejected"
            ? new Date(created.getTime() + 3 * 86400000)
            : null,
        rejectionReason:
          status === "rejected" ? "Went with another vendor." : null,
        lineItems: { create: items },
      },
    });
  }

  // ── Invoices + payments (12 months of revenue) ──────────────────────────────
  console.log("  Creating invoices and payments...");
  async function makeInvoice({ customer, status, created, dueOffsetDays }) {
    const { items, subtotal, taxAmount, total } = buildLineItems();
    const num = nextInvoice++;
    const dueDate = new Date(
      created.getTime() + (dueOffsetDays ?? 30) * 86400000,
    );
    let amountPaid = 0;
    let paidAt = null;
    if (status === "paid") {
      amountPaid = total;
      paidAt = new Date(created.getTime() + rnd(1, 20) * 86400000);
    } else if (status === "partial") {
      amountPaid = money(total / 2);
    }
    const balance = money(total - amountPaid);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: generateNumber(invPrefix, num),
        customerId: customer.id,
        status,
        dueDate,
        subtotal,
        taxRate: 0,
        taxAmount,
        total,
        amountPaid,
        balance,
        paidAt,
        sentAt: status === "draft" ? null : created,
        createdById: adminId,
        createdAt: created,
        lineItems: { create: items },
      },
    });
    if (amountPaid > 0) {
      const payAt =
        paidAt ?? new Date(created.getTime() + rnd(2, 15) * 86400000);
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          customerId: customer.id,
          amount: amountPaid,
          method: pick(["cash", "check", "card", "ach"]),
          status: "completed",
          referenceNumber: chance(0.5) ? `REF-${rnd(10000, 99999)}` : null,
          paidAt: payAt,
          createdAt: payAt,
        },
      });
    }
    return invoice;
  }

  // Months 1..11 ago: paid invoices to fill the revenue chart.
  for (let m = 11; m >= 1; m--) {
    const perMonth = rnd(2, 4);
    for (let k = 0; k < perMonth; k++) {
      await makeInvoice({
        customer: pick(customers),
        status: "paid",
        created: monthsAgo(m),
      });
    }
  }
  // Current month: a realistic mix of open/paid/overdue/draft.
  const currentMix = [
    "paid",
    "paid",
    "sent",
    "sent",
    "partial",
    "overdue",
    "overdue",
    "draft",
  ];
  for (const status of currentMix) {
    const created =
      status === "overdue" ? dayAt(-rnd(35, 60)) : dayAt(-rnd(0, 20));
    await makeInvoice({
      customer: pick(customers),
      status,
      created,
      dueOffsetDays: status === "overdue" ? 15 : 30,
    });
  }

  // ── Equipment ────────────────────────────────────────────────────────────────
  console.log("  Creating equipment...");
  for (let i = 0; i < 22; i++) {
    const customer = pick(customers);
    const spec = pick(EQUIP);
    const install = monthsAgo(rnd(6, 120));
    await prisma.equipment.create({
      data: {
        customerId: customer.id,
        locationId: customer.locations[0].id,
        name: `${spec.mfr} ${spec.model}`,
        type: spec.type,
        manufacturer: spec.mfr,
        model: spec.model,
        serialNumber: `SN-${rnd(100000, 999999)}`,
        installDate: install,
        warrantyExpiry: new Date(install.getTime() + 10 * 365 * 86400000),
        condition: pick(["excellent", "good", "good", "fair", "poor"]),
        notes: null,
      },
    });
  }

  // ── Calls ────────────────────────────────────────────────────────────────────
  console.log("  Creating call logs...");
  const csr = await prisma.user.findFirst({ where: { role: "csr" } });
  for (let i = 0; i < 30; i++) {
    const inbound = chance(0.7);
    const customer = chance(0.8) ? pick(customers) : null;
    await prisma.call.create({
      data: {
        customerId: customer?.id ?? null,
        direction: inbound ? "inbound" : "outbound",
        status: pick(["completed", "completed", "missed", "voicemail"]),
        fromNumber: inbound ? `(770) 555-${rnd(1000, 9999)}` : "(404) 555-0100",
        toNumber: inbound ? "(404) 555-0100" : `(770) 555-${rnd(1000, 9999)}`,
        duration: rnd(0, 15) * 60 + rnd(0, 59),
        reason: pick([
          "Booking request",
          "Billing question",
          "Service follow-up",
          "New quote",
          "Reschedule",
        ]),
        handledById: csr?.id ?? adminId,
        createdAt: dayAt(-rnd(0, 21)),
      },
    });
  }

  // ── Campaigns ────────────────────────────────────────────────────────────────
  console.log("  Creating campaigns...");
  const campaigns = [
    {
      name: "Spring AC Tune-Up",
      type: "email",
      status: "active",
      budget: 2500,
    },
    {
      name: "Google — Emergency HVAC",
      type: "google",
      status: "active",
      budget: 6000,
    },
    {
      name: "Neighborhood Direct Mail",
      type: "direct_mail",
      status: "paused",
      budget: 1800,
    },
    {
      name: "Winter Furnace Check",
      type: "facebook",
      status: "completed",
      budget: 3200,
    },
    {
      name: "Customer Referral Program",
      type: "referral",
      status: "active",
      budget: 1000,
    },
  ];
  for (const c of campaigns) {
    await prisma.campaign.create({
      data: {
        ...c,
        startDate: monthsAgo(rnd(1, 6)),
        endDate: chance(0.5) ? dayAt(rnd(20, 90)) : null,
        trackingNumber: `(800) 555-${rnd(1000, 9999)}`,
        notes: null,
      },
    });
  }

  // ── Service agreements ───────────────────────────────────────────────────────
  console.log("  Creating service agreements...");
  let nextAgreement = 100;
  for (let i = 0; i < 8; i++) {
    const customer = pick(customers);
    const start = monthsAgo(rnd(1, 10));
    const freq = pick(["monthly", "quarterly", "semi_annual", "annual"]);
    await prisma.serviceAgreement.create({
      data: {
        agreementNumber: `AGR-${String(nextAgreement++).padStart(4, "0")}`,
        customerId: customer.id,
        name: pick([
          "Comfort Club Membership",
          "Preventive Maintenance Plan",
          "Priority Service Agreement",
        ]),
        status: pick(["active", "active", "pending", "expired"]),
        startDate: start,
        endDate: new Date(start.getTime() + 365 * 86400000),
        billingFrequency: freq,
        amount: pick([19.99, 29.99, 49.99, 199, 299]),
        autoRenew: chance(0.7),
        terms: "Includes seasonal tune-ups and priority scheduling.",
        nextBillingDate: dayAt(rnd(5, 40)),
        visits: {
          create: [
            {
              name: "Spring tune-up",
              scheduledDate: dayAt(rnd(10, 60)),
              status: "scheduled",
            },
            {
              name: "Fall tune-up",
              scheduledDate: monthsAgo(rnd(1, 4)),
              status: "completed",
              completedDate: monthsAgo(rnd(1, 4)),
            },
          ],
        },
      },
    });
  }

  // ── Update numbering counters so app-created records don't collide ──────────
  if (settings) {
    await prisma.companySettings.update({
      where: { id: settings.id },
      data: {
        nextCustomerNumber: nextCustomer,
        nextJobNumber: nextJob,
        nextEstimateNumber: nextEstimate,
        nextInvoiceNumber: nextInvoice,
      },
    });
  }

  const [cCount, jCount, iCount, pCount] = await Promise.all([
    prisma.customer.count(),
    prisma.job.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
  ]);
  console.log(
    `✅ Demo data loaded — ${cCount} customers, ${jCount} jobs, ${iCount} invoices, ${pCount} payments.`,
  );
}

main()
  .catch((err) => {
    console.error("demo seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
