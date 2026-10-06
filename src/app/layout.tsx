import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: { default: 'Tip', template: '%s · Tip' },
  description: 'Digital tipping for tour guides.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f1ea' },
    { media: '(prefers-color-scheme: dark)', color: '#111317' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
