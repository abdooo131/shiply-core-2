import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field } from './field';

describe('Field', () => {
  it('keeps the error style when a custom class is passed', () => {
    const html = renderToStaticMarkup(<Field label="IBAN" name="iban" className="mono" error="Not valid" />);
    expect(html).toMatch(/class="input err mono"/);
    expect(html).toContain('aria-invalid="true"');
  });

  it('adds a custom class without an error', () => {
    expect(renderToStaticMarkup(<Field label="IBAN" name="iban" className="mono" />)).toMatch(/class="input mono"/);
  });
});
