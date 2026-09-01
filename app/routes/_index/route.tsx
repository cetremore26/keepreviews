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
          Some review apps hide or delete the reviews you've already
          collected the moment you downgrade or a payment fails. KeepReviews
          never does that — on any plan, forever.
        </p>
        <p className={styles.text}>
          Install KeepReviews from the Shopify App Store on the store you
          want to use it with. Free to start, no credit card required.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Reviews are never held hostage.</strong> Cancel,
            downgrade, or let a payment fail — every review you've collected
            keeps showing. You only lose access to Pro features, never your
            data.
          </li>
          <li>
            <strong>Bring reviews you already have.</strong> Import from
            AliExpress free, or from Amazon, Etsy, and Shopee on Pro — via a
            CSV you control, not a bot that breaks the moment a marketplace
            changes its page.
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
