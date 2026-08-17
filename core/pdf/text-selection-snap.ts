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
  gestureStartX?: number;
  gestureStartY?: number;
  gestureEndX?: number;
  gestureEndY?: number;
  allowExplicitCrossColumn?: boolean;
}

export interface PdfTextSelectionSnap {
  startIndex: number;
  startOffset: number;
  endIndex: number;
  endOffset: number;
  mode: 'word' | 'sentence' | 'paragraph';
  startColumn?: PdfColumn;
  crossColumn?: 'constrained' | 'explicit';
  retainedSpanningContent?: boolean;
}

export type PdfColumn = 'left' | 'right';
type PdfLayoutRole = PdfColumn | 'spanning' | 'other';

export interface PdfTwoColumnLayout {
  gutterLeft: number;
  gutterRight: number;
  leftItemCount: number;
  rightItemCount: number;
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

function quantile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function layoutRoleForItem(
  item: PdfSelectionTextItem,
  layout: PdfTwoColumnLayout,
): PdfLayoutRole {
  const middle = (layout.gutterLeft + layout.gutterRight) / 2;
  const center = (item.left + item.right) / 2;
  if (
    (item.left < layout.gutterLeft && item.right > layout.gutterRight) ||
    (center >= layout.gutterLeft && center <= layout.gutterRight)
  ) return 'spanning';
  if (center < middle && item.left < layout.gutterLeft) return 'left';
  if (center > middle && item.right > layout.gutterRight) return 'right';
  return 'other';
}

function columnForItem(
  item: PdfSelectionTextItem,
  layout: PdfTwoColumnLayout,
): PdfColumn | undefined {
  const role = layoutRoleForItem(item, layout);
  return role === 'left' || role === 'right' ? role : undefined;
}

function columnAtX(x: number | undefined, layout: PdfTwoColumnLayout): PdfColumn | undefined {
  if (x === undefined || !Number.isFinite(x)) return undefined;
  if (x < layout.gutterLeft) return 'left';
  if (x > layout.gutterRight) return 'right';
  return undefined;
}

function gestureVerticallyIncludes(
  item: PdfSelectionTextItem,
  input: PdfTextSelectionRange,
): boolean {
  if (
    input.gestureStartY === undefined ||
    !Number.isFinite(input.gestureStartY) ||
    input.gestureEndY === undefined ||
    !Number.isFinite(input.gestureEndY)
  ) return true;
  const itemHeight = Math.max(1, item.bottom - item.top);
  const tolerance = Math.max(4, itemHeight * 0.65);
  const gestureTop = Math.min(input.gestureStartY, input.gestureEndY) - tolerance;
  const gestureBottom = Math.max(input.gestureStartY, input.gestureEndY) + tolerance;
  return item.bottom >= gestureTop && item.top <= gestureBottom;
}

export function detectPdfTwoColumnLayout(
  items: PdfSelectionTextItem[],
  pageWidth: number,
  pageHeight: number,
): PdfTwoColumnLayout | undefined {
  if (pageWidth <= 0 || pageHeight <= 0) return undefined;
  const bodyItems = items.filter((item) => (
    item.top >= pageHeight * 0.05 &&
    item.bottom <= pageHeight * 0.95 &&
    item.right > item.left &&
    item.bottom > item.top &&
    item.right - item.left <= pageWidth * 0.7
  ));
  const leftItems = bodyItems.filter((item) => (
    (item.left + item.right) / 2 < pageWidth * 0.49 && item.left < pageWidth * 0.42
  ));
  const rightItems = bodyItems.filter((item) => (
    (item.left + item.right) / 2 > pageWidth * 0.51 && item.right > pageWidth * 0.58
  ));
  if (leftItems.length < 3 || rightItems.length < 3) return undefined;
  const gutterLeft = quantile(leftItems.map((item) => item.right), 0.8);
  const gutterRight = quantile(rightItems.map((item) => item.left), 0.2);
  const gutterWidth = gutterRight - gutterLeft;
  const gutterMiddle = (gutterLeft + gutterRight) / 2;
  if (
    gutterWidth < Math.max(12, pageWidth * 0.025) ||
    gutterMiddle < pageWidth * 0.35 ||
    gutterMiddle > pageWidth * 0.65
  ) return undefined;
  return {
    gutterLeft,
    gutterRight,
    leftItemCount: leftItems.length,
    rightItemCount: rightItems.length,
  };
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
  const rawStartIndex = startIndex;
  const rawEndIndex = endIndex;
  let startOffset = input.startIndex <= input.endIndex ? input.startOffset : input.endOffset;
  let endOffset = input.startIndex <= input.endIndex ? input.endOffset : input.startOffset;

  const startItem = items[startIndex];
  const endItem = items[endIndex];
  if (!startItem || !endItem) return undefined;
  startOffset = wordBoundary(startItem.text, startOffset, 'start');
  endOffset = wordBoundary(endItem.text, endOffset, 'end');

  const columnLayout = detectPdfTwoColumnLayout(items, input.pageWidth, input.pageHeight);
  const layoutRoles = columnLayout
    ? items.map((item) => layoutRoleForItem(item, columnLayout))
    : [];
  const startColumn = columnLayout
    ? columnAtX(input.gestureStartX, columnLayout) ?? columnForItem(startItem, columnLayout)
    : undefined;
  const rawSelectedColumns = columnLayout
    ? new Set(layoutRoles.slice(startIndex, endIndex + 1)
        .map((role) => role === 'left' || role === 'right' ? role : undefined)
        .filter((column): column is PdfColumn => Boolean(column)))
    : new Set<PdfColumn>();
  const endsInOppositeColumn = Boolean(
    columnLayout &&
    startColumn &&
    columnAtX(input.gestureEndX, columnLayout) &&
    columnAtX(input.gestureEndX, columnLayout) !== startColumn,
  );
  const rawCrossesColumns = rawSelectedColumns.size > 1;
  const crossColumn = rawCrossesColumns
    ? endsInOppositeColumn && input.allowExplicitCrossColumn !== false
      ? 'explicit' as const
      : 'constrained' as const
    : undefined;
  const startInMargin = (
    startItem.top < input.pageHeight * 0.05 ||
    startItem.bottom > input.pageHeight * 0.95
  );
  const allowed = (item: PdfSelectionTextItem, index: number): boolean => {
    if (!startInMargin && (
      item.top < input.pageHeight * 0.05 ||
      item.bottom > input.pageHeight * 0.95
    )) return false;
    if (!startColumn || !columnLayout) return true;
    const role = layoutRoles[index];
    if (role === startColumn) return true;
    return (
      role === 'spanning' &&
      index >= rawStartIndex &&
      index <= rawEndIndex &&
      gestureVerticallyIncludes(item, input)
    );
  };

  if (startColumn && crossColumn !== 'explicit') {
    const selectedAllowed = items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => index >= startIndex && index <= endIndex && allowed(item, index));
    if (selectedAllowed.length) {
      const runs: typeof selectedAllowed[] = [];
      for (const entry of selectedAllowed) {
        const current = runs.at(-1);
        if (!current?.length || entry.index !== current.at(-1)!.index + 1) runs.push([entry]);
        else current.push(entry);
      }
      const selectedRun = runs.sort((left, right) => {
        const columnCount = (run: typeof selectedAllowed) => run.filter(
          ({ index }) => layoutRoles[index] === startColumn,
        ).length;
        const countDifference = columnCount(right) - columnCount(left);
        if (countDifference) return countDifference;
        const distanceFromGesture = (run: typeof selectedAllowed) => {
          if (input.gestureStartY === undefined) return 0;
          return Math.min(...run.map(({ item }) => Math.abs(
            (item.top + item.bottom) / 2 - input.gestureStartY!,
          )));
        };
        return distanceFromGesture(left) - distanceFromGesture(right);
      })[0];
      if (selectedRun?.length) {
        startIndex = selectedRun[0]!.index;
        endIndex = selectedRun.at(-1)!.index;
        if (startIndex !== rawStartIndex) startOffset = 0;
        if (endIndex !== rawEndIndex) endOffset = items[endIndex]!.text.length;
      }
    }
  }

  const retainedSpanningContent = Boolean(
    columnLayout &&
    layoutRoles.slice(startIndex, endIndex + 1).some((role, offset) => (
      role === 'spanning' && gestureVerticallyIncludes(items[startIndex + offset]!, input)
    )),
  );

  const columnMetadata = {
    ...(startColumn ? { startColumn } : {}),
    ...(crossColumn ? { crossColumn } : {}),
    ...(retainedSpanningContent ? { retainedSpanningContent: true } : {}),
  };

  const rawText = selectedText(items, { startIndex, startOffset, endIndex, endOffset }).trim();
  if (crossColumn === 'explicit' || retainedSpanningContent) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word', ...columnMetadata };
  }
  const wordCount = rawText.split(/\s+/u).filter(Boolean).length;
  const shouldUseSentence = startIndex !== endIndex || (rawText.length >= 18 && wordCount >= 3);
  if (!shouldUseSentence) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word', ...columnMetadata };
  }

  const candidates = items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item, itemIndex }) => (
      allowed(item, itemIndex) &&
      (
        layoutRoles[itemIndex] !== 'spanning' ||
        (itemIndex >= startIndex && itemIndex <= endIndex)
      )
    ));
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
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word', ...columnMetadata };
  }
  const globalStart = joinedStart.start + startOffset;
  const globalEnd = joinedEnd.start + endOffset;
  const bounds = adaptiveSelectionBounds(text, globalStart, globalEnd);
  if (!bounds) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word', ...columnMetadata };
  }
  let sentenceStart = bounds.start;
  let sentenceEnd = bounds.end;
  while (sentenceStart < sentenceEnd && /\s/u.test(text[sentenceStart] ?? '')) sentenceStart += 1;
  while (sentenceEnd > sentenceStart && /\s/u.test(text[sentenceEnd - 1] ?? '')) sentenceEnd -= 1;
  if (sentenceEnd - sentenceStart > 800) {
    return { startIndex, startOffset, endIndex, endOffset, mode: 'word', ...columnMetadata };
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
    ...columnMetadata,
  };
}
