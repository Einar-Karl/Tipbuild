import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, loginTokens, tips, users } from '@/db/schema';
import { consumeLoginToken, createLoginToken, LOGIN_TOKEN_TTL_MS } from '@/lib/auth';
import { createGuideProfile, deleteGuideAccount, exportGuideData, guideStats } from '@/lib/guides';
import { postPayout, postTipSucceeded } from '@/lib/ledger';
import { splitTip } from '@/lib/money';
import { makeGuide, testDb } from '../helpers';

let db: Db;
beforeAll(async () => {
  db = await testDb();
});

describe('magic link', () => {
  it('is single-use and creates the user on first sign-in', async () => {
    const token = await createLoginToken(db, 'New.Guide@Example.com');
    const u = await consumeLoginToken(db, token, []);
    expect(u).toMatchObject({ email: 'new.guide@example.com', role: 'guide' });
    expect(await consumeLoginToken(db, token, [])).toBeNull();
  });

  it('expires after 15 minutes and stores only a hash', async () => {
    const now = new Date();
    const token = await createLoginToken(db, 'late@example.com', now);
    const rows = await db.select().from(loginTokens).where(eq(loginTokens.email, 'late@example.com'));
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(await consumeLoginToken(db, token, [], new Date(now.getTime() + LOGIN_TOKEN_TTL_MS + 1000))).toBeNull();
    expect(await consumeLoginToken(db, 'not-a-token', [])).toBeNull();
  });

  it('promotes ADMIN_EMAILS to admin, never anyone else', async () => {
    const a = await consumeLoginToken(db, await createLoginToken(db, 'boss@example.com'), ['boss@example.com']);
    expect(a!.role).toBe('admin');
    const b = await consumeLoginToken(db, await createLoginToken(db, 'rando@example.com'), ['boss@example.com']);
    expect(b!.role).toBe('guide');
  });
});

describe('guide profile', () => {
  it('creates a guide with a unique slug and a first tour; guide starts unpaid-out and pending', async () => {
    const [u] = await db.insert(users).values({ email: 'p1@example.com' }).returning();
    const [u2] = await db.insert(users).values({ email: 'p2@example.com' }).returning();
    const g1 = await createGuideProfile(db, { userId: u!.id, displayName: 'Anna Sigurðardóttir', tourTitle: 'Walk', currency: 'EUR' });
    const g2 = await createGuideProfile(db, { userId: u2!.id, displayName: 'Anna Sigurðardóttir', tourTitle: 'Walk', currency: 'EUR' });
    expect(g1.slug).toBe('anna-sigurdardottir');
    expect(g2.slug).not.toBe(g1.slug);
    expect(g2.slug.startsWith('anna-sigurdardottir-')).toBe(true);
    expect(g1.payoutStatus).toBe('pending');
  });

  it('computes dashboard stats from the ledger and tips', async () => {
    const g = await makeGuide(db);
    for (const amt of [1000, 2000]) {
      const [t] = await db
        .insert(tips)
        .values({ guideId: g.id, currency: 'EUR', ...splitTip(amt, 500), status: 'succeeded', rating: 5, providerPaymentId: `pi_${amt}_${g.id}` })
        .returning();
      await postTipSucceeded(db, t!);
    }
    const s = await guideStats(db, g);
    expect(s).toMatchObject({ balanceMinor: 2850, monthTipCount: 2, monthNetMinor: 2850, avgRating: 5, ratingCount: 2 });
  });

  it('GDPR: exports data, refuses deletion while money is owed, then anonymises', async () => {
    const g = await makeGuide(db);
    const [t] = await db.insert(tips).values({ guideId: g.id, currency: 'EUR', ...splitTip(1000, 500), status: 'succeeded', providerPaymentId: `pi_del_${g.id}` }).returning();
    await postTipSucceeded(db, t!);
    const data = await exportGuideData(db, g, 'x@example.com');
    expect(data.tips).toHaveLength(1);
    expect(data.account.email).toBe('x@example.com');

    await expect(deleteGuideAccount(db, g, g.userId!)).rejects.toMatchObject({ code: 'balance_outstanding' });
    await postPayout(db, { id: crypto.randomUUID(), guideId: g.id, amountMinor: 950, currency: 'EUR' });
    await deleteGuideAccount(db, g, g.userId!);

    const [after] = await db.select().from(guides).where(eq(guides.id, g.id));
    expect(after).toMatchObject({ displayName: 'Former guide', avatarUrl: null, userId: null, payoutStatus: 'restricted' });
    expect(after!.deletedAt).not.toBeNull();
    expect(await db.select().from(users).where(eq(users.id, g.userId!))).toHaveLength(0);
    // financial records survive
    expect(await db.select().from(tips).where(eq(tips.guideId, g.id))).toHaveLength(1);
  });
});
