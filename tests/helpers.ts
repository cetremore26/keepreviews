import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import db from "../app/db.server";

export const SHOP_DOMAIN = "keepreviews-test.myshopify.com";

/** Two products, as Shopify knows them: a numeric id (what Liquid's
 *  {{ product.id }} prints, and so what the widget sends) and a handle. The
 *  Admin API only ever hands back the GID form. */
export const PRODUCT_A = {
  numericId: "9392803971322",
  gid: "gid://shopify/Product/9392803971322",
  handle: "linen-shirt",
  title: "Linen Shirt",
};
export const PRODUCT_B = {
  numericId: "9392803971999",
  gid: "gid://shopify/Product/9392803971999",
  handle: "wool-scarf",
  title: "Wool Scarf",
};

/** An `admin` for importReviewsFromCsv that answers the two queries the
 *  importer sends the way Shopify's Admin API does: ids come back as GIDs. */
export function fakeAdmin(catalog = [PRODUCT_A, PRODUCT_B]) {
  return {
    graphql: async (
      query: string,
      opts?: { variables?: Record<string, unknown> },
    ) => {
      const variables = opts?.variables ?? {};

      if (query.includes("ProductsByHandle")) {
        const wanted = [...String(variables.query).matchAll(/handle:'([^']+)'/g)].map(
          (m) => m[1],
        );
        const nodes = catalog
          .filter((p) => wanted.includes(p.handle))
          .map((p) => ({ id: p.gid, handle: p.handle, title: p.title }));
        return Response.json({ data: { products: { nodes } } });
      }

      if (query.includes("ProductsByIds")) {
        const ids = variables.ids as string[];
        // Like the real nodes() query: unknown ids come back as null in place.
        const nodes = ids.map((id) => {
          const product = catalog.find((p) => p.gid === id);
          return product ? { id: product.gid, title: product.title } : null;
        });
        return Response.json({ data: { nodes } });
      }

      throw new Error(`fakeAdmin: unexpected query ${query.slice(0, 60)}`);
    },
  };
}

/** A URL as Shopify's App Proxy delivers it: query params plus a signature
 *  computed per Shopify's documented algorithm. Written out here on purpose
 *  instead of importing the app's verifier, so a bug in one cannot hide in
 *  the other. */
export function signedProxyUrl(pathname: string, params: Record<string, string>) {
  const all: Record<string, string> = {
    shop: SHOP_DOMAIN,
    path_prefix: "/apps/reviews",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...params,
  };

  const message = Object.entries(all)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");
  const signature = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest("hex");

  const url = new URL(`https://keepreviews.test${pathname}`);
  for (const [key, value] of Object.entries({ ...all, signature })) {
    url.searchParams.set(key, value);
  }
  return url;
}

export function csv(header: string[], rows: string[][]): string {
  const line = (cells: string[]) =>
    cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
  return [line(header), ...rows.map(line)].join("\n");
}

/** Empties every table the tests touch, in FK order. */
export async function resetDatabase() {
  await db.rateLimitAttempt.deleteMany();
  await db.auditLog.deleteMany();
  await db.reviewPhoto.deleteMany();
  await db.review.deleteMany();
  await db.reviewImportBatch.deleteMany();
  await db.reviewRequest.deleteMany();
  await db.shop.deleteMany();
}

/** The SQL of the data migration under test, read from the repo so the test
 *  runs the file production will run rather than a copy of it. */
export function readNormalizeProductIdMigration(): string {
  const root = path.join(process.cwd(), "prisma", "migrations");
  const folder = fs
    .readdirSync(root)
    .find((name) => name.endsWith("_normalize_review_product_id"));
  if (!folder) throw new Error("normalize_review_product_id migration not found");
  return fs.readFileSync(path.join(root, folder, "migration.sql"), "utf8");
}
