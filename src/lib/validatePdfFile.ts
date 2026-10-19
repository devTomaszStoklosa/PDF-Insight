import { formatFileSize } from './formatters.ts';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// Some systems report no MIME type for PDFs (an empty string), or the legacy x-pdf type.
const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/x-pdf',
  '',
]);

export const MULTIPLE_FILES_MESSAGE = 'Upuść tylko jeden plik PDF naraz.';

/** The File fields the validation needs, so it can be tested without a browser. */
export type FileMetadata = Pick<File, 'name' | 'size' | 'type'>;

export type FileValidation =
  { readonly valid: true } | { readonly valid: false; readonly message: string };

/** Checks type and size before any processing; the messages are shown to the user. */
export function validatePdfFile(file: FileMetadata): FileValidation {
  const hasPdfExtension = file.name.toLowerCase().endsWith('.pdf');
  if (!hasPdfExtension || !ACCEPTED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      message: 'Nieobsługiwany format pliku. Wybierz dokument PDF (plik z rozszerzeniem .pdf).',
    };
  }
  if (file.size === 0) {
    return { valid: false, message: 'Plik jest pusty. Wybierz inny dokument PDF.' };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      valid: false,
      message: `Plik jest za duży (${formatFileSize(file.size)}). Maksymalny rozmiar to 10 MB.`,
    };
  }
  return { valid: true };
}
