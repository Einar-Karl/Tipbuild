import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '@/db/types';
import { loginTokens, users, type User } from '@/db/schema';

export const SESSION_COOKIE = 'tip_session';
export const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createLoginToken(db: Db, email: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(loginTokens).values({
    email: email.trim().toLowerCase(),
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
  });
  return token;
}

/** One-time use. Creates the user on first sign-in; ADMIN_EMAILS can only promote, never demote. */
export async function consumeLoginToken(db: Db, token: string, adminList: string[], now = new Date()): Promise<User | null> {
  return db.transaction(async (tx) => {
    const used = await tx
      .update(loginTokens)
      .set({ usedAt: now })
      .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
      .returning({ email: loginTokens.email });
    const email = used[0]?.email;
    if (!email) return null;
    const isAdmin = adminList.includes(email);
    await tx.insert(users).values({ email, role: isAdmin ? 'admin' : 'guide' }).onConflictDoNothing();
    let [u] = await tx.select().from(users).where(eq(users.email, email));
    if (u && isAdmin && u.role !== 'admin') [u] = await tx.update(users).set({ role: 'admin' }).where(eq(users.id, u.id)).returning();
    return u ?? null;
  });
}

export function signSession(userId: string, secret: string, now = Date.now(), ttlSec = SESSION_TTL_SEC): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(now / 1000) + ttlSec })).toString('base64url');
  const sig = createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url');
  return `v1.${payload}.${sig}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null;
  const [v, payload, sig] = value.split('.');
  if (v !== 'v1' || !payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(`v1.${payload}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: string; exp: number };
    if (typeof uid !== 'string' || typeof exp !== 'number' || exp * 1000 < now) return null;
    return uid;
  } catch {
    return null;
  }
}
