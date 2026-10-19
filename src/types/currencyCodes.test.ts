import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES } from './currencyCodes.ts';

describe('CURRENCY_CODES', () => {
  it('holds only three-letter uppercase codes', () => {
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it.each(['PLN', 'EUR', 'USD', 'HRK', 'CLF', 'XAU'])('includes %s', (code) => {
    expect(CURRENCY_CODES.has(code)).toBe(true);
  });

  it.each(['XTS', 'XXX', 'ABC'])('leaves out %s', (code) => {
    expect(CURRENCY_CODES.has(code)).toBe(false);
  });
});
