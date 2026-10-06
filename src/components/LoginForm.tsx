'use client';

import { useState } from 'react';
import type { Messages } from '@/lib/i18n';

export function LoginForm({ m }: { m: Pick<Messages, 'auth'> }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { devLink?: string };
      setDevLink(data.devLink ?? null);
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="label">
          {m.auth.email}
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button className="btn" disabled={state === 'busy'}>
        {m.auth.send}
      </button>
      {state === 'sent' && (
        <div role="status" className="text-ok">
          <p>{m.auth.sent}</p>
          {devLink && (
            <p className="mt-2 text-sm text-muted">
              {m.auth.devLink}:{' '}
              <a data-testid="dev-link" className="break-all underline" href={devLink}>
                {devLink}
              </a>
            </p>
          )}
        </div>
      )}
      {state === 'error' && (
        <p role="alert" className="text-danger">
          Error
        </p>
      )}
    </form>
  );
}
