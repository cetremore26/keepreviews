import db from "../db.server";
import { sendEmail } from "./email.server";

const BATCH_SIZE = 50;

/**
 * Sends every due, not-yet-sent review request email. Meant to be called by
 * a scheduled trigger (see app/routes/cron.send-review-requests.tsx), not
 * on every request — email delivery must never block a user-facing path.
 */
export async function sendDueReviewRequests() {
  const due = await db.reviewRequest.findMany({
    where: { sendAt: { lte: new Date() }, sentAt: null },
    include: { shop: true },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;

  for (const request of due) {
    // No product handle (e.g. the product was deleted before this could be
    // sent) means there's no real storefront page to link to — skip rather
    // than send a broken link. This doesn't count as "failed": there's
    // nothing to retry, the row just stays unsent forever.
    if (!request.productHandle) {
      console.error(
        `Skipping review request ${request.id}: no product handle on file.`,
      );
      continue;
    }

    // A query param, not a #hash: a hash never reaches the server and gets
    // silently dropped by some email link-tracking rewrites (Resend's
    // click tracking included), while a query param survives any redirect.
    const reviewUrl = `https://${request.shop.domain}/products/${request.productHandle}?keepreviews_review=1#keepreviews-write-a-review`;

    try {
      await sendEmail({
        to: request.customerEmail,
        subject: `How was your ${request.productTitle ?? "recent purchase"}?`,
        html: `
          <p>Hi,</p>
          <p>We'd love to hear what you think about <strong>${escapeHtml(
            request.productTitle ?? "your recent purchase",
          )}</strong>.</p>
          <p><a href="${reviewUrl}">Leave a review</a></p>
        `,
      });

      await db.reviewRequest.update({
        where: { id: request.id },
        data: { sentAt: new Date() },
      });
      sent += 1;
    } catch (error) {
      console.error(`Failed to send review request ${request.id}:`, error);
      failed += 1;
    }
  }

  return { sent, failed, total: due.length };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
