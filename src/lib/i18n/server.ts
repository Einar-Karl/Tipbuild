import { cookies, headers } from 'next/headers';
import { messagesFor, pickLocale, type Locale, type Messages } from './index';

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get('lang')?.value;
  const h = (await headers()).get('accept-language');
  return pickLocale(c, h);
}

export async function getMessages(): Promise<{ locale: Locale; m: Messages }> {
  const locale = await getLocale();
  return { locale, m: messagesFor(locale) };
}
