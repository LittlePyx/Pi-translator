import { containsLatexRowStructure } from './latex-structure';
import { repairCommonVisionLatex } from './formula-output-validation';

export type LatexDisplaySegment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string; raw: string; displayMode: boolean };

export interface LatexRenderParts {
  tex: string;
  equationTag?: string;
}

const SIMPLE_DISPLAY_TAG = /(\\+)tag\s*\{([^{}]{1,40})\}/gu;
const STRONG_EDGE_MARKERS = ['***', '___', '**', '__'] as const;
const STANDALONE_EQUATION_NUMBER = /^[\(\uFF08\[]\s*[A-Za-z]?\d+(?:[.-]\d+)*[A-Za-z]?\s*[\)\uFF09\]]$/u;
const POTENTIAL_OPTIMIZATION_OPERATOR = /(?:\\(?:operatorname\*?|mathrm|text)\s*\{\s*arg|\\arg\s*(?:\\(?:min|max)|(?:min|max))|(?:^|[^A-Za-z0-9\\])arg\s*(?:min|max))/u;
const CANONICAL_OPTIMIZATION_OPERATOR = /\\operatorname\*\s*\{\s*arg\s*(?:\\,\s*)?(?:min|max)\s*\}\s*_\s*(?:\{|[A-Za-z0-9\\])/u;
const STRUCTURED_OPTIMIZATION_OBJECTIVE = /(?:^|[^\\])=|\\(?:left|bigl|Bigl|biggl|Biggl)\s*\\\{|\\(?:frac|sum|int|mathbb|mathcal|mathbf)\b|KL\s*\(/u;
const LONG_STANDALONE_FORMULA_MIN_LENGTH = 32;

export interface LatexDisplayContext {
  /** Complete untouched result string used only to infer presentation. */
  sourceText: string;
  /** Offset of `text` inside `sourceText`. */
  sourceOffset: number;
}

function displayTags(tex: string): RegExpMatchArray[] {
  const hasRowEnvironment = containsLatexRowStructure(tex);
  const tags = [...tex.matchAll(SIMPLE_DISPLAY_TAG)].filter((match) => {
    const slashCount = match[1]?.length ?? 0;
    return slashCount <= 2 || !hasRowEnvironment;
  });
  SIMPLE_DISPLAY_TAG.lastIndex = 0;
  return tags;
}

function stripStrongEdgeMarkers(value: string): string {
  let remainder = value.trim();
  let changed = true;
  while (changed && remainder) {
    changed = false;
    for (const marker of STRONG_EDGE_MARKERS) {
      if (remainder.startsWith(marker)) {
        remainder = remainder.slice(marker.length).trim();
        changed = true;
        break;
      }
      if (remainder.endsWith(marker)) {
        remainder = remainder.slice(0, -marker.length).trim();
        changed = true;
        break;
      }
    }
  }
  return remainder;
}

function occupiesLogicalLines(
  sourceText: string,
  start: number,
  end: number,
): boolean {
  const lineStart = sourceText.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const foundLineEnd = sourceText.indexOf('\n', end);
  const lineEnd = foundLineEnd < 0 ? sourceText.length : foundLineEnd;
  const prefix = stripStrongEdgeMarkers(sourceText.slice(lineStart, start));
  const suffix = stripStrongEdgeMarkers(sourceText.slice(end, lineEnd));
  return !prefix && (!suffix || STANDALONE_EQUATION_NUMBER.test(suffix));
}

function displayOptimizationCopy(tex: string): string | undefined {
  if (!POTENTIAL_OPTIMIZATION_OPERATOR.test(tex)) return undefined;
  const compatible = repairCommonVisionLatex(tex);
  if (
    compatible.length < LONG_STANDALONE_FORMULA_MIN_LENGTH ||
    !CANONICAL_OPTIMIZATION_OPERATOR.test(compatible) ||
    !STRUCTURED_OPTIMIZATION_OBJECTIVE.test(compatible)
  ) return undefined;
  return compatible;
}
function normalizedEquationTag(value: string): string {
  const trimmed = value.trim();
  const parenthesized = /^\(\s*([^()]*)\s*\)$/u.exec(trimmed);
  return parenthesized?.[1]?.trim() || trimmed;
}

/**
 * Keeps a single top-level equation number outside the horizontally scrolling
 * formula body. The original segment remains untouched for copy/export.
 */
export function latexRenderParts(tex: string, displayMode: boolean): LatexRenderParts {
  if (!displayMode) return { tex };
  const renderedTex = displayOptimizationCopy(tex) ?? tex;
  const tags = displayTags(renderedTex);
  if (tags.length !== 1) return { tex: renderedTex };
  const match = tags[0]!;
  const equationTag = normalizedEquationTag(match[2] ?? '');
  if (!equationTag || match.index === undefined) return { tex: renderedTex };
  return {
    tex: `${renderedTex.slice(0, match.index)}${renderedTex.slice(match.index + match[0].length)}`.trim(),
    equationTag,
  };
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function closingDelimiter(
  text: string,
  start: number,
  delimiter: string,
): number | undefined {
  for (let cursor = start; cursor < text.length;) {
    const found = text.indexOf(delimiter, cursor);
    if (found < 0) return undefined;
    if (!isEscaped(text, found)) return found;
    cursor = found + delimiter.length;
  }
  return undefined;
}

interface LatexDelimiterPair {
  opener: string;
  closer: string;
  displayMode: boolean;
}

/**
 * Vision APIs sometimes return an already JSON-escaped TeX string as visible
 * text, leaving two backslashes in front of `[` / `(`. Recognize that wrapper
 * as a delimiter without rewriting the stored result. The longer forms must be
 * checked first so their second backslash is not mistaken for a normal opener.
 */
function delimiterAt(text: string, index: number): LatexDelimiterPair | undefined {
  if (text[index] === '\\') {
    let slashCount = 1;
    while (text[index + slashCount] === '\\') slashCount += 1;
    const bracket = text[index + slashCount];
    if (slashCount >= 2 && (bracket === '[' || bracket === '(')) {
      const slashes = '\\'.repeat(slashCount);
      return {
        opener: `${slashes}${bracket}`,
        closer: `${slashes}${bracket === '[' ? ']' : ')'}`,
        displayMode: bracket === '[',
      };
    }
  }
  if (text.startsWith('\\[', index)) {
    return { opener: '\\[', closer: '\\]', displayMode: true };
  }
  if (text.startsWith('\\(', index)) {
    return { opener: '\\(', closer: '\\)', displayMode: false };
  }
  if (text.startsWith('$$', index) && !isEscaped(text, index)) {
    return { opener: '$$', closer: '$$', displayMode: true };
  }
  if (text[index] === '$' && !isEscaped(text, index)) {
    return { opener: '$', closer: '$', displayMode: false };
  }
  return undefined;
}

export function splitLatexDisplaySegments(
  text: string,
  context?: LatexDisplayContext,
): LatexDisplaySegment[] {
  const segments: LatexDisplaySegment[] = [];
  const sourceText = context?.sourceText ?? text;
  const sourceOffset = context?.sourceOffset ?? 0;
  let textStart = 0;
  for (let index = 0; index < text.length;) {
    const delimiter = delimiterAt(text, index);
    if (!delimiter) {
      index += 1;
      continue;
    }
    const end = closingDelimiter(
      text,
      index + delimiter.opener.length,
      delimiter.closer,
    );
    const tex = end === undefined
      ? ''
      : text.slice(index + delimiter.opener.length, end).trim();
    if (end === undefined || !tex) {
      index += delimiter.opener.length;
      continue;
    }
    if (index > textStart) segments.push({ kind: 'text', text: text.slice(textStart, index) });
    const rawEnd = end + delimiter.closer.length;
    const globalStart = sourceOffset + index;
    const globalEnd = sourceOffset + rawEnd;
    const isStandalone = (
      globalStart >= 0 &&
      globalEnd <= sourceText.length &&
      occupiesLogicalLines(sourceText, globalStart, globalEnd)
    );
    const displayMode = delimiter.displayMode ||
      displayTags(tex).length > 0 ||
      displayOptimizationCopy(tex) !== undefined ||
      (isStandalone && (
        tex.length >= LONG_STANDALONE_FORMULA_MIN_LENGTH ||
        text.slice(index, rawEnd).includes('\n')
      ));
    segments.push({
      kind: 'math',
      tex,
      raw: text.slice(index, rawEnd),
      displayMode,
    });
    index = rawEnd;
    textStart = index;
  }
  if (textStart < text.length) segments.push({ kind: 'text', text: text.slice(textStart) });
  if (!segments.length && text) segments.push({ kind: 'text', text });
  return segments;
}

export function containsRenderableLatex(text: string): boolean {
  return splitLatexDisplaySegments(text).some((segment) => segment.kind === 'math');
}
