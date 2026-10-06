import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { guides } from '@/db/schema';
import { audit } from '@/lib/audit';
import { api, json, limit } from '@/lib/http';
import { getProvider } from '@/lib/provider';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  limit(req, 'onboarding-link', 10, 60_000);
  const { user, guide } = await requireGuide(req);
  const db = await getDb();
  const { url, accountId } = await getProvider().createOnboardingLink({
    id: guide.id,
    displayName: guide.displayName,
    email: user.email,
    payoutAccountId: guide.payoutAccountId,
  });
  if (accountId !== guide.payoutAccountId) {
    await db.update(guides).set({ payoutAccountId: accountId }).where(eq(guides.id, guide.id));
    await audit(db, { actor: `user:${user.id}`, action: 'guide.payout_account_created', entity: 'guide', entityId: guide.id });
  }
  return json({ url });
});
