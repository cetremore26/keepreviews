import crypto from "node:crypto";

/** Shared timing-safe check for the shared-secret header every cron route
 *  requires — used by more than one route, so this is the one place the
 *  comparison logic lives. */
export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret || !provided) return false;

  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);

  return (
    secretBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(secretBuffer, providedBuffer)
  );
}
