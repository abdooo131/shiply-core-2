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

export function addVatPiasters(
  netPiasters: number,
  vatBasisPoints: number,
): { netPiasters: number; vatPiasters: number; grossPiasters: number } {
  // Integer arithmetic: half up = floor((2 * net * bp + whole) / (2 * whole)).
  const vatPiasters = Math.floor(
    (2 * netPiasters * vatBasisPoints + BASIS_POINTS_PER_WHOLE) / (2 * BASIS_POINTS_PER_WHOLE),
  );
  return { netPiasters, vatPiasters, grossPiasters: netPiasters + vatPiasters };
}
