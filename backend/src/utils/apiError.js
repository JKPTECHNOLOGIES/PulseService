// Turns a caught error into a clear, user-facing response. Maps the common
// Prisma failures to specific messages and status codes so the client shows
// something actionable instead of a blanket "Server error", and logs the full
// error server-side (tagged with `entity`) for debugging.
function respondError(res, err, entity = "record") {
  const code = err && err.code;

  if (code === "P2002") {
    const target = err.meta && err.meta.target;
    const field = Array.isArray(target) ? target.join(", ") : target || "value";
    return res.status(409).json({
      success: false,
      error: `A ${entity} with that ${field} already exists.`,
    });
  }
  if (code === "P2025") {
    return res
      .status(404)
      .json({ success: false, error: `That ${entity} no longer exists.` });
  }
  if (code === "P2003") {
    return res.status(400).json({
      success: false,
      error:
        "A referenced record doesn't exist. Check your selections and try again.",
    });
  }
  if (err && err.name === "PrismaClientValidationError") {
    return res.status(400).json({
      success: false,
      error: `Some fields for this ${entity} weren't valid. Double-check dates and required fields.`,
    });
  }

  console.error(`${entity} error:`, err);
  return res.status(500).json({
    success: false,
    error: `Couldn't save the ${entity}. Please try again, or copy this error and send it to support.`,
  });
}

module.exports = { respondError };
