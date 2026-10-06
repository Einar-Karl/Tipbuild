import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { loginTokens, tips, webhookEvents } from '@/db/schema';

/**
 * Data retention. Financial records (tips, ledger, payouts, audit log) are kept for accounting law;
 * free-text feedback and technical records are not.
 */
export async function runRetention(db: Db, opts: { now?: Date; retentionMonths: number }) {
  const now = opts.now ?? new Date();
  const feedbackCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - opts.retentionMonths, now.getUTCDate()));
  const day = 86_400_000;
  const feedback = await db
    .update(tips)
    .set({ reviewText: null })
    .where(and(isNotNull(tips.reviewText), lt(tips.createdAt, feedbackCutoff)))
    .returning({ id: tips.id });
  const tokens = await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date(now.getTime() - 7 * day))).returning({ id: loginTokens.id });
  const hooks = await db
    .delete(webhookEvents)
    .where(and(eq(webhookEvents.status, 'processed'), lt(webhookEvents.receivedAt, new Date(now.getTime() - 90 * day))))
    .returning({ id: webhookEvents.eventId });
  return { feedbackCleared: feedback.length, loginTokensDeleted: tokens.length, webhookEventsDeleted: hooks.length };
}
