import crypto from "node:crypto";
import Papa from "papaparse";
import type { ImportMarketplace } from "@prisma/client";

import db from "../db.server";
import { getPlan, type PlanId } from "../config/plans.server";
import { assertValidRating, MAX_BODY_LENGTH, MAX_NAME_LENGTH } from "./reviews.server";
import { logAudit } from "../utils/audit-log.server";

/**
 * CSV-based review import. Deliberately NOT scraping: AliExpress/Amazon/Etsy
 * either forbid it in their terms of use or have no public reviews API, and
 * the market research behind this feature (mineria_willingness_to_pay.md)
 * found that scraping-based importers are exactly what breaks, loses rows,
 * or duplicates reviews for merchants. A CSV the merchant supplies (however
 * they got it) can't break that way, and never puts KeepReviews in the
 * business of scraping a site that prohibits it.
 *
 * Gating (which marketplaces a plan may import, and how many total imported
 * reviews it may hold) is enforced here, not just in the UI — same rule as
 * every other plan-gated action in this app.
 */

// Each row does its own lock+count+insert round trip to the DB (see the
// per-row transaction below) — against a remote Postgres this can run
// ~20-50ms/row, so 1000 rows risked exceeding a typical platform request
// timeout mid-import. Capped lower to keep the worst case well within it;
// a merchant with more reviews just splits across multiple uploads.
const MAX_ROWS_PER_FILE = 300;
const PRODUCT_LOOKUP_BATCH_SIZE = 50;
const MAX_ERROR_SUMMARY_ROWS = 200;

export class ReviewImportValidationError extends Error {}
class CapReachedError extends Error {}

const REQUIRED_COLUMNS = [
  "product_handle",
  "rating",
  "author_name",
  "review_text",
] as const;

const OPTIONAL_COLUMNS = [
  "review_date",
  "source_review_url",
  "photo_urls",
] as const;

export const CSV_TEMPLATE_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

interface ParsedRow {
  rowNumber: number; // 1-based, header excluded — matches what a merchant sees in a spreadsheet minus the header row
  productHandle: string;
  rating: string;
  authorName: string;
  reviewText: string;
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

  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new ReviewImportValidationError(
      `CSV is missing required column(s): ${missing.join(", ")}.`,
    );
  }

  if (parsed.data.length === 0) {
    throw new ReviewImportValidationError("CSV has no data rows.");
  }
  if (parsed.data.length > MAX_ROWS_PER_FILE) {
    throw new ReviewImportValidationError(
      `CSV has ${parsed.data.length} rows; the limit per upload is ${MAX_ROWS_PER_FILE}. Split it into multiple files.`,
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
    productHandle: (row.product_handle ?? "").trim(),
    rating: (row.rating ?? "").trim(),
    authorName: (row.author_name ?? "").trim(),
    reviewText: (row.review_text ?? "").trim(),
    reviewDate: (row.review_date ?? "").trim(),
    sourceReviewUrl: (row.source_review_url ?? "").trim(),
    photoUrls: (row.photo_urls ?? "").trim(),
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
): Promise<Map<string, { id: string; title: string }>> {
  const uniqueHandles = [
    ...new Set(handles.filter((h) => VALID_HANDLE.test(h))),
  ];
  const resolved = new Map<string, { id: string; title: string }>();

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
          resolved.set(node.handle, { id: node.id, title: node.title });
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

function computeDedupeKey(params: {
  shopId: string;
  productId: string;
  marketplace: ImportMarketplace;
  authorName: string;
  rating: number;
  body: string;
  sourceCreatedAt: Date | null;
}): string {
  const raw = [
    params.shopId,
    params.productId,
    params.marketplace,
    params.authorName.toLowerCase(),
    params.rating,
    params.body.toLowerCase(),
    params.sourceCreatedAt?.toISOString() ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function parseOptionalDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  const cap = plan.features.maxImportedReviewsTotal;
  if (cap !== null) {
    // Fast-fail for UX only (avoid burning API calls resolving products on
    // a shop that's obviously already over its cap). This check is NOT
    // what enforces the cap — see the per-row transaction below, which is
    // the actual, race-safe enforcement.
    const alreadyImported = await db.review.count({
      where: { shopId: params.shopId, source: "IMPORTED" },
    });
    if (alreadyImported >= cap) {
      throw new ReviewImportValidationError(
        `Your plan allows up to ${cap} imported reviews total, and you've already reached that. Upgrade to Pro for unlimited imports.`,
      );
    }
  }

  const { rows, rowErrors } = parseReviewCsv(params.fileText);
  const productMap = await resolveProductHandles(
    params.admin,
    rows.map((r) => r.productHandle),
  );

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

  // Malformed rows never enter the main loop below (there's nothing valid
  // to process), but they still count toward the batch's error total.
  const errors: RowError[] = [...rowErrors];
  let importedCount = 0;
  let skippedDuplicateCount = 0;
  let capReached = false;

  // Handles one row end to end (validation, cap check, insert) and updates
  // the closures above (importedCount, skippedDuplicateCount, errors,
  // capReached) as a side effect. Extracted out of the loop body — with the
  // row logic inline, every `continue` used to skip past the checkpoint
  // below for that iteration, so duplicates/not-found/cap-reached (the
  // overwhelmingly common cases) almost never got checkpointed. Calling
  // this instead of inlining means the checkpoint always runs, regardless
  // of which of these branches a row took.
  async function processRow(row: ParsedRow): Promise<void> {
    if (capReached) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: "Skipped: plan's imported-reviews limit reached.",
      });
      return;
    }

    try {
      const product = productMap.get(row.productHandle);
      if (!product) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: `Product handle "${row.productHandle}" not found in this store.`,
        });
        return;
      }

      const ratingNum = Number(row.rating);
      assertValidRating(ratingNum);

      const authorName = row.authorName.slice(0, MAX_NAME_LENGTH);
      const body = row.reviewText.slice(0, MAX_BODY_LENGTH);
      if (!authorName || !body) {
        errors.push({
          rowNumber: row.rowNumber,
          reason: "Missing author_name or review_text.",
        });
        return;
      }

      const sourceCreatedAt = parseOptionalDate(row.reviewDate);
      const dedupeKey = computeDedupeKey({
        shopId: params.shopId,
        productId: product.id,
        marketplace: params.marketplace,
        authorName,
        rating: ratingNum,
        body,
        sourceCreatedAt,
      });

      const photoUrls = plan.features.photosInReviews
        ? row.photoUrls
            .split("|")
            .map((u) => u.trim())
            .filter(Boolean)
            .slice(0, 6)
        : [];

      // Each row's cap check + insert runs inside its own short transaction,
      // serialized per shop by a Postgres advisory lock. This is what
      // actually enforces maxImportedReviewsTotal — two imports for the
      // same shop racing each other (two tabs, or a retried request) can no
      // longer both read "capacity available" and jointly overshoot the
      // cap, because the count-then-insert for one row is atomic and
      // mutually exclusive with every other row's, across requests. Scoping
      // the lock/transaction to a single row (not the whole loop) keeps a
      // duplicate-key error on one row from poisoning the Postgres
      // transaction for every other row after it.
      await db.$transaction(async (tx) => {
        // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void,
        // which $queryRaw can't deserialize into a Prisma value.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.shopId})::bigint)`;

        if (cap !== null) {
          const currentCount = await tx.review.count({
            where: { shopId: params.shopId, source: "IMPORTED" },
          });
          if (currentCount >= cap) {
            throw new CapReachedError();
          }
        }

        await tx.review.create({
          data: {
            shopId: params.shopId,
            productId: product.id,
            productTitle: product.title,
            rating: ratingNum,
            authorName,
            body,
            status: "APPROVED",
            source: "IMPORTED",
            importMarketplace: params.marketplace,
            importBatchId: batch.id,
            importDedupeKey: dedupeKey,
            sourceCreatedAt,
            sourceReviewUrl: row.sourceReviewUrl || null,
            photos: { create: photoUrls.map((url) => ({ url })) },
          },
        });
      });

      importedCount += 1;
    } catch (error) {
      if (error instanceof CapReachedError) {
        capReached = true;
        errors.push({
          rowNumber: row.rowNumber,
          reason: "Skipped: plan's imported-reviews limit reached.",
        });
        return;
      }
      // Unique constraint violation on (shopId, importDedupeKey) = a
      // duplicate row, not a real error — expected on a re-uploaded file.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        skippedDuplicateCount += 1;
        return;
      }
      const reason =
        error instanceof Error ? error.message : "Unknown error importing this row.";
      errors.push({ rowNumber: row.rowNumber, reason });
    }
  }

  try {
    for (const [index, row] of rows.entries()) {
      await processRow(row);

      // Checkpoint progress every 50 rows — regardless of what processRow
      // did with this row — so a crash mid-import (Render restarts the
      // process on every deploy, per rate-limit.server.ts) leaves the
      // batch's counts close to reality instead of stuck at
      // status=PROCESSING with importedCount=0 while some reviews from this
      // run are already live.
      if ((index + 1) % 50 === 0) {
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
    }
  } catch (error) {
    // Something outside the per-row try/catch above blew up (e.g. the DB
    // itself became unreachable mid-loop). Mark the batch FAILED with
    // whatever counts we have instead of leaving it stuck at PROCESSING
    // forever with no code path that will ever change it — then still
    // surface the error to the caller.
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
