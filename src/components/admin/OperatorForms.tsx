'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok ? null : ((await res.json()) as { error?: string }).error ?? 'error';
}

export function OperatorForm({ op }: { op?: { id: string; name: string; feeBpsOverride: number | null; reviewUrl: string | null } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card grid gap-3 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const fee = String(f.get('fee') ?? '').trim();
        const body = {
          name: f.get('name'),
          feeBpsOverride: fee === '' ? null : Number(fee),
          reviewUrl: String(f.get('reviewUrl') ?? '') || null,
        };
        const err = await send(op ? `/api/admin/operators/${op.id}` : '/api/admin/operators', op ? 'PATCH' : 'POST', body);
        setError(err);
        if (!err) {
          if (!op) e.currentTarget.reset();
          router.refresh();
        }
      }}
    >
      <div>
        <label className="label" htmlFor={`n-${op?.id ?? 'new'}`}>
          Name
        </label>
        <input id={`n-${op?.id ?? 'new'}`} name="name" className="input" required defaultValue={op?.name} />
      </div>
      <div>
        <label className="label" htmlFor={`f-${op?.id ?? 'new'}`}>
          Fee override (bps)
        </label>
        <input id={`f-${op?.id ?? 'new'}`} name="fee" inputMode="numeric" className="input" placeholder="default" defaultValue={op?.feeBpsOverride ?? ''} />
      </div>
      <div>
        <label className="label" htmlFor={`r-${op?.id ?? 'new'}`}>
          Review URL
        </label>
        <input id={`r-${op?.id ?? 'new'}`} name="reviewUrl" type="url" className="input" placeholder="https://" defaultValue={op?.reviewUrl ?? ''} />
      </div>
      <div className="flex items-end">
        <button className="btn w-full">{op ? 'Save' : 'Add operator'}</button>
      </div>
      {error && (
        <p role="alert" className="text-danger sm:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}

export function GuideOperatorSelect({ guideId, operatorId, operators }: { guideId: string; operatorId: string | null; operators: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <select
      aria-label="Operator"
      className="input min-h-[40px] py-1"
      defaultValue={operatorId ?? ''}
      onChange={async (e) => {
        await send(`/api/admin/guides/${guideId}`, 'PATCH', { operatorId: e.target.value || null });
        router.refresh();
      }}
    >
      <option value="">–</option>
      {operators.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
