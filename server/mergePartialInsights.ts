import type { Amount, DateMention, DocumentType, Entities } from '../src/types/schema.ts';
import type { LlmInsight } from './llmOutputSchema.ts';

/** The prompt asks for 3 to 10 keywords; the merged list keeps the same upper bound. */
export const MAX_MERGED_KEYWORDS = 10;

/** Everything in the final analysis except the summary and key points, which the model writes. */
export interface MergedFindings {
  readonly document: LlmInsight['document'];
  readonly entities: Entities;
  readonly amounts: Amount[];
  readonly dates: DateMention[];
  readonly keywords: string[];
}

/** Case and whitespace do not make two mentions different. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Keeps the first item for each key, in the original order. */
function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The value given by the most parts; on a tie, the one that appears first. */
function mostFrequent(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const [value, count] of counts) {
    if (best === undefined || count > (counts.get(best) ?? 0)) {
      best = value;
    }
  }
  return best;
}

/** The opening of a document says what it is; later parts such as annexes often do not. */
function mergeType(parts: readonly LlmInsight[]): DocumentType {
  return parts.find((part) => part.document.type !== 'inne')?.document.type ?? 'inne';
}

function mergeMetadata(parts: readonly LlmInsight[], first: LlmInsight): LlmInsight['document'] {
  return {
    language: mostFrequent(parts.map((part) => part.document.language)) ?? first.document.language,
    type: mergeType(parts),
    // A title is stated at the start; in later parts the model would report section headings.
    title: first.document.title,
    date: parts.find((part) => part.document.date !== null)?.document.date ?? null,
  };
}

/** Keywords ranked by the number of parts that give them, then by first appearance. */
function rankKeywords(parts: readonly LlmInsight[]): string[] {
  const ranked = new Map<string, { keyword: string; parts: number }>();
  for (const part of parts) {
    for (const keyword of uniqueBy(part.keywords, normalize)) {
      const entry = ranked.get(normalize(keyword));
      if (entry === undefined) {
        ranked.set(normalize(keyword), { keyword, parts: 1 });
      } else {
        entry.parts += 1;
      }
    }
  }
  return [...ranked.values()]
    .sort((a, b) => b.parts - a.parts)
    .slice(0, MAX_MERGED_KEYWORDS)
    .map((entry) => entry.keyword);
}

/**
 * Combines the analyses of consecutive parts of one document, in document order. Lists drop
 * repeated mentions and keep the first spelling. Amounts and dates count as repeated only
 * with the same context, so equal values that mean different things are both kept.
 */
export function mergePartialInsights(parts: readonly LlmInsight[]): MergedFindings {
  const [first] = parts;
  if (first === undefined) {
    throw new RangeError('No parts to merge');
  }

  return {
    document: mergeMetadata(parts, first),
    entities: {
      organizations: uniqueBy(
        parts.flatMap((part) => part.entities.organizations),
        normalize,
      ),
      people: uniqueBy(
        parts.flatMap((part) => part.entities.people),
        normalize,
      ),
    },
    amounts: uniqueBy(
      parts.flatMap((part) => part.amounts),
      (amount) => `${String(amount.value)}|${amount.currency}|${normalize(amount.context)}`,
    ),
    dates: uniqueBy(
      parts.flatMap((part) => part.dates),
      (mention) => `${mention.date}|${normalize(mention.context)}`,
    ),
    keywords: rankKeywords(parts),
  };
}
