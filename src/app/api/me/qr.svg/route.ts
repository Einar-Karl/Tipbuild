import { getEnv } from '@/env';
import { api } from '@/lib/http';
import { qrSvg, tipUrl } from '@/lib/qr';
import { requireGuide } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const { guide } = await requireGuide(req);
  const svg = await qrSvg(tipUrl(getEnv().APP_URL, guide.slug, 'qr'));
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'content-disposition': `inline; filename="tip-${guide.slug}.svg"`, 'cache-control': 'private, max-age=300' },
  });
});
