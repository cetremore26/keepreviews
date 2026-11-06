import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { importReviewsFromCsv } from "../app/services/review-import.server";
import { PRODUCT_A, SHOP_DOMAIN, csv, fakeAdmin, resetDatabase } from "./helpers";

/**
 * When the Admin API call that resolves products fails — throttling, an
 * outage, or a request refused by the app's IP allowlist — the rows must say
 * so. Before, they reported "No product matching ...", which sends the
 * merchant looking for a mistake in a file that has none.
 */

let shopId: string;

type Admin = Parameters<typeof importReviewsFromCsv>[0]["admin"];

async function importWith(admin: Admin, fileText: string) {
  return importReviewsFromCsv({
    shopId,
    planId: "FREE",
    marketplace: "LOOX",
    fileText,
    filename: "reviews.csv",
    actor: "test@example.com",
    admin,
  });
}

const throwingAdmin: Admin = {
  graphql: async () => {
    throw new Error("403 Forbidden: request IP not in allowlist");
  },
};

const errorBodyAdmin: Admin = {
  graphql: async () =>
    Response.json({ errors: [{ message: "Throttled" }], data: null }),
};

const byHandle = csv(
  ["product_handle", "rating", "author_name", "review_text"],
  [[PRODUCT_A.handle, "5", "ana", "perfect fit"]],
);
const byId = csv(
  ["product_id", "rating", "author_name", "review_text"],
  [[PRODUCT_A.numericId, "5", "ana", "perfect fit"]],
);

beforeEach(async () => {
  await resetDatabase();
  shopId = (await db.shop.create({ data: { domain: SHOP_DOMAIN } })).id;
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe("product lookup failures are reported as such", () => {
  for (const [label, admin] of [
    ["the call throws", throwingAdmin],
    ["the response carries errors and no data", errorBodyAdmin],
  ] as const) {
    for (const [fileLabel, file] of [
      ["handle", byHandle],
      ["product_id", byId],
    ] as const) {
      it(`${label}, file keyed by ${fileLabel}`, async () => {
        const result = await importWith(admin, file);

        expect(result.importedCount).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].reason).toMatch(/couldn't reach Shopify/);
        expect(result.errors[0].reason).not.toMatch(/No product matching/);
      });
    }
  }

  it("a product Shopify answers doesn't exist is still 'not found'", async () => {
    const result = await importWith(
      fakeAdmin([]),
      byHandle,
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/No product matching "linen-shirt"/);
  });
});
