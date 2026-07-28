export const DEFAULT_TRANSLATION_CHUNK_SIZE = 6_000;

function preferredBoundary(text: string, start: number, maximumEnd: number): number {
  const minimumEnd = start + Math.floor((maximumEnd - start) * 0.55);
  const window = text.slice(minimumEnd, maximumEnd);
  const candidates = [
    /\n\n/g,
    /[。！？!?]\s*/g,
    /\n/g,
    /\s+/g,
  ];
  for (const pattern of candidates) {
    let match: RegExpExecArray | null;
    let lastEnd = -1;
    while ((match = pattern.exec(window))) lastEnd = match.index + match[0].length;
    if (lastEnd > 0) return minimumEnd + lastEnd;
  }
  return maximumEnd;
}

export function splitLongTranslationText(
  value: string,
  maximumLength = DEFAULT_TRANSLATION_CHUNK_SIZE,
): string[] {
  const text = value.trim();
  if (!text) return [];
  if (maximumLength < 200) throw new Error('Translation chunk size is too small.');
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const maximumEnd = Math.min(text.length, start + maximumLength);
    const end = maximumEnd === text.length
      ? maximumEnd
      : preferredBoundary(text, start, maximumEnd);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}
