import './_env';
import { count, eq } from 'drizzle-orm';
import { getDb } from '../src/db';
import { guides, operators, tips, tours, users, type Guide } from '../src/db/schema';
import { getConfig } from '../src/lib/config';
import { postProcessorFee, postTipRefund, postTipSucceeded } from '../src/lib/ledger';
import { mockProcessorFee } from '../src/lib/provider/mock';
import { splitTip } from '../src/lib/money';
import { adminEmails, getEnv } from '../src/env';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const ifEmpty = process.argv.includes('--if-empty');
  const env = getEnv();
  const cfg = getConfig();
  const db = await getDb();

  if (ifEmpty) {
    const [{ n }] = (await db.select({ n: count() }).from(guides)) as [{ n: number }];
    if (n > 0) return;
  }
  console.log('Seeding demo data…');

  const admins = new Set(adminEmails(env));
  if (env.NODE_ENV !== 'production') admins.add('admin@example.com');
  for (const email of admins) await db.insert(users).values({ email, role: 'admin' }).onConflictDoNothing();

  const [op] = await db
    .insert(operators)
    .values({ name: 'Reykjavík Walks', reviewUrl: 'https://www.tripadvisor.com/' })
    .returning();

  const defs = [
    { email: 'anna@example.com', name: 'Anna Sigurðardóttir', slug: 'anna', status: 'active' as const, operator: op!.id, tours: ['Reykjavík Food Walk', 'Old Harbour Evening Tour'], n: 70 },
    { email: 'jon@example.com', name: 'Jón Þórsson', slug: 'jon', status: 'active' as const, operator: null, tours: ['Golden Circle Day Trip'], n: 35 },
    { email: 'maria@example.com', name: 'María López', slug: 'maria', status: 'pending' as const, operator: op!.id, tours: ['Street Art Tour'], n: 0 },
  ];

  const rand = rng(42);
  const now = new Date();
  const DAY = 86_400_000;
  const amounts = [500, 500, 1000, 1000, 1000, 1500, 2000, 2000, 2500, 5000];

  for (const d of defs) {
    const [u] = await db.insert(users).values({ email: d.email, role: 'guide' }).onConflictDoNothing().returning();
    const userId = u?.id ?? (await db.select().from(users).where(eq(users.email, d.email)))[0]!.id;
    const [g] = (await db
      .insert(guides)
      .values({
        userId,
        displayName: d.name,
        slug: d.slug,
        operatorId: d.operator,
        payoutStatus: d.status,
        payoutAccountId: d.status === 'active' ? `mock_acct_${d.slug}` : null,
        defaultCurrency: cfg.currency,
      })
      .returning()) as [Guide];
    const tourRows = await db.insert(tours).values(d.tours.map((title) => ({ guideId: g.id, title }))).returning();

    for (let i = 0; i < d.n; i++) {
      // Spread over the last ~65 days so there is a full previous month plus current-month activity.
      const at = new Date(now.getTime() - Math.floor(rand() * 65 * DAY) - 3600_000);
      const amount = amounts[Math.floor(rand() * amounts.length)]!;
      const split = splitTip(amount, op && d.operator ? (op.feeBpsOverride ?? cfg.feeBps) : cfg.feeBps);
      const rated = rand() < 0.8;
      const rating = rated ? (rand() < 0.75 ? 5 : rand() < 0.6 ? 4 : 3) : null;
      const [tip] = await db
        .insert(tips)
        .values({
          guideId: g.id,
          tourId: tourRows[Math.floor(rand() * tourRows.length)]!.id,
          currency: cfg.currency,
          ...split,
          status: 'succeeded',
          providerPaymentId: `mock_pi_seed_${d.slug}_${i}`,
          rating,
          reviewText: rating === 3 ? 'A bit rushed at the end, but a nice guide.' : null,
          touristCountry: ['US', 'DE', 'GB', 'FR', 'IS', 'NL'][Math.floor(rand() * 6)],
          createdAt: at,
          succeededAt: at,
        })
        .returning();
      await postTipSucceeded(db, tip!, at);
      await postProcessorFee(db, { tipId: tip!.id, feeMinor: mockProcessorFee(tip!.amountMinor), currency: tip!.currency, at });
      // One refunded tip per guide for realism
      if (i === 3) {
        await db.update(tips).set({ status: 'refunded' }).where(eq(tips.id, tip!.id));
        await postTipRefund(db, tip!);
      }
    }
  }
  console.log('Done. Guides: anna, jon (active), maria (not set up). Sign in at /login with anna@example.com or admin@example.com.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
