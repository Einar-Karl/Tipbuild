import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/dashboard/Client';
import { messagesFor } from '@/lib/i18n';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false } };

const NAV = [
  ['/admin', 'Overview'],
  ['/admin/payouts', 'Payouts'],
  ['/admin/reconciliation', 'Reconciliation'],
  ['/admin/float', 'Float'],
  ['/admin/operators', 'Operators'],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin')
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">403</h1>
        <p className="mt-2 text-muted">Admins only.</p>
        <Link className="btn mt-6" href="/dashboard">
          Dashboard
        </Link>
      </main>
    );
  const m = messagesFor('en');
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Admin" className="flex flex-wrap gap-2">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="btn-ghost">
              {label}
            </Link>
          ))}
        </nav>
        <SignOutButton m={{ dash: m.dash, common: m.common }} />
      </header>
      {children}
    </div>
  );
}
