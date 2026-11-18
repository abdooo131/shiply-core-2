import { randomInt } from 'node:crypto';

// 10 digits, first digit 1–9, from a cryptographic source so numbers cannot be guessed in sequence.
const SMALLEST_TEN_DIGIT = 1_000_000_000;
const LARGEST_TEN_DIGIT = 9_999_999_999;

export function generateOrderNumber(): string {
  return String(randomInt(SMALLEST_TEN_DIGIT, LARGEST_TEN_DIGIT + 1));
}
