import { json, type ActionFunctionArgs } from "@remix-run/node";
import db from "../db.server";
import { sendEmail } from "../services/email.server";
import { verifyCronSecret } from "../utils/cron-auth.server";

// Supabase's free Storage tier: 1 GiB. Alert well before merchants would
// ever actually feel this — a Free-tier shop can't upload photos at all,
// so this only grows from Pro-plan usage, which is exactly the traffic
// worth protecting.
const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const ALERT_THRESHOLD = 0.8;
// Once we've alerted, don't alert again for a week even if still over
// threshold — a daily nag email for an unresolved problem isn't useful.
const ALERT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Triggered daily by GitHub Actions (see .github/workflows/
 * check-storage-usage.yml). Reads the running byte counter kept in
 * storage.server.ts (incremented on every photo upload) rather than
 * asking Supabase's Storage API to sum folder sizes, since its list
 * endpoint isn't recursive and photos are sharded one subfolder per shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!verifyCronSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const usage = await db.storageUsage.findUnique({ where: { id: "global" } });
  const totalBytes = Number(usage?.totalBytes ?? 0n);
  const ratio = totalBytes / STORAGE_LIMIT_BYTES;

  const cooledDown =
    !usage?.lastAlertAt ||
    Date.now() - usage.lastAlertAt.getTime() > ALERT_COOLDOWN_MS;

  let alerted = false;

  if (ratio >= ALERT_THRESHOLD && cooledDown) {
    const alertEmail = process.env.ALERT_EMAIL;
    if (alertEmail) {
      await sendEmail({
        to: alertEmail,
        subject: `KeepReviews: Supabase Storage at ${(ratio * 100).toFixed(0)}%`,
        html: `
          <p>Review photo storage is at ${(ratio * 100).toFixed(1)}% of the
          1 GiB free Supabase Storage limit (${(totalBytes / 1024 / 1024).toFixed(0)} MB used).</p>
          <p>Once this fills up, new photo uploads will start failing for
          Pro-plan merchants. Upgrade the Supabase project's Storage add-on
          before that happens.</p>
        `,
      });
      alerted = true;
    }

    await db.storageUsage.update({
      where: { id: "global" },
      data: { lastAlertAt: new Date() },
    });
  }

  return json({ totalBytes, ratio, alerted });
};
