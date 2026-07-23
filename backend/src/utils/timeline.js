const prisma = require("../config/database");

/**
 * Records one narrated event on a customer's merged timeline (Work Orders +
 * Invoices + Quotes). Fire-and-forget, like the audit log middleware --
 * never blocks or fails the calling request. `description` should already be
 * a complete, human-readable sentence fragment (e.g. "edited Work Order
 * Description") -- callers compose the wording, this just persists it.
 */
async function recordTimelineEvent({
  customerId,
  entityType,
  entityId,
  entityLabel,
  action,
  description,
  userId,
}) {
  if (!customerId) return; // nothing to attach it to
  try {
    await prisma.timelineEvent.create({
      data: {
        customerId,
        entityType,
        entityId,
        entityLabel,
        action,
        description,
        userId: userId || null,
      },
    });
  } catch (err) {
    console.error("timeline event write error:", err);
  }
}

/**
 * Compares `before`/`after` field values for the given { field, label } pairs
 * and returns one description per changed field, e.g. "edited Work Order
 * Description". Only fires for fields that actually changed (including
 * "was empty, now set" and vice versa); skips anything not in `fields`.
 */
function describeFieldEdits(before, after, fields) {
  const descriptions = [];
  for (const { field, label } of fields) {
    const prevValue = before ? (before[field] ?? "") : "";
    const nextValue = after[field] ?? "";
    if (String(prevValue) !== String(nextValue)) {
      descriptions.push(`edited ${label}`);
    }
  }
  return descriptions;
}

module.exports = { recordTimelineEvent, describeFieldEdits };
