import { getEnv } from '@/env';
import type { FundsModel } from './provider/types';

/** The subset of configuration business logic depends on; passed explicitly so tests can vary it. */
export interface AppConfig {
  feeBps: number;
  currency: string;
  fundsModel: FundsModel;
  minPayoutMinor: number;
  assumedRateBps: number;
  appUrl: string;
}

export function getConfig(): AppConfig {
  const e = getEnv();
  return {
    feeBps: e.FEE_BPS,
    currency: e.DEFAULT_CURRENCY,
    fundsModel: e.FUNDS_MODEL,
    minPayoutMinor: e.MIN_PAYOUT_MINOR,
    assumedRateBps: e.ASSUMED_RATE_BPS,
    appUrl: e.APP_URL,
  };
}
