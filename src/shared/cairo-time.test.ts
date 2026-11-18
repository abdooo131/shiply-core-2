import { describe, expect, it } from 'vitest';
import { cairoDayEndUtc, cairoDayStartUtc, formatCairo } from './cairo-time';

describe('cairoDayStartUtc', () => {
  it('returns Cairo midnight in UTC during winter time (UTC+2)', () => {
    expect(cairoDayStartUtc(new Date('2026-11-18T01:00:00Z')).toISOString()).toBe(
      '2026-11-17T22:00:00.000Z',
    );
  });

  it('follows summer time (UTC+3) without a fixed offset', () => {
    expect(cairoDayStartUtc(new Date('2026-07-15T12:00:00Z')).toISOString()).toBe(
      '2026-07-14T21:00:00.000Z',
    );
  });
});

describe('cairoDayEndUtc', () => {
  it('returns the last millisecond of the Cairo day', () => {
    expect(cairoDayEndUtc(new Date('2026-11-18T01:00:00Z')).toISOString()).toBe(
      '2026-11-18T21:59:59.999Z',
    );
  });
});

describe('formatCairo', () => {
  it('shows the Cairo date, not the UTC date', () => {
    // 23:30 UTC on 17 Nov is 01:30 on 18 Nov in Cairo.
    expect(formatCairo(new Date('2026-11-17T23:30:00Z'), 'en', 'date')).toContain('18');
  });

  it('uses Latin digits in Arabic', () => {
    expect(formatCairo(new Date('2026-11-17T23:30:00Z'), 'ar', 'time')).toMatch(/01:30/);
  });
});
