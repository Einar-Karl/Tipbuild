'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { eurToIskHint, formatMoney, MAX_TIP_MINOR, MIN_TIP_MINOR, parseMajorToMinor, splitTip } from '@/lib/money';
import { fmt, type Messages } from '@/lib/i18n';

const StripePayment = dynamic(() => import('./StripePayment'), { ssr: false });

const PRESETS = [500, 1000, 2000];

interface Props {
  slug: string;
  guideName: string;
  tours: { id: string; title: string }[];
  feeBps: number;
  currency: string;
  iskPerEur: number;
  provider: 'mock' | 'stripe';
  publishableKey: string | null;
  m: Pick<Messages, 'tip'>;
}

export function TipForm({ slug, guideName, tours, feeBps, currency, iskPerEur, provider, publishableKey, m }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState<number | 'custom'>(1000);
  const [customText, setCustomText] = useState('');
  const [coverFee, setCoverFee] = useState(false);
  const [tourId, setTourId] = useState<string>(tours.length === 1 ? tours[0]!.id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripe, setStripe] = useState<{ clientSecret: string; tipId: string } | null>(null);

  const tipMinor = preset === 'custom' ? parseMajorToMinor(customText) : preset;
  const valid = tipMinor !== null && tipMinor >= MIN_TIP_MINOR && tipMinor <= MAX_TIP_MINOR;
  const split = useMemo(() => (valid ? splitTip(tipMinor, feeBps, coverFee) : null), [valid, tipMinor, feeBps, coverFee]);
  const pct = `${(feeBps / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;

  async function pay() {
    if (!split || tipMinor === null) {
      setError(m.tip.invalidAmount);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tips/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, amountMinor: tipMinor, currency, coverFee, tourId: tourId || null }),
      });
      if (!res.ok) throw new Error('intent');
      const created = (await res.json()) as { tipId: string; clientSecret: string };
      if (provider === 'mock') {
        const paid = await fetch('/api/mock/pay', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tipId: created.tipId }),
        });
        if (!paid.ok) throw new Error('pay');
        router.push(`/t/${slug}/thanks?tip=${created.tipId}`);
      } else {
        setStripe({ clientSecret: created.clientSecret, tipId: created.tipId });
      }
    } catch {
      setError(m.tip.payFailed);
    } finally {
      setBusy(false);
    }
  }

  if (stripe && publishableKey && split) {
    return (
      <StripePayment
        publishableKey={publishableKey}
        clientSecret={stripe.clientSecret}
        returnUrl={`${window.location.origin}/t/${slug}/thanks?tip=${stripe.tipId}`}
        label={fmt(m.tip.pay, { amount: formatMoney(split.amountMinor, currency) })}
        processingLabel={m.tip.processing}
        errorLabel={m.tip.payFailed}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void pay();
      }}
    >
      {tours.length > 1 && (
        <div>
          <label htmlFor="tour" className="label">
            {m.tip.tourLabel}
          </label>
          <select id="tour" className="input" value={tourId} onChange={(e) => setTourId(e.target.value)}>
            <option value="">–</option>
            {tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset>
        <legend className="label">{m.tip.chooseAmount}</legend>
        <div className="grid grid-cols-3 gap-3">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => setPreset(p)}
              className={`min-h-[56px] rounded-xl border-2 text-lg font-semibold transition ${
                preset === p ? 'border-accent bg-accent/15' : 'border-line bg-surface'
              }`}
            >
              {formatMoney(p, currency).replace(',00', '')}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={preset === 'custom'}
          onClick={() => setPreset('custom')}
          className={`mt-3 min-h-[48px] w-full rounded-xl border-2 px-4 text-left font-medium ${
            preset === 'custom' ? 'border-accent bg-accent/15' : 'border-line bg-surface'
          }`}
        >
          {m.tip.custom}
        </button>
        {preset === 'custom' && (
          <div className="mt-3">
            <label htmlFor="custom" className="sr-only">
              {m.tip.custom}
            </label>
            <input
              id="custom"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder={m.tip.customPlaceholder}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              aria-invalid={customText !== '' && !valid}
              aria-describedby="range"
              autoFocus
            />
            <p id="range" className="mt-1 text-sm text-muted">
              {fmt(m.tip.range, { min: formatMoney(MIN_TIP_MINOR, currency), max: formatMoney(MAX_TIP_MINOR, currency) })}
            </p>
          </div>
        )}
      </fieldset>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 accent-[rgb(var(--accent))]"
          checked={coverFee}
          onChange={(e) => setCoverFee(e.target.checked)}
        />
        <span>{fmt(m.tip.coverFee, { name: guideName })}</span>
      </label>

      <div className="rounded-xl bg-basalt/10 p-4 text-sm" aria-live="polite">
        {split ? (
          <>
            <p>
              {coverFee
                ? fmt(m.tip.breakdownCovered, {
                    name: guideName,
                    total: formatMoney(split.amountMinor, currency),
                    net: formatMoney(split.netMinor, currency),
                    pct,
                    fee: formatMoney(split.feeMinor, currency),
                  })
                : fmt(m.tip.breakdown, { name: guideName, net: formatMoney(split.netMinor, currency), pct })}
            </p>
            {currency === 'EUR' && (
              <p className="mt-1 text-muted">
                {fmt(m.tip.iskHint, { isk: formatMoney(eurToIskHint(split.amountMinor, iskPerEur), 'ISK') })}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted">{m.tip.invalidAmount}</p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      <button type="submit" className="btn w-full text-lg" disabled={busy || !split}>
        {busy
          ? m.tip.processing
          : split
            ? fmt(provider === 'mock' ? m.tip.payTest : m.tip.pay, { amount: formatMoney(split.amountMinor, currency) })
            : m.tip.invalidAmount}
      </button>
      <p className="text-center text-xs text-muted">{m.tip.secure}</p>
    </form>
  );
}
