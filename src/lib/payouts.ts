import type { Db } from '@/db/types';
import type { ProviderEvent } from './provider/types';

/** Provider payout notifications. Implemented fully in the payout milestone. */
export async function handlePayoutEvent(
  _db: Db,
  _event: Extract<ProviderEvent, { type: 'payout.paid' | 'payout.failed' }>,
): Promise<'processed' | 'ignored'> {
  return 'ignored';
}
