import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { listAllReviewsForExport } from "../services/reviews.server";
import { buildCsv } from "../utils/csv.server";
import { logAudit } from "../utils/audit-log.server";

// Available on every plan, on purpose: the data-portability guarantee is
// the product's core differentiator, not a paid perk. See
// prompt-claude-code-inicial.md.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const reviews = await listAllReviewsForExport(shop.id);

  logAudit({
    shopId: shop.id,
    actor: session.shop,
    action: "reviews.csv_exported",
    detail: `count=${reviews.length}`,
  });

  const csv = buildCsv(
    [
      "id",
      "product_id",
      "product_title",
      "rating",
      "author_name",
      "author_email",
      "body",
      "status",
      "source",
      "photo_urls",
      "created_at",
      // The date the review was actually written, which for an imported
      // review is its date on the app it came from, not the day it landed
      // here. Without this column a merchant who migrates 800 reviews in and
      // later exports them gets 800 reviews all dated the afternoon they
      // switched — their history erased by us, which is the one thing this
      // app promises never to do.
      //
      // Named review_date on purpose: our own importer reads that header, so
      // an export of this file can be uploaded straight back into
      // KeepReviews (or into any app that takes the same shape) without
      // editing a single column.
      "review_date",
      "import_marketplace",
      "source_review_url",
    ],
    reviews.map((review) => [
      review.id,
      review.productId,
      review.productTitle ?? "",
      review.rating,
      review.authorName,
      review.authorEmail ?? "",
      review.body,
      review.status,
      review.source,
      review.photos.map((p) => p.url).join(" | "),
      review.createdAt.toISOString(),
      (review.sourceCreatedAt ?? review.createdAt).toISOString(),
      review.importMarketplace ?? "",
      review.sourceReviewUrl ?? "",
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="keepreviews-export-${shop.domain}.csv"`,
    },
  });
};
