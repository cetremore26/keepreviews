import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR compliance webhook. A customer asked the merchant for the
 * data an app stores about them. We only ever store a review's author name
 * and email as free text on the Review row — no separate customer profile —
 * so there's nothing to package here beyond what the merchant can already
 * see and export themselves from the moderation panel / CSV export.
 * Logged for an auditable paper trail; extend this if the data model ever
 * grows a dedicated customer-linked table.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`, payload);

  return new Response();
};
