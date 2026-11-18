import { AppError } from './app-error';
import { toLatinDigits } from './arabic-digits';

const PIASTERS_PER_POUND = 100;
const BASIS_POINTS_PER_WHOLE = 10_000;
const EGP_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function parseEgpToPiasters(input: string): number {
  const cleaned = toLatinDigits(input).replace(/[,\s]/g, '');
  if (!EGP_AMOUNT_PATTERN.test(cleaned)) throw new AppError('invalid_amount');

  const [pounds = '0', fraction = ''] = cleaned.split('.');
  const amountPiasters = Number(pounds) * PIASTERS_PER_POUND + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountPiasters)) throw new AppError('invalid_amount');
  return amountPiasters;
}

export function formatPiasters(amountPiasters: number, locale: 'en' | 'ar'): string {
  const sign = amountPiasters < 0 ? '-' : '';
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amountPiasters) / PIASTERS_PER_POUND);
  return locale === 'ar' ? `${sign}${number} ج.م` : `${sign}EGP ${number}`;
}

// A percentage (in basis points, 100 = 1%) of an amount, rounded half up to the piastre.
// Integer arithmetic: half up = floor((2 * amount * bp + whole) / (2 * whole)).
export function basisPointsOfPiasters(amountPiasters: number, basisPoints: number): number {
  return Math.floor((2 * amountPiasters * basisPoints + BASIS_POINTS_PER_WHOLE) / (2 * BASIS_POINTS_PER_WHOLE));
}

export function addVatPiasters(
  netPiasters: number,
  vatBasisPoints: number,
): { netPiasters: number; vatPiasters: number; grossPiasters: number } {
  const vatPiasters = basisPointsOfPiasters(netPiasters, vatBasisPoints);
  return { netPiasters, vatPiasters, grossPiasters: netPiasters + vatPiasters };
}
