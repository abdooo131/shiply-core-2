import { describe, expect, it } from 'vitest';
import { cairoPartOfDay } from './home-greeting';

describe('cairoPartOfDay', () => {
  it('uses the Cairo clock (UTC+2 in November)', () => {
    expect(cairoPartOfDay(new Date('2026-11-18T03:30:00Z'))).toBe('morning'); // 05:30 Cairo
    expect(cairoPartOfDay(new Date('2026-11-18T09:59:00Z'))).toBe('morning'); // 11:59 Cairo
    expect(cairoPartOfDay(new Date('2026-11-18T10:00:00Z'))).toBe('afternoon'); // 12:00 Cairo
    expect(cairoPartOfDay(new Date('2026-11-18T15:00:00Z'))).toBe('evening'); // 17:00 Cairo
    expect(cairoPartOfDay(new Date('2026-11-18T01:00:00Z'))).toBe('evening'); // 03:00 Cairo
  });
});
