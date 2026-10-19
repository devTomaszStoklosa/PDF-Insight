import { describe, expect, it } from 'vitest';
import { documentInsightSchema, documentTypeSchema, type DocumentInsight } from './schema.ts';

function createValidInsight(): DocumentInsight {
  return {
    document: {
      fileName: 'faktura-03-2024.pdf',
      pages: 2,
      language: 'pl',
      type: 'faktura',
      title: 'Faktura VAT nr FV/03/2024',
      date: '2024-03-15',
    },
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
  };
}

/** Overrides top-level analysis fields such as `summary` or `amounts`. */
function withFields(overrides: Record<string, unknown>): unknown {
  return { ...createValidInsight(), ...overrides };
}

/** Overrides fields of the `document` metadata. */
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
      const insight = createValidInsight();
      const payload = {
        ...insight,
        document: { ...insight.document, title: null, date: null },
        entities: { organizations: [], people: [] },
        amounts: [],
        dates: [],
        keywords: [],
      };

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a raw JSON response from the LLM backend', () => {
      const rawJson = `{
        "document": {
          "fileName": "umowa.pdf",
          "pages": 5,
          "language": "pl",
          "type": "umowa",
          "title": null,
          "date": null
        },
        "summary": "Umowa najmu lokalu użytkowego. Czynsz wynosi 4 000 zł miesięcznie. Umowa jest zawarta na czas nieokreślony.",
        "keyPoints": ["Najem lokalu", "Czynsz miesięczny", "Czas nieokreślony"],
        "entities": { "organizations": [], "people": ["Anna Nowak"] },
        "amounts": [{ "value": 4000, "currency": "PLN", "context": "Czynsz miesięczny" }],
        "dates": [],
        "keywords": ["najem", "czynsz"]
      }`;

      expect(documentInsightSchema.safeParse(JSON.parse(rawJson)).success).toBe(true);
    });

    it.each(documentTypeSchema.options)('accepts document type %j', (type) => {
      expect(documentInsightSchema.safeParse(withDocument({ type })).success).toBe(true);
    });

    it('accepts the upper limits of summary sentences and key points', () => {
      const payload = withFields({
        summary: fiveSentences,
        keyPoints: ['1', '2', '3', '4', '5', '6', '7'],
      });

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('accepts a negative amount and a leap day', () => {
      const insight = createValidInsight();
      const payload = {
        ...insight,
        document: { ...insight.document, date: '2024-02-29' },
        amounts: [{ value: -150.5, currency: 'EUR', context: 'Korekta faktury' }],
      };

      expect(documentInsightSchema.safeParse(payload).success).toBe(true);
    });

    it('trims surrounding whitespace from text fields', () => {
      const result = documentInsightSchema.safeParse(withDocument({ title: '  Umowa najmu \n' }));

      expect(result.data?.document.title).toBe('Umowa najmu');
    });

    it('accepts JSON in the layout of the example in the brief', () => {
      // Section 04 of the brief, with enough sentences and key points to pass the limits.
      const briefExample = `{
        "document": {
          "fileName": "umowa.pdf",
          "pages": 4,
          "language": "pl",
          "type": "umowa",
          "title": "Umowa serwisowa",
          "date": "2026-09-01"
        },
        "summary": "Umowa określa zasady świadczenia usług serwisowych. Obowiązuje przez 12 miesięcy. Wynagrodzenie wynosi 12 500 zł.",
        "keyPoints": ["Okres umowy 12 mies.", "Wynagrodzenie 12 500 zł", "Termin płatności 1 października 2026 r."],
        "entities": {
          "organizations": ["Przykład sp. z o.o."],
          "people": []
        },
        "amounts": [
          { "value": 12500.00, "currency": "PLN", "context": "wynagrodzenie" }
        ],
        "dates": [
          { "date": "2026-10-01", "context": "termin płatności" }
        ],
        "keywords": ["serwis", "SLA"]
      }`;

      expect(documentInsightSchema.safeParse(JSON.parse(briefExample)).success).toBe(true);
    });

    it('outputs the keys in the order of the brief, whatever the input order', () => {
      const insight = createValidInsight();
      const reversed = Object.fromEntries(
        Object.entries({
          ...insight,
          document: Object.fromEntries(Object.entries(insight.document).reverse()),
        }).reverse(),
      );

      const parsed = documentInsightSchema.parse(reversed);

      expect(Object.keys(parsed)).toEqual([
        'document',
        'summary',
        'keyPoints',
        'entities',
        'amounts',
        'dates',
        'keywords',
      ]);
      expect(Object.keys(parsed.document)).toEqual([
        'fileName',
        'pages',
        'language',
        'type',
        'title',
        'date',
      ]);
    });
  });

  describe('invalid payloads', () => {
    const insight = createValidInsight();

    it.each<[string, unknown, readonly PropertyKey[]]>([
      ['unknown document type', withDocument({ type: 'umowa-zlecenie' }), ['document', 'type']],
      ['missing type', withoutDocumentKey('type'), ['document', 'type']],
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
      ['empty summary', withFields({ summary: '' }), ['summary']],
      ['summary below 3 sentences', withFields({ summary: twoSentences }), ['summary']],
      ['summary above 5 sentences', withFields({ summary: sixSentences }), ['summary']],
      ['empty key points', withFields({ keyPoints: [] }), ['keyPoints']],
      ['2 key points', withFields({ keyPoints: ['1', '2'] }), ['keyPoints']],
      [
        '8 key points',
        withFields({ keyPoints: ['1', '2', '3', '4', '5', '6', '7', '8'] }),
        ['keyPoints'],
      ],
      ['blank key point', withFields({ keyPoints: ['1', ' ', '3'] }), ['keyPoints', 1]],
      ['missing people', withFields({ entities: { organizations: [] } }), ['entities', 'people']],
      [
        'null organizations',
        withFields({ entities: { organizations: null, people: [] } }),
        ['entities', 'organizations'],
      ],
      [
        'empty person name',
        withFields({ entities: { organizations: [], people: [''] } }),
        ['entities', 'people', 0],
      ],
      ['null amounts', withFields({ amounts: null }), ['amounts']],
      [
        'amount value as a string',
        withFields({ amounts: [{ value: '1500', currency: 'PLN', context: 'Cena' }] }),
        ['amounts', 0, 'value'],
      ],
      [
        'currency symbol',
        withFields({ amounts: [{ value: 1500, currency: 'zł', context: 'Cena' }] }),
        ['amounts', 0, 'currency'],
      ],
      [
        'lowercase currency',
        withFields({ amounts: [{ value: 1500, currency: 'pln', context: 'Cena' }] }),
        ['amounts', 0, 'currency'],
      ],
      [
        'missing amount context',
        withFields({ amounts: [{ value: 1500, currency: 'PLN' }] }),
        ['amounts', 0, 'context'],
      ],
      [
        'unknown amount key',
        withFields({ amounts: [{ value: 1500, currency: 'PLN', context: 'Cena', vat: 23 }] }),
        ['amounts', 0],
      ],
      [
        'non-ISO date mention',
        withFields({ dates: [{ date: '29.03.2024', context: 'Termin płatności' }] }),
        ['dates', 0, 'date'],
      ],
      [
        'empty date context',
        withFields({ dates: [{ date: '2024-03-29', context: '' }] }),
        ['dates', 0, 'context'],
      ],
      ['null keywords', withFields({ keywords: null }), ['keywords']],
      ['missing keywords', omitKey(insight, 'keywords'), ['keywords']],
      ['empty keyword', withFields({ keywords: [''] }), ['keywords', 0]],
    ])('rejects %s', (_case, payload, path) => {
      expectInvalidAt(payload, path);
    });

    it('rejects the previous layout with the analysis inside document', () => {
      const { document, ...analysis } = insight;
      const previousLayout = {
        type: document.type,
        document: { ...omitKey(document, 'type'), ...analysis },
      };

      expect(documentInsightSchema.safeParse(previousLayout).success).toBe(false);
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
