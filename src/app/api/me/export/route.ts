import { getDb } from '@/db';
import { audit } from '@/lib/audit';
import { api } from '@/lib/http';
import { exportGuideData } from '@/lib/guides';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { user, guide } = await requireGuide(req);
  const db = await getDb();
  const data = await exportGuideData(db, guide, user.email);
  await audit(db, { actor: `user:${user.id}`, action: 'guide.data_exported', entity: 'guide', entityId: guide.id });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-tip-data.json"' },
  });
});
