import { describe, expect, it } from 'vitest';
import { addVatPiasters, basisPointsOfPiasters, formatPiasters, parseEgpToPiasters } from './money';

describe('basisPointsOfPiasters', () => {
  it('takes a percentage, rounded half up to the piastre', () => {
    expect(basisPointsOfPiasters(200000, 100)).toBe(2000);
    expect(basisPointsOfPiasters(1, 100)).toBe(0);
    expect(basisPointsOfPiasters(50, 100)).toBe(1);
    expect(basisPointsOfPiasters(6801, 5000)).toBe(3401);
  });
});

describe('addVatPiasters', () => {
  it('adds 14% VAT on top of the net amount', () => {
    expect(addVatPiasters(6800, 1400)).toEqual({
      netPiasters: 6800,
      vatPiasters: 952,
      grossPiasters: 7752,
    });
  });

  it('rounds VAT half up to the piastre', () => {
    expect(addVatPiasters(1, 1400).vatPiasters).toBe(0);
    expect(addVatPiasters(4, 1400).vatPiasters).toBe(1);
  });
});

describe('parseEgpToPiasters', () => {
  it('reads thousands separators and one decimal', () => {
    expect(parseEgpToPiasters('1,234.5')).toBe(123450);
  });

  it('reads Arabic digits', () => {
    expect(parseEgpToPiasters('١٢٣')).toBe(12300);
  });

  it('rejects more than two decimals', () => {
    expect(() => parseEgpToPiasters('1.234')).toThrow(
      expect.objectContaining({ code: 'invalid_amount' }),
    );
  });

  it('rejects empty, negative and non-numeric input', () => {
    for (const input of ['', '  ', '-5', 'abc', '1.2.3']) {
      expect(() => parseEgpToPiasters(input)).toThrow(
        expect.objectContaining({ code: 'invalid_amount' }),
      );
    }
  });
});

describe('formatPiasters', () => {
  it('formats in English and Arabic with Latin digits', () => {
    expect(formatPiasters(123450, 'en')).toBe('EGP 1,234.50');
    expect(formatPiasters(123450, 'ar')).toBe('1,234.50 ج.م');
  });

  it('formats negative amounts', () => {
    expect(formatPiasters(-5000, 'en')).toBe('-EGP 50.00');
  });
});
