// Central definition of what each plan is and costs. The price is a
// configuration value (env override), never hardcoded into billing calls or
// gating checks — see sesion-estrategia-app.md, price is "to confirm".
//
// IMPORTANT: this file is the single source of truth for what a plan
// unlocks. Every gating check in the app (widget rendering, review
// submission, settings, exports) must read from here, never re-implement
// the rule inline, so the "never hide/delete reviews" guarantee and the
// plan feature list can't drift apart.

export type PlanId = "FREE" | "PRO";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** USD per 30 days. Read from env so the price can change without a code
   *  change or redeploy of business logic. */
  price: number;
  /** Shopify requires a stable name per subscription line; keep separate
   *  from the display name so we can reword the display name freely. */
  billingName: string;
  features: {
    /** Cap on how many APPROVED reviews are shown on the storefront widget.
     *  null = unlimited. This caps *display*, never storage: reviews beyond
     *  the cap stay in the database untouched and reappear the moment the
     *  shop is back on a plan without a cap. */
    maxDisplayedReviews: number | null;
    photosInReviews: boolean;
    widgetCustomization: boolean;
    moderationPanel: boolean;
    csvExport: boolean;
  };
}

const PRO_PRICE = Number(process.env.PRO_PLAN_PRICE_USD ?? "9.99");

export const PLANS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: "FREE",
    name: "Free",
    price: 0,
    billingName: "KeepReviews Free",
    features: {
      maxDisplayedReviews: 20,
      photosInReviews: false,
      widgetCustomization: false,
      moderationPanel: true,
      csvExport: true,
    },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    price: PRO_PRICE,
    billingName: "KeepReviews Pro",
    features: {
      maxDisplayedReviews: null,
      photosInReviews: true,
      widgetCustomization: true,
      moderationPanel: true,
      csvExport: true,
    },
  },
};

export function getPlan(planId: PlanId): PlanDefinition {
  return PLANS[planId];
}
