import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS } from '../src/types/analyzeLimits.ts';
import { MAX_CHUNK_CHARS, MAX_CHUNKS, splitIntoChunks, TARGET_CHUNK_CHARS } from './textChunks.ts';

// 20 lines of 99 characters make a page of 1,999 characters, so a page boundary always lies
// within the splitter's search window.
function pagedText(pages: number, lines = 20, lineChars = 99): string {
  const page = Array.from({ length: lines }, () => 'x'.repeat(lineChars)).join('\n');
  return Array.from({ length: pages }, () => page).join('\n\n');
}

function expectValidChunks(text: string, chunks: readonly string[]): void {
  expect(chunks.join('')).toBe(text);
  for (const chunk of chunks) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  }
}

describe('splitIntoChunks', () => {
  it('keeps text up to the target length in one part', () => {
    const text = 'a'.repeat(TARGET_CHUNK_CHARS);

    expect(splitIntoChunks(text)).toEqual([text]);
  });

  it('splits longer text into parts of similar length', () => {
    const text = pagedText(60);

    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(Math.ceil(text.length / TARGET_CHUNK_CHARS));
    expectValidChunks(text, chunks);
    const lengths = chunks.map((chunk) => chunk.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(5_000);
  });

  it('cuts at page boundaries when there are any near the cut', () => {
    const text = pagedText(60);

    const chunks = splitIntoChunks(text);

    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith('\n\n')).toBe(true);
    }
  });

  it('falls back to line boundaries when no page boundary is near the cut', () => {
    const text = pagedText(1, 500);

    const chunks = splitIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    expectValidChunks(text, chunks);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith('\n')).toBe(true);
      expect(chunk.endsWith('\n\n')).toBe(false);
    }
  });

  it('falls back to word boundaries in text without line breaks', () => {
    const text = Array.from({ length: 10_000 }, () => 'słowo').join(' ');

    const chunks = splitIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    expectValidChunks(text, chunks);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith(' ')).toBe(true);
    }
  });

  it('cuts text without any boundary at the ideal position', () => {
    const text = 'a'.repeat(TARGET_CHUNK_CHARS * 2 + 10);

    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(3);
    expectValidChunks(text, chunks);
  });

  it('never cuts a surrogate pair in half', () => {
    // An emoji is two UTF-16 code units. This length gives odd ideal cuts (25,001 and
    // 50,001), which a plain slice would place between the two halves.
    const text = '\u{1F600}'.repeat(TARGET_CHUNK_CHARS + 1);

    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(3);
    expectValidChunks(text, chunks);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
  });

  it('splits text of the maximum length into at most 6 parts', () => {
    const chunks = splitIntoChunks('a'.repeat(MAX_TEXT_CHARS));

    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(MAX_CHUNKS).toBe(6);
  });

  it('refuses text that would need more than MAX_CHUNKS parts', () => {
    expect(() => splitIntoChunks('a'.repeat(TARGET_CHUNK_CHARS * MAX_CHUNKS + 1))).toThrow(
      RangeError,
    );
  });
});
