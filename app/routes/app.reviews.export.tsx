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
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="keepreviews-export-${shop.domain}.csv"`,
    },
  });
};
