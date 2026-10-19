import { z } from 'zod';
import { MAX_TEXT_CHARS } from '../src/types/analyzeLimits.ts';
import { HttpError } from './errors.ts';

/** Covers MAX_TEXT_CHARS of multi-byte UTF-8 text plus JSON escaping. */
export const MAX_BODY_BYTES = 1_500_000;

const MAX_FILE_NAME_CHARS = 255;
const MAX_PAGES = 10_000;

// C0 and C1 control characters except tab (\t), line feed (\n) and carriage return (\r).
// PDF text extractors emit them as noise, and they carry no meaning for the analysis.
// eslint-disable-next-line no-control-regex -- matching control characters is the point here
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export interface AnalyzeRequest {
  readonly fileName: string;
  readonly pages: number;
  /** Plain text extracted from the PDF; treated purely as data, never as instructions. */
  readonly text: string;
}

const requestSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(MAX_FILE_NAME_CHARS),
  pages: z.int().min(1).max(MAX_PAGES),
  text: z.string(),
});

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads the body as UTF-8 and stops as soon as it exceeds `maxBytes`, without trusting
 * Content-Length: a client can omit it or lie about it.
 */
async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > maxBytes) {
    throw new HttpError('PAYLOAD_TOO_LARGE');
  }
  if (request.body === null) {
    return '';
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new HttpError('PAYLOAD_TOO_LARGE');
    }
    chunks.push(value);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(concatChunks(chunks, totalBytes));
  } catch (error) {
    throw new HttpError('INVALID_REQUEST', { cause: error });
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new HttpError('INVALID_REQUEST', { cause: error });
  }
}

/** Normalizes extracted PDF text: NFC, LF line endings, no control characters. */
export function sanitizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim();
}

/** Validates the request and returns the sanitized input, or throws an HttpError. */
export async function parseAnalyzeRequest(request: Request): Promise<AnalyzeRequest> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    throw new HttpError('UNSUPPORTED_MEDIA_TYPE');
  }

  const payload = parseJson(await readBodyText(request, MAX_BODY_BYTES));
  const result = requestSchema.safeParse(payload);
  if (!result.success) {
    throw new HttpError('INVALID_REQUEST');
  }
  if (result.data.text.length > MAX_TEXT_CHARS) {
    throw new HttpError('PAYLOAD_TOO_LARGE');
  }

  const text = sanitizeText(result.data.text);
  // Only extracted text is accepted: raw PDF bytes sent as a string are rejected.
  if (text === '' || text.startsWith('%PDF-')) {
    throw new HttpError('INVALID_REQUEST');
  }

  return { fileName: result.data.fileName, pages: result.data.pages, text };
}
