import Link from 'next/link';
import { getMessages } from '@/lib/i18n/server';

export default async function NotFound() {
  const { m } = await getMessages();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted">{m.tip.notFoundHelp}</p>
      <Link className="btn" href="/">
        {m.common.back}
      </Link>
    </main>
  );
}
