import crypto from "node:crypto";

/**
 * Everything about *reading* a review CSV that another app produced: which
 * column means what, and how to turn its values into ours. Deliberately
 * free of Prisma and of any I/O, so the format rules can be exercised on
 * their own — the surrounding import (transactions, plan caps, Admin API)
 * lives in review-import.server.ts.
 *
 * The reason this file exists at all: the importer used to require the
 * exact headers KeepReviews' own template emits, and no competing app
 * exports those names. A merchant escaping Loox got "CSV is missing
 * required column(s): author_name, review_text" and left — which is the
 * whole acquisition case, lost on the first screen.
 */

/** Canonical fields the importer understands. Everything else in the file
 *  is ignored on purpose (Judge.me ships metaobject_handle, Loox ships
 *  reply/verified_purchase/incentivized, merchants add their own columns). */
export const CANONICAL_FIELDS = [
  "product_handle",
  "product_id",
  "rating",
  "author_name",
  "review_text",
  "review_title",
  "review_date",
  "photo_urls",
  "source_review_url",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Header synonyms, lowercase (the parser lowercases and trims headers
 * before this map is consulted). KeepReviews' own name is always first in
 * each list, so a file produced by our own template resolves to exactly the
 * same fields it did before this map existed.
 *
 * VERIFIED against the source app's own documented export format:
 *   Loox      — product_handle, rating, author, body, created_at, photo_url
 *   Judge.me  — product_handle / product_id, rating, reviewer_name, body,
 *               title, review_date
 *
 * The remaining aliases are generic names that show up across CSV exports
 * and cost nothing to accept. They are NOT a claim that Stamped, Fera,
 * Yotpo, Okendo or Ali Reviews are supported — those are offered only as
 * "another review app", and the error messages name the headers we take, so
 * an unrecognised file tells the merchant exactly what to rename instead of
 * failing blankly.
 *
 * Deliberately absent: email. Loox and Judge.me both export reviewer email
 * addresses, and Review.authorEmail exists, but importing a list of another
 * company's customers' emails is a privacy decision (and a Shopify App
 * Store data declaration) — not something to switch on as a side effect of
 * a column-mapping change. That column is ignored like any other unknown.
 */
export const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  product_handle: ["product_handle", "handle", "product handle", "product-handle"],
  product_id: ["product_id", "productid", "product id", "shopify_product_id"],
  rating: ["rating", "score", "stars", "review_score", "star_rating"],
  author_name: [
    "author_name",
    "author",
    "reviewer_name",
    "customer_name",
    "display_name",
    "name",
  ],
  review_text: ["review_text", "body", "content", "review_body", "comment", "review"],
  review_title: ["review_title", "title", "headline", "subject"],
  review_date: [
    "review_date",
    "created_at",
    "date",
    "review_created_at",
    "submitted_at",
  ],
  photo_urls: [
    "photo_urls",
    "photo_url",
    "picture_urls",
    "image_urls",
    "images",
    "media_urls",
  ],
  source_review_url: ["source_review_url", "review_url", "source_url"],
};

/** Fields a file must provide a column for. The product columns are handled
 *  separately: Judge.me can export a file carrying only one of the two, and
 *  either is enough to find the product. */
const REQUIRED_FIELDS: CanonicalField[] = ["rating", "author_name", "review_text"];

/** The template handed to merchants who aren't coming from any app. Native
 *  names only — aliases are for reading, never for emitting. */
export const CSV_TEMPLATE_COLUMNS = [
  "product_handle",
  "rating",
  "author_name",
  "review_text",
  "review_date",
  "source_review_url",
  "photo_urls",
];

export type HeaderMap = Partial<Record<CanonicalField, string>>;

/**
 * Decides which physical column of the file feeds each canonical field.
 *
 * Two rules keep this predictable: a canonical field takes the FIRST of its
 * aliases the file actually contains (so the native name always wins over a
 * synonym), and a physical column can only ever feed ONE canonical field
 * (so a file carrying both `title` and `review_title` isn't read twice).
 * Anything left over is ignored.
 */
export function mapCsvHeaders(headers: string[]): HeaderMap {
  const present = new Set(headers.map((header) => header.trim().toLowerCase()));
  const claimed = new Set<string>();
  const map: HeaderMap = {};

  for (const field of CANONICAL_FIELDS) {
    for (const alias of HEADER_ALIASES[field]) {
      if (present.has(alias) && !claimed.has(alias)) {
        map[field] = alias;
        claimed.add(alias);
        break;
      }
    }
  }

  return map;
}

/** The headers accepted for a field, for error messages. The merchant is
 *  looking at an export from another app, not at our documentation, so
 *  naming the canonical field alone ("missing review_text") tells them
 *  nothing they can act on. */
function acceptedHeadersFor(field: CanonicalField): string {
  return HEADER_ALIASES[field].join(", ");
}

/** Null when the file is usable; otherwise the message to show the
 *  merchant, naming exactly what to rename. */
export function describeMissingColumns(map: HeaderMap): string | null {
  const missing = REQUIRED_FIELDS.filter((field) => !map[field]);
  const hasProduct = Boolean(map.product_handle || map.product_id);

  if (missing.length === 0 && hasProduct) return null;

  const parts = missing.map(
    (field) => `"${field}" (accepted: ${acceptedHeadersFor(field)})`,
  );
  if (!hasProduct) {
    parts.push(
      `a product column (accepted: ${acceptedHeadersFor("product_handle")}, ${acceptedHeadersFor("product_id")})`,
    );
  }

  const label = parts.length === 1 ? "a column" : "columns";
  return `This CSV is missing ${label}: ${parts.join("; ")}. Rename the matching column in your file and upload it again.`;
}

/**
 * 1-5 integer, or null when the value isn't a rating at all.
 *
 * Forgiving on purpose. Exports carry "4.5" (aggregate-style ratings),
 * "4,5" (every locale that writes decimals with a comma, which is most of
 * the Spanish-speaking market this app targets) and "5 stars". Rejecting
 * those loses a real review over formatting. A 4.5 becomes 5, not 4:
 * rounding a merchant's rating DOWN would quietly make us worse for them
 * than the app they left.
 *
 * Values below half a star are refused rather than clamped — a "0" almost
 * always means "this row has no rating", and inventing a 1-star review is a
 * defamatory thing to do to someone's product.
 */
export function normalizeRating(raw: string): number | null {
  const match = raw.trim().replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const value = Number(match[0]);
  if (!Number.isFinite(value) || value < 0.5) return null;

  return Math.min(5, Math.max(1, Math.round(value)));
}

/**
 * Photo URLs. KeepReviews' template separates with "|", Loox with ",".
 * Split on "|" when present, otherwise on "," — Papaparse has already
 * handled quoting, so the only value this mis-splits is a URL that itself
 * contains a comma, and the http(s) filter drops those fragments rather
 * than storing half a URL.
 */
export function parsePhotoUrls(raw: string, limit = 6): string[] {
  if (!raw.trim()) return [];

  const parts = raw.includes("|") ? raw.split("|") : raw.split(",");

  return parts
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part))
    .slice(0, limit);
}

/**
 * Review has no title column and doesn't need one for two apps' sake —
 * but Judge.me *requires* a title, so dropping it would silently delete the
 * line the customer wrote as their headline. Prepending keeps it.
 */
export function composeBody(title: string, body: string, maxLength: number): string {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const combined = trimmedTitle ? `${trimmedTitle}\n\n${trimmedBody}` : trimmedBody;
  return combined.slice(0, maxLength);
}

/** Dates as the exports write them. new Date() covers ISO-8601 and Loox's
 *  YYYY-MM-DD. DD/MM/YYYY is deliberately NOT guessed at: 03/04/2025 is two
 *  different days depending on who exported it, and nothing in the value
 *  says which. An unparseable date is not a row error — the review is kept,
 *  with its position marked unknown (see displayedAt in schema.prisma). */
export function parseOptionalDate(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Identity of an imported review: shop, product, author, rating, text, date.
 *
 * The source app is NOT in the hash. It used to be, which meant a merchant
 * who uploaded the same export twice — once under "Loox", then again after
 * realising they'd picked the wrong option — got every review duplicated.
 * Where a review was exported from is metadata about the file, not about
 * the review.
 */
export function computeDedupeKey(params: {
  shopId: string;
  productId: string;
  authorName: string;
  rating: number;
  body: string;
  sourceCreatedAt: Date | null;
}): string {
  const raw = [
    params.shopId,
    params.productId,
    params.authorName.toLowerCase(),
    params.rating,
    params.body.toLowerCase(),
    params.sourceCreatedAt?.toISOString() ?? "",
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}
