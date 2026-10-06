import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
/** Money columns that can be summed over many rows. */
const big = (name: string) => bigint(name, { mode: 'number' });

export const userRole = pgEnum('user_role', ['guide', 'admin']);
export const payoutStatus = pgEnum('guide_payout_status', ['pending', 'active', 'restricted']);
export const tipStatus = pgEnum('tip_status', ['pending', 'succeeded', 'refunded', 'failed']);
export const accountKind = pgEnum('ledger_account_kind', [
  'guest_clearing',
  'guide_payable',
  'platform_fee',
  'processor_fee',
  'payout_clearing',
  'bank',
]);
export const payoutRowStatus = pgEnum('payout_status', ['pending', 'paid', 'failed']);
export const webhookStatus = pgEnum('webhook_status', ['processed', 'failed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  role: userRole('role').notNull().default('guide'),
  createdAt: ts('created_at'),
});

export const loginTokens = pgTable('login_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: ts('created_at'),
});

export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  feeBpsOverride: integer('fee_bps_override'),
  /** Google / Tripadvisor review link offered to tourists who rate 4-5 stars. */
  reviewUrl: text('review_url'),
  createdAt: ts('created_at'),
});

export const guides = pgTable(
  'guides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    slug: text('slug').notNull().unique(),
    avatarUrl: text('avatar_url'),
    operatorId: uuid('operator_id').references(() => operators.id, { onDelete: 'set null' }),
    payoutAccountId: text('payout_account_id'),
    payoutStatus: payoutStatus('payout_status').notNull().default('pending'),
    defaultCurrency: text('default_currency').notNull().default('EUR'),
    createdAt: ts('created_at'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('guides_operator_idx').on(t.operatorId),
    unique('guides_payout_account_uq').on(t.payoutAccountId),
  ],
);

export const tours = pgTable(
  'tours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guideId: uuid('guide_id')
      .notNull()
      .references(() => guides.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at'),
  },
  (t) => [index('tours_guide_idx').on(t.guideId)],
);

export const tips = pgTable(
  'tips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guideId: uuid('guide_id')
      .notNull()
      .references(() => guides.id),
    tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    feeMinor: integer('fee_minor').notNull(),
    netMinor: integer('net_minor').notNull(),
    coversFee: boolean('covers_fee').notNull().default(false),
    providerPaymentId: text('provider_payment_id').unique(),
    status: tipStatus('status').notNull().default('pending'),
    rating: smallint('rating'),
    reviewText: text('review_text'),
    touristCountry: text('tourist_country'),
    createdAt: ts('created_at'),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
  },
  (t) => [
    index('tips_guide_created_idx').on(t.guideId, t.createdAt),
    index('tips_status_idx').on(t.status),
    check('tips_amount_split', sql`${t.amountMinor} = ${t.feeMinor} + ${t.netMinor}`),
    check('tips_positive', sql`${t.amountMinor} > 0 AND ${t.feeMinor} >= 0 AND ${t.netMinor} >= 0`),
    check('tips_rating_range', sql`${t.rating} IS NULL OR (${t.rating} BETWEEN 1 AND 5)`),
  ],
);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: accountKind('kind').notNull(),
    ownerGuideId: uuid('owner_guide_id').references(() => guides.id),
    currency: text('currency').notNull(),
  },
  (t) => [unique('ledger_accounts_uq').on(t.kind, t.ownerGuideId, t.currency).nullsNotDistinct()],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    txnId: uuid('txn_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    debitMinor: big('debit_minor').notNull().default(0),
    creditMinor: big('credit_minor').notNull().default(0),
    currency: text('currency').notNull(),
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    createdAt: ts('created_at'),
  },
  (t) => [
    index('ledger_entries_txn_idx').on(t.txnId),
    index('ledger_entries_account_idx').on(t.accountId, t.createdAt),
    index('ledger_entries_ref_idx').on(t.refType, t.refId),
    check(
      'ledger_entries_one_side',
      sql`(${t.debitMinor} > 0 AND ${t.creditMinor} = 0) OR (${t.creditMinor} > 0 AND ${t.debitMinor} = 0)`,
    ),
  ],
);

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guideId: uuid('guide_id')
      .notNull()
      .references(() => guides.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amountMinor: big('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: payoutRowStatus('status').notNull().default('pending'),
    providerPayoutId: text('provider_payout_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    failureReason: text('failure_reason'),
    statementSentAt: timestamp('statement_sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: ts('created_at'),
  },
  (t) => [index('payouts_guide_idx').on(t.guideId), check('payouts_positive', sql`${t.amountMinor} > 0`)],
);

export const floatSnapshots = pgTable(
  'float_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    /** Sum of guide payable balances in the ledger at snapshot time. */
    pooledBalanceMinor: big('pooled_balance_minor').notNull(),
    currency: text('currency').notNull(),
    assumedRateBps: integer('assumed_rate_bps').notNull(),
    /** Interest actually attributable to the platform: 0 unless FUNDS_MODEL=platform_pooled. */
    accruedInterestMinor: big('accrued_interest_minor').notNull(),
    /** What the same balance would earn at the assumed rate (what-if view). */
    hypotheticalInterestMinor: big('hypothetical_interest_minor').notNull(),
    fundsModel: text('funds_model').notNull(),
  },
  (t) => [unique('float_snapshots_date_currency_uq').on(t.date, t.currency)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at'),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  type: text('type').notNull(),
  status: webhookStatus('status').notNull(),
  error: text('error'),
  receivedAt: ts('received_at'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type Guide = typeof guides.$inferSelect;
export type Operator = typeof operators.$inferSelect;
export type Tour = typeof tours.$inferSelect;
export type Tip = typeof tips.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type AccountKind = (typeof accountKind.enumValues)[number];
