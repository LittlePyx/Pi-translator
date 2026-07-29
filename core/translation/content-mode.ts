import type { TranslationContentMode } from './types';

const LATEX_SIGNAL =
  /\\(?:[A-Za-z@]+\*?|[()[\]{}%&#_$])|\${1,2}[^$\n]+\${1,2}/;

export function shouldProtectLatex(
  mode: TranslationContentMode,
  _pageUrl: string,
  text: string,
): boolean {
  if (mode === 'latex') return true;
  if (mode === 'plain') return false;
  return LATEX_SIGNAL.test(text);
}
