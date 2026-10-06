/** Fail fast on invalid configuration (including refusing platform_pooled without ALLOW_POOLED_FUNDS). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { getEnv } = await import('./env');
    getEnv();
  }
}
