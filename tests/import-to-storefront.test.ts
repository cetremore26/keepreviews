import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { importReviewsFromCsv } from "../app/services/review-import.server";
import { setReviewStatus } from "../app/services/reviews.server";
import { loader as proxyLoader } from "../app/routes/apps.proxy";
import { action as submitAction } from "../app/routes/apps.proxy.submit";
import {
  PRODUCT_A,
  PRODUCT_B,
  SHOP_DOMAIN,
  csv,
  fakeAdmin,
  readNormalizeProductIdMigration,
  resetDatabase,
  signedProxyUrl,
} from "./helpers";

/**
 * The regression this file exists for: reviews imported from a CSV never
 * appeared in the storefront widget, because the import stored the Admin
 * API's GID in Review.productId and the widget asks for the numeric id.
 *
 * The earlier checks all stopped at the database. These go the whole way:
 * they run the real import, then call the real app-proxy route the way the
 * widget does (signed request, numeric product_id) and look at what the
 * storefront would render.
 */

const HEADER = ["product_handle", "rating", "author_name", "review_text", "review_date"];
const ID_HEADER = ["product_id", "rating", "author_name", "review_text", "review_date"];

let shopId: string;

async function importCsv(fileText: string) {
  return importReviewsFromCsv({
    shopId,
    planId: "FREE",
    marketplace: "LOOX",
    fileText,
    filename: "reviews.csv",
    actor: "test@example.com",
    admin: fakeAdmin(),
  });
}

/** What the storefront widget does: GET the proxy with {{ product.id }}. */
async function widgetFetch(productId: string) {
  const url = signedProxyUrl("/apps/proxy", { product_id: productId });
  const response = await proxyLoader({
    request: new Request(url),
    params: {},
    context: {},
  } as never);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    reviews: { id: string; rating: number; authorName: string; body: string }[];
    averageRating: number;
    totalApprovedCount: number;
  };
}

/** What the widget's "write a review" form does. */
async function widgetSubmit(payload: Record<string, unknown>) {
  const url = signedProxyUrl("/apps/proxy/submit", {});
  const response = await submitAction({
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    params: {},
    context: {},
  } as never);
  return { status: response.status, body: (await response.json()) as any };
}

beforeEach(async () => {
  await resetDatabase();
  shopId = (await db.shop.create({ data: { domain: SHOP_DOMAIN } })).id;
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe("imported reviews reach the storefront widget", () => {
  it("resolved by product handle: shown when the widget asks with the numeric id", async () => {
    const result = await importCsv(
      csv(HEADER, [
        [PRODUCT_A.handle, "5", "Ana", "Perfect fit", "2025-03-01"],
        [PRODUCT_A.handle, "3", "Luis", "Runs a bit small", "2025-02-01"],
      ]),
    );
    expect(result).toMatchObject({ importedCount: 2, errorCount: 0 });

    const widget = await widgetFetch(PRODUCT_A.numericId);

    expect(widget.totalApprovedCount).toBe(2);
    expect(widget.averageRating).toBe(4);
    // Newest first, by the review's own date.
    expect(widget.reviews.map((r) => [r.authorName, r.body])).toEqual([
      ["Ana", "Perfect fit"],
      ["Luis", "Runs a bit small"],
    ]);
  });

  it("resolved by product_id: shown whether the file carried the number or the GID", async () => {
    const result = await importCsv(
      csv(ID_HEADER, [
        [PRODUCT_A.numericId, "5", "Ana", "Numeric id in the file", "2025-03-01"],
        [PRODUCT_A.gid, "4", "Luis", "GID in the file", "2025-02-01"],
      ]),
    );
    expect(result).toMatchObject({ importedCount: 2, errorCount: 0 });

    const widget = await widgetFetch(PRODUCT_A.numericId);

    expect(widget.totalApprovedCount).toBe(2);
    expect(widget.reviews.map((r) => r.authorName).sort()).toEqual(["Ana", "Luis"]);
  });

  it("stores the numeric id, not the GID", async () => {
    await importCsv(
      csv(HEADER, [[PRODUCT_A.handle, "5", "Ana", "By handle", "2025-03-01"]]),
    );
    await importCsv(
      csv(ID_HEADER, [[PRODUCT_A.gid, "4", "Luis", "By id", "2025-02-01"]]),
    );

    const stored = await db.review.findMany({ select: { productId: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every((r) => r.productId === PRODUCT_A.numericId)).toBe(true);
  });

  it("is also found when the caller asks with the GID", async () => {
    await importCsv(
      csv(HEADER, [[PRODUCT_A.handle, "5", "Ana", "By handle", "2025-03-01"]]),
    );

    const widget = await widgetFetch(PRODUCT_A.gid);

    expect(widget.totalApprovedCount).toBe(1);
  });

  it("does not show up on another product's page", async () => {
    await importCsv(
      csv(HEADER, [
        [PRODUCT_A.handle, "5", "Ana", "Shirt review", "2025-03-01"],
        [PRODUCT_B.handle, "2", "Bea", "Scarf review", "2025-03-01"],
      ]),
    );

    const shirt = await widgetFetch(PRODUCT_A.numericId);
    const scarf = await widgetFetch(PRODUCT_B.numericId);

    expect(shirt.reviews.map((r) => r.body)).toEqual(["Shirt review"]);
    expect(scarf.reviews.map((r) => r.body)).toEqual(["Scarf review"]);
  });
});

describe("storefront and imported reviews share one format", () => {
  it("an approved storefront review and an imported one appear together", async () => {
    await importCsv(
      csv(HEADER, [[PRODUCT_A.handle, "5", "Ana", "Imported review", "2025-01-01"]]),
    );

    const submitted = await widgetSubmit({
      productId: PRODUCT_A.numericId, // what {{ product.id }} gives the widget
      productTitle: PRODUCT_A.title,
      rating: 3,
      authorName: "Carla",
      body: "Storefront review",
    });
    expect(submitted.status).toBe(200);
    await setReviewStatus(shopId, submitted.body.reviewId, "APPROVED");

    const widget = await widgetFetch(PRODUCT_A.numericId);

    expect(widget.totalApprovedCount).toBe(2);
    expect(widget.averageRating).toBe(4);
    expect(widget.reviews.map((r) => r.body).sort()).toEqual([
      "Imported review",
      "Storefront review",
    ]);
  });

  it("a storefront submission that arrives as a GID is stored as the number", async () => {
    const submitted = await widgetSubmit({
      productId: PRODUCT_A.gid,
      rating: 5,
      authorName: "Carla",
      body: "Sent with a GID",
    });
    expect(submitted.status).toBe(200);

    const stored = await db.review.findUniqueOrThrow({
      where: { id: submitted.body.reviewId },
    });
    expect(stored.productId).toBe(PRODUCT_A.numericId);

    await setReviewStatus(shopId, stored.id, "APPROVED");
    expect((await widgetFetch(PRODUCT_A.numericId)).totalApprovedCount).toBe(1);
  });

  it("a submission for something that is not a product id is rejected", async () => {
    const submitted = await widgetSubmit({
      productId: "not-a-product",
      rating: 5,
      authorName: "Carla",
      body: "Nope",
    });

    expect(submitted.status).toBe(400);
    expect(await db.review.count()).toBe(0);
  });
});

describe("reviews imported before the fix (stored with a GID)", () => {
  /** Puts the database in the state production is in today: the same rows
   *  the importer wrote, with the GID in productId. The dedupe key is left
   *  exactly as the importer computed it. */
  async function downgradeToLegacyGidRows() {
    await db.$executeRawUnsafe(
      `UPDATE "Review" SET "productId" = 'gid://shopify/Product/' || "productId" WHERE "source" = 'IMPORTED'`,
    );
  }

  const FILE = () =>
    csv(HEADER, [
      [PRODUCT_A.handle, "5", "Ana", "Perfect fit", "2025-03-01"],
      [PRODUCT_A.handle, "3", "Luis", "Runs a bit small", "2025-02-01"],
    ]);

  it("are invisible until the data migration runs, and visible after it", async () => {
    await importCsv(FILE());
    await downgradeToLegacyGidRows();

    expect((await widgetFetch(PRODUCT_A.numericId)).totalApprovedCount).toBe(0);

    await db.$executeRawUnsafe(readNormalizeProductIdMigration());

    const widget = await widgetFetch(PRODUCT_A.numericId);
    expect(widget.totalApprovedCount).toBe(2);
    expect(widget.reviews.map((r) => r.authorName).sort()).toEqual(["Ana", "Luis"]);
  });

  it("the migration only rewrites Product GIDs, and is idempotent", async () => {
    const base = { shopId, rating: 5, authorName: "X", body: "x", status: "APPROVED" as const };
    await db.review.createMany({
      data: [
        { ...base, productId: "gid://shopify/Product/9392803971322" },
        { ...base, productId: "gid://shopify/Product/0000123" },
        { ...base, productId: "9392803971999" }, // already canonical
        { ...base, productId: "gid://shopify/ProductVariant/55" }, // not a Product
        { ...base, productId: "gid://shopify/Product/abc" }, // malformed
        { ...base, productId: "something-else" },
      ],
    });
    const migrate = readNormalizeProductIdMigration();

    await db.$executeRawUnsafe(migrate);
    const afterFirst = await db.review.findMany({
      select: { productId: true },
      orderBy: { productId: "asc" },
    });
    await db.$executeRawUnsafe(migrate);
    const afterSecond = await db.review.findMany({
      select: { productId: true },
      orderBy: { productId: "asc" },
    });

    expect(afterFirst.map((r) => r.productId).sort()).toEqual(
      [
        "123", // leading zeros stripped, same as normalizeProductId
        "9392803971322",
        "9392803971999",
        "gid://shopify/ProductVariant/55",
        "gid://shopify/Product/abc",
        "something-else",
      ].sort(),
    );
    expect(afterSecond).toEqual(afterFirst);
  });

  it("re-uploading the same file after the migration adds nothing", async () => {
    await importCsv(FILE());
    await downgradeToLegacyGidRows();
    await db.$executeRawUnsafe(readNormalizeProductIdMigration());

    const again = await importCsv(FILE());

    expect(again).toMatchObject({ importedCount: 0, skippedDuplicateCount: 2 });
    expect(await db.review.count()).toBe(2);
    expect((await widgetFetch(PRODUCT_A.numericId)).totalApprovedCount).toBe(2);
  });

  it("keeps the dedupe key exactly as it was: sha256 over the GID", async () => {
    await importCsv(
      csv(HEADER, [[PRODUCT_A.handle, "5", "Ana", "Perfect fit", "2025-03-01"]]),
    );

    // The formula the importer used before this change, spelled out.
    const expected = crypto
      .createHash("sha256")
      .update(
        [
          shopId,
          PRODUCT_A.gid,
          "ana",
          5,
          "perfect fit",
          new Date("2025-03-01").toISOString(),
        ].join("|"),
      )
      .digest("hex");

    const stored = await db.review.findFirstOrThrow();
    expect(stored.importDedupeKey).toBe(expected);
  });
});
