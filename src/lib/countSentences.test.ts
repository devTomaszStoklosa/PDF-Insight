import { describe, expect, it } from 'vitest';
import { countSentences } from './countSentences.ts';

describe('countSentences', () => {
  it.each([
    ['', 0],
    ['   \n\t ', 0],
    ['Jedno zdanie bez kropki', 1],
    ['Pierwsze zdanie. Drugie zdanie.', 2],
    ['Pytanie? Odpowiedź! Trzecie... Czwarte.', 4],
  ])('counts %j as %i sentences', (text, expected) => {
    expect(countSentences(text)).toBe(expected);
  });

  it.each([
    'Umowa zawarta 1.02.2024 r. między stronami. Kwota wynosi 1 500,00 zł. Termin płatności to 14 dni.',
    'Firma ABC Sp. z o.o. wystawiła fakturę. Kwota to 100 PLN. Termin minął.',
    'Faktura dotyczy usług IT, np. hostingu i wsparcia. Kwota 1.5 mln zł. Płatne do 10 maja.',
  ])('does not split on dates, abbreviations or decimals: %j', (text) => {
    expect(countSentences(text)).toBe(3);
  });
});
