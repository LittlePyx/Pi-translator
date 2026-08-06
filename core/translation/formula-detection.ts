const EXPLICIT_LATEX = /(?:\\(?:begin|end|frac|dfrac|tfrac|sqrt|sum|prod|int|lim|mathbf|mathrm|mathcal|operatorname)\b|\\[()[\]]|\$[^$\n]+\$)/u;
const TEX_COMMAND = /\\[A-Za-z@]+(?:\*)?/u;
const TEX_SCRIPT = /(?:[A-Za-z0-9)}\]])[_^](?:\{[^}\n]+\}|[A-Za-z0-9])/u;
const STRONG_MATH_SYMBOL = /[∑∫∏√∞∂∇≠≤≥≈⊗⊕∈∉∪∩∀∃]/u;
const SCRIPT_CHARACTER = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/u;
const GREEK_CHARACTER = /[Α-Ωα-ωϑϕϖϵ]/gu;
const REPLACEMENT_CHARACTER = /[\uFFFD\uE000-\uF8FF]/u;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const REPEATED_DECIMAL_RUN = /(?:^|[^\d.])(\d{1,6}\.\d{1,6})(?:\1)+(?![\d.])/u;
const EQUATION = /(?:^|[\s(])(?:[A-Za-zΑ-Ωα-ω][\wΑ-Ωα-ω]*(?:\([^)]{1,80}\))?)\s*(?:=|≈|≠|≤|≥|<|>)\s*\S/u;
const MATH_OPERATOR = /[=+\-−*/×÷^_<>≤≥≈≠]/gu;
const STRUCTURED_RENDERED_MATH = /(?:\barg\s*(?:min|max)\b|\bKL\s*\([^\n)]{1,120}\)|\bd[A-Za-zΑ-Ωα-ω]\s*\/\s*d[A-Za-zΑ-Ωα-ω]\b|\bs\.?\s*t\.?\s*[:.]?\s*[A-Za-zΑ-Ωα-ω])/iu;
const URL_LIKE = /(?:\b(?:https?|ftp):\/\/|\/\/(?:www\.)?|www\.)[^\s<>"']+/giu;
const PDF_MATH_LETTER = 'A-Za-zΑ-Ωα-ωℙℚ𝔼Ππ';
const PDF_SPACED_EQUATION = new RegExp(
  String.raw`(?:^|[\s([{,;:])(?:[${PDF_MATH_LETTER}][${PDF_MATH_LETTER}\d]*|[${PDF_MATH_LETTER}](?:\s+[${PDF_MATH_LETTER}\d]){1,4}|[${PDF_MATH_LETTER}]\s*\([^\n)]{1,120}\))\s*(?::=|=|≈|≠|≤|≥|<|>)\s*(?:[+\-−]?\s*)?(?:[${PDF_MATH_LETTER}\d([{])`,
  'u',
);
const PDF_EQUATION_CONTINUATION = new RegExp(
  String.raw`^\s*(?::=|=|≈|≠|≤|≥|<|>)\s*(?:[+\-−]?\s*)?(?:[${PDF_MATH_LETTER}\d([{])`,
  'u',
);
const PDF_TRAILING_EQUATION = new RegExp(
  String.raw`(?:^|[\s([{,;:])(?:[${PDF_MATH_LETTER}][${PDF_MATH_LETTER}\d]*|[${PDF_MATH_LETTER}](?:\s+[${PDF_MATH_LETTER}\d]){1,4}|[${PDF_MATH_LETTER}]\s*\([^\n)]{1,120}\))\s*(?::=|=|≈|≠|≤|≥|<|>)\s*$`,
  'u',
);
const PDF_STRUCTURED_OPERATOR = new RegExp(
  String.raw`\b(?:arg\s*(?:min|max)|min|max|sup|inf|lim|log|exp|det|Pr)\b`,
  'iu',
);
const PDF_OPERATOR_CONTEXT = /(?:[=+*\/^_<>≤≥≈≠∈∉∑∫∏√∞∂∇⊗⊕∪∩{}|]|\[|\]|[Α-Ωα-ωϑϕϖϵ])/u;
const PDF_STANDALONE_ASSIGNMENT = /^\s*:=\s*$/u;

function hasPdfStructuredOperatorContext(text: string): boolean {
  if (PDF_OPERATOR_CONTEXT.test(text)) return true;
  return (text.match(/\b[A-Z]\b/gu)?.length ?? 0) >= 2;
}

export function containsExplicitLatex(text: string): boolean {
  return EXPLICIT_LATEX.test(text) || TEX_COMMAND.test(text) || TEX_SCRIPT.test(text);
}

/**
 * Detects rendered mathematics whose selectable text is likely to have lost
 * its original TeX structure. Explicit TeX source stays on the text path.
 */
export function shouldUseVisionForRenderedFormula(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (REPLACEMENT_CHARACTER.test(normalized) || CONTROL_CHARACTER.test(normalized)) return true;
  if (containsExplicitLatex(normalized)) return false;
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
  if (!normalized) return false;
  if (REPLACEMENT_CHARACTER.test(normalized) || CONTROL_CHARACTER.test(normalized)) return true;
  if (REPEATED_DECIMAL_RUN.test(normalized)) return true;

  // Query strings and documentation links commonly contain '=' and '_'. Strip
  // them before applying deliberately permissive PDF-text-layer heuristics.
  const withoutUrls = normalized.replace(URL_LIKE, ' ').trim();
  if (!withoutUrls) return false;
  return Boolean(
    containsExplicitLatex(withoutUrls)
    || shouldUseVisionForRenderedFormula(withoutUrls)
    || PDF_SPACED_EQUATION.test(withoutUrls)
    || PDF_EQUATION_CONTINUATION.test(withoutUrls)
    || PDF_TRAILING_EQUATION.test(withoutUrls)
    || PDF_STANDALONE_ASSIGNMENT.test(withoutUrls)
    || (
      PDF_STRUCTURED_OPERATOR.test(withoutUrls) &&
      hasPdfStructuredOperatorContext(withoutUrls)
    ),
  );
}
