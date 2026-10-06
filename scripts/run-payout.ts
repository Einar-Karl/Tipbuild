import './_env';
import { getDb } from '../src/db';
import { getConfig } from '../src/lib/config';
import { runMonthlyPayout } from '../src/lib/payouts';
import { getProvider } from '../src/lib/provider';

/** Usage: npm run job:payout [-- YYYY-MM]   (defaults to the previous calendar month; safe to re-run) */
async function main() {
  const period = process.argv[2];
  const result = await runMonthlyPayout(await getDb(), { provider: getProvider(), cfg: getConfig(), period, actor: 'cli' });
  console.log(JSON.stringify(result, null, 2));
  if (result.counts.failed > 0) process.exitCode = 2;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
