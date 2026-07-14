/**
 * Rotate a user's password to a strong value (or a supplied one).
 *
 * Usage (inside the backend container, DATABASE_URL set):
 *   node scripts/set-admin-password.js [email]
 *
 * - Targets the given email, or the first admin user if no email is passed.
 * - Uses NEW_ADMIN_PASSWORD if set, otherwise generates a strong 16-char
 *   password (mixed case + digits, no ambiguous characters like 0/O/1/l/I).
 * - Prints the new password once. No password is stored in the repo.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function generatePassword(len = 16) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

(async () => {
  try {
    const email = process.argv[2];
    const where = email ? { email } : { role: "admin" };
    const user = await prisma.user.findFirst({ where });
    if (!user) {
      console.error(`No user found for ${email ? email : "role=admin"}.`);
      process.exit(1);
    }

    const password = process.env.NEW_ADMIN_PASSWORD || generatePassword(16);
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hash } });

    console.log("──────────────────────────────────────────────");
    console.log("Password updated for:", user.email);
    console.log("New password:        ", password);
    console.log("──────────────────────────────────────────────");
    console.log("(Store this securely — it is not saved anywhere else.)");
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
