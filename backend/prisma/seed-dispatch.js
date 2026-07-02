/**
 * Fills the dispatch board for the current week.
 *
 * The board shows one day at a time, so the spread-out demo jobs look sparse.
 * This creates a dense, realistic week (today + next 6 days) of scheduled jobs
 * staggered across every technician, so the board/calendar looks full for demos.
 *
 * Idempotent: skips if today already has a full board.
 *
 *   docker compose exec backend node prisma/seed-dispatch.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const SUMMARIES = [
  "AC not cooling — service call",
  "Seasonal maintenance tune-up",
  "Water heater inspection",
  "Furnace repair",
  "Thermostat upgrade",
  "Drain line cleaning",
  "No-heat diagnostic",
  "Refrigerant top-off",
  "Duct inspection",
  "Filter & coil cleaning",
  "Compressor check",
  "Install estimate visit",
];
const BUSINESS_UNITS = ["HVAC", "Plumbing", "Electrical"];
const SLOT_HOURS = [8, 9, 10, 11, 13, 14, 15, 16];

// A UTC-anchored timestamp for `dayOffset` days from today at `hour`, so it
// lands inside the board's UTC day window regardless of server timezone.
function utcSlot(dayOffset, hour) {
  const base = new Date();
  base.setDate(base.getDate() + dayOffset);
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      hour,
      0,
      0,
    ),
  );
}

async function main() {
  console.log("📅 Filling the dispatch board for this week...");

  const [technicians, customers, admin, settings] = await Promise.all([
    prisma.technician.findMany(),
    prisma.customer.findMany({ include: { locations: true } }),
    prisma.user.findFirst({ where: { role: "admin" } }),
    prisma.companySettings.findFirst(),
  ]);

  if (technicians.length === 0 || customers.length === 0) {
    console.log("  No technicians/customers found — run the base + demo seed first.");
    return;
  }

  // Idempotency: if today already has a busy board, don't pile on more.
  const todayStart = utcSlot(0, 0);
  const todayEnd = utcSlot(0, 23);
  todayEnd.setUTCMinutes(59, 59, 999);
  const todayCount = await prisma.job.count({
    where: { scheduledStart: { gte: todayStart, lte: todayEnd } },
  });
  if (todayCount >= 10) {
    console.log(`  Board already full today (${todayCount} jobs). Skipping.`);
    return;
  }

  const jobPrefix = settings?.jobPrefix ?? "JOB";
  let nextJob = settings?.nextJobNumber ?? 500;
  const gen = (n) => `${jobPrefix}-${String(n).padStart(4, "0")}`;

  let created = 0;
  // Today + next 6 days.
  for (let d = 0; d <= 6; d++) {
    // Give every technician a couple of stops per day.
    const slots = SLOT_HOURS.slice(0, Math.min(SLOT_HOURS.length, technicians.length + 3));
    for (let s = 0; s < slots.length; s++) {
      const tech = technicians[s % technicians.length];
      const customer = pick(customers);
      const loc = customer.locations[0];
      const start = utcSlot(d, slots[s]);
      const end = new Date(start.getTime() + (1 + Math.floor(Math.random() * 2)) * 3600000);
      const status =
        d === 0
          ? pick(["scheduled", "dispatched", "in_progress", "scheduled"])
          : pick(["scheduled", "scheduled", "new"]);
      await prisma.job.create({
        data: {
          jobNumber: gen(nextJob++),
          customerId: customer.id,
          locationId: loc?.id ?? null,
          type: pick(["service", "maintenance", "repair", "inspection", "installation"]),
          status,
          priority: pick(["low", "normal", "normal", "high", "urgent"]),
          summary: pick(SUMMARIES),
          description: "Scheduled visit (demo).",
          scheduledStart: start,
          scheduledEnd: end,
          businessUnit: pick(BUSINESS_UNITS),
          createdById: admin.id,
          technicians: {
            create: [{ technicianId: tech.id, isLead: true, status: "assigned" }],
          },
        },
      });
      created++;
    }
  }

  if (settings) {
    await prisma.companySettings.update({
      where: { id: settings.id },
      data: { nextJobNumber: nextJob },
    });
  }

  console.log(
    `✅ Added ${created} scheduled jobs across the week (${technicians.length} technicians).`,
  );
}

main()
  .catch((err) => {
    console.error("dispatch seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
