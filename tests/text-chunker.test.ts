import { describe, expect, it } from 'vitest';
import { splitLongTranslationText } from '../core/translation/text-chunker';
import { protectLatex } from '../core/latex/protector';

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
    expect(chunks.slice(0, -1).every((chunk) => chunk.endsWith('.'))).toBe(true);
  });

  it.each([
    String.raw`\begin{align}` + '\n' + 'x &= y + z \\\\\n'.repeat(35) + String.raw`\end{align}`,
    '$' + 'x + y + '.repeat(50) + 'z$',
    String.raw`\[` + 'x + '.repeat(90) + String.raw`\]`,
    String.raw`\textbf{` + 'important prose '.repeat(40) + '}',
    String.raw`\custom{` + 'nested {value} '.repeat(35) + '}',
  ])('keeps a complete TeX fragment intact across the size boundary', (formula) => {
    const source = 'Intro sentence. '.repeat(12) + formula + ' A final explanation.';
    const chunks = splitLongTranslationText(source, 250);
    expect(chunks.filter((chunk) => chunk.includes(formula))).toHaveLength(1);
    expect(chunks.flatMap((chunk) => protectLatex(chunk).warnings)
      .some((warning) => warning.code === 'INCOMPLETE_LATEX_PROTECTED')).toBe(false);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(source.replace(/\s+/g, ' '));
  });

  it('does not cut an incomplete math selection into unprotected tails', () => {
    const source = 'Introduction. '.repeat(15) + '$' + 'x + y '.repeat(100);
    const chunks = splitLongTranslationText(source, 250);
    expect(chunks.filter((chunk) => chunk.includes('$'))).toHaveLength(1);
    expect(chunks.at(-1)).toContain('x + y '.repeat(100).trim());
  });
});
