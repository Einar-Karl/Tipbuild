import { NextResponse } from 'next/server';
import { isLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const url = new URL(req.url);
  const l = url.searchParams.get('l');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const res = NextResponse.redirect(new URL(safeNext, url));
  if (isLocale(l)) res.cookies.set('lang', l, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
