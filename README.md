# KeepReviews

Shopify app that shows product reviews on a merchant's storefront, with one non-negotiable guarantee: **reviews already collected are never hidden or deleted, on any plan, ever.**

Downgrading, or a failed payment, only reduces how many reviews are *displayed*. The merchant's data and moderation panel stay complete on Free and Pro alike, and CSV export is available on every plan. Data portability is the differentiator, not a paid perk.

---

## Stack

**Framework** · Remix, Shopify's recommended stack, with Polaris and App Bridge

**Database** · PostgreSQL via Prisma

**Billing** · Shopify Billing API for the Free/Pro subscription

**Storefront widget** · Theme App Extension in plain Liquid and vanilla JS, no build step

**Photos** · Supabase Storage, same project as the database

**Email** · Resend, for post-purchase review requests

**Hosting** · Render

No AI anywhere in the core product. That is a deliberate product decision, not a gap.

---

## Architecture

**Plan definitions and price** live in app/config/plans.server.ts. Single source of truth, and the price is an environment variable rather than a hardcoded constant.

**The shop's plan is cached** on the Shop model. The storefront widget cannot afford an Admin API call per page view.

**Plan reconciliation** in app/services/billing.server.ts self-heals from Shopify's Billing API on every admin page load, so a missed webhook never leaves a merchant on the wrong plan.

**The never-hide guarantee is enforced once**, in app/services/reviews.server.ts, for every caller. It is not a rule scattered across route handlers.

**Storefront data** is reached through Shopify's App Proxy. Every request's HMAC signature is verified server-side in app/utils/app-proxy.server.ts before anything touches the database.

**Post-purchase emails** are scheduled by the orders/paid webhook and sent by a separate cron route. Sending is decoupled from the webhook so a slow or failing email provider never blocks order processing.

**GDPR compliance** webhooks handle the three mandatory topics for public Shopify apps. This is legally mandated deletion, a different thing from the plan-based guarantee above.

**Scheduled jobs** run on GitHub Actions cron rather than a dedicated worker process, which keeps the whole thing inside a hobby-tier budget.

---

## Local setup

Create a Postgres database. For local development a container keeps test data fully separate from production. Then copy .env.example to .env, fill in DATABASE_URL, and run:

    npm install
        npm run config:link
            npx prisma migrate deploy
                npm run dev

                config:link connects this code to an app in your Partners account and fills in the Shopify keys. npm run dev gives you a tunnel URL and an install link for your development store.

                Every environment variable is documented inline in .env.example.

                ---

                ## Status

                Deployed and running. Built and live: OAuth install, Postgres schema, Free/Pro billing with self-healing sync, moderation panel, CSV export on both plans, storefront widget with submission form, photo uploads and widget customization gated to Pro, post-purchase review request emails, low-storage ops alerting, and the mandatory GDPR webhooks.

                Shopify granted protected customer data access, so the orders/paid and orders/cancelled topics are active.

                Still ahead: final Pro pricing, App Store listing copy and screenshots, and submission for review.

                ---

                ## License

                MIT

                Built by **Manuel Sebastián Cetre** · [GitHub](https://github.com/cetremore26) · cetremore@gmail.com
                
