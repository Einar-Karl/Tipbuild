import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/env';
import { ApiError } from './http';

/** Cron routes accept `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header on GET). */
export function requireCron(req: Request): void {
  const secret = getEnv().CRON_SECRET;
  if (!secret) throw new ApiError(503, 'cron_disabled', 'CRON_SECRET is not configured');
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, 'unauthorized');
}
