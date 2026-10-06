import { NextResponse } from 'next/server';
import { getEnv } from '@/env';
import { SESSION_COOKIE } from '@/lib/auth';
import { api, assertSameOrigin } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const env = getEnv();
  assertSameOrigin(req, env.APP_URL);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
});
