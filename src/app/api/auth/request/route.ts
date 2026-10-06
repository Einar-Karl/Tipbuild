import { z } from 'zod';
import { getDb } from '@/db';
import { getEnv } from '@/env';
import { createLoginToken } from '@/lib/auth';
import { isDemoMode, sendEmail } from '@/lib/email';
import { api, json, limit, parseBody } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

const body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export const POST = api(async (req) => {
  limit(req, 'auth-request', 10, 60_000);
  const { email } = await parseBody(req, body);
  // Per-address limit so nobody can mail-bomb a victim; same response either way (no enumeration).
  if (!rateLimit(`auth-email:${email}`, 3, 10 * 60_000).ok) return json({ ok: true });
  const env = getEnv();
  const token = await createLoginToken(await getDb(), email);
  const link = `${env.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: email,
    subject: 'Your Tip sign-in link',
    text: `Sign in to Tip:\n\n${link}\n\nThe link is valid for 15 minutes and can be used once. If you did not request it, ignore this email.`,
  });
  return json(isDemoMode() ? { ok: true, devLink: link } : { ok: true });
});
