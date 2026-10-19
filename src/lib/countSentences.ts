// Unicode sentence segmentation (UAX #29) instead of splitting on [.!?]: it keeps
// "1.02.2024 r.", "Sp. z o.o." and "1.5 mln" inside one sentence.
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

/**
 * Counts sentences in plain text. Heuristic: an abbreviation followed by a capital
 * letter (e.g. "tj. Przychody") still counts as a sentence break.
 */
export function countSentences(text: string): number {
  let count = 0;

  for (const { segment } of sentenceSegmenter.segment(text)) {
    if (segment.trim().length > 0) {
      count += 1;
    }
  }

  return count;
}
