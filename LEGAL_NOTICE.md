# LEGAL NOTICE: pooled funds mode

> **This file is a warning, not legal advice.**

`FUNDS_MODEL=platform_pooled` makes the platform receive tips from tourists, hold them, and pay them to guides later (monthly). Receiving money from payers and passing it on to others is a **regulated payment service** (money remittance / e-money) under PSD2 and the EEA payment services rules, and in most jurisdictions it requires:

1. **An authorisation** as a payment institution or e-money institution, **or** registration as an agent of an authorised institution, **or** a valid exemption (for example a commercial-agent or limited-network exclusion, which rarely fits a marketplace that collects money from payers for many payees).
2. **Safeguarding** of client funds in a segregated (designated) account, kept separate from the company's own money.
3. **KYC/AML** controls on the people paid out, and transaction monitoring.
4. **Rules on what may be done with the money.** Whether interest earned on safeguarded funds can be kept by the platform depends on the licence and the regulator. **Do not assume that you can keep it.**

Doing this from an ordinary company bank account is not a compliant setup. This repository deliberately refuses to build that path (see `DECISIONS.md`).

## What the software does in this mode

* The app **refuses to start** unless `ALLOW_POOLED_FUNDS=true` is set explicitly, and prints a loud warning at boot when it is.
* A **safeguarding reconciliation report** (`/admin/reconciliation`, `GET /api/admin/reconciliation`) checks that the sum of guide payable balances in the ledger is **at most** the funds held in the designated account. You enter that balance (or the provider reports it). A shortfall is shown as a failure.
* The **float report** (`/admin/float`) shows the size of the pooled balance and the interest it would earn at the assumed rate. It is an estimate; interest is only yours to keep if your licence and safeguarding rules allow it.

## Before turning it on

* Get a written opinion from a payments lawyer in the country where the operating entity is established **and** where payers and payees are located (Iceland and the EEA).
* Have the licence or the agent registration in place, and the designated safeguarding account opened.
* Make sure the payment provider's terms allow platform-held balances for your use case (Stripe Connect separate charges and transfers, for example, carries its own conditions).
* Review `COMPLIANCE.md` with the lawyer and the accountant.

The recommended default, `FUNDS_MODEL=psp_scheduled_payout`, keeps the licensed payment provider in charge of the money: the platform only earns its application fee and never holds client funds.
