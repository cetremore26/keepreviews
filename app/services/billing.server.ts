import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { PRO_BILLING_PLAN } from "../shopify.server";
import type { authenticate } from "../shopify.server";
import { setShopPlan } from "../models/shop.server";

// Derived from our concrete `authenticate.admin` (not the library's generic
// AdminContext type) so the plan name we configured in shopify.server.ts is
// recognized as a valid key instead of widening to `never`.
type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

/**
 * Shopify's Billing API is the source of truth for whether a shop is
 * actually paying. We still cache the result on the Shop row because the
 * storefront widget (app proxy, unauthenticated visitor traffic) cannot
 * afford an Admin API round trip on every page view. This function is the
 * only place that writes to that cache, and it is called:
 *  - on every embedded admin page load (self-healing against missed
 *    webhooks), and
 *  - from the app_subscriptions/update webhook (fast path).
 *
 * Downgrading here only ever changes `Shop.plan` — it must never touch the
 * Review table.
 */
export async function syncShopPlanFromShopify(
  domain: string,
  billing: Billing,
) {
  const check = await billing.check({
    plans: [PRO_BILLING_PLAN],
    isTest: process.env.NODE_ENV !== "production",
  });

  if (check.hasActivePayment) {
    const subscription = check.appSubscriptions[0];
    return setShopPlan(domain, "PRO", {
      subscriptionId: subscription?.id ?? null,
      subscriptionStatus: "ACTIVE",
    });
  }

  return setShopPlan(domain, "FREE", {
    subscriptionId: null,
    subscriptionStatus: null,
  });
}

export async function requestProSubscription(
  billing: Billing,
  appUrl: string,
) {
  return billing.request({
    plan: PRO_BILLING_PLAN,
    isTest: process.env.NODE_ENV !== "production",
    returnUrl: `${appUrl}/app/pricing`,
  });
}

export async function cancelProSubscription(
  billing: Billing,
  subscriptionId: string,
) {
  return billing.cancel({
    subscriptionId,
    isTest: process.env.NODE_ENV !== "production",
    prorate: true,
  });
}

/**
 * Shopify's shop-level GraphQL Admin API status values for an
 * AppSubscription, as sent in the app_subscriptions/update webhook payload.
 */
export type ShopifySubscriptionStatus =
  | "ACTIVE"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN"
  | "PENDING";

export function planForSubscriptionStatus(
  status: ShopifySubscriptionStatus,
): "FREE" | "PRO" {
  return status === "ACTIVE" ? "PRO" : "FREE";
}

export { PRO_BILLING_PLAN };
export type { AdminApiContext };
