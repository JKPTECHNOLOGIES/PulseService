/**
 * Additively grant a single permission to a role in the live database.
 *
 * RolePermission rows are normally created once, at `prisma/seed.js` time,
 * from DEFAULT_ROLE_PERMISSIONS. On a database that's already seeded (i.e.
 * has real data), re-running the full seed would wipe every customer, job,
 * invoice, etc. — not an option. When a *new* permission key is added to
 * `src/constants/permissions.js` for an existing app, use this script to grant
 * it to a role without touching anything else. Safe to run more than once.
 *
 * Usage (inside the backend container, DATABASE_URL already set):
 *   node scripts/grant-permission.js <role> <permission>
 *   node scripts/grant-permission.js                  # defaults to admin/time.manage
 *
 * Example (from the host, via docker compose):
 *   docker compose exec backend node scripts/grant-permission.js admin time.manage
 */
const { PrismaClient } = require("@prisma/client");
const { ALL_PERMISSIONS } = require("../src/constants/permissions");

const prisma = new PrismaClient();

(async () => {
  try {
    const role = process.argv[2] || "admin";
    const permission = process.argv[3] || "time.manage";

    if (!ALL_PERMISSIONS.includes(permission)) {
      console.error(`Unknown permission "${permission}" (not in the catalog).`);
      process.exit(1);
    }

    const existing = await prisma.rolePermission.findFirst({
      where: { role, permission },
    });
    if (existing) {
      console.log(`${role} already has "${permission}" — nothing to do.`);
      return;
    }

    await prisma.rolePermission.create({ data: { role, permission } });
    console.log(`Granted "${permission}" to role "${role}".`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
