import type { Metadata } from 'next';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tours } from '@/db/schema';
import { getEnv } from '@/env';
import { Avatar } from '@/components/Avatar';
import { LangSwitch } from '@/components/LangSwitch';
import { TipForm } from '@/components/TipForm';
import { getConfig } from '@/lib/config';
import { fmt } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/server';
import { findGuideBySlug } from '@/lib/tips';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tip your guide', robots: { index: false } };

export default async function TipPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { locale, m } = await getMessages();
  const db = await getDb();
  const cfg = getConfig();
  const env = getEnv();
  const found = await findGuideBySlug(db, slug, cfg);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex justify-end">
        <LangSwitch locale={locale} />
      </header>

      {!found ? (
        <section className="card text-center">
          <h1 className="text-2xl font-bold">{m.tip.notFound}</h1>
          <p className="mt-2 text-muted">{m.tip.notFoundHelp}</p>
        </section>
      ) : found.guide.payoutStatus !== 'active' ? (
        <section className="card flex flex-col items-center gap-3 text-center">
          <Avatar name={found.guide.displayName} url={found.guide.avatarUrl} />
          <h1 className="text-2xl font-bold">{m.tip.notReady}</h1>
          <p className="text-muted">{m.tip.notReadyHelp}</p>
        </section>
      ) : (
        <TipSection slug={slug} found={found} />
      )}

      <footer className="mt-auto pt-6 text-center text-xs text-muted">
        <p>{m.common.poweredBy}</p>
        <p className="mt-1 space-x-3">
          <a className="underline" href="/legal/privacy">
            {m.common.privacy}
          </a>
          <a className="underline" href="/legal/terms">
            {m.common.terms}
          </a>
        </p>
      </footer>
    </main>
  );

  async function TipSection({ found: f, slug: s }: { found: NonNullable<typeof found>; slug: string }) {
    const guideTours = await db
      .select({ id: tours.id, title: tours.title })
      .from(tours)
      .where(and(eq(tours.guideId, f.guide.id), eq(tours.active, true)));
    return (
      <>
        <section className="flex flex-col items-center gap-3 text-center">
          <Avatar name={f.guide.displayName} url={f.guide.avatarUrl} size={88} />
          <h1 className="text-3xl font-bold">{fmt(m.tip.heading, { name: f.guide.displayName })}</h1>
          {guideTours.length === 1 && <p className="text-muted">{guideTours[0]!.title}</p>}
        </section>
        <section className="card">
          <TipForm
            slug={s}
            guideName={f.guide.displayName}
            tours={guideTours}
            feeBps={f.feeBps}
            currency={cfg.currency}
            iskPerEur={env.ISK_PER_EUR}
            provider={env.PAYMENT_PROVIDER}
            publishableKey={env.STRIPE_PUBLISHABLE_KEY ?? null}
            m={{ tip: m.tip }}
          />
        </section>
      </>
    );
  }
}
