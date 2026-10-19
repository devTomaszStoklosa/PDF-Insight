import { z } from 'zod';
import { documentInsightSchema, type DocumentInsight } from '../types/schema.ts';
import type { KeyValueStorage } from './browserStorage.ts';

export const HISTORY_LIMIT = 3;
// Bump the version when the entry shape changes; old entries then simply stop loading.
const STORAGE_KEY = 'pdf-insight:history:v1';

const historyEntrySchema = z.strictObject({
  id: z.string().min(1),
  savedAt: z.iso.datetime(),
  insight: documentInsightSchema,
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export interface HistoryStore {
  /** Newest first; entries that no longer match the schema are skipped. */
  load(): HistoryEntry[];
  /** Saves the analysis as the newest entry and returns the updated list. */
  add(insight: DocumentInsight): HistoryEntry[];
  clear(): void;
}

export interface HistoryStoreOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function parseEntries(raw: string | null): HistoryEntry[] {
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  // Storage is untrusted (edited by hand, written by an older version), so each entry is
  // validated on its own and only the broken ones are dropped.
  return parsed.flatMap((item: unknown) => {
    const result = historyEntrySchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

/** Keeps the last few successful analyses, so the user can switch between recent documents. */
export function createHistoryStore(
  storage: KeyValueStorage,
  { now = () => new Date(), createId = () => crypto.randomUUID() }: HistoryStoreOptions = {},
): HistoryStore {
  function load(): HistoryEntry[] {
    try {
      return parseEntries(storage.getItem(STORAGE_KEY)).slice(0, HISTORY_LIMIT);
    } catch {
      return [];
    }
  }

  function add(insight: DocumentInsight): HistoryEntry[] {
    const entry: HistoryEntry = { id: createId(), savedAt: now().toISOString(), insight };
    // A new analysis of the same file replaces the old one instead of filling the history.
    const entries = [
      entry,
      ...load().filter((saved) => saved.insight.document.fileName !== insight.document.fileName),
    ].slice(0, HISTORY_LIMIT);

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Quota exceeded or storage blocked: the history still works for this visit.
    }
    return entries;
  }

  function clear(): void {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }

  return { load, add, clear };
}
