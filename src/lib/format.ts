/** European date formats (dd.mm.yyyy, 24h), always in UTC to match payout periods. */
const dtf = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
const df = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export const formatDateTime = (d: Date | string) => dtf.format(new Date(d)).replace(',', '');
export const formatDate = (d: Date | string) => df.format(new Date(d));
