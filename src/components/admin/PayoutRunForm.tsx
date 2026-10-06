'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PayoutRunForm({ defaultPeriod }: { defaultPeriod: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(defaultPeriod);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <form
      className="card flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!window.confirm(`Run the payout job for ${period}? It is idempotent: guides already handled are skipped.`)) return;
        setBusy(true);
        const res = await fetch('/api/admin/payout-run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ period }),
        });
        const data = (await res.json()) as { counts?: Record<string, number>; error?: string };
        setResult(res.ok ? JSON.stringify(data.counts) : (data.error ?? 'error'));
        setBusy(false);
        router.refresh();
      }}
    >
      <h2 className="text-xl font-bold">Run payout job manually</h2>
      <div className="flex gap-3">
        <label htmlFor="period" className="sr-only">
          Period (YYYY-MM)
        </label>
        <input id="period" className="input max-w-[12rem]" pattern="\d{4}-(0[1-9]|1[0-2])" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <button className="btn" disabled={busy}>
          Run
        </button>
      </div>
      {result && (
        <p role="status" data-testid="run-result" className="text-sm">
          {result}
        </p>
      )}
    </form>
  );
}
