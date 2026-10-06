import { beforeEach, describe, expect, it } from 'vitest';
import { clientIp, rateLimit, resetRateLimits } from '@/lib/ratelimit';

beforeEach(() => resetRateLimits());

describe('rate limiter', () => {
  it('allows up to the limit per window, then blocks with a retry hint', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('k', 3, 60_000, 1000).ok).toBe(true);
    const blocked = rateLimit('k', 3, 60_000, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });
  it('resets after the window and isolates keys', () => {
    for (let i = 0; i < 4; i++) rateLimit('a', 3, 1000, 0);
    expect(rateLimit('a', 3, 1000, 500).ok).toBe(false);
    expect(rateLimit('a', 3, 1000, 1001).ok).toBe(true);
    expect(rateLimit('b', 3, 1000, 0).ok).toBe(true);
  });
  it('takes the client IP from the first x-forwarded-for hop', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }))).toBe('1.2.3.4');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
