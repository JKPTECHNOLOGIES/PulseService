/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 * Suitable for a single backend instance; for multi-instance deployments this
 * should move to a shared store (Redis). Keyed by client IP — behind nginx we
 * rely on `app.set("trust proxy", 1)` so req.ip is the real client address.
 */
function rateLimit({ windowMs, max, message } = {}) {
  const limit = max ?? 10;
  const window = windowMs ?? 15 * 60 * 1000;
  const hits = new Map(); // key -> { count, resetAt }

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "unknown";

    // Opportunistically prune expired entries so the map can't grow unbounded.
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (now > v.resetAt) hits.delete(k);
      }
    }

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + window };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, limit - entry.count);
    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(remaining));

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        error: message ?? "Too many requests. Please try again later.",
      });
    }

    next();
  };
}

module.exports = rateLimit;
