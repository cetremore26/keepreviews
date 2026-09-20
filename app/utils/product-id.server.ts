/**
 * The one place that decides what a Shopify product id looks like inside
 * this app.
 *
 * Canonical form: the legacy numeric id as a string ("9392803971322"). It is
 * what Liquid's {{ product.id }} prints, so it is what the storefront widget
 * sends when it submits a review and what it asks for when it lists them —
 * every storefront review already stored it. The Admin API speaks GIDs
 * ("gid://shopify/Product/9392803971322") instead, and two formats living in
 * Review.productId is exactly how imported reviews ended up invisible on the
 * storefront: the widget asked for the number and the import had stored the
 * GID. Anything that writes or queries Review.productId goes through
 * normalizeProductId, so a GID arriving by any route lands in, and is looked
 * up by, the same value.
 *
 * Pure and free of I/O, like review-import-format.server.ts.
 */

const NUMERIC_ID = /^\d{1,20}$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d{1,20})$/;

/** Canonical (numeric) product id from a bare number or a Product GID. Null
 *  for anything else — a value that is neither can never match a real
 *  product, and nothing unvalidated should reach a query or a GID built
 *  from it (same rule as VALID_HANDLE in review-import.server.ts).
 *
 *  Idempotent: normalizing an already-canonical id returns it unchanged. */
export function normalizeProductId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  const digits = PRODUCT_GID.exec(value)?.[1] ?? (NUMERIC_ID.test(value) ? value : null);
  if (digits === null) return null;

  // Shopify ids never carry leading zeros; stripping them keeps "0123" and
  // "123" from being two different products.
  return digits.replace(/^0+(?=\d)/, "");
}

/** The GID the Admin API wants for a canonical id. The reverse of
 *  normalizeProductId, for the places that have to talk to Shopify. */
export function toProductGid(productId: string): string {
  return `gid://shopify/Product/${productId}`;
}
