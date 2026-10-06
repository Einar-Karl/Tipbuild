import { adminEmails } from '@/env';
import { sendEmail } from './email';

/** Operational alert to the platform owner(s) listed in ADMIN_EMAILS. Never throws. */
export async function alertAdmins(subject: string, text: string): Promise<void> {
  try {
    for (const to of adminEmails()) await sendEmail({ to, subject: `[Tip alert] ${subject}`, text });
  } catch (e) {
    console.error('[alert] could not send', e instanceof Error ? e.message : e);
  }
  console.error(`[ALERT] ${subject}: ${text}`);
}
