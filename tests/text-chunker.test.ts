import { describe, expect, it } from 'vitest';
import { splitLongTranslationText } from '../core/translation/text-chunker';

describe('long translation chunking', () => {
  it('keeps short text in one request', () => {
    expect(splitLongTranslationText('A short paragraph.', 300)).toEqual([
      'A short paragraph.',
    ]);
  });

  it('prefers sentence boundaries and respects the maximum size', () => {
    const text = Array.from(
      { length: 30 },
      (_, index) => `Sentence ${index + 1} explains the experiment clearly.`,
    ).join(' ');
    const chunks = splitLongTranslationText(text, 260);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 260)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
});
