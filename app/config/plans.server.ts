// Central definition of what each plan is and costs. The price is a
// configuration value (env override), never hardcoded into billing calls or
// gating checks — see sesion-estrategia-app.md, price is "to confirm".
//
// IMPORTANT: this file is the single source of truth for what a plan
// unlocks. Every gating check in the app (widget rendering, review
// submission, settings, exports) must read from here, never re-implement
// the rule inline, so the "never hide/delete reviews" guarantee and the
// plan feature list can't drift apart.

import type { ImportMarketplace } from "@prisma/client";

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
    /** Marketplaces this plan may import reviews FROM via CSV. Importing a
     *  marketplace not in this list must be rejected server-side in
     *  review-import.server.ts, not just hidden in the UI. */
    importMarketplaces: ImportMarketplace[];
    /** Cap on total reviews with source=IMPORTED this shop may hold. null =
     *  unlimited. Like maxDisplayedReviews, this only ever limits *new*
     *  imports going forward — never deletes or hides rows already
     *  imported, including after a downgrade. */
    maxImportedReviewsTotal: number | null;
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
      importMarketplaces: ["ALIEXPRESS"],
      // Matches the most generous free tier we found among competitors
      // (Ali Reviews, ~30 reviews x 5 products) — see
      // mineria_willingness_to_pay.md section 5.4. Not the real conversion
      // lever (maxDisplayedReviews already caps what's shown per product on
      // Free); this exists to bound storage/abuse, not to drive upgrades.
      maxImportedReviewsTotal: 150,
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
      importMarketplaces: ["ALIEXPRESS", "AMAZON", "ETSY", "SHOPEE"],
      maxImportedReviewsTotal: null,
    },
  },
};

export function getPlan(planId: PlanId): PlanDefinition {
  return PLANS[planId];
}
