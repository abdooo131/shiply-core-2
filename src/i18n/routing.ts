import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ar', 'en'],
  // Most Shiply merchants work in Arabic.
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);
