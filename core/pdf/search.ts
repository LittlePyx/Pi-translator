export interface PdfSearchTextItem {
  str: string;
  hasEOL?: boolean;
  topRatio?: number;
}

interface PdfSearchItemRange {
  itemIndex: number;
  start: number;
  end: number;
  displayStart: number;
  displayEnd: number;
  topRatio?: number;
}

export interface PdfSearchPageIndex {
  pageNumber: number;
  text: string;
  displayText: string;
  itemRanges: PdfSearchItemRange[];
}

export interface PdfSearchMatch {
  pageNumber: number;
  start: number;
  end: number;
  itemIndexes: number[];
  itemParts: Array<{
    itemIndex: number;
    startOffset: number;
    endOffset: number;
  }>;
  topRatio: number;
}

export interface PdfSearchSnippet {
  before: string;
  match: string;
  after: string;
}

const CJK_BOUNDARY = /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const WORD_BOUNDARY = /[\p{L}\p{N}]$/u;
const WORD_START = /^[\p{L}\p{N}]/u;
const LATIN_PUNCTUATION_BOUNDARY = /[.!?,:;]$/u;

export function normalizePdfSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizePdfSearchDisplayText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function itemSeparator(
  previous: PdfSearchTextItem | undefined,
  previousText: string,
  nextText: string,
): string {
  if (!previous || !previousText || !nextText) return '';
  if (/\s$/u.test(previous.str) || /^\s/u.test(nextText)) return '';
  if (previous.hasEOL) return ' ';
  const previousBoundary = previousText.at(-1) ?? '';
  const nextBoundary = nextText[0] ?? '';
  if (CJK_BOUNDARY.test(previousBoundary) || CJK_BOUNDARY.test(nextBoundary)) return '';
  return (
    (WORD_BOUNDARY.test(previousBoundary) || LATIN_PUNCTUATION_BOUNDARY.test(previousBoundary)) &&
    WORD_START.test(nextBoundary)
  ) ? ' ' : '';
}

export function buildPdfSearchPageIndex(
  pageNumber: number,
  items: readonly PdfSearchTextItem[],
): PdfSearchPageIndex {
  let text = '';
  let displayText = '';
  let previous: PdfSearchTextItem | undefined;
  let previousText = '';
  const itemRanges: PdfSearchItemRange[] = [];
  items.forEach((item, itemIndex) => {
    const normalized = normalizePdfSearchText(item.str);
    const display = normalizePdfSearchDisplayText(item.str);
    if (!normalized) {
      previous = item;
      previousText = '';
      return;
    }
    const separator = itemSeparator(previous, previousText, normalized);
    text += separator;
    displayText += separator;
    const start = text.length;
    const displayStart = displayText.length;
    text += normalized;
    displayText += display;
    itemRanges.push({
      itemIndex,
      start,
      end: text.length,
      displayStart,
      displayEnd: displayText.length,
      ...(typeof item.topRatio === 'number' && Number.isFinite(item.topRatio)
        ? { topRatio: Math.min(1, Math.max(0, item.topRatio)) }
        : {}),
    });
    previous = item;
    previousText = normalized;
  });
  return {
    pageNumber: Math.max(1, Math.round(pageNumber)),
    text,
    displayText,
    itemRanges,
  };
}

function displayOffsetForNormalizedOffset(value: string, normalizedOffset: number): number {
  if (normalizedOffset <= 0) return 0;
  for (let offset = 1; offset <= value.length; offset += 1) {
    const normalizedPrefixLength = value
      .slice(0, offset)
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .length;
    if (normalizedPrefixLength >= normalizedOffset) {
      return offset;
    }
  }
  return value.length;
}

export function buildPdfSearchSnippet(
  page: PdfSearchPageIndex,
  match: PdfSearchMatch,
  contextLength = 52,
): PdfSearchSnippet {
  const firstPart = match.itemParts[0];
  const lastPart = match.itemParts.at(-1);
  const firstRange = firstPart
    ? page.itemRanges.find((range) => range.itemIndex === firstPart.itemIndex)
    : undefined;
  const lastRange = lastPart
    ? page.itemRanges.find((range) => range.itemIndex === lastPart.itemIndex)
    : undefined;
  if (!firstPart || !lastPart || !firstRange || !lastRange) {
    return { before: '', match: page.text.slice(match.start, match.end), after: '' };
  }
  const displayStart = firstRange.displayStart + displayOffsetForNormalizedOffset(
    page.displayText.slice(firstRange.displayStart, firstRange.displayEnd),
    firstPart.startOffset,
  );
  const displayEnd = lastRange.displayStart + displayOffsetForNormalizedOffset(
    page.displayText.slice(lastRange.displayStart, lastRange.displayEnd),
    lastPart.endOffset,
  );
  const safeContextLength = Math.max(8, Math.round(contextLength));
  const snippetStart = Math.max(0, displayStart - safeContextLength);
  const snippetEnd = Math.min(page.displayText.length, displayEnd + safeContextLength);
  return {
    before: `${snippetStart > 0 ? '…' : ''}${page.displayText.slice(snippetStart, displayStart)}`,
    match: page.displayText.slice(displayStart, displayEnd),
    after: `${page.displayText.slice(displayEnd, snippetEnd)}${snippetEnd < page.displayText.length ? '…' : ''}`,
  };
}

function matchesForPage(
  page: PdfSearchPageIndex,
  query: string,
  remaining: number,
): PdfSearchMatch[] {
  if (!query || !page.text || remaining <= 0) return [];
  const matches: PdfSearchMatch[] = [];
  let fromIndex = 0;
  while (matches.length < remaining) {
    const start = page.text.indexOf(query, fromIndex);
    if (start < 0) break;
    const end = start + query.length;
    const ranges = page.itemRanges.filter((range) => range.end > start && range.start < end);
    if (ranges.length) {
      matches.push({
        pageNumber: page.pageNumber,
        start,
        end,
        itemIndexes: ranges.map((range) => range.itemIndex),
        itemParts: ranges.map((range) => ({
          itemIndex: range.itemIndex,
          startOffset: Math.max(0, start - range.start),
          endOffset: Math.min(range.end, end) - range.start,
        })),
        topRatio: ranges.find((range) => range.topRatio !== undefined)?.topRatio ?? 0,
      });
    }
    fromIndex = Math.max(end, start + 1);
  }
  return matches;
}

export function findPdfSearchMatches(
  pages: Iterable<PdfSearchPageIndex>,
  rawQuery: string,
  limit = 5_000,
): PdfSearchMatch[] {
  const query = normalizePdfSearchText(rawQuery);
  if (!query || limit <= 0) return [];
  const matches: PdfSearchMatch[] = [];
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  for (const page of ordered) {
    matches.push(...matchesForPage(page, query, limit - matches.length));
    if (matches.length >= limit) break;
  }
  return matches;
}
