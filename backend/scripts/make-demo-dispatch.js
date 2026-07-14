/**
 * Demo dispatch-board seeder — creates 20 obviously-labeled TEST jobs that
 * exercise every feature the dispatch board can show:
 *   - assigned to techs (single + multi-tech), unassigned, and undated (backlog)
 *   - every status (new/scheduled/dispatched/in_progress/on_hold/completed)
 *   - every priority (low/normal/high/urgent) and type (service/installation/
 *     maintenance/inspection/repair/emergency)
 *   - scheduled start/end (timeline blocks), tags, notes, tech notes,
 *     completion notes, follow-up dates, totals, arrived/departed timestamps
 *   - real SE-Florida lat/lng so map pins render
 *
 * All test data is prefixed "TEST-"/"[TEST]" so it's obvious and easy to remove.
 * Idempotent: re-running wipes prior TEST data first.
 *
 * Run inside the backend container (has DATABASE_URL):
 *   docker exec pulseservice-backend node scripts/make-demo-dispatch.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const Y = 2026;
const M = 6; // July (0-indexed)
const dt = (day, h, min = 0) => new Date(Date.UTC(Y, M, day, h, min, 0));
const addH = (d, h) => new Date(d.getTime() + h * 3600 * 1000);

// 13:00–21:00 UTC == 9am–5pm EDT, keeping jobs on the intended calendar day.
const TEST_CUSTOMERS = [
  { label: "[TEST] Demo Residence", type: "residential", addr: "101 Demo Palm Way", city: "Jupiter", zip: "33458", lat: 26.934, lng: -80.094 },
  { label: "[TEST] Demo Plaza", type: "commercial", addr: "200 Demo Clematis St", city: "West Palm Beach", zip: "33401", lat: 26.715, lng: -80.053 },
  { label: "[TEST] Demo Estate", type: "residential", addr: "300 Demo Marsh Landing", city: "Palm Beach Gardens", zip: "33418", lat: 26.823, lng: -80.138 },
  { label: "[TEST] Demo Office", type: "commercial", addr: "400 Demo Federal Hwy", city: "Boca Raton", zip: "33432", lat: 26.368, lng: -80.1 },
  { label: "[TEST] Demo Clubhouse", type: "commercial", addr: "500 Demo Ocean Blvd", city: "Delray Beach", zip: "33483", lat: 26.461, lng: -80.072 },
  { label: "[TEST] Demo Condo", type: "residential", addr: "600 Demo Bay Dr", city: "Boynton Beach", zip: "33435", lat: 26.525, lng: -80.066 },
];

// day: July day (or null = undated backlog); start: UTC hour; dur: hours.
const SPECS = [
  { n: "TEST-001", summary: "[TEST] AC not cooling — diagnostic", type: "service", priority: "urgent", status: "in_progress", day: 14, start: 13, dur: 2, techs: ["Mike"], tags: "test,emergency,no-cool", techNotes: "[TEST] Warm air at all vents; checking refrigerant charge.", notes: "[TEST] Gate code 4432.", amount: 285 },
  { n: "TEST-002", summary: "[TEST] Emergency compressor failure", type: "emergency", priority: "urgent", status: "dispatched", day: 14, start: 15, dur: 3, techs: ["Carlos"], tags: "test,emergency", description: "[TEST] Rooftop unit down, tenant complaints.", amount: 1450 },
  { n: "TEST-003", summary: "[TEST] Quarterly maintenance visit", type: "maintenance", priority: "normal", status: "scheduled", day: 14, start: 14, min: 30, dur: 1.5, techs: ["Lisa"], tags: "test,maintenance-plan", notes: "[TEST] Covered under PSA agreement." },
  { n: "TEST-004", summary: "[TEST] New 4-ton system installation", type: "installation", priority: "high", status: "scheduled", day: 14, start: 16, dur: 4, techs: ["Mike", "Carlos"], tags: "test,install,2-tech", description: "[TEST] Full changeout — condenser + air handler.", amount: 8900 },
  { n: "TEST-005", summary: "[TEST] Thermostat replacement", type: "repair", priority: "low", status: "completed", day: 7, start: 13, dur: 1, techs: ["Lisa"], tags: "test", completionNotes: "[TEST] Installed smart thermostat, verified cooling cycle.", amount: 210 },
  { n: "TEST-006", summary: "[TEST] Duct inspection", type: "inspection", priority: "normal", status: "completed", day: 9, start: 15, dur: 2, techs: ["Mike"], tags: "test,inspection", completionNotes: "[TEST] Minor leak sealed at main trunk.", amount: 180 },
  { n: "TEST-007", summary: "[TEST] Refrigerant leak repair", type: "repair", priority: "high", status: "dispatched", day: 16, start: 13, dur: 2, techs: ["Carlos"], tags: "test,callback", techNotes: "[TEST] Suspected evaporator coil leak." },
  { n: "TEST-008", summary: "[TEST] Mini-split service", type: "service", priority: "normal", status: "scheduled", day: 17, start: 14, min: 30, dur: 1.5, techs: ["Lisa"], tags: "test" },
  { n: "TEST-009", summary: "[TEST] Cooling tower maintenance", type: "maintenance", priority: "normal", status: "on_hold", day: 18, start: 13, dur: 3, techs: ["Mike"], tags: "test,on-hold", notes: "[TEST] On hold — awaiting replacement fill media." },
  { n: "TEST-010", summary: "[TEST] Compressor swap (2 techs)", type: "installation", priority: "high", status: "scheduled", day: 22, start: 13, dur: 4, techs: ["Carlos", "Lisa"], tags: "test,2-tech", amount: 3200 },
  { n: "TEST-011", summary: "[TEST] Annual tune-up", type: "maintenance", priority: "low", status: "scheduled", day: 24, start: 15, dur: 1, techs: ["Mike"], tags: "test,maintenance-plan" },
  { n: "TEST-012", summary: "[TEST] Warranty callback", type: "service", priority: "normal", status: "new", day: 28, start: 13, dur: 1.5, techs: ["Carlos"], tags: "test,warranty,callback", followUpDay: 30, notes: "[TEST] Recheck after last repair." },
  { n: "TEST-013", summary: "[TEST] Unassigned — needs dispatch", type: "service", priority: "high", status: "new", day: 15, start: 13, dur: 2, techs: [], tags: "test,unassigned" },
  { n: "TEST-014", summary: "[TEST] Unassigned inspection", type: "inspection", priority: "normal", status: "scheduled", day: 21, start: 14, dur: 1.5, techs: [], tags: "test,unassigned" },
  { n: "TEST-015", summary: "[TEST] Unassigned emergency (no tech yet)", type: "emergency", priority: "urgent", status: "new", day: 14, start: 17, dur: 2, techs: [], tags: "test,emergency,unassigned", notes: "[TEST] Needs immediate dispatch." },
  { n: "TEST-016", summary: "[TEST] Unassigned install estimate follow-up", type: "installation", priority: "normal", status: "new", day: 29, start: 13, dur: 3, techs: [], tags: "test,unassigned" },
  { n: "TEST-017", summary: "[TEST] Backlog — schedule when possible", type: "service", priority: "low", status: "new", day: null, techs: [], tags: "test,backlog,undated" },
  { n: "TEST-018", summary: "[TEST] Backlog — maintenance plan setup", type: "maintenance", priority: "normal", status: "new", day: null, techs: [], tags: "test,backlog,undated" },
  { n: "TEST-019", summary: "[TEST] Backlog — awaiting customer callback", type: "service", priority: "normal", status: "on_hold", day: null, techs: [], tags: "test,backlog,undated", notes: "[TEST] Left voicemail; waiting to schedule." },
  { n: "TEST-020", summary: "[TEST] Backlog — parts on order (assigned, unscheduled)", type: "repair", priority: "high", status: "on_hold", day: null, techs: ["Lisa"], tags: "test,backlog,undated,parts", techNotes: "[TEST] Blower motor on order, ETA 3 days." },
];

async function main() {
  // ── Idempotent cleanup (jobs first — customers are Restrict-referenced) ──
  const delJobs = await prisma.job.deleteMany({ where: { jobNumber: { startsWith: "TEST-" } } });
  const delCust = await prisma.customer.deleteMany({
    where: { OR: [{ companyName: { startsWith: "[TEST]" } }, { lastName: { startsWith: "[TEST]" } }] },
  });
  console.log(`Cleared prior demo data: ${delJobs.count} TEST jobs, ${delCust.count} TEST customers.`);

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
  if (!admin) throw new Error("No admin user found.");
  const techList = await prisma.technician.findMany({ include: { user: { select: { firstName: true } } } });
  const techByName = {};
  techList.forEach((t) => { techByName[t.user.firstName] = t.id; });

  // ── Test customers (with coordinates for map pins) ──
  const custs = [];
  for (let i = 0; i < TEST_CUSTOMERS.length; i++) {
    const tc = TEST_CUSTOMERS[i];
    const cust = await prisma.customer.create({
      data: {
        customerNumber: `TEST-C-${String(i + 1).padStart(2, "0")}`,
        firstName: "Demo",
        lastName: tc.label,
        phone: "561-555-0100",
        type: tc.type,
        companyName: tc.label,
        source: "demo-dispatch",
        locations: { create: { name: "Service Address", address: tc.addr, city: tc.city, state: "FL", zip: tc.zip, lat: tc.lat, lng: tc.lng, type: "service", isPrimary: true } },
      },
      include: { locations: true },
    });
    custs.push({ id: cust.id, locationId: cust.locations[0].id });
  }

  // ── Jobs ──
  let created = 0;
  for (let i = 0; i < SPECS.length; i++) {
    const s = SPECS[i];
    const cust = custs[i % custs.length];
    const start = s.day ? dt(s.day, s.start, s.min || 0) : null;
    const end = start && s.dur ? addH(start, s.dur) : null;
    const done = s.status === "completed";
    const inProg = s.status === "in_progress";

    const job = await prisma.job.create({
      data: {
        jobNumber: s.n,
        customerId: cust.id,
        locationId: cust.locationId,
        createdById: admin.id,
        type: s.type,
        status: s.status,
        priority: s.priority,
        summary: s.summary,
        description: s.description || null,
        scheduledStart: start,
        scheduledEnd: end,
        actualStart: done || inProg ? start : null,
        actualEnd: done ? end : null,
        completedAt: done ? end : null,
        completionNotes: done ? s.completionNotes || "[TEST] Work completed and tested." : null,
        duration: s.dur ? Math.round(s.dur * 60) : null,
        tags: s.tags || "test",
        notes: s.notes || null,
        techNotes: s.techNotes || null,
        totalAmount: s.amount || 0,
        followUpDate: s.followUpDay ? dt(s.followUpDay, 13) : null,
      },
    });

    const techs = s.techs || [];
    for (let ti = 0; ti < techs.length; ti++) {
      const techId = techByName[techs[ti]];
      if (!techId) continue;
      await prisma.jobTechnician.create({
        data: {
          jobId: job.id,
          technicianId: techId,
          isLead: ti === 0,
          status: done ? "completed" : inProg ? "arrived" : "assigned",
          arrivedAt: done || inProg ? start : null,
          departedAt: done ? end : null,
        },
      });
    }
    created++;
  }

  console.log(`Created ${created} TEST jobs across ${custs.length} TEST customers.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
