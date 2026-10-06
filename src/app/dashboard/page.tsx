import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { tours } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getEnv } from '@/env';
import { Avatar } from '@/components/Avatar';
import { LangSwitch } from '@/components/LangSwitch';
import { CopyButton, DataPanel, PayoutSetup, ProfileSetup, SignOutButton, ToursPanel } from '@/components/dashboard/Client';
import { getConfig } from '@/lib/config';
import { formatDate, formatDateTime } from '@/lib/format';
import { guideStats, listGuidePayouts, listGuideTips } from '@/lib/guides';
import { fmt } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/server';
import { formatMoney } from '@/lib/money';
import { tipUrl } from '@/lib/qr';
import { getGuideFor, getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard', robots: { index: false } };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role === 'admin') redirect('/admin');
  const { locale, m } = await getMessages();
  const db = await getDb();
  const guide = await getGuideFor(user.id);
  const cm = { dash: m.dash, common: m.common };

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <LangSwitch locale={locale} />
      <SignOutButton m={cm} />
    </header>
  );

  if (!guide)
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-6">
        {header}
        <ProfileSetup m={cm} />
      </main>
    );

  const cfg = getConfig();
  const page = Math.max(Number((await searchParams).page ?? 1) || 1, 1);
  const PAGE = 25;
  const [stats, history, payouts, tourRows] = await Promise.all([
    guideStats(db, guide),
    listGuideTips(db, guide.id, PAGE + 1, (page - 1) * PAGE),
    listGuidePayouts(db, guide.id),
    db.select().from(tours).where(eq(tours.guideId, guide.id)),
  ]);
  const hasMore = history.length > PAGE;
  const rows = history.slice(0, PAGE);
  const link = tipUrl(getEnv().APP_URL, guide.slug, 'nfc');
  const cur = guide.defaultCurrency;
  const statusLabel = { active: m.dash.statusActive, pending: m.dash.statusPending, restricted: m.dash.statusRestricted }[guide.payoutStatus];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-6">
      {header}
      <section className="flex items-center gap-4">
        <Avatar name={guide.displayName} url={guide.avatarUrl} size={64} />
        <div>
          <h1 className="text-3xl font-bold">{fmt(m.dash.welcome, { name: guide.displayName })}</h1>
          <p className={`text-sm font-medium ${guide.payoutStatus === 'active' ? 'text-ok' : 'text-danger'}`}>{statusLabel}</p>
        </div>
      </section>

      {guide.payoutStatus !== 'active' && <PayoutSetup m={cm} restricted={guide.payoutStatus === 'restricted'} />}

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Summary">
        <div className="card">
          <p className="text-sm text-muted">{m.dash.balanceOwed}</p>
          <p className="mt-1 text-3xl font-bold" data-testid="balance">
            {formatMoney(stats.balanceMinor, cur)}
          </p>
          <p className="mt-1 text-xs text-muted">{fmt(m.dash.paidMonthly, { min: formatMoney(cfg.minPayoutMinor, cur) })}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">{m.dash.tipsThisMonth}</p>
          <p className="mt-1 text-3xl font-bold" data-testid="month-tips">
            {stats.monthTipCount}
          </p>
          <p className="mt-1 text-xs text-muted">{formatMoney(stats.monthNetMinor, cur)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-muted">{m.dash.avgRating}</p>
          <p className="mt-1 text-3xl font-bold">{stats.avgRating ? `${stats.avgRating.toFixed(1).replace('.', ',')} ★` : '–'}</p>
          <p className="mt-1 text-xs text-muted">{stats.ratingCount}</p>
        </div>
      </section>

      <section className="card flex flex-col gap-4 sm:flex-row" aria-labelledby="qr-h">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/me/qr.svg" alt="QR" width={180} height={180} className="h-[180px] w-[180px] rounded-xl border border-line bg-white" />
        <div className="flex flex-col gap-3">
          <h2 id="qr-h" className="text-xl font-bold">
            {m.dash.qrTitle}
          </h2>
          <p className="text-muted">{m.dash.qrBody}</p>
          <div className="flex flex-wrap gap-3">
            <a className="btn-ghost" href="/api/me/qr.svg" download={`tip-${guide.slug}.svg`}>
              {m.dash.downloadSvg}
            </a>
            <a className="btn-ghost" href="/api/me/qr.png">
              {m.dash.downloadPng}
            </a>
          </div>
          <div>
            <p className="label">{m.dash.nfcLink}</p>
            <div className="flex items-center gap-2">
              <code className="break-all rounded-lg bg-basalt/10 px-2 py-1 text-sm" data-testid="nfc-link">
                {link}
              </code>
              <CopyButton value={link} m={cm} />
            </div>
          </div>
        </div>
      </section>

      <ToursPanel tours={tourRows.map((t) => ({ id: t.id, title: t.title, active: t.active }))} m={cm} />

      <section aria-labelledby="hist-h" className="flex flex-col gap-3">
        <h2 id="hist-h" className="text-xl font-bold">
          {m.dash.history}
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted">{m.dash.noTips}</p>
        ) : (
          <div className="table-wrap" role="region" aria-label="Tip history" tabIndex={0}>
            <table className="table" data-testid="tips-table">
              <thead>
                <tr>
                  <th>{m.dash.date}</th>
                  <th>{m.dash.tour}</th>
                  <th className="text-right">{m.dash.gross}</th>
                  <th className="text-right">{m.dash.fee}</th>
                  <th className="text-right">{m.dash.net}</th>
                  <th>{m.dash.rating}</th>
                  <th>{m.dash.status}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.createdAt)}</td>
                    <td>{t.tourTitle ?? '–'}</td>
                    <td className="text-right">{formatMoney(t.amountMinor, t.currency)}</td>
                    <td className="text-right">{formatMoney(t.feeMinor, t.currency)}</td>
                    <td className="text-right font-medium">{formatMoney(t.netMinor, t.currency)}</td>
                    <td>{t.rating ? `${t.rating} ★` : '–'}</td>
                    <td>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav className="flex gap-3" aria-label="Pagination">
          {page > 1 && (
            <a className="btn-ghost" href={`/dashboard?page=${page - 1}`}>
              ←
            </a>
          )}
          {hasMore && (
            <a className="btn-ghost" href={`/dashboard?page=${page + 1}`}>
              →
            </a>
          )}
        </nav>
      </section>

      <section aria-labelledby="pay-h" className="flex flex-col gap-3">
        <h2 id="pay-h" className="text-xl font-bold">
          {m.dash.payouts}
        </h2>
        {payouts.length === 0 ? (
          <p className="text-muted">{m.dash.noPayouts}</p>
        ) : (
          <div className="table-wrap" role="region" aria-label="Payouts" tabIndex={0}>
            <table className="table" data-testid="payouts-table">
              <thead>
                <tr>
                  <th>{m.dash.period}</th>
                  <th className="text-right">{m.dash.amount}</th>
                  <th>{m.dash.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                    </td>
                    <td className="text-right">{formatMoney(p.amountMinor, p.currency)}</td>
                    <td>{p.status}</td>
                    <td className="space-x-3 whitespace-nowrap">
                      <a className="underline" href={`/api/me/payouts/${p.id}/statement.csv`}>
                        {m.dash.statementCsv}
                      </a>
                      <a className="underline" href={`/api/me/payouts/${p.id}/statement.pdf`}>
                        {m.dash.statementPdf}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DataPanel m={cm} />
    </main>
  );
}
