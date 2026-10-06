import { expect, test } from '@playwright/test';

// Runs last: it deliberately exhausts the per-IP limit of the public intent endpoint.
test('public endpoints are rate limited per IP', async ({ request }) => {
  const statuses: number[] = [];
  for (let i = 0; i < 30; i++) {
    const res = await request.post('/api/tips/intent', { data: { slug: 'does-not-exist', amountMinor: 1000 } });
    statuses.push(res.status());
  }
  expect(statuses).toContain(429);
  const last = await request.post('/api/tips/intent', { data: { slug: 'does-not-exist', amountMinor: 1000 } });
  expect(last.status()).toBe(429);
  expect((await last.json()).error).toBe('rate_limited');
  // invalid input is rejected before anything is created
  expect([400, 429]).toContain((await request.post('/api/tips/intent', { data: { slug: 'x', amountMinor: 'abc' } })).status());
});
