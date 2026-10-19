import { describe, expect, it } from 'vitest';
import type { LlmInsight } from './llmOutputSchema.ts';
import { MAX_MERGED_KEYWORDS, mergePartialInsights } from './mergePartialInsights.ts';

type PartOverrides = Partial<Omit<LlmInsight, 'document'>> & {
  readonly document?: Partial<LlmInsight['document']>;
};

function part(overrides: PartOverrides = {}): LlmInsight {
  return {
    summary: 'Pierwsze zdanie. Drugie zdanie. Trzecie zdanie.',
    keyPoints: ['Punkt pierwszy', 'Punkt drugi', 'Punkt trzeci'],
    entities: { organizations: [], people: [] },
    amounts: [],
    dates: [],
    keywords: [],
    ...overrides,
    document: { language: 'pl', type: 'umowa', title: null, date: null, ...overrides.document },
  };
}

describe('mergePartialInsights', () => {
  describe('metadata', () => {
    it('takes the title from the first part only', () => {
      const merged = mergePartialInsights([
        part({ document: { title: null } }),
        part({ document: { title: '§ 5. Wynagrodzenie' } }),
      ]);

      expect(merged.document.title).toBeNull();
    });

    it('takes the first date stated in document order', () => {
      const merged = mergePartialInsights([
        part({ document: { date: null } }),
        part({ document: { date: '2024-05-10' } }),
        part({ document: { date: '2024-06-01' } }),
      ]);

      expect(merged.document.date).toBe('2024-05-10');
    });

    it('takes the type from the first part that is not "inne"', () => {
      const merged = mergePartialInsights([
        part({ document: { type: 'inne' } }),
        part({ document: { type: 'raport' } }),
        part({ document: { type: 'faktura' } }),
      ]);

      expect(merged.document.type).toBe('raport');
    });

    it('falls back to "inne" when no part has another type', () => {
      const merged = mergePartialInsights([
        part({ document: { type: 'inne' } }),
        part({ document: { type: 'inne' } }),
      ]);

      expect(merged.document.type).toBe('inne');
    });

    it('takes the language of most parts, and of the earlier part on a tie', () => {
      const majority = mergePartialInsights([
        part({ document: { language: 'en' } }),
        part({ document: { language: 'pl' } }),
        part({ document: { language: 'pl' } }),
      ]);
      const tie = mergePartialInsights([
        part({ document: { language: 'en' } }),
        part({ document: { language: 'pl' } }),
      ]);

      expect(majority.document.language).toBe('pl');
      expect(tie.document.language).toBe('en');
    });
  });

  describe('lists', () => {
    it('drops repeated names regardless of case and spacing, keeping the first spelling', () => {
      const merged = mergePartialInsights([
        part({ entities: { organizations: ['Hostico Sp. z o.o.'], people: ['Jan Kowalski'] } }),
        part({
          entities: {
            organizations: ['HOSTICO  sp. z o.o.', 'Nowak Consulting S.A.'],
            people: ['jan kowalski', 'Anna Nowak'],
          },
        }),
      ]);

      expect(merged.entities).toEqual({
        organizations: ['Hostico Sp. z o.o.', 'Nowak Consulting S.A.'],
        people: ['Jan Kowalski', 'Anna Nowak'],
      });
    });

    it('drops an amount only when value, currency and context repeat', () => {
      const merged = mergePartialInsights([
        part({
          amounts: [
            { value: 10_000, currency: 'PLN', context: 'Rata za styczeń' },
            { value: 50_000, currency: 'PLN', context: 'Wynagrodzenie' },
          ],
        }),
        part({
          amounts: [
            { value: 10_000, currency: 'PLN', context: 'Rata za luty' },
            { value: 50_000, currency: 'PLN', context: 'wynagrodzenie ' },
            { value: 50_000, currency: 'EUR', context: 'Wynagrodzenie' },
          ],
        }),
      ]);

      expect(merged.amounts).toEqual([
        { value: 10_000, currency: 'PLN', context: 'Rata za styczeń' },
        { value: 50_000, currency: 'PLN', context: 'Wynagrodzenie' },
        { value: 10_000, currency: 'PLN', context: 'Rata za luty' },
        { value: 50_000, currency: 'EUR', context: 'Wynagrodzenie' },
      ]);
    });

    it('drops a date only when the date and its context repeat', () => {
      const merged = mergePartialInsights([
        part({ dates: [{ date: '2024-03-01', context: 'Data zawarcia umowy' }] }),
        part({
          dates: [
            { date: '2024-03-01', context: 'data zawarcia umowy' },
            { date: '2024-03-01', context: 'Początek okresu rozliczeniowego' },
          ],
        }),
      ]);

      expect(merged.dates).toEqual([
        { date: '2024-03-01', context: 'Data zawarcia umowy' },
        { date: '2024-03-01', context: 'Początek okresu rozliczeniowego' },
      ]);
    });

    it('ranks keywords by the number of parts that give them, then by first appearance', () => {
      const merged = mergePartialInsights([
        part({ keywords: ['umowa', 'najem', 'Kaucja', 'kaucja'] }),
        part({ keywords: ['kaucja', 'lokal'] }),
        part({ keywords: ['Lokal', 'kaucja'] }),
      ]);

      expect(merged.keywords).toEqual(['Kaucja', 'lokal', 'umowa', 'najem']);
    });

    it('keeps at most MAX_MERGED_KEYWORDS keywords', () => {
      const keywords = Array.from({ length: 8 }, (_, index) => `słowo ${String(index)}`);
      const merged = mergePartialInsights([
        part({ keywords }),
        part({ keywords: keywords.map((keyword) => `${keyword} b`) }),
      ]);

      expect(merged.keywords).toHaveLength(MAX_MERGED_KEYWORDS);
      expect(merged.keywords.slice(0, 8)).toEqual(keywords);
    });
  });

  it('refuses an empty list of parts', () => {
    expect(() => mergePartialInsights([])).toThrow(RangeError);
  });
});
