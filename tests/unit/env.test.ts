import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/env';

describe('environment validation', () => {
  it('defaults to the compliant funds model and sane values', () => {
    const e = parseEnv({});
    expect(e).toMatchObject({ FUNDS_MODEL: 'psp_scheduled_payout', ALLOW_POOLED_FUNDS: false, FEE_BPS: 500, MIN_PAYOUT_MINOR: 2000, DEFAULT_CURRENCY: 'EUR', PAYMENT_PROVIDER: 'mock', ASSUMED_RATE_BPS: 600 });
  });

  it('refuses to start in platform_pooled mode unless ALLOW_POOLED_FUNDS=true', () => {
    expect(() => parseEnv({ FUNDS_MODEL: 'platform_pooled' })).toThrow(/ALLOW_POOLED_FUNDS/);
    expect(() => parseEnv({ FUNDS_MODEL: 'platform_pooled', ALLOW_POOLED_FUNDS: 'false' })).toThrow(/Refusing to start/);
    expect(parseEnv({ FUNDS_MODEL: 'platform_pooled', ALLOW_POOLED_FUNDS: 'true' }).FUNDS_MODEL).toBe('platform_pooled');
  });

  it('treats empty strings as unset (.env files)', () => {
    const e = parseEnv({ STRIPE_SECRET_KEY: '', DATABASE_URL: '', FEE_BPS: '' });
    expect(e.PAYMENT_PROVIDER).toBe('mock');
    expect(e.FEE_BPS).toBe(500);
  });

  it('requires Stripe keys when using Stripe', () => {
    expect(() => parseEnv({ PAYMENT_PROVIDER: 'stripe' })).toThrow(/STRIPE_SECRET_KEY/);
    const e = parseEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PUBLISHABLE_KEY: 'pk' });
    expect(e.PAYMENT_PROVIDER).toBe('stripe');
  });

  it('production needs real secrets, a database and a real provider', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET[\s\S]*CRON_SECRET|CRON_SECRET[\s\S]*AUTH_SECRET/);
    expect(() => parseEnv({ NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32), CRON_SECRET: 'c', DATABASE_URL: 'postgres://x' })).toThrow(/mock provider/);
    expect(
      parseEnv({ NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32), CRON_SECRET: 'c', DATABASE_URL: 'postgres://x', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PUBLISHABLE_KEY: 'pk' }).PAYMENT_PROVIDER,
    ).toBe('stripe');
  });

  it('rejects weak secrets and out-of-range fees', () => {
    expect(() => parseEnv({ AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ FEE_BPS: '99999' })).toThrow(/FEE_BPS/);
    expect(() => parseEnv({ DEFAULT_CURRENCY: 'USD' })).toThrow(/DEFAULT_CURRENCY/);
  });
});
