import { test as setup } from '@playwright/test';
import { AUTH, signIn } from './helpers';

setup('sign in as admin', async ({ page }) => {
  await signIn(page, 'admin@example.com');
  await page.context().storageState({ path: AUTH.admin });
});

setup('sign in as a seeded guide', async ({ page }) => {
  await signIn(page, 'anna@example.com');
  await page.context().storageState({ path: AUTH.anna });
});
