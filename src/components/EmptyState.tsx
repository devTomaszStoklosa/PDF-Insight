import { useEffect, useRef } from 'react';
import { ConfidentialityNotice } from './ConfidentialityNotice.tsx';
import { Dropzone } from './Dropzone.tsx';

interface EmptyStateProps {
  readonly onFileAccepted: (file: File) => void;
  /** Moves focus to the heading, e.g. when the user returns here from a result. */
  readonly focusOnMount?: boolean;
}

const PIPELINE_STEPS = [
  {
    title: 'Odczyt tekstu',
    description: 'Tekst z PDF jest wyodrębniany lokalnie, w Twojej przeglądarce.',
  },
  {
    title: 'Analiza AI',
    description: 'Sam tekst trafia do modelu AI, który przygotowuje podsumowanie i dane.',
  },
  {
    title: 'Wynik',
    description: 'Przeglądasz wynik na ekranie i pobierasz go jako plik JSON.',
  },
] as const;

export function EmptyState({ onFileAccepted, focusOnMount = false }: EmptyStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnMount) {
      headingRef.current?.focus();
    }
  }, [focusOnMount]);

  return (
    <section className="card empty-state" aria-labelledby="empty-state-title">
      <div className="empty-state__intro">
        <h2 id="empty-state-title" ref={headingRef} tabIndex={-1}>
          Przeanalizuj dokument PDF
        </h2>
        <p className="lead">
          Wgraj umowę, fakturę, ofertę lub raport. W kilkanaście sekund otrzymasz podsumowanie w 3–5
          zdaniach oraz dane strukturalne: najważniejsze punkty, kwoty, daty i słowa kluczowe.
        </p>
      </div>

      <Dropzone onFileAccepted={onFileAccepted} />

      <ol className="pipeline" aria-label="Jak to działa">
        {PIPELINE_STEPS.map((step, index) => (
          <li key={step.title} className="pipeline__step">
            <span className="pipeline__number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <strong className="pipeline__title">{step.title}</strong>
              <span className="pipeline__description">{step.description}</span>
            </span>
          </li>
        ))}
      </ol>

      <ConfidentialityNotice />
    </section>
  );
}
