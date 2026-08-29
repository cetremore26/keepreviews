import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";
import db from "../db.server";

/**
 * If an order is cancelled before its review request email went out,
 * cancel the request too — nobody should get asked to review a purchase
 * that never happened. If the email already sent (`sentAt` is set), we
 * leave it alone: there's no sane way to un-send an email, and the
 * customer received a real product up to that point, so a stray request
 * isn't harmful enough to justify a "please ignore" follow-up.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload } = await authenticate.webhook(request);

  const order = payload as any;
  const orderId = order?.id ? String(order.id) : null;
  if (!orderId) {
    return new Response();
  }

  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    return new Response();
  }

  await db.reviewRequest.deleteMany({
    where: { shopId: shop.id, orderId, sentAt: null },
  });

  return new Response();
};
