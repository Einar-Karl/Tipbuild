/**
 * Fixed-window in-memory rate limiter.
 * NOTE: per server instance. On serverless this is best-effort burst protection; put a shared
 * limiter (Vercel WAF / Upstash) in front for hard guarantees. See DECISIONS.md.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __tipRl?: Map<string, Bucket> };
const buckets = (g.__tipRl ??= new Map<string, Bucket>());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  if (buckets.size > 10000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  return { ok: b.count <= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
