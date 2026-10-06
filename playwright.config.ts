import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0123456789';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    // Signs in once per role and stores the session so tests do not hammer the (rate-limited) magic-link endpoint.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'mobile', testIgnore: /auth\.setup\.ts/, dependencies: ['setup'] },
  ],
  webServer: {
    // Fresh embedded database, seeded demo data, production build, MockProvider.
    command: `rm -rf .data/e2e && npx tsx scripts/seed.ts && npx next build && npx next start -p ${PORT}`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: 'production',
      ALLOW_LOCAL_DB: 'true',
      PGLITE_DIR: '.data/e2e',
      APP_URL: BASE,
      AUTH_SECRET,
      CRON_SECRET: 'e2e-cron-secret',
      ADMIN_EMAILS: 'admin@example.com',
      PAYMENT_PROVIDER: 'mock',
      FUNDS_MODEL: 'psp_scheduled_payout',
    },
  },
});
