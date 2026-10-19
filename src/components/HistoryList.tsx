import { DOCUMENT_TYPE_LABELS, formatTimestamp } from '../lib/formatters.ts';
import type { HistoryEntry } from '../lib/historyStorage.ts';
import type { DocumentInsight } from '../types/schema.ts';

interface HistoryListProps {
  readonly entries: readonly HistoryEntry[];
  /** The result on screen; its entry is marked as current. */
  readonly activeInsight: DocumentInsight | null;
  readonly onSelect: (insight: DocumentInsight) => void;
  readonly onClear: () => void;
}

export function HistoryList({ entries, activeInsight, onSelect, onClear }: HistoryListProps) {
  return (
    <aside className="card history" aria-labelledby="history-title">
      <h2 id="history-title" className="history__title">
        Ostatnie analizy
      </h2>
      <ul className="history__list">
        {entries.map((entry) => {
          const { document } = entry.insight;
          // The store keeps the object it was given, so the result on screen matches by reference.
          const isActive = entry.insight === activeInsight;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="history__item"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  onSelect(entry.insight);
                }}
              >
                <span className="history__name">{document.title ?? document.fileName}</span>
                <span className="history__meta">
                  {DOCUMENT_TYPE_LABELS[document.type]} ·{' '}
                  <time dateTime={entry.savedAt}>{formatTimestamp(entry.savedAt)}</time>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="history__note">Historia jest zapisana tylko w tej przeglądarce.</p>
      <button type="button" className="button button--ghost" onClick={onClear}>
        Wyczyść historię
      </button>
    </aside>
  );
}
