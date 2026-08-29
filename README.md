# KeepReviews

Shopify app that shows product reviews on a merchant's storefront, with one
non-negotiable guarantee: **reviews already collected are never hidden or
deleted, on any plan, ever.** Downgrading (or a failed payment) only reduces
how many reviews are *displayed*; the merchant's data and moderation panel
are always complete, on Free or Pro.

See [`../sesion-estrategia-app.md`](../sesion-estrategia-app.md) and
[`../prompt-claude-code-inicial.md`](../prompt-claude-code-inicial.md) for
the market validation and product brief this app is built from.

## Stack

- **Remix** (Shopify's recommended framework) + **Polaris** + **App Bridge**
- **PostgreSQL** via **Prisma** (free tier: [Neon](https://neon.tech) or
  [Supabase](https://supabase.com))
- **Shopify Billing API** for the Free/Pro subscription
- **Theme App Extension** (plain Liquid + vanilla JS, no build step) for the
  storefront widget
- **Resend** free tier for post-purchase review-request emails
- No AI anywhere in the core product — see the brief for why.

## Architecture at a glance

| Concern | Where it lives | Why |
|---|---|---|
| Plan definitions & price | `app/config/plans.server.ts` | Single source of truth; price is an env var, not hardcoded |
| Shop plan cache | `Shop.plan` (Prisma) | The storefront widget can't afford an Admin API call per page view |
| Plan reconciliation | `app/services/billing.server.ts` | Self-heals from Shopify's Billing API on every admin page load, in case a webhook is missed |
| Review read/write rules | `app/services/reviews.server.ts` | The "never hide/delete" guarantee is enforced here, once, for every caller |
| Storefront widget data | `app/routes/apps.proxy.tsx` + `apps.proxy.submit.tsx` | Reached via Shopify's App Proxy; every request's HMAC signature is verified server-side (`app/utils/app-proxy.server.ts`) before touching the database |
| Moderation panel | `app/routes/app.reviews.tsx` | Full, unfiltered review list — never capped by plan |
| CSV export | `app/routes/app.reviews.export.tsx` | Available on every plan by design (data portability is the differentiator, not a paid perk) |
| Post-purchase emails | `app/routes/webhooks.orders.paid.tsx` schedules, `app/routes/cron.send-review-requests.tsx` sends | Sending is decoupled from the webhook so a slow/failing email provider never blocks order processing |
| GDPR compliance | `app/routes/webhooks.customers.data_request.tsx`, `webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx` | Mandatory for a public Shopify app; note this is legally-mandated deletion, a different thing from the plan-based guarantee above |

## Local setup

1. Create a free Postgres database (Neon or Supabase) and copy its
   connection string.
2. `cp .env.example .env` and fill in `DATABASE_URL`. Leave
   `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` empty for now.
3. `npm install`
4. `npm run config:link` — logs in via browser, links this code to an app
   in your Partners account, and fills in `shopify.app.toml` + your `.env`.
5. `npx prisma migrate dev --name init` — creates the database schema. This
   is the **first real migration**; nothing has been applied yet against a
   live database at the time of writing.
6. `npm run dev` — starts the app and gives you a tunnel URL + a link to
   install it on your development store (`keepreviews-dev.myshopify.com`).

## Deploying (target: $20-50/month all-in)

- **App server**: Railway or Fly.io free/hobby tier.
- **Database**: Neon or Supabase free tier (both offer a free Postgres
  instance large enough for an early-stage app).
- **Emails**: Resend free tier (100/day, no credit card).
- **Scheduled job**: `.github/workflows/send-review-requests.yml` — a free
  GitHub Actions cron, since there's no budget for a dedicated worker
  process. Needs two repo secrets: `APP_URL` and `CRON_SECRET` (must match
  the `CRON_SECRET` env var on the deployed app).

## What's built vs. what's next

Built: OAuth install, Postgres schema, Free/Pro billing with self-healing
sync, moderation panel, CSV export (both plans), storefront widget (theme
app extension) with submission form, photos gated to Pro, widget
customization gated to Pro, post-purchase email scheduling + sending,
mandatory GDPR webhooks.

Not done yet (needs a real Partners app + dev store to test against, which
is an interactive, browser-driven step):

- Running `npm run config:link` and `npm run dev` against the real
  `keepreviews-dev.myshopify.com` store to verify the OAuth flow and theme
  extension end-to-end.
- Provisioning the actual Neon/Supabase database and running the first
  migration.
- Deciding a final Pro price (currently a placeholder `$9.99` in
  `.env.example`, easy to change without touching code).
- Pricing/App Store listing copy, screenshots, and the actual submission
  for review.
