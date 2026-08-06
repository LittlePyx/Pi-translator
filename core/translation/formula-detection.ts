const EXPLICIT_LATEX = /(?:\\(?:begin|end|frac|dfrac|tfrac|sqrt|sum|prod|int|lim|mathbf|mathrm|mathcal|operatorname)\b|\\[()[\]]|\$[^$\n]+\$)/u;
const TEX_COMMAND = /\\[A-Za-z@]+(?:\*)?/u;
const TEX_SCRIPT = /(?:[A-Za-z0-9)}\]])[_^](?:\{[^}\n]+\}|[A-Za-z0-9])/u;
const STRONG_MATH_SYMBOL = /[∑∫∏√∞∂∇≠≤≥≈⊗⊕∈∉∪∩∀∃]/u;
const SCRIPT_CHARACTER = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/u;
const GREEK_CHARACTER = /[Α-Ωα-ωϑϕϖϵ]/gu;
const REPLACEMENT_CHARACTER = /[\uFFFD\uE000-\uF8FF]/u;
const EQUATION = /(?:^|[\s(])(?:[A-Za-zΑ-Ωα-ω][\wΑ-Ωα-ω]*(?:\([^)]{1,80}\))?)\s*(?:=|≈|≠|≤|≥|<|>)\s*\S/u;
const MATH_OPERATOR = /[=+\-−*/×÷^_<>≤≥≈≠]/gu;
const STRUCTURED_RENDERED_MATH = /(?:\barg\s*(?:min|max)\b|\bKL\s*\([^\n)]{1,120}\)|\bd[A-Za-zΑ-Ωα-ω]\s*\/\s*d[A-Za-zΑ-Ωα-ω]\b|\bs\.?\s*t\.?\s*[:.]?\s*[A-Za-zΑ-Ωα-ω])/iu;

export function containsExplicitLatex(text: string): boolean {
  return EXPLICIT_LATEX.test(text) || TEX_COMMAND.test(text) || TEX_SCRIPT.test(text);
}

/**
 * Detects rendered mathematics whose selectable text is likely to have lost
 * its original TeX structure. Explicit TeX source stays on the text path.
 */
export function shouldUseVisionForRenderedFormula(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || containsExplicitLatex(normalized)) return false;
  if (REPLACEMENT_CHARACTER.test(normalized)) return true;
  if (STRONG_MATH_SYMBOL.test(normalized) || SCRIPT_CHARACTER.test(normalized)) return true;
  if (STRUCTURED_RENDERED_MATH.test(normalized)) return true;

  const greekCount = normalized.match(GREEK_CHARACTER)?.length ?? 0;
  const operatorCount = normalized.match(MATH_OPERATOR)?.length ?? 0;
  if (greekCount >= 2 && operatorCount >= 1) return true;
  if (EQUATION.test(normalized) && operatorCount >= 2) return true;
  return false;
}

/**
 * A PDF text layer can expose TeX-looking characters without preserving the
 * visual formula's grouping or layout. In Pi PDF, even apparently explicit
 * TeX is therefore verified against the rendered page image.
 */
export function shouldUseVisionForPdfFormula(text: string): boolean {
  const normalized = text.trim();
  return Boolean(
    normalized &&
    (containsExplicitLatex(normalized) || shouldUseVisionForRenderedFormula(normalized)),
  );
}
