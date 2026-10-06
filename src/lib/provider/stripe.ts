import Stripe from 'stripe';
import {
  WebhookSignatureError,
  type GuideForProvider,
  type PaymentProvider,
  type ProviderEvent,
} from './types';

export interface StripeProviderOptions {
  secretKey: string;
  /** One or more signing secrets, comma separated: platform endpoint and Connect endpoint have different ones. */
  webhookSecret: string;
  appUrl: string;
  /**
   * Country of the connected accounts. Iceland (IS) is supported by Stripe Connect for
   * cross-border payouts only (recipient service agreement, EUR bank payouts).
   */
  accountCountry?: string;
  /** Test hook: inject a Stripe client. */
  client?: Stripe;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;
  private readonly secrets: string[];

  constructor(private readonly opts: StripeProviderOptions) {
    this.stripe = opts.client ?? new Stripe(opts.secretKey, { maxNetworkRetries: 2 });
    this.secrets = opts.webhookSecret.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async createOnboardingLink(guide: GuideForProvider) {
    let accountId = guide.payoutAccountId;
    if (!accountId) {
      const account = await this.stripe.accounts.create(
        {
          type: 'express',
          country: this.opts.accountCountry ?? 'IS',
          email: guide.email ?? undefined,
          business_type: 'individual',
          capabilities: { transfers: { requested: true } },
          tos_acceptance: { service_agreement: 'recipient' },
          metadata: { guideId: guide.id },
        },
        { idempotencyKey: `acct:${guide.id}` },
      );
      accountId = account.id;
    }
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${this.opts.appUrl}/dashboard?onboarding=refresh`,
      return_url: `${this.opts.appUrl}/dashboard?onboarding=return`,
    });
    return { url: link.url, accountId };
  }

  async createTipIntent(args: Parameters<PaymentProvider['createTipIntent']>[0]) {
    const params: Stripe.PaymentIntentCreateParams = {
      amount: args.amountMinor,
      currency: args.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { tipId: args.tipId, guideId: args.guideId },
      description: 'Tip',
    };
    if (args.fundsModel === 'psp_scheduled_payout') {
      if (!args.destinationAccountId) throw new Error('guide has no connected account');
      // Destination charge: funds settle on the guide's connected account, platform keeps the application fee.
      params.application_fee_amount = args.feeMinor;
      params.transfer_data = { destination: args.destinationAccountId };
    } else {
      // Separate charges and transfers: funds stay on the platform until the monthly transfer.
      params.transfer_group = `tip_${args.tipId}`;
    }
    const pi = await this.stripe.paymentIntents.create(params, { idempotencyKey: `pi:${args.tipId}` });
    if (!pi.client_secret) throw new Error('Stripe returned no client secret');
    return { clientSecret: pi.client_secret, providerPaymentId: pi.id };
  }

  async transferToGuide(args: Parameters<PaymentProvider['transferToGuide']>[0]) {
    const tr = await this.stripe.transfers.create(
      {
        amount: args.amountMinor,
        currency: args.currency.toLowerCase(),
        destination: args.destinationAccountId,
        metadata: { guideId: args.guideId, idempotencyKey: args.idempotencyKey },
      },
      { idempotencyKey: args.idempotencyKey },
    );
    return { id: tr.id };
  }

  async setPayoutSchedule(accountId: string, schedule: { interval: 'monthly'; anchor: number }): Promise<void> {
    await this.stripe.accounts.update(accountId, {
      settings: { payouts: { schedule: { interval: schedule.interval, monthly_anchor: schedule.anchor } } },
    });
  }

  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent {
    if (!signature) throw new WebhookSignatureError('missing signature');
    let event: Stripe.Event | null = null;
    for (const secret of this.secrets) {
      try {
        event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch {
        /* try next secret */
      }
    }
    if (!event) throw new WebhookSignatureError('bad signature');
    return mapStripeEvent(event);
  }

  async fetchProcessorFee(providerPaymentId: string): Promise<number | null> {
    const pi = await this.stripe.paymentIntents.retrieve(providerPaymentId, {
      expand: ['latest_charge.balance_transaction'],
    });
    const charge = pi.latest_charge;
    if (!charge || typeof charge === 'string') return null;
    const bt = charge.balance_transaction;
    if (!bt || typeof bt === 'string') return null;
    return bt.currency === pi.currency ? bt.fee : null;
  }

  async getPlatformBalance(currency: string): Promise<number | null> {
    const bal = await this.stripe.balance.retrieve();
    const c = currency.toLowerCase();
    const sum = (rows: Stripe.Balance.Available[]) => rows.filter((r) => r.currency === c).reduce((s, r) => s + r.amount, 0);
    return sum(bal.available) + sum(bal.pending);
  }
}

export function mapStripeEvent(event: Stripe.Event): ProviderEvent {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      return {
        id: event.id,
        type: 'payment.succeeded',
        paymentId: pi.id,
        tipId: pi.metadata?.tipId,
        amountMinor: pi.amount_received || pi.amount,
        currency: pi.currency,
      };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      return { id: event.id, type: 'payment.failed', paymentId: pi.id, tipId: pi.metadata?.tipId };
    }
    case 'charge.refunded': {
      const ch = event.data.object;
      const pid = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id;
      if (!pid) return { id: event.id, type: 'ignored' };
      return { id: event.id, type: 'charge.refunded', paymentId: pid, amountRefundedMinor: ch.amount_refunded, currency: ch.currency };
    }
    case 'account.updated': {
      const a = event.data.object;
      return {
        id: event.id,
        type: 'account.updated',
        accountId: a.id,
        payoutsEnabled: !!a.payouts_enabled,
        detailsSubmitted: !!a.details_submitted,
      };
    }
    case 'payout.paid': {
      const p = event.data.object;
      if (!event.account) return { id: event.id, type: 'ignored' };
      return { id: event.id, type: 'payout.paid', accountId: event.account, payoutId: p.id, amountMinor: p.amount, currency: p.currency };
    }
    case 'payout.failed': {
      const p = event.data.object;
      if (!event.account) return { id: event.id, type: 'ignored' };
      return {
        id: event.id,
        type: 'payout.failed',
        accountId: event.account,
        payoutId: p.id,
        amountMinor: p.amount,
        currency: p.currency,
        reason: p.failure_message ?? undefined,
      };
    }
    default:
      return { id: event.id, type: 'ignored' };
  }
}
