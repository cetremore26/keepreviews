/**
 * Minimal email sender. Uses Resend (resend.com) because it has a real free
 * tier (100 emails/day, no credit card) that fits the $20-50/month budget
 * ceiling. If RESEND_API_KEY isn't set (e.g. local dev), emails are logged
 * instead of sent so the review-request pipeline can still be exercised
 * end-to-end without a provider configured.
 *
 * Swapping providers later only means rewriting this one function.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REVIEW_REQUEST_FROM_EMAIL;

  if (!apiKey || !from) {
    console.log(
      `[email:dev-mode] Would send "${params.subject}" to ${params.to}`,
    );
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend API error (${response.status}): ${text}`);
  }
}
