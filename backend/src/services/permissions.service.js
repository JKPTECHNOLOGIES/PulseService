const prisma = require("../config/database");

// In-memory cache of role -> Set(permission keys), sourced from the
// RolePermission table. Cached with a short TTL so per-request authorization
// checks don't hit the database every time. Call invalidate() after an admin
// re-maps a role's permissions.
let cache = null;
let loadedAt = 0;
const TTL_MS = 5 * 60 * 1000;

async function load() {
  const rows = await prisma.rolePermission.findMany({
    select: { role: true, permission: true },
  });
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.role)) map.set(row.role, new Set());
    map.get(row.role).add(row.permission);
  }
  cache = map;
  loadedAt = Date.now();
  return map;
}

async function getMap() {
  if (!cache || Date.now() - loadedAt > TTL_MS) {
    await load();
  }
  return cache;
}

// Returns the array of permission keys granted to a role.
async function getForRole(role) {
  const map = await getMap();
  const set = map.get(role);
  return set ? [...set] : [];
}

// True if the given role grants the permission.
async function hasPermission(role, permission) {
  const map = await getMap();
  const set = map.get(role);
  return set ? set.has(permission) : false;
}

function invalidate() {
  cache = null;
  loadedAt = 0;
}

module.exports = { getForRole, hasPermission, invalidate, getMap };
