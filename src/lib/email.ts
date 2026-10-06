import { getEnv } from '@/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer }[];
}

const g = globalThis as unknown as { __tipOutbox?: Mail[] };
const outbox = (g.__tipOutbox ??= []);

/** Emails "sent" without a RESEND_API_KEY (dev/tests). */
export function getOutbox(): Mail[] {
  return outbox;
}
export function clearOutbox(): void {
  outbox.length = 0;
}

export function isDemoMode(): boolean {
  const e = getEnv();
  return !e.RESEND_API_KEY && (e.NODE_ENV !== 'production' || e.ALLOW_LOCAL_DB);
}

export async function sendEmail(mail: Mail): Promise<void> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    outbox.push(mail);
    if (outbox.length > 200) outbox.shift();
    if (env.NODE_ENV !== 'test') console.log(`[email:demo] to=${mail.to} subject="${mail.subject}"`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
    }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}`);
}
