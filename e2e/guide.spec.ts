import { expect, test, type Browser } from '@playwright/test';
import { signIn } from './helpers';

async function tipAsTourist(browser: Browser, slug: string) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const tourist = await ctx.newPage();
  await tourist.goto(`/t/${slug}`);
  await tourist.getByRole('button', { name: /Pay 10,00\s€/ }).click();
  await expect(tourist.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  await ctx.close();
}

test.describe('guide journey', () => {
  test('sign up, create profile, finish payout setup, receive a tip', async ({ page, browser, request }) => {
    await signIn(page, 'new.guide@example.com');
    await expect(page.getByRole('heading', { name: 'Create your guide profile' })).toBeVisible();
    await page.getByLabel('Your name').fill('Katrín Jónsdóttir');
    await page.getByLabel('Your tour').fill('Whale Watching');
    await page.getByRole('button', { name: 'Create profile' }).click();

    await expect(page.getByRole('heading', { name: /Welcome, Katrín Jónsdóttir/ })).toBeVisible();
    await expect(page.getByText('Payouts not set up')).toBeVisible();

    // Not active yet: tourists see the "not set up" page and cannot tip.
    await page.goto('/t/katrin-jonsdottir');
    await expect(page.getByRole('heading', { name: 'This guide is not set up yet' })).toBeVisible();
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Start payout setup' }).click();
    await page.getByRole('button', { name: 'Complete (mock)' }).click();
    await expect(page.getByText('Payouts active')).toBeVisible();

    // QR + NFC link
    const qr = await page.request.get('/api/me/qr.svg');
    expect(qr.status()).toBe(200);
    expect(qr.headers()['content-type']).toContain('image/svg+xml');
    expect((await page.request.get('/api/me/qr.png')).headers()['content-type']).toContain('image/png');
    await expect(page.getByTestId('nfc-link')).toContainText('/t/katrin-jonsdottir?s=nfc');

    await tipAsTourist(browser, 'katrin-jonsdottir');
    await page.reload();
    await expect(page.getByTestId('balance')).toContainText(/9,50\s€/);
    await expect(page.getByTestId('tips-table')).toContainText('10,00');
    await expect(page.getByTestId('month-tips')).toHaveText('1');

    // data export contains the tip
    const exp = await page.request.get('/api/me/export');
    expect((await exp.json()).tips).toHaveLength(1);

    // unauthenticated access
    expect((await request.get('/api/me/guide')).status()).toBe(401);
  });

  test('anonymous users are redirected to login; cross-origin writes are blocked', async ({ page, request }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    const res = await request.post('/api/auth/logout', { headers: { origin: 'https://evil.example' } });
    expect(res.status()).toBe(403);
  });

  test('a seeded guide sees their history and cannot see other guides data', async ({ page }) => {
    await signIn(page, 'jon@example.com');
    await expect(page.getByRole('heading', { name: /Welcome, Jón Þórsson/ })).toBeVisible();
    await expect(page.getByTestId('tips-table')).toBeVisible();
    const mine = await (await page.request.get('/api/me/tips?limit=200')).json();
    expect(mine.tips.length).toBeGreaterThan(10);
    // tours endpoint is scoped to the signed-in guide
    const tours = await (await page.request.get('/api/me/tours')).json();
    expect(tours.tours.map((t: { title: string }) => t.title)).toEqual(['Golden Circle Day Trip']);
    const other = await page.request.patch('/api/me/tours/00000000-0000-4000-8000-000000000000', { data: { active: false }, headers: { origin: 'http://localhost:3100' } });
    expect(other.status()).toBe(404);
  });
});
