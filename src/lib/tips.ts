import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { guides, operators, tips, tours, type Guide } from '@/db/schema';
import type { AppConfig } from './config';
import { MAX_TIP_MINOR, MIN_TIP_MINOR, splitTip } from './money';
import type { PaymentProvider } from './provider/types';

export class TipError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface GuideWithFee {
  guide: Guide;
  feeBps: number;
  reviewUrl: string | null;
}

export async function findGuideBySlug(db: Db, slug: string, cfg: Pick<AppConfig, 'feeBps'>): Promise<GuideWithFee | null> {
  const rows = await db
    .select({ guide: guides, feeOverride: operators.feeBpsOverride, reviewUrl: operators.reviewUrl })
    .from(guides)
    .leftJoin(operators, eq(operators.id, guides.operatorId))
    .where(and(eq(guides.slug, slug), isNull(guides.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { guide: r.guide, feeBps: r.feeOverride ?? cfg.feeBps, reviewUrl: r.reviewUrl };
}

export interface CreateTipInput {
  slug: string;
  tipMinor: number;
  currency?: string;
  coverFee?: boolean;
  tourId?: string | null;
  country?: string | null;
}

export interface CreatedTip {
  tipId: string;
  clientSecret: string;
  providerPaymentId: string;
  amountMinor: number;
  feeMinor: number;
  netMinor: number;
  currency: string;
}

/** Validate, price and create a pending tip plus the provider payment intent. */
export async function createTip(
  db: Db,
  provider: PaymentProvider,
  cfg: AppConfig,
  input: CreateTipInput,
): Promise<CreatedTip> {
  const currency = input.currency ?? cfg.currency;
  if (currency !== cfg.currency) throw new TipError(400, 'unsupported_currency');
  if (!Number.isInteger(input.tipMinor) || input.tipMinor < MIN_TIP_MINOR || input.tipMinor > MAX_TIP_MINOR)
    throw new TipError(400, 'invalid_amount');

  const found = await findGuideBySlug(db, input.slug, cfg);
  if (!found) throw new TipError(404, 'guide_not_found');
  const { guide, feeBps } = found;
  if (guide.payoutStatus !== 'active') throw new TipError(409, 'guide_not_active', 'This guide is not set up yet');
  if (cfg.fundsModel === 'psp_scheduled_payout' && !guide.payoutAccountId)
    throw new TipError(409, 'guide_not_active', 'This guide is not set up yet');

  let tourId: string | null = null;
  if (input.tourId) {
    const t = await db
      .select({ id: tours.id })
      .from(tours)
      .where(and(eq(tours.id, input.tourId), eq(tours.guideId, guide.id), eq(tours.active, true)));
    if (!t[0]) throw new TipError(400, 'invalid_tour');
    tourId = t[0].id;
  }

  const split = splitTip(input.tipMinor, feeBps, input.coverFee ?? false);
  const [tip] = await db
    .insert(tips)
    .values({
      guideId: guide.id,
      tourId,
      currency,
      amountMinor: split.amountMinor,
      feeMinor: split.feeMinor,
      netMinor: split.netMinor,
      coversFee: input.coverFee ?? false,
      touristCountry: input.country && /^[A-Za-z]{2}$/.test(input.country) ? input.country.toUpperCase() : null,
    })
    .returning();

  try {
    const intent = await provider.createTipIntent({
      guideId: guide.id,
      tipId: tip!.id,
      destinationAccountId: guide.payoutAccountId,
      amountMinor: split.amountMinor,
      currency,
      feeMinor: split.feeMinor,
      fundsModel: cfg.fundsModel,
    });
    await db.update(tips).set({ providerPaymentId: intent.providerPaymentId }).where(eq(tips.id, tip!.id));
    return { tipId: tip!.id, ...intent, ...split, currency };
  } catch (e) {
    await db.update(tips).set({ status: 'failed' }).where(eq(tips.id, tip!.id));
    throw e;
  }
}

export interface PublicTip {
  id: string;
  status: 'pending' | 'succeeded' | 'refunded' | 'failed';
  amountMinor: number;
  currency: string;
  guideName: string;
  rating: number | null;
  hasFeedback: boolean;
  reviewUrl: string | null;
}

/** Minimal, identity-free view addressed by the unguessable tip id. */
export async function getPublicTip(db: Db, id: string): Promise<PublicTip | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db
    .select({ tip: tips, guideName: guides.displayName, reviewUrl: operators.reviewUrl })
    .from(tips)
    .innerJoin(guides, eq(guides.id, tips.guideId))
    .leftJoin(operators, eq(operators.id, guides.operatorId))
    .where(eq(tips.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.tip.id,
    status: r.tip.status,
    amountMinor: r.tip.amountMinor,
    currency: r.tip.currency,
    guideName: r.guideName,
    rating: r.tip.rating,
    hasFeedback: !!r.tip.reviewText,
    reviewUrl: r.reviewUrl,
  };
}

/** One rating per tip; free text may be added once afterwards. Returns the public review link for 4-5 stars. */
export async function rateTip(
  db: Db,
  tipId: string,
  rating: number,
  text?: string | null,
): Promise<{ reviewUrl: string | null }> {
  const pub = await getPublicTip(db, tipId);
  if (!pub) throw new TipError(404, 'tip_not_found');
  if (pub.status !== 'succeeded') throw new TipError(409, 'tip_not_paid');
  const clean = text?.trim() ? text.trim().slice(0, 1000) : null;
  if (pub.rating === null) {
    const res = await db
      .update(tips)
      .set({ rating, reviewText: clean })
      .where(and(eq(tips.id, tipId), isNull(tips.rating)))
      .returning({ id: tips.id });
    if (!res[0]) throw new TipError(409, 'already_rated');
    return { reviewUrl: rating >= 4 ? pub.reviewUrl : null };
  }
  if (clean && !pub.hasFeedback) {
    await db.update(tips).set({ reviewText: clean }).where(and(eq(tips.id, tipId), isNull(tips.reviewText)));
    return { reviewUrl: pub.rating >= 4 ? pub.reviewUrl : null };
  }
  throw new TipError(409, 'already_rated');
}
