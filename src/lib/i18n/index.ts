import { en, type Messages } from './en';
import { is } from './is';

export type Locale = 'en' | 'is';
export const LOCALES: Locale[] = ['en', 'is'];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', is: 'Íslenska' };

const catalog: Record<Locale, Messages> = { en, is };

export function messagesFor(locale: Locale): Messages {
  return catalog[locale];
}

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'is';
}

/** Pick a locale from a cookie value and an Accept-Language header. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  const first = (acceptLanguage ?? '').split(',').map((s) => s.trim().toLowerCase());
  for (const l of first) {
    if (l.startsWith('is')) return 'is';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

/** Replace {placeholders}. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export type { Messages };
