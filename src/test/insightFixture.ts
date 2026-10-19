import type { DocumentInsight } from '../types/schema.ts';

/** A valid analysis result for tests; pass overrides for the `document` metadata. */
export function createInsight(
  overrides: Partial<DocumentInsight['document']> = {},
): DocumentInsight {
  return {
    document: {
      fileName: 'faktura-03-2024.pdf',
      pages: 2,
      language: 'pl',
      type: 'faktura',
      title: 'Faktura VAT nr FV/03/2024',
      date: '2024-03-15',
      ...overrides,
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
