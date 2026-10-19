import type * as PdfJs from 'pdfjs-dist';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import { UserFacingError } from './userFacingError.ts';

export interface ExtractedPdf {
  readonly text: string;
  readonly pages: number;
}

export interface ExtractionProgress {
  readonly page: number;
  readonly totalPages: number;
}

export interface ExtractionOptions {
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: ExtractionProgress) => void;
}

export type ExtractPdfText = (file: File, options: ExtractionOptions) => Promise<ExtractedPdf>;

const MESSAGES = {
  libraryUnavailable:
    'Nie udało się wczytać modułu do odczytu plików PDF. Odśwież stronę i spróbuj ponownie.',
  password: 'Plik PDF jest zabezpieczony hasłem. Usuń zabezpieczenie i wgraj go ponownie.',
  invalid: 'Plik jest uszkodzony lub nie jest prawidłowym dokumentem PDF.',
  noText:
    'Ten PDF nie zawiera tekstu do odczytania – to najpewniej skan lub same obrazy. Wgraj PDF z warstwą tekstową.',
  unreadable: 'Nie udało się odczytać tekstu z pliku PDF. Spróbuj z innym plikiem.',
} as const;

let pdfJsPromise: Promise<typeof PdfJs> | undefined;

/**
 * Loads PDF.js on first use, so it is not part of the initial bundle. The `?url` import
 * makes Vite emit the worker as a hashed asset under `base`, so it also loads when the
 * app is served from a sub-path such as /PDF-Insight/ on GitHub Pages.
 */
function loadPdfJs(): Promise<typeof PdfJs> {
  pdfJsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
    (error: unknown) => {
      // Forget the failure (e.g. a dropped connection), so the next attempt loads again.
      pdfJsPromise = undefined;
      throw new UserFacingError(MESSAGES.libraryUnavailable, { cause: error });
    },
  );
  return pdfJsPromise;
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

function pageText(items: readonly (TextItem | TextMarkedContent)[]): string {
  let text = '';
  for (const item of items) {
    if (isTextItem(item)) {
      text += item.hasEOL ? `${item.str}\n` : item.str;
    }
  }
  return text;
}

function toExtractionError(error: unknown, pdfjs: typeof PdfJs): unknown {
  if (error instanceof UserFacingError) {
    return error;
  }
  if (error instanceof pdfjs.PasswordException) {
    return new UserFacingError(MESSAGES.password, { cause: error });
  }
  if (error instanceof pdfjs.InvalidPDFException) {
    return new UserFacingError(MESSAGES.invalid, { cause: error });
  }
  return new UserFacingError(MESSAGES.unreadable, { cause: error });
}

/** Extracts the text layer of a PDF locally in the browser; the file never leaves the device. */
export const extractPdfText: ExtractPdfText = async (file, { signal, onProgress }) => {
  const pdfjs = await loadPdfJs();
  signal.throwIfAborted();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const cancel = (): void => {
    void loadingTask.destroy();
  };
  signal.addEventListener('abort', cancel, { once: true });

  try {
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(pageText(content.items));
      page.cleanup();
      onProgress?.({ page: pageNumber, totalPages: pdf.numPages });
    }

    const text = pageTexts.join('\n\n').trim();
    if (text === '') {
      throw new UserFacingError(MESSAGES.noText);
    }
    return { text, pages: pdf.numPages };
  } catch (error) {
    // A cancelled extraction is not a failure: the caller started something else.
    signal.throwIfAborted();
    throw toExtractionError(error, pdfjs);
  } finally {
    signal.removeEventListener('abort', cancel);
    void loadingTask.destroy();
  }
};
