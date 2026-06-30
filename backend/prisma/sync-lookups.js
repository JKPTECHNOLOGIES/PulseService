// Upserts every lookup defined in src/constants/lookups.js into the Lookup
// table. Runs on every backend start (see docker-entrypoint.sh) so newly added
// lookup categories/options appear after a normal rebuild — without needing a
// destructive `docker compose down -v` reseed.
const { PrismaClient } = require("@prisma/client");
const { LOOKUPS } = require("../src/constants/lookups");

const prisma = new PrismaClient({ log: ["error"] });

(async () => {
  let count = 0;
  try {
    for (const [category, entries] of Object.entries(LOOKUPS)) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        await prisma.lookup.upsert({
          where: { category_value: { category, value: entry.value } },
          create: {
            category,
            value: entry.value,
            label: entry.label,
            color: entry.color ?? null,
            sortOrder: i,
          },
          update: {
            label: entry.label,
            color: entry.color ?? null,
            sortOrder: i,
            isActive: true,
          },
        });
        count += 1;
      }
    }
    console.log(`==> Lookups synced (${count} entries).`);
  } catch (err) {
    console.error("Lookup sync failed:", err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
