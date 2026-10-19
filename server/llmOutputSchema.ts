import { z } from 'zod';
import { documentInsightSchema, documentMetadataSchema } from '../src/types/schema.ts';
import type { JsonSchema } from './llmClient.ts';

/**
 * What the model must return: the analysis without `fileName` and `pages`. Those come from
 * the request, so the model cannot get them wrong; the server adds them afterwards.
 */
export const llmInsightSchema = z.strictObject({
  ...documentInsightSchema.shape,
  document: documentMetadataSchema.omit({ fileName: true, pages: true }),
});

export type LlmInsight = z.infer<typeof llmInsightSchema>;

/**
 * JSON Schema sent to the model to constrain its output. Refinements such as the summary
 * sentence count cannot be expressed in JSON Schema, so Zod validation stays authoritative.
 */
export const LLM_RESPONSE_JSON_SCHEMA: JsonSchema = z.toJSONSchema(llmInsightSchema);
