import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  verifyAppProxySignature,
  getShopDomainFromProxyRequest,
} from "../utils/app-proxy.server";
import { getShopByDomain } from "../models/shop.server";
import { listReviewsForWidget } from "../services/reviews.server";
import { getPlan } from "../config/plans.server";
import { checkRateLimit, getClientIp } from "../utils/rate-limit.server";

// Generous — this fires once per real product-page view, and one IP can
// legitimately represent many concurrent shoppers (NAT, corporate
// networks, carrier-grade NAT on mobile). This is here to blunt a
// targeted flood against a single shop's proxy endpoint, not to throttle
// normal traffic.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 120;

/**
 * Public, unauthenticated endpoint reached via Shopify's App Proxy at
 * https://{shop-domain}/apps/reviews?product_id=... (see [app_proxy] in
 * shopify.app.toml). This is what the theme app extension widget fetches
 * to render stars + review text on a product page.
 *
 * Every response here is capped by the shop's current plan on the server —
 * there is no client-controllable input that changes how many reviews are
 * returned beyond the product being viewed.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (!verifyAppProxySignature(url)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const shopDomain = getShopDomainFromProxyRequest(url);
  const productId = url.searchParams.get("product_id");

  if (!shopDomain || !productId) {
    return new Response("Missing shop or product_id", { status: 400 });
  }

  const clientIp = getClientIp(request);
  const { allowed } = await checkRateLimit(
    `reviews:${clientIp}`,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_ATTEMPTS,
  );
  if (!allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    return json({
      reviews: [],
      averageRating: 0,
      totalApprovedCount: 0,
      widget: { primaryColor: "#1A1A1A", layout: "grid", photosEnabled: false },
    });
  }

  const { reviews, averageRating, totalApprovedCount } =
    await listReviewsForWidget(shop.id, productId, shop.plan);

  return json({
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      authorName: review.authorName,
      body: review.body,
      createdAt: review.createdAt,
      photoUrls: review.photos.map((p) => p.url),
    })),
    averageRating,
    totalApprovedCount,
    widget: {
      primaryColor: shop.widgetPrimaryColor,
      layout: shop.widgetLayout,
      photosEnabled: getPlan(shop.plan).features.photosInReviews,
    },
  });
};
