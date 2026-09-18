import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Select,
  Button,
  Banner,
  Link,
  DropZone,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { ImportMarketplace } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { syncShopPlanFromShopify } from "../services/billing.server";
import { getPlan } from "../config/plans.server";
import {
  importReviewsFromCsv,
  listRecentImportBatches,
  ReviewImportValidationError,
  type ImportResult,
} from "../services/review-import.server";

// Sized from what a real migration export actually weighs per row, measured
// rather than estimated — the previous 2MB was set when the row limit was
// 300, and a merchant importing 3000 reviews with photos would have passed
// the row check and died on this one:
//
//   short review, no photos .................  199 B/row → 0.57MB per 3000
//   realistic review, no photos .............  580 B/row → 1.66MB per 3000
//   realistic review + 3 Loox photo URLs ....  765 B/row → 2.19MB per 3000
//   long review + 3 photos .................. 1784 B/row → 5.10MB per 3000
//
// 6MB covers MAX_ROWS_PER_FILE (3000) for everything but reviews near
// MAX_BODY_LENGTH, which no export in the wild is made of; that case hits
// this limit and gets told to split, same as the row limit does.
//
// On the wire this travels urlencoded, which inflates accented Spanish text
// by ~1.87x measured — so a 6MB file arrives as ~11MB, still inside the
// Content-Length guard below (MAX_FILE_BYTES * 3).
const MAX_FILE_BYTES = 6 * 1024 * 1024;

/** Both size errors say the same thing the row-limit error says: split it,
 *  nothing is lost. A merchant hitting a wall mid-migration needs the way
 *  out, not the measurement — and re-uploading rows that already went in
 *  never duplicates them, which is the part that makes splitting safe. */
function tooLargeMessage(actualBytes?: number): string {
  const limit = `${MAX_FILE_BYTES / 1024 / 1024}MB`;
  const size = actualBytes
    ? `That file is ${(actualBytes / 1024 / 1024).toFixed(1)}MB. `
    : "";
  return `${size}The limit per upload is ${limit} (about 3,000 reviews with photos). Split it into smaller files and upload them one after another — nothing is lost, and rows you already imported are never duplicated.`;
}

/**
 * What the dropdown offers, and what we tell the merchant once they pick it.
 *
 * `hint` is the single most useful sentence at this point in the flow: the
 * merchant is holding a file from another app and wondering whether it will
 * be rejected. For the two apps whose export format we have actually
 * verified, we name their column names back to them, which is a promise we
 * can keep. For everything else we say plainly that we try to match common
 * names and that the error will name what to rename — offering "Stamped" or
 * "Yotpo" as if they were tested would recreate the exact broken-upload
 * moment this feature exists to remove.
 *
 * Kept in this file rather than derived from plans.server.ts on purpose:
 * that module is server-only (it reads process.env), and this list is read
 * by the component.
 */
const MIGRATION_OPTIONS: {
  label: string;
  value: ImportMarketplace;
  hint: string;
}[] = [
  {
    label: "Judge.me",
    value: "JUDGE_ME",
    hint: "Export your reviews from Judge.me as CSV and upload it unchanged. We read its columns as they come: title, body, rating, reviewer_name, review_date, and either product_handle or product_id.",
  },
  {
    label: "Loox",
    value: "LOOX",
    hint: "Export your reviews from Loox as CSV and upload it unchanged. We read its columns as they come: product_handle, rating, author, body, created_at and photo_url.",
  },
  {
    label: "Another review app",
    value: "OTHER",
    hint: "Stamped, Fera, Yotpo, Okendo, Ali Reviews or anything else: upload the CSV it exports. We match the column names most apps use — and if one doesn't match, the error names the exact column to rename, so nothing is lost.",
  },
];

const MARKETPLACE_OPTIONS: {
  label: string;
  value: ImportMarketplace;
  hint: string;
}[] = [
  {
    label: "AliExpress",
    value: "ALIEXPRESS",
    hint: "Use the CSV template below for marketplace reviews.",
  },
  {
    label: "Amazon",
    value: "AMAZON",
    hint: "Use the CSV template below for marketplace reviews.",
  },
  {
    label: "Etsy",
    value: "ETSY",
    hint: "Use the CSV template below for marketplace reviews.",
  },
  {
    label: "Shopee",
    value: "SHOPEE",
    hint: "Use the CSV template below for marketplace reviews.",
  },
];

// Migration first: it is the case we want a merchant to find without
// looking for it.
const SOURCE_GROUPS = [
  { title: "Moving from another review app", options: MIGRATION_OPTIONS },
  { title: "Importing from a marketplace", options: MARKETPLACE_OPTIONS },
];

const ALL_SOURCES = [...MIGRATION_OPTIONS, ...MARKETPLACE_OPTIONS];

function sourceLabel(value: string): string {
  return ALL_SOURCES.find((option) => option.value === value)?.label ?? value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shopRecord = await getOrCreateShop(session.shop);
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  const batches = await listRecentImportBatches(shop.id);

  return {
    plan: getPlan(shop.plan),
    batches,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  // Reject an oversized body via its declared Content-Length before
  // request.formData() buffers the whole thing into memory. A caller can in
  // principle omit or lie about Content-Length (chunked transfer), so this
  // is defense-in-depth, not a hard guarantee — but this route requires an
  // authenticated Shopify admin session, unlike the public proxy endpoints
  // readJsonWithLimit (app/utils/http.server.ts) was built for, so the
  // realistic risk here is a careless oversized upload, not an anonymous
  // attacker; the length re-check after parsing (below) is the backstop.
  // *3, not *2: the browser posts this as application/x-www-form-urlencoded
  // (submit() with a plain object, not a real multipart File field), which
  // percent-encodes quotes/`&`/`=`/non-ASCII bytes — a legitimately-sized
  // CSV full of accented text can inflate well past its raw byte size once
  // encoded, so a tight multiplier here would reject valid uploads. The
  // post-parse check below is the accurate one.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FILE_BYTES * 3) {
    return { error: tooLargeMessage() };
  }

  const shopRecord = await getOrCreateShop(session.shop);
  const shop = await syncShopPlanFromShopify(session.shop, billing).catch(
    () => shopRecord,
  );

  const formData = await request.formData();
  const marketplace = String(formData.get("marketplace") ?? "") as ImportMarketplace;
  const filename = String(formData.get("filename") ?? "upload.csv");
  const fileText = String(formData.get("fileText") ?? "");

  if (!fileText) {
    return { error: "No file content received." };
  }
  // Byte.length undercounts multi-byte UTF-8 text (accents, non-Latin
  // scripts are common in imported review text) — measure actual bytes.
  const actualBytes = Buffer.byteLength(fileText, "utf8");
  if (actualBytes > MAX_FILE_BYTES) {
    return { error: tooLargeMessage(actualBytes) };
  }

  try {
    const result = await importReviewsFromCsv({
      shopId: shop.id,
      planId: shop.plan,
      marketplace,
      fileText,
      filename,
      actor: session.shop,
      admin,
    });
    return { result };
  } catch (error) {
    if (error instanceof ReviewImportValidationError) {
      return { error: error.message };
    }
    throw error;
  }
};

export default function ReviewsImport() {
  const { plan, batches } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string; result?: ImportResult }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isBusy = navigation.state !== "idle";

  // Defaults to the migration case, not AliExpress: a merchant who opens
  // this screen with a file already in hand is the one worth optimising for.
  const [marketplace, setMarketplace] = useState<ImportMarketplace>("JUDGE_ME");
  const [file, setFile] = useState<File | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);

  // Same reason as exportCsv in app.reviews.tsx: Polaris's url-based Link
  // renders through Remix's client-side router in this app (see
  // linkComponent in AppProvider), so it fetches the route instead of
  // triggering a real browser download, and the embedded session cookie
  // is partitioned to this iframe anyway. Fetching and saving the blob
  // ourselves works in both regards.
  const downloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const response = await fetch("/app/reviews/import/template");
      if (!response.ok) throw new Error("Template download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "keepreviews-import-template.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const allowedMarketplaces = new Set(plan.features.importMarketplaces);
  const isMarketplaceLocked = !allowedMarketplaces.has(marketplace);
  const selectedHint =
    ALL_SOURCES.find((option) => option.value === marketplace)?.hint ?? "";

  const handleDrop = useCallback((_files: File[], accepted: File[]) => {
    setReadError(null);
    setFile(accepted[0] ?? null);
  }, []);

  const handleImport = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setReadError(tooLargeMessage(file.size));
      return;
    }
    try {
      const fileText = await file.text();
      submit(
        { marketplace, filename: file.name, fileText },
        { method: "post" },
      );
    } catch {
      setReadError("Could not read that file. Make sure it's a plain CSV.");
    }
  }, [file, marketplace, submit]);

  const rows = batches.map((batch) => [
    new Date(batch.createdAt).toLocaleDateString(),
    sourceLabel(batch.marketplace),
    batch.filename,
    batch.status,
    String(batch.importedCount),
    String(batch.skippedDuplicateCount),
    String(batch.errorCount),
  ]);

  return (
    <Page>
      <TitleBar title="Import reviews" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Bring your reviews with you
            </Text>
            <Text as="p" tone="subdued">
              Leaving another review app? Export your reviews there and upload
              the file here as it comes — you don't have to rename a single
              column. Every review you bring is stored and kept, on any plan:
              imports go live as approved right away, and you can reject any
              of them from the Reviews page afterward.
            </Text>

            <Select
              label="Where are these reviews coming from?"
              options={SOURCE_GROUPS}
              value={marketplace}
              onChange={(value) => setMarketplace(value as ImportMarketplace)}
            />

            {selectedHint && (
              <Text as="p" tone="subdued">
                {selectedHint}
              </Text>
            )}

            <div>
              <Button
                variant="plain"
                loading={isDownloadingTemplate}
                onClick={downloadTemplate}
              >
                Or download our CSV template
              </Button>
            </div>

            {isMarketplaceLocked && (
              <Banner tone="info">
                Importing from {sourceLabel(marketplace)} is a Pro feature.
                Your Free plan includes moving your reviews over from another
                review app, and AliExpress imports.{" "}
                <Link url="/app/pricing" removeUnderline>
                  Upgrade to unlock the rest
                </Link>
                .
              </Banner>
            )}

            {plan.features.maxDisplayedReviews !== null && (
              <Banner tone="info">
                Import as many reviews as you like — everything you upload is
                stored and never deleted. On the Free plan your storefront
                shows the{" "}
                {plan.features.maxDisplayedReviews} most recent of them per
                product.{" "}
                <Link url="/app/pricing" removeUnderline>
                  Show all of them
                </Link>
                .
              </Banner>
            )}

            <DropZone accept=".csv,text/csv" type="file" onDrop={handleDrop}>
              {file ? (
                <BlockStack gap="100" inlineAlign="center">
                  <Text as="p">{file.name}</Text>
                </BlockStack>
              ) : (
                <DropZone.FileUpload actionTitle="Add a CSV file" />
              )}
            </DropZone>

            {readError && <Banner tone="critical">{readError}</Banner>}
            {actionData?.error && (
              <Banner tone="critical">{actionData.error}</Banner>
            )}
            {actionData?.result && (
              <Banner tone="success">
                Imported {actionData.result.importedCount} of{" "}
                {actionData.result.totalRows} rows.{" "}
                {actionData.result.skippedDuplicateCount > 0 &&
                  `${actionData.result.skippedDuplicateCount} were already imported before. `}
                {actionData.result.errorCount > 0 &&
                  `${actionData.result.errorCount} rows had errors — see the history below.`}
              </Banner>
            )}

            <div>
              <Button
                variant="primary"
                disabled={!file || isBusy || isMarketplaceLocked}
                loading={isBusy}
                onClick={handleImport}
              >
                Import
              </Button>
            </div>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Recent imports
            </Text>
            {batches.length === 0 ? (
              <Text as="p" tone="subdued">
                Nothing imported yet.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                ]}
                headings={[
                  "Date",
                  "Source",
                  "File",
                  "Status",
                  "Imported",
                  "Duplicates",
                  "Errors",
                ]}
                rows={rows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
