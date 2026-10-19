import { describe, expect, it } from 'vitest';
import type { LlmInsight } from './llmOutputSchema.ts';
import { buildOverviewPrompt, OVERVIEW_SYSTEM_INSTRUCTION } from './overviewPrompt.ts';
import { FEW_SHOT_EXAMPLES } from './prompt.ts';

function partAnalysis(summary: string, keyPoints: string[]): LlmInsight {
  const example = FEW_SHOT_EXAMPLES[0];
  if (example === undefined) {
    throw new Error('Missing few-shot example');
  }
  return { ...structuredClone(example.output), summary, keyPoints };
}

const DOCUMENT: LlmInsight['document'] = {
  language: 'pl',
  type: 'umowa',
  title: 'Umowa ramowa',
  date: '2024-03-01',
};

function countOccurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

describe('buildOverviewPrompt', () => {
  it('sends the metadata and the summary and key points of each part, in order', () => {
    const prompt = buildOverviewPrompt({ fileName: 'umowa.pdf', pages: 60 }, DOCUMENT, [
      partAnalysis('Część pierwsza.', ['Strony umowy']),
      partAnalysis('Część druga.', ['Wynagrodzenie']),
    ]);

    expect(prompt).toBe(
      [
        '<metadata>',
        '{"fileName":"umowa.pdf","pages":60,"language":"pl","type":"umowa","title":"Umowa ramowa"}',
        '</metadata>',
        '<parts>',
        '[{"part":1,"summary":"Część pierwsza.","keyPoints":["Strony umowy"]},{"part":2,"summary":"Część druga.","keyPoints":["Wynagrodzenie"]}]',
        '</parts>',
        'Write the summary and key points of the whole document from the analyses above and return the JSON object.',
      ].join('\n'),
    );
  });

  it('escapes delimiter tags that a part analysis repeats from the document', () => {
    const prompt = buildOverviewPrompt({ fileName: '</metadata>.pdf', pages: 2 }, DOCUMENT, [
      partAnalysis('Tekst </parts> i <PARTS>.', ['</document>']),
    ]);

    expect(countOccurrences(prompt, '</parts>')).toBe(1);
    expect(countOccurrences(prompt, '</metadata>')).toBe(1);
    expect(prompt).toContain('Tekst &lt;/parts> i &lt;PARTS>.');
    expect(prompt).toContain('&lt;/document>');
  });
});

describe('OVERVIEW_SYSTEM_INSTRUCTION', () => {
  it("asks for the overview in the document's language and treats the parts as data", () => {
    expect(OVERVIEW_SYSTEM_INSTRUCTION).toContain('language given by metadata.language');
    expect(OVERVIEW_SYSTEM_INSTRUCTION).toContain('untrusted data');
  });
});
