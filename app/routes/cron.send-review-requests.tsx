import { json, type ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import { sendDueReviewRequests } from "../services/review-requests.server";

/**
 * Triggered by an external scheduler (e.g. a free GitHub Actions cron, or
 * cron-job.org) hitting this URL every hour with the shared secret — there
 * is no billed background-job infra in the $20-50/month budget, so we don't
 * run our own scheduler process. Protected by a constant-time comparison
 * against CRON_SECRET so this can't be triggered by a stranger to spam
 * customers or exhaust the email quota.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret || !provided) {
    return new Response("Unauthorized", { status: 401 });
  }

  const secretBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  const isValid =
    secretBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(secretBuffer, providedBuffer);

  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await sendDueReviewRequests();
  return json(result);
};
