/**
 * Simple in-memory, per-IP, fixed-window rate limiter.
 *
 * This is intentionally simple: it is enough to stop a single client from
 * flooding /api/reason, which is the real near-term risk for a prototype
 * moving toward MVP. A production deployment behind multiple server
 * instances should replace the in-memory Map with a shared store (Redis is
 * the usual choice) so the limit is enforced across instances.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, windowStart }

  return function rateLimit(ip) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return { limited: false };
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterMs = windowMs - (now - entry.windowStart);
      return { limited: true, retryAfterMs };
    }
    return { limited: false };
  };
}

module.exports = { createRateLimiter };
