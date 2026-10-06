import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await page.getByTestId('dev-link').click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|admin)/);
}

export const CRON = { authorization: 'Bearer e2e-cron-secret' };

export const AUTH = { admin: 'e2e/.auth/admin.json', anna: 'e2e/.auth/anna.json' } as const;
export const ORIGIN = 'http://localhost:3100';
