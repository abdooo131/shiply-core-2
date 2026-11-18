export type Locale = 'en' | 'ar';

const HOURS_PER_DAY = 24;
const PIASTERS_PER_POUND = 100;
const THOUSAND = 1000;

// Latin digits in both languages, like the rest of the portal.
function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { ...options, numberingSystem: 'latn' });
}

export function formatCount(value: number, locale: Locale): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

// A share between 0 and 1 as "61%" (or "61.5%" with one decimal).
export function formatShare(share: number, locale: Locale, fractionDigits = 0): string {
  return numberFormat(locale, { style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(share);
}

// A Cairo calendar date ("YYYY-MM-DD") as "12 Nov".
export function formatShortDate(cairoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(new Date(`${cairoDate}T12:00:00Z`));
}

// Whole days and the remaining whole hours, as the mockup shows "1 day, 4 h".
export function splitHours(totalHours: number): { days: number; hours: number } {
  const rounded = Math.round(totalHours);
  return { days: Math.floor(rounded / HOURS_PER_DAY), hours: rounded % HOURS_PER_DAY };
}

// An axis label in pounds: "0", "500", "2.5k".
export function formatAxisPounds(amountPiasters: number): string {
  const pounds = amountPiasters / PIASTERS_PER_POUND;
  return pounds >= THOUSAND ? `${Number((pounds / THOUSAND).toFixed(1))}k` : String(Math.round(pounds));
}
