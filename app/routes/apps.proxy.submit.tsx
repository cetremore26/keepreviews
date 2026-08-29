import { json, type ActionFunctionArgs } from "@remix-run/node";
import {
  verifyAppProxySignature,
  getShopDomainFromProxyRequest,
} from "../utils/app-proxy.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  submitReview,
  ReviewValidationError,
} from "../services/reviews.server";
import { getPlan } from "../config/plans.server";
import { uploadReviewPhotos, PhotoUploadError } from "../services/storage.server";

/**
 * Public, unauthenticated endpoint for the "write a review" form in the
 * theme app extension, reached at https://{shop-domain}/apps/reviews/submit
 * (see [app_proxy] in shopify.app.toml). Every new review lands as PENDING
 * and only becomes visible after a merchant approves it in /app/reviews —
 * this endpoint can never publish a review directly, no matter what the
 * request body says.
 *
 * Known gap for a later session: no spam/rate-limiting layer yet beyond
 * basic field validation. Acceptable for MVP since everything lands in
 * moderation first; revisit if spam submissions become a real problem.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);

  if (!verifyAppProxySignature(url)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const shopDomain = getShopDomainFromProxyRequest(url);
  if (!shopDomain) {
    return json({ error: "Missing shop." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const shop = await getOrCreateShop(shopDomain);
  const plan = getPlan(shop.plan);

  // Photos are uploaded to storage BEFORE submitReview is called, but only
  // ever for a Pro shop — a Free-plan shop's upload attempt is rejected
  // here, not silently dropped after spending storage quota on it.
  let photoUrls: string[] = [];
  const rawPhotos = Array.isArray(body.photos)
    ? body.photos.filter((p): p is string => typeof p === "string")
    : [];

  if (rawPhotos.length > 0) {
    if (!plan.features.photosInReviews) {
      return json(
        { error: "Photos require the Pro plan." },
        { status: 403 },
      );
    }
    try {
      photoUrls = await uploadReviewPhotos(rawPhotos, shopDomain);
    } catch (error) {
      if (error instanceof PhotoUploadError) {
        return json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    const review = await submitReview(
      {
        shopId: shop.id,
        productId: String(body.productId ?? ""),
        productTitle:
          typeof body.productTitle === "string" ? body.productTitle : null,
        rating: Number(body.rating),
        authorName: String(body.authorName ?? ""),
        authorEmail:
          typeof body.authorEmail === "string" ? body.authorEmail : null,
        body: String(body.body ?? ""),
        source: "STOREFRONT",
        photoUrls,
      },
      shop.plan,
    );

    return json({
      ok: true,
      reviewId: review.id,
      status: review.status,
    });
  } catch (error) {
    if (error instanceof ReviewValidationError) {
      return json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};
