import { describe, expect, it } from 'vitest';
import { analyzeDocument, InvalidLlmOutputError } from './analyzeDocument.ts';
import { LlmError } from './llmClient.ts';
import { LLM_RESPONSE_JSON_SCHEMA, type LlmInsight } from './llmOutputSchema.ts';
import { FEW_SHOT_EXAMPLES, SYSTEM_INSTRUCTION } from './prompt.ts';
import type { AnalyzeRequest } from './requestBody.ts';
import { createFakeLlmClient, textReply } from './test/fakeLlmClient.ts';

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
  return { ...output, document: { ...output.document, summary } };
}

const CORRECTION_PREFIX = 'Your previous JSON did not match the required schema due to: ';
const CORRECTION_SUFFIX = '. Fix this and return a valid JSON.';

describe('analyzeDocument', () => {
  it('returns the analysis with fileName and pages taken from the request', async () => {
    const fake = createFakeLlmClient([textReply(validOutput())]);

    const insight = await analyzeDocument(input, fake.client);

    expect(insight.document.fileName).toBe('faktura.pdf');
    expect(insight.document.pages).toBe(2);
    expect(insight.type).toBe('faktura');
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
    expect(correction).toContain('document.summary');
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
});
