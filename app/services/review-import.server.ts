import Papa from "papaparse";
import type { ImportMarketplace } from "@prisma/client";

import db from "../db.server";
import { getPlan, type PlanId } from "../config/plans.server";
import { MAX_BODY_LENGTH, MAX_NAME_LENGTH } from "./reviews.server";
import { logAudit } from "../utils/audit-log.server";
import {
  composeBody,
  computeDedupeKey,
  describeMissingColumns,
  extractLegacyProductId,
  mapCsvHeaders,
  normalizeRating,
  parseOptionalDate,
  parsePhotoUrls,
  CSV_TEMPLATE_COLUMNS,
  type HeaderMap,
} from "./review-import-format.server";

export { CSV_TEMPLATE_COLUMNS };

/**
 * CSV-based review import. Deliberately NOT scraping: AliExpress/Amazon/Etsy
 * either forbid it in their terms of use or have no public reviews API, and
 * the market research behind this feature (mineria_willingness_to_pay.md)
 * found that scraping-based importers are exactly what breaks, loses rows,
 * or duplicates reviews for merchants. A CSV the merchant supplies (however
 * they got it) can't break that way, and never puts KeepReviews in the
 * business of scraping a site that prohibits it.
 *
 * Two jobs share this path. Pulling in marketplace reviews for a dropshipped
 * catalog is the one it was built for; carrying a merchant's own reviews out
 * of Judge.me or Loox is the one that acquires customers, and it is the
 * reason the column names are read through an alias map
 * (review-import-format.server.ts) instead of demanded verbatim.
 *
 * Gating (which sources a plan may import from, and how many imported
 * reviews it may store) is enforced here, not just in the UI — same rule as
 * every other plan-gated action in this app.
 */

// Rows insert in chunks inside one transaction each, instead of one
// transaction per row, so the per-row database cost that used to set this
// limit is gone. The old limit was 300, which meant a merchant with three
// years of reviews had to split them across ten files at the exact moment
// they were deciding whether to switch apps.
//
// 3000 is measured, not guessed: a 3000-row file of realistic review text
// is 0.52MB (against the route's 2MB body limit), resolves its products in
// ONE Admin API call, and imports in ~1.9s against a local Postgres —
// 0.6ms/row. Against a remote database the cost is ~30 chunk transactions
// of a few round trips each, so network latency multiplies a small constant
// rather than the row count; a 30ms-latency database puts this in the
// seconds, far inside any platform request timeout.
//
// This is also why there is no background queue yet: an import that takes
// seconds does not need one, and building a worker for demand that doesn't
// exist yet is the thing to avoid. If a real file ever does time out, the
// import is idempotent — the dedupe key means re-uploading the same file
// resumes instead of duplicating — so the failure mode is recoverable by
// the merchant without support.
const MAX_ROWS_PER_FILE = 3000;
// One INSERT per chunk. Small enough that a chunk's transaction stays well
// under Prisma's interactive-transaction timeout even on a cold remote
// database, large enough that 1000 rows cost 10 round trips, not 1000.
const INSERT_CHUNK_SIZE = 100;
const PRODUCT_LOOKUP_BATCH_SIZE = 50;
const MAX_ERROR_SUMMARY_ROWS = 200;

export class ReviewImportValidationError extends Error {}

interface ParsedRow {
  rowNumber: number; // 1-based, header excluded — matches what a merchant sees in a spreadsheet minus the header row
  productHandle: string;
  productId: string;
  rating: string;
  authorName: string;
  reviewText: string;
  reviewTitle: string;
  reviewDate: string;
  sourceReviewUrl: string;
  photoUrls: string;
}

interface RowError {
  rowNumber: number;
  reason: string;
}

export interface ImportResult {
  batchId: string;
  totalRows: number;
  importedCount: number;
  skippedDuplicateCount: number;
  errorCount: number;
  errors: RowError[]; // capped, see MAX_ERROR_SUMMARY_ROWS
}

export interface CsvParseResult {
  rows: ParsedRow[];
  /** Rows Papaparse flagged as structurally malformed (wrong field count,
   *  bad quoting, etc.) — excluded from `rows` and reported as per-row
   *  errors by the caller instead of being processed with mangled data. */
  rowErrors: RowError[];
}

/** Reads a cell through the header map: the merchant's file may call this
 *  column anything we recognise, and `undefined` means their file simply
 *  doesn't have it. */
function cell(row: Record<string, string>, map: HeaderMap, field: keyof HeaderMap): string {
  const header = map[field];
  if (!header) return "";
  return (row[header] ?? "").trim();
}

/** Parses and structurally validates a CSV's shape. Does not yet validate
 *  per-row business rules (rating range, product existence) — that happens
 *  row-by-row in importReviewsFromCsv so one bad row never aborts the rest.
 *  A malformed individual row (Papaparse reports these with a `row` index)
 *  is likewise isolated to that row via `rowErrors`, not treated as a
 *  whole-file failure — only errors with no row index (a genuinely
 *  unparseable file) abort the whole CSV. */
export function parseReviewCsv(fileText: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fatalErrors = parsed.errors.filter((e) => typeof e.row !== "number");
  if (fatalErrors.length > 0) {
    throw new ReviewImportValidationError(
      `CSV could not be parsed: ${fatalErrors[0].message}`,
    );
  }

  const headerMap = mapCsvHeaders(parsed.meta.fields ?? []);
  const missingMessage = describeMissingColumns(headerMap);
  if (missingMessage) {
    throw new ReviewImportValidationError(missingMessage);
  }

  if (parsed.data.length === 0) {
    throw new ReviewImportValidationError("CSV has no data rows.");
  }
  if (parsed.data.length > MAX_ROWS_PER_FILE) {
    throw new ReviewImportValidationError(
      `CSV has ${parsed.data.length} rows; the limit per upload is ${MAX_ROWS_PER_FILE}. Split it into multiple files — nothing is lost, the second file picks up where the first stopped.`,
    );
  }

  // Papaparse's row index is 0-based counting only data rows (header
  // excluded) — same convention as rowNumber below, so no off-by-one
  // adjustment is needed to match them up.
  const malformedRowNumbers = new Set(
    parsed.errors.map((e) => (e.row as number) + 1),
  );

  const allRows: ParsedRow[] = parsed.data.map((row, index) => ({
    rowNumber: index + 1,
    productHandle: cell(row, headerMap, "product_handle"),
    productId: cell(row, headerMap, "product_id"),
    rating: cell(row, headerMap, "rating"),
    authorName: cell(row, headerMap, "author_name"),
    reviewText: cell(row, headerMap, "review_text"),
    reviewTitle: cell(row, headerMap, "review_title"),
    reviewDate: cell(row, headerMap, "review_date"),
    sourceReviewUrl: cell(row, headerMap, "source_review_url"),
    photoUrls: cell(row, headerMap, "photo_urls"),
  }));

  return {
    rows: allRows.filter((r) => !malformedRowNumbers.has(r.rowNumber)),
    rowErrors: [...malformedRowNumbers].map((rowNumber) => ({
      rowNumber,
      reason: "Malformed row (wrong number of fields or bad quoting) — skipped.",
    })),
  };
}

// Real Shopify product handles are lowercase alphanumeric segments joined by
// single hyphens. Anything outside that shape can't be a real handle, and —
// more importantly — could otherwise get pasted into the Admin Search DSL
// query string below unescaped-in-spirit (e.g. embedded quotes or `OR`/`:`)
// and break parsing for the *entire* chunk it's batched into, not just its
// own row. Filtering these out up front keeps one malformed CSV value from
// corrupting product resolution for the ~50 unrelated handles sharing its
// chunk.
const VALID_HANDLE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface ResolvedProduct {
  id: string;
  title: string | null;
}

/** Resolves the unique product handles referenced by the CSV in batches of
 *  PRODUCT_LOOKUP_BATCH_SIZE, so a 1000-row file with 40 distinct products
 *  costs ~1 Admin API call, not up to 1000. A chunk whose Admin API call
 *  fails (throttling, transient 5xx) is caught and simply resolves none of
 *  its handles rather than throwing — the caller already treats an
 *  unresolved handle as a normal per-row "product not found" error, so a
 *  transient API failure degrades to some rows failing, never the whole
 *  import crashing. */
async function resolveProductHandles(
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  handles: string[],
): Promise<Map<string, ResolvedProduct>> {
  const uniqueHandles = [
    ...new Set(handles.filter((h) => VALID_HANDLE.test(h))),
  ];
  const resolved = new Map<string, ResolvedProduct>();

  for (let i = 0; i < uniqueHandles.length; i += PRODUCT_LOOKUP_BATCH_SIZE) {
    const chunk = uniqueHandles.slice(i, i + PRODUCT_LOOKUP_BATCH_SIZE);
    const queryString = chunk.map((h) => `handle:'${h}'`).join(" OR ");

    try {
      const response = await admin.graphql(
        `#graphql
        query ProductsByHandle($query: String!, $first: Int!) {
          products(first: $first, query: $query) {
            nodes {
              id
              handle
              title
            }
          }
        }`,
        { variables: { query: queryString, first: chunk.length } },
      );
      const { data } = await response.json();
      for (const node of data?.products?.nodes ?? []) {
        if (node?.handle) {
          resolved.set(node.handle, { id: node.id, title: node.title ?? null });
        }
      }
    } catch (error) {
      console.error(
        `Product handle lookup failed for a chunk of ${chunk.length} handles:`,
        error,
      );
      // Leave this chunk's handles unresolved — rows referencing them will
      // surface as "product not found" errors instead of aborting the batch.
    }
  }

  return resolved;
}

/** Same idea for files that identify products by id instead of handle —
 *  Judge.me can export one without the other. The CSV carries the legacy
 *  numeric id, which has to become a GID before the Admin API will take it;
 *  extractLegacyProductId has already proved the value is nothing but
 *  digits, so nothing unvalidated reaches the interpolation below.
 *
 *  Keyed by the numeric id as it appeared in the file, so the caller can
 *  look a row's raw value straight up. */
async function resolveProductsByLegacyId(
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  legacyIds: string[],
): Promise<Map<string, ResolvedProduct>> {
  const uniqueIds = [...new Set(legacyIds)];
  const resolved = new Map<string, ResolvedProduct>();

  for (let i = 0; i < uniqueIds.length; i += PRODUCT_LOOKUP_BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + PRODUCT_LOOKUP_BATCH_SIZE);
    const gids = chunk.map((id) => `gid://shopify/Product/${id}`);

    try {
      const response = await admin.graphql(
        `#graphql
        query ProductsByIds($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
            }
          }
        }`,
        { variables: { ids: gids } },
      );
      const { data } = await response.json();
      for (const node of data?.nodes ?? []) {
        // nodes() returns null in-place for ids that don't exist or aren't
        // products, so a bad id in the file resolves to nothing and its row
        // reports "product not found" — it can never land on another row's
        // product.
        const numericId = String(node?.id ?? "").split("/").pop();
        if (node?.id && numericId) {
          resolved.set(numericId, { id: node.id, title: node.title ?? null });
        }
      }
    } catch (error) {
      console.error(
        `Product id lookup failed for a chunk of ${chunk.length} ids:`,
        error,
      );
    }
  }

  return resolved;
}

/** A row that passed validation and is ready to insert. */
interface PreparedRow {
  rowNumber: number;
  dedupeKey: string;
  productId: string;
  productTitle: string | null;
  rating: number;
  authorName: string;
  body: string;
  sourceCreatedAt: Date | null;
  sourceReviewUrl: string | null;
  photoUrls: string[];
}

export async function importReviewsFromCsv(params: {
  shopId: string;
  planId: PlanId;
  marketplace: ImportMarketplace;
  fileText: string;
  filename: string;
  actor: string;
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };
}): Promise<ImportResult> {
  const plan = getPlan(params.planId);

  if (!plan.features.importMarketplaces.includes(params.marketplace)) {
    throw new ReviewImportValidationError(
      `Your plan does not allow importing from ${params.marketplace}. Upgrade to Pro to unlock it.`,
    );
  }

  // On Free this is an abuse ceiling set far above any real migration, not a
  // paywall — see maxImportedReviewsTotal in plans.server.ts. It stays a
  // number rather than null precisely so this enforcement path keeps being
  // exercised instead of becoming dead code behind a condition no plan meets.
  const cap = plan.features.maxImportedReviewsTotal;
  if (cap !== null) {
    // Fast-fail for UX only (avoid burning API calls resolving products on
    // a shop that's obviously already over its cap). This check is NOT what
    // enforces the cap — see the per-chunk transaction below, which is the
    // actual, race-safe enforcement.
    const alreadyImported = await db.review.count({
      where: { shopId: params.shopId, source: "IMPORTED" },
    });
    if (alreadyImported >= cap) {
      throw new ReviewImportValidationError(
        `This store has reached the maximum of ${cap.toLocaleString("en-US")} stored imported reviews. Nothing already imported has been touched — get in touch and we'll raise it.`,
      );
    }
  }

  const { rows, rowErrors } = parseReviewCsv(params.fileText);

  const [productsByHandle, productsByLegacyId] = await Promise.all([
    resolveProductHandles(
      params.admin,
      rows.map((r) => r.productHandle).filter(Boolean),
    ),
    resolveProductsByLegacyId(
      params.admin,
      rows
        .map((r) => extractLegacyProductId(r.productId))
        .filter((id): id is string => id !== null),
    ),
  ]);

  const batch = await db.reviewImportBatch.create({
    data: {
      shopId: params.shopId,
      marketplace: params.marketplace,
      filename: params.filename,
      status: "PROCESSING",
      totalRows: rows.length + rowErrors.length,
      createdBy: params.actor,
    },
  });

  // Malformed rows never enter validation below (there's nothing valid to
  // process), but they still count toward the batch's error total.
  const errors: RowError[] = [...rowErrors];
  let importedCount = 0;
  let skippedDuplicateCount = 0;

  // Pass 1 — validate and normalise every row up front, with no database
  // work at all. Rows that can't be saved are reported here; what survives
  // is inserted in chunks below.
  const prepared: PreparedRow[] = [];
  const seenKeys = new Set<string>();

  for (const row of rows) {
    const product =
      productsByHandle.get(row.productHandle) ??
      (() => {
        const legacyId = extractLegacyProductId(row.productId);
        return legacyId ? productsByLegacyId.get(legacyId) : undefined;
      })();

    if (!product) {
      const reference = row.productHandle || row.productId || "(empty)";
      errors.push({
        rowNumber: row.rowNumber,
        reason: `No product matching "${reference}" in this store. Check the product handle or id in your file.`,
      });
      continue;
    }

    const rating = normalizeRating(row.rating);
    if (rating === null) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: `"${row.rating}" isn't a rating we can read. Use a number from 1 to 5.`,
      });
      continue;
    }

    const body = composeBody(row.reviewTitle, row.reviewText, MAX_BODY_LENGTH);
    if (!body) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: "This review has no text — star-only reviews aren't imported.",
      });
      continue;
    }

    // An empty author becomes Anonymous rather than a rejected row: the
    // merchant would rather keep the review than lose it over a blank name,
    // and it's what the app they're leaving does with the same file.
    const authorName = (row.authorName || "Anonymous").slice(0, MAX_NAME_LENGTH);
    const sourceCreatedAt = parseOptionalDate(row.reviewDate);

    const dedupeKey = computeDedupeKey({
      shopId: params.shopId,
      productId: product.id,
      authorName,
      rating,
      body,
      sourceCreatedAt,
    });

    // The same review twice inside one file. The database's unique index
    // would catch it anyway, but counting it here keeps the row-by-row
    // report accurate about which upload it came from.
    if (seenKeys.has(dedupeKey)) {
      skippedDuplicateCount += 1;
      continue;
    }
    seenKeys.add(dedupeKey);

    prepared.push({
      rowNumber: row.rowNumber,
      dedupeKey,
      productId: product.id,
      productTitle: product.title,
      rating,
      authorName,
      body,
      sourceCreatedAt,
      sourceReviewUrl: row.sourceReviewUrl || null,
      photoUrls: plan.features.photosInReviews ? parsePhotoUrls(row.photoUrls) : [],
    });
  }

  // Pass 2 — insert. Each chunk's cap check and insert run inside one short
  // transaction, serialized per shop by a Postgres advisory lock: two
  // imports for the same shop racing each other (two tabs, or a retried
  // request) can't both read "capacity available" and jointly overshoot.
  // Scoping the lock to a chunk rather than the whole file keeps one slow
  // import from blocking another for minutes, and keeps each transaction
  // far inside Prisma's timeout.
  let capReached = false;

  try {
    for (let i = 0; i < prepared.length; i += INSERT_CHUNK_SIZE) {
      if (capReached) {
        for (const row of prepared.slice(i)) {
          errors.push({
            rowNumber: row.rowNumber,
            reason: "Skipped: this store's imported-review storage limit was reached.",
          });
        }
        break;
      }

      const chunk = prepared.slice(i, i + INSERT_CHUNK_SIZE);

      const outcome = await db.$transaction(
        async (tx) => {
          // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void,
          // which $queryRaw can't deserialize into a Prisma value.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.shopId})::bigint)`;

          let writable = chunk;
          let overflow: PreparedRow[] = [];

          if (cap !== null) {
            const currentCount = await tx.review.count({
              where: { shopId: params.shopId, source: "IMPORTED" },
            });
            const room = Math.max(0, cap - currentCount);
            if (room < chunk.length) {
              writable = chunk.slice(0, room);
              overflow = chunk.slice(room);
            }
          }

          if (writable.length === 0) {
            return { insertedKeys: new Set<string>(), attempted: writable, overflow };
          }

          const created = await tx.review.createManyAndReturn({
            // skipDuplicates turns the unique index on
            // (shopId, importDedupeKey) into "insert what's new, ignore what
            // we already have", which is what re-uploading an overlapping
            // export should do. createManyAndReturn (Prisma 6, Postgres)
            // hands back the rows that actually went in, so the ones it
            // leaves out are exactly the duplicates — the count stays honest
            // without a second query.
            skipDuplicates: true,
            select: { id: true, importDedupeKey: true },
            data: writable.map((row) => ({
              shopId: params.shopId,
              productId: row.productId,
              productTitle: row.productTitle,
              rating: row.rating,
              authorName: row.authorName,
              body: row.body,
              status: "APPROVED" as const,
              source: "IMPORTED" as const,
              importMarketplace: params.marketplace,
              importBatchId: batch.id,
              importDedupeKey: row.dedupeKey,
              sourceCreatedAt: row.sourceCreatedAt,
              // Null when the file gave no usable date: the review is kept,
              // but it sorts after everything whose date we do know rather
              // than jumping ahead of reviews the store earned today.
              displayedAt: row.sourceCreatedAt,
              sourceReviewUrl: row.sourceReviewUrl,
            })),
          });

          const insertedKeys = new Set(
            created
              .map((review) => review.importDedupeKey)
              .filter((key): key is string => key !== null),
          );

          // Photos can't ride along with createManyAndReturn (createMany
          // can't write nested relations), so they go in as their own bulk
          // insert against the ids it just returned — same transaction, so a
          // review is never left visible without the photos that belong to
          // it.
          const photoRows = created.flatMap((review) => {
            const source = writable.find(
              (row) => row.dedupeKey === review.importDedupeKey,
            );
            return (source?.photoUrls ?? []).map((url) => ({
              reviewId: review.id,
              url,
            }));
          });

          if (photoRows.length > 0) {
            await tx.reviewPhoto.createMany({ data: photoRows });
          }

          return { insertedKeys, attempted: writable, overflow };
        },
        { timeout: 30_000, maxWait: 10_000 },
      );

      importedCount += outcome.insertedKeys.size;
      skippedDuplicateCount +=
        outcome.attempted.length - outcome.insertedKeys.size;

      if (outcome.overflow.length > 0) {
        capReached = true;
        for (const row of outcome.overflow) {
          errors.push({
            rowNumber: row.rowNumber,
            reason: "Skipped: this store's imported-review storage limit was reached.",
          });
        }
      }

      // Checkpoint after every chunk, so a crash mid-import (Render restarts
      // the process on every deploy, per rate-limit.server.ts) leaves the
      // batch's counts close to reality instead of stuck at
      // status=PROCESSING with importedCount=0 while some reviews from this
      // run are already live.
      await db.reviewImportBatch
        .update({
          where: { id: batch.id },
          data: { importedCount, skippedDuplicateCount, errorCount: errors.length },
        })
        .catch((checkpointError) => {
          console.error(
            "Failed to checkpoint import batch progress:",
            checkpointError,
          );
        });
    }
  } catch (error) {
    // A chunk's transaction failed outright (the database became
    // unreachable, a deadlock, a timeout). Mark the batch FAILED with
    // whatever counts we have instead of leaving it stuck at PROCESSING
    // forever with no code path that will ever change it — then still
    // surface the error to the caller. Chunks that already committed stay
    // committed; re-uploading the same file imports only what's missing,
    // because the dedupe key makes the whole operation repeatable.
    await db.reviewImportBatch
      .update({
        where: { id: batch.id },
        data: {
          status: "FAILED",
          importedCount,
          skippedDuplicateCount,
          errorCount: errors.length,
          errorSummary: JSON.stringify(errors.slice(0, MAX_ERROR_SUMMARY_ROWS)),
          completedAt: new Date(),
        },
      })
      .catch((updateError) => {
        console.error("Failed to mark import batch as FAILED:", updateError);
      });
    throw error;
  }

  await db.reviewImportBatch.update({
    where: { id: batch.id },
    data: {
      status: "COMPLETED",
      importedCount,
      skippedDuplicateCount,
      errorCount: errors.length,
      errorSummary: JSON.stringify(errors.slice(0, MAX_ERROR_SUMMARY_ROWS)),
      completedAt: new Date(),
    },
  });

  logAudit({
    shopId: params.shopId,
    actor: params.actor,
    action: "review.import_batch_completed",
    detail: `marketplace=${params.marketplace} imported=${importedCount} duplicates=${skippedDuplicateCount} errors=${errors.length}`,
  });

  return {
    batchId: batch.id,
    totalRows: rows.length + rowErrors.length,
    importedCount,
    skippedDuplicateCount,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_ERROR_SUMMARY_ROWS),
  };
}

/** Recent import batches for the history table on /app/reviews/import. */
export async function listRecentImportBatches(shopId: string) {
  return db.reviewImportBatch.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}
