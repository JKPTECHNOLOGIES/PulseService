const prisma = require("../config/database");
const push = require("./push.service");

// Creates an in-app notification (the bell list) AND best-effort sends a
// matching web push for the same event. Never throws -- notifications are a
// side effect and must not break the request that triggered them.
async function notifyUser(userId, { title, body, url, type = "info" }) {
  if (!userId) return;
  try {
    await prisma.notification.create({
      data: { userId, title, message: body, type, link: url ?? null },
    });
  } catch (err) {
    console.error("[notify] create error:", err.message);
  }
  void push.sendToUser(userId, { title, body, url });
}

/**
 * Notifies the users behind a set of technician IDs that they've been assigned
 * a job. Looks up each technician's user account and sends one notification each.
 */
async function notifyJobAssigned(technicianIds, job) {
  if (!Array.isArray(technicianIds) || technicianIds.length === 0 || !job) {
    return;
  }
  const techs = await prisma.technician.findMany({
    where: { id: { in: technicianIds } },
    select: { userId: true },
  });
  const body = job.summary
    ? `#${job.jobNumber}: ${job.summary}`
    : `Job #${job.jobNumber} was assigned to you`;
  await Promise.all(
    techs
      .filter((t) => t.userId)
      .map((t) =>
        notifyUser(t.userId, {
          title: "New job assigned",
          body,
          url: `/jobs/${job.id}`,
        }),
      ),
  );
}

module.exports = { notifyUser, notifyJobAssigned };
