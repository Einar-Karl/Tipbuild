export type FundsModel = 'psp_scheduled_payout' | 'platform_pooled';

/** Provider-neutral webhook events. Each provider adapter maps its own events into these. */
export type ProviderEvent =
  | {
      id: string;
      type: 'payment.succeeded';
      paymentId: string;
      tipId?: string;
      amountMinor: number;
      currency: string;
      processorFeeMinor?: number | null;
    }
  | { id: string; type: 'payment.failed'; paymentId: string; tipId?: string }
  | { id: string; type: 'charge.refunded'; paymentId: string; amountRefundedMinor: number; currency: string }
  | { id: string; type: 'account.updated'; accountId: string; payoutsEnabled: boolean; detailsSubmitted: boolean }
  | { id: string; type: 'payout.paid'; accountId: string; payoutId: string; amountMinor: number; currency: string }
  | { id: string; type: 'payout.failed'; accountId: string; payoutId: string; amountMinor: number; currency: string; reason?: string }
  | { id: string; type: 'ignored' };

export class WebhookSignatureError extends Error {}

export interface GuideForProvider {
  id: string;
  displayName: string;
  email: string | null;
  payoutAccountId: string | null;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  /** Creates the provider account when needed and returns a hosted onboarding (KYC + bank details) link. */
  createOnboardingLink(guide: GuideForProvider): Promise<{ url: string; accountId: string }>;
  createTipIntent(args: {
    guideId: string;
    tipId: string;
    /** Provider account of the guide; required for destination charges in psp_scheduled_payout. */
    destinationAccountId: string | null;
    amountMinor: number;
    currency: string;
    feeMinor: number;
    fundsModel: FundsModel;
  }): Promise<{ clientSecret: string; providerPaymentId: string }>;
  /** platform_pooled only: move a guide's balance from the platform to their account. */
  transferToGuide(args: {
    guideId: string;
    destinationAccountId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  /** psp_scheduled_payout only: make the provider pay the guide out monthly. */
  setPayoutSchedule(accountId: string, schedule: { interval: 'monthly'; anchor: number }): Promise<void>;
  /** Throws WebhookSignatureError for a bad signature. */
  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent;
  /** Optional: processor fee in minor units for a succeeded payment, if the provider can tell. */
  fetchProcessorFee?(providerPaymentId: string): Promise<number | null>;
  /** Optional: funds the platform holds at the provider (pooled mode reconciliation). */
  getPlatformBalance?(currency: string): Promise<number | null>;
}
