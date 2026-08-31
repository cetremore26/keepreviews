import db from "../db.server";

/**
 * Records an access to, or change of, personal data — answers "do you log
 * access to personal data?" with an actual queryable log, not just a
 * policy statement. Fire-and-forget: a logging failure must never block
 * the action it's describing, so callers don't need to await this or
 * handle its errors.
 */
export function logAudit(params: {
  shopId: string;
  actor: string;
  action: string;
  detail?: string;
}): void {
  db.auditLog
    .create({
      data: {
        shopId: params.shopId,
        actor: params.actor,
        action: params.action,
        detail: params.detail ?? null,
      },
    })
    .catch((error) => {
      console.error("Failed to write audit log:", error);
    });
}
