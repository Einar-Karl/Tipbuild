import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { adminEmails, getEnv } from '@/env';
import { consumeLoginToken, SESSION_COOKIE, SESSION_TTL_SEC, signSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { api, assertSameOrigin, limit } from '@/lib/http';
import { sessionCookieOptions } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Form POST from /auth/verify. The GET page never consumes the token, so mail scanners can't burn it. */
export const POST = api(async (req) => {
  const env = getEnv();
  assertSameOrigin(req, env.APP_URL);
  limit(req, 'auth-verify', 20, 60_000);
  const form = await req.formData();
  const token = String(form.get('token') ?? '');
  const db = await getDb();
  const user = token ? await consumeLoginToken(db, token, adminEmails(env)) : null;
  const base = env.APP_URL;
  if (!user) return NextResponse.redirect(new URL('/auth/verify?error=1', base), 303);
  if (user.role === 'admin') await audit(db, { actor: `admin:${user.id}`, action: 'admin.login', entity: 'user', entityId: user.id });
  const res = NextResponse.redirect(new URL(user.role === 'admin' ? '/admin' : '/dashboard', base), 303);
  res.cookies.set(SESSION_COOKIE, signSession(user.id, env.AUTH_SECRET), sessionCookieOptions(SESSION_TTL_SEC));
  return res;
});
