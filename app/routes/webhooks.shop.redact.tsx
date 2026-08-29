import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory GDPR compliance webhook, sent 48h after a shop uninstalls the
 * app: erase all data for that shop. Unlike a plan downgrade (which must
 * never delete reviews), a full uninstall + the compliance waiting period
 * is the one case where deleting everything is both required and correct —
 * the merchant no longer has the app, and Shopify mandates cleanup.
 *
 * The Shop -> Review -> ReviewPhoto / ReviewRequest cascade (onDelete:
 * Cascade in prisma/schema.prisma) means deleting the Shop row is enough.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain } = await authenticate.webhook(request);

  await db.shop.deleteMany({ where: { domain: shopDomain } });

  return new Response();
};
