import type { TranslationContentMode } from './types';

const LATEX_SIGNAL =
  /\\(?:begin|end|cite|citep|citet|ref|eqref|label|text|textbf|textit|emph|frac|sqrt|section|subsection)\b|\\[()[\]]|\$[^$\n]+\$/;

export function shouldProtectLatex(
  mode: TranslationContentMode,
  pageUrl: string,
  text: string,
): boolean {
  if (mode === 'latex') return true;
  if (mode === 'plain') return false;

  try {
    const url = new URL(pageUrl);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'www.overleaf.com' &&
      url.pathname.startsWith('/project/')
    ) {
      return true;
    }
  } catch {
    // The text heuristic remains available for malformed or missing page URLs.
  }
  return LATEX_SIGNAL.test(text);
}
