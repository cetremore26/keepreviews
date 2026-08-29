import crypto from "node:crypto";

/**
 * Verifies that a request actually came through Shopify's App Proxy and
 * wasn't crafted by a client pretending to be the storefront. Every public
 * (non-admin-authenticated) route that serves or accepts review data must
 * call this before touching the database — this is the server-side
 * boundary the brief calls out explicitly: business logic must never be
 * bypassable from the browser.
 *
 * Reference: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#step-2-verify-the-request
 */
export function verifyAppProxySignature(url: URL): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const params = new URLSearchParams(url.search);
  const signature = params.get("signature");
  if (!signature) return false;

  params.delete("signature");

  const sortedEntries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const message = sortedEntries
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const computedBuffer = Buffer.from(computed, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (computedBuffer.length !== signatureBuffer.length) return false;

  return crypto.timingSafeEqual(computedBuffer, signatureBuffer);
}

export function getShopDomainFromProxyRequest(url: URL): string | null {
  return new URLSearchParams(url.search).get("shop");
}
