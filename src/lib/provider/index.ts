import { getEnv } from '@/env';
import { MockProvider } from './mock';
import { StripeProvider } from './stripe';
import type { PaymentProvider } from './types';

const g = globalThis as unknown as { __tipProvider?: PaymentProvider };

export function getProvider(): PaymentProvider {
  if (!g.__tipProvider) {
    const env = getEnv();
    if (env.PAYMENT_PROVIDER === 'stripe') {
      g.__tipProvider = new StripeProvider({
        secretKey: env.STRIPE_SECRET_KEY!,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
        appUrl: env.APP_URL,
      });
    } else {
      g.__tipProvider = new MockProvider({ secret: env.AUTH_SECRET, appUrl: env.APP_URL });
    }
  }
  return g.__tipProvider;
}

export type { PaymentProvider } from './types';
