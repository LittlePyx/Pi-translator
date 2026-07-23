import { describe, expect, it } from 'vitest';
import { shouldProtectLatex } from '../core/translation/content-mode';

describe('translation content mode', () => {
  it('always protects explicit LaTeX mode', () => {
    expect(
      shouldProtectLatex('latex', 'https://example.com/', 'Plain-looking text'),
    ).toBe(true);
  });

  it('never protects explicit plain-text mode', () => {
    expect(
      shouldProtectLatex('plain', 'https://www.overleaf.com/project/123', '$x$'),
    ).toBe(false);
  });

  it('protects Overleaf selections in automatic mode', () => {
    expect(
      shouldProtectLatex(
        'auto',
        'https://www.overleaf.com/project/123',
        'We prove the theorem.',
      ),
    ).toBe(true);
  });

  it('detects common LaTeX signals on ordinary pages', () => {
    expect(
      shouldProtectLatex('auto', 'https://example.com/', 'See \\cite{smith2025}.'),
    ).toBe(true);
    expect(
      shouldProtectLatex('auto', 'https://example.com/', 'Ordinary prose only.'),
    ).toBe(false);
  });
});
