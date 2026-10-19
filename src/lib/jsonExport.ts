import type { DocumentInsight } from '../types/schema.ts';

const MAX_BASE_NAME_CHARS = 80;
const FALLBACK_BASE_NAME = 'dokument';
// Characters that are invalid in file names on Windows, macOS or Linux, plus control characters.
const UNSAFE_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}]/gu;

/** The JSON shown in the preview and saved to the file, so both always match. */
export function serializeInsight(insight: DocumentInsight): string {
  return JSON.stringify(insight, null, 2);
}

/** Derives the download name from the PDF name, e.g. "umowa.pdf" becomes "umowa-insight.json". */
export function buildJsonFileName(pdfFileName: string): string {
  const baseName = pdfFileName
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replace(UNSAFE_FILE_NAME_CHARACTERS, '_')
    .trim()
    .slice(0, MAX_BASE_NAME_CHARS);

  return `${baseName === '' ? FALLBACK_BASE_NAME : baseName}-insight.json`;
}

/** Saves the JSON as a file through a temporary object URL. */
export function downloadJsonFile(json: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking in a later task lets every browser start the download first.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
