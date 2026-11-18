import { describe, expect, it } from 'vitest';
import { decryptText, encryptText } from './data-encryption';

describe('data encryption', () => {
  it('round-trips text and never stores it in the clear', () => {
    const sealed = encryptText('EG380019000500000000263180002');
    expect(sealed).not.toContain('0019000500000000263180002');
    expect(decryptText(sealed)).toBe('EG380019000500000000263180002');
  });

  it('gives different output each time for the same text', () => {
    expect(encryptText('same')).not.toBe(encryptText('same'));
  });

  it('refuses tampered data', () => {
    const sealed = encryptText('secret');
    const parts = sealed.split(':');
    const body = Buffer.from(parts[3] ?? '', 'base64');
    body[0] = (body[0] ?? 0) ^ 1;
    parts[3] = body.toString('base64');
    expect(() => decryptText(parts.join(':'))).toThrow();
  });
});
