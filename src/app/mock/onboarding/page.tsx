import { notFound, redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { MockOnboardingButton } from '@/components/MockOnboardingButton';
import { getGuideFor, getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MockOnboarding({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  if (getEnv().PAYMENT_PROVIDER !== 'mock') notFound();
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const guide = await getGuideFor(user.id);
  const { account } = await searchParams;
  if (!guide || !account || guide.payoutAccountId !== account) notFound();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <div className="card flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Mock payment provider</p>
        <h1 className="text-2xl font-bold">Verify identity and bank account</h1>
        <p className="text-muted">
          Demo mode: in production this is the payment partner&apos;s hosted KYC page (ID check, IBAN). Nothing real is collected here.
        </p>
        <MockOnboardingButton account={account} />
      </div>
    </main>
  );
}
