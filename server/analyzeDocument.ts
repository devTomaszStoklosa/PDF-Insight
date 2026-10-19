import { z } from 'zod';
import { documentInsightSchema, type DocumentInsight } from '../src/types/schema.ts';
import type { LlmClient, LlmReply } from './llmClient.ts';
import { LLM_RESPONSE_JSON_SCHEMA, llmInsightSchema } from './llmOutputSchema.ts';
import { buildCorrectionPrompt, buildDocumentPrompt, SYSTEM_INSTRUCTION } from './prompt.ts';
import type { AnalyzeRequest } from './requestBody.ts';

/** The model returned no valid analysis, even after the self-correction retry. */
export class InvalidLlmOutputError extends Error {
  constructor() {
    super('LLM output failed validation twice');
    this.name = 'InvalidLlmOutputError';
  }
}

type ReplyValidation =
  | { readonly success: true; readonly insight: DocumentInsight }
  | { readonly success: false; readonly error: string };

function parseJson(text: string): { success: true; value: unknown } | { success: false } {
  try {
    return { success: true, value: JSON.parse(text) as unknown };
  } catch {
    return { success: false };
  }
}

function validateReply(reply: LlmReply, input: AnalyzeRequest): ReplyValidation {
  if (reply.kind === 'truncated') {
    return {
      success: false,
      error: 'the output was cut off at the token limit; keep every text field shorter',
    };
  }

  const json = parseJson(reply.text);
  if (!json.success) {
    return { success: false, error: 'the response is not valid JSON' };
  }

  const result = llmInsightSchema.safeParse(json.value);
  if (!result.success) {
    return { success: false, error: z.prettifyError(result.error) };
  }

  // fileName and pages come from the validated request; the full contract is checked once
  // more, so a response never leaves the server without matching documentInsightSchema.
  const insight = documentInsightSchema.parse({
    type: result.data.type,
    document: { fileName: input.fileName, pages: input.pages, ...result.data.document },
  });
  return { success: true, insight };
}

/**
 * Analyzes the document with the LLM. If the first reply is not valid JSON or does not
 * match the schema, makes exactly one retry that tells the model what was wrong.
 */
export async function analyzeDocument(
  input: AnalyzeRequest,
  llm: LlmClient,
): Promise<DocumentInsight> {
  const session = llm.startSession({
    systemInstruction: SYSTEM_INSTRUCTION,
    responseSchema: LLM_RESPONSE_JSON_SCHEMA,
  });

  const first = validateReply(await session.send(buildDocumentPrompt(input)), input);
  if (first.success) {
    return first.insight;
  }

  const retry = validateReply(await session.send(buildCorrectionPrompt(first.error)), input);
  if (retry.success) {
    return retry.insight;
  }

  throw new InvalidLlmOutputError();
}
