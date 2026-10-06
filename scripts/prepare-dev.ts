import './_env';
import { execFileSync } from 'node:child_process';

// Make `npm run dev` work out of the box: migrate and seed demo data when the database is empty.
execFileSync('npx', ['tsx', 'scripts/seed.ts', '--if-empty'], { stdio: 'inherit' });
