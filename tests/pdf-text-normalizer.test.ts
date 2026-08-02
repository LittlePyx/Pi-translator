import { describe, expect, it } from 'vitest';
import { normalizePdfSelectionText } from '../core/pdf/text-normalizer';

describe('PDF selection text normalization', () => {
  it('removes Unicode soft hyphens without introducing spaces', () => {
    expect(normalizePdfSelectionText('micro\u00adscope and inter\u00ad\nnational work'))
      .toBe('microscope and international work');
  });

  it('preserves ordinary line boundaries when layout geometry is unavailable', () => {
    expect(normalizePdfSelectionText(
      'The proposed method reconstructs the scene\r\nfrom limited measurements.\r\n\r\nThe second paragraph remains separate.',
    )).toBe(
      'The proposed method reconstructs the scene\nfrom limited measurements.\n\n' +
      'The second paragraph remains separate.',
    );
  });

  it('keeps visible cross-line hyphens in academic compounds', () => {
    expect(normalizePdfSelectionText(
      'The p-\nvalue, F-\nscore, encoder-\ndecoder, and state-of-the-\nart method.',
    )).toBe('The p-value, F-score, encoder-decoder, and state-of-the-art method.');
  });

  it('keeps headings and list items separate while preserving hard-hyphen continuations', () => {
    expect(normalizePdfSelectionText(
      'Methods:\n1. Collect limited measure-\nments for every scene.\n2. Reconstruct the image.\n\nCONCLUSION\nThe method is robust.',
    )).toBe(
      'Methods:\n1. Collect limited measure-ments for every scene.\n' +
      '2. Reconstruct the image.\n\nCONCLUSION\nThe method is robust.',
    );
  });

  it('does not modify LaTeX, equations, URLs, DOI values, or citations', () => {
    const source = [
      'The objective is defined as',
      String.raw`\begin{equation}`,
      String.raw`\mathcal{L}=\sum_i \lVert x_i-\hat{x}_i\rVert_2^2,`,
      String.raw`\label{eq:loss}`,
      String.raw`\end{equation}`,
      'as used by Smith et al. [12].',
      'Code: https://example.org/a-b?q=x_y',
      'doi:10.1234/ABC.def-12',
    ].join('\n');
    const result = normalizePdfSelectionText(source);
    for (const protectedValue of [
      String.raw`\begin{equation}`,
      String.raw`\mathcal{L}=\sum_i \lVert x_i-\hat{x}_i\rVert_2^2,`,
      String.raw`\label{eq:loss}`,
      String.raw`\end{equation}`,
      '[12]',
      'https://example.org/a-b?q=x_y',
      'doi:10.1234/ABC.def-12',
    ]) {
      expect(result).toContain(protectedValue);
    }
  });

  it('never reorders a likely two-column transition with reliable geometry', () => {
    const text = 'Left first\nLeft second\nRight first\nRight second';
    const result = normalizePdfSelectionText(text, {
      lines: [
        { text: 'Left first', geometry: { pageNumber: 1, x: 10, y: 10, width: 80, height: 10 } },
        { text: 'Left second', geometry: { pageNumber: 1, x: 10, y: 22, width: 80, height: 10 } },
        { text: 'Right first', geometry: { pageNumber: 1, x: 120, y: 10, width: 80, height: 10 } },
        { text: 'Right second', geometry: { pageNumber: 1, x: 120, y: 22, width: 80, height: 10 } },
      ],
    });
    expect(result).toBe('Left first Left second\nRight first Right second');
    expect(result.indexOf('Left second')).toBeLessThan(result.indexOf('Right first'));
  });

  it('ignores incomplete or mismatched geometry rather than guessing layout', () => {
    expect(normalizePdfSelectionText('Alpha line\nBeta line', {
      lines: [
        { text: 'Different line', geometry: { pageNumber: 1, x: 0, y: 0, width: 20, height: 10 } },
        { text: 'Beta line' },
      ],
    })).toBe('Alpha line\nBeta line');
  });

  it('joins ordinary wrapped lines only when complete geometry is reliable', () => {
    const text = 'The proposed method reconstructs\nthe scene from measurements.';
    expect(normalizePdfSelectionText(text, {
      lines: [
        { text: 'The proposed method reconstructs', geometry: { pageNumber: 1, x: 10, y: 10, width: 180, height: 10 } },
        { text: 'the scene from measurements.', geometry: { pageNumber: 1, x: 10, y: 22, width: 180, height: 10 } },
      ],
    })).toBe('The proposed method reconstructs the scene from measurements.');
  });

  it('is idempotent and preserves protected tokens across varied wrappers', () => {
    const wrappers = [
      ['A cited result', '[7] remains valid.'],
      ['See', 'https://example.com/paper.pdf?x=1&y=2'],
      ['The identifier is', '10.5555/example.doi-1'],
      [String.raw`Inline $x_i$`, String.raw`and \eqref{eq:loss} remain.`],
      ['中文换行', '不会增加空格。'],
    ];
    for (const lines of wrappers) {
      const once = normalizePdfSelectionText(lines.join('\n'));
      expect(normalizePdfSelectionText(once)).toBe(once);
      for (const token of lines.join(' ').match(/(?:https?:\/\/\S+|10\.\d{4,9}\/\S+|\[\d+\]|\$[^$]+\$|\\eqref\{[^}]+\})/gu) ?? []) {
        expect(once).toContain(token);
      }
    }
  });
});
