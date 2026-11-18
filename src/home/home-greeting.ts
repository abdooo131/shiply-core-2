export type PartOfDay = 'morning' | 'afternoon' | 'evening';

const AFTERNOON_STARTS_HOUR = 12;
const EVENING_STARTS_HOUR = 17;
const MORNING_STARTS_HOUR = 5;

const cairoHourFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', hourCycle: 'h23' });

// The greeting follows the clock in Cairo, not the server's or the browser's.
export function cairoPartOfDay(now: Date): PartOfDay {
  const hour = Number(cairoHourFormat.format(now));
  if (hour >= MORNING_STARTS_HOUR && hour < AFTERNOON_STARTS_HOUR) return 'morning';
  if (hour >= AFTERNOON_STARTS_HOUR && hour < EVENING_STARTS_HOUR) return 'afternoon';
  return 'evening';
}
