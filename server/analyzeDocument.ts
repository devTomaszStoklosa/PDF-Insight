import { documentInsightSchema, type DocumentInsight } from '../src/types/schema.ts';
import { mapWithConcurrency } from './concurrency.ts';
import type { LlmClient } from './llmClient.ts';
import {
  LLM_RESPONSE_JSON_SCHEMA,
  llmInsightSchema,
  llmOverviewSchema,
  OVERVIEW_RESPONSE_JSON_SCHEMA,
  type LlmInsight,
} from './llmOutputSchema.ts';
import { mergePartialInsights } from './mergePartialInsights.ts';
import { buildOverviewPrompt, OVERVIEW_SYSTEM_INSTRUCTION } from './overviewPrompt.ts';
import { buildDocumentPartPrompt, buildDocumentPrompt, SYSTEM_INSTRUCTION } from './prompt.ts';
import type { AnalyzeRequest } from './requestBody.ts';
import { requestStructuredReply } from './structuredReply.ts';
import { splitIntoChunks } from './textChunks.ts';

/**
 * Parts analyzed at once. Measured on the Gemini free tier with part-sized requests: 2 and 3
 * parallel requests all succeeded, while 6 parallel requests got 503 for 5 of them.
 */
export const MAX_PARALLEL_REQUESTS = 3;

/** One analysis call with its own session, so the correction retry sees only this text. */
function requestAnalysis(message: string, llm: LlmClient): Promise<LlmInsight> {
  const session = llm.startSession({
    systemInstruction: SYSTEM_INSTRUCTION,
    responseSchema: LLM_RESPONSE_JSON_SCHEMA,
  });
  return requestStructuredReply(session, message, llmInsightSchema);
}

/**
 * Analyzes each part, merges the lists and metadata in code, then makes one more call that
 * writes the summary and key points of the whole document from the analyses of the parts.
 */
async function analyzeInParts(
  input: AnalyzeRequest,
  chunks: readonly string[],
  llm: LlmClient,
): Promise<LlmInsight> {
  // The first failure fails the whole analysis and starts no further part, as a partial
  // result would look complete.
  const parts = await mapWithConcurrency(chunks, MAX_PARALLEL_REQUESTS, (text, index) =>
    requestAnalysis(
      buildDocumentPartPrompt({ ...input, text }, { number: index + 1, count: chunks.length }),
      llm,
    ),
  );
  const findings = mergePartialInsights(parts);

  const session = llm.startSession({
    systemInstruction: OVERVIEW_SYSTEM_INSTRUCTION,
    responseSchema: OVERVIEW_RESPONSE_JSON_SCHEMA,
  });
  const overview = await requestStructuredReply(
    session,
    buildOverviewPrompt(input, findings.document, parts),
    llmOverviewSchema,
  );

  return { ...findings, ...overview };
}

/**
 * Analyzes the document with the LLM: in one call when the text fits one part, otherwise
 * part by part. Every call that returns invalid JSON or breaks the schema gets exactly one
 * retry that tells the model what was wrong.
 */
export async function analyzeDocument(
  input: AnalyzeRequest,
  llm: LlmClient,
): Promise<DocumentInsight> {
  const chunks = splitIntoChunks(input.text);
  const analysis =
    chunks.length === 1
      ? await requestAnalysis(buildDocumentPrompt(input), llm)
      : await analyzeInParts(input, chunks, llm);

  // fileName and pages come from the validated request; the full contract is checked once
  // more, so a response never leaves the server without matching documentInsightSchema.
  return documentInsightSchema.parse({
    ...analysis,
    document: { fileName: input.fileName, pages: input.pages, ...analysis.document },
  });
}
