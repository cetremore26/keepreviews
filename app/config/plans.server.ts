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

/** Sources that mean "a merchant is moving their own reviews out of another
 *  Shopify app". Free on every plan, on purpose: a merchant leaving Judge.me
 *  or Loox will not pay to find out whether the escape works, and the app
 *  they are leaving lets them import for free. This is acquisition cost, not
 *  product.
 *
 *  Only sources whose CSV format has actually been verified belong here.
 *  Listing an app we have not tested turns a promise into a broken upload on
 *  the merchant's first try, which is precisely the failure this feature
 *  exists to fix — the generic OTHER option covers the rest honestly.
 *  Unverified values (STAMPED, FERA, ALI_REVIEWS, YOTPO, OKENDO) exist in
 *  the Prisma enum so they can be switched on without a migration, the day
 *  someone runs a real export through the importer. */
export const MIGRATION_SOURCES: ImportMarketplace[] = [
  "JUDGE_ME",
  "LOOX",
  "OTHER",
];

/** Catalog imports — the dropshipping case. These stay plan-gated: they are
 *  a product feature, not someone rescuing their own data. */
const MARKETPLACE_SOURCES: ImportMarketplace[] = [
  "ALIEXPRESS",
  "AMAZON",
  "ETSY",
  "SHOPEE",
];

/** Anti-abuse ceiling on stored imported reviews for the Free plan. This is
 *  NOT a conversion lever and must never be set to a number a real merchant
 *  can reach: the largest migration we expect (years of reviews on a big
 *  store) is in the thousands. It exists so a free install cannot be used as
 *  unbounded text storage, and it is deliberately a number rather than null
 *  so the cap-enforcement path in review-import.server.ts stays live and
 *  exercised instead of rotting as dead code behind a condition nothing
 *  meets.
 *
 *  Photos are the expensive part and are already off on Free
 *  (photosInReviews: false), so what this bounds is plain text. */
const FREE_IMPORT_STORAGE_CEILING = 50_000;

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
     *  imported, including after a downgrade.
     *
     *  On Free this is an abuse ceiling set far above any real migration
     *  (see FREE_IMPORT_STORAGE_CEILING), not a paywall. It used to be 150,
     *  which meant a merchant arriving with 800 reviews from another app got
     *  650 of them rejected with "limit reached" — a review app refusing to
     *  keep someone's reviews, which is the exact behaviour this product
     *  sells itself as the alternative to. maxDisplayedReviews is what
     *  drives upgrades, and it does it honestly: everything is stored,
     *  20 are shown. */
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
      importMarketplaces: ["ALIEXPRESS", ...MIGRATION_SOURCES],
      maxImportedReviewsTotal: FREE_IMPORT_STORAGE_CEILING,
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
      importMarketplaces: [...MARKETPLACE_SOURCES, ...MIGRATION_SOURCES],
      maxImportedReviewsTotal: null,
    },
  },
};

export function getPlan(planId: PlanId): PlanDefinition {
  return PLANS[planId];
}
