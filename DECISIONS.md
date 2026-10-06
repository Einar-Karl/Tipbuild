# Decisions and assumptions

Items marked **ASSUMPTION** were not specified and were decided while building. Change them via the named setting where one exists.

## Funds flow

* **Default is the compliant mode** (`FUNDS_MODEL=psp_scheduled_payout`): Stripe destination charges with an application fee; each guide's connected account is set to a **monthly payout schedule on day 1** (`interval: monthly`, `monthly_anchor: 1`). The platform never holds client money and earns only the application fee.
* `platform_pooled` exists behind `ALLOW_POOLED_FUNDS=true` (the app refuses to start otherwise, see `src/env.ts`). It uses separate charges and transfers and a monthly transfer job. See `LEGAL_NOTICE.md`.
* **Not built, on purpose:** holding client funds in an ordinary company bank account. The spec says to refuse this path; the reasons are in `LEGAL_NOTICE.md` (authorisation, safeguarding, KYC/AML, rules on use of the money).
* The ledger is the source of truth in **both** modes, so switching models needs no data migration.
* **Float**: snapshots always record the ledger "owed to guides" balance. The interest column attributed to the platform is 0 in `psp_scheduled_payout`; a separate "what-if" column shows what the same balance would earn at `ASSUMED_RATE_BPS` (**ASSUMPTION** 600 = 6 %).

## Iceland and Stripe Connect

* Stripe Connect supports Iceland for **cross-border payouts only**, EUR bank payouts only. Connected accounts are therefore Express accounts with `country: IS`, the `recipient` service agreement and only the `transfers` capability. They cannot be used with `on_behalf_of`, so charges are plain destination charges on the platform entity. The country is the `accountCountry` option of `StripeProvider`.
* A platform entity in a fully supported country (for example Ireland or Estonia) is probably needed. That is a business decision outside the code.
* **Currency (ASSUMPTION):** all charges are in EUR. The tourist sees an ISK equivalent as a hint, computed with a static `ISK_PER_EUR` (default 150). It is never used for settlement. Every money row stores its currency so multi-currency can be added later.
* Stripe sends platform events (payments, refunds) and Connect events (`account.updated`, `payout.*`) to **different webhook endpoints with different signing secrets**. `STRIPE_WEBHOOK_SECRET` accepts a comma separated list; point both endpoints at `/api/webhooks/provider`.
* Stripe's API has `payment_intent.payment_failed`; the spec's `payment_intent.failed` is mapped to it.
* The legacy Payment Request Button is replaced by Stripe's **Express Checkout Element**, which shows Apple Pay, Google Pay and Link where the device supports them, plus the Payment Element for cards.

## Money rules

* Integer minor units everywhere. Fee = `round_half_up(amount x bps / 10000)`, net = amount - fee, so amount = fee + net always.
* **"Cover the fee"** (off by default): the tourist pays tip + fee, the guide receives the full chosen tip. The fee is computed on the tip.
* Tip limits: min EUR 1, max EUR 500, enforced server side.
* Operator fee override replaces `FEE_BPS` for that operator's guides; changes are audited with before/after.
* **Refunds:** full refunds reverse the ledger entries. If the guide was already paid out, the guide's balance is never driven negative: the **platform absorbs the shortfall** (debited to `platform_fee`) and an audit entry is written. **Partial refunds** are not applied automatically; they are flagged in the audit log and in the reconciliation report for manual handling.
* **Processor fees** are posted when known: Mock provider sends them with the event; Stripe fee is fetched from the balance transaction before the webhook transaction starts.
* **Database-level integrity:** `ledger_entries` is append-only (trigger) and every ledger transaction must balance at commit (deferred constraint trigger), in addition to the checks in the application layer.

## Payouts

* The job runs on the 1st at 06:00 UTC for the previous calendar month (`vercel.json` cron). Balance considered = what the guide was owed at the **end of the period** (so tips arriving after midnight on the 1st wait for next month), capped by the current balance (so refunds in between are never paid out).
* Below `MIN_PAYOUT_MINOR` (default EUR 20) nothing is created and the balance rolls over. A rolled-over balance is paid with the next month; the statement shows it as "rolled over".
* **Idempotency:** unique `payouts.idempotency_key = payout:{guide}:{YYYY-MM}` plus the same key on the provider call plus a status-transition guard around the ledger posting. Re-running is safe. A failed payout is retried by the next run with the same key.
* In `psp_scheduled_payout` the job records the expected payout (status `pending`) and emails the statement; the ledger is posted when the provider's `payout.paid` webhook arrives. A different amount reported by the provider is accepted for status purposes but flagged in the audit log (`payout.amount_mismatch`) because Stripe pays out its own balance, not our figure.
* Failures create an audit entry and an email alert to `ADMIN_EMAILS`.
* Statements: email with text body plus CSV and PDF attachments; the PDF is generated with `pdf-lib` using standard fonts (WinAnsi covers Icelandic letters and the euro sign; other characters become `?`).

## Application

* **Auth: custom email magic link** instead of Auth.js/Supabase Auth: a short-lived (15 min), single-use, hashed token; the link opens a confirmation page and only a POST consumes it, so mail scanners cannot burn it; HMAC-signed, HttpOnly, SameSite=Lax session cookie. Fewer moving parts, no adapter beta dependency. Admins are promoted via `ADMIN_EMAILS` (never demoted automatically).
* **Demo mode:** without `RESEND_API_KEY` outside production (or with `ALLOW_LOCAL_DB=true`) emails go to an in-memory outbox and the sign-in link is shown on the login page. Never enabled in a normal production deployment.
* **Database:** Postgres through Drizzle. With no `DATABASE_URL`, the app uses **PGlite** (embedded Postgres 16) stored in `.data/pglite`, so `npm run dev`, the tests and the e2e suite need no database server. Migrations are plain SQL in `drizzle/`.
* **Rate limiting** is in memory per server instance: good burst protection, not a hard guarantee on serverless. Put a shared limiter (Vercel WAF, Upstash) in front for stronger guarantees.
* **CSRF:** Origin/Referer check on all state-changing authenticated routes, on top of SameSite=Lax cookies.
* **i18n:** a small typed dictionary (`src/lib/i18n`), English first, Icelandic second. The guide dashboard and tourist pages are translated; the admin area is English only. Numbers and dates are always European (`1.234,50 €`, `dd.mm.yyyy`).
* **CSV exports** follow the European Excel convention: `;` separator, `,` decimal mark, UTF-8 BOM, spreadsheet-formula injection neutralised.
* **Guide photos:** a URL field only. File upload needs a storage bucket and is out of scope for v1.
* **Guide slugs** never change after creation (printed QR codes and NFC cards must keep working).
* **Tourist country** comes from the host's `x-vercel-ip-country` header and is stored without the IP.
* **Review gating:** ratings 4-5 offer the operator's public review link, 1-3 private feedback, as specified. See `COMPLIANCE.md` item 13: this practice is restricted by some review platforms.
* **Library versions:** Next.js 15 (App Router, React 19), Tailwind CSS 3, Zod 3, Stripe SDK 17, Vitest 3, Playwright 1.56, ESLint 8. Chosen for stability; newer majors exist.
* **Fonts** are self-hosted through `@fontsource-variable` packages (no request to Google Fonts from the tourist's phone).

## Hardening (milestone 7)

* **Security headers:** `X-Frame-Options`, `X-Content-Type-Options`, HSTS, `Referrer-Policy`, `Permissions-Policy`, and a *partial* Content-Security-Policy (`frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`). A full `script-src` policy was deliberately **not** enabled: Stripe Elements / Apple Pay / Google Pay load scripts and frames from several Stripe, Google and Apple hosts, and a wrong policy would silently break payments. Follow-up: add a nonce-based CSP and verify it against live Express Checkout in a staging environment.
* **Accessibility:** axe-core runs in the e2e suite (WCAG 2 A/AA, light and dark mode) on tourist, guide, admin and public pages and fails on serious/critical findings. Fixed from the audit: button text colour on the accent (white on orange was 3:1, now dark ink, 6:1), success-green contrast, keyboard-focusable scrollable tables, 44 px language links. There is a keyboard-only test for the tip form. A manual screen-reader pass with real Apple Pay / Google Pay sheets is still recommended.
* **Rate limits:** tip intent 20/min/IP, ratings 20/min/IP, tip status 120/min/IP, magic link 10/min/IP and 3 per 10 min per address (per-address limit answers identically so addresses cannot be enumerated). See the note on in-memory limits above.
* **Audit log:** payouts (created, paid, failed, run), operator and fee changes, guide-to-operator assignment, CSV exports, admin sign-ins, payout-account creation, guide deletion and data export, amount mismatches, refund shortfalls, partial refunds needing manual handling.
* **E2E sign-in:** Playwright signs in once per role in a setup project and reuses the stored session, so tests do not hit the magic-link rate limit; the guide spec still exercises the full magic-link flow.
* **Health check:** `GET /api/health` (database ping) for uptime monitors. `robots.txt` disallows the tip pages, dashboard, admin and API.
