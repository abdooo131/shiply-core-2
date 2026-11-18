import { describe, expect, it } from 'vitest';
import { normalizeEgyptianMobile } from './egyptian-mobile';

describe('normalizeEgyptianMobile', () => {
  it.each(['01001234567', '+20 100 123 4567', '00201001234567', '٠١٠٠١٢٣٤٥٦٧'])(
    'normalizes %s to +201001234567',
    (input) => {
      expect(normalizeEgyptianMobile(input)).toBe('+201001234567');
    },
  );

  it.each(['0100123', '01301234567', '', '+441001234567'])('rejects %s', (input) => {
    expect(() => normalizeEgyptianMobile(input)).toThrow(
      expect.objectContaining({ code: 'invalid_mobile' }),
    );
  });
});
