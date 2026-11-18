const CAIRO_TIME_ZONE = 'Africa/Cairo';
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const cairoPartsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function cairoWallClock(date: Date): { year: number; month: number; day: number; asUtcMs: number } {
  const parts = Object.fromEntries(
    cairoPartsFormat.formatToParts(date).map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const year = parts.year ?? 0;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  const asUtcMs = Date.UTC(year, month - 1, day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  return { year, month, day, asUtcMs };
}

// Cairo's UTC offset at a given instant, in minutes. Read from the time zone
// database so summer time is handled without a fixed offset.
function cairoOffsetMinutes(date: Date): number {
  const wholeSecondMs = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((cairoWallClock(date).asUtcMs - wholeSecondMs) / MS_PER_MINUTE);
}

export function cairoDayStartUtc(date: Date): Date {
  const { year, month, day } = cairoWallClock(date);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  // The offset at midnight can differ from the offset at `date` on a clock-change day.
  const guess = new Date(midnightAsUtc - cairoOffsetMinutes(date) * MS_PER_MINUTE);
  return new Date(midnightAsUtc - cairoOffsetMinutes(guess) * MS_PER_MINUTE);
}

const CAIRO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// The Cairo calendar date of a moment, as "YYYY-MM-DD".
export function cairoDateString(date: Date): string {
  const { year, month, day } = cairoWallClock(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The UTC moment a Cairo calendar date ("YYYY-MM-DD") starts. Throws on a malformed or impossible date.
export function cairoDateToUtcStart(cairoDate: string): Date {
  const match = CAIRO_DATE_PATTERN.exec(cairoDate);
  if (!match) throw new Error(`"${cairoDate}" is not a date in YYYY-MM-DD form.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  if (noonUtc.getUTCMonth() !== month - 1 || noonUtc.getUTCDate() !== day) throw new Error(`"${cairoDate}" is not a real date.`);
  // Noon UTC is always the same calendar day in Cairo (UTC+2/+3), so its day start is this date's.
  return cairoDayStartUtc(noonUtc);
}

export function cairoDayEndUtc(date: Date): Date {
  const start = cairoDayStartUtc(date);
  const nextDayStart = cairoDayStartUtc(new Date(start.getTime() + MS_PER_DAY + 2 * 60 * MS_PER_MINUTE));
  return new Date(nextDayStart.getTime() - 1);
}

const STYLE_OPTIONS: Record<'date' | 'dateTime' | 'time', Intl.DateTimeFormatOptions> = {
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  dateTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

export function formatCairo(date: Date, locale: 'en' | 'ar', style: 'date' | 'dateTime' | 'time'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    ...STYLE_OPTIONS[style],
    timeZone: CAIRO_TIME_ZONE,
    numberingSystem: 'latn',
  }).format(date);
}
