import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  WebhookSignatureError,
  type GuideForProvider,
  type PaymentProvider,
  type ProviderEvent,
} from './types';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

/** Typical EEA card pricing, used so the mock produces processor fees too. */
export function mockProcessorFee(amountMinor: number): number {
  return Math.round((amountMinor * 150) / 10000) + 25;
}

export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  constructor(
    private readonly opts: {
      secret: string;
      appUrl: string;
      /** Test hook: make transfers fail. */
      failTransfers?: boolean;
    },
  ) {}

  sign(rawBody: string): string {
    return createHmac('sha256', this.opts.secret).update(rawBody).digest('hex');
  }

  /** Build a signed webhook delivery as the mock "provider" would send it. */
  deliver(event: ProviderEvent): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: this.sign(rawBody) };
  }

  async createOnboardingLink(guide: GuideForProvider) {
    const accountId = guide.payoutAccountId ?? `mock_acct_${guide.id.replace(/-/g, '').slice(0, 16)}`;
    return { url: `${this.opts.appUrl}/mock/onboarding?account=${encodeURIComponent(accountId)}`, accountId };
  }

  async createTipIntent(args: { tipId: string }) {
    const id = `mock_pi_${randomUUID().replace(/-/g, '')}`;
    return { providerPaymentId: id, clientSecret: `${id}_secret_${args.tipId.slice(0, 8)}` };
  }

  async transferToGuide(args: { idempotencyKey: string }) {
    if (this.opts.failTransfers) throw new Error('mock transfer failure');
    // Deterministic per idempotency key, like a real provider.
    const id = createHmac('sha256', this.opts.secret).update(args.idempotencyKey).digest('hex').slice(0, 24);
    return { id: `mock_tr_${id}` };
  }

  async setPayoutSchedule(): Promise<void> {
    /* nothing to do */
  }

  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent {
    if (!signature) throw new WebhookSignatureError('missing signature');
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const got = Buffer.from(signature, 'hex');
    if (expected.length !== got.length || !timingSafeEqual(expected, got))
      throw new WebhookSignatureError('bad signature');
    return JSON.parse(rawBody) as ProviderEvent;
  }
}
