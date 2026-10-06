import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { LangSwitch } from '@/components/LangSwitch';
import { ThanksClient } from '@/components/ThanksClient';
import { getMessages } from '@/lib/i18n/server';
import { getPublicTip } from '@/lib/tips';

export const dynamic = 'force-dynamic';

export default async function Thanks({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tip?: string }>;
}) {
  const { slug } = await params;
  const { tip: tipId } = await searchParams;
  const { locale, m } = await getMessages();
  const tip = tipId ? await getPublicTip(await getDb(), tipId) : null;
  if (!tip) notFound();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex justify-end">
        <LangSwitch locale={locale} />
      </header>
      <ThanksClient initial={tip} slug={slug} m={{ thanks: m.thanks }} />
    </main>
  );
}
