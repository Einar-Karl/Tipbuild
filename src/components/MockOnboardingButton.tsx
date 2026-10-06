'use client';

import { useState } from 'react';

export function MockOnboardingButton({ account }: { account: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch('/api/mock/onboarding', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account }),
        });
        if (res.ok) window.location.href = '/dashboard?onboarding=return';
        else setBusy(false);
      }}
    >
      Complete (mock)
    </button>
  );
}
