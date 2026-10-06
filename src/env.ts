import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const DEV_SECRET = 'dev-only-secret-change-me-0123456789abcdef';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().optional(),
    PGLITE_DIR: z.string().default('.data/pglite'),
    ALLOW_LOCAL_DB: bool,
    APP_URL: z.string().url().default('http://localhost:3000'),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters').optional(),
    ADMIN_EMAILS: z.string().default(''),
    FUNDS_MODEL: z.enum(['psp_scheduled_payout', 'platform_pooled']).default('psp_scheduled_payout'),
    ALLOW_POOLED_FUNDS: bool,
    FEE_BPS: int(500, 0, 3000),
    MIN_PAYOUT_MINOR: int(2000),
    DEFAULT_CURRENCY: z.enum(['EUR']).default('EUR'),
    ASSUMED_RATE_BPS: int(600, 0, 5000),
    ISK_PER_EUR: int(150, 1),
    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Tip <tips@localhost>'),
    CRON_SECRET: z.string().optional(),
    RETENTION_MONTHS: int(24, 1),
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const prod = e.NODE_ENV === 'production';
    const provider = e.PAYMENT_PROVIDER ?? (e.STRIPE_SECRET_KEY ? 'stripe' : 'mock');
    if (prod && !e.AUTH_SECRET) issue('AUTH_SECRET', 'required in production');
    if (prod && !e.CRON_SECRET) issue('CRON_SECRET', 'required in production');
    if (prod && !e.DATABASE_URL && !e.ALLOW_LOCAL_DB)
      issue('DATABASE_URL', 'required in production (set ALLOW_LOCAL_DB=true only for demos/e2e)');
    if (provider === 'stripe') {
      for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'] as const)
        if (!e[k]) issue(k, 'required when PAYMENT_PROVIDER=stripe');
    }
    if (prod && provider === 'mock' && !e.ALLOW_LOCAL_DB)
      issue('PAYMENT_PROVIDER', 'the mock provider must not be used in production');
    if (e.FUNDS_MODEL === 'platform_pooled' && !e.ALLOW_POOLED_FUNDS)
      issue(
        'FUNDS_MODEL',
        'platform_pooled holds client money and is a regulated activity. Refusing to start unless ALLOW_POOLED_FUNDS=true (requires licence/legal sign-off, see LEGAL_NOTICE.md).',
      );
  });

export type Env = Omit<z.infer<typeof schema>, 'AUTH_SECRET'> & {
  AUTH_SECRET: string;
  PAYMENT_PROVIDER: 'mock' | 'stripe';
};

let cached: Env | undefined;

/** Parse the given environment. Throws a readable error listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (e.g. `STRIPE_SECRET_KEY=` in .env) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const res = schema.safeParse(cleaned);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const v = res.data;
  return {
    ...v,
    AUTH_SECRET: v.AUTH_SECRET ?? DEV_SECRET,
    PAYMENT_PROVIDER: v.PAYMENT_PROVIDER ?? (v.STRIPE_SECRET_KEY ? 'stripe' : 'mock'),
  };
}

export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv(process.env);
    if (cached.FUNDS_MODEL === 'platform_pooled') {
      console.warn(
        '\n!!! WARNING: FUNDS_MODEL=platform_pooled with ALLOW_POOLED_FUNDS=true. The platform holds client money.\n' +
          '!!! This is a regulated payment service (PSD2/EEA). Make sure licence, safeguarding and legal sign-off are in place.\n',
      );
    }
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export function adminEmails(env: Env = getEnv()): string[] {
  return env.ADMIN_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
