import Link from 'next/link';
import { getMessages } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm sign in', robots: { index: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const { m } = await getMessages();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      {token && !error ? (
        <form method="post" action="/api/auth/verify" className="card flex flex-col gap-4">
          <h1 className="text-2xl font-bold">{m.auth.confirmTitle}</h1>
          <p className="text-muted">{m.auth.confirmBody}</p>
          <input type="hidden" name="token" value={token} />
          <button className="btn">{m.auth.confirmCta}</button>
        </form>
      ) : (
        <div className="card flex flex-col gap-4">
          <h1 className="text-2xl font-bold">{m.auth.invalidLink}</h1>
          <Link className="btn" href="/login">
            {m.auth.requestNew}
          </Link>
        </div>
      )}
    </main>
  );
}
