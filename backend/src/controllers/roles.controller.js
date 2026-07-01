const prisma = require("../config/database");
const permissionsService = require("../services/permissions.service");
const {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
} = require("../constants/permissions");

// Returns the permission catalog (grouped) the matrix editor renders.
const catalog = (req, res) => {
  return res.json({ success: true, data: PERMISSION_GROUPS });
};

// Lists every role (from the userRole lookup) with the permission keys it
// currently grants.
const list = async (req, res) => {
  try {
    const [roles, rolePerms] = await Promise.all([
      prisma.lookup.findMany({
        where: { category: "userRole", isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { value: true, label: true },
      }),
      prisma.rolePermission.findMany({
        select: { role: true, permission: true },
      }),
    ]);

    const byRole = new Map();
    for (const rp of rolePerms) {
      if (!byRole.has(rp.role)) byRole.set(rp.role, []);
      byRole.get(rp.role).push(rp.permission);
    }

    const data = roles.map((r) => ({
      role: r.value,
      label: r.label,
      // admin is intentionally locked to all permissions.
      isSystem: r.value === "admin",
      permissions: byRole.get(r.value) ?? [],
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error("roles.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Replaces the permission set for a role. Body: { permissions: string[] }.
const updatePermissions = async (req, res) => {
  try {
    const { role } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res
        .status(400)
        .json({ success: false, error: "permissions must be an array" });
    }

    // admin must always retain every permission — it's the break-glass role.
    if (role === "admin") {
      return res.status(400).json({
        success: false,
        error: "The administrator role always has all permissions",
      });
    }

    const validRole = await prisma.lookup.findUnique({
      where: { category_value: { category: "userRole", value: role } },
    });
    if (!validRole) {
      return res.status(404).json({ success: false, error: "Unknown role" });
    }

    // Only accept known permission keys.
    const clean = [...new Set(permissions)].filter((p) =>
      ALL_PERMISSIONS.includes(p),
    );

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { role } }),
      prisma.rolePermission.createMany({
        data: clean.map((permission) => ({ role, permission })),
      }),
    ]);

    permissionsService.invalidate();

    return res.json({ success: true, data: { role, permissions: clean } });
  } catch (err) {
    console.error("roles.updatePermissions error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { catalog, list, updatePermissions };
