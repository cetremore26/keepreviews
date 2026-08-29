import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import db from "../db.server";

/**
 * When an order is paid, schedule one "please review your purchase" email
 * per line item, to be sent `shop.reviewRequestDelayDays` later (giving the
 * product time to actually arrive — a value the merchant controls in
 * /app/settings, not a fixed guess). The email itself is sent by a separate
 * scheduled job — see app/routes/cron.send-review-requests.tsx — not from
 * this webhook handler, so a slow or failing email provider can never
 * block or retry-storm order processing.
 *
 * Nothing is scheduled at all unless the merchant has explicitly turned
 * this on (`shop.reviewRequestsEnabled`) — see webhooks.orders.cancelled.tsx
 * for the corresponding cleanup when an order is cancelled before its email
 * goes out.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload, admin } = await authenticate.webhook(request);

  const shop = await getOrCreateShop(shopDomain);
  if (!shop.reviewRequestsEnabled) {
    return new Response();
  }

  const order = payload as any;
  const customerEmail = order?.customer?.email || order?.email;
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  if (!customerEmail || lineItems.length === 0) {
    return new Response();
  }

  const sendAt = new Date();
  sendAt.setDate(sendAt.getDate() + shop.reviewRequestDelayDays);

  const productIds = lineItems
    .map((item: any) =>
      item.product_id ? `gid://shopify/Product/${item.product_id}` : null,
    )
    .filter((id: string | null): id is string => id !== null);

  // The email link needs a real storefront URL (/products/{handle}), not
  // just the product ID — fetched here, once per order, rather than at
  // send time, so a product deleted between order and send doesn't matter.
  const handleById = await fetchProductHandles(admin, productIds);

  for (const item of lineItems) {
    const productId = item.product_id
      ? `gid://shopify/Product/${item.product_id}`
      : null;
    if (!productId) continue;

    await db.reviewRequest.upsert({
      where: {
        shopId_orderId_productId: {
          shopId: shop.id,
          orderId: String(order.id),
          productId,
        },
      },
      create: {
        shopId: shop.id,
        orderId: String(order.id),
        customerEmail,
        productId,
        productTitle: item.title ?? null,
        productHandle: handleById.get(productId) ?? null,
        token: crypto.randomBytes(24).toString("hex"),
        sendAt,
      },
      update: {},
    });
  }

  return new Response();
};

async function fetchProductHandles(
  admin: Awaited<ReturnType<typeof authenticate.webhook>>["admin"],
  productIds: string[],
): Promise<Map<string, string>> {
  const handleById = new Map<string, string>();
  if (!admin || productIds.length === 0) {
    return handleById;
  }

  try {
    const response = await admin.graphql(
      `#graphql
      query ProductHandles($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            handle
          }
        }
      }`,
      { variables: { ids: productIds } },
    );
    const { data } = await response.json();
    for (const node of data?.nodes ?? []) {
      if (node?.id && node?.handle) {
        handleById.set(node.id, node.handle);
      }
    }
  } catch (error) {
    console.error("Failed to fetch product handles for review request:", error);
  }

  return handleById;
}
