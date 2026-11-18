import type { ReactNode } from 'react';

// Arabic is right to left; everything else reads left to right.
const RTL_LOCALES = new Set(['ar']);

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'}>
      <body>{children}</body>
    </html>
  );
}
