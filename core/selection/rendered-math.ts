const RENDERED_MATH_SELECTOR = [
  '.katex',
  'mjx-container',
  'math',
  '[data-tex]',
  '[data-latex]',
].join(',');

const LEGACY_MATH_RENDER_SELECTOR = [
  ':scope > .MathJax',
  ':scope > .MathJax_Preview',
  ':scope > .MathJax_Display',
].join(',');

function renderedMathLatex(element: Element): string | undefined {
  const annotation = element.matches('annotation[encoding*="tex" i]')
    ? element
    : element.querySelector('annotation[encoding*="tex" i]');
  const candidate =
    element.getAttribute('data-tex') ??
    element.getAttribute('data-latex') ??
    element.getAttribute('alttext') ??
    annotation?.textContent;
  const latex = candidate?.trim();
  return latex || undefined;
}

function alreadyDelimited(latex: string): boolean {
  return /^(?:\${1,2}|\\\(|\\\[)/u.test(latex);
}

function delimitedLatex(latex: string, display: boolean): string {
  if (alreadyDelimited(latex)) return latex;
  return display ? `\\[${latex}\\]` : `$${latex}$`;
}

function legacyDisplayMode(script: HTMLScriptElement): boolean {
  return /mode\s*=\s*display/iu.test(script.type) ||
    Boolean(script.closest('.MathJax_Display'));
}

/**
 * Replaces rendered formula DOM with one TeX source fragment. MathJax v2 keeps
 * a visible rendering beside a script[type="math/tex"]; removing those sibling
 * renderers first prevents the same formula from entering translation twice.
 */
export function replaceRenderedMathWithLatex(root: ParentNode): number {
  let replacements = 0;

  for (const script of [...root.querySelectorAll<HTMLScriptElement>('script[type^="math/tex"]')]) {
    if (!script.parentNode) continue;
    const latex = script.textContent?.trim();
    if (!latex) continue;
    const displayContainer = script.closest<HTMLElement>('.MathJax_Display');
    const parent = script.parentElement;
    if (displayContainer) {
      displayContainer.replaceWith(document.createTextNode(delimitedLatex(latex, true)));
    } else {
      parent?.querySelectorAll(LEGACY_MATH_RENDER_SELECTOR)
        .forEach((renderer) => renderer.remove());
      script.replaceWith(document.createTextNode(delimitedLatex(
        latex,
        legacyDisplayMode(script),
      )));
    }
    replacements += 1;
  }

  const candidates = [...root.querySelectorAll(RENDERED_MATH_SELECTOR)].filter(
    (element) => !element.parentElement?.closest(RENDERED_MATH_SELECTOR),
  );
  for (const element of candidates) {
    if (!element.parentNode) continue;
    const latex = renderedMathLatex(element);
    if (!latex) continue;
    const display = Boolean(
      element.closest('.katex-display') ||
      element.getAttribute('display') === 'block' ||
      element.getAttribute('display') === 'true',
    );
    element.replaceWith(document.createTextNode(delimitedLatex(latex, display)));
    replacements += 1;
  }

  return replacements;
}
