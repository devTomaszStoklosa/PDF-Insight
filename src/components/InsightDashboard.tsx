import { formatAmount, formatCalendarDate } from '../lib/formatters.ts';
import type { DocumentDetails } from '../types/schema.ts';
import { InsightSection } from './InsightSection.tsx';

interface InsightDashboardProps {
  readonly document: DocumentDetails;
}

/** The analysis as readable cards. All values are untrusted AI output rendered as plain text. */
export function InsightDashboard({ document }: InsightDashboardProps) {
  const { entities } = document;

  return (
    <div className="dashboard">
      <InsightSection
        title="Podsumowanie"
        emptyMessage="Brak podsumowania."
        isEmpty={false}
        className="insight--summary"
      >
        <p className="summary">{document.summary}</p>
      </InsightSection>

      <InsightSection
        title="Najważniejsze punkty"
        emptyMessage="Brak najważniejszych punktów."
        isEmpty={document.keyPoints.length === 0}
        className="insight--wide"
      >
        <ul className="key-points">
          {document.keyPoints.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </InsightSection>

      <InsightSection
        title="Kwoty"
        emptyMessage="W dokumencie nie znaleziono kwot."
        isEmpty={document.amounts.length === 0}
      >
        <ul className="facts">
          {document.amounts.map((amount, index) => (
            <li key={index} className="fact">
              <span className="fact__value">{formatAmount(amount.value, amount.currency)}</span>
              <span className="fact__context">{amount.context}</span>
            </li>
          ))}
        </ul>
      </InsightSection>

      <InsightSection
        title="Daty"
        emptyMessage="W dokumencie nie znaleziono dat."
        isEmpty={document.dates.length === 0}
      >
        <ul className="facts">
          {document.dates.map((mention, index) => (
            <li key={index} className="fact">
              <time className="fact__value" dateTime={mention.date}>
                {formatCalendarDate(mention.date)}
              </time>
              <span className="fact__context">{mention.context}</span>
            </li>
          ))}
        </ul>
      </InsightSection>

      <InsightSection
        title="Słowa kluczowe"
        emptyMessage="Brak słów kluczowych."
        isEmpty={document.keywords.length === 0}
      >
        <ul className="chips">
          {document.keywords.map((keyword, index) => (
            <li key={index} className="chip">
              {keyword}
            </li>
          ))}
        </ul>
      </InsightSection>

      <InsightSection
        title="Podmioty"
        emptyMessage="W dokumencie nie znaleziono organizacji ani osób."
        isEmpty={entities.organizations.length === 0 && entities.people.length === 0}
      >
        <dl className="entities">
          {entities.organizations.length > 0 && (
            <div>
              <dt>Organizacje</dt>
              {entities.organizations.map((name, index) => (
                <dd key={index}>{name}</dd>
              ))}
            </div>
          )}
          {entities.people.length > 0 && (
            <div>
              <dt>Osoby</dt>
              {entities.people.map((name, index) => (
                <dd key={index}>{name}</dd>
              ))}
            </div>
          )}
        </dl>
      </InsightSection>
    </div>
  );
}
