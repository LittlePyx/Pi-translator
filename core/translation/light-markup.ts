import { splitLatexDisplaySegments } from './latex-display';

export type LightMarkupSegment =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string };

const STRONG_MARKERS = ['***', '___', '**', '__'] as const;

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

interface ProtectedRange {
  start: number;
  end: number;
}

function latexRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  let offset = 0;
  for (const segment of splitLatexDisplaySegments(text)) {
    const value = segment.kind === 'math' ? segment.raw : segment.text;
    if (segment.kind === 'math') ranges.push({ start: offset, end: offset + value.length });
    offset += value.length;
  }
  return ranges;
}

function protectedAt(ranges: ProtectedRange[], index: number): ProtectedRange | undefined {
  return ranges.find((range) => index >= range.start && index < range.end);
}

function closingMarker(
  text: string,
  marker: string,
  start: number,
  ranges: ProtectedRange[],
): number | undefined {
  for (let cursor = start; cursor < text.length;) {
    const found = text.indexOf(marker, cursor);
    if (found < 0) return undefined;
    const protectedRange = protectedAt(ranges, found);
    if (protectedRange) {
      cursor = protectedRange.end;
      continue;
    }
    if (!isEscaped(text, found)) return found;
    cursor = found + marker.length;
  }
  return undefined;
}

/**
 * Parses only the two common Markdown strong markers. Result text never becomes
 * HTML, so model output cannot inject markup or scripts into the extension UI.
 */
export function splitLightMarkup(text: string): LightMarkupSegment[] {
  const segments: LightMarkupSegment[] = [];
  const ranges = latexRanges(text);
  let plainStart = 0;
  for (let cursor = 0; cursor < text.length - 1;) {
    const protectedRange = protectedAt(ranges, cursor);
    if (protectedRange) {
      cursor = protectedRange.end;
      continue;
    }
    const marker = STRONG_MARKERS.find((candidate) =>
      text.startsWith(candidate, cursor) && !isEscaped(text, cursor));
    if (!marker) {
      cursor += 1;
      continue;
    }
    const end = closingMarker(text, marker, cursor + marker.length, ranges);
    if (end === undefined || end === cursor + marker.length) {
      cursor += 1;
      continue;
    }
    if (cursor > plainStart) {
      segments.push({ kind: 'text', text: text.slice(plainStart, cursor) });
    }
    segments.push({
      kind: 'strong',
      text: text.slice(cursor + marker.length, end),
    });
    cursor = end + marker.length;
    plainStart = cursor;
  }
  if (plainStart < text.length) {
    segments.push({ kind: 'text', text: text.slice(plainStart) });
  }
  return segments;
}
