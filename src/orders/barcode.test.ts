import { describe, expect, it } from 'vitest';
import { barcodeSvg } from './barcode';

describe('barcodeSvg', () => {
  it('draws a Code 128 barcode as SVG for a 10-digit order number', () => {
    const svg = barcodeSvg('4820193746');
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    expect(svg).not.toBe(barcodeSvg('4820193747'));
  });

  it('refuses anything that is not a 10-digit order number', () => {
    for (const bad of ['', '123', '48201937461', 'ABC1234567', '<script>12']) {
      expect(() => barcodeSvg(bad)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    }
  });
});
