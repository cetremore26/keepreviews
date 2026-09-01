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

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — well above what 1000 CSV rows need

const MARKETPLACE_OPTIONS: { label: string; value: ImportMarketplace }[] = [
  { label: "AliExpress", value: "ALIEXPRESS" },
  { label: "Amazon", value: "AMAZON" },
  { label: "Etsy", value: "ETSY" },
  { label: "Shopee", value: "SHOPEE" },
];

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
    return { error: "File is too large (2MB max)." };
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
  if (Buffer.byteLength(fileText, "utf8") > MAX_FILE_BYTES) {
    return { error: "File is too large (2MB max)." };
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

  const [marketplace, setMarketplace] = useState<ImportMarketplace>("ALIEXPRESS");
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

  const handleDrop = useCallback((_files: File[], accepted: File[]) => {
    setReadError(null);
    setFile(accepted[0] ?? null);
  }, []);

  const handleImport = useCallback(async () => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setReadError("File is too large (2MB max).");
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
    batch.marketplace,
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
              Import reviews from a CSV
            </Text>
            <Text as="p" tone="subdued">
              Bring in reviews you already collected somewhere else. Download
              the template below, fill it in, and upload it here — imported
              reviews go live as approved right away, and you can still
              reject any of them from the Reviews page afterward.
            </Text>
            <div>
              <Button
                variant="plain"
                loading={isDownloadingTemplate}
                onClick={downloadTemplate}
              >
                Download CSV template
              </Button>
            </div>

            <Select
              label="Marketplace"
              options={MARKETPLACE_OPTIONS}
              value={marketplace}
              onChange={(value) => setMarketplace(value as ImportMarketplace)}
            />

            {isMarketplaceLocked && (
              <Banner tone="info">
                Importing from {marketplace} is a Pro feature. Your Free plan
                includes AliExpress imports (up to{" "}
                {plan.features.maxImportedReviewsTotal} imported reviews
                total).{" "}
                <Link url="/app/pricing" removeUnderline>
                  Upgrade to unlock the rest
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
                  "Marketplace",
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
