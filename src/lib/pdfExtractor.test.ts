import { afterEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.fn();

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument,
  GlobalWorkerOptions: {},
  PasswordException: class extends Error {},
  InvalidPDFException: class extends Error {},
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.js' }));

/** A one-page document whose text layer holds the given text. */
function fakeLoadingTask(text: string) {
  const page = {
    getTextContent: () => Promise.resolve({ items: [{ str: text, hasEOL: false }] }),
    cleanup: vi.fn(),
  };
  return {
    promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) }),
    destroy: vi.fn(() => Promise.resolve()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  getDocument.mockReset();
});

describe('extractPdfText', () => {
  it('passes the CMap folder under the base path, so CID-keyed fonts yield text', async () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/'));
    getDocument.mockReturnValue(fakeLoadingTask('日本語'));
    const { extractPdfText } = await import('./pdfExtractor.ts');

    const result = await extractPdfText(new File(['%PDF-1.4'], 'cid.pdf'), {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ text: '日本語', pages: 1 });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapUrl: `http://localhost:5173${import.meta.env.BASE_URL}pdfjs/cmaps/`,
        cMapPacked: true,
      }),
    );
  });
});
