import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { tours } from '@/db/schema';
import { api, json, parseBody } from '@/lib/http';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  return json({ tours: await (await getDb()).select().from(tours).where(eq(tours.guideId, guide.id)) });
});

export const POST = api(async (req) => {
  const { guide } = await requireGuide(req);
  const { title } = await parseBody(req, z.object({ title: z.string().trim().min(2).max(80) }));
  const [t] = await (await getDb()).insert(tours).values({ guideId: guide.id, title }).returning();
  return json({ tour: t }, 201);
});
