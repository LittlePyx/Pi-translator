export type LatexDisplaySegment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string; raw: string; displayMode: boolean };

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

export function splitLatexDisplaySegments(text: string): LatexDisplaySegment[] {
  const segments: LatexDisplaySegment[] = [];
  let textStart = 0;
  for (let index = 0; index < text.length;) {
    let opener: string | undefined;
    let closer: string | undefined;
    let displayMode = false;
    if (text.startsWith('\\[', index)) {
      opener = '\\[';
      closer = '\\]';
      displayMode = true;
    } else if (text.startsWith('\\(', index)) {
      opener = '\\(';
      closer = '\\)';
    } else if (text.startsWith('$$', index) && !isEscaped(text, index)) {
      opener = '$$';
      closer = '$$';
      displayMode = true;
    } else if (text[index] === '$' && !isEscaped(text, index)) {
      opener = '$';
      closer = '$';
    }
    if (!opener || !closer) {
      index += 1;
      continue;
    }
    const end = closingDelimiter(text, index + opener.length, closer);
    const tex = end === undefined ? '' : text.slice(index + opener.length, end).trim();
    if (end === undefined || !tex) {
      index += opener.length;
      continue;
    }
    if (index > textStart) segments.push({ kind: 'text', text: text.slice(textStart, index) });
    segments.push({
      kind: 'math',
      tex,
      raw: text.slice(index, end + closer.length),
      displayMode,
    });
    index = end + closer.length;
    textStart = index;
  }
  if (textStart < text.length) segments.push({ kind: 'text', text: text.slice(textStart) });
  if (!segments.length && text) segments.push({ kind: 'text', text });
  return segments;
}

export function containsRenderableLatex(text: string): boolean {
  return splitLatexDisplaySegments(text).some((segment) => segment.kind === 'math');
}
