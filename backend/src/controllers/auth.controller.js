const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/database");
const permissionsService = require("../services/permissions.service");

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    const permissions = await permissionsService.getForRole(user.role);
    const { password: _pw, ...userOut } = user;
    return res.json({
      success: true,
      data: { token, user: { ...userOut, permissions } },
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { technician: { include: { vehicle: true } } },
    });
    const permissions = await permissionsService.getForRole(user.role);
    const { password: _pw, ...userOut } = user;
    return res.json({ success: true, data: { ...userOut, permissions } });
  } catch (err) {
    console.error("getMe error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(phone !== undefined && { phone }),
      },
    });
    const { password: _pw, ...userOut } = user;
    return res.json({ success: true, data: userOut });
  } catch (err) {
    console.error("updateProfile error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "currentPassword and newPassword are required",
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res
        .status(401)
        .json({ success: false, error: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });

    return res.json({ success: true, data: { message: "Password updated" } });
  } catch (err) {
    console.error("changePassword error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { login, getMe, updateProfile, changePassword };
