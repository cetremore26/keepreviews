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
import { checkRateLimit, getClientIp } from "../utils/rate-limit.server";
import { readJsonWithLimit, PayloadTooLargeError } from "../utils/http.server";

// 3 photos x ~2MB raw, base64-inflated (~1.37x) plus room for the text
// fields — generous for a real submission, tight enough to reject someone
// trying to stream an unbounded body at us.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

/**
 * Public, unauthenticated endpoint for the "write a review" form in the
 * theme app extension, reached at https://{shop-domain}/apps/reviews/submit
 * (see [app_proxy] in shopify.app.toml). Every new review lands as PENDING
 * and only becomes visible after a merchant approves it in /app/reviews —
 * this endpoint can never publish a review directly, no matter what the
 * request body says.
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

  const clientIp = getClientIp(request);
  const { allowed } = await checkRateLimit(
    `submit:${clientIp}`,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_ATTEMPTS,
  );
  if (!allowed) {
    return json(
      { error: "Too many review submissions. Please try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await readJsonWithLimit(request, MAX_BODY_BYTES)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "Request body too large." }, { status: 413 });
    }
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
