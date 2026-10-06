# Tip: digital tipping for tour guides

Tourists scan a QR code (or tap an NFC card) at the end of a tour, pick an amount, pay with Apple Pay / Google Pay / card, and optionally rate the tour. No app, no login. Guides get a dashboard; the platform owner gets fees, payouts, reconciliation and a float report. Tips are paid out to guides **once a month**.

> **Read `LEGAL_NOTICE.md` and `COMPLIANCE.md` before taking real money.** Holding other people's money is a regulated activity. The default funds model keeps the payment provider in charge of the money.

* Next.js 15 (App Router) · TypeScript strict · Tailwind
* Postgres via Drizzle (embedded PGlite when no `DATABASE_URL`)
* Stripe Connect (Express) behind a `PaymentProvider` interface, plus a `MockProvider` for dev and tests
* Double-entry, append-only ledger. Vitest + Playwright.

## Quick start (no accounts, no database server needed)

```bash
npm install
npm run dev          # migrates + seeds an embedded database on first run, then starts Next.js
```

Open <http://localhost:3000>. Everything runs with the **MockProvider**: a fake card flow, fake guide onboarding, and sign-in links shown on screen instead of emailed.

| What | Where |
|------|-------|
| Tourist page (active guide) | <http://localhost:3000/t/anna> or `/t/jon` |
| Guide that is not set up yet | `/t/maria` |
| Guide dashboard | `/login` → `anna@example.com` (or `jon@example.com`) → click the dev link |
| Admin | `/login` → `admin@example.com` |

Demo walkthrough: tip Anna on her tip page → sign in as Anna and see the tip, the balance and the QR code → sign in as admin → *Payouts* → **Run** the monthly job → Anna gets a payout row with CSV/PDF statements → *Reconciliation* and *Float* reports.

Reset the demo data: `npm run db:reset`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Seed if empty, then start the dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit + integration tests (Vitest, in-memory PGlite) |
| `npm run e2e` | Playwright end-to-end tests on a mobile viewport with the MockProvider (builds the app, uses a fresh seeded database) |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (to `DATABASE_URL`, or the PGlite dir) |
| `npm run db:seed` | Seed demo data (`-- --if-empty` to skip when data exists) |
| `npm run job:payout [-- YYYY-MM]` | Run the monthly payout job manually (see below) |
| `npm run job:float` | Take today's float snapshot |

E2E in a sandbox where Playwright's browsers are preinstalled: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run e2e` (or set `PW_CHROMIUM_PATH` to a Chromium binary).

## Running the monthly payout job manually

The job pays the **previous calendar month** (balance owed at the end of that month; balances below `MIN_PAYOUT_MINOR` roll over). It is idempotent: one payout per guide and month, so it is safe to run again.

```bash
# 1. From the CLI (uses .env / .env.local)
npm run job:payout                 # previous month
npm run job:payout -- 2026-09      # a specific month

# 2. From the admin UI: /admin/payouts → "Run payout job manually"

# 3. Through the cron endpoint (Vercel Cron calls it on the 1st at 06:00 UTC)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/monthly-payout"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/monthly-payout?period=2026-09"
```

* `psp_scheduled_payout` (default): the provider pays guides on their monthly schedule. The job records the expected payout, emails the statement, and the ledger is posted when Stripe's `payout.paid` webhook arrives.
* `platform_pooled`: the job transfers each guide's balance itself with an idempotency key, posts the ledger and emails the statement. Failed transfers are recorded, alerted (email to `ADMIN_EMAILS`) and retried by the next run.

## Environment variables

Copy `.env.example` to `.env.local`. Configuration is validated at boot (`src/env.ts`); the app refuses to start with an invalid combination.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | empty | Postgres connection string. Empty = embedded PGlite in `PGLITE_DIR` (dev/test/demo only). Required in production. |
| `PGLITE_DIR` | `.data/pglite` | Where the embedded database lives. |
| `ALLOW_LOCAL_DB` | `false` | Allow embedded DB + mock provider with `NODE_ENV=production` (demos, e2e). Never for real money. |
| `APP_URL` | `http://localhost:3000` | Public base URL. Used in QR codes, emails, Stripe return URLs and the CSRF origin check. |
| `AUTH_SECRET` | dev value | ≥ 32 random chars (`openssl rand -hex 32`). Signs sessions and mock webhooks. Required in production. |
| `ADMIN_EMAILS` | empty | Comma separated emails promoted to admin on sign-in. Also receive operational alerts. |
| `FUNDS_MODEL` | `psp_scheduled_payout` | `psp_scheduled_payout` (provider holds funds, monthly payout schedule) or `platform_pooled` (platform holds funds; regulated). |
| `ALLOW_POOLED_FUNDS` | `false` | Must be `true` to start with `platform_pooled`. Requires licence/legal sign-off. |
| `FEE_BPS` | `500` | Service fee in basis points (500 = 5 %). Operators can override. |
| `MIN_PAYOUT_MINOR` | `2000` | Minimum monthly payout in minor units (EUR 20,00). Below it the balance rolls over. |
| `DEFAULT_CURRENCY` | `EUR` | Charge currency (v1: EUR only). |
| `ASSUMED_RATE_BPS` | `600` | Assumed annual interest rate for the float report (6 %). |
| `ISK_PER_EUR` | `150` | Static rate for the ISK price hint shown to tourists. |
| `PAYMENT_PROVIDER` | auto | `mock` or `stripe`. Auto = `stripe` when `STRIPE_SECRET_KEY` is set, otherwise `mock`. |
| `STRIPE_SECRET_KEY` | empty | Stripe secret key (`sk_test_…` for test mode). |
| `STRIPE_WEBHOOK_SECRET` | empty | Webhook signing secret(s), comma separated if you have both a platform and a Connect endpoint. |
| `STRIPE_PUBLISHABLE_KEY` | empty | Stripe publishable key, sent to the browser. |
| `RESEND_API_KEY` | empty | Resend key for emails. Empty = demo outbox (dev only). |
| `EMAIL_FROM` | `Tip <tips@localhost>` | From address (must be a verified Resend domain in production). |
| `CRON_SECRET` | empty | Bearer secret for `/api/cron/*`. Required in production. |
| `RETENTION_MONTHS` | `24` | Free-text feedback older than this is cleared by the retention job. |

## Using Stripe (test mode)

1. Create a Stripe account, enable **Connect**, and use test keys. Put them in `.env.local`:
   ```
   PAYMENT_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_PUBLISHABLE_KEY=pk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```
2. Webhooks: forward events to the app. With the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/provider --events payment_intent.succeeded,payment_intent.payment_failed,charge.refunded
   stripe listen --forward-connect-to localhost:3000/api/webhooks/provider --events account.updated,payout.paid,payout.failed
   ```
   In production create **two endpoints** (platform events and Connect events) pointing at `https://your-domain/api/webhooks/provider`, and set `STRIPE_WEBHOOK_SECRET=whsec_a,whsec_b`.
3. Sign in as a guide → *Start payout setup* → complete Stripe's hosted test onboarding (test data) → the `account.updated` webhook activates the guide and sets the monthly payout schedule.
4. Open the guide's tip page and pay with the test card `4242 4242 4242 4242`.

Iceland notes (cross-border payouts only, EUR bank payouts) are in `DECISIONS.md`.

## Deploying to Vercel

1. Create a managed Postgres (Supabase, Neon, …) and set `DATABASE_URL`.
2. Set all production variables above (`AUTH_SECRET`, `CRON_SECRET`, Stripe keys, `RESEND_API_KEY`, `APP_URL`, `ADMIN_EMAILS`).
3. Deploy. `vercel-build` runs the migrations, then `next build`.
4. `vercel.json` registers the crons: monthly payout (`0 6 1 * *`), daily float snapshot, daily retention. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
5. Add the Stripe webhook endpoints (see above) and verify a test tip end to end.

## How money moves

```
tip succeeds (webhook)      D guest_clearing  gross      C guide_payable  net      C platform_fee  fee
processor fee known         D processor_fee   fee        C guest_clearing fee
monthly payout              D guide_payable   amount     C payout_clearing amount
refund (full)               reverse of the tip posting (guide balance never goes negative)
```

Every posting is one balanced database transaction; the ledger table is append-only (database trigger) and unbalanced transactions are rejected at commit (deferred constraint trigger). See `src/lib/ledger.ts`.

**Float illustration:** 1.000 tips a month at an average of €15, held about 15 days, at 6 % → average pooled balance about €7.500 → about €37 of interest per month (about €36 on the net amounts owed to guides). Small compared with the 5 % service fee (about €750 on the same volume). Do not build the business case on it; and in the default model the interest is 0 for the platform.

## Project layout

```
src/app            pages and route handlers (tourist /t/[slug], /dashboard, /admin, /api/*)
src/lib            ledger, money, tips, webhooks, payouts, statements, float, reconciliation, auth, providers
src/lib/provider   PaymentProvider interface, StripeProvider, MockProvider
src/db             Drizzle schema, PGlite helper
drizzle            SQL migrations (including the ledger integrity triggers)
tests              Vitest unit + integration tests (money, ledger, webhooks, payouts, reports, auth, stripe, env)
e2e                Playwright tests (tourist, guide, admin + monthly job)
scripts            migrate, seed, manual jobs
```

## Security summary

Webhook signature verification and event-id idempotency · per-IP rate limits on public endpoints (best effort, see `DECISIONS.md`) · Origin check on authenticated state-changing routes · zod validation and amount bounds · every guide query scoped to the signed-in guide · admin routes require the admin role · audit log for payouts, fee changes, exports and admin actions · no card data stored, no secrets logged · security headers set in `next.config.mjs`.
