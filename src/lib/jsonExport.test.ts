import { describe, expect, it } from 'vitest';
import { createInsight } from '../test/insightFixture.ts';
import { documentInsightSchema } from '../types/schema.ts';
import { buildJsonFileName, serializeInsight } from './jsonExport.ts';

describe('buildJsonFileName', () => {
  it('replaces the .pdf extension', () => {
    expect(buildJsonFileName('umowa.pdf')).toBe('umowa-insight.json');
  });

  it('handles an upper-case extension and keeps Polish characters', () => {
    expect(buildJsonFileName('Sprawozdanie roczne ŁÓDŹ.PDF')).toBe(
      'Sprawozdanie roczne ŁÓDŹ-insight.json',
    );
  });

  it('replaces characters that are not allowed in file names', () => {
    expect(buildJsonFileName('a/b\\c:d*e?"f<g>h|i.pdf')).toBe('a_b_c_d_e__f_g_h_i-insight.json');
  });

  it('falls back to a default name', () => {
    expect(buildJsonFileName('.pdf')).toBe('dokument-insight.json');
  });

  it('shortens very long names', () => {
    const fileName = buildJsonFileName(`${'a'.repeat(200)}.pdf`);

    expect(fileName).toBe(`${'a'.repeat(80)}-insight.json`);
  });
});

describe('serializeInsight', () => {
  it('produces JSON that parses back to a valid analysis', () => {
    const insight = createInsight();
    const parsed: unknown = JSON.parse(serializeInsight(insight));

    expect(documentInsightSchema.parse(parsed)).toEqual(insight);
  });
});
