import { useEffect, useRef } from 'react';
import { AlertIcon, FileIcon } from './icons.tsx';

interface ErrorStateProps {
  readonly fileName: string;
  readonly message: string;
  readonly onRetry: () => void;
  readonly onChooseAnotherFile: () => void;
}

export function ErrorState({ fileName, message, onRetry, onChooseAnotherFile }: ErrorStateProps) {
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  // Keyboard users land on the main action instead of the top of the page.
  useEffect(() => {
    retryButtonRef.current?.focus();
  }, []);

  return (
    <section className="card error-state" aria-labelledby="error-title">
      <div className="error-state__message" role="alert">
        <AlertIcon className="error-state__icon" />
        <div>
          <h2 id="error-title">Nie udało się przeanalizować dokumentu</h2>
          <p>{message}</p>
        </div>
      </div>
      <p className="file-name">
        <FileIcon /> <span>{fileName}</span>
      </p>
      <div className="actions">
        <button
          ref={retryButtonRef}
          type="button"
          className="button button--primary"
          onClick={onRetry}
        >
          Spróbuj ponownie
        </button>
        <button type="button" className="button button--secondary" onClick={onChooseAnotherFile}>
          Wybierz inny plik
        </button>
      </div>
    </section>
  );
}
