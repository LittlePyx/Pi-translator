export interface PdfSelectionTextItem {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PdfTextSelectionRange {
  startIndex: number;
  startOffset: number;
  endIndex: number;
  endOffset: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfTextSelectionSnap {
  startIndex: number;
  startOffset: number;
  endIndex: number;
  endOffset: number;
  mode: 'word' | 'sentence' | 'paragraph';
}

interface JoinedItem {
  itemIndex: number;
  start: number;
  end: number;
}

interface TextSpan {
  start: number;
  end: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wordBoundary(text: string, offset: number, edge: 'start' | 'end'): number {
  const safeOffset = clamp(offset, 0, text.length);
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      const start = segment.index;
      const end = start + segment.segment.length;
      const contains = edge === 'start'
        ? start <= safeOffset && safeOffset < end
        : start < safeOffset && safeOffset <= end;
      if (contains) return edge === 'start' ? start : end;
    }
    return safeOffset;
  }
  const wordCharacter = /[\p{L}\p{N}\p{M}_]/u;
  let boundary = safeOffset;
  if (edge === 'start') {
    while (boundary > 0 && wordCharacter.test(text[boundary - 1] ?? '')) boundary -= 1;
  } else {
    while (boundary < text.length && wordCharacter.test(text[boundary] ?? '')) boundary += 1;
  }
  return boundary;
}

function trimSpan(text: string, start: number, end: number): TextSpan | undefined {
  while (start < end && /\s/u.test(text[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(text[end - 1] ?? '')) end -= 1;
  return end > start ? { start, end } : undefined;
}

function paragraphSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\u2029') continue;
    const span = trimSpan(text, start, index);
    if (span) spans.push(span);
    start = index + 1;
  }
  return spans;
}

function sentenceSpans(text: string, paragraphs: TextSpan[]): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const paragraph of paragraphs) {
    const raw = text.slice(paragraph.start, paragraph.end);
    // Visual line wraps are soft geometry. Replacing them one-for-one keeps
    // offsets stable while preventing Intl.Segmenter from treating them as
    // forced sentence endings.
    const linguisticText = raw.replace(/[\r\n\u2028\u2029]/gu, ' ');
    if (typeof Intl.Segmenter === 'function') {
      for (const segment of new Intl.Segmenter(undefined, { granularity: 'sentence' })
        .segment(linguisticText)) {
        const span = trimSpan(
          text,
          paragraph.start + segment.index,
          paragraph.start + segment.index + segment.segment.length,
        );
        if (span) spans.push(span);
      }
      continue;
    }
    const matches = linguisticText.matchAll(/[^.!?。！？]+(?:[.!?。！？]+(?=\s|$)|$)/gu);
    for (const match of matches) {
      const span = trimSpan(
        text,
        paragraph.start + (match.index ?? 0),
        paragraph.start + (match.index ?? 0) + match[0].length,
      );
      if (span) spans.push(span);
    }
  }
  return spans;
}

function spanIndexAt(
  spans: TextSpan[],
  position: number,
  edge: 'start' | 'end',
): number {
  const containing = spans.findIndex((span) => span.start <= position && position < span.end);
  if (containing >= 0) return containing;
  if (edge === 'start') {
    const following = spans.findIndex((span) => span.start > position);
    return following >= 0 ? following : spans.length - 1;
  }
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    if (spans[index]!.end <= position + 1) return index;
  }
  return 0;
}

function adaptiveSelectionBounds(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; mode: 'sentence' | 'paragraph' } | undefined {
  const paragraphs = paragraphSpans(text);
  if (!paragraphs.length) return undefined;
  const rawLength = Math.max(1, end - start);
  const edgeBudget = Math.min(72, Math.max(18, rawLength * 0.18));
  const totalExpansionBudget = Math.min(180, Math.max(64, rawLength * 0.45));
  const selectedTail = text.slice(Math.max(start, end - 20), end).trimEnd();
  const explicitlyEndedAtSentence = /[.!?。！？][\])}"'’”]*$/u.test(selectedTail);
  const startParagraphIndex = spanIndexAt(paragraphs, start, 'start');
  const startParagraph = paragraphs[startParagraphIndex];
  if (paragraphs.length > 1 && startParagraph) {
    const paragraphLength = startParagraph.end - startParagraph.start;
    const edgeTolerance = Math.min(48, Math.max(14, rawLength * 0.12));
    const nearStart = start - startParagraph.start <= edgeTolerance;
    const insideEndDistance = startParagraph.end - Math.min(end, startParagraph.end);
    const overflow = Math.max(0, end - startParagraph.end);
    const coverage = (
      Math.min(end, startParagraph.end) - Math.max(start, startParagraph.start)
    ) / Math.max(1, paragraphLength);
    const nearlyInsideParagraph = (
      end <= startParagraph.end &&
      insideEndDistance <= edgeTolerance &&
      coverage >= 0.82
    );
    const barelyCrossedParagraph = (
      end > startParagraph.end &&
      overflow <= Math.min(18, Math.max(6, rawLength * 0.06))
    );
    const paragraphExpansion = Math.max(0, start - startParagraph.start) +
      Math.max(0, startParagraph.end - end);
    const respectsSelection = (
      paragraphLength <= rawLength + totalExpansionBudget &&
      paragraphLength <= rawLength * 1.28 &&
      paragraphExpansion <= totalExpansionBudget
    );
    if (nearStart && respectsSelection && (nearlyInsideParagraph || barelyCrossedParagraph)) {
      return { ...startParagraph, mode: 'paragraph' };
    }
  }

  const sentences = sentenceSpans(text, paragraphs);
  if (!sentences.length) return undefined;
  const firstIndex = spanIndexAt(sentences, start, 'start');
  let lastIndex = spanIndexAt(sentences, Math.max(start, end - 1), 'end');
  if (firstIndex < 0 || lastIndex < firstIndex) return undefined;
  let snappedEnd = end;
  if (explicitlyEndedAtSentence) {
    snappedEnd = end;
  } else if (lastIndex > firstIndex) {
    const last = sentences[lastIndex]!;
    const entered = Math.max(0, Math.min(end, last.end) - last.start);
    const sentenceLength = Math.max(1, last.end - last.start);
    // A small excursion into the next sentence is treated as pointer imprecision.
    // Once the drag clearly enters it, include that complete sentence.
    const inclusionThreshold = Math.min(24, Math.max(8, sentenceLength * 0.24));
    if (entered < inclusionThreshold) {
      lastIndex -= 1;
      snappedEnd = sentences[lastIndex]!.end;
    } else {
      const remaining = Math.max(0, last.end - end);
      const forwardBudget = Math.min(120, Math.max(48, rawLength * 0.36));
      snappedEnd = remaining <= forwardBudget ? last.end : end;
    }
  } else {
    const sentence = sentences[firstIndex]!;
    const remaining = Math.max(0, sentence.end - end);
    const forwardBudget = Math.min(120, Math.max(48, rawLength * 0.36));
    snappedEnd = remaining <= forwardBudget ? sentence.end : end;
  }
  const first = sentences[firstIndex];
  if (!first) return undefined;
  const snappedStart = start - first.start <= edgeBudget ? first.start : start;
  const snappedLength = snappedEnd - snappedStart;
  if (
    snappedEnd <= snappedStart ||
    snappedLength > rawLength + totalExpansionBudget ||
    snappedLength > rawLength * 1.85
  ) {
    return { start, end, mode: 'sentence' };
  }
  return { start: snappedStart, end: snappedEnd, mode: 'sentence' };
}

function columnForItem(
  item: PdfSelectionTextItem,
  pageWidth: number,
): 'left' | 'right' | undefined {
  const center = (item.left + item.right) / 2;
  if (center < pageWidth * 0.46 && item.right < pageWidth * 0.62) return 'left';
  if (center > pageWidth * 0.54 && item.left > pageWidth * 0.38) return 'right';
  return undefined;
}

function detectedTwoColumnLayout(
  items: PdfSelectionTextItem[],
  pageWidth: number,
  pageHeight: number,
): boolean {
  let left = 0;
  let right = 0;
  for (const item of items) {
    if (item.top < pageHeight * 0.05 || item.bottom > pageHeight * 0.95) continue;
    if (item.right - item.left > pageWidth * 0.7) continue;
    const column = columnForItem(item, pageWidth);
    if (column === 'left') left += 1;
    else if (column === 'right') right += 1;
  }
  return left >= 3 && right >= 3;
}

function selectedText(
  items: PdfSelectionTextItem[],
  range: Pick<PdfTextSelectionRange, 'startIndex' | 'startOffset' | 'endIndex' | 'endOffset'>,
): string {
  return items
    .slice(range.startIndex, range.endIndex + 1)
    .map((item, offset) => {
      const index = range.startIndex + offset;
      const start = index === range.startIndex ? range.startOffset : 0;
      const end = index === range.endIndex ? range.endOffset : item.text.length;
      return item.text.slice(start, end);
    })
    .join(' ');
}

export function resolvePdfTextSelectionSnap(
  items: PdfSelectionTextItem[],
  input: PdfTextSelectionRange,
): PdfTextSelectionSnap | undefined {
  if (!items.length || input.startIndex < 0 || input.endIndex >= items.length) return undefined;
  let startIndex = Math.min(input.startIndex, input.endIndex);
  let endIndex = Math.max(input.startIndex, input.endIndex);
  let startOffset = input.startIndex <= input.endIndex ? input.startOffset : input.endOffset;
  let endOffset = input.startIndex <= input.endIndex ? input.endOffset : input.startOffset;

  const startItem = items[startIndex];
  const endItem = items[endIndex];
  if (!startItem || !endItem) return undefined;
  startOffset = wordBoundary(startItem.text, startOffset, 'start');
  endOffset = wordBoundary(endItem.text, endOffset, 'end');

  const twoColumns = detectedTwoColumnLayout(items, input.pageWidth, input.pageHeight);
  const startColumn = twoColumns ? columnForItem(startItem, input.pageWidth) : undefined;
  const startInMargin = (
    startItem.top < input.pageHeight * 0.05 ||
    startItem.bottom > input.pageHeight * 0.95
  );
  const allowed = (item: PdfSelectionTextItem): boolean => {
    if (!startInMargin && (
      item.top < input.pageHeight * 0.05 ||
      item.bottom > input.pageHeight * 0.95
    )) return false;
    return !startColumn || columnForItem(item, input.pageWidth) === startColumn;
  };

  if (startColumn) {
    const selectedAllowed = items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index >= startIndex && index <= endIndex && allowed(item));
    if (selectedAllowed.length) {
      startIndex = selectedAllowed[0]!.index;
      endIndex = selectedAllowed.at(-1)!.index;
      if (startIndex !== input.startIndex) startOffset = 0;
      if (endIndex !== input.endIndex) endOffset = items[endIndex]!.text.length;
    }
  }

  const rawText = selectedText(items, { startIndex, startOffset, endIndex, endOffset }).trim();
  const wordCount = rawText.split(/\s+/u).filter(Boolean).length;
  const shouldUseSentence = startIndex !== endIndex || (rawText.length >= 18 && wordCount >= 3);
  if (!shouldUseSentence) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word' };
  }

  const candidates = items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => allowed(item));
  const joined: JoinedItem[] = [];
  let text = '';
  const contentLeft = Math.min(...candidates.map(({ item }) => item.left));
  const contentRight = Math.max(...candidates.map(({ item }) => item.right));
  const contentWidth = Math.max(1, contentRight - contentLeft);
  for (const candidate of candidates) {
    const previous = joined.at(-1);
    if (previous) {
      const previousItem = items[previous.itemIndex]!;
      const lineHeight = Math.max(1, previousItem.bottom - previousItem.top);
      const verticalDelta = Math.abs(previousItem.top - candidate.item.top);
      const lineBreak = verticalDelta > Math.max(3, lineHeight * 0.55);
      const largeParagraphGap = verticalDelta > Math.max(lineHeight * 1.55, lineHeight + 7);
      const previousLineIsShort = previousItem.right < contentRight - contentWidth * 0.16;
      const nextLineIsIndented = candidate.item.left > contentLeft + contentWidth * 0.04;
      const previousEndsSentence = /[.!?。！？][\])}"'’”]*\s*$/u.test(previousItem.text);
      const paragraphBreak = lineBreak && (
        largeParagraphGap ||
        (previousEndsSentence && (previousLineIsShort || nextLineIsIndented))
      );
      text += paragraphBreak ? '\u2029' : lineBreak ? '\n' : ' ';
    }
    const start = text.length;
    text += candidate.item.text;
    joined.push({ itemIndex: candidate.itemIndex, start, end: text.length });
  }
  const joinedStart = joined.find((entry) => entry.itemIndex === startIndex);
  const joinedEnd = joined.find((entry) => entry.itemIndex === endIndex);
  if (!joinedStart || !joinedEnd) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word' };
  }
  const globalStart = joinedStart.start + startOffset;
  const globalEnd = joinedEnd.start + endOffset;
  const bounds = adaptiveSelectionBounds(text, globalStart, globalEnd);
  if (!bounds) return { startIndex, startOffset, endIndex, endOffset, mode: 'word' };
  let sentenceStart = bounds.start;
  let sentenceEnd = bounds.end;
  while (sentenceStart < sentenceEnd && /\s/u.test(text[sentenceStart] ?? '')) sentenceStart += 1;
  while (sentenceEnd > sentenceStart && /\s/u.test(text[sentenceEnd - 1] ?? '')) sentenceEnd -= 1;
  if (sentenceEnd - sentenceStart > 800) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word' };
  }
  const startEntry = [...joined].reverse().find((entry) => entry.start <= sentenceStart) ?? joined[0];
  const endEntry = joined.find((entry) => entry.end >= sentenceEnd) ?? joined.at(-1);
  if (!startEntry || !endEntry) return undefined;
  return {
    startIndex: startEntry.itemIndex,
    startOffset: clamp(sentenceStart - startEntry.start, 0, items[startEntry.itemIndex]!.text.length),
    endIndex: endEntry.itemIndex,
    endOffset: clamp(sentenceEnd - endEntry.start, 0, items[endEntry.itemIndex]!.text.length),
    mode: bounds.mode,
  };
}
