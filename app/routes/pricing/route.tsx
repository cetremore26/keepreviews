import type { ReactNode } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { PLANS } from "../../config/plans.server";
import styles from "./styles.module.css";

// App Store listing URL. Update once the app is actually published — this
// assumes the listing handle matches the app name ("KeepReviews").
const APP_STORE_URL = "https://apps.shopify.com/keepreviews";

// Route-scoped fonts — only loaded on /pricing, not on the embedded admin
// pages. Inter (body text) is already loaded globally in root.tsx.
export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,450;9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&display=swap",
  },
];

// Public marketing page — no Shopify admin auth. Anyone can view pricing
// without having the app installed; only the "Install" buttons send them
// to the App Store, where Shopify handles auth and billing.
export const loader = async (_args: LoaderFunctionArgs) => {
  return {
    freeMaxDisplayedReviews: PLANS.FREE.features.maxDisplayedReviews,
    proPrice: PLANS.PRO.price,
  };
};

function ShieldIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3l7 3v5.2c0 4.6-3 8.6-7 9.8-4-1.2-7-5.2-7-9.8V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.5 3.5L5.5 10.5L2.5 7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 5h18l1.2 4.2a1.8 1.8 0 0 1-3.4 1.1L18 7l-1 3.3a1.9 1.9 0 0 1-3.6 0L12.7 7h-1.4l-.7 3.3a1.9 1.9 0 0 1-3.6 0L6 7l-1.8 3.3a1.8 1.8 0 0 1-3.4-1.1L3 5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Feature({ pro, children }: { pro?: boolean; children: ReactNode }) {
  return (
    <li>
      <span className={`${styles.checkDot} ${pro ? styles.checkDotPro : ""}`}>
        <CheckIcon />
      </span>
      {children}
    </li>
  );
}

export default function Pricing() {
  const { freeMaxDisplayedReviews, proPrice } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>Pricing</span>
          <h1 className={styles.heading}>
            What you see is what you keep
          </h1>
          <p className={styles.subheading}>
            Two plans. No hidden tiers, no vanishing reviews.
          </p>
        </div>

        <div className={styles.banner}>
          <span className={styles.bannerIcon}>
            <ShieldIcon />
          </span>
          <div className={styles.bannerBody}>
            <span className={styles.bannerLabel}>Our guarantee</span>
            <p className={styles.bannerText}>
              <strong>Before you choose:</strong> nothing here is a trap. If
              you cancel, downgrade, or a payment fails, every review you've
              collected keeps showing under the Free plan's terms — never
              hidden, never deleted. You only lose access to Pro-only
              features until you resubscribe.
            </p>
          </div>
        </div>

        <div className={styles.plans}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.planName}>Free</h2>
            </div>
            <p className={styles.tagline}>
              Everything you need to start collecting real reviews, no card
              required.
            </p>
            <div className={styles.priceRow}>
              <p className={styles.price}>$0</p>
            </div>
            <div className={styles.divider} />
            <ul className={styles.features}>
              <Feature>
                Up to {freeMaxDisplayedReviews} displayed reviews per product
              </Feature>
              <Feature>Basic widget, no customization</Feature>
              <Feature>Import reviews from AliExpress</Feature>
              <Feature>Full moderation panel</Feature>
              <Feature>CSV export of all your data, anytime</Feature>
            </ul>
            <a
              className={styles.button}
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Install for free
            </a>
          </div>

          <div className={`${styles.card} ${styles.cardPro}`}>
            <span className={styles.seal}>Recommended</span>
            <div className={styles.cardHead}>
              <h2 className={styles.planName}>Pro</h2>
            </div>
            <p className={styles.tagline}>
              For stores with more reviews to show and more places to bring
              them from.
            </p>
            <div className={styles.priceRow}>
              <p className={styles.price}>${proPrice.toFixed(2)}</p>
              <span className={styles.priceSuffix}>/ month</span>
            </div>
            <div className={styles.divider} />
            <ul className={styles.features}>
              <Feature pro>
                Show every review you've collected — no display cap
              </Feature>
              <Feature pro>
                Import reviews from AliExpress, Amazon, Etsy &amp; Shopee
              </Feature>
              <Feature pro>Photos in reviews</Feature>
              <Feature pro>Widget design customization</Feature>
              <Feature pro>Full moderation panel</Feature>
              <Feature pro>CSV export of all your data, anytime</Feature>
            </ul>
            <a
              className={`${styles.button} ${styles.buttonPrimary}`}
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <StoreIcon />
              Install from the Shopify App Store
            </a>
          </div>
        </div>

        <p className={styles.footnote}>
          Billing is handled entirely by Shopify — KeepReviews never asks
          for card details directly.
        </p>
      </div>
    </div>
  );
}
