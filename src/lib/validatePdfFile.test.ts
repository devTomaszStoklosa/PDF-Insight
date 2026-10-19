import { describe, expect, it } from 'vitest';
import { MAX_PDF_BYTES, validatePdfFile, type FileMetadata } from './validatePdfFile.ts';

function pdf(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return { name: 'umowa.pdf', size: 1024, type: 'application/pdf', ...overrides };
}

function messageOf(file: FileMetadata): string | undefined {
  const result = validatePdfFile(file);
  return result.valid ? undefined : result.message;
}

describe('validatePdfFile', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validatePdfFile(pdf())).toEqual({ valid: true });
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    expect(validatePdfFile(pdf({ size: MAX_PDF_BYTES }))).toEqual({ valid: true });
  });

  it('accepts an upper-case extension and an empty MIME type', () => {
    expect(validatePdfFile(pdf({ name: 'RAPORT.PDF', type: '' }))).toEqual({ valid: true });
  });

  it('rejects a file without the .pdf extension', () => {
    expect(messageOf(pdf({ name: 'umowa.docx' }))).toMatch(/Nieobsługiwany format/);
  });

  it('rejects a renamed file whose MIME type is not PDF', () => {
    expect(messageOf(pdf({ name: 'zdjecie.pdf', type: 'image/png' }))).toMatch(
      /Nieobsługiwany format/,
    );
  });

  it('rejects an empty file', () => {
    expect(messageOf(pdf({ size: 0 }))).toMatch(/Plik jest pusty/);
  });

  it('rejects a file over 10 MB and shows its size', () => {
    const message = messageOf(pdf({ size: MAX_PDF_BYTES + 1 }));

    expect(message).toBe('Plik jest za duży (10,1 MB). Maksymalny rozmiar to 10 MB.');
  });
});
