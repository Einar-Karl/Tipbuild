import { expect, test } from '@playwright/test';

test.describe('tourist flow (mobile viewport, MockProvider)', () => {
  test('tip a guide, then rate the tour', async ({ page }) => {
    await page.goto('/t/jon');
    await expect(page.getByRole('heading', { name: /Say thanks to Jón Þórsson/ })).toBeVisible();

    // 10 € preset is selected by default; the fee is explained clearly
    await expect(page.getByText(/receives 9,50\s€ after a 5 % service fee/)).toBeVisible();
    await page.getByRole('button', { name: /^20\s€$/ }).click();
    await expect(page.getByText(/receives 19,00\s€ after a 5 % service fee/)).toBeVisible();

    await page.getByRole('button', { name: /Pay 20,00\s€/ }).click();
    await expect(page).toHaveURL(/\/thanks\?tip=/);
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await expect(page.getByTestId('thanks-body')).toContainText(/20,00\s€/);

    await page.getByRole('button', { name: '5 out of 5 stars' }).click();
    await expect(page.getByText('Thanks for your feedback!')).toBeVisible();
  });

  test('custom amount is validated and low ratings ask for private feedback', async ({ page }) => {
    await page.goto('/t/jon');
    await page.getByRole('button', { name: 'Other amount' }).click();
    await page.getByLabel('Other amount').fill('0,50');
    await expect(page.getByRole('button', { name: 'Please enter a valid amount.' })).toBeDisabled();
    await page.getByLabel('Other amount').fill('12,50');
    await page.getByRole('checkbox').check();
    await expect(page.getByText(/You pay 13,13\s€/)).toBeVisible(); // 12,50 + 5 % (0,63)
    await page.getByRole('button', { name: /Pay 13,13\s€/ }).click();
    await page.getByRole('button', { name: '2 out of 5 stars' }).click();
    await page.getByLabel(/Tell us what could be better/).fill('Too fast');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Thanks for your feedback!')).toBeVisible();
  });

  test('inactive guide shows a clear message and cannot be tipped', async ({ page, request }) => {
    await page.goto('/t/maria');
    await expect(page.getByRole('heading', { name: 'This guide is not set up yet' })).toBeVisible();
    const res = await request.post('/api/tips/intent', { data: { slug: 'maria', amountMinor: 1000 } });
    expect(res.status()).toBe(409);
  });

  test('Icelandic UI uses European number formatting', async ({ page }) => {
    await page.goto('/api/lang?l=is&next=/t/jon');
    await expect(page.getByRole('heading', { name: /Þakkaðu Jón Þórsson fyrir/ })).toBeVisible();
    await expect(page.getByText(/fær 9,50\s€ eftir 5 % þjónustugjald/)).toBeVisible();
  });
});
