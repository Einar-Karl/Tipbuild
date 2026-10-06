import './_env';
import { getDb } from '../src/db';
import { getConfig } from '../src/lib/config';
import { snapshotFloat } from '../src/lib/float';

/** Usage: npm run job:float   (takes today's float snapshot; idempotent per day) */
async function main() {
  console.log(JSON.stringify(await snapshotFloat(await getDb(), getConfig()), null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
