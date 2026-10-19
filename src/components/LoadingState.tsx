import { useElapsedSeconds } from '../hooks/useElapsedSeconds.ts';
import type { ExtractionProgress } from '../lib/pdfExtractor.ts';
import { formatPageCount } from '../lib/formatters.ts';
import { CheckIcon, FileIcon, SparkIcon } from './icons.tsx';
import { ProgressBar } from './ProgressBar.tsx';

export type LoadingStage =
  | { readonly kind: 'extracting'; readonly progress: ExtractionProgress | null }
  | { readonly kind: 'analyzing'; readonly pages: number };

interface LoadingStateProps {
  readonly fileName: string;
  readonly stage: LoadingStage;
}

function extractionDetail(progress: ExtractionProgress | null): string {
  return progress === null
    ? 'Otwieranie pliku…'
    : `Strona ${String(progress.page)} z ${String(progress.totalPages)}`;
}

export function LoadingState({ fileName, stage }: LoadingStateProps) {
  const elapsedSeconds = useElapsedSeconds();
  const isAnalyzing = stage.kind === 'analyzing';
  const statusText = isAnalyzing
    ? 'Analiza AI w toku: model przygotowuje podsumowanie i dane strukturalne.'
    : 'Odczytywanie tekstu z pliku PDF w przeglądarce.';

  return (
    <section className="card loading-state" aria-labelledby="loading-title" aria-busy="true">
      <div className="loading-state__header">
        <div className="loading-state__pulse" aria-hidden="true">
          <SparkIcon />
        </div>
        <div>
          <h2 id="loading-title">Analizuję dokument</h2>
          <p className="file-name">
            <FileIcon /> <span>{fileName}</span>
          </p>
        </div>
      </div>

      <p className="visually-hidden" role="status">
        {statusText}
      </p>

      <ol className="steps">
        <li className={isAnalyzing ? 'step step--done' : 'step step--current'}>
          <span className="step__marker" aria-hidden="true">
            {isAnalyzing ? <CheckIcon /> : '1'}
          </span>
          <div className="step__body">
            <p className="step__title">
              Odczytywanie tekstu z PDF
              <span className="visually-hidden">{isAnalyzing ? ' – gotowe' : ' – w toku'}</span>
            </p>
            <p className="step__detail">
              {isAnalyzing
                ? `Odczytano ${formatPageCount(stage.pages)}`
                : extractionDetail(stage.progress)}
            </p>
            {!isAnalyzing && (
              <ProgressBar
                label="Postęp odczytu tekstu"
                value={
                  stage.progress === null
                    ? undefined
                    : stage.progress.page / stage.progress.totalPages
                }
              />
            )}
          </div>
        </li>
        <li className={isAnalyzing ? 'step step--current' : 'step'}>
          <span className="step__marker" aria-hidden="true">
            2
          </span>
          <div className="step__body">
            <p className="step__title">
              Analiza AI
              <span className="visually-hidden">{isAnalyzing ? ' – w toku' : ' – oczekuje'}</span>
            </p>
            <p className="step__detail">
              {isAnalyzing
                ? 'Podsumowanie, kluczowe punkty, kwoty, daty i słowa kluczowe'
                : 'Rozpocznie się po odczytaniu tekstu'}
            </p>
            {isAnalyzing && <ProgressBar label="Postęp analizy AI" />}
          </div>
        </li>
      </ol>

      <p className="loading-state__footer">
        <span>Zwykle trwa to 10–30 sekund.</span>
        <span className="elapsed" aria-hidden="true">
          {elapsedSeconds} s
        </span>
      </p>
    </section>
  );
}
