'use client';

import { usePathname } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';

export function LangSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Language" className="flex gap-3 text-sm">
      {LOCALES.map((l) => (
        <a
          key={l}
          href={`/api/lang?l=${l}&next=${encodeURIComponent(pathname)}`}
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
          className={`rounded-md px-2 py-1 ${l === locale ? 'bg-ink font-semibold text-page' : 'text-muted underline'}`}
        >
          {LOCALE_NAMES[l]}
        </a>
      ))}
    </nav>
  );
}
