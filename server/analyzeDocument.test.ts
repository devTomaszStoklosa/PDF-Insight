import { describe, expect, it } from 'vitest';
import { analyzeDocument, MAX_PARALLEL_REQUESTS } from './analyzeDocument.ts';
import { LlmError } from './llmClient.ts';
import {
  LLM_RESPONSE_JSON_SCHEMA,
  OVERVIEW_RESPONSE_JSON_SCHEMA,
  type LlmInsight,
  type LlmOverview,
} from './llmOutputSchema.ts';
import { OVERVIEW_SYSTEM_INSTRUCTION } from './overviewPrompt.ts';
import { FEW_SHOT_EXAMPLES, SYSTEM_INSTRUCTION } from './prompt.ts';
import type { AnalyzeRequest } from './requestBody.ts';
import { InvalidLlmOutputError } from './structuredReply.ts';
import { createFakeLlmClient, textReply } from './test/fakeLlmClient.ts';
import { TARGET_CHUNK_CHARS } from './textChunks.ts';

const input: AnalyzeRequest = {
  fileName: 'faktura.pdf',
  pages: 2,
  text: 'Faktura VAT nr 1/2024. Do zapłaty 1 230,00 zł.',
};

function validOutput(): LlmInsight {
  const example = FEW_SHOT_EXAMPLES[0];
  if (example === undefined) {
    throw new Error('Missing few-shot example');
  }
  return structuredClone(example.output);
}

function withSummary(summary: string): LlmInsight {
  const output = validOutput();
  return { ...output, summary };
}

const CORRECTION_PREFIX = 'Your previous JSON did not match the required schema due to: ';
const CORRECTION_SUFFIX = '. Fix this and return a valid JSON.';

describe('analyzeDocument', () => {
  it('returns the analysis with fileName and pages taken from the request', async () => {
    const fake = createFakeLlmClient([textReply(validOutput())]);

    const insight = await analyzeDocument(input, fake.client);

    expect(insight.document.fileName).toBe('faktura.pdf');
    expect(insight.document.pages).toBe(2);
    expect(insight.document.type).toBe('faktura');
    expect(fake.sentMessages).toHaveLength(1);
  });

  it('starts the session with the system instruction and the response schema', async () => {
    const fake = createFakeLlmClient([textReply(validOutput())]);

    await analyzeDocument(input, fake.client);

    expect(fake.sessionOptions).toEqual([
      { systemInstruction: SYSTEM_INSTRUCTION, responseSchema: LLM_RESPONSE_JSON_SCHEMA },
    ]);
  });

  it('sends the document text inside the document block', async () => {
    const fake = createFakeLlmClient([textReply(validOutput())]);

    await analyzeDocument(input, fake.client);

    expect(fake.sentMessages[0]).toContain(`<document>\n${input.text}\n</document>`);
  });

  it('retries once with the validation error when the schema is violated', async () => {
    const fake = createFakeLlmClient([
      textReply(withSummary('Za krótkie podsumowanie.')),
      textReply(validOutput()),
    ]);

    const insight = await analyzeDocument(input, fake.client);

    expect(insight.document.fileName).toBe('faktura.pdf');
    expect(fake.sentMessages).toHaveLength(2);
    const correction = fake.sentMessages[1] ?? '';
    expect(correction.startsWith(CORRECTION_PREFIX)).toBe(true);
    expect(correction.endsWith(CORRECTION_SUFFIX)).toBe(true);
    expect(correction).toContain('Summary must have 3-5 sentences');
    expect(correction).toContain('at summary');
  });

  it('retries once when the reply is not valid JSON', async () => {
    const fake = createFakeLlmClient([
      textReply('```json\n{"type": "faktura"}\n```'),
      textReply(validOutput()),
    ]);

    await analyzeDocument(input, fake.client);

    expect(fake.sentMessages[1]).toBe(
      `${CORRECTION_PREFIX}the response is not valid JSON${CORRECTION_SUFFIX}`,
    );
  });

  it('retries once when the reply was truncated at the token limit', async () => {
    const fake = createFakeLlmClient([{ kind: 'truncated' }, textReply(validOutput())]);

    await analyzeDocument(input, fake.client);

    expect(fake.sentMessages[1]).toContain('cut off at the token limit');
  });

  it('rejects keys the model must not set, such as fileName', async () => {
    const output = validOutput();
    const withFileName = { ...output, document: { ...output.document, fileName: 'inny.pdf' } };
    const fake = createFakeLlmClient([textReply(withFileName), textReply(validOutput())]);

    const insight = await analyzeDocument(input, fake.client);

    expect(insight.document.fileName).toBe('faktura.pdf');
    expect(fake.sentMessages[1]).toContain('fileName');
  });

  it('fails after exactly two invalid replies', async () => {
    const fake = createFakeLlmClient([textReply('not json'), textReply({ type: 'faktura' })]);

    await expect(analyzeDocument(input, fake.client)).rejects.toBeInstanceOf(InvalidLlmOutputError);
    expect(fake.sentMessages).toHaveLength(2);
  });

  it('does not retry when the provider fails', async () => {
    const fake = createFakeLlmClient([new LlmError('unavailable')]);

    await expect(analyzeDocument(input, fake.client)).rejects.toBeInstanceOf(LlmError);
    expect(fake.sentMessages).toHaveLength(1);
  });

  it('analyzes text of the target part length in one call', async () => {
    const fake = createFakeLlmClient([textReply(validOutput())]);

    await analyzeDocument({ ...input, text: 'a'.repeat(TARGET_CHUNK_CHARS) }, fake.client);

    expect(fake.sentMessages).toHaveLength(1);
    expect(fake.sentMessages[0]).not.toContain('totalParts');
  });
});

describe('analyzeDocument with a long document', () => {
  // 100 pages of 1,000 characters: longer than two parts, so it is analyzed in three.
  const longInput: AnalyzeRequest = {
    fileName: 'umowa-ramowa.pdf',
    pages: 100,
    text: Array.from({ length: 100 }, () => 'x'.repeat(998)).join('\n\n'),
  };

  function partOutput(overrides: Partial<LlmInsight>): LlmInsight {
    return { ...validOutput(), ...overrides };
  }

  const overview: LlmOverview = {
    summary:
      'Umowa ramowa określa współpracę stron. Obejmuje hosting serwerów. Wynagrodzenie płatne jest co miesiąc.',
    keyPoints: ['Strony umowy', 'Zakres usług', 'Wynagrodzenie miesięczne'],
  };

  function partReplies(): ReturnType<typeof textReply>[] {
    return [
      textReply(partOutput({ keywords: ['hosting', 'umowa'] })),
      textReply(partOutput({ keywords: ['umowa', 'VPS'] })),
      textReply(partOutput({ keywords: ['umowa'] })),
    ];
  }

  it('analyzes each part, then writes the overview from their analyses', async () => {
    const fake = createFakeLlmClient([...partReplies(), textReply(overview)]);

    const insight = await analyzeDocument(longInput, fake.client);

    expect(fake.sentMessages).toHaveLength(4);
    for (const [index, message] of fake.sentMessages.slice(0, 3).entries()) {
      expect(message).toContain(`"part":${String(index + 1)},"totalParts":3`);
      expect(message).toContain(`part ${String(index + 1)} of 3 of a longer document`);
    }
    expect(fake.sentMessages[3]).toContain('<parts>');
    expect(fake.sessionOptions).toEqual([
      ...Array.from({ length: 3 }, () => ({
        systemInstruction: SYSTEM_INSTRUCTION,
        responseSchema: LLM_RESPONSE_JSON_SCHEMA,
      })),
      {
        systemInstruction: OVERVIEW_SYSTEM_INSTRUCTION,
        responseSchema: OVERVIEW_RESPONSE_JSON_SCHEMA,
      },
    ]);
    expect(insight.summary).toBe(overview.summary);
    expect(insight.keyPoints).toEqual(overview.keyPoints);
  });

  it('returns one result in the contract, with repeated mentions merged', async () => {
    const fake = createFakeLlmClient([...partReplies(), textReply(overview)]);

    const insight = await analyzeDocument(longInput, fake.client);

    const example = validOutput();
    expect(Object.keys(insight)).toEqual([
      'document',
      'summary',
      'keyPoints',
      'entities',
      'amounts',
      'dates',
      'keywords',
    ]);
    expect(insight.document).toEqual({
      fileName: 'umowa-ramowa.pdf',
      pages: 100,
      ...example.document,
    });
    expect(insight.entities).toEqual(example.entities);
    expect(insight.amounts).toEqual(example.amounts);
    expect(insight.dates).toEqual(example.dates);
    expect(insight.keywords).toEqual(['umowa', 'hosting', 'VPS']);
  });

  it('retries only the part whose reply breaks the schema', async () => {
    const fake = createFakeLlmClient([
      textReply(withSummary('Za krótkie podsumowanie.')),
      ...partReplies().slice(1),
      textReply(validOutput()),
      textReply(overview),
    ]);

    await analyzeDocument(longInput, fake.client);

    expect(fake.sentMessages).toHaveLength(5);
    expect(fake.sentMessages[3]?.startsWith(CORRECTION_PREFIX)).toBe(true);
  });

  it('fails the whole analysis when a part fails, without writing an overview', async () => {
    const fake = createFakeLlmClient([
      new LlmError('quota_exceeded', { upstreamStatus: 429 }),
      ...partReplies().slice(1),
    ]);

    await expect(analyzeDocument(longInput, fake.client)).rejects.toBeInstanceOf(LlmError);
    expect(fake.sentMessages).toHaveLength(3);
  });

  describe('with the most parts', () => {
    // 200 pages of 1,000 characters make six parts, more than run at once.
    const longestInput: AnalyzeRequest = {
      ...longInput,
      pages: 200,
      text: Array.from({ length: 200 }, () => 'x'.repeat(998)).join('\n\n'),
    };

    it('analyzes at most MAX_PARALLEL_REQUESTS parts at once', async () => {
      const fake = createFakeLlmClient([
        ...Array.from({ length: 6 }, () => textReply(validOutput())),
        textReply(overview),
      ]);

      await analyzeDocument(longestInput, fake.client);

      expect(fake.sentMessages).toHaveLength(7);
      for (let part = 1; part <= 6; part += 1) {
        const marker = `part ${String(part)} of 6 of a longer document`;
        expect(fake.sentMessages.filter((message) => message.includes(marker))).toHaveLength(1);
      }
      expect(fake.maxConcurrentRequests()).toBe(MAX_PARALLEL_REQUESTS);
    });

    it('starts no further part after a part fails', async () => {
      const fake = createFakeLlmClient([
        new LlmError('unavailable', { upstreamStatus: 503 }),
        ...Array.from({ length: 5 }, () => textReply(validOutput())),
        textReply(overview),
      ]);

      await expect(analyzeDocument(longestInput, fake.client)).rejects.toBeInstanceOf(LlmError);
      expect(fake.sentMessages).toHaveLength(MAX_PARALLEL_REQUESTS);
    });
  });

  it('retries the overview once, then fails when it still breaks the schema', async () => {
    const shortSummary = { ...overview, summary: 'Jedno zdanie.' };
    const fake = createFakeLlmClient([
      ...partReplies(),
      textReply(shortSummary),
      textReply(shortSummary),
    ]);

    await expect(analyzeDocument(longInput, fake.client)).rejects.toBeInstanceOf(
      InvalidLlmOutputError,
    );
    expect(fake.sentMessages).toHaveLength(5);
    expect(fake.sentMessages[4]).toContain('Summary must have 3-5 sentences');
  });
});
