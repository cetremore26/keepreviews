import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { setShopPlan } from "../models/shop.server";
import { planForSubscriptionStatus } from "../services/billing.server";
import type { ShopifySubscriptionStatus } from "../services/billing.server";

/**
 * Fast-path plan sync: Shopify calls this the moment a subscription's
 * status changes (activated, cancelled, payment declined, frozen for
 * non-payment, expired). We still self-heal from the live Billing API on
 * every admin page load (see billing.server.ts) in case this webhook is
 * ever missed — never rely on a webhook alone for something that gates
 * paid features.
 *
 * This handler only ever writes Shop.plan. It must never touch reviews.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const subscription = (payload as any)?.app_subscription;
  const status = subscription?.status as ShopifySubscriptionStatus | undefined;
  const subscriptionId = subscription?.admin_graphql_api_id as
    | string
    | undefined;

  if (!status) {
    return new Response();
  }

  const plan = planForSubscriptionStatus(status);

  await setShopPlan(shop, plan, {
    subscriptionId: plan === "PRO" ? (subscriptionId ?? null) : null,
    subscriptionStatus: status,
  });

  return new Response();
};
