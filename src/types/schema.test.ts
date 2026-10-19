import { describe, expect, it } from 'vitest';
import { documentInsightSchema, documentTypeSchema, type DocumentInsight } from './schema.ts';

function createValidInsight(): DocumentInsight {
  return {
    type: 'faktura',
    document: {
      fileName: 'faktura-03-2024.pdf',
      pages: 2,
      language: 'pl',
      title: 'Faktura VAT nr FV/03/2024',
      date: '2024-03-15',
      summary:
        'Faktura VAT wystawiona przez ABC Sp. z o.o. dla XYZ S.A. Dotyczy usług hostingu za marzec 2024 r. Kwota do zapłaty wynosi 1 230,00 zł brutto.',
      keyPoints: [
        'Sprzedawca: ABC Sp. z o.o.',
        'Nabywca: XYZ S.A.',
        'Termin płatności: 29 marca 2024 r.',
      ],
      entities: {
        organizations: ['ABC Sp. z o.o.', 'XYZ S.A.'],
        people: ['Jan Kowalski'],
      },
      amounts: [{ value: 1230, currency: 'PLN', context: 'Kwota brutto do zapłaty' }],
      dates: [{ date: '2024-03-29', context: 'Termin płatności' }],
      keywords: ['faktura', 'hosting', 'VAT'],
    },
  };
}

function withDocument(overrides: Record<string, unknown>): unknown {
  const insight = createValidInsight();
  return { ...insight, document: { ...insight.document, ...overrides } };
}

function omitKey(source: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([entryKey]) => entryKey !== key));
}

function withoutDocumentKey(key: string): unknown {
  const insight = createValidInsight();
  return { ...insight, document: omitKey(insight.document, key) };
}

/** Asserts the payload is rejected, and only because of the field at `path`. */
function expectInvalidAt(payload: unknown, path: readonly PropertyKey[]): void {
  const result = documentInsightSchema.safeParse(payload);

  expect(result.success).toBe(false);
  const issuePaths = result.error?.issues.map((issue) => issue.path) ?? [];
  expect(issuePaths.length).toBeGreaterThan(0);
  for (const issuePath of issuePaths) {
    expect(issuePath).toEqual(path);
  }
}

const twoSentences = 'Pierwsze zdanie. Drugie zdanie.';
const fiveSentences = 'Jeden. Dwa. Trzy. Cztery. Pięć.';
const sixSentences = 'Jeden. Dwa. Trzy. Cztery. Pięć. Sześć.';

describe('documentInsightSchema', () => {
  describe('valid payloads', () => {
    it('accepts a complete analysis', () => {
      const insight = createValidInsight();

      const result = documentInsightSchema.safeParse(insight);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(insight);
    });

    it('accepts null and empty lists when information is missing', () => {
      const payload = withDocument({
        title: null,
        date: null,
        entities: { organizations: [], people: [] },
        amounts: [],
        dates: [],
        keywords: [],
      });

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a raw JSON response from the LLM backend', () => {
      const rawJson = `{
        "type": "umowa",
        "document": {
          "fileName": "umowa.pdf",
          "pages": 5,
          "language": "pl",
          "title": null,
          "date": null,
          "summary": "Umowa najmu lokalu użytkowego. Czynsz wynosi 4 000 zł miesięcznie. Umowa jest zawarta na czas nieokreślony.",
          "keyPoints": ["Najem lokalu", "Czynsz miesięczny", "Czas nieokreślony"],
          "entities": { "organizations": [], "people": ["Anna Nowak"] },
          "amounts": [{ "value": 4000, "currency": "PLN", "context": "Czynsz miesięczny" }],
          "dates": [],
          "keywords": ["najem", "czynsz"]
        }
      }`;

      expect(documentInsightSchema.safeParse(JSON.parse(rawJson)).success).toBe(true);
    });

    it.each(documentTypeSchema.options)('accepts document type %j', (type) => {
      expect(documentInsightSchema.safeParse({ ...createValidInsight(), type }).success).toBe(true);
    });

    it('accepts the upper limits of summary sentences and key points', () => {
      const payload = withDocument({
        summary: fiveSentences,
        keyPoints: ['1', '2', '3', '4', '5', '6', '7'],
      });

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a negative amount and a leap day', () => {
      const payload = withDocument({
        date: '2024-02-29',
        amounts: [{ value: -150.5, currency: 'EUR', context: 'Korekta faktury' }],
      });

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('trims surrounding whitespace from text fields', () => {
      const result = documentInsightSchema.safeParse(withDocument({ title: '  Umowa najmu \n' }));

      expect(result.data?.document.title).toBe('Umowa najmu');
    });
  });

  describe('invalid payloads', () => {
    const insight = createValidInsight();

    it.each<[string, unknown, readonly PropertyKey[]]>([
      ['unknown document type', { ...insight, type: 'umowa-zlecenie' }, ['type']],
      ['missing type', omitKey(insight, 'type'), ['type']],
      ['missing document', omitKey(insight, 'document'), ['document']],
      ['unknown top-level key', { ...insight, confidence: 0.9 }, []],
      ['unknown document key', withDocument({ confidence: 0.9 }), ['document']],
      ['empty file name', withDocument({ fileName: '' }), ['document', 'fileName']],
      ['zero pages', withDocument({ pages: 0 }), ['document', 'pages']],
      ['fractional pages', withDocument({ pages: 2.5 }), ['document', 'pages']],
      ['pages as a string', withDocument({ pages: '3' }), ['document', 'pages']],
      ['uppercase language', withDocument({ language: 'PL' }), ['document', 'language']],
      ['three-letter language', withDocument({ language: 'pol' }), ['document', 'language']],
      ['empty title', withDocument({ title: '' }), ['document', 'title']],
      ['blank title', withDocument({ title: '   ' }), ['document', 'title']],
      ['missing title', withoutDocumentKey('title'), ['document', 'title']],
      ['month out of range', withDocument({ date: '2024-13-01' }), ['document', 'date']],
      ['impossible day', withDocument({ date: '2024-02-30' }), ['document', 'date']],
      ['non-ISO date', withDocument({ date: '15.03.2024' }), ['document', 'date']],
      ['datetime', withDocument({ date: '2024-03-15T10:00:00Z' }), ['document', 'date']],
      ['missing date', withoutDocumentKey('date'), ['document', 'date']],
      ['empty summary', withDocument({ summary: '' }), ['document', 'summary']],
      [
        'summary below 3 sentences',
        withDocument({ summary: twoSentences }),
        ['document', 'summary'],
      ],
      [
        'summary above 5 sentences',
        withDocument({ summary: sixSentences }),
        ['document', 'summary'],
      ],
      ['empty key points', withDocument({ keyPoints: [] }), ['document', 'keyPoints']],
      ['2 key points', withDocument({ keyPoints: ['1', '2'] }), ['document', 'keyPoints']],
      [
        '8 key points',
        withDocument({ keyPoints: ['1', '2', '3', '4', '5', '6', '7', '8'] }),
        ['document', 'keyPoints'],
      ],
      [
        'blank key point',
        withDocument({ keyPoints: ['1', ' ', '3'] }),
        ['document', 'keyPoints', 1],
      ],
      [
        'missing people',
        withDocument({ entities: { organizations: [] } }),
        ['document', 'entities', 'people'],
      ],
      [
        'null organizations',
        withDocument({ entities: { organizations: null, people: [] } }),
        ['document', 'entities', 'organizations'],
      ],
      [
        'empty person name',
        withDocument({ entities: { organizations: [], people: [''] } }),
        ['document', 'entities', 'people', 0],
      ],
      ['null amounts', withDocument({ amounts: null }), ['document', 'amounts']],
      [
        'amount value as a string',
        withDocument({ amounts: [{ value: '1500', currency: 'PLN', context: 'Cena' }] }),
        ['document', 'amounts', 0, 'value'],
      ],
      [
        'currency symbol',
        withDocument({ amounts: [{ value: 1500, currency: 'zł', context: 'Cena' }] }),
        ['document', 'amounts', 0, 'currency'],
      ],
      [
        'lowercase currency',
        withDocument({ amounts: [{ value: 1500, currency: 'pln', context: 'Cena' }] }),
        ['document', 'amounts', 0, 'currency'],
      ],
      [
        'missing amount context',
        withDocument({ amounts: [{ value: 1500, currency: 'PLN' }] }),
        ['document', 'amounts', 0, 'context'],
      ],
      [
        'unknown amount key',
        withDocument({ amounts: [{ value: 1500, currency: 'PLN', context: 'Cena', vat: 23 }] }),
        ['document', 'amounts', 0],
      ],
      [
        'non-ISO date mention',
        withDocument({ dates: [{ date: '29.03.2024', context: 'Termin płatności' }] }),
        ['document', 'dates', 0, 'date'],
      ],
      [
        'empty date context',
        withDocument({ dates: [{ date: '2024-03-29', context: '' }] }),
        ['document', 'dates', 0, 'context'],
      ],
      ['null keywords', withDocument({ keywords: null }), ['document', 'keywords']],
      ['missing keywords', withoutDocumentKey('keywords'), ['document', 'keywords']],
      ['empty keyword', withDocument({ keywords: [''] }), ['document', 'keywords', 0]],
    ])('rejects %s', (_case, payload, path) => {
      expectInvalidAt(payload, path);
    });

    it.each([
      ['an empty object', {}],
      ['an array', []],
      ['null', null],
      ['a JSON string', JSON.stringify(insight)],
    ])('rejects %s', (_case, payload) => {
      expect(documentInsightSchema.safeParse(payload).success).toBe(false);
    });
  });
});
