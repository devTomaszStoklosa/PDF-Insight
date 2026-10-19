/**
 * Longest extracted text accepted for one analysis, shared by the browser, which checks it
 * before upload, and the server, which rejects longer text with 413. Longer than one model
 * call takes: the server analyzes such text in parts (server/textChunks.ts).
 */
export const MAX_TEXT_CHARS = 225_000;
