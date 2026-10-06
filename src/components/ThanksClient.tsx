'use client';

import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { fmt, type Messages } from '@/lib/i18n';
import type { PublicTip } from '@/lib/tips';

export function ThanksClient({ initial, slug, m }: { initial: PublicTip; slug: string; m: Pick<Messages, 'thanks'> }) {
  const [tip, setTip] = useState(initial);
  const [rating, setRating] = useState<number | null>(initial.rating);
  const [text, setText] = useState('');
  const [reviewUrl, setReviewUrl] = useState<string | null>(initial.rating && initial.rating >= 4 ? initial.reviewUrl : null);
  const [done, setDone] = useState(initial.rating !== null && (initial.rating >= 4 || initial.hasFeedback));
  const [busy, setBusy] = useState(false);

  // The webhook may arrive a moment after the redirect: poll until the payment is final.
  useEffect(() => {
    if (tip.status !== 'pending') return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/tips/${tip.id}`, { cache: 'no-store' });
        if (res.ok) setTip((await res.json()) as PublicTip);
      } catch {
        /* keep polling */
      }
      if (tries > 40) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [tip.id, tip.status]);

  async function submitRating(r: number, feedback?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tips/${tip.id}/rating`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: r, text: feedback }),
      });
      if (res.ok) {
        const data = (await res.json()) as { reviewUrl: string | null };
        setRating(r);
        setReviewUrl(data.reviewUrl);
        if (r >= 4 || feedback) setDone(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (tip.status === 'failed')
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-3xl font-bold">{m.thanks.failed}</h1>
        <a className="btn" href={`/t/${slug}`}>
          {m.thanks.tryAgain}
        </a>
      </div>
    );

  if (tip.status === 'pending')
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center" role="status">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" aria-hidden />
        <p className="text-lg">{m.thanks.confirming}</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{m.thanks.heading}</h1>
        <p className="mt-2 text-lg" data-testid="thanks-body">
          {fmt(m.thanks.body, { amount: formatMoney(tip.amountMinor, tip.currency), name: tip.guideName })}
        </p>
      </div>

      <section className="card" aria-labelledby="rate-h">
        <h2 id="rate-h" className="text-xl font-semibold">
          {m.thanks.rate}
        </h2>
        <div className="mt-3 flex justify-between gap-1" role="group" aria-label={m.thanks.rate}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy || rating !== null}
              aria-label={fmt(m.thanks.stars, { n })}
              aria-pressed={rating !== null && n <= rating}
              onClick={() => void submitRating(n)}
              className={`min-h-[52px] min-w-[52px] flex-1 rounded-xl text-3xl transition ${
                rating !== null && n <= rating ? 'text-accent' : 'text-line'
              }`}
            >
              ★
            </button>
          ))}
        </div>

        {rating !== null && rating <= 3 && !done && (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitRating(rating, text);
            }}
          >
            <label htmlFor="fb" className="label">
              {m.thanks.feedbackPrompt}
            </label>
            <textarea id="fb" className="input min-h-[96px]" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn" disabled={busy || !text.trim()}>
              {m.thanks.submit}
            </button>
          </form>
        )}

        {rating !== null && rating >= 4 && reviewUrl && (
          <div className="mt-4 flex flex-col gap-3">
            <p>{m.thanks.reviewPrompt}</p>
            <a className="btn" href={reviewUrl} target="_blank" rel="noopener noreferrer">
              {m.thanks.reviewCta}
            </a>
          </div>
        )}

        {done && (
          <p className="mt-4 text-ok" role="status">
            {m.thanks.rated}
          </p>
        )}
      </section>
    </div>
  );
}
