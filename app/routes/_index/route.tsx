import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import styles from "./styles.module.css";

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

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>KeepReviews</h1>
        <p className={styles.text}>
          Product reviews for your Shopify store, with one guarantee that
          never changes: reviews you&apos;ve already collected are never
          hidden or deleted because of your plan — free or paid.
        </p>
        <p className={styles.text}>
          Install KeepReviews from the Shopify App Store on the store you
          want to use it with.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Reviews are never held hostage.</strong> Cancel, downgrade,
            or let a payment fail — every review you've collected keeps
            showing. You only lose access to Pro features, never your data.
          </li>
          <li>
            <strong>Full moderation control.</strong> Approve or reject every
            review before it's visible, with photos on the Pro plan.
          </li>
          <li>
            <strong>Your data, exportable anytime.</strong> One-click CSV
            export of everything you've collected, on every plan, no
            restrictions.
          </li>
        </ul>
      </div>
    </div>
  );
}
