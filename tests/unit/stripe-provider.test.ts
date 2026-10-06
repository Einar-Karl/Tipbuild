import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { StripeProvider, mapStripeEvent } from '@/lib/provider/stripe';
import { WebhookSignatureError } from '@/lib/provider/types';

const whsec = 'whsec_test_primary';
const whsecConnect = 'whsec_test_connect';

function make() {
  const client = new Stripe('sk_test_dummy');
  const mocks = {
    accountsCreate: vi.fn().mockResolvedValue({ id: 'acct_new' }),
    accountsUpdate: vi.fn().mockResolvedValue({}),
    linksCreate: vi.fn().mockResolvedValue({ url: 'https://connect.stripe.test/onboard' }),
    piCreate: vi.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' }),
    trCreate: vi.fn().mockResolvedValue({ id: 'tr_1' }),
    piRetrieve: vi.fn(),
  };
  client.accounts.create = mocks.accountsCreate as never;
  client.accounts.update = mocks.accountsUpdate as never;
  client.accountLinks.create = mocks.linksCreate as never;
  client.paymentIntents.create = mocks.piCreate as never;
  client.paymentIntents.retrieve = mocks.piRetrieve as never;
  client.transfers.create = mocks.trCreate as never;
  const provider = new StripeProvider({ secretKey: 'sk_test_dummy', webhookSecret: `${whsec}, ${whsecConnect}`, appUrl: 'https://tip.test', client });
  return { provider, mocks, client };
}

const signed = (client: Stripe, payload: object, secret = whsec) => {
  const rawBody = JSON.stringify(payload);
  return { rawBody, signature: client.webhooks.generateTestHeaderString({ payload: rawBody, secret }) };
};

describe('StripeProvider', () => {
  it('creates a recipient Express account (Iceland, cross-border) once and returns an onboarding link', async () => {
    const { provider, mocks } = make();
    const r = await provider.createOnboardingLink({ id: 'g1', displayName: 'A', email: 'a@x.is', payoutAccountId: null });
    expect(r).toEqual({ url: 'https://connect.stripe.test/onboard', accountId: 'acct_new' });
    const [params, opts] = mocks.accountsCreate.mock.calls[0]!;
    expect(params).toMatchObject({
      type: 'express',
      country: 'IS',
      capabilities: { transfers: { requested: true } },
      tos_acceptance: { service_agreement: 'recipient' },
    });
    expect(opts).toEqual({ idempotencyKey: 'acct:g1' });
    expect(mocks.linksCreate.mock.calls[0]![0]).toMatchObject({ account: 'acct_new', type: 'account_onboarding' });

    mocks.accountsCreate.mockClear();
    await provider.createOnboardingLink({ id: 'g1', displayName: 'A', email: null, payoutAccountId: 'acct_existing' });
    expect(mocks.accountsCreate).not.toHaveBeenCalled();
    expect(mocks.linksCreate.mock.calls[1]![0].account).toBe('acct_existing');
  });

  it('scheduled mode: destination charge with application fee, idempotent per tip', async () => {
    const { provider, mocks } = make();
    const r = await provider.createTipIntent({ guideId: 'g', tipId: 't1', destinationAccountId: 'acct_g', amountMinor: 1000, currency: 'EUR', feeMinor: 50, fundsModel: 'psp_scheduled_payout' });
    expect(r).toEqual({ clientSecret: 'pi_1_secret', providerPaymentId: 'pi_1' });
    const [params, opts] = mocks.piCreate.mock.calls[0]!;
    expect(params).toMatchObject({ amount: 1000, currency: 'eur', application_fee_amount: 50, transfer_data: { destination: 'acct_g' }, metadata: { tipId: 't1', guideId: 'g' } });
    expect(opts).toEqual({ idempotencyKey: 'pi:t1' });
    await expect(
      provider.createTipIntent({ guideId: 'g', tipId: 't2', destinationAccountId: null, amountMinor: 1000, currency: 'EUR', feeMinor: 50, fundsModel: 'psp_scheduled_payout' }),
    ).rejects.toThrow(/connected account/);
  });

  it('pooled mode: platform keeps the funds (no transfer_data, no application fee)', async () => {
    const { provider, mocks } = make();
    await provider.createTipIntent({ guideId: 'g', tipId: 't3', destinationAccountId: 'acct_g', amountMinor: 1000, currency: 'EUR', feeMinor: 50, fundsModel: 'platform_pooled' });
    const [params] = mocks.piCreate.mock.calls[0]!;
    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
    expect(params.transfer_group).toBe('tip_t3');
  });

  it('transfers with the idempotency key and sets monthly payout schedule', async () => {
    const { provider, mocks } = make();
    expect(await provider.transferToGuide({ guideId: 'g', destinationAccountId: 'acct_g', amountMinor: 5000, currency: 'EUR', idempotencyKey: 'payout:g:2026-09' })).toEqual({ id: 'tr_1' });
    expect(mocks.trCreate.mock.calls[0]![1]).toEqual({ idempotencyKey: 'payout:g:2026-09' });
    await provider.setPayoutSchedule('acct_g', { interval: 'monthly', anchor: 1 });
    expect(mocks.accountsUpdate).toHaveBeenCalledWith('acct_g', { settings: { payouts: { schedule: { interval: 'monthly', monthly_anchor: 1 } } } });
  });

  it('verifies webhook signatures (either endpoint secret) and maps events', () => {
    const { provider, client } = make();
    const evt = { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 1000, amount_received: 1000, currency: 'eur', metadata: { tipId: 'tip-1' } } } };
    const a = signed(client, evt);
    expect(provider.verifyWebhook(a.rawBody, a.signature)).toEqual({ id: 'evt_1', type: 'payment.succeeded', paymentId: 'pi_1', tipId: 'tip-1', amountMinor: 1000, currency: 'eur' });
    const b = signed(client, evt, whsecConnect);
    expect(provider.verifyWebhook(b.rawBody, b.signature).type).toBe('payment.succeeded');
    const bad = signed(client, evt, 'whsec_wrong');
    expect(() => provider.verifyWebhook(bad.rawBody, bad.signature)).toThrow(WebhookSignatureError);
    expect(() => provider.verifyWebhook(a.rawBody, null)).toThrow(WebhookSignatureError);
    expect(() => provider.verifyWebhook(a.rawBody + ' ', a.signature)).toThrow(WebhookSignatureError);
  });

  it('reads the processor fee from the balance transaction', async () => {
    const { provider, mocks } = make();
    mocks.piRetrieve.mockResolvedValue({ currency: 'eur', latest_charge: { balance_transaction: { fee: 40, currency: 'eur' } } });
    expect(await provider.fetchProcessorFee('pi_1')).toBe(40);
    mocks.piRetrieve.mockResolvedValue({ currency: 'eur', latest_charge: 'ch_1' });
    expect(await provider.fetchProcessorFee('pi_1')).toBeNull();
  });
});

describe('mapStripeEvent', () => {
  const ev = (type: string, object: object, extra: object = {}) => ({ id: 'evt_x', type, data: { object }, ...extra }) as unknown as Stripe.Event;

  it('maps failures, refunds, accounts and payouts; ignores everything else', () => {
    expect(mapStripeEvent(ev('payment_intent.payment_failed', { id: 'pi_1', metadata: { tipId: 't' } }))).toEqual({ id: 'evt_x', type: 'payment.failed', paymentId: 'pi_1', tipId: 't' });
    expect(mapStripeEvent(ev('charge.refunded', { payment_intent: 'pi_1', amount_refunded: 1000, currency: 'eur' }))).toEqual({ id: 'evt_x', type: 'charge.refunded', paymentId: 'pi_1', amountRefundedMinor: 1000, currency: 'eur' });
    expect(mapStripeEvent(ev('charge.refunded', { payment_intent: null }))).toEqual({ id: 'evt_x', type: 'ignored' });
    expect(mapStripeEvent(ev('account.updated', { id: 'acct_1', payouts_enabled: true, details_submitted: true }))).toEqual({ id: 'evt_x', type: 'account.updated', accountId: 'acct_1', payoutsEnabled: true, detailsSubmitted: true });
    expect(mapStripeEvent(ev('payout.paid', { id: 'po_1', amount: 5000, currency: 'eur' }, { account: 'acct_1' }))).toEqual({ id: 'evt_x', type: 'payout.paid', accountId: 'acct_1', payoutId: 'po_1', amountMinor: 5000, currency: 'eur' });
    expect(mapStripeEvent(ev('payout.failed', { id: 'po_1', amount: 5000, currency: 'eur', failure_message: 'closed' }, { account: 'acct_1' }))).toMatchObject({ type: 'payout.failed', reason: 'closed' });
    expect(mapStripeEvent(ev('payout.paid', { id: 'po_1', amount: 1, currency: 'eur' }))).toEqual({ id: 'evt_x', type: 'ignored' });
    expect(mapStripeEvent(ev('customer.created', {}))).toEqual({ id: 'evt_x', type: 'ignored' });
  });
});
