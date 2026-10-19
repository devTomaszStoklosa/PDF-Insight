import { useCallback, useState } from 'react';
import type { HistoryEntry, HistoryStore } from '../lib/historyStorage.ts';
import type { DocumentInsight } from '../types/schema.ts';

export interface AnalysisHistory {
  readonly entries: readonly HistoryEntry[];
  readonly add: (insight: DocumentInsight) => void;
  readonly clear: () => void;
}

/** Keeps the saved history in React state, so the list updates after each analysis. */
export function useAnalysisHistory(store: HistoryStore): AnalysisHistory {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>(() => store.load());

  const add = useCallback(
    (insight: DocumentInsight) => {
      setEntries(store.add(insight));
    },
    [store],
  );

  const clear = useCallback(() => {
    store.clear();
    setEntries([]);
  }, [store]);

  return { entries, add, clear };
}
