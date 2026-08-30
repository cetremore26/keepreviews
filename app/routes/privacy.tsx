export default function Privacy() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.5rem", fontFamily: "system-ui, sans-serif", lineHeight: 1.6, color: "#1a1a1a" }}>
      <h1>KeepReviews Privacy Policy</h1>
      <p>
        <em>Last updated: August 29, 2026</em>
      </p>

      <p>
        KeepReviews ("the app") is a product review app for Shopify stores.
        This page explains what data the app collects, why, and how it's
        handled — for merchants who install the app and for their
        customers who submit reviews.
      </p>

      <h2>Data collected from your store</h2>
      <p>
        When you install KeepReviews, Shopify grants the app access to your
        store's product and order data through the following API scopes:
      </p>
      <ul>
        <li>
          <strong>read_products</strong> — to show the correct product title
          alongside each review.
        </li>
        <li>
          <strong>read_orders</strong> — only used if you turn on
          post-purchase review request emails (off by default). If enabled,
          the app reads paid order data to know when to send a "please
          review your purchase" email, using the customer's email and the
          products they bought.
        </li>
      </ul>

      <h2>Data collected from your customers</h2>
      <p>When a customer submits a review through the storefront widget, the app stores:</p>
      <ul>
        <li>The name and (optional) email address they typed into the review form.</li>
        <li>The rating and review text.</li>
        <li>Photos attached to the review, if your plan includes that feature.</li>
      </ul>
      <p>
        None of this is collected silently — it's only ever what the
        customer typed into the visible review form on your storefront.
      </p>

      <h2>How data is used</h2>
      <ul>
        <li>Displaying approved reviews on your storefront.</li>
        <li>Giving you a moderation panel to approve, reject, or export reviews.</li>
        <li>
          Sending a post-purchase review request email, but only if you've
          explicitly turned that on in the app's settings, and only for
          orders that haven't been cancelled.
        </li>
      </ul>
      <p>
        A review is never published automatically — every review is held
        for your approval before it appears on your storefront.
      </p>

      <h2>Where data is stored</h2>
      <p>KeepReviews uses a small number of infrastructure providers to run the app:</p>
      <ul>
        <li><strong>Supabase</strong> — hosts the app's database and any review photos.</li>
        <li><strong>Resend</strong> — delivers the post-purchase review request emails, if you've enabled that feature.</li>
        <li><strong>Render</strong> — hosts the app's server.</li>
      </ul>
      <p>
        None of these providers use your store's or your customers' data
        for anything other than running KeepReviews on your behalf.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        Reviews are kept for as long as you use the app, regardless of
        which plan you're on — a plan change or a failed payment never
        deletes or hides review history, it only affects how many reviews
        are displayed on the storefront widget.
      </p>
      <p>
        If a customer asks you to delete their personal data, KeepReviews
        supports Shopify's standard data erasure request: the customer's
        name and email are removed from their review, while the review
        text and rating remain (a product opinion isn't itself personal
        data). If you uninstall the app, all of your store's data —
        reviews included — is permanently deleted after Shopify's standard
        compliance waiting period.
      </p>

      <h2>Your rights</h2>
      <p>
        You can export every review you've ever collected, on any plan, at
        any time, from the app's Reviews page — no restrictions, no
        deleted history.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy, or a data request from one of your
        customers, can be sent to{" "}
        <a href="mailto:soporte@keepreviews.c3lect.com">
          soporte@keepreviews.c3lect.com
        </a>
        .
      </p>
    </div>
  );
}
