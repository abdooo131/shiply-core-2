import type { CashOutSchedule } from '@prisma/client';
import { isCashOutDay } from '@/money';
import { cairoDateString } from '@/shared/cairo-time';
import { formatPiasters } from '@/shared/money';

export type Locale = 'en' | 'ar';

const MS_PER_DAY = 86_400_000;
const DAYS_IN_WEEK = 7;
const EN_CURRENCY_PREFIX = 'EGP ';
const AR_CURRENCY_SUFFIX = ' ج.م';
const MINUS_SIGN = '−';

// The big balance figure shows the number large and the currency small, like the mockup's "12,345 EGP".
export function amountParts(amountPiasters: number, locale: Locale): { number: string; currency: string } {
  const text = formatPiasters(Math.abs(amountPiasters), locale);
  if (locale === 'ar') return { number: text.replace(AR_CURRENCY_SUFFIX, ''), currency: AR_CURRENCY_SUFFIX.trim() };
  return { number: text.replace(EN_CURRENCY_PREFIX, ''), currency: EN_CURRENCY_PREFIX.trim() };
}

// "+EGP 1,250.00" for money in, "−EGP 45.00" for money out.
export function signedPiasters(amountPiasters: number, locale: Locale): string {
  const sign = amountPiasters < 0 ? MINUS_SIGN : '+';
  return `${sign}${formatPiasters(Math.abs(amountPiasters), locale)}`;
}

function addDays(cairoDate: string, days: number): string {
  const noonUtc = new Date(`${cairoDate}T12:00:00Z`).getTime() + days * MS_PER_DAY;
  return new Date(noonUtc).toISOString().slice(0, 10);
}

// The first cash-out day from today (Cairo) on. Every schedule has one within a week.
export function nextCashOutDate(schedule: CashOutSchedule, now: Date): string {
  const today = cairoDateString(now);
  for (let offset = 0; offset < DAYS_IN_WEEK; offset += 1) {
    const candidate = addDays(today, offset);
    if (isCashOutDay(schedule, candidate)) return candidate;
  }
  return today;
}

// A calendar date ("YYYY-MM-DD") as "Wed, 18 Nov" or "18 Nov 2026". Noon UTC is the same day in Cairo.
export function formatCalendarDate(cairoDate: string, locale: Locale, withWeekday = false): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    ...(withWeekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }),
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(new Date(`${cairoDate}T12:00:00Z`));
}
