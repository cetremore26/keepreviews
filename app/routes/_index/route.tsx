import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { redirect } from "@remix-run/node";

import styles from "./styles.module.css";

// App Store listing URL. Update once the app is actually published — this
// assumes the listing handle matches the app name ("KeepReviews"). Kept in
// sync by hand with the same constant in routes/pricing/route.tsx.
const APP_STORE_URL = "https://apps.shopify.com/keepreviews";

export const meta: MetaFunction = () => [
  { title: "KeepReviews — Reviews that don't disappear" },
  {
    name: "description",
    content:
      "KeepReviews never hides or deletes the reviews you've collected, even if you downgrade or a payment fails. Free to start, no credit card required.",
  },
];

// Route-scoped fonts, matching routes/pricing — only loaded on this public
// page, not on the embedded admin pages. Inter (body text) is already
// loaded globally in root.tsx.
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

// Never prompts for a shop domain here — installation must only ever start
// from a Shopify-owned surface (the App Store listing, or a merchant's own
// admin), which always arrives with a ?shop= param and gets redirected
// straight into the app below. See shopify.dev's App Store review
// requirement 2.3.1.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
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

export default function App() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>Shopify Reviews App</span>
          <h1 className={styles.heading}>Reviews that don't disappear</h1>
          <p className={styles.subheading}>
            Some review apps hide or delete the reviews you've already
            collected the moment you downgrade or a payment fails.
            KeepReviews never does that — on any plan, forever.
          </p>
          <a
            className={styles.button}
            href={APP_STORE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <StoreIcon />
            Install from the Shopify App Store
          </a>
        </div>

        <div className={styles.banner}>
          <span className={styles.bannerIcon}>
            <ShieldIcon />
          </span>
          <div className={styles.bannerBody}>
            <span className={styles.bannerLabel}>Our guarantee</span>
            <p className={styles.bannerText}>
              <strong>Reviews are never held hostage.</strong> Cancel,
              downgrade, or let a payment fail — every review you've
              collected keeps showing. You only lose access to Pro features,
              never your data.
            </p>
          </div>
        </div>

        <div className={styles.features}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Bring reviews you already have</h2>
            <p className={styles.cardText}>
              Import from AliExpress free, or from Amazon, Etsy, and Shopee
              on Pro — via a CSV you control, not a bot that breaks the
              moment a marketplace changes its page.
            </p>
          </div>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Your data, exportable anytime</h2>
            <p className={styles.cardText}>
              One-click CSV export of everything you've collected, on every
              plan, no restrictions.
            </p>
          </div>
        </div>

        <p className={styles.footnote}>
          Free to start, no credit card required.
        </p>
      </div>
    </div>
  );
}
