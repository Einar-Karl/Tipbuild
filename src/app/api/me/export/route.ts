import { getDb } from '@/db';
import { api } from '@/lib/http';
import { exportGuideData } from '@/lib/guides';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { user, guide } = await requireGuide(req);
  const data = await exportGuideData(await getDb(), guide, user.email);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-tip-data.json"' },
  });
});
