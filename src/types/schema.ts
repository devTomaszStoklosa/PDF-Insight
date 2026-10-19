import { z } from 'zod';
import { countSentences } from '../lib/countSentences.ts';

const SUMMARY_SENTENCES = { min: 3, max: 5 } as const;
const KEY_POINTS = { min: 3, max: 7 } as const;

// Blank strings are rejected: missing information must be sent as null or [], not as "".
const nonEmptyText = z.string().trim().min(1);

// ISO 8601 calendar date (YYYY-MM-DD); impossible dates such as 2024-02-30 are rejected.
const isoDate = z.iso.date();

const summarySchema = nonEmptyText.refine(
  (text) => {
    const sentences = countSentences(text);
    return sentences >= SUMMARY_SENTENCES.min && sentences <= SUMMARY_SENTENCES.max;
  },
  {
    error: `Summary must have ${String(SUMMARY_SENTENCES.min)}-${String(SUMMARY_SENTENCES.max)} sentences`,
  },
);

export const documentTypeSchema = z.enum(['umowa', 'faktura', 'oferta', 'raport', 'inne']);

export const entitiesSchema = z.strictObject({
  organizations: z.array(nonEmptyText),
  people: z.array(nonEmptyText),
});

export const amountSchema = z.strictObject({
  // Negative values are allowed, e.g. on correction invoices.
  value: z.number(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code, e.g. "PLN"'),
  context: nonEmptyText,
});

export const dateMentionSchema = z.strictObject({
  date: isoDate,
  context: nonEmptyText,
});

// Strict objects reject unknown keys, so contract drift between the LLM backend
// and the frontend fails validation instead of being silently dropped.
// The layout and key order follow the schema in the brief: metadata in `document`,
// the analysis at the top level.
export const documentMetadataSchema = z.strictObject({
  fileName: nonEmptyText,
  pages: z.int().min(1),
  language: z.string().regex(/^[a-z]{2}$/, 'Expected an ISO 639-1 language code, e.g. "pl"'),
  type: documentTypeSchema,
  title: nonEmptyText.nullable(),
  date: isoDate.nullable(),
});

export const documentInsightSchema = z.strictObject({
  document: documentMetadataSchema,
  summary: summarySchema,
  keyPoints: z.array(nonEmptyText).min(KEY_POINTS.min).max(KEY_POINTS.max),
  entities: entitiesSchema,
  amounts: z.array(amountSchema),
  dates: z.array(dateMentionSchema),
  keywords: z.array(nonEmptyText),
});

export type DocumentType = z.infer<typeof documentTypeSchema>;
export type Entities = z.infer<typeof entitiesSchema>;
export type Amount = z.infer<typeof amountSchema>;
export type DateMention = z.infer<typeof dateMentionSchema>;
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;
export type DocumentInsight = z.infer<typeof documentInsightSchema>;
