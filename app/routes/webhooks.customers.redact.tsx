import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "../models/shop.server";
import db from "../db.server";

/**
 * Mandatory GDPR compliance webhook: erase personal data for one customer,
 * 48h after they request it. This is a legal deletion requirement and is
 * NOT the same thing as the product's "never delete reviews for plan
 * reasons" guarantee — that guarantee is about billing state, this is a
 * court-mandated exception that applies identically on every plan.
 *
 * We anonymize rather than delete the review outright: the rating and text
 * stay (a product review's text is not itself the customer's personal
 * data), but anything that identifies the person is wiped.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload } = await authenticate.webhook(request);

  const customerEmail = (payload as any)?.customer?.email as
    | string
    | undefined;

  if (customerEmail) {
    const shop = await getShopByDomain(shopDomain);
    if (shop) {
      await db.review.updateMany({
        where: { shopId: shop.id, authorEmail: customerEmail },
        data: { authorName: "Deleted user", authorEmail: null },
      });
    }
  }

  return new Response();
};
