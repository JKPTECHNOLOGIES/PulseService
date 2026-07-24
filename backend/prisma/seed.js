require("dotenv").config();
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { LOOKUPS } = require("../src/constants/lookups");
const { DEFAULT_ROLE_PERMISSIONS } = require("../src/constants/permissions");
const { parseItemsCsv } = require("./seed-data/parseItemsCsv");
const { parseCustomersCsv, normalizeCustomerName, parseFullAddress } = require("./seed-data/parseCustomersCsv");
const CUSTOMER_PRIMARY_LINKS = require("./seed-data/customerPrimaryLinks");
const { parseQuotesCsv } = require("./seed-data/parseQuotesCsv");
const { parseWorkOrdersCsv } = require("./seed-data/parseWorkOrdersCsv");
const { parseInvoicesCsv } = require("./seed-data/parseInvoicesCsv");
const { parseEquipmentCsv } = require("./seed-data/parseEquipmentCsv");


const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // ── Cleanup (reverse dependency order) ───────────────────────────────────────
  console.log("  Cleaning existing data...");
  await prisma.quickBooksSyncQueue.deleteMany();
  await prisma.quickBooksMapping.deleteMany();
  await prisma.quickBooksItemMapping.deleteMany();
  await prisma.quickBooksSettings.deleteMany();
  await prisma.serializedUnit.deleteMany();
  await prisma.pOLineReceipt.deleteMany();
  await prisma.pOLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryItemCostHistory.deleteMany();
  await prisma.inventoryStock.deleteMany();
  await prisma.inventoryItemVendor.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.stockLocation.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.agreementVisit.deleteMany();
  await prisma.serviceAgreement.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.jobForm.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.estimateLineItem.deleteMany();
  await prisma.estimate.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.jobTechnician.deleteMany();
  await prisma.job.deleteMany();
  await prisma.call.deleteMany();
  await prisma.customerMessage.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.location.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.pricingTierOverride.deleteMany();
  await prisma.pricingTier.deleteMany();
  await prisma.technician.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pricebookItem.deleteMany();
  await prisma.pricebookCategory.deleteMany();
  await prisma.businessUnit.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.companySettings.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.lookup.deleteMany();

  // ── Lookups (DB-driven enums: statuses, types, roles, priorities, ...) ────────
  console.log("  Creating lookups (single source of truth)...");
  for (const [category, entries] of Object.entries(LOOKUPS)) {
    await prisma.lookup.createMany({
      data: entries.map((entry, index) => ({
        category,
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        sortOrder: index,
      })),
    });
  }

  // ── Role permissions (default per-role permission sets) ───────────────────────
  console.log("  Creating role permissions...");
  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ role, permission })),
    });
  }

  // ── Company Settings ──────────────────────────────────────────────────────────
  console.log("  Creating company settings...");
  await prisma.companySettings.create({
    data: {
      name: "Prime Comfort Solutions",
      address: "6670 White Drive, Suite B",
      city: "West Palm Beach",
      state: "FL",
      zip: "33407",
      phone: "561-217-4822",
      // Iris is the point of contact printed/emailed on every customer-facing
      // document (invoices, estimates, agreements) -- not a per-employee inbox.
      email: "Iris@PrimeComfortAC.com",
      website: "https://www.primecomfortac.com",
      currency: "USD",
      timezone: "America/New_York",
      invoiceTerms:
        "Payment due within 30 days of invoice date. Late payments subject to 1.5% monthly interest.",
      estimateTerms:
        "This estimate is valid for 30 days. Prices subject to change after expiration.",
      jobPrefix: "JOB",
      invoicePrefix: "INV",
      estimatePrefix: "EST",
      customerPrefix: "CUST",
      nextJobNumber: 1009,
      nextInvoiceNumber: 1005,
      nextEstimateNumber: 1005,
      nextCustomerNumber: 1006,
      nextVendorNumber: 1003,
      nextPoNumber: 1002,
      nextReceiptNumber: 1002,
    },
  });

  // ── QuickBooks sync (disabled by default until credentials/mapping are set) ────
  console.log("  Creating QuickBooks settings (disabled by default)...");
  await prisma.quickBooksSettings.create({ data: {} });

  // ── Business Units ────────────────────────────────────────────────────────────
  console.log("  Creating business units...");
  await Promise.all([
    prisma.businessUnit.create({ data: { name: "HVAC", type: "service" } }),
    prisma.businessUnit.create({ data: { name: "Plumbing", type: "service" } }),
    prisma.businessUnit.create({
      data: { name: "Electrical", type: "service" },
    }),
  ]);

  // ── Vehicles ──────────────────────────────────────────────────────────────────
  console.log("  Creating vehicles...");
  const [truck1, van2] = await Promise.all([
    prisma.vehicle.create({
      data: {
        name: "Truck 1",
        make: "Ford",
        model: "F-250",
        year: 2022,
        licensePlate: "GEO-1234",
        color: "White",
        vin: "1FTFW1ET4NFA00001",
      },
    }),
    prisma.vehicle.create({
      data: {
        name: "Van 2",
        make: "Chevrolet",
        model: "Express 2500",
        year: 2021,
        licensePlate: "GEO-5678",
        color: "Blue",
        vin: "1GCWGAFG4M1100002",
      },
    }),
  ]);

  // ── Users ─────────────────────────────────────────────────────────────────────
  console.log("  Creating users...");
  const SALT_ROUNDS = 10;
  // Admin/employee/break-glass passwords are all env-configurable so a real,
  // secure password is never hardcoded in this (public) repo. Each falls back
  // to a throwaway default for local dev only; rotate them in any live DB
  // with scripts/set-admin-password.js <email> (or the Users page's "Reset
  // Password" action).
  const adminHash = await bcrypt.hash(
    process.env.SEED_ADMIN_PASSWORD || "admin123",
    SALT_ROUNDS,
  );
  const passHash = await bcrypt.hash(
    process.env.SEED_EMPLOYEE_PASSWORD || "pass123",
    SALT_ROUNDS,
  );
  const breakglassHash = await bcrypt.hash(
    process.env.BREAKGLASS_ADMIN_PASSWORD || "changeme-breakglass-123",
    SALT_ROUNDS,
  );

  // Real Prime Comfort roster (refreshed from the 2026-07-14 emp list export).
  // Emails come straight from that export, not a firstname@ convention -- e.g.
  // Samuel's is sammy@ and Robert St.'s is robxm@, which is also how the two
  // Roberts (Robert S. / Robert St.) end up disambiguated without needing an
  // invented suffix.
  //
  // `admin` (Darryl) is a normal employee admin account -- once Microsoft SSO
  // ships he (like every other real employee) logs in with his 365 account.
  // The dedicated `sysadmin@pulseservice.local` account below is the actual
  // break-glass login: its email deliberately isn't a real mailbox in any
  // Microsoft tenant, so it can never be matched or shadowed by Microsoft
  // SSO/auto-provisioning, and it's the one credential meant to keep working
  // even during an Azure/365 outage. `manager` (Iris, the office manager) is
  // credited with the historical demo records that used to belong to the old
  // dispatcher/CSR test accounts. She's seeded with the "admin" role since
  // "manager" is retired for now (client doesn't use it) -- the variable is
  // still named `manager` for the office-manager persona she represents in
  // the demo data, not the (now-unused) role string.
  const [
    admin,
    manager,
    tech1User,
    tech2User,
    tech3User,
    tech4User,
    tech5User,
    tech6User,
  ] = await Promise.all([
    prisma.user.create({
      data: {
        email: "darryl@primecomfortac.com",
        password: adminHash,
        firstName: "Darryl",
        lastName: "S.",
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        email: "iris@primecomfortac.com",
        password: passHash,
        firstName: "Iris",
        lastName: "O.",
        // "manager" role retired for now (client doesn't use it) -- Iris
        // keeps her office-manager duties in the app as an admin.
        role: "admin",
      },
    }),
    prisma.user.create({
      data: {
        email: "charlie@primecomfortac.com",
        password: passHash,
        firstName: "Charles",
        lastName: "S.",
        role: "technician",
      },
    }),
    prisma.user.create({
      data: {
        email: "gabriel@primecomfortac.com",
        password: passHash,
        firstName: "Gabriel",
        lastName: "A.",
        role: "technician",
      },
    }),
    prisma.user.create({
      data: {
        email: "jim@primecomfortac.com",
        password: passHash,
        firstName: "Jim",
        lastName: "B.",
        role: "technician",
      },
    }),
    prisma.user.create({
      data: {
        email: "pablo@primecomfortac.com",
        password: passHash,
        firstName: "Pablo",
        lastName: "R.",
        role: "technician",
      },
    }),
    prisma.user.create({
      data: {
        email: "robxm@primecomfortac.com",
        password: passHash,
        firstName: "Robert",
        lastName: "St.",
        role: "technician",
      },
    }),
    prisma.user.create({
      data: {
        email: "sammy@primecomfortac.com",
        password: passHash,
        firstName: "Samuel",
        lastName: "M.",
        role: "technician",
      },
    }),
  ]);

  // Remaining office admins. They hold no seeded demo records, so they don't
  // need named handles — create them in one batch with the shared dev password.
  await prisma.user.createMany({
    data: [
      {
        email: "eric@primecomfortac.com",
        password: passHash,
        firstName: "Eric",
        lastName: "I.",
        role: "admin",
      },
      {
        email: "mark@primecomfortac.com",
        password: passHash,
        firstName: "Mark",
        lastName: "A.",
        role: "admin",
      },
      {
        email: "pilar@primecomfortac.com",
        password: passHash,
        firstName: "Pilar",
        lastName: "S.",
        role: "admin",
      },
      {
        email: "ritter@primecomfortac.com",
        password: passHash,
        firstName: "Ritter",
        lastName: "M.",
        role: "admin",
      },
      {
        email: "robert@primecomfortac.com",
        password: passHash,
        firstName: "Robert",
        lastName: "S.",
        role: "admin",
      },
      {
        email: "jkptest@primecomfortac.com",
        password: passHash,
        firstName: "JKPTest",
        lastName: "",
        role: "admin",
      },
    ],
  });

  // Dedicated break-glass admin -- deliberately NOT a real Microsoft 365
  // mailbox (the .local TLD guarantees no Entra ID tenant will ever own it),
  // so Microsoft SSO login/auto-provisioning can never match or shadow this
  // account. This is the one login meant to always work by password alone,
  // independent of Azure/365 being up or correctly configured.
  await prisma.user.create({
    data: {
      email: "sysadmin@pulseservice.local",
      password: breakglassHash,
      firstName: "Break-Glass",
      lastName: "Admin",
      role: "admin",
    },
  });

  // ── Technicians ───────────────────────────────────────────────────────────────
  console.log("  Creating technician profiles...");
  const [tech1, tech2, tech3] = await Promise.all([
    prisma.technician.create({
      data: {
        userId: tech1User.id, // Charles S.
        employeeId: "EMP-001",
        skills: "HVAC,Refrigeration,Heat Pumps",
        zones: "North,Central",
        vehicleId: truck1.id,
        isAvailable: true,
        currentLat: 33.749,
        currentLng: -84.388,
      },
    }),
    prisma.technician.create({
      data: {
        userId: tech2User.id, // Gabriel A.
        employeeId: "EMP-002",
        skills: "Plumbing,Water Heaters,Drain Cleaning",
        zones: "South,East",
        vehicleId: van2.id,
        isAvailable: true,
        currentLat: 33.731,
        currentLng: -84.392,
      },
    }),
    prisma.technician.create({
      data: {
        userId: tech3User.id, // Jim B.
        employeeId: "EMP-003",
        skills: "Electrical,HVAC,Controls",
        zones: "West,Central",
        isAvailable: true,
        currentLat: 33.756,
        currentLng: -84.401,
      },
    }),
  ]);

  // The remaining technicians aren't tied to any seeded job, so they're created
  // in one batch with sensible default skills/zones.
  await prisma.technician.createMany({
    data: [
      {
        userId: tech4User.id, // Pablo R.
        employeeId: "EMP-004",
        skills: "HVAC,Maintenance",
        zones: "North,East",
        isAvailable: true,
      },
      {
        userId: tech5User.id, // Robert St.
        employeeId: "EMP-005",
        skills: "HVAC,Installation",
        zones: "South,Central",
        isAvailable: true,
      },
      {
        userId: tech6User.id, // Samuel M.
        employeeId: "EMP-006",
        skills: "Plumbing,HVAC",
        zones: "West,South",
        isAvailable: true,
      },
    ],
  });

  // ── Pricing Tiers ───────────────────────────────────────────────────────
  console.log("  Creating pricing tiers...");
  const [standardTier, commercialPreferredTier] = await Promise.all([
    prisma.pricingTier.create({
      data: {
        name: "Standard",
        description: "Default catalog pricing — no discount.",
        discountType: "percentage",
        discountValue: 0,
        isDefault: true,
      },
    }),
    prisma.pricingTier.create({
      data: {
        name: "Commercial Preferred",
        description: "Negotiated discount for repeat commercial accounts.",
        discountType: "percentage",
        discountValue: 10,
      },
    }),
  ]);

  // ── Customers ───────────────────────────────────────────────────
  console.log("  Creating customers...");
  const customer1 = await prisma.customer.create({
    data: {
      customerNumber: "CUST-1001",
      firstName: "Robert",
      lastName: "Johnson",
      email: "robert.johnson@email.com",
      phone: "(770) 555-1001",
      mobilePhone: "(770) 555-1002",
      type: "residential",
      source: "Google",
      notes: "Preferred contact via text. Dog on premises.",
      locations: {
        create: [
          {
            address: "456 Oak Street",
            city: "Marietta",
            state: "GA",
            zip: "30060",
            isPrimary: true,
            type: "service",
            lat: 33.9526,
            lng: -84.5499,
          },
        ],
      },
      contacts: {
        create: [
          {
            firstName: "Robert",
            lastName: "Johnson",
            email: "robert.johnson@email.com",
            phone: "(770) 555-1001",
            isPrimary: true,
            role: "Homeowner",
          },
        ],
      },
    },
    include: { locations: true },
  });

  const customer2 = await prisma.customer.create({
    data: {
      customerNumber: "CUST-1002",
      firstName: "Jennifer",
      lastName: "Williams",
      email: "j.williams@email.com",
      phone: "(678) 555-2001",
      type: "residential",
      source: "Referral",
      pricingTierId: standardTier.id,
      locations: {
        create: [
          {
            address: "789 Pine Road",
            city: "Alpharetta",
            state: "GA",
            zip: "30005",
            isPrimary: true,
            type: "service",
            lat: 34.0754,
            lng: -84.2941,
          },
        ],
      },
    },
    include: { locations: true },
  });

  const customer3 = await prisma.customer.create({
    data: {
      customerNumber: "CUST-1003",
      firstName: "David",
      lastName: "Martinez",
      email: "david.martinez@techcorp.com",
      phone: "(404) 555-3001",
      type: "commercial",
      companyName: "TechCorp Solutions",
      source: "Direct",
      creditLimit: 50000,
      pricingTierId: commercialPreferredTier.id,
      notes: "Net-30 terms approved. Contact facilities manager for access.",
      locations: {
        create: [
          {
            name: "Main Office",
            address: "100 Peachtree Street NW",
            city: "Atlanta",
            state: "GA",
            zip: "30303",
            isPrimary: true,
            type: "service",
            lat: 33.7494,
            lng: -84.3882,
          },
        ],
      },
      contacts: {
        create: [
          {
            firstName: "David",
            lastName: "Martinez",
            email: "david.martinez@techcorp.com",
            phone: "(404) 555-3001",
            isPrimary: true,
            role: "Facilities Director",
          },
          {
            firstName: "Karen",
            lastName: "Lee",
            email: "k.lee@techcorp.com",
            phone: "(404) 555-3002",
            isPrimary: false,
            role: "Office Manager",
          },
        ],
      },
    },
    include: { locations: true },
  });

  const customer4 = await prisma.customer.create({
    data: {
      customerNumber: "CUST-1004",
      firstName: "Susan",
      lastName: "Thompson",
      email: "sthompson@email.com",
      phone: "(770) 555-4001",
      mobilePhone: "(770) 555-4002",
      type: "residential",
      source: "Yelp",
      locations: {
        create: [
          {
            address: "321 Elm Drive",
            city: "Roswell",
            state: "GA",
            zip: "30076",
            isPrimary: true,
            type: "service",
            lat: 34.0232,
            lng: -84.3616,
          },
        ],
      },
    },
    include: { locations: true },
  });

  const customer5 = await prisma.customer.create({
    data: {
      customerNumber: "CUST-1005",
      firstName: "Michael",
      lastName: "Brown",
      email: "mbrown@brownproperties.com",
      phone: "(678) 555-5001",
      type: "commercial",
      companyName: "Brown Properties LLC",
      source: "Referral",
      creditLimit: 25000,
      notes: "Multiple properties. Billing to main office.",
      locations: {
        create: [
          {
            name: "Office Complex A",
            address: "555 Industrial Blvd",
            city: "Smyrna",
            state: "GA",
            zip: "30080",
            isPrimary: true,
            type: "service",
            lat: 33.883,
            lng: -84.514,
          },
          {
            name: "Office Complex B",
            address: "600 Industrial Blvd",
            city: "Smyrna",
            state: "GA",
            zip: "30080",
            isPrimary: false,
            type: "service",
            lat: 33.884,
            lng: -84.513,
          },
        ],
      },
    },
    include: { locations: true },
  });

  // ── Real customer roster (from QuickBooks export) ───────────────────────────
  // Sourced from prisma/seed-data/customers.csv, deduplicated by hand (see PR
  // history): rows sharing a real address+name were merged into one customer
  // with multiple locations (see customerMerges.js); rows that were pure
  // accidental re-entries of the same property were dropped from the CSV
  // entirely. customerNumber continues on from CUST-1005 above.
  console.log("  Importing real customer roster from CSV...");
  const importedCustomers = parseCustomersCsv(
    path.join(__dirname, "seed-data", "customers.csv"),
  );
  const companySettingsRow = await prisma.companySettings.findFirst();
  let nextCustomerNumber = companySettingsRow.nextCustomerNumber;
  // normalized raw "Display Name" (from the original, pre-dedup customers
  // export) -> created Customer record. Lets other CSV imports (quotes,
  // invoices, ...) that reference the same customer by its original name
  // resolve it, even for rows that got merged/deleted during dedup.
  const customerByRawName = new Map();
  // normalized raw "Display Name" -> the exact Full Address it was tied to in
  // the source export. Lets importers with per-property rows (e.g. equipment)
  // pick the right one of a merged customer's several locations.
  const rawNameToAddress = new Map();
  // "normalized name|full address" -> created Customer. Only needed to
  // disambiguate the handful of rows that share an identical Display Name
  // (see customerPrimaryLinks.js) -- customerByRawName can't tell those
  // apart since it's keyed by name alone.
  const customerByNameAndAddress = new Map();
  for (const c of importedCustomers) {
    const created = await prisma.customer.create({
      data: {
        customerNumber: `${companySettingsRow.customerPrefix}-${nextCustomerNumber}`,
        firstName: c.firstName,
        lastName: c.lastName,
        companyName: c.companyName,
        email: c.email,
        phone: c.phone,
        type: c.type,
        source: c.source,
        locations: {
          create: c.locations.map((l, i) => ({
            address: l.address,
            city: l.city,
            state: l.state,
            zip: l.zip,
            isPrimary: i === 0,
            type: "service",
          })),
        },
      },
      include: { locations: true },
    });
    nextCustomerNumber += 1;
    for (const rawName of c.sourceNames) {
      customerByRawName.set(normalizeCustomerName(rawName), created);
    }
    for (const [rawName, address] of Object.entries(c.nameToAddress)) {
      rawNameToAddress.set(normalizeCustomerName(rawName), address);
      customerByNameAndAddress.set(
        `${normalizeCustomerName(rawName)}|${address}`,
        created,
      );
    }
  }
  await prisma.companySettings.update({
    where: { id: companySettingsRow.id },
    data: { nextCustomerNumber },
  });
  console.log(`  Imported ${importedCustomers.length} customers.`);

  // FieldEdge "multiple customers under one primary" (see
  // customerPrimaryLinks.js): link each secondary's primaryCustomerId to its
  // primary. Every row is already its own Customer above -- this just adds
  // the reference, no data is merged or moved.
  console.log("  Linking primary/secondary customers...");
  function resolveLinkEntry(entry) {
    if (typeof entry === "string") {
      return customerByRawName.get(normalizeCustomerName(entry));
    }
    return (
      customerByNameAndAddress.get(
        `${normalizeCustomerName(entry.name)}|${entry.address}`,
      ) || customerByRawName.get(normalizeCustomerName(entry.name))
    );
  }
  let primaryLinksApplied = 0;
  for (const group of CUSTOMER_PRIMARY_LINKS) {
    const primary = resolveLinkEntry(group.primary);
    if (!primary) {
      console.warn(
        `  [customerPrimaryLinks] primary not found: ${JSON.stringify(group.primary)}`,
      );
      continue;
    }
    for (const secondaryEntry of group.secondaries) {
      const secondary = resolveLinkEntry(secondaryEntry);
      if (!secondary) {
        console.warn(
          `  [customerPrimaryLinks] secondary not found: ${JSON.stringify(secondaryEntry)}`,
        );
        continue;
      }
      await prisma.customer.update({
        where: { id: secondary.id },
        data: { primaryCustomerId: primary.id },
      });
      primaryLinksApplied += 1;
    }
  }
  console.log(`  Linked ${primaryLinksApplied} secondary customers.`);

  // Shared by every CSV importer below: resolves a customer by the raw
  // "Display Name" text used in the source exports. Every row in
  // customers.csv is created as its own Customer now (see
  // customerPrimaryLinks.js for the FieldEdge "multiple customers under one
  // primary" feature -- a reference, not a merge), so this is always a
  // direct lookup.
  function resolveCustomerByRawName(rawName) {
    return customerByRawName.get(normalizeCustomerName(rawName));
  }

  // ── Real quotes (from QuickBooks export) ──────────────────────────────
  // Sourced from prisma/seed-data/quotes.csv. Each quote references its
  // customer by the ORIGINAL (pre-dedup) per-property name, so we resolve it
  // via resolveCustomerByRawName() above.
  console.log("  Importing quotes (estimates) from CSV...");
  const importedQuotes = parseQuotesCsv(
    path.join(__dirname, "seed-data", "quotes.csv"),
  );
  const usedEstimateNumbers = new Set();
  let quotesImported = 0;
  let quotesSkipped = 0;
  for (const q of importedQuotes) {
    const customer = resolveCustomerByRawName(q.customerRawName);

    if (!customer) {
      quotesSkipped++;
      console.warn(
        `    No customer match for quote ${q.quoteNumber} ("${q.customerRawName}") - skipped.`,
      );
      continue;
    }

    let estimateNumber = q.quoteNumber.toUpperCase();
    if (usedEstimateNumbers.has(estimateNumber)) {
      let suffix = 2;
      while (usedEstimateNumbers.has(`${estimateNumber}-${suffix}`)) suffix++;
      estimateNumber = `${estimateNumber}-${suffix}`;
    }
    usedEstimateNumbers.add(estimateNumber);

    await prisma.estimate.create({
      data: {
        estimateNumber,
        customerId: customer.id,
        status: q.status,
        title: q.address || `Quote ${estimateNumber}`,
        summary: q.multiOption ? "Multi-option quote" : null,
        validUntil: q.expirationDate,
        subtotal: q.amount,
        taxRate: 0,
        taxAmount: 0,
        total: q.amount,
        notes: `Imported from QuickBooks export. Original status: ${q.originalStatus}. Printed: ${q.printed ? "Yes" : "No"}. Emailed: ${q.emailed ? "Yes" : "No"}.`,
        createdById: admin.id,
        createdAt: q.quoteDate,
        sentAt: q.quoteDate,
        approvedAt: q.status === "approved" ? q.quoteDate : null,
        rejectedAt: q.status === "rejected" ? q.quoteDate : null,
      },
    });
    quotesImported++;
  }
  console.log(`  Imported ${quotesImported} quotes (${quotesSkipped} skipped).`);

  // ── Jobs ──────────────────────────────────────────────────────────────────────
  console.log("  Creating jobs...");

  // Reference dates
  const now = new Date();
  const todayAt = (h, m = 0) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const daysOffset = (days, h = 8, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d;
  };

  // JOB-1001: Scheduled today (tech1)
  const job1 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1001",
      customerId: customer1.id,
      locationId: customer1.locations[0].id,
      type: "service",
      status: "scheduled",
      priority: "normal",
      summary: "AC unit not cooling properly",
      description:
        "Customer reports AC is running but not reaching set temperature. House sitting at 85°F. Unit is a 5-year-old Carrier 3-ton. May need refrigerant recharge.",
      scheduledStart: todayAt(9),
      scheduledEnd: todayAt(11),
      businessUnit: "HVAC",
      createdById: manager.id,
      technicians: {
        create: [{ technicianId: tech1.id, isLead: true }],
      },
    },
  });

  // JOB-1002: In-progress today (tech2)
  await prisma.job.create({
    data: {
      jobNumber: "JOB-1002",
      customerId: customer2.id,
      locationId: customer2.locations[0].id,
      type: "service",
      status: "in_progress",
      priority: "high",
      summary: "Water heater replacement",
      description:
        "Customer reports water heater leaking from bottom tank. 8-year-old 50-gal gas unit. Needs full replacement.",
      scheduledStart: todayAt(10),
      scheduledEnd: todayAt(13),
      actualStart: todayAt(10, 5),
      businessUnit: "Plumbing",
      createdById: manager.id,
      technicians: {
        create: [{ technicianId: tech2.id, isLead: true }],
      },
    },
  });

  // JOB-1003: Completed yesterday (tech1 + tech3)
  const job3 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1003",
      customerId: customer3.id,
      locationId: customer3.locations[0].id,
      type: "maintenance",
      status: "completed",
      priority: "normal",
      summary: "Annual HVAC maintenance - TechCorp main office",
      description:
        "Annual preventative maintenance for all HVAC units. Building has 4 rooftop units and 2 split systems.",
      scheduledStart: daysOffset(-1, 8),
      scheduledEnd: daysOffset(-1, 12),
      actualStart: daysOffset(-1, 8, 10),
      actualEnd: daysOffset(-1, 12, 30),
      completedAt: daysOffset(-1, 12, 30),
      completionNotes:
        "Completed annual maintenance on all 6 units. Replaced filters on all units, cleaned coils on RTU-3 and RTU-4, checked refrigerant levels (all within spec). RTU-2 capacitor showing early signs of wear - recommend replacement within 6 months.",
      businessUnit: "HVAC",
      createdById: manager.id,
      technicians: {
        create: [
          { technicianId: tech1.id, isLead: true },
          { technicianId: tech3.id, isLead: false },
        ],
      },
    },
  });

  // JOB-1004: Scheduled tomorrow (tech1)
  const job4 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1004",
      customerId: customer4.id,
      locationId: customer4.locations[0].id,
      type: "install",
      status: "scheduled",
      priority: "normal",
      summary: "New HVAC system installation",
      description:
        "Full system replacement: 3-ton Carrier heat pump + matching variable-speed air handler. Old system is 18 years old. Customer approved EST-1001.",
      scheduledStart: daysOffset(1, 8),
      scheduledEnd: daysOffset(1, 14),
      businessUnit: "HVAC",
      createdById: admin.id,
      technicians: {
        create: [{ technicianId: tech1.id, isLead: true }],
      },
    },
  });

  // JOB-1005: New / unassigned emergency
  const job5 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1005",
      customerId: customer5.id,
      locationId: customer5.locations[0].id,
      type: "service",
      status: "new",
      priority: "urgent",
      summary: "Burst pipe emergency - Office Complex A",
      description:
        "Pipe burst on 2nd floor near server room. Water actively leaking. Customer has shut off main. Needs immediate response.",
      businessUnit: "Plumbing",
      createdById: manager.id,
    },
  });

  // JOB-1006: Completed last week (tech3)
  const job6 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1006",
      customerId: customer1.id,
      locationId: customer1.locations[0].id,
      type: "service",
      status: "completed",
      priority: "normal",
      summary: "Smart thermostat installation",
      description:
        "Customer wants to upgrade to Nest Learning Thermostat 3rd Gen.",
      scheduledStart: daysOffset(-7, 13),
      scheduledEnd: daysOffset(-7, 14, 30),
      actualStart: daysOffset(-7, 13, 5),
      actualEnd: daysOffset(-7, 14, 5),
      completedAt: daysOffset(-7, 14, 5),
      completionNotes:
        "Installed Nest 3rd Gen thermostat. Connected to customer Wi-Fi and set up app on their phone. Demonstrated operation. Works perfectly.",
      businessUnit: "HVAC",
      createdById: manager.id,
      technicians: {
        create: [{ technicianId: tech3.id, isLead: true }],
      },
    },
  });

  // JOB-1007: Completed two weeks ago (tech2)
  const job7 = await prisma.job.create({
    data: {
      jobNumber: "JOB-1007",
      customerId: customer2.id,
      locationId: customer2.locations[0].id,
      type: "service",
      status: "completed",
      priority: "normal",
      summary: "Kitchen faucet dripping repair",
      description:
        "Kitchen faucet dripping constantly. Replace cartridge and o-rings.",
      scheduledStart: daysOffset(-14, 14),
      scheduledEnd: daysOffset(-14, 15),
      actualStart: daysOffset(-14, 14, 3),
      actualEnd: daysOffset(-14, 14, 48),
      completedAt: daysOffset(-14, 14, 48),
      completionNotes:
        "Replaced faucet cartridge and both o-rings. Tested under full pressure - no leaks. Job complete.",
      businessUnit: "Plumbing",
      createdById: manager.id,
      technicians: {
        create: [{ technicianId: tech2.id, isLead: true }],
      },
    },
  });

  // JOB-1008: Scheduled tomorrow afternoon (unassigned)
  await prisma.job.create({
    data: {
      jobNumber: "JOB-1008",
      customerId: customer3.id,
      locationId: customer3.locations[0].id,
      type: "maintenance",
      status: "scheduled",
      priority: "normal",
      summary: "Quarterly plumbing inspection - TechCorp",
      description:
        "Routine Q3 plumbing inspection per service agreement AGR-1001.",
      scheduledStart: daysOffset(1, 14),
      scheduledEnd: daysOffset(1, 16),
      businessUnit: "Plumbing",
      createdById: manager.id,
    },
  });

  // ── Real work orders (from QuickBooks-adjacent export) ─────────────
  // Sourced from prisma/seed-data/workOrders.csv ("Jobs" in this app = Work
  // Orders in the source system). This supersedes the small 15-row
  // jobs.csv we imported previously -- every one of those 15 turned out to
  // be a subset of this same underlying data (verified by customer+date
  // overlap), so that file was removed rather than double-importing the
  // same real-world events.
  //
  // Structural note: a single WO# can have multiple rows (same customer,
  // same invoice, different scheduled visits -- a reschedule or a
  // multi-day job). parseWorkOrdersCsv groups these into one Job per WO#;
  // extra visits become JobScheduleBlock entries rather than duplicate
  // jobs. jobNumber preserves the original WO# (e.g. WO-1630) instead of
  // consuming the JOB- counter, same approach as quotes/invoices.
  //
  // Technician column: only 6 of the 11 people named there have a seeded
  // Technician profile (Charles S., Jim B., Gabriel A., Robert St., Pablo
  // R., Samuel M.) and get a real JobTechnician assignment. The other 4
  // (Darryl S., Eric I., Robert S., Ritter M.) are seeded as admins only --
  // per instruction, they're credited in notes ("Performed by: X") rather
  // than given a technician profile.
  console.log("  Importing work orders from CSV...");
  const [allUsersForWo, allTechniciansForWo] = await Promise.all([
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
    prisma.technician.findMany({ select: { id: true, userId: true } }),
  ]);
  const technicianByUserId = new Map(allTechniciansForWo.map((t) => [t.userId, t.id]));
  const personByName = new Map();
  for (const u of allUsersForWo) {
    personByName.set(`${u.firstName} ${u.lastName}`, {
      userId: u.id,
      technicianId: technicianByUserId.get(u.id) ?? null,
    });
  }

  const importedWorkOrders = parseWorkOrdersCsv(
    path.join(__dirname, "seed-data", "workOrders.csv"),
  );
  let jobsImported = 0;
  let jobsSkipped = 0;
  // WO row's Invoice/Quote reference (uppercased) -> created Job.id, used to
  // backfill Invoice.jobId / Estimate.jobId once those exist further below.
  const jobIdByInvoiceRef = new Map();
  const jobIdByQuoteRef = new Map();

  function findMatchingLocationId(customer, jobLocation) {
    if (!customer.locations || customer.locations.length === 0) return null;
    if (customer.locations.length === 1) return customer.locations[0].id;
    if (!jobLocation) return customer.locations[0].id;
    const norm = (s) => (s || "").trim().toLowerCase();
    const match = customer.locations.find(
      (l) => norm(l.address) === norm(jobLocation.address),
    );
    return (match || customer.locations[0]).id;
  }

  for (const wo of importedWorkOrders) {
    const customer = resolveCustomerByRawName(wo.customerRawName);
    if (!customer) {
      jobsSkipped++;
      console.warn(
        `    No customer match for WO #${wo.wo} ("${wo.customerRawName}") - skipped.`,
      );
      continue;
    }

    const mappedAddress = rawNameToAddress.get(
      normalizeCustomerName(wo.customerRawName),
    );
    const locationId = findMatchingLocationId(
      customer,
      mappedAddress ? parseFullAddress(mappedAddress) : null,
    );

    const person = wo.technicianName ? personByName.get(wo.technicianName) : null;

    const notesParts = [];
    if (wo.technicianName && person && !person.technicianId) {
      notesParts.push(`Performed by: ${wo.technicianName} (admin, not a technician profile).`);
    } else if (wo.technicianName && !person) {
      notesParts.push(`Performed by: ${wo.technicianName} (not found in seeded roster).`);
    }
    if (wo.invoiceRef) notesParts.push(`Invoice on file: ${wo.invoiceRef.toUpperCase()}.`);
    if (wo.quoteRef) notesParts.push(`Quote on file: ${wo.quoteRef.toUpperCase()}.`);
    if (wo.purchaseOrder) notesParts.push(`Purchase order: ${wo.purchaseOrder}.`);

    const jobNumber = `WO-${wo.wo}`;
    const created = await prisma.job.create({
      data: {
        jobNumber,
        customerId: customer.id,
        locationId,
        type: wo.type,
        status: wo.status,
        priority: "normal",
        tags: wo.task || null,
        summary: wo.summary || wo.description || `${wo.task || "Work order"} (WO #${wo.wo})`,
        description: wo.description || null,
        notes: notesParts.length ? notesParts.join(" ") : null,
        scheduledStart: wo.scheduledStart,
        scheduledEnd: wo.scheduledEnd,
        actualStart: wo.scheduledStart,
        actualEnd: wo.completedAt,
        completedAt: wo.status === "completed" ? wo.completedAt : null,
        cancelledAt: wo.status === "cancelled" ? wo.completedAt : null,
        createdAt: wo.createdAt,
        createdById: person ? person.userId : admin.id,
        technicians: person?.technicianId
          ? { create: { technicianId: person.technicianId, isLead: true, status: wo.status === "completed" ? "completed" : "assigned" } }
          : undefined,
        scheduleBlocks: {
          create: wo.visits.slice(1).map((v) => ({
            start: v.scheduled,
            end: v.scheduled,
            note: `Visit${v.technician ? ` — Tech: ${v.technician}` : ""}${v.status !== wo.originalStatus ? `, status at the time: ${v.status}` : ""}`,
          })),
        },
      },
    });
    jobsImported++;

    if (wo.invoiceRef) jobIdByInvoiceRef.set(wo.invoiceRef.toUpperCase(), created.id);
    if (wo.quoteRef) jobIdByQuoteRef.set(wo.quoteRef.toUpperCase(), created.id);
  }
  console.log(`  Imported ${jobsImported} work orders (${jobsSkipped} skipped).`);

  // ── Estimates ──────────────────────────────────────────────────────
  console.log("  Creating estimates...");

  const [estimate1] = await Promise.all([
    // EST-1001: Approved - new HVAC install for customer4/job4
    prisma.estimate.create({
      data: {
        estimateNumber: "EST-1001",
        customerId: customer4.id,
        jobId: job4.id,
        status: "approved",
        title: "New HVAC System Installation - 3-Ton Heat Pump",
        summary:
          "Complete replacement of existing 18-year-old HVAC system with new Carrier equipment.",
        validUntil: daysOffset(30),
        subtotal: 7500,
        discountType: null,
        discountValue: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 7500,
        notes: "Includes all materials, labor, and old system disposal.",
        terms:
          "Deposit of 50% required before scheduling. Balance due upon completion.",
        createdById: admin.id,
        sentAt: daysOffset(-3),
        approvedAt: daysOffset(-2),
        lineItems: {
          create: [
            {
              type: "material",
              name: "Carrier 24PAA336 3-Ton Heat Pump (16 SEER)",
              description: "High-efficiency outdoor heat pump unit",
              quantity: 1,
              unitPrice: 3200,
              total: 3200,
              sortOrder: 0,
            },
            {
              type: "material",
              name: "Carrier FV4CNF003 Air Handler",
              description: "Variable-speed modulating air handler",
              quantity: 1,
              unitPrice: 1600,
              total: 1600,
              sortOrder: 1,
            },
            {
              type: "material",
              name: "Thermostat & Accessories",
              description: "Ecobee SmartThermostat + refrigerant lineset",
              quantity: 1,
              unitPrice: 700,
              total: 700,
              sortOrder: 2,
            },
            {
              type: "labor",
              name: "Installation Labor (8 hrs)",
              description: "Full system installation by lead tech",
              quantity: 8,
              unitPrice: 125,
              total: 1000,
              sortOrder: 3,
            },
            {
              type: "service",
              name: "Old System Removal & Disposal",
              description:
                "Disconnect, remove, and dispose of old equipment per EPA regulations",
              quantity: 1,
              unitPrice: 500,
              total: 500,
              sortOrder: 4,
            },
            {
              type: "service",
              name: "Startup & Commissioning",
              description: "System startup, testing, and customer walk-through",
              quantity: 1,
              unitPrice: 500,
              total: 500,
              sortOrder: 5,
            },
          ],
        },
      },
    }),

    // EST-1002: Sent - maintenance contract for customer5
    prisma.estimate.create({
      data: {
        estimateNumber: "EST-1002",
        customerId: customer5.id,
        status: "sent",
        title: "Annual HVAC Maintenance Agreement - Brown Properties",
        summary: "Annual service agreement covering both office complexes.",
        validUntil: daysOffset(14),
        subtotal: 4800,
        discountType: "percentage",
        discountValue: 5,
        taxRate: 0,
        taxAmount: 0,
        total: 4560,
        notes: "5% multi-property discount applied.",
        createdById: admin.id,
        sentAt: daysOffset(-1),
        lineItems: {
          create: [
            {
              type: "service",
              name: "Quarterly HVAC Inspections (4 per year)",
              description:
                "Comprehensive system inspection each quarter - both complexes",
              quantity: 4,
              unitPrice: 600,
              total: 2400,
              sortOrder: 0,
            },
            {
              type: "service",
              name: "Filter Replacement Service",
              description: "Replace all HVAC filters quarterly",
              quantity: 4,
              unitPrice: 200,
              total: 800,
              sortOrder: 1,
            },
            {
              type: "service",
              name: "Priority Service Agreement",
              description:
                "24/7 priority scheduling, 10% repair discount, 2-hr response SLA",
              quantity: 1,
              unitPrice: 1600,
              total: 1600,
              sortOrder: 2,
            },
          ],
        },
      },
    }),

    // EST-1003: Draft - AC repair for customer1/job1
    prisma.estimate.create({
      data: {
        estimateNumber: "EST-1003",
        customerId: customer1.id,
        jobId: job1.id,
        status: "draft",
        title: "AC Repair - Refrigerant Recharge",
        summary: "Diagnose low refrigerant issue and recharge system.",
        subtotal: 460,
        discountType: null,
        discountValue: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 460,
        createdById: tech1User.id,
        lineItems: {
          create: [
            {
              type: "service",
              name: "HVAC Diagnostic Fee",
              description: "Full system diagnostic to identify root cause",
              quantity: 1,
              unitPrice: 95,
              total: 95,
              sortOrder: 0,
            },
            {
              type: "material",
              name: "R-410A Refrigerant Recharge",
              description: "Refrigerant recharge (estimated 3 lbs)",
              quantity: 3,
              unitPrice: 55,
              total: 165,
              sortOrder: 1,
            },
            {
              type: "labor",
              name: "Repair Labor",
              description: "Labor to locate leak, repair, and recharge",
              quantity: 2,
              unitPrice: 100,
              total: 200,
              sortOrder: 2,
            },
          ],
        },
      },
    }),

    // EST-1004: Rejected
    prisma.estimate.create({
      data: {
        estimateNumber: "EST-1004",
        customerId: customer2.id,
        status: "rejected",
        title: "Water Heater Replacement - 50-Gallon Gas",
        summary: "Replace failed 50-gallon gas water heater.",
        subtotal: 1850,
        discountType: null,
        discountValue: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 1850,
        createdById: manager.id,
        sentAt: daysOffset(-8),
        rejectedAt: daysOffset(-5),
        rejectionReason: "Customer found a lower price through a competitor.",
        lineItems: {
          create: [
            {
              type: "material",
              name: "Rheem Performance 50-Gal Gas Water Heater",
              description: "50K BTU, 9-year warranty",
              quantity: 1,
              unitPrice: 1100,
              total: 1100,
              sortOrder: 0,
            },
            {
              type: "labor",
              name: "Water Heater Installation",
              description:
                "Full installation including code-compliant connections",
              quantity: 1,
              unitPrice: 650,
              total: 650,
              sortOrder: 1,
            },
            {
              type: "service",
              name: "Old Unit Disposal",
              description: "Haul away and dispose of old unit",
              quantity: 1,
              unitPrice: 100,
              total: 100,
              sortOrder: 2,
            },
          ],
        },
      },
    }),
  ]);

  // ── Invoices ──────────────────────────────────────────────────────────────────
  console.log("  Creating invoices...");

  const [invoice1, invoice2, invoice3] = await Promise.all([
    // INV-1001: Paid - annual maintenance at TechCorp (job3)
    prisma.invoice.create({
      data: {
        invoiceNumber: "INV-1001",
        customerId: customer3.id,
        jobId: job3.id,
        status: "paid",
        dueDate: daysOffset(30),
        subtotal: 875,
        taxRate: 0,
        taxAmount: 0,
        total: 875,
        amountPaid: 875,
        balance: 0,
        paidAt: daysOffset(-1, 15),
        sentAt: daysOffset(-1, 13),
        createdById: admin.id,
        lineItems: {
          create: [
            {
              type: "service",
              name: "Annual HVAC Maintenance (6 Units)",
              description: "Comprehensive tune-up on all 6 HVAC units",
              quantity: 1,
              unitPrice: 450,
              total: 450,
              sortOrder: 0,
            },
            {
              type: "material",
              name: "Air Filters MERV-13 (12 pack)",
              description: "High-efficiency replacement filters",
              quantity: 12,
              unitPrice: 18,
              total: 216,
              sortOrder: 1,
            },
            {
              type: "labor",
              name: "Maintenance Labor",
              description: "2 technicians x 4.5 hours",
              quantity: 9,
              unitPrice: 23.22,
              total: 209,
              sortOrder: 2,
            },
          ],
        },
      },
    }),

    // INV-1002: Paid - thermostat install (job6)
    prisma.invoice.create({
      data: {
        invoiceNumber: "INV-1002",
        customerId: customer1.id,
        jobId: job6.id,
        status: "paid",
        dueDate: daysOffset(30),
        subtotal: 295,
        taxRate: 0,
        taxAmount: 0,
        total: 295,
        amountPaid: 295,
        balance: 0,
        paidAt: daysOffset(-7, 14, 15),
        sentAt: daysOffset(-7, 14, 10),
        createdById: manager.id,
        lineItems: {
          create: [
            {
              type: "material",
              name: "Nest Learning Thermostat 3rd Gen",
              description: "Charcoal color, includes base and trim kit",
              quantity: 1,
              unitPrice: 190,
              total: 190,
              sortOrder: 0,
            },
            {
              type: "labor",
              name: "Installation & Setup",
              description: "1 hour including app setup and demo",
              quantity: 1,
              unitPrice: 105,
              total: 105,
              sortOrder: 1,
            },
          ],
        },
      },
    }),

    // INV-1003: Paid - faucet repair (job7)
    prisma.invoice.create({
      data: {
        invoiceNumber: "INV-1003",
        customerId: customer2.id,
        jobId: job7.id,
        status: "paid",
        dueDate: daysOffset(30),
        subtotal: 180,
        taxRate: 0,
        taxAmount: 0,
        total: 180,
        amountPaid: 180,
        balance: 0,
        paidAt: daysOffset(-14, 15),
        sentAt: daysOffset(-14, 14, 55),
        createdById: manager.id,
        lineItems: {
          create: [
            {
              type: "service",
              name: "Service Call Fee",
              description: "Minimum service call charge",
              quantity: 1,
              unitPrice: 45,
              total: 45,
              sortOrder: 0,
            },
            {
              type: "material",
              name: "Faucet Cartridge & O-Rings",
              description: "OEM replacement parts",
              quantity: 1,
              unitPrice: 48,
              total: 48,
              sortOrder: 1,
            },
            {
              type: "labor",
              name: "Repair Labor",
              description: "45 minutes on-site",
              quantity: 0.75,
              unitPrice: 116,
              total: 87,
              sortOrder: 2,
            },
          ],
        },
      },
    }),

    // INV-1004: Draft - linked to approved estimate for HVAC install (job4)
    prisma.invoice.create({
      data: {
        invoiceNumber: "INV-1004",
        customerId: customer4.id,
        jobId: job4.id,
        estimateId: estimate1.id,
        status: "draft",
        dueDate: daysOffset(30),
        subtotal: 7500,
        discountType: null,
        discountValue: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 7500,
        balance: 7500,
        notes: "Deposit of $3,750.00 (50%) collected at time of scheduling.",
        terms: "Balance due upon job completion.",
        createdById: admin.id,
        lineItems: {
          create: [
            {
              type: "material",
              name: "Carrier 24PAA336 3-Ton Heat Pump (16 SEER)",
              description: "High-efficiency outdoor heat pump unit",
              quantity: 1,
              unitPrice: 3200,
              total: 3200,
              sortOrder: 0,
            },
            {
              type: "material",
              name: "Carrier FV4CNF003 Air Handler",
              description: "Variable-speed modulating air handler",
              quantity: 1,
              unitPrice: 1600,
              total: 1600,
              sortOrder: 1,
            },
            {
              type: "material",
              name: "Thermostat & Accessories",
              description: "Ecobee SmartThermostat + refrigerant lineset",
              quantity: 1,
              unitPrice: 700,
              total: 700,
              sortOrder: 2,
            },
            {
              type: "labor",
              name: "Installation Labor (8 hrs)",
              description: "Full system installation by lead tech",
              quantity: 8,
              unitPrice: 125,
              total: 1000,
              sortOrder: 3,
            },
            {
              type: "service",
              name: "Old System Removal & Disposal",
              description: "Disconnect, remove, and dispose of old equipment",
              quantity: 1,
              unitPrice: 500,
              total: 500,
              sortOrder: 4,
            },
            {
              type: "service",
              name: "Startup & Commissioning",
              description: "System startup, testing, and customer walk-through",
              quantity: 1,
              unitPrice: 500,
              total: 500,
              sortOrder: 5,
            },
          ],
        },
      },
    }),
  ]);

  // ── Real invoices (from QuickBooks export) ─────────────────────────────
  // Sourced from prisma/seed-data/invoices.csv. Each row references its
  // customer by the ORIGINAL (pre-dedup) per-property name, resolved via
  // resolveCustomerByRawName(). There's no reliable way to link the "WO #"
  // column back to our 15 imported jobs (that export didn't preserve the
  // original work-order IDs), so jobId is left unset; the original WO # and
  // description are preserved in notes instead. invoiceNumber preserves the
  // original identifier (e.g. i1290 -> I1290), matching how quotes kept
  // their original Q-numbers.
  console.log("  Importing invoices from CSV...");
  const importedInvoices = parseInvoicesCsv(
    path.join(__dirname, "seed-data", "invoices.csv"),
  );
  const usedInvoiceNumbers = new Set();
  let invoicesImported = 0;
  let invoicesSkipped = 0;
  for (const inv of importedInvoices) {
    const customer = resolveCustomerByRawName(inv.customerRawName);
    if (!customer) {
      invoicesSkipped++;
      console.warn(
        `    No customer match for invoice ${inv.invoiceNumber} ("${inv.customerRawName}") - skipped.`,
      );
      continue;
    }

    let invoiceNumber = inv.invoiceNumber.toUpperCase();
    if (usedInvoiceNumbers.has(invoiceNumber)) {
      let suffix = 2;
      while (usedInvoiceNumbers.has(`${invoiceNumber}-${suffix}`)) suffix++;
      invoiceNumber = `${invoiceNumber}-${suffix}`;
    }
    usedInvoiceNumbers.add(invoiceNumber);

    const notesParts = [`WO #${inv.wo}`];
    if (inv.woDescription) notesParts.push(`Description: ${inv.woDescription}`);
    if (inv.summary) notesParts.push(`Summary: ${inv.summary}`);
    notesParts.push(`Imported from QuickBooks export. Original status: ${inv.originalStatus}.`);

    await prisma.invoice.create({
      data: {
        invoiceNumber,
        customerId: customer.id,
        status: inv.status,
        dueDate: inv.dueDate,
        subtotal: inv.total,
        taxRate: 0,
        taxAmount: 0,
        total: inv.total,
        amountPaid: inv.amountPaid,
        balance: inv.balance,
        notes: notesParts.join("\n\n"),
        createdById: manager.id,
        // A handful of rows have no Date at all in the source (still-pending
        // invoices with nothing filled in yet) -- createdAt isn't nullable,
        // so fall back to letting it default to now() rather than crash.
        createdAt: inv.date || undefined,
        sentAt: inv.date,
        paidAt: inv.status === "paid" ? inv.date : null,
      },
    });
    invoicesImported++;
  }
  console.log(
    `  Imported ${invoicesImported} invoices (${invoicesSkipped} skipped).`,
  );

  // ── Link work orders back to invoices/quotes ──────────────────
  // The work-orders import above recorded which Job corresponds to each
  // original Invoice #/Quote # reference; now that both real invoices and
  // real quotes exist, backfill jobId on the ones that match. References
  // that don't match (invoices/quotes outside those exports' date ranges)
  // were already preserved in the job's notes, so nothing is lost either way.
  console.log("  Linking work orders to invoices/quotes...");
  let invoiceLinks = 0;
  for (const [invoiceRef, jobId] of jobIdByInvoiceRef) {
    const result = await prisma.invoice.updateMany({
      where: { invoiceNumber: invoiceRef },
      data: { jobId },
    });
    invoiceLinks += result.count;
  }
  let quoteLinks = 0;
  for (const [quoteRef, jobId] of jobIdByQuoteRef) {
    const result = await prisma.estimate.updateMany({
      where: { estimateNumber: quoteRef },
      data: { jobId },
    });
    quoteLinks += result.count;
  }
  console.log(
    `  Linked ${invoiceLinks} invoices and ${quoteLinks} quotes to their work order.`,
  );

  // ── Payments ─────────────────────────────────────────────────────────────────────
  console.log("  Creating payments...");
  await Promise.all([
    prisma.payment.create({
      data: {
        invoiceId: invoice1.id,
        customerId: customer3.id,
        amount: 875,
        method: "card",
        status: "completed",
        referenceNumber: "CC-TXN-00421",
        notes: "Visa ending in 4242",
        paidAt: daysOffset(-1, 15),
      },
    }),
    prisma.payment.create({
      data: {
        invoiceId: invoice2.id,
        customerId: customer1.id,
        amount: 295,
        method: "check",
        status: "completed",
        referenceNumber: "CHK-1042",
        notes: "Personal check, cleared same day",
        paidAt: daysOffset(-7, 14, 15),
      },
    }),
    prisma.payment.create({
      data: {
        invoiceId: invoice3.id,
        customerId: customer2.id,
        amount: 180,
        method: "cash",
        status: "completed",
        notes: "Cash payment collected on-site",
        paidAt: daysOffset(-14, 15),
      },
    }),
  ]);

  // ── Pricebook ─────────────────────────────────────────────────────────────────
  console.log("  Creating pricebook categories and items...");
  const [catHVAC, catPlumbing, catLabor] = await Promise.all([
    prisma.pricebookCategory.create({
      data: {
        name: "HVAC Services",
        description: "Heating, ventilation, and air conditioning services",
        sortOrder: 1,
      },
    }),
    prisma.pricebookCategory.create({
      data: {
        name: "Plumbing Services",
        description: "Plumbing repair and installation services",
        sortOrder: 2,
      },
    }),
    prisma.pricebookCategory.create({
      data: { name: "Labor", description: "Labor rate codes", sortOrder: 4 },
    }),
  ]);

  await Promise.all([
    // HVAC Services
    prisma.pricebookItem.create({
      data: {
        categoryId: catHVAC.id,
        sku: "HVAC-DIAG",
        name: "HVAC Diagnostic",
        description: "Complete diagnostic evaluation of HVAC system",
        type: "service",
        unitPrice: 95,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catHVAC.id,
        sku: "HVAC-MAINT-RES",
        name: "Residential HVAC Tune-Up",
        description: "Annual residential HVAC maintenance and inspection",
        type: "service",
        unitPrice: 189,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catHVAC.id,
        sku: "HVAC-MAINT-COM",
        name: "Commercial HVAC Inspection (per unit)",
        description: "Commercial HVAC unit maintenance and inspection",
        type: "service",
        unitPrice: 275,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catHVAC.id,
        sku: "AC-REFILL-410A",
        name: "R-410A Refrigerant (per lb)",
        description: "R-410A refrigerant recharge",
        type: "material",
        unitCost: 15,
        unitPrice: 55,
        unit: "pound",
        taxable: true,
      },
    }),

    // Plumbing Services
    prisma.pricebookItem.create({
      data: {
        categoryId: catPlumbing.id,
        sku: "PLMB-DIAG",
        name: "Plumbing Diagnostic",
        description: "Plumbing system inspection and leak detection",
        type: "service",
        unitPrice: 85,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catPlumbing.id,
        sku: "WH-INSTALL-GAS",
        name: "Gas Water Heater Installation",
        description:
          "Standard gas water heater replacement (does not include unit)",
        type: "service",
        unitPrice: 650,
        unit: "each",
        taxable: false,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catPlumbing.id,
        sku: "PIPE-REPAIR-STD",
        name: "Standard Pipe Repair",
        description: "Repair minor pipe leak or joint (1 hour)",
        type: "service",
        unitPrice: 185,
        unit: "each",
        taxable: false,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catPlumbing.id,
        sku: "SVC-CALL",
        name: "Service Call Fee",
        description: "Minimum service call charge",
        type: "service",
        unitPrice: 45,
        unit: "each",
        taxable: true,
      },
    }),

    // Labor
    prisma.pricebookItem.create({
      data: {
        categoryId: catLabor.id,
        sku: "LABOR-STD",
        name: "Standard Labor Rate",
        description: "Standard hourly labor rate (M-F 8am-5pm)",
        type: "labor",
        unitPrice: 105,
        unit: "hour",
        taxable: false,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catLabor.id,
        sku: "LABOR-OT",
        name: "Overtime / After-Hours Labor",
        description: "Labor rate for evenings, weekends, and holidays",
        type: "labor",
        unitPrice: 158,
        unit: "hour",
        taxable: false,
      },
    }),
  ]);

  // ── Parts & equipment catalog (real data) ───────────────────────────────────
  // Sourced from prisma/seed-data/pricebook-items.csv — a QuickBooks "Items"
  // export. This replaces the old hand-written "Parts & Materials" demo items
  // with the real catalog so it survives every reseed. To refresh, drop a new
  // export at that path (same column headers) and re-run the seed.
  console.log("  Importing parts/equipment catalog from CSV...");
  const catalogRows = parseItemsCsv(
    path.join(__dirname, "seed-data", "pricebook-items.csv"),
  );

  // Category names use QuickBooks' "Parent:Child" convention (e.g.
  // "Material:Refrigeration"). Build the two top-level categories plus each
  // distinct child, in the order first seen, and cache their generated ids.
  const catalogCategoryIds = new Map(); // "Equipment" | "Material:Belts" | ... -> id
  let catalogSortOrder = 10;

  async function getCatalogCategoryId(rawCategory) {
    const category = (rawCategory || "").trim();
    if (!category) return null;
    if (catalogCategoryIds.has(category)) return catalogCategoryIds.get(category);

    const [topName, childName] = category.split(":").map((s) => s.trim());

    let topId = catalogCategoryIds.get(topName);
    if (!topId) {
      const topCat = await prisma.pricebookCategory.create({
        data: { name: topName, sortOrder: catalogSortOrder++ },
      });
      topId = topCat.id;
      catalogCategoryIds.set(topName, topId);
    }

    if (!childName) {
      catalogCategoryIds.set(category, topId);
      return topId;
    }

    const childCat = await prisma.pricebookCategory.create({
      data: { name: childName, parentId: topId, sortOrder: catalogSortOrder++ },
    });
    catalogCategoryIds.set(category, childCat.id);
    return childCat.id;
  }

  const catalogItemsData = [];
  for (const row of catalogRows) {
    const categoryId = await getCatalogCategoryId(row.category);
    const name = row.description || row.itemName;
    catalogItemsData.push({
      categoryId,
      sku: row.itemName,
      name,
      description: row.description || null,
      vendorPartNumber: row.mfgPartNumber || null,
      type: row.category.startsWith("Equipment") ? "equipment" : "part",
      unitPrice: row.rate,
    });
  }

  await prisma.pricebookItem.createMany({
    data: catalogItemsData,
    skipDuplicates: true,
  });
  console.log(`  Imported ${catalogItemsData.length} catalog items.`);

  // ── Vendors ──────────────────────────────────────────────────────
  console.log("  Creating vendors...");
  const [supplyCo, coolParts] = await Promise.all([
    prisma.vendor.create({
      data: {
        vendorNumber: "VEN-1001",
        name: "Atlanta HVAC Supply Co.",
        contactName: "Dana Reyes",
        email: "orders@atlhvacsupply.com",
        phone: "404-555-0110",
        address1: "500 Industrial Blvd",
        city: "Atlanta",
        state: "GA",
        zip: "30318",
        paymentTerms: "Net 30",
        isActive: true,
      },
    }),
    prisma.vendor.create({
      data: {
        vendorNumber: "VEN-1002",
        name: "CoolParts Distribution",
        contactName: "Marcus Webb",
        email: "sales@coolparts.com",
        phone: "770-555-0145",
        address1: "88 Commerce Way",
        city: "Marietta",
        state: "GA",
        zip: "30060",
        paymentTerms: "Net 15",
        isActive: true,
      },
    }),
  ]);

  // ── Stock Locations (warehouse + trucks) ──────────────────────────────────────
  console.log("  Creating stock locations...");
  const mainWarehouse = await prisma.stockLocation.create({
    data: {
      name: "Main Warehouse",
      code: "WH",
      type: "warehouse",
      address: "1234 Main Street Suite 100, Atlanta, GA 30301",
      isDefault: true,
      isActive: true,
    },
  });
  const [truck101, truck102] = await Promise.all([
    prisma.stockLocation.create({
      data: {
        name: "Truck 101",
        code: "TRK101",
        type: "truck",
        vehicleId: truck1.id,
        isActive: true,
      },
    }),
    prisma.stockLocation.create({
      data: {
        name: "Van 102",
        code: "TRK102",
        type: "truck",
        vehicleId: van2.id,
        isActive: true,
      },
    }),
  ]);

  // ── Inventory items ───────────────────────────────────────────────────────────
  // Each entry seeds the item plus per-location stock (warehouse + trucks) and a
  // primary-vendor catalog price. unitCost is the perpetual weighted-average.
  console.log("  Creating inventory items, stock and vendor pricing...");
  const inventorySeed = [
    {
      sku: "FILT-1625",
      name: "Air Filter MERV-13 16x25x1",
      unitCost: 7,
      reorderPoint: 20,
      reorderQuantity: 50,
      vendor: supplyCo,
      wh: 40,
      t1: 6,
      t2: 2,
    },
    {
      sku: "FILT-2020",
      name: "Air Filter MERV-13 20x20x1",
      unitCost: 7,
      reorderPoint: 20,
      reorderQuantity: 50,
      vendor: supplyCo,
      wh: 30,
      t1: 4,
      t2: 2,
    },
    {
      sku: "FILT-2025",
      name: "Air Filter MERV-13 20x25x1",
      unitCost: 8,
      reorderPoint: 12,
      reorderQuantity: 30,
      vendor: supplyCo,
      wh: 14,
      t1: 3,
      t2: 1,
    },
    {
      sku: "REF-410A-25",
      name: "R-410A Refrigerant 25-lb Cylinder",
      unitCost: 175,
      reorderPoint: 3,
      reorderQuantity: 6,
      vendor: coolParts,
      wh: 4,
      t1: 1,
      t2: 1,
    },
    {
      sku: "CAP-45-5",
      name: "Dual Run Capacitor 45/5 MFD",
      unitCost: 18,
      reorderPoint: 5,
      reorderQuantity: 10,
      vendor: coolParts,
      wh: 11,
      t1: 3,
      t2: 1,
    },
    {
      sku: "CONT-40A-1P",
      name: "Contactor 40A Single Pole",
      unitCost: 16,
      reorderPoint: 4,
      reorderQuantity: 8,
      vendor: coolParts,
      wh: 3,
      t1: 1,
      t2: 0,
    },
    {
      sku: "WIRE-18-8",
      name: "Thermostat Wire 18/8 100ft",
      unitCost: 34,
      reorderPoint: 2,
      reorderQuantity: 5,
      vendor: supplyCo,
      wh: 4,
      t1: 1,
      t2: 0,
    },
    {
      sku: "PVC-075-10",
      name: 'PVC Condensate Drain Pipe 3/4" (10ft)',
      unitCost: 4.5,
      reorderPoint: 10,
      reorderQuantity: 20,
      vendor: supplyCo,
      wh: 26,
      t1: 3,
      t2: 1,
    },
    {
      sku: "FAUC-CART-UNI",
      name: "Universal Faucet Cartridge",
      unitCost: 11,
      reorderPoint: 8,
      reorderQuantity: 15,
      vendor: coolParts,
      wh: 20,
      t1: 1,
      t2: 1,
    },
    {
      sku: "NEST-3G-CHAR",
      name: "Nest Learning Thermostat 3rd Gen (Charcoal)",
      unitCost: 179,
      reorderPoint: 2,
      reorderQuantity: 5,
      vendor: coolParts,
      wh: 3,
      t1: 0,
      t2: 0,
      serialized: true,
    },
  ];

  const itemsBySku = {};
  for (const row of inventorySeed) {
    const item = await prisma.inventoryItem.create({
      data: {
        sku: row.sku,
        name: row.name,
        unit: "each",
        unitCost: row.unitCost,
        reorderPoint: row.reorderPoint,
        reorderQuantity: row.reorderQuantity,
        isSerialized: row.serialized ?? false,
        defaultVendorId: row.vendor.id,
        isActive: true,
        stock: {
          create: [
            { stockLocationId: mainWarehouse.id, quantityOnHand: row.wh },
            { stockLocationId: truck101.id, quantityOnHand: row.t1 },
            { stockLocationId: truck102.id, quantityOnHand: row.t2 },
          ],
        },
        vendors: {
          create: {
            vendorId: row.vendor.id,
            unitCost: row.unitCost,
            isPrimary: true,
            isActive: true,
          },
        },
      },
    });
    itemsBySku[row.sku] = item;
  }

  // ── Sample purchase order + receipt (received into the warehouse) ──────────────
  console.log("  Creating a sample purchase order...");
  const capItem = itemsBySku["CAP-45-5"];
  const samplePO = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-1001",
      vendorId: coolParts.id,
      status: "received",
      shipToLocationId: mainWarehouse.id,
      orderDate: new Date(),
      receivedDate: new Date(),
      subtotal: 180,
      totalAmount: 180,
      lines: {
        create: {
          inventoryItemId: capItem.id,
          lineType: "inventory",
          lineNumber: 1,
          description: "Dual Run Capacitor 45/5 MFD",
          quantity: 10,
          unitPrice: 18,
          totalPrice: 180,
          receivedQuantity: 10,
        },
      },
    },
    include: { lines: true },
  });
  await prisma.pOLineReceipt.create({
    data: {
      poLineId: samplePO.lines[0].id,
      receiptNumber: "RCPT-1001",
      quantityReceived: 10,
      unitCost: 18,
      totalCost: 180,
      stockLocationId: mainWarehouse.id,
      status: "active",
      documentNumber: "PACK-55021",
    },
  });

  // ── Sample serialized unit (a Nest thermostat on hand in the warehouse) ────────
  const nest = itemsBySku["NEST-3G-CHAR"];
  await prisma.serializedUnit.create({
    data: {
      serialNumber: "NEST3G-000117",
      inventoryItemId: nest.id,
      status: "in_stock",
      stockLocationId: mainWarehouse.id,
      purchaseCost: 179,
      warrantyMonths: 24,
    },
  });

  // ── Pricing tier override (demo) ──────────────────────────────────────
  console.log("  Creating a demo pricing tier override...");
  const commercialInspectionItem = await prisma.pricebookItem.findUnique({
    where: { sku: "HVAC-MAINT-COM" },
  });
  if (commercialInspectionItem) {
    await prisma.pricingTierOverride.create({
      data: {
        pricingTierId: commercialPreferredTier.id,
        pricebookItemId: commercialInspectionItem.id,
        overrideType: "fixed_price",
        overrideValue: 99,
      },
    });
  }

  // ── Service Agreements ────────────────────────────────────────────────────────
  console.log("  Creating service agreements...");
  await Promise.all([
    prisma.serviceAgreement.create({
      data: {
        agreementNumber: "AGR-1001",
        customerId: customer3.id,
        name: "TechCorp Commercial HVAC & Plumbing Maintenance Plan",
        status: "active",
        startDate: new Date(`${new Date().getFullYear()}-01-01`),
        endDate: new Date(`${new Date().getFullYear()}-12-31`),
        billingFrequency: "annual",
        amount: 4800,
        autoRenew: true,
        terms:
          "Includes 4 quarterly HVAC inspections, 4 quarterly plumbing inspections, and priority response within 2 hours.",
        nextBillingDate: new Date(`${new Date().getFullYear() + 1}-01-01`),
        visits: {
          create: [
            {
              name: "Q1 HVAC Inspection",
              scheduledDate: new Date(`${new Date().getFullYear()}-03-15`),
              status: "completed",
              completedDate: new Date(`${new Date().getFullYear()}-03-15`),
            },
            {
              name: "Q2 HVAC Inspection",
              scheduledDate: new Date(`${new Date().getFullYear()}-06-15`),
              status: "completed",
              completedDate: new Date(`${new Date().getFullYear()}-06-14`),
            },
            {
              name: "Q3 HVAC Inspection",
              scheduledDate: new Date(`${new Date().getFullYear()}-09-15`),
              status: "pending",
            },
            {
              name: "Q4 HVAC Inspection",
              scheduledDate: new Date(`${new Date().getFullYear()}-12-15`),
              status: "pending",
            },
          ],
        },
      },
    }),

    prisma.serviceAgreement.create({
      data: {
        agreementNumber: "AGR-1002",
        customerId: customer1.id,
        name: "Residential Comfort Plan - Johnson",
        status: "active",
        startDate: new Date(`${new Date().getFullYear()}-03-01`),
        endDate: new Date(`${new Date().getFullYear() + 1}-02-28`),
        billingFrequency: "monthly",
        amount: 29.99,
        autoRenew: true,
        terms:
          "Includes annual tune-up, priority scheduling, and 15% discount on all repairs.",
        nextBillingDate: new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          1,
        ),
        visits: {
          create: [
            {
              name: "Annual HVAC Tune-Up",
              scheduledDate: daysOffset(14, 9),
              status: "pending",
            },
          ],
        },
      },
    }),
  ]);

  // ── Campaigns ─────────────────────────────────────────────────────────────────
  console.log("  Creating campaigns...");
  await Promise.all([
    prisma.campaign.create({
      data: {
        name: "Summer AC Special 2024",
        type: "direct_mail",
        status: "active",
        budget: 5000,
        startDate: new Date(`${new Date().getFullYear()}-06-01`),
        endDate: new Date(`${new Date().getFullYear()}-08-31`),
        trackingNumber: "(404) 555-COOL",
        notes:
          "Summer AC maintenance promotion. Mailer to 5,000 homes in service area. Offer: $30 off AC tune-up.",
      },
    }),
    prisma.campaign.create({
      data: {
        name: "Google Ads - HVAC & Plumbing",
        type: "google",
        status: "active",
        budget: 2000,
        startDate: new Date(`${new Date().getFullYear()}-01-01`),
        trackingNumber: "(404) 555-HVAC",
        notes:
          'Google Search Ads targeting "AC repair Atlanta", "plumber near me", and related terms. Budget: $2,000/month.',
      },
    }),
  ]);

  // ── Notifications ─────────────────────────────────────────────────────────────
  console.log("  Creating sample notifications...");
  await Promise.all([
    prisma.notification.create({
      data: {
        userId: manager.id,
        title: "Urgent Job Created",
        message:
          "Emergency burst pipe job JOB-1005 created for Brown Properties - needs immediate assignment.",
        type: "warning",
        link: `/jobs/${job5.id}`,
        isRead: false,
      },
    }),
    prisma.notification.create({
      data: {
        userId: manager.id,
        title: "Invoice Paid",
        message:
          "Invoice INV-1001 for $949.38 has been paid by TechCorp Solutions.",
        type: "success",
        link: `/invoices/${invoice1.id}`,
        isRead: false,
      },
    }),
    prisma.notification.create({
      data: {
        userId: admin.id,
        title: "Estimate Approved",
        message:
          "Susan Thompson approved estimate EST-1001 for $8,137.50 (New HVAC Installation).",
        type: "success",
        link: `/estimates/${estimate1.id}`,
        isRead: true,
      },
    }),
    prisma.notification.create({
      data: {
        userId: tech1User.id,
        title: "New Job Assigned",
        message:
          "You have been assigned to JOB-1001 - AC not cooling, scheduled for today at 9:00 AM.",
        type: "info",
        link: `/jobs/${job1.id}`,
        isRead: false,
      },
    }),
  ]);

  // ── Equipment (customer assets) ───────────────────────────────────────────────
  console.log("  Creating equipment / customer assets...");
  const eqYear = new Date().getFullYear();
  const eqMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  await Promise.all([
    prisma.equipment.create({
      data: {
        customerId: customer1.id,
        locationId: customer1.locations[0].id,
        name: "Carrier 3-Ton AC Condenser",
        type: "ac_unit",
        manufacturer: "Carrier",
        model: "24ACC636A003",
        serialNumber: "CAR-AC-0098213",
        installDate: new Date(`${eqYear - 6}-05-12`),
        warrantyExpiry: new Date(`${eqYear - 1}-05-12`),
        condition: "fair",
        notes: "Original unit. Low-refrigerant history; monitor each season.",
      },
    }),
    prisma.equipment.create({
      data: {
        customerId: customer1.id,
        locationId: customer1.locations[0].id,
        jobId: job6.id,
        name: "Nest Learning Thermostat (3rd Gen)",
        type: "thermostat",
        manufacturer: "Google Nest",
        model: "T3007ES",
        serialNumber: "NEST-3G-44120A",
        installDate: daysOffset(-7),
        warrantyExpiry: new Date(`${eqYear + 1}-06-01`),
        condition: "excellent",
        notes: "Installed during JOB-1006. Wi-Fi connected.",
      },
    }),
    prisma.equipment.create({
      data: {
        customerId: customer3.id,
        locationId: customer3.locations[0].id,
        name: "Rooftop Unit RTU-3",
        type: "hvac",
        manufacturer: "Trane",
        model: "YHC060F",
        serialNumber: "TRN-RTU3-551204",
        installDate: new Date(`${eqYear - 9}-03-01`),
        warrantyExpiry: new Date(`${eqYear - 4}-03-01`),
        condition: "good",
        notes: "Coils cleaned during annual maintenance (JOB-1003).",
      },
    }),
    prisma.equipment.create({
      data: {
        customerId: customer3.id,
        locationId: customer3.locations[0].id,
        name: "Rooftop Unit RTU-2",
        type: "hvac",
        manufacturer: "Trane",
        model: "YHC060F",
        serialNumber: "TRN-RTU2-551199",
        installDate: new Date(`${eqYear - 9}-03-01`),
        warrantyExpiry: new Date(`${eqYear - 4}-03-01`),
        condition: "poor",
        notes:
          "Capacitor showing wear — recommend replacement within 6 months.",
      },
    }),
    prisma.equipment.create({
      data: {
        customerId: customer4.id,
        locationId: customer4.locations[0].id,
        jobId: job4.id,
        name: "Carrier 3-Ton Heat Pump (16 SEER)",
        type: "heat_pump",
        manufacturer: "Carrier",
        model: "24PAA336",
        serialNumber: "CAR-HP-7781002",
        installDate: daysOffset(1),
        warrantyExpiry: new Date(`${eqYear + 10}-${eqMonth}-01`),
        condition: "excellent",
        notes: "New install per EST-1001. 10-year parts warranty.",
      },
    }),
    prisma.equipment.create({
      data: {
        customerId: customer5.id,
        locationId: customer5.locations[0].id,
        name: "Rheem 50-Gal Commercial Water Heater",
        type: "water_heater",
        manufacturer: "Rheem",
        model: "G100-80",
        serialNumber: "RHM-WH-330815",
        installDate: new Date(`${eqYear - 2}-08-20`),
        warrantyExpiry: new Date(`${eqYear + 4}-08-20`),
        condition: "good",
        notes: "Office Complex A mechanical room.",
      },
    }),
  ]);

  // ── Real equipment (from QuickBooks-adjacent export) ─────────────────
  // Sourced from prisma/seed-data/equipment.csv (2026-07-16 export, which
  // added Comments/Additional Info/Serial Number columns over the 07-15
  // version -- Comments is a manufacturer/spec description -> description;
  // Additional Info is where/how this specific unit was installed -> notes;
  // Serial Number -> serialNumber. Parts vs. labor warranty are both real,
  // distinct dates now (see the Equipment model), not folded into notes.
  // Each row references its customer by the ORIGINAL (pre-dedup) per-property
  // name, resolved via resolveCustomerByRawName(). For customers with
  // multiple locations (the merge groups from the customers import),
  // rawNameToAddress lets us pick the specific location this unit was
  // installed at instead of defaulting to the first one. `type` is
  // free-text/customizable in this app, so the source's type string
  // ("Air Handler", "Condenser", ...) is kept as-is.
  console.log("  Importing equipment from CSV...");
  const importedEquipment = parseEquipmentCsv(
    path.join(__dirname, "seed-data", "equipment.csv"),
  );
  let equipmentImported = 0;
  let equipmentSkipped = 0;
  for (const eq of importedEquipment) {
    const customer = resolveCustomerByRawName(eq.customerRawName);
    if (!customer) {
      equipmentSkipped++;
      console.warn(
        `    No customer match for equipment "${eq.name}" ("${eq.customerRawName}") - skipped.`,
      );
      continue;
    }

    const mappedAddress = rawNameToAddress.get(
      normalizeCustomerName(eq.customerRawName),
    );
    const locationId = findMatchingLocationId(
      customer,
      mappedAddress ? parseFullAddress(mappedAddress) : null,
    );

    await prisma.equipment.create({
      data: {
        customerId: customer.id,
        locationId,
        name: eq.name,
        type: eq.type,
        manufacturer: eq.manufacturer,
        model: eq.model,
        serialNumber: eq.serialNumber,
        description: eq.description,
        installDate: eq.installDate,
        warrantyExpiry: eq.warrantyExpiry,
        partsWarrantyExpiry: eq.partsWarrantyExpiry,
        replaceByDate: eq.replaceBy,
        notes: eq.notes,
      },
    });
    equipmentImported++;
  }
  console.log(
    `  Imported ${equipmentImported} equipment records (${equipmentSkipped} skipped).`,
  );

  // ── Calls (phone log / call tracking) ────────────────────────────────
  console.log("  Creating call logs...");
  await Promise.all([
    prisma.call.create({
      data: {
        customerId: customer1.id,
        direction: "inbound",
        status: "completed",
        fromNumber: "(770) 555-1001",
        toNumber: "(404) 555-0100",
        duration: 245,
        reason: "AC not cooling - scheduling service",
        handledById: manager.id,
        notes: "Customer reports AC running but not cooling. Booked JOB-1001.",
        createdAt: daysOffset(0, 8, 15),
      },
    }),
    prisma.call.create({
      data: {
        customerId: customer5.id,
        direction: "inbound",
        status: "completed",
        fromNumber: "(678) 555-5001",
        toNumber: "(404) 555-0100",
        duration: 95,
        reason: "Emergency - burst pipe",
        handledById: manager.id,
        notes: "Dispatched emergency JOB-1005 to Office Complex A.",
        createdAt: daysOffset(0, 7, 50),
      },
    }),
    prisma.call.create({
      data: {
        customerId: customer2.id,
        direction: "outbound",
        status: "completed",
        fromNumber: "(404) 555-0100",
        toNumber: "(678) 555-2001",
        duration: 60,
        reason: "Appointment reminder",
        handledById: manager.id,
        notes: "Reminded customer of water heater replacement appointment.",
        createdAt: daysOffset(0, 9, 5),
      },
    }),
    prisma.call.create({
      data: {
        customerId: customer3.id,
        direction: "inbound",
        status: "completed",
        fromNumber: "(404) 555-3001",
        toNumber: "(404) 555-0100",
        duration: 180,
        reason: "Quarterly maintenance question",
        handledById: manager.id,
        notes: "Confirmed Q3 inspection date per service agreement.",
        createdAt: daysOffset(-1, 10, 30),
      },
    }),
    prisma.call.create({
      data: {
        customerId: customer4.id,
        direction: "inbound",
        status: "voicemail",
        fromNumber: "(770) 555-4001",
        toNumber: "(404) 555-0100",
        duration: 30,
        reason: "Question about HVAC install estimate",
        notes: "Voicemail: wants to discuss EST-1001. Needs callback.",
        createdAt: daysOffset(-1, 16, 45),
      },
    }),
    prisma.call.create({
      data: {
        direction: "inbound",
        status: "missed",
        fromNumber: "(770) 555-9876",
        toNumber: "(404) 555-0100",
        reason: "Missed call - no voicemail left",
        createdAt: daysOffset(0, 12, 10),
      },
    }),
  ]);

  // ── Customer messages (lightweight comms log, not marketing campaigns) ────────
  console.log("  Creating customer message log...");
  await Promise.all([
    prisma.customerMessage.create({
      data: {
        customerId: customer1.id,
        direction: "outbound",
        channel: "sms",
        body: "Hi Robert, this is Prime Comfort Solutions confirming your HVAC tune-up tomorrow between 9-11am. Reply STOP to opt out.",
        sentById: manager.id,
        sentAt: daysOffset(-1, 14, 0),
      },
    }),
    prisma.customerMessage.create({
      data: {
        customerId: customer3.id,
        direction: "outbound",
        channel: "email",
        subject: "Invoice INV-1001 attached",
        body: "Hi David, attached is your invoice for the recent HVAC inspection. Let us know if you have any questions.",
        sentById: manager.id,
        sentAt: daysOffset(-2, 9, 30),
      },
    }),
    prisma.customerMessage.create({
      data: {
        customerId: customer2.id,
        direction: "inbound",
        channel: "sms",
        body: "Can we push tomorrow's appointment to the afternoon?",
        sentAt: daysOffset(0, 8, 5),
      },
    }),
  ]);

  console.log("\n✅ Seed completed successfully!");
  console.log(
    "\n  Seed login credentials (dev-only defaults -- override via\n" +
      "  SEED_ADMIN_PASSWORD / SEED_EMPLOYEE_PASSWORD / BREAKGLASS_ADMIN_PASSWORD\n" +
      "  for any real deployment):",
  );
  console.log("  ┌───────────────────────────────────────────────┐");
  console.log("  │  darryl@primecomfortac.com     / admin123 (admin)      │");
  console.log("  │  iris@primecomfortac.com       / pass123  (admin)      │");
  console.log("  │  charlie@primecomfortac.com    / pass123  (technician) │");
  console.log("  │  …all other employees          / pass123               │");
  console.log("  │  sysadmin@pulseservice.local   / changeme-breakglass-123 │");
  console.log("  └──────────────────────────────────────────────────┘\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
