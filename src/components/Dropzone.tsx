import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { MULTIPLE_FILES_MESSAGE, validatePdfFile } from '../lib/validatePdfFile.ts';
import { UploadIcon } from './icons.tsx';

interface DropzoneProps {
  /** Receives a file that already passed the type and size checks. */
  readonly onFileAccepted: (file: File) => void;
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

/** Drag & drop area and file picker; the whole zone is the label of the native file input. */
export function Dropzone({ onFileAccepted }: DropzoneProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dragenter/dragleave also fire for child elements, so nesting depth is tracked.
  const dragDepth = useRef(0);

  // A PDF dropped next to the zone would otherwise replace the app with the browser's viewer.
  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') === true) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  function acceptFiles(files: FileList): void {
    const file = files[0];
    if (file === undefined) {
      return;
    }
    if (files.length > 1) {
      setError(MULTIPLE_FILES_MESSAGE);
      return;
    }

    const validation = validatePdfFile(file);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }
    setError(null);
    onFileAccepted(file);
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>): void {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>): void {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(): void {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const { files } = event.currentTarget;
    if (files !== null) {
      acceptFiles(files);
    }
    // Lets the user pick the same file again, e.g. after fixing it.
    event.currentTarget.value = '';
  }

  const describedBy = error === null ? hintId : `${hintId} ${errorId}`;

  return (
    <div className="dropzone-field">
      <input
        id={inputId}
        className="visually-hidden dropzone-input"
        type="file"
        accept=".pdf,application/pdf"
        aria-describedby={describedBy}
        aria-invalid={error === null ? undefined : true}
        onChange={handleChange}
      />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drag & drop
          is a pointer-only shortcut; keyboard users pick the file through the labelled input. */}
      <label
        htmlFor={inputId}
        className={isDragging ? 'dropzone dropzone--active' : 'dropzone'}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <UploadIcon className="dropzone__icon" />
        <span className="dropzone__title">
          {isDragging ? 'Upuść plik, aby rozpocząć analizę' : 'Przeciągnij i upuść plik PDF'}
        </span>
        <span className="dropzone__subtitle">lub kliknij, aby wybrać go z dysku</span>
        <span className="button button--primary dropzone__button" aria-hidden="true">
          Wybierz plik
        </span>
      </label>
      <p id={hintId} className="dropzone-hint">
        Obsługiwany format: PDF z warstwą tekstową, maksymalnie 10 MB.
      </p>
      <p id={errorId} className="field-error" role="alert">
        {error}
      </p>
    </div>
  );
}
