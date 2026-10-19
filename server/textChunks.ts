import { MAX_TEXT_CHARS } from '../src/types/analyzeLimits.ts';

/** Text up to this length is analyzed in one model call; longer text is split into parts. */
export const TARGET_CHUNK_CHARS = 37_500;
/** How far back from an ideal cut the splitter looks for a page, line or word boundary. */
const CUT_WINDOW_CHARS = 2_500;
/** No part is longer: each cut lies at most CUT_WINDOW_CHARS before its ideal position. */
export const MAX_CHUNK_CHARS = TARGET_CHUNK_CHARS + CUT_WINDOW_CHARS;
/** Upper bound on model calls for the parts of one document, reached at MAX_TEXT_CHARS. */
export const MAX_CHUNKS = Math.ceil(MAX_TEXT_CHARS / TARGET_CHUNK_CHARS);

// Preferred boundaries, best first. The extractor separates pages with a blank line.
const SEPARATORS = ['\n\n', '\n', ' '] as const;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Returns the cut nearest to `ideal`, but not after it, that ends on a separator within the
 * window. Without one, cuts at `ideal` itself, never between the halves of a surrogate pair.
 */
function findCut(text: string, ideal: number, lowerBound: number): number {
  for (const separator of SEPARATORS) {
    const position = text.lastIndexOf(separator, ideal - separator.length);
    if (position >= 0 && position + separator.length > lowerBound) {
      return position + separator.length;
    }
  }
  return isHighSurrogate(text.charCodeAt(ideal - 1)) ? ideal - 1 : ideal;
}

/**
 * Splits text into parts of similar length, each at most MAX_CHUNK_CHARS long, cut at page,
 * line or word boundaries where possible. The parts joined together give the original text.
 */
export function splitIntoChunks(text: string): string[] {
  const count = Math.max(1, Math.ceil(text.length / TARGET_CHUNK_CHARS));
  if (count > MAX_CHUNKS) {
    // The request limit keeps text below this; a larger fan-out would drain the model quota.
    throw new RangeError(`Text needs ${String(count)} parts, more than ${String(MAX_CHUNKS)}`);
  }

  const chunks: string[] = [];
  let start = 0;
  for (let index = 1; index < count; index += 1) {
    // Ideal cuts are spread evenly over the whole text, so a moved cut does not push the
    // following parts out of balance.
    const ideal = Math.round((index * text.length) / count);
    const cut = findCut(text, ideal, Math.max(start, ideal - CUT_WINDOW_CHARS));
    chunks.push(text.slice(start, cut));
    start = cut;
  }
  chunks.push(text.slice(start));
  return chunks;
}
