import { getEnv } from '@/env';
import { api } from '@/lib/http';
import { qrPng, tipUrl } from '@/lib/qr';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  const png = await qrPng(tipUrl(getEnv().APP_URL, guide.slug, 'qr'));
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'content-disposition': `attachment; filename="tip-${guide.slug}.png"`, 'cache-control': 'private, max-age=300' },
  });
});
