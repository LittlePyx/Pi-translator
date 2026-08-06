import { containsLatexRowStructure } from './latex-structure';

export type LatexDisplaySegment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string; raw: string; displayMode: boolean };

export interface LatexRenderParts {
  tex: string;
  equationTag?: string;
}

const SIMPLE_DISPLAY_TAG = /(\\+)tag\s*\{([^{}]{1,40})\}/gu;
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
  const hasRowEnvironment = containsLatexRowStructure(tex);
  const tags = [...tex.matchAll(SIMPLE_DISPLAY_TAG)].filter((match) => {
    const slashCount = match[1]?.length ?? 0;
    return slashCount <= 2 || !hasRowEnvironment;
  });
  SIMPLE_DISPLAY_TAG.lastIndex = 0;
  if (tags.length !== 1) return { tex };
  const match = tags[0]!;
  const equationTag = normalizedEquationTag(match[2] ?? '');
  if (!equationTag || match.index === undefined) return { tex };
  return {
    tex: `${tex.slice(0, match.index)}${tex.slice(match.index + match[0].length)}`.trim(),
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

export function splitLatexDisplaySegments(text: string): LatexDisplaySegment[] {
  const segments: LatexDisplaySegment[] = [];
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
    segments.push({
      kind: 'math',
      tex,
      raw: text.slice(index, end + delimiter.closer.length),
      displayMode: delimiter.displayMode,
    });
    index = end + delimiter.closer.length;
    textStart = index;
  }
  if (textStart < text.length) segments.push({ kind: 'text', text: text.slice(textStart) });
  if (!segments.length && text) segments.push({ kind: 'text', text });
  return segments;
}

export function containsRenderableLatex(text: string): boolean {
  return splitLatexDisplaySegments(text).some((segment) => segment.kind === 'math');
}
