import { AppError } from './app-error';
import { toLatinDigits } from './arabic-digits';

// Egyptian mobiles: 010, 011, 012 or 015 followed by 8 digits.
const LOCAL_MOBILE_PATTERN = /^01[0125]\d{8}$/;

export function normalizeEgyptianMobile(input: string): string {
  let digits = toLatinDigits(input).replace(/[\s\-()]/g, '');
  if (digits.startsWith('+20')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('20') && digits.length === 12) digits = `0${digits.slice(2)}`;

  if (!LOCAL_MOBILE_PATTERN.test(digits)) throw new AppError('invalid_mobile');
  return `+2${digits}`;
}
