import type { ViewportRect } from '../selection/types';
import type { PdfSourceLocation, TranslateResult } from '../translation/types';
import { splitLightMarkup } from '../translation/light-markup';

export type TranslationMarkerAnchor =
  | {
      kind: 'dom-range';
      range: Range;
      sourceText: string;
      scope: Element;
      prefix: string;
      suffix: string;
    }
  | {
      kind: 'pdf-text-quote';
      pageNumber: number;
      sourceText: string;
      prefix: string;
      suffix: string;
    }
  | {
      kind: 'pdf-region';
      sourceLocation: PdfSourceLocation;
    };

export interface TranslationMarkerEntry {
  markerId: string;
  result: TranslateResult;
  anchor: TranslationMarkerAnchor;
  content: TranslationMarkerContent;
}

export type TranslationMarkerLocationState = 'ready' | 'pending' | 'missing';

export interface TranslationMarkerSummary extends TranslationMarkerContent {
  markerId: string;
  createdAt: number;
  locationState: TranslationMarkerLocationState;
}

type TranslationMarkerRecord = Omit<TranslationMarkerEntry, 'markerId'>;

interface VisibleMarkerRect {
  markerId: string;
  rect: ViewportRect;
}

export interface TranslationMarkerContent {
  originalText: string;
  translatedText: string;
  sourceTitle: string;
  sourceUrl?: string;
  pageNumber?: number;
}

export type PersistedPdfTranslationMarkerAnchor =
  | {
      kind: 'text-quote';
      pageNumber: number;
      sourceText: string;
      prefix: string;
      suffix: string;
    }
  | {
      kind: 'region';
      pageNumber: number;
      leftRatio: number;
      topRatio: number;
      widthRatio: number;
      heightRatio: number;
    };

export interface PersistedPdfTranslationMarker {
  markerId: string;
  anchor: PersistedPdfTranslationMarkerAnchor;
  content: TranslationMarkerContent;
  createdAt: number;
}

export interface SessionTranslationMarkerOptions {
  resolvePdfRegionRects?: (sourceLocation: PdfSourceLocation) => ViewportRect[];
  onActivate?: (result: TranslateResult, rect?: ViewportRect) => void;
  onChange?: (entries: TranslationMarkerEntry[]) => void;
  onLocationStateChange?: () => void;
  onTooltipUnmark?: (markerId: string) => void;
}

interface NormalizedMarkerText {
  text: string;
  rawStarts: number[];
  rawEnds: number[];
}

function isIgnoredMarkerCharacter(character: string): boolean {
  return /\s/u.test(character) || character === '\u00ad' || character === '\u200b' || character === '\ufeff';
}

function isLineWrapHyphen(value: string, offset: number, character: string): boolean {
  if (character !== '-' && character !== '\u2010') return false;
  return /^\s+[\p{L}\p{N}]/u.test(value.slice(offset + character.length));
}

function normalizedMarkerText(
  value: string,
  preserveLineWrapHyphens = false,
): NormalizedMarkerText {
  const characters: string[] = [];
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const rawEnd = offset + character.length;
    if (
      !isIgnoredMarkerCharacter(character) &&
      (preserveLineWrapHyphens || !isLineWrapHyphen(value, offset, character))
    ) {
      for (const normalized of character.normalize('NFKC')) {
        if (isIgnoredMarkerCharacter(normalized)) continue;
        characters.push(normalized);
        rawStarts.push(offset);
        rawEnds.push(rawEnd);
      }
    }
    offset = rawEnd;
  }
  return { text: characters.join(''), rawStarts, rawEnds };
}

function normalizeMarkerText(
  value: string,
  preserveLineWrapHyphens = false,
): string {
  return normalizedMarkerText(value, preserveLineWrapHyphens).text;
}

export function markerTextStillMatches(current: string, original: string): boolean {
  const currentNormalized = normalizeMarkerText(current);
  const originalNormalized = normalizeMarkerText(original);
  if (!currentNormalized) return false;
  if (currentNormalized === originalNormalized) return true;
  return (
    normalizeMarkerText(current, true) ===
    normalizeMarkerText(original, true)
  );
}

export function findUniqueTextQuoteOffset(
  text: string,
  exact: string,
  prefix: string,
  suffix: string,
): number | undefined {
  return findUniqueTextQuoteRange(text, exact, prefix, suffix)?.start;
}

export function findUniqueTextQuoteRange(
  text: string,
  exact: string,
  prefix: string,
  suffix: string,
): { start: number; end: number } | undefined {
  const normalizedText = normalizedMarkerText(text);
  const normalizedExact = normalizeMarkerText(exact);
  if (!normalizedExact) return undefined;
  const candidates: number[] = [];
  let offset = normalizedText.text.indexOf(normalizedExact);
  while (offset >= 0) {
    candidates.push(offset);
    offset = normalizedText.text.indexOf(normalizedExact, offset + 1);
  }
  if (!candidates.length) return undefined;
  const normalizedPrefix = normalizeMarkerText(prefix);
  const normalizedSuffix = normalizeMarkerText(suffix);
  const contextMatches = candidates.filter((candidate) => {
    const prefixMatches = !normalizedPrefix || normalizedText.text.slice(
      Math.max(0, candidate - normalizedPrefix.length),
      candidate,
    ) === normalizedPrefix;
    const quoteEnd = candidate + normalizedExact.length;
    const suffixMatches = !normalizedSuffix || normalizedText.text.slice(
      quoteEnd,
      quoteEnd + normalizedSuffix.length,
    ) === normalizedSuffix;
    return prefixMatches && suffixMatches;
  });
  const match = contextMatches.length === 1
    ? contextMatches[0]
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (match === undefined) return undefined;
  const rawStart = normalizedText.rawStarts[match];
  const rawEnd = normalizedText.rawEnds[match + normalizedExact.length - 1];
  return rawStart === undefined || rawEnd === undefined
    ? undefined
    : { start: rawStart, end: rawEnd };
}

function rangeFromTextQuote(
  scope: Element,
  sourceText: string,
  prefix: string,
  suffix: string,
): Range | undefined {
  const text = scope.textContent ?? '';
  const quote = findUniqueTextQuoteRange(text, sourceText, prefix, suffix);
  if (!quote) return undefined;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startNode: Text | undefined;
  let startOffset = 0;
  let endNode: Text | undefined;
  let endOffset = 0;
  const quoteOffset = quote.start;
  const quoteEnd = quote.end;
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const nextPosition = position + textNode.data.length;
    if (!startNode && quoteOffset >= position && quoteOffset <= nextPosition) {
      startNode = textNode;
      startOffset = quoteOffset - position;
    }
    if (quoteEnd >= position && quoteEnd <= nextPosition) {
      endNode = textNode;
      endOffset = quoteEnd - position;
      break;
    }
    position = nextPosition;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return undefined;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return markerTextStillMatches(range.toString(), sourceText) ? range : undefined;
}

function pdfPageForRange(range: Range): HTMLElement | undefined {
  const commonElement = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  return commonElement?.closest<HTMLElement>('.pdf-page') ?? undefined;
}

export function persistablePdfMarkerAnchor(
  anchor: TranslationMarkerAnchor,
): PersistedPdfTranslationMarkerAnchor | undefined {
  if (anchor.kind === 'pdf-region') {
    const { sourceLocation } = anchor;
    return {
      kind: 'region',
      pageNumber: sourceLocation.pageNumber,
      leftRatio: sourceLocation.leftRatio,
      topRatio: sourceLocation.topRatio,
      widthRatio: sourceLocation.widthRatio,
      heightRatio: sourceLocation.heightRatio,
    };
  }
  if (anchor.kind === 'pdf-text-quote') {
    return {
      kind: 'text-quote',
      pageNumber: anchor.pageNumber,
      sourceText: anchor.sourceText,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
    };
  }
  const page = pdfPageForRange(anchor.range);
  const pageNumber = Number(page?.dataset.pageNumber);
  if (!page || !Number.isInteger(pageNumber) || pageNumber < 1) return undefined;
  const before = document.createRange();
  before.selectNodeContents(page);
  try {
    before.setEnd(anchor.range.startContainer, anchor.range.startOffset);
  } catch {
    return undefined;
  }
  const sourceText = anchor.range.toString();
  if (!markerTextStillMatches(sourceText, anchor.sourceText)) return undefined;
  const pageText = page.textContent ?? '';
  const startOffset = before.toString().length;
  return {
    kind: 'text-quote',
    pageNumber,
    sourceText,
    prefix: pageText.slice(Math.max(0, startOffset - 48), startOffset),
    suffix: pageText.slice(startOffset + sourceText.length, startOffset + sourceText.length + 48),
  };
}

export function persistedPdfMarkerKey(
  anchor: PersistedPdfTranslationMarkerAnchor,
  content: TranslationMarkerContent,
): string {
  const location = anchor.kind === 'text-quote'
    ? [anchor.kind, anchor.pageNumber, anchor.sourceText, anchor.prefix, anchor.suffix]
    : [
        anchor.kind,
        anchor.pageNumber,
        anchor.leftRatio.toFixed(5),
        anchor.topRatio.toFixed(5),
        anchor.widthRatio.toFixed(5),
        anchor.heightRatio.toFixed(5),
      ];
  return JSON.stringify([
    ...location,
    normalizeMarkerText(content.originalText),
  ]);
}

export function persistPdfTranslationMarker(
  entry: TranslationMarkerEntry,
): PersistedPdfTranslationMarker | undefined {
  const anchor = persistablePdfMarkerAnchor(entry.anchor);
  if (!anchor) return undefined;
  return {
    markerId: entry.markerId,
    anchor,
    content: { ...entry.content },
    createdAt: entry.result.completedAt ?? Date.now(),
  };
}

export function restorePersistedPdfTranslationMarker(
  marker: PersistedPdfTranslationMarker,
  documentId: string,
): TranslationMarkerEntry {
  const segmentSeparator = marker.markerId.indexOf('::segment:');
  const restoredRequestId = segmentSeparator >= 0
    ? marker.markerId.slice(0, segmentSeparator)
    : marker.markerId.endsWith('::full')
      ? marker.markerId.slice(0, -'::full'.length)
      : marker.markerId;
  const sourceLocation: PdfSourceLocation | undefined = marker.anchor.kind === 'region'
    ? {
        documentId,
        pageNumber: marker.anchor.pageNumber,
        leftRatio: marker.anchor.leftRatio,
        topRatio: marker.anchor.topRatio,
        widthRatio: marker.anchor.widthRatio,
        heightRatio: marker.anchor.heightRatio,
      }
    : undefined;
  const anchor: TranslationMarkerAnchor = marker.anchor.kind === 'region'
    ? { kind: 'pdf-region', sourceLocation: sourceLocation! }
    : {
        kind: 'pdf-text-quote',
        pageNumber: marker.anchor.pageNumber,
        sourceText: marker.anchor.sourceText,
        prefix: marker.anchor.prefix,
        suffix: marker.anchor.suffix,
      };
  return {
    markerId: marker.markerId,
    anchor,
    content: { ...marker.content },
    result: {
      requestId: restoredRequestId,
      originalText: marker.content.originalText,
      translatedText: marker.content.translatedText,
      warnings: [],
      sourceHost: marker.content.sourceTitle,
      completedAt: marker.createdAt,
      ...(sourceLocation ? { sourceLocation } : {}),
    },
  };
}

export function findUniqueNormalizedSegmentRange(
  rawText: string,
  segmentText: string,
): { start: number; end: number } | undefined {
  return findUniqueTextQuoteRange(rawText, segmentText, '', '');
}

export function buildTranslationMarkerMarkdown(
  contents: TranslationMarkerContent[],
): string {
  if (!contents.length) return '';
  const sections = contents.map((content) => {
    const title = content.pageNumber
      ? `${content.sourceTitle} · 第 ${content.pageNumber} 页`
      : content.sourceTitle;
    const quote = content.originalText
      .trim()
      .split(/\r?\n/u)
      .map((line) => `> ${line}`)
      .join('\n');
    const source = content.sourceUrl && /^https?:/iu.test(content.sourceUrl)
      ? `\n\n[查看来源](${content.sourceUrl})`
      : '';
    return `## ${title}\n\n${quote}\n\n${content.translatedText.trim()}${source}`;
  });
  return `# Pi Translator 标记笔记\n\n${sections.join('\n\n---\n\n')}\n`;
}

function validRect(rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>): boolean {
  return (
    [rect.top, rect.right, rect.bottom, rect.left].every(Number.isFinite) &&
    rect.width > 0.5 &&
    rect.height > 0.5
  );
}

function toViewportRect(
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>,
): ViewportRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function markerRectsFromRange(range: Range): ViewportRect[] {
  const rects = [...range.getClientRects()]
    .filter(validRect)
    .map(toViewportRect);
  if (rects.length < 2) return mergeMarkerRects(rects);
  const heights = rects
    .map((rect) => rect.bottom - rect.top)
    .sort((left, right) => left - right);
  const referenceHeight = heights[Math.floor((heights.length - 1) / 2)] ?? 0;
  const lineRects = referenceHeight > 0
    ? rects.filter((rect) => rect.bottom - rect.top <= referenceHeight * 2.5)
    : rects;
  return mergeMarkerRects(lineRects.length ? lineRects : rects);
}

function rectHeight(rect: ViewportRect): number {
  return Math.max(0, rect.bottom - rect.top);
}

function sameVisualLine(left: ViewportRect, right: ViewportRect): boolean {
  const leftHeight = rectHeight(left);
  const rightHeight = rectHeight(right);
  if (!leftHeight || !rightHeight) return false;
  const heightRatio = Math.max(leftHeight, rightHeight) / Math.min(leftHeight, rightHeight);
  if (heightRatio > 1.65) return false;
  const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const centerDistance = Math.abs(
    (left.top + left.bottom) / 2 - (right.top + right.bottom) / 2,
  );
  return overlap / Math.min(leftHeight, rightHeight) >= 0.58 || centerDistance <= 2;
}

export function mergeMarkerRects(rects: ViewportRect[]): ViewportRect[] {
  const lines: ViewportRect[][] = [];
  const ordered = rects
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  for (const rect of ordered) {
    const line = lines.find((candidate) => candidate.some((item) => sameVisualLine(item, rect)));
    if (line) line.push(rect);
    else lines.push([rect]);
  }
  return lines.flatMap((line) => {
    const top = Math.min(...line.map((rect) => rect.top));
    const bottom = Math.max(...line.map((rect) => rect.bottom));
    const horizontal = line
      .map((rect) => ({ left: rect.left, right: rect.right }))
      .sort((left, right) => left.left - right.left);
    const merged: Array<{ left: number; right: number }> = [];
    for (const interval of horizontal) {
      const previous = merged.at(-1);
      if (previous && interval.left <= previous.right + 2) {
        previous.right = Math.max(previous.right, interval.right);
      } else {
        merged.push({ ...interval });
      }
    }
    return merged.map((interval) => ({
      top,
      right: interval.right,
      bottom,
      left: interval.left,
    }));
  });
}

function rectsOverlap(left: ViewportRect, right: ViewportRect): boolean {
  return (
    Math.min(left.right, right.right) > Math.max(left.left, right.left) &&
    Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top)
  );
}

function domAnchorFromRange(
  range: Range,
  preferredScope?: Element,
): TranslationMarkerAnchor | undefined {
  const commonElement = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const scope = preferredScope ?? commonElement?.closest(
    '[contenteditable="true"],.cm-content,.CodeMirror-code,[role="textbox"]',
  ) ?? document.body;
  if (!scope) return undefined;
  const before = document.createRange();
  before.selectNodeContents(scope);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return undefined;
  }
  const fullText = scope.textContent ?? '';
  const startOffset = before.toString().length;
  const selectedText = range.toString();
  return {
    kind: 'dom-range',
    range: range.cloneRange(),
    sourceText: selectedText,
    scope,
    prefix: fullText.slice(Math.max(0, startOffset - 32), startOffset),
    suffix: fullText.slice(startOffset + selectedText.length, startOffset + selectedText.length + 32),
  };
}

export function captureDomTranslationMarkerAnchor(
  sourceText: string,
): TranslationMarkerAnchor | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!markerTextStillMatches(range.toString(), sourceText)) return undefined;
  return domAnchorFromRange(range);
}

interface SelectedTextChunk {
  node: Text;
  nodeStart: number;
  nodeEnd: number;
  rawStart: number;
  rawEnd: number;
}

function selectedTextChunks(range: Range): SelectedTextChunk[] {
  const root = range.commonAncestorContainer instanceof Text
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: SelectedTextChunk[] = [];
  let rawOffset = 0;
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (range.intersectsNode(textNode)) {
      const nodeStart = textNode === range.startContainer ? range.startOffset : 0;
      const nodeEnd = textNode === range.endContainer ? range.endOffset : textNode.data.length;
      if (nodeEnd > nodeStart) {
        const length = nodeEnd - nodeStart;
        chunks.push({
          node: textNode,
          nodeStart,
          nodeEnd,
          rawStart: rawOffset,
          rawEnd: rawOffset + length,
        });
        rawOffset += length;
      }
    }
    node = walker.nextNode();
  }
  return chunks;
}

export function createSegmentTranslationMarkerAnchor(
  parent: TranslationMarkerAnchor,
  segmentText: string,
): TranslationMarkerAnchor | undefined {
  if (parent.kind !== 'dom-range') return undefined;
  const chunks = selectedTextChunks(parent.range);
  const rawText = chunks.map((chunk) => chunk.node.data.slice(chunk.nodeStart, chunk.nodeEnd)).join('');
  const segmentRange = findUniqueNormalizedSegmentRange(rawText, segmentText);
  if (!segmentRange) return undefined;
  const { start: rawStart, end: rawEnd } = segmentRange;
  const startChunk = chunks.find((chunk) => rawStart >= chunk.rawStart && rawStart < chunk.rawEnd);
  const endChunk = chunks.find((chunk) => rawEnd > chunk.rawStart && rawEnd <= chunk.rawEnd);
  if (!startChunk || !endChunk) return undefined;
  const range = document.createRange();
  range.setStart(startChunk.node, startChunk.nodeStart + rawStart - startChunk.rawStart);
  range.setEnd(endChunk.node, endChunk.nodeStart + rawEnd - endChunk.rawStart);
  return markerTextStillMatches(range.toString(), segmentText)
    ? domAnchorFromRange(range, parent.scope)
    : undefined;
}

export class SessionTranslationMarkerManager {
  private readonly host = document.createElement('div');
  private readonly root: ShadowRoot;
  private readonly layer = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private readonly tooltipText = document.createElement('div');
  private readonly tooltipUnmark = document.createElement('button');
  private readonly records = new Map<string, TranslationMarkerRecord>();
  private readonly mutationObserver: MutationObserver;
  private visibleRects: VisibleMarkerRect[] = [];
  private hoveredMarkerId: string | undefined;
  private focusedMarkerId: string | undefined;
  private renderFrame: number | undefined;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | undefined;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: SessionTranslationMarkerOptions = {}) {
    this.host.id = 'pi-translation-marker-layer';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;position:fixed;inset:0;z-index:2147483638;pointer-events:none;font-family:Inter,"Segoe UI",system-ui,sans-serif}
      .layer{position:fixed;inset:0;pointer-events:none}
      .marker{position:fixed;border-radius:2px;background:rgba(99,102,241,.105);pointer-events:none;transition:background .12s ease}
      .marker.hovered{background:rgba(99,102,241,.18)}
      .marker.focused{animation:pi-marker-focus 1.1s ease-out}
      .tooltip{position:fixed;max-width:min(360px,calc(100vw - 20px));max-height:min(42vh,360px);padding:7px 9px 9px;border:1px solid rgba(99,102,241,.2);border-radius:6px;color:#1f2937;background:rgba(255,255,255,.98);box-shadow:0 10px 30px rgba(15,23,42,.18);font-size:11px;line-height:1.58;pointer-events:auto;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
      .tooltip-actions{position:sticky;z-index:1;top:-7px;display:flex;justify-content:flex-end;height:22px;margin:-2px -2px 2px;padding-top:2px;background:linear-gradient(var(--tooltip-bg,rgba(255,255,255,.98)) 72%,transparent)}
      .unmark{height:20px;padding:0 4px;border:0;border-radius:3px;color:#6e7b91;background:transparent;font:600 9px/20px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer}.unmark:hover{color:#4f46e5;background:rgba(99,102,241,.08)}
      .tooltip-text{white-space:pre-wrap;overflow-wrap:anywhere}.tooltip-text strong{font-weight:700}
      .tooltip[hidden]{display:none}
      @media(prefers-color-scheme:dark){.tooltip{--tooltip-bg:rgba(20,27,39,.98);color:#eef2f7;background:var(--tooltip-bg);border-color:rgba(165,180,252,.28)}.unmark{color:#a9b5c7}.unmark:hover{color:#c7d2fe;background:rgba(129,140,248,.12)}.marker{background:rgba(129,140,248,.13)}}
      @media(prefers-reduced-motion:reduce){.marker{transition:none}.marker.focused{animation:none}}
      @keyframes pi-marker-focus{0%,100%{background:rgba(99,102,241,.105)}35%{background:rgba(99,102,241,.34)}}
    `;
    this.layer.className = 'layer';
    this.tooltip.className = 'tooltip';
    this.tooltipText.className = 'tooltip-text';
    const tooltipActions = document.createElement('div');
    tooltipActions.className = 'tooltip-actions';
    this.tooltipUnmark.className = 'unmark';
    this.tooltipUnmark.type = 'button';
    this.tooltipUnmark.textContent = '取消标记';
    this.tooltipUnmark.title = '取消这条原文标记';
    this.tooltipUnmark.addEventListener('click', this.removeHoveredMarker);
    tooltipActions.append(this.tooltipUnmark);
    this.tooltip.append(tooltipActions, this.tooltipText);
    this.tooltip.hidden = true;
    this.root.append(style, this.layer, this.tooltip);
    document.documentElement.append(this.host);
    document.addEventListener('pointermove', this.onPointerMove, true);
    document.addEventListener('click', this.onDocumentClick, true);
    window.addEventListener('pointerdown', this.onMarkerPointerDown, true);
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    window.addEventListener('scroll', this.onViewportChange, true);
    this.mutationObserver = new MutationObserver((mutations) => {
      this.scheduleRender();
      if (mutations.some((mutation) => (
        mutation.type === 'attributes' && mutation.attributeName === 'data-rendered'
      ))) this.options.onLocationStateChange?.();
    });
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      // PDF text markers can be restored before the lazily rendered page is
      // ready. The page's text layer may finish mutating while its canvas is
      // still rendering, so those earlier child-list notifications can only
      // produce an empty marker pass. Re-render when the reader publishes its
      // explicit ready state instead of relying on incidental DOM mutations.
      attributeFilter: ['class', 'style', 'data-rendered'],
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  isMarked(markerId: string): boolean {
    return this.records.has(markerId);
  }

  hasMarks(): boolean {
    return this.records.size > 0;
  }

  markCount(): number {
    return this.records.size;
  }

  entries(): TranslationMarkerEntry[] {
    return [...this.records].map(([markerId, record]) => ({ markerId, ...record }));
  }

  summaries(): TranslationMarkerSummary[] {
    return this.entries()
      .map((entry) => ({
        markerId: entry.markerId,
        ...entry.content,
        createdAt: entry.result.completedAt ?? 0,
        locationState: this.locationState(entry.markerId),
      }))
      .sort((left, right) => (
        (left.pageNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt - right.createdAt
      ));
  }

  locationState(markerId: string): TranslationMarkerLocationState {
    const record = this.records.get(markerId);
    if (!record) return 'missing';
    return this.recordLocationState(record);
  }

  locationStateForEntry(entry: TranslationMarkerEntry): TranslationMarkerLocationState {
    return this.recordLocationState(entry);
  }

  private recordLocationState(record: TranslationMarkerRecord): TranslationMarkerLocationState {
    if (record.anchor.kind === 'pdf-region') {
      return document.querySelector(
        `.pdf-page[data-page-number="${record.anchor.sourceLocation.pageNumber}"]`,
      ) ? 'ready' : 'missing';
    }
    if (record.anchor.kind === 'pdf-text-quote') {
      const page = document.querySelector<HTMLElement>(
        `.pdf-page[data-page-number="${record.anchor.pageNumber}"]`,
      );
      if (!page) return 'missing';
      if (page.dataset.rendered !== 'ready') return 'pending';
      const textLayer = page.querySelector<HTMLElement>('.textLayer');
      if (!textLayer) return 'missing';
      return rangeFromTextQuote(
        textLayer,
        record.anchor.sourceText,
        record.anchor.prefix,
        record.anchor.suffix,
      ) ? 'ready' : 'missing';
    }
    const ancestor = record.anchor.range.commonAncestorContainer;
    if (
      ancestor.isConnected &&
      markerTextStillMatches(record.anchor.range.toString(), record.anchor.sourceText)
    ) return 'ready';
    return this.restoreDomRange(record.anchor) ? 'ready' : 'missing';
  }

  focus(markerId: string): void {
    if (!this.records.has(markerId)) return;
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusedMarkerId = markerId;
    this.scheduleRender();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = undefined;
      this.focusedMarkerId = undefined;
      this.scheduleRender();
    }, 1_150);
  }

  reveal(markerId: string): TranslationMarkerLocationState {
    const record = this.records.get(markerId);
    if (!record) return 'missing';
    if (record.anchor.kind === 'pdf-region') return this.locationState(markerId);
    let range: Range | undefined;
    if (record.anchor.kind === 'pdf-text-quote') {
      const page = document.querySelector<HTMLElement>(
        `.pdf-page[data-page-number="${record.anchor.pageNumber}"] .textLayer`,
      );
      if (!page) return 'pending';
      range = rangeFromTextQuote(
        page,
        record.anchor.sourceText,
        record.anchor.prefix,
        record.anchor.suffix,
      );
    } else {
      range = record.anchor.range.commonAncestorContainer.isConnected &&
        markerTextStillMatches(record.anchor.range.toString(), record.anchor.sourceText)
        ? record.anchor.range
        : this.restoreDomRange(record.anchor);
    }
    if (!range) return 'missing';
    const target = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    this.focus(markerId);
    return 'ready';
  }

  hasMarksForResult(requestId: string): boolean {
    return [...this.records.values()].some((record) => record.result.requestId === requestId);
  }

  add(entry: TranslationMarkerEntry): void {
    this.records.set(entry.markerId, {
      result: entry.result,
      anchor: entry.anchor,
      content: entry.content,
    });
    this.scheduleRender();
  }

  updateResult(rootRequestId: string, result: TranslateResult): number {
    let updated = 0;
    const alignedBySource = new Map(
      result.alignedSegments?.map((segment) => [normalizeMarkerText(segment.originalText), segment]) ?? [],
    );
    for (const [markerId, record] of [...this.records]) {
      const recordRoot = record.result.revision?.rootRequestId ?? record.result.requestId;
      if (recordRoot !== rootRequestId) continue;
      if (markerId.includes('::segment:')) {
        const segment = alignedBySource.get(normalizeMarkerText(record.content.originalText));
        // A full-text manual edit or model revision may intentionally omit
        // sentence alignment. Keep the user's sentence mark rather than
        // silently deleting it; update its translation only when a stable
        // source-text match is available.
        if (segment) {
          record.content = {
            ...record.content,
            originalText: segment.originalText,
            translatedText: segment.translatedText,
          };
        }
      } else {
        record.content = {
          ...record.content,
          originalText: result.originalText,
          translatedText: result.translatedText,
        };
      }
      record.result = result;
      updated += 1;
    }
    if (!updated) return 0;
    this.hideTooltip();
    this.scheduleRender();
    this.options.onChange?.(this.entries());
    return updated;
  }

  replace(entries: TranslationMarkerEntry[]): void {
    this.records.clear();
    for (const entry of entries) {
      this.records.set(entry.markerId, {
        result: entry.result,
        anchor: entry.anchor,
        content: entry.content,
      });
    }
    this.hideTooltip();
    this.scheduleRender();
  }

  remove(markerId: string): boolean {
    const removed = this.records.delete(markerId);
    if (!removed) return false;
    if (this.hoveredMarkerId === markerId) this.hideTooltip();
    this.scheduleRender();
    this.options.onChange?.(this.entries());
    return true;
  }

  toggle(
    markerId: string,
    result: TranslateResult,
    anchor: TranslationMarkerAnchor | undefined,
    content: TranslationMarkerContent,
  ): boolean {
    if (this.records.has(markerId)) {
      this.remove(markerId);
      return false;
    }
    if (!anchor) return false;
    this.records.set(markerId, { result, anchor, content });
    this.scheduleRender();
    this.options.onChange?.(this.entries());
    return true;
  }

  firstRect(markerId: string): ViewportRect | undefined {
    return this.visibleRects.find((item) => item.markerId === markerId)?.rect;
  }

  markdownNotes(): string {
    return buildTranslationMarkerMarkdown(
      [...this.records.values()].map(({ content }) => content),
    );
  }

  clear(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    this.focusedMarkerId = undefined;
    this.records.clear();
    this.visibleRects = [];
    this.layer.replaceChildren();
    this.hideTooltip();
  }

  destroy(): void {
    if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
    if (this.tooltipHideTimer) clearTimeout(this.tooltipHideTimer);
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.mutationObserver.disconnect();
    this.tooltipUnmark.removeEventListener('click', this.removeHoveredMarker);
    document.removeEventListener('pointermove', this.onPointerMove, true);
    document.removeEventListener('click', this.onDocumentClick, true);
    window.removeEventListener('pointerdown', this.onMarkerPointerDown, true);
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.host.remove();
  }

  private readonly scheduleRender = (): void => {
    if (this.renderFrame !== undefined) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = undefined;
      this.render();
    });
  };

  private readonly onViewportChange = (): void => {
    this.hideTooltip();
    this.scheduleRender();
  };

  private rectsFor(record: TranslationMarkerRecord): ViewportRect[] {
    if (record.anchor.kind === 'pdf-region') {
      return this.options.resolvePdfRegionRects?.(record.anchor.sourceLocation) ?? [];
    }
    if (record.anchor.kind === 'pdf-text-quote') {
      const page = document.querySelector<HTMLElement>(
        `.pdf-page[data-page-number="${record.anchor.pageNumber}"]`,
      );
      if (!page) return [];
      const pageRect = page.getBoundingClientRect();
      const viewportMargin = 180;
      if (
        pageRect.bottom < -viewportMargin ||
        pageRect.top > innerHeight + viewportMargin ||
        pageRect.right < -viewportMargin ||
        pageRect.left > innerWidth + viewportMargin
      ) return [];
      const textLayer = page.querySelector<HTMLElement>('.textLayer');
      if (!textLayer || page.dataset.rendered !== 'ready') return [];
      const range = rangeFromTextQuote(
        textLayer,
        record.anchor.sourceText,
        record.anchor.prefix,
        record.anchor.suffix,
      );
      return range ? markerRectsFromRange(range) : [];
    }
    const ancestor = record.anchor.range.commonAncestorContainer;
    if (
      !ancestor.isConnected ||
      !markerTextStillMatches(record.anchor.range.toString(), record.anchor.sourceText)
    ) {
      const restored = this.restoreDomRange(record.anchor);
      if (!restored) return [];
      record.anchor.range = restored;
    }
    return markerRectsFromRange(record.anchor.range);
  }

  private restoreDomRange(
    anchor: Extract<TranslationMarkerAnchor, { kind: 'dom-range' }>,
  ): Range | undefined {
    const scope = anchor.scope.isConnected ? anchor.scope : document.body;
    if (!scope) return undefined;
    return rangeFromTextQuote(
      scope,
      anchor.sourceText,
      anchor.prefix,
      anchor.suffix,
    );
  }

  private render(): void {
    const fragment = document.createDocumentFragment();
    const visible: VisibleMarkerRect[] = [];
    for (const [markerId, record] of this.records) {
      for (const rect of this.rectsFor(record)) {
        if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
          continue;
        }
        visible.push({ markerId, rect });
      }
    }
    for (const rect of mergeMarkerRects(visible.map((item) => item.rect))) {
      const marker = document.createElement('span');
      const hovered = this.hoveredMarkerId && visible.some((item) => (
        item.markerId === this.hoveredMarkerId && rectsOverlap(item.rect, rect)
      ));
      const focused = this.focusedMarkerId && visible.some((item) => (
        item.markerId === this.focusedMarkerId && rectsOverlap(item.rect, rect)
      ));
      marker.className = `marker${hovered ? ' hovered' : ''}${focused ? ' focused' : ''}`;
      marker.style.left = `${rect.left}px`;
      marker.style.top = `${rect.top}px`;
      marker.style.width = `${Math.max(1, rect.right - rect.left)}px`;
      marker.style.height = `${Math.max(1, rect.bottom - rect.top)}px`;
      marker.setAttribute('aria-hidden', 'true');
      fragment.append(marker);
    }
    this.visibleRects = visible;
    this.layer.replaceChildren(fragment);
    if (
      this.hoveredMarkerId &&
      !visible.some((item) => item.markerId === this.hoveredMarkerId)
    ) {
      this.hideTooltip();
    }
  }

  private markerAt(clientX: number, clientY: number): VisibleMarkerRect | undefined {
    return this.visibleRects
      .filter(({ rect }) => (
        clientX >= rect.left - 2 &&
        clientX <= rect.right + 2 &&
        clientY >= rect.top - 2 &&
        clientY <= rect.bottom + 2
      ))
      .sort((left, right) => (
        (left.rect.right - left.rect.left) * (left.rect.bottom - left.rect.top) -
        (right.rect.right - right.rect.left) * (right.rect.bottom - right.rect.top)
      ))[0];
  }

  private isTranslationOverlayEvent(event: Event): boolean {
    return event.composedPath().some((target) => (
      target instanceof HTMLElement &&
      target.id === 'tex-selection-translator-root'
    ));
  }

  private isMarkerUiEvent(event: Event): boolean {
    return event.composedPath().includes(this.tooltip) || event.composedPath().includes(this.host);
  }

  private cancelTooltipHide(): void {
    if (!this.tooltipHideTimer) return;
    clearTimeout(this.tooltipHideTimer);
    this.tooltipHideTimer = undefined;
  }

  private scheduleTooltipHide(): void {
    if (!this.hoveredMarkerId || this.tooltipHideTimer) return;
    this.tooltipHideTimer = setTimeout(() => {
      this.tooltipHideTimer = undefined;
      this.hideTooltip();
    }, 260);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.composedPath().includes(this.tooltip)) {
      this.cancelTooltipHide();
      return;
    }
    if (this.isTranslationOverlayEvent(event)) {
      this.hideTooltip();
      return;
    }
    const hit = this.markerAt(event.clientX, event.clientY);
    if (!hit) {
      this.scheduleTooltipHide();
      return;
    }
    this.cancelTooltipHide();
    const record = this.records.get(hit.markerId);
    if (!record) return;
    const shouldPosition = this.hoveredMarkerId !== hit.markerId || this.tooltip.hidden;
    if (this.hoveredMarkerId !== hit.markerId) {
      this.hoveredMarkerId = hit.markerId;
      this.tooltip.scrollTop = 0;
      this.scheduleRender();
    }
    this.tooltipText.replaceChildren();
    for (const segment of splitLightMarkup(record.content.translatedText)) {
      if (segment.kind === 'text') {
        this.tooltipText.append(document.createTextNode(segment.text));
      } else {
        const strong = document.createElement('strong');
        strong.textContent = segment.text;
        this.tooltipText.append(strong);
      }
    }
    this.tooltip.hidden = false;
    if (!shouldPosition) return;
    const margin = 10;
    const preferredLeft = event.clientX + 12;
    const bounds = this.tooltip.getBoundingClientRect();
    const below = hit.rect.bottom + 6;
    const preferredTop = below + bounds.height <= innerHeight - margin
      ? below
      : Math.max(margin, hit.rect.top - bounds.height - 6);
    this.tooltip.style.left = `${Math.max(margin, Math.min(preferredLeft, innerWidth - bounds.width - margin))}px`;
    this.tooltip.style.top = `${preferredTop}px`;
  };

  private readonly onMarkerPointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      this.isTranslationOverlayEvent(event) ||
      this.isMarkerUiEvent(event) ||
      !this.markerAt(event.clientX, event.clientY)
    ) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onDocumentClick = (event: MouseEvent): void => {
    if (
      event.button !== 0 ||
      this.isTranslationOverlayEvent(event) ||
      this.isMarkerUiEvent(event)
    ) return;
    const hit = this.markerAt(event.clientX, event.clientY);
    if (!hit) return;
    const record = this.records.get(hit.markerId);
    if (!record) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate?.(record.result, hit.rect);
  };

  private readonly removeHoveredMarker = (): void => {
    const markerId = this.hoveredMarkerId;
    if (!markerId) return;
    if (this.remove(markerId)) this.options.onTooltipUnmark?.(markerId);
  };

  private hideTooltip(): void {
    this.cancelTooltipHide();
    if (!this.hoveredMarkerId && this.tooltip.hidden) return;
    this.hoveredMarkerId = undefined;
    this.tooltip.hidden = true;
    this.scheduleRender();
  }
}
