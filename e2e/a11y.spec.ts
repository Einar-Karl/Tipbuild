import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { AUTH, ORIGIN } from './helpers';

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${name}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('tourist pages', async ({ page }) => {
      await page.goto('/t/jon');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'tip page');
      await page.getByRole('button', { name: 'Other amount' }).click();
      await page.getByLabel('Other amount').fill('abc');
      await audit(page, 'tip page, custom amount');

      await page.goto('/t/maria');
      await audit(page, 'inactive guide');

      await page.goto('/t/jon');
      await page.getByRole('button', { name: /Pay 10,00\s€/ }).click();
      await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
      await audit(page, 'thank you');
      await page.getByRole('button', { name: '2 out of 5 stars' }).click();
      await expect(page.getByLabel(/Tell us what could be better/)).toBeVisible();
      await audit(page, 'thank you, feedback');
    });

    test('public pages', async ({ page }) => {
      for (const url of ['/', '/login', '/legal/privacy', '/legal/terms']) {
        await page.goto(url);
        await audit(page, url);
      }
    });
  });
}

test.describe('accessibility (signed in)', () => {
  test.describe('guide', () => {
    test.use({ storageState: AUTH.anna });
    test('dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'dashboard');
    });
  });
  test.describe('admin', () => {
    test.use({ storageState: AUTH.admin });
    test('admin pages', async ({ page }) => {
      for (const url of ['/admin', '/admin/payouts', '/admin/reconciliation', '/admin/float', '/admin/operators']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await audit(page, url);
      }
    });
  });
});

test('keyboard: the tip form can be completed without a mouse', async ({ page }) => {
  await page.goto('/t/jon');
  await page.getByRole('button', { name: /^20\s€$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^20\s€$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Pay 20,00\s€/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${ORIGIN}/t/jon/thanks`));
});
