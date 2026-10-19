import { useEffect, useMemo, useRef } from 'react';
import { serializeInsight } from '../lib/jsonExport.ts';
import type { DocumentInsight } from '../types/schema.ts';
import { DocumentMetaBadges } from './DocumentMetaBadges.tsx';
import { DownloadJsonButton } from './DownloadJsonButton.tsx';
import { InsightDashboard } from './InsightDashboard.tsx';
import { JsonPreview } from './JsonPreview.tsx';
import { Tabs } from './Tabs.tsx';

interface ResultViewProps {
  readonly insight: DocumentInsight;
  readonly onNewAnalysis: () => void;
}

export function ResultView({ insight, onNewAnalysis }: ResultViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const json = useMemo(() => serializeInsight(insight), [insight]);
  const { document } = insight;

  // Moves focus to the new content, so screen readers announce the result.
  useEffect(() => {
    headingRef.current?.focus();
  }, [insight]);

  return (
    <section className="result" aria-labelledby="result-title">
      <header className="card result__header">
        <div className="result__heading">
          <p className="eyebrow">Wynik analizy</p>
          <h2 id="result-title" ref={headingRef} tabIndex={-1}>
            {document.title ?? document.fileName}
          </h2>
          <DocumentMetaBadges insight={insight} />
        </div>
        <div className="actions result__actions">
          <DownloadJsonButton json={json} pdfFileName={document.fileName} />
          <button type="button" className="button button--secondary" onClick={onNewAnalysis}>
            Analizuj inny plik
          </button>
        </div>
      </header>

      <Tabs
        label="Widok wyniku"
        tabs={[
          {
            id: 'summary',
            label: 'Podsumowanie',
            content: <InsightDashboard insight={insight} />,
          },
          { id: 'json', label: 'JSON', content: <JsonPreview json={json} /> },
        ]}
      />
    </section>
  );
}
