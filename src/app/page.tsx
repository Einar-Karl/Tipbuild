import Link from 'next/link';
import { getMessages } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { m } = await getMessages();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-5xl font-bold">Tip</h1>
      <p className="text-lg text-muted">Digital tipping for tour guides. Scan, tip, done. No app, no login.</p>
      <div>
        <Link href="/login" className="btn">
          {m.common.signIn}
        </Link>
      </div>
    </main>
  );
}
