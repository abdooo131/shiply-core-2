import { describe, expect, it } from 'vitest';
import { maskIbanLast4, normalizeEgyptianIban } from './iban';
import { BAD_CHECK_DIGITS_IBAN, VALID_IBAN } from './merchants-test-fixtures';

describe('normalizeEgyptianIban', () => {
  it('accepts a valid IBAN with spaces, lower case or Arabic digits', () => {
    expect(normalizeEgyptianIban(VALID_IBAN)).toBe(VALID_IBAN);
    expect(normalizeEgyptianIban('eg38 0019 0005 0000 0000 2631 8000 2')).toBe(VALID_IBAN);
    expect(normalizeEgyptianIban('EG٣٨0019000500000000263180002')).toBe(VALID_IBAN);
  });

  it.each([BAD_CHECK_DIGITS_IBAN, 'EG38001900050000000026318000', 'GB82WEST12345698765432', '', 'EG38ABCD000500000000263180002'])(
    'rejects %s',
    (input) => {
      expect(() => normalizeEgyptianIban(input)).toThrow(expect.objectContaining({ code: 'invalid_iban' }));
    },
  );
});

describe('maskIbanLast4', () => {
  it('shows only the last four digits', () => {
    expect(maskIbanLast4('1234')).toBe('EG•• •••• ••1234');
  });
});
