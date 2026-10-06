import { expect, test } from '@playwright/test';
import { CRON, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('admin and the monthly payout job', () => {
  test('guides cannot use admin routes; anonymous users cannot either', async ({ page, request }) => {
    expect((await request.get('/api/admin/summary')).status()).toBe(401);
    await signIn(page, 'anna@example.com');
    for (const url of ['/api/admin/summary', '/api/admin/export.csv']) {
      expect((await page.request.get(url)).status(), url).toBe(403);
    }
    const run = await page.request.post('/api/admin/payout-run', { data: {}, headers: { origin: 'http://localhost:3100' } });
    expect(run.status()).toBe(403);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '403' })).toBeVisible();
  });

  test('cron endpoint requires the secret', async ({ request }) => {
    expect((await request.post('/api/cron/monthly-payout')).status()).toBe(401);
    expect((await request.post('/api/cron/monthly-payout', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
  });

  test('overview shows totals; CSV export uses European Excel format', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByTestId('gross')).toContainText('€');
    const res = await page.request.get('/api/admin/export.csv?type=tips');
    expect(res.headers()['content-type']).toContain('text/csv');
    const text = await res.text();
    expect(text.startsWith('﻿Tip id;Date;Guide;Tour;Currency;Gross;Fee;Net;Status;Rating;Country')).toBe(true);
    expect(text).toMatch(/;\d{1,3}(\.\d{3})*,\d{2};/); // decimal comma
    expect((await page.request.get('/api/admin/export.csv?type=bogus')).status()).toBe(400);
  });

  test('monthly job: one payout per eligible guide, idempotent, statements downloadable', async ({ page, request, browser }) => {
    await signIn(page, 'admin@example.com');
    await page.goto('/admin/payouts');
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByTestId('run-result')).toContainText('"pending":2'); // anna and jon; maria is not set up
    await expect(page.getByTestId('admin-payouts').locator('tbody tr')).toHaveCount(2);

    // Re-running (via the cron, same code path) creates nothing new
    const again = await request.post('/api/cron/monthly-payout', { headers: CRON });
    expect(again.status()).toBe(200);
    const body = await again.json();
    expect(body.counts.pending).toBe(2);
    await page.reload();
    await expect(page.getByTestId('admin-payouts').locator('tbody tr')).toHaveCount(2);

    // Guide sees the payout and can download statements
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3100' });
    const g = await ctx.newPage();
    await signIn(g, 'anna@example.com');
    await expect(g.getByTestId('payouts-table').locator('tbody tr')).toHaveCount(1);
    const csvHref = await g.getByRole('link', { name: 'CSV' }).getAttribute('href');
    const pdfHref = await g.getByRole('link', { name: 'PDF' }).getAttribute('href');
    const csv = await g.request.get(csvHref!);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain('Payout;');
    const pdf = await g.request.get(pdfHref!);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    // other guides' statements are not reachable
    expect((await g.request.get('/api/me/payouts/00000000-0000-4000-8000-000000000000/statement.csv')).status()).toBe(404);
    await ctx.close();

    const summary = await (await page.request.get('/api/admin/summary')).json();
    expect(summary.payoutRuns[0].count).toBe(2);
  });

  test('reconciliation and float reports', async ({ page, request }) => {
    await signIn(page, 'admin@example.com');
    const rec = await (await page.request.get('/api/admin/reconciliation')).json();
    expect(rec.checks.filter((c: { status: string }) => c.status === 'fail')).toEqual([]);
    expect(rec.fundsModel).toBe('psp_scheduled_payout');
    expect(rec.checks.find((c: { id: string }) => c.id === 'safeguarding').status).toBe('n/a');

    expect((await request.post('/api/cron/daily-float-snapshot')).status()).toBe(401);
    const snap = await request.post('/api/cron/daily-float-snapshot', { headers: CRON });
    expect(snap.status()).toBe(200);
    const fl = await (await page.request.get('/api/admin/float')).json();
    expect(fl.months.length).toBeGreaterThanOrEqual(1);
    expect(fl.months[0].accruedInterestMinor).toBe(0); // scheduled mode: nothing accrues to the platform
    expect(fl.months[0].hypotheticalInterestMinor).toBeGreaterThan(0);
    expect(fl.disclaimer).toContain('In psp_scheduled_payout mode this is 0.');

    await page.goto('/admin/reconciliation');
    await expect(page.getByTestId('overall')).toHaveText(/ok|warn/);
    await page.goto('/admin/float');
    await expect(page.getByTestId('float-disclaimer')).toContainText('Estimate only');
    expect((await request.post('/api/cron/retention', { headers: CRON })).status()).toBe(200);
  });
});
