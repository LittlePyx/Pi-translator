import { extractDelimitedFormulae, normalizeFormula, structuralIssues } from './formula-output-validation';

export interface TemplateMathSpan { start: number; end: number; latex: string; display: boolean }

function groupEnd(text: string, start: number): number | undefined {
  if (text[start] !== '{') return undefined;
  let depth = 0;
  for (let i = start; i < Math.min(text.length, start + 2048); i += 1) {
    if (i && text[i - 1] === '\\') continue;
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return undefined;
}

/** Only explicit, balanced TeX is eligible for local registration. Plain
 * letters/numbers and damaged braces are not guessed into mathematical spans. */
export function templateMathSpans(text: string): TemplateMathSpan[] {
  const spans: TemplateMathSpan[] = [];
  const delimited = extractDelimitedFormulae(text);
  let cursor = 0;
  if (delimited.balanced) for (const [i, snippet] of delimited.snippets.entries()) {
    const start = text.indexOf(snippet, cursor);
    if (start < 0) continue;
    spans.push({ start, end: start + snippet.length, latex: delimited.formulae[i]!,
      display: snippet.startsWith('\\[') || snippet.startsWith('$$') });
    cursor = start + snippet.length;
  }
  const seed = /\\(?:mathbb|mathbf|mathcal|mathrm|mathit|boldsymbol|frac|sqrt)\s*\{|(?<![\w\\])[A-Za-zℝℂℕℤℚ](?=[_^]\s*\{)/gu;
  for (const match of text.matchAll(seed)) {
    const start = match.index!;
    if (spans.some((span) => start >= span.start && start < span.end)) continue;
    let end = start + 1;
    if (match[0].startsWith('\\')) {
      const open = start + match[0].lastIndexOf('{');
      const close = groupEnd(text, open);
      if (!close) continue;
      end = close;
      if (/^\\frac/u.test(match[0])) {
        const denominator = groupEnd(text, end);
        if (!denominator) continue;
        end = denominator;
      }
    }
    while (/[_^]/u.test(text[end] ?? '') && text[end]) {
      const rest = text.slice(end + 1);
      const whitespace = /^\s*/u.exec(rest)![0].length;
      const next = end + 1 + whitespace;
      const close = groupEnd(text, next);
      if (!close) break;
      end = close;
    }
    const latex = text.slice(start, end);
    if (end > start + 1 && !structuralIssues(latex).length) spans.push({ start, end, latex, display: false });
  }
  return spans.sort((a, b) => a.start - b.start).filter((span, i, all) =>
    !all.slice(0, i).some((previous) => span.start < previous.end));
}

export function hasUnregisteredMath(text: string): boolean {
  return /\{\{|\}\}|\\(?:[([]|(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|phi|psi|omega|times|frac|sqrt|mathbb|mathbf|mathcal|mathrm|bar|hat|in|sum|begin)\b)|[\p{L}\p{N}][_^]\s*\{|(?<![\p{L}\p{N}])[A-Za-z]_[A-Za-z\d](?![\p{L}\p{N}])|\$/u.test(text);
}

export function sameTemplateMath(a: string, b: string): boolean {
  return normalizeFormula(a) === normalizeFormula(b);
}
