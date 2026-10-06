import { cookies } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { guides, users, type Guide, type User } from '@/db/schema';
import { getEnv } from '@/env';
import { SESSION_COOKIE, verifySession } from './auth';
import { ApiError, assertSameOrigin } from './http';

export async function getSessionUser(): Promise<User | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const uid = verifySession(value, getEnv().AUTH_SECRET);
  if (!uid) return null;
  const [u] = await (await getDb()).select().from(users).where(eq(users.id, uid));
  return u ?? null;
}

export async function getGuideFor(userId: string): Promise<Guide | null> {
  const [g] = await (await getDb()).select().from(guides).where(and(eq(guides.userId, userId), isNull(guides.deletedAt)));
  return g ?? null;
}

/** For route handlers: authenticated user, CSRF-checked on state-changing methods. */
export async function requireUser(req: Request): Promise<User> {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req, getEnv().APP_URL);
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'unauthenticated');
  return user;
}

export async function requireGuide(req: Request): Promise<{ user: User; guide: Guide }> {
  const user = await requireUser(req);
  if (user.role !== 'guide') throw new ApiError(403, 'forbidden');
  const guide = await getGuideFor(user.id);
  if (!guide) throw new ApiError(404, 'no_guide_profile');
  return { user, guide };
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden');
  return user;
}

export function sessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getEnv().APP_URL.startsWith('https://'),
    path: '/',
    maxAge: maxAgeSec,
  };
}
