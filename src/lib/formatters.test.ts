import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatCalendarDate,
  formatFileSize,
  formatLanguage,
  formatPageCount,
} from './formatters.ts';

// Intl uses no-break spaces as group separators; normalize them for readable assertions.
function plain(text: string): string {
  return text.replace(/\s/g, ' ');
}

describe('formatters', () => {
  it('formats file sizes in kB and MB', () => {
    expect(formatFileSize(512 * 1024)).toBe('512 kB');
    expect(plain(formatFileSize(12.3 * 1024 * 1024))).toBe('12,3 MB');
  });

  it('rounds file sizes up, so a size over a limit never shows as the limit', () => {
    expect(formatFileSize(10 * 1024 * 1024 + 1)).toBe('10,1 MB');
  });

  it('formats amounts in their currency', () => {
    expect(plain(formatAmount(1230, 'PLN'))).toBe('1230,00 zł');
    expect(plain(formatAmount(12500.5, 'EUR'))).toBe('12 500,50 €');
  });

  it('formats calendar dates without a time zone shift', () => {
    expect(formatCalendarDate('2024-03-01')).toBe('1 marca 2024');
  });

  it('names languages in Polish', () => {
    expect(formatLanguage('pl')).toBe('polski');
    expect(formatLanguage('en')).toBe('angielski');
  });

  it('uses the Polish plural forms for pages', () => {
    expect(formatPageCount(1)).toBe('1 strona');
    expect(formatPageCount(3)).toBe('3 strony');
    expect(formatPageCount(5)).toBe('5 stron');
    expect(formatPageCount(12)).toBe('12 stron');
    expect(formatPageCount(22)).toBe('22 strony');
  });
});
