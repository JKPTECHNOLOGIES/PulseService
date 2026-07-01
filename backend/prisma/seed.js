require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { LOOKUPS } = require("../src/constants/lookups");
const { DEFAULT_ROLE_PERMISSIONS } = require("../src/constants/permissions");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // ── Cleanup (reverse dependency order) ───────────────────────────────────────
  console.log("  Cleaning existing data...");
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.warehouse.deleteMany();
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
  await prisma.contact.deleteMany();
  await prisma.location.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.technician.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pricebookItem.deleteMany();
  await prisma.pricebookCategory.deleteMany();
  await prisma.businessUnit.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.companySettings.deleteMany();
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
      name: "PulseService HVAC & Plumbing",
      address: "1234 Main Street Suite 100",
      city: "Atlanta",
      state: "GA",
      zip: "30301",
      phone: "(404) 555-0100",
      email: "info@pulseservice.com",
      website: "https://pulseservice.com",
      taxRate: 0.085,
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
    },
  });

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
  const adminHash = await bcrypt.hash("admin123", SALT_ROUNDS);
  const passHash = await bcrypt.hash("pass123", SALT_ROUNDS);

  const [admin, dispatcher, tech1User, tech2User, tech3User, csr] =
    await Promise.all([
      prisma.user.create({
        data: {
          email: "admin@pulseservice.com",
          password: adminHash,
          firstName: "John",
          lastName: "Admin",
          role: "admin",
          phone: "(404) 555-0001",
        },
      }),
      prisma.user.create({
        data: {
          email: "dispatcher@pulseservice.com",
          password: passHash,
          firstName: "Sarah",
          lastName: "Dispatch",
          role: "dispatcher",
          phone: "(404) 555-0002",
        },
      }),
      prisma.user.create({
        data: {
          email: "tech1@pulseservice.com",
          password: passHash,
          firstName: "Mike",
          lastName: "Rivera",
          role: "technician",
          phone: "(404) 555-0201",
        },
      }),
      prisma.user.create({
        data: {
          email: "tech2@pulseservice.com",
          password: passHash,
          firstName: "Carlos",
          lastName: "Mendez",
          role: "technician",
          phone: "(404) 555-0202",
        },
      }),
      prisma.user.create({
        data: {
          email: "tech3@pulseservice.com",
          password: passHash,
          firstName: "Lisa",
          lastName: "Chen",
          role: "technician",
          phone: "(404) 555-0203",
        },
      }),
      prisma.user.create({
        data: {
          email: "csr@pulseservice.com",
          password: passHash,
          firstName: "Amy",
          lastName: "Johnson",
          role: "csr",
          phone: "(404) 555-0003",
        },
      }),
    ]);

  // ── Technicians ───────────────────────────────────────────────────────────────
  console.log("  Creating technician profiles...");
  const [tech1, tech2, tech3] = await Promise.all([
    prisma.technician.create({
      data: {
        userId: tech1User.id,
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
        userId: tech2User.id,
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
        userId: tech3User.id,
        employeeId: "EMP-003",
        skills: "Electrical,HVAC,Controls",
        zones: "West,Central",
        isAvailable: true,
        currentLat: 33.756,
        currentLng: -84.401,
      },
    }),
  ]);

  // ── Customers ─────────────────────────────────────────────────────────────────
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
      createdById: dispatcher.id,
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
      createdById: dispatcher.id,
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
      createdById: dispatcher.id,
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
      createdById: csr.id,
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
      createdById: dispatcher.id,
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
      createdById: dispatcher.id,
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
      createdById: dispatcher.id,
    },
  });

  // ── Estimates ─────────────────────────────────────────────────────────────────
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
        taxRate: 8.5,
        taxAmount: 637.5,
        total: 8137.5,
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
        taxRate: 8.5,
        taxAmount: 39.1,
        total: 499.1,
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
        taxRate: 8.5,
        taxAmount: 157.25,
        total: 2007.25,
        createdById: dispatcher.id,
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
        taxRate: 8.5,
        taxAmount: 74.375,
        total: 949.375,
        amountPaid: 949.375,
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
        taxRate: 8.5,
        taxAmount: 25.075,
        total: 320.075,
        amountPaid: 320.075,
        balance: 0,
        paidAt: daysOffset(-7, 14, 15),
        sentAt: daysOffset(-7, 14, 10),
        createdById: dispatcher.id,
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
        taxRate: 8.5,
        taxAmount: 15.3,
        total: 195.3,
        amountPaid: 195.3,
        balance: 0,
        paidAt: daysOffset(-14, 15),
        sentAt: daysOffset(-14, 14, 55),
        createdById: dispatcher.id,
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
        taxRate: 8.5,
        taxAmount: 637.5,
        total: 8137.5,
        balance: 8137.5,
        notes: "Deposit of $4,068.75 (50%) collected at time of scheduling.",
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

  // ── Payments ──────────────────────────────────────────────────────────────────
  console.log("  Creating payments...");
  await Promise.all([
    prisma.payment.create({
      data: {
        invoiceId: invoice1.id,
        customerId: customer3.id,
        amount: 949.375,
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
        amount: 320.075,
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
        amount: 195.3,
        method: "cash",
        status: "completed",
        notes: "Cash payment collected on-site",
        paidAt: daysOffset(-14, 15),
      },
    }),
  ]);

  // ── Pricebook ─────────────────────────────────────────────────────────────────
  console.log("  Creating pricebook categories and items...");
  const [catHVAC, catPlumbing, catParts, catLabor] = await Promise.all([
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
      data: {
        name: "Parts & Materials",
        description: "Parts, materials, and supplies",
        sortOrder: 3,
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

    // Parts & Materials
    prisma.pricebookItem.create({
      data: {
        categoryId: catParts.id,
        sku: "FILT-MERV13-1625",
        name: "Air Filter MERV-13 16x25x1",
        description: "High-efficiency pleated air filter",
        type: "material",
        unitCost: 7,
        unitPrice: 25,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catParts.id,
        sku: "WH-50GAL-GAS",
        name: "50-Gal Gas Water Heater",
        description: "Rheem Performance 50-gal natural gas, 9-year warranty",
        type: "material",
        unitCost: 580,
        unitPrice: 1100,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catParts.id,
        sku: "FAUC-CART-UNIV",
        name: "Universal Faucet Cartridge",
        description: "Replacement cartridge compatible with major brands",
        type: "material",
        unitCost: 11,
        unitPrice: 48,
        unit: "each",
        taxable: true,
      },
    }),
    prisma.pricebookItem.create({
      data: {
        categoryId: catParts.id,
        sku: "CAP-45-5-MFD",
        name: "Run Capacitor 45/5 MFD",
        description: "Dual run capacitor for HVAC compressor/fan motor",
        type: "material",
        unitCost: 18,
        unitPrice: 75,
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

  // ── Warehouse & Inventory ─────────────────────────────────────────────────────
  console.log("  Creating warehouse and inventory...");
  const warehouse = await prisma.warehouse.create({
    data: {
      name: "Main Warehouse",
      address: "1234 Main Street Suite 100, Atlanta, GA 30301",
      isActive: true,
    },
  });

  await Promise.all([
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Air Filter MERV-13 16x25x1",
        sku: "FILT-1625",
        quantity: 48,
        reorderPoint: 20,
        reorderQuantity: 50,
        unitCost: 7,
        location: "Shelf A-1",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Air Filter MERV-13 20x20x1",
        sku: "FILT-2020",
        quantity: 36,
        reorderPoint: 20,
        reorderQuantity: 50,
        unitCost: 7,
        location: "Shelf A-2",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Air Filter MERV-13 20x25x1",
        sku: "FILT-2025",
        quantity: 18,
        reorderPoint: 12,
        reorderQuantity: 30,
        unitCost: 8,
        location: "Shelf A-3",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "R-410A Refrigerant 25-lb Cylinder",
        sku: "REF-410A-25",
        quantity: 6,
        reorderPoint: 3,
        reorderQuantity: 6,
        unitCost: 175,
        location: "Cage B-1",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Dual Run Capacitor 45/5 MFD",
        sku: "CAP-45-5",
        quantity: 15,
        reorderPoint: 5,
        reorderQuantity: 10,
        unitCost: 18,
        location: "Shelf C-3",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Contactor 40A Single Pole",
        sku: "CONT-40A-1P",
        quantity: 4,
        reorderPoint: 4,
        reorderQuantity: 8,
        unitCost: 16,
        location: "Shelf C-4",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Thermostat Wire 18/8 100ft",
        sku: "WIRE-18-8",
        quantity: 5,
        reorderPoint: 2,
        reorderQuantity: 5,
        unitCost: 34,
        location: "Shelf D-1",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: 'PVC Condensate Drain Pipe 3/4" (10ft)',
        sku: "PVC-075-10",
        quantity: 30,
        reorderPoint: 10,
        reorderQuantity: 20,
        unitCost: 4.5,
        location: "Rack E-1",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Universal Faucet Cartridge",
        sku: "FAUC-CART-UNI",
        quantity: 22,
        reorderPoint: 8,
        reorderQuantity: 15,
        unitCost: 11,
        location: "Shelf F-2",
      },
    }),
    prisma.inventoryItem.create({
      data: {
        warehouseId: warehouse.id,
        name: "Nest Learning Thermostat 3rd Gen (Charcoal)",
        sku: "NEST-3G-CHAR",
        quantity: 3,
        reorderPoint: 2,
        reorderQuantity: 5,
        unitCost: 179,
        location: "Secure G-1",
      },
    }),
  ]);

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
        userId: dispatcher.id,
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
        userId: dispatcher.id,
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

  // ── Calls (phone log / call tracking) ─────────────────────────────────────────
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
        handledById: csr.id,
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
        handledById: csr.id,
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
        handledById: dispatcher.id,
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
        handledById: dispatcher.id,
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

  console.log("\n✅ Seed completed successfully!");
  console.log("\n  Test credentials:");
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │  admin@pulseservice.com   / admin123  (admin)   │");
  console.log("  │  dispatcher@pulseservice.com / pass123          │");
  console.log("  │  tech1@pulseservice.com   / pass123  (Mike R.)  │");
  console.log("  │  tech2@pulseservice.com   / pass123  (Carlos M.)│");
  console.log("  │  tech3@pulseservice.com   / pass123  (Lisa C.)  │");
  console.log("  │  csr@pulseservice.com     / pass123             │");
  console.log("  └─────────────────────────────────────────────────┘\n");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
