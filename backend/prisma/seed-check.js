// Exits 0 if the database already contains data (seeded), 1 otherwise.
// Used by docker-entrypoint.sh to make seeding idempotent without relying on
// a filesystem marker.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: ['error'] });

(async () => {
  try {
    const userCount = await prisma.user.count();
    process.exit(userCount > 0 ? 0 : 1);
  } catch (err) {
    // If the check itself fails (e.g. table not ready), fall through to seeding.
    console.error('seed-check failed, will attempt to seed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
