import { describe, expect, it } from 'vitest';
import { generateOrderNumber } from './order-number';

describe('generateOrderNumber', () => {
  it('is 10 digits and never starts with 0', () => {
    for (let index = 0; index < 1000; index += 1) {
      expect(generateOrderNumber()).toMatch(/^[1-9]\d{9}$/);
    }
  });

  it('rarely repeats (1,000 in a row are all different)', () => {
    const numbers = new Set(Array.from({ length: 1000 }, generateOrderNumber));
    expect(numbers.size).toBe(1000);
  });
});
