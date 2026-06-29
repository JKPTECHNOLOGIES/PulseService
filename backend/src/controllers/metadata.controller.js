const prisma = require("../config/database");

/**
 * GET /api/v1/metadata
 * Returns every lookup (statuses, types, roles, priorities, ...) grouped by
 * category, read live from the database. This is the single source of truth the
 * frontend consumes so no enum value or badge color is hardcoded client-side.
 */
async function getMetadata(req, res, next) {
  try {
    const rows = await prisma.lookup.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });

    const lookups = rows.reduce((acc, row) => {
      (acc[row.category] ??= []).push({
        value: row.value,
        label: row.label,
        color: row.color,
        sortOrder: row.sortOrder,
      });
      return acc;
    }, {});

    res.json({ success: true, data: { lookups } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/metadata/:category
 * Returns the entries for a single lookup category.
 */
async function getCategory(req, res, next) {
  try {
    const { category } = req.params;
    const rows = await prisma.lookup.findMany({
      where: { category, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true, label: true, color: true, sortOrder: true },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMetadata, getCategory };
