import db from "../db.server";

/**
 * DB-backed sliding-window rate limiter for the public app proxy endpoints.
 * Deliberately not in-memory: Render restarts the process on every deploy
 * and (on the free tier) after idle sleep too, which would otherwise reset
 * an attacker's counter back to zero for free. A Postgres row survives all
 * of that.
 *
 * Every call records an attempt regardless of whether the caller ends up
 * being allowed through — recording only on "allowed" would let an
 * attacker probe right up to the limit forever without ever tripping it.
 */
export async function checkRateLimit(
  key: string,
  windowMs: number,
  maxAttempts: number,
): Promise<{ allowed: boolean }> {
  const windowStart = new Date(Date.now() - windowMs);

  const [count] = await db.$transaction([
    db.rateLimitAttempt.count({
      where: { key, createdAt: { gte: windowStart } },
    }),
    db.rateLimitAttempt.create({ data: { key } }),
    // Opportunistic cleanup: old rows for this key never need to be read
    // again once they've aged out of any window we'd ever check, so we
    // sweep them here instead of running a separate scheduled job.
    db.rateLimitAttempt.deleteMany({
      where: { key, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return { allowed: count < maxAttempts };
}

/** Best-effort real client IP behind Render's proxy. Never trust this for
 *  anything beyond rate limiting — it's caller-suppliable and only useful
 *  as a coarse abuse signal, not an identity. */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}
