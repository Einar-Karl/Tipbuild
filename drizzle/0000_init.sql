CREATE TYPE "public"."ledger_account_kind" AS ENUM('guest_clearing', 'guide_payable', 'platform_fee', 'processor_fee', 'payout_clearing', 'bank');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."guide_payout_status" AS ENUM('pending', 'active', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."tip_status" AS ENUM('pending', 'succeeded', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('guide', 'admin');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('processed', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "float_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"pooled_balance_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"assumed_rate_bps" integer NOT NULL,
	"accrued_interest_minor" bigint NOT NULL,
	"hypothetical_interest_minor" bigint NOT NULL,
	"funds_model" text NOT NULL,
	CONSTRAINT "float_snapshots_date_currency_uq" UNIQUE("date","currency")
);
--> statement-breakpoint
CREATE TABLE "guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"avatar_url" text,
	"operator_id" uuid,
	"payout_account_id" text,
	"payout_status" "guide_payout_status" DEFAULT 'pending' NOT NULL,
	"default_currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "guides_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "guides_slug_unique" UNIQUE("slug"),
	CONSTRAINT "guides_payout_account_uq" UNIQUE("payout_account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"owner_guide_id" uuid,
	"currency" text NOT NULL,
	CONSTRAINT "ledger_accounts_uq" UNIQUE NULLS NOT DISTINCT("kind","owner_guide_id","currency")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"txn_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_one_side" CHECK (("ledger_entries"."debit_minor" > 0 AND "ledger_entries"."credit_minor" = 0) OR ("ledger_entries"."credit_minor" > 0 AND "ledger_entries"."debit_minor" = 0))
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fee_bps_override" integer,
	"review_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guide_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"provider_payout_id" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"statement_sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payouts_positive" CHECK ("payouts"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guide_id" uuid NOT NULL,
	"tour_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"fee_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"covers_fee" boolean DEFAULT false NOT NULL,
	"provider_payment_id" text,
	"status" "tip_status" DEFAULT 'pending' NOT NULL,
	"rating" smallint,
	"review_text" text,
	"tourist_country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "tips_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "tips_amount_split" CHECK ("tips"."amount_minor" = "tips"."fee_minor" + "tips"."net_minor"),
	CONSTRAINT "tips_positive" CHECK ("tips"."amount_minor" > 0 AND "tips"."fee_minor" >= 0 AND "tips"."net_minor" >= 0),
	CONSTRAINT "tips_rating_range" CHECK ("tips"."rating" IS NULL OR ("tips"."rating" BETWEEN 1 AND 5))
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guide_id" uuid NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'guide' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" "webhook_status" NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_guide_id_guides_id_fk" FOREIGN KEY ("owner_guide_id") REFERENCES "public"."guides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tips" ADD CONSTRAINT "tips_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "guides_operator_idx" ON "guides" USING btree ("operator_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_txn_idx" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_ref_idx" ON "ledger_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "payouts_guide_idx" ON "payouts" USING btree ("guide_id");--> statement-breakpoint
CREATE INDEX "tips_guide_created_idx" ON "tips" USING btree ("guide_id","created_at");--> statement-breakpoint
CREATE INDEX "tips_status_idx" ON "tips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tours_guide_idx" ON "tours" USING btree ("guide_id");