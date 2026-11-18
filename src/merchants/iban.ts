import { AppError } from '@/shared/app-error';
import { toLatinDigits } from '@/shared/arabic-digits';

// Egyptian IBAN: "EG", 2 check digits, 25 digits — 29 characters in all.
const EGYPTIAN_IBAN_PATTERN = /^EG\d{27}$/;
const MOD97_VALID_REMAINDER = 1;
const LETTER_OFFSET = 55; // 'A' becomes 10 in the ISO 13616 check

function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - LETTER_OFFSET));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

export function normalizeEgyptianIban(input: string): string {
  const iban = toLatinDigits(input).replace(/\s+/g, '').toUpperCase();
  if (!EGYPTIAN_IBAN_PATTERN.test(iban) || mod97(iban) !== MOD97_VALID_REMAINDER) {
    throw new AppError('invalid_iban');
  }
  return iban;
}

export function maskIbanLast4(last4: string): string {
  return `EG•• •••• ••${last4}`;
}
