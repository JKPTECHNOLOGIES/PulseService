const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { paginate, paginatedResponse } = require("../utils/helpers");

const SALT_ROUNDS = 10;

// Fields returned to clients — never expose the password hash.
const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  phone: true,
  avatar: true,
  isActive: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
};

// Generates a readable temporary password for invited users / resets. Since
// email delivery is stubbed, the plaintext is returned to the admin once so
// they can relay it to the new user.
function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// Builds the next sequential employee id (EMP-001, EMP-002, ...) for auto-
// provisioned technician profiles.
async function nextEmployeeId(tx) {
  const count = await tx.technician.count();
  return `EMP-${String(count + 1).padStart(3, "0")}`;
}

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role, isActive } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (role) where.role = role;
    if (isActive === "true") where.isActive = true;
    if (isActive === "false") where.isActive = false;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: userSelect,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(users, total, page, limit),
    });
  } catch (err) {
    console.error("users.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { ...userSelect, technician: true },
    });
    if (!user)
      return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error("users.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Invite / create a user. If no password is supplied a temporary one is
// generated and returned to the admin. Users with the technician role get a
// technician profile auto-provisioned so they appear on the dispatch board and
// technicians page.
const create = async (req, res) => {
  try {
    const { email, firstName, lastName, role, phone, password } = req.body;
    if (!email || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        error: "email, firstName, lastName, and role are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, error: "A user with that email already exists" });
    }

    const tempPassword = password || generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hash,
          firstName,
          lastName,
          role,
          phone: phone || null,
        },
        select: userSelect,
      });

      if (role === "technician") {
        await tx.technician.create({
          data: {
            userId: created.id,
            employeeId: await nextEmployeeId(tx),
          },
        });
      }

      return created;
    });

    return res.status(201).json({
      success: true,
      data: user,
      // Only surfaced when we generated the password (no delivery yet).
      ...(password ? {} : { temporaryPassword: tempPassword }),
    });
  } catch (err) {
    console.error("users.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, role, isActive } = req.body;

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target)
      return res.status(404).json({ success: false, error: "User not found" });

    const isSelf = id === req.user.id;
    const losingAdmin =
      target.role === "admin" &&
      ((role !== undefined && role !== "admin") || isActive === false);

    // Guard against locking everyone out: don't let the last active admin be
    // demoted or deactivated, and don't let admins deactivate/demote themselves.
    if (losingAdmin) {
      if (isSelf) {
        return res.status(400).json({
          success: false,
          error: "You cannot remove your own admin access",
        });
      }
      const activeAdmins = await prisma.user.count({
        where: { role: "admin", isActive: true },
      });
      if (activeAdmins <= 1) {
        return res.status(400).json({
          success: false,
          error: "Cannot demote or deactivate the last active administrator",
        });
      }
    }

    const willBeTechnician = role !== undefined ? role === "technician" : undefined;

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(phone !== undefined && { phone }),
          ...(role !== undefined && { role }),
          ...(isActive !== undefined && { isActive }),
        },
        select: userSelect,
      });

      // Keep the technician profile in sync when a role changes to technician.
      if (willBeTechnician) {
        const profile = await tx.technician.findUnique({ where: { userId: id } });
        if (!profile) {
          await tx.technician.create({
            data: { userId: id, employeeId: await nextEmployeeId(tx) },
          });
        }
      }

      return updated;
    });

    return res.json({ success: true, data: user });
  } catch (err) {
    console.error("users.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Admin-triggered password reset. Returns the new temporary password once.
const resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target)
      return res.status(404).json({ success: false, error: "User not found" });

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
    await prisma.user.update({ where: { id }, data: { password: hash } });

    return res.json({ success: true, data: { temporaryPassword: tempPassword } });
  } catch (err) {
    console.error("users.resetPassword error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { list, get, create, update, resetPassword };
