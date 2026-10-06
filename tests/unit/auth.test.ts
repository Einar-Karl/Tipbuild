import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '@/lib/auth';
import { slugify } from '@/lib/slug';
import { assertSameOrigin } from '@/lib/http';

const secret = 's'.repeat(40);

describe('session cookie', () => {
  it('round-trips and rejects tampering, wrong secret and expiry', () => {
    const now = Date.now();
    const c = signSession('user-1', secret, now, 100);
    expect(verifySession(c, secret, now)).toBe('user-1');
    expect(verifySession(c, 'x'.repeat(40), now)).toBeNull();
    // flip a character in the middle of the signature (the last base64 char only carries padding bits)
    const mid = c.length - 20;
    const flipped = c.slice(0, mid) + (c[mid] === 'A' ? 'B' : 'A') + c.slice(mid + 1);
    expect(verifySession(flipped, secret, now)).toBeNull();
    const [v, p, s] = c.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'admin', exp: 9999999999 })).toString('base64url');
    expect(verifySession(`${v}.${forged}.${s}`, secret, now)).toBeNull();
    expect(p).toBeTruthy();
    expect(verifySession(c, secret, now + 101_000)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession('garbage', secret)).toBeNull();
  });
});

describe('slugify', () => {
  it('transliterates Icelandic letters', () => {
    expect(slugify('Anna Sigurðardóttir')).toBe('anna-sigurdardottir');
    expect(slugify('Þór Ægisson')).toBe('thor-aegisson');
    expect(slugify('  !!! ')).toBe('guide');
  });
});

describe('CSRF origin check', () => {
  const req = (headers: Record<string, string>) => new Request('http://app.test/api/x', { method: 'POST', headers });
  it('accepts same origin and rejects cross-origin or missing origin', () => {
    expect(() => assertSameOrigin(req({ origin: 'https://tip.example' }), 'https://tip.example')).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: 'https://evil.example' }), 'https://tip.example')).toThrow();
    expect(() => assertSameOrigin(req({}), 'https://tip.example')).toThrow();
    expect(() => assertSameOrigin(req({ referer: 'https://tip.example/dashboard' }), 'https://tip.example')).not.toThrow();
  });
});
