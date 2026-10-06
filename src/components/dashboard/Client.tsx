'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Messages } from '@/lib/i18n';

type M = Pick<Messages, 'dash' | 'common'>;

async function call(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function SignOutButton({ m }: { m: M }) {
  return (
    <button
      className="btn-ghost"
      onClick={async () => {
        await call('/api/auth/logout', 'POST');
        window.location.href = '/';
      }}
    >
      {m.common.signOut}
    </button>
  );
}

export function ProfileSetup({ m }: { m: M }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const f = new FormData(e.currentTarget);
        const res = await call('/api/me/guide', 'POST', {
          displayName: f.get('displayName'),
          tourTitle: f.get('tourTitle'),
          avatarUrl: f.get('avatarUrl') || null,
        });
        setBusy(false);
        if (res.ok) router.refresh();
        else setError(m.common.error);
      }}
    >
      <h2 className="text-2xl font-bold">{m.dash.setupTitle}</h2>
      <p className="text-muted">{m.dash.setupIntro}</p>
      <div>
        <label className="label" htmlFor="displayName">
          {m.dash.displayName}
        </label>
        <input id="displayName" name="displayName" className="input" required minLength={2} maxLength={60} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="tourTitle">
          {m.dash.tourTitle}
        </label>
        <input id="tourTitle" name="tourTitle" className="input" required minLength={2} maxLength={80} placeholder={m.dash.tourTitlePlaceholder} />
      </div>
      <div>
        <label className="label" htmlFor="avatarUrl">
          {m.dash.avatarUrl}
        </label>
        <input id="avatarUrl" name="avatarUrl" type="url" className="input" placeholder="https://" />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {m.dash.createProfile}
      </button>
    </form>
  );
}

export function PayoutSetup({ m, restricted }: { m: M; restricted: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card flex flex-col gap-3 border-accent" aria-labelledby="payout-h">
      <h2 id="payout-h" className="text-xl font-bold">
        {m.dash.onboardingTitle}
      </h2>
      <p className="text-muted">{restricted ? m.dash.onboardingRestricted : m.dash.onboardingBody}</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await call('/api/me/onboarding-link', 'POST');
          if (res.ok) window.location.href = ((await res.json()) as { url: string }).url;
          else {
            setError(m.common.error);
            setBusy(false);
          }
        }}
      >
        {restricted ? m.dash.onboardingContinue : m.dash.onboardingCta}
      </button>
    </section>
  );
}

export function CopyButton({ value, m }: { value: string; m: M }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? m.dash.copied : m.dash.copy}
    </button>
  );
}

export function ToursPanel({ tours, m }: { tours: { id: string; title: string; active: boolean }[]; m: M }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="tours-h">
      <h2 id="tours-h" className="text-xl font-bold">
        {m.dash.tours}
      </h2>
      <ul className="flex flex-col gap-2">
        {tours.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3">
            <span className={t.active ? '' : 'text-muted line-through'}>{t.title}</span>
            <button
              className="btn-ghost"
              onClick={async () => {
                await call(`/api/me/tours/${t.id}`, 'PATCH', { active: !t.active });
                router.refresh();
              }}
            >
              {t.active ? m.dash.active : m.dash.inactive}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim().length < 2) return;
          await call('/api/me/tours', 'POST', { title });
          setTitle('');
          router.refresh();
        }}
      >
        <label htmlFor="newTour" className="sr-only">
          {m.dash.tourTitle}
        </label>
        <input id="newTour" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.dash.tourTitlePlaceholder} />
        <button className="btn-ghost shrink-0">{m.dash.addTour}</button>
      </form>
    </section>
  );
}

export function DataPanel({ m }: { m: M }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card flex flex-col gap-3" aria-labelledby="data-h">
      <h2 id="data-h" className="text-xl font-bold">
        {m.dash.privacyTitle}
      </h2>
      <div className="flex flex-wrap gap-3">
        <a className="btn-ghost" href="/api/me/export">
          {m.dash.exportData}
        </a>
        <button
          className="btn-ghost text-danger"
          onClick={async () => {
            if (!window.confirm(m.dash.deleteConfirm)) return;
            const res = await call('/api/me/guide', 'DELETE');
            if (res.ok) window.location.href = '/';
            else setError(((await res.json()) as { message?: string }).message ?? m.common.error);
          }}
        >
          {m.dash.deleteAccount}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
