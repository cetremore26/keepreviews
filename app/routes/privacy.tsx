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
        KeepReviews' retention rule is tied to purpose, not a fixed
        calendar deadline: a reviewer's name and email are kept for
        exactly as long as their review exists and is being displayed to
        shoppers — no longer, and never for a secondary purpose like
        marketing. Concretely:
      </p>
      <ul>
        <li>
          Reviews (and the reviewer's name/email attached to them) are
          kept for as long as you use the app, regardless of which plan
          you're on — a plan change or a failed payment never deletes or
          hides review history, it only affects how many reviews are
          displayed on the storefront widget.
        </li>
        <li>
          If a customer asks you to delete their personal data, KeepReviews
          supports Shopify's standard data erasure request: the customer's
          name and email are removed from their review immediately, while
          the review text and rating remain (a product opinion isn't
          itself personal data).
        </li>
        <li>
          If you uninstall the app, all of your store's data — reviews,
          reviewer names and emails, everything — is permanently deleted
          after Shopify's standard compliance waiting period. Nothing is
          retained "just in case" past that point.
        </li>
      </ul>

      <h2>Data loss prevention</h2>
      <p>
        KeepReviews' data loss prevention approach is a set of concrete
        technical controls rather than a single tool, applied at every
        layer data passes through:
      </p>
      <ul>
        <li><strong>In transit:</strong> every connection — storefront to app, app to database, app to email/storage providers — is HTTPS/TLS only.</li>
        <li><strong>At rest:</strong> the database and file storage are encrypted at rest by the underlying provider (Supabase), including automated backups.</li>
        <li><strong>Access control:</strong> the credentials that can write to storage or bypass row-level restrictions are used only in server-side code and are never exposed to the browser or to any third party.</li>
        <li><strong>Abuse prevention:</strong> the public endpoints that accept data from shoppers (submitting a review, reading the widget) are rate-limited per IP and reject oversized requests, so a single bad actor can't extract or flood data at scale.</li>
        <li><strong>Monitoring:</strong> the actions described under "Access log" below are recorded and reviewable.</li>
        <li><strong>Response:</strong> the incident response process below governs what happens if a control fails.</li>
      </ul>

      <h2>Access log</h2>
      <p>
        Every action that touches a merchant's reviews or settings —
        approving or rejecting a review, exporting the CSV, or changing
        widget/email settings — is recorded with who performed it and
        when, so access to personal data is auditable after the fact.
      </p>

      <h2>Your rights</h2>
      <p>
        You can export every review you've ever collected, on any plan, at
        any time, from the app's Reviews page — no restrictions, no
        deleted history.
      </p>

      <h2>Data processing terms</h2>
      <p>
        KeepReviews acts as a data processor for the personal data described
        above (reviewer name, email, and photos), and you — the merchant —
        remain the data controller for your store and its customers. In that
        capacity, KeepReviews:
      </p>
      <ul>
        <li>Only processes this data to provide the app's features described in this policy — never for its own marketing, resale, or any other purpose.</li>
        <li>Does not share this data with any third party except the infrastructure providers listed above, solely to run the app.</li>
        <li>Will assist you in responding to a data subject's access or deletion request, as described under "Data retention and deletion" above.</li>
        <li>Will notify you without undue delay if it becomes aware of a security incident affecting your store's data — see the incident response section below.</li>
      </ul>

      <h2>Security incident response</h2>
      <p>
        If KeepReviews becomes aware of a security incident that may have
        exposed merchant or customer data, we will:
      </p>
      <ol>
        <li>Contain the issue and, where possible, stop it from continuing.</li>
        <li>Assess what data and which shops were affected.</li>
        <li>
          Notify affected merchants by email within 72 hours of confirming
          the incident, describing what happened, what data was involved,
          and what we're doing about it.
        </li>
        <li>
          Where the incident involves personal data of a merchant's
          customers, provide the merchant with what they need to meet their
          own legal notification obligations.
        </li>
        <li>Fix the underlying cause before considering the incident closed.</li>
      </ol>
      <p>
        To report a suspected security issue, email{" "}
        <a href="mailto:soporte@keepreviews.c3lect.com">
          soporte@keepreviews.c3lect.com
        </a>{" "}
        with as much detail as you can provide.
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
