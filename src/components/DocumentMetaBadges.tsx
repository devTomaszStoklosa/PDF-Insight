import {
  DOCUMENT_TYPE_LABELS,
  formatCalendarDate,
  formatLanguage,
  formatPageCount,
} from '../lib/formatters.ts';
import type { DocumentInsight } from '../types/schema.ts';
import { FileIcon } from './icons.tsx';

interface DocumentMetaBadgesProps {
  readonly insight: DocumentInsight;
}

export function DocumentMetaBadges({ insight }: DocumentMetaBadgesProps) {
  const { document } = insight;

  return (
    <ul className="badges" aria-label="Metadane dokumentu">
      <li className="badge badge--accent">
        <span className="visually-hidden">Typ dokumentu: </span>
        {DOCUMENT_TYPE_LABELS[insight.type]}
      </li>
      <li className="badge">{formatPageCount(document.pages)}</li>
      <li className="badge">
        <span className="visually-hidden">Język: </span>
        {formatLanguage(document.language)}
      </li>
      {document.date !== null && (
        <li className="badge">
          Data dokumentu: <time dateTime={document.date}>{formatCalendarDate(document.date)}</time>
        </li>
      )}
      <li className="badge badge--file">
        <FileIcon />
        <span className="visually-hidden">Plik: </span>
        <span className="badge__text">{document.fileName}</span>
      </li>
    </ul>
  );
}
