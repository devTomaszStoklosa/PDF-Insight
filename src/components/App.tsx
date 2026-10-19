import { useCallback, useState } from 'react';
import type { AnalyzeText } from '../api/analyzeClient.ts';
import { useAnalysisHistory } from '../hooks/useAnalysisHistory.ts';
import { useDocumentAnalysis } from '../hooks/useDocumentAnalysis.ts';
import type { HistoryStore } from '../lib/historyStorage.ts';
import type { ExtractPdfText } from '../lib/pdfExtractor.ts';
import type { DocumentInsight } from '../types/schema.ts';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { HistoryList } from './HistoryList.tsx';
import { LoadingState } from './LoadingState.tsx';
import { ResultView } from './ResultView.tsx';

export interface AppProps {
  readonly extractText: ExtractPdfText;
  readonly analyzeText: AnalyzeText;
  readonly historyStore: HistoryStore;
}

export function App({ extractText, analyzeText, historyStore }: AppProps) {
  const history = useAnalysisHistory(historyStore);
  const { state, analyze, retry, showResult, reset } = useDocumentAnalysis({
    extractText,
    analyzeText,
    onSuccess: history.add,
  });
  // Focus moves to the upload form only when the user comes back to it, not on page load.
  const [hasReturnedToStart, setHasReturnedToStart] = useState(false);

  const startOver = useCallback(() => {
    setHasReturnedToStart(true);
    reset();
  }, [reset]);

  const isBusy = state.status === 'extracting' || state.status === 'analyzing';
  const activeInsight: DocumentInsight | null = state.status === 'success' ? state.insight : null;
  const showHistory = history.entries.length > 0 && !isBusy;

  function renderView() {
    switch (state.status) {
      case 'idle':
        return <EmptyState onFileAccepted={analyze} focusOnMount={hasReturnedToStart} />;
      case 'extracting':
        return (
          <LoadingState
            fileName={state.file.name}
            stage={{ kind: 'extracting', progress: state.progress }}
          />
        );
      case 'analyzing':
        return (
          <LoadingState
            fileName={state.file.name}
            stage={{ kind: 'analyzing', pages: state.pages }}
          />
        );
      case 'error':
        return (
          <ErrorState
            fileName={state.file.name}
            message={state.message}
            onRetry={retry}
            onChooseAnotherFile={startOver}
          />
        );
      case 'success':
        return <ResultView insight={state.insight} onNewAnalysis={startOver} />;
    }
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Przejdź do treści
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <h1 className="logo">
            <span className="logo__mark" aria-hidden="true">
              PDF
            </span>
            <span className="logo__text">PDF Insight</span>
          </h1>
          <p className="app-header__tagline">Podsumowanie i dane strukturalne z plików PDF</p>
        </div>
      </header>

      <div className={showHistory ? 'layout layout--with-history' : 'layout'}>
        <main id="main" className="layout__main" tabIndex={-1}>
          {renderView()}
        </main>
        {showHistory && (
          <HistoryList
            entries={history.entries}
            activeInsight={activeInsight}
            onSelect={showResult}
            onClear={history.clear}
          />
        )}
      </div>

      <footer className="app-footer">
        <p>
          Tekst jest wyodrębniany w przeglądarce, a analizę wykonuje model Google Gemini. Wyniki
          generowane przez AI mogą zawierać błędy – sprawdź je w oryginalnym dokumencie.
        </p>
      </footer>
    </div>
  );
}
