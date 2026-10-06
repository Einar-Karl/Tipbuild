import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { guides, tours } from '@/db/schema';
import { getConfig } from '@/lib/config';
import { api, ApiError, json, parseBody } from '@/lib/http';
import { createGuideProfile, deleteGuideAccount, guideStats } from '@/lib/guides';
import { requireGuide, requireUser, getGuideFor } from '@/lib/session';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const avatar = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'must be an https URL')
  .nullish();

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  const db = await getDb();
  const [tl, stats] = await Promise.all([db.select().from(tours).where(eq(tours.guideId, guide.id)), guideStats(db, guide)]);
  return json({ guide, tours: tl, stats });
});

const create = z.object({
  displayName: z.string().trim().min(2).max(60),
  tourTitle: z.string().trim().min(2).max(80),
  avatarUrl: avatar,
});

export const POST = api(async (req) => {
  const user = await requireUser(req);
  if (user.role !== 'guide') throw new ApiError(403, 'forbidden');
  if (await getGuideFor(user.id)) throw new ApiError(409, 'guide_exists');
  const input = await parseBody(req, create);
  const guide = await createGuideProfile(await getDb(), { userId: user.id, ...input, currency: getConfig().currency });
  return json({ guide }, 201);
});

const patch = z.object({ displayName: z.string().trim().min(2).max(60).optional(), avatarUrl: avatar });

export const PATCH = api(async (req) => {
  const { guide } = await requireGuide(req);
  const input = await parseBody(req, patch);
  const set: Partial<typeof guides.$inferInsert> = {};
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.avatarUrl !== undefined) set.avatarUrl = input.avatarUrl || null;
  if (Object.keys(set).length === 0) return json({ guide });
  const [updated] = await (await getDb()).update(guides).set(set).where(eq(guides.id, guide.id)).returning();
  return json({ guide: updated });
});

export const DELETE = api(async (req) => {
  const { user, guide } = await requireGuide(req);
  await deleteGuideAccount(await getDb(), guide, user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
});
