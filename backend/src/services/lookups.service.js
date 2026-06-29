const prisma = require("../config/database");

// In-memory cache of valid lookup values keyed by category. The Lookup table is
// the source of truth; we cache it (with a short TTL) so write-path validation
// doesn't hit the database on every request. Call invalidate() if lookups are
// ever mutated at runtime.
let cache = null;
let loadedAt = 0;
const TTL_MS = 5 * 60 * 1000;

async function load() {
  const rows = await prisma.lookup.findMany({
    where: { isActive: true },
    select: { category: true, value: true },
  });
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.category)) map.set(row.category, new Set());
    map.get(row.category).add(row.value);
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

/**
 * Returns true if `value` is a valid, active entry within `category` according
 * to the Lookup table. If the category is unknown (not seeded), validation is
 * skipped (returns true) so callers never reject on a missing category.
 */
async function isValid(category, value) {
  const map = await getMap();
  const values = map.get(category);
  if (!values) return true;
  return values.has(value);
}

function invalidate() {
  cache = null;
  loadedAt = 0;
}

module.exports = { isValid, invalidate, getMap };
