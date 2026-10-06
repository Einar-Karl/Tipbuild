import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { clientIp, rateLimit } from './ratelimit';
import { TipError } from './tips';
import { WebhookSignatureError } from './provider/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  return schema.parse(raw);
}

/** Per-IP rate limit for public endpoints. */
export function limit(req: Request, bucket: string, max: number, windowMs: number): void {
  const r = rateLimit(`${bucket}:${clientIp(req)}`, max, windowMs);
  if (!r.ok) throw new ApiError(429, 'rate_limited', `Too many requests. Retry in ${r.retryAfterSec}s.`);
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 * the Origin (or Referer) host must match the request host / APP_URL, on top of SameSite=Lax cookies.
 */
export function assertSameOrigin(req: Request, appUrl: string): void {
  const origin = req.headers.get('origin') ?? (req.headers.get('referer') ? new URL(req.headers.get('referer')!).origin : null);
  if (!origin) throw new ApiError(403, 'csrf', 'Missing Origin header');
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new ApiError(403, 'csrf', 'Bad Origin header');
  }
  const allowed = new Set([new URL(appUrl).host, req.headers.get('host') ?? '', req.headers.get('x-forwarded-host') ?? '']);
  if (!allowed.has(host)) throw new ApiError(403, 'csrf', 'Cross-origin request blocked');
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Uniform error handling for route handlers. */
export function api<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof TipError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof WebhookSignatureError) return json({ error: 'invalid_signature' }, 400);
      if (e instanceof ZodError) return json({ error: 'invalid_input', issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
      console.error('[api] unhandled error', e instanceof Error ? e.message : e);
      return json({ error: 'internal_error' }, 500);
    }
  };
}
