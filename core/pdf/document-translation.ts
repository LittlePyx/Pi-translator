import { buildPdfSearchPageIndex, type PdfSearchTextItem } from './search';
import { splitLongTranslationText } from '../translation/text-chunker';

export interface PdfDocumentTranslationBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  sourceAnchor?: PdfDocumentTranslationSourceAnchor;
}

export interface PdfDocumentTranslationSourceAnchor {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

/** Coordinates use a top-left origin in the scale-1 PDF viewport. */
export interface PdfDocumentTranslationTextItem extends PdfSearchTextItem {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface PdfDocumentTranslationPageInput {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  items: readonly PdfDocumentTranslationTextItem[];
}

export interface PdfDocumentTranslationPreparation {
  blocks: PdfDocumentTranslationBlock[];
  unreadablePages: number;
  layoutAwarePages: number;
  multiColumnPages: number;
  removedRepeatedMarginLines: number;
}

interface VisualAtom {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
}

type VisualLineRegion = 'left' | 'right' | 'spanning';

interface VisualLine {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  structured: boolean;
  region?: VisualLineRegion;
  breakBefore?: boolean;
}

interface JoinedLayoutLine {
  line: VisualLine;
  start: number;
  end: number;
}

interface JoinedLayoutText {
  text: string;
  lines: JoinedLayoutLine[];
  paragraphs: Array<{ start: number; end: number }>;
}

interface AnalyzedPage {
  input: PdfDocumentTranslationPageInput;
  lines: VisualLine[];
  geometryTrusted: boolean;
}

export const PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH = 1_100;

const LATIN_OR_DIGIT_END = /[\p{L}\p{N}]$/u;
const LATIN_OR_DIGIT_START = /^[\p{L}\p{N}]/u;
const CJK_BOUNDARY = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const EQUATION_NUMBER = /^(?:\(?\d{1,4}[a-z]?\)?|\[\d{1,4}\])$/iu;
const CODE_LINE = /^(?:[$>#]\s|(?:const|let|var|function|class|def|import|from|return|if|for|while)\b|\w+\s*(?:\([^)]*\))?\s*(?:=>|:=|==|!=|<=|>=)|[{}[\];]|\S+\s*=\s*\S+)/u;
const LIST_ITEM_LINE = /^(?:[-*\u2022\u2023\u25aa\u25e6\u2013\u2014]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+|[A-Za-z][.)]\s+|\([A-Za-z]\)\s+|\[\d{1,4}\]\s+)/u;
const SECTION_HEADING_LINE = /^(?:(?:\d+(?:\.\d+){0,4}|[IVXLC]+)\.?\s+)[\p{Lu}\d]/u;
const SENTENCE_END = /[.!?。！？:：][\])}\u201d\u2019'"]?$/u;
const HEADING_SENTENCE_END = /[.!?。！？][\])}\u201d\u2019'"]?$/u;
const KNOWN_SECTION_HEADINGS = new Set([
  'abstract',
  'acknowledgments',
  'appendix',
  'conclusion',
  'conclusions',
  'discussion',
  'experiments',
  'introduction',
  'limitations',
  'method',
  'methodology',
  'methods',
  'references',
  'related work',
  'results',
]);

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function lowerQuartile(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * 0.25)] ?? sorted[0] ?? 0;
}

function normalizedItemText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function visualAtoms(page: PdfDocumentTranslationPageInput): VisualAtom[] | undefined {
  if (!finitePositive(page.pageWidth) || !finitePositive(page.pageHeight)) return undefined;
  const nonEmpty = page.items.filter((item) => normalizedItemText(item.str));
  if (!nonEmpty.length || nonEmpty.some((item) => (
    typeof item.left !== 'number' || !Number.isFinite(item.left) ||
    typeof item.top !== 'number' || !Number.isFinite(item.top) ||
    !finitePositive(item.width) || !finitePositive(item.height)
  ))) return undefined;
  return nonEmpty.map((item) => {
    const left = Math.max(0, item.left!);
    const top = Math.max(0, item.top!);
    return {
      text: normalizedItemText(item.str),
      left,
      right: Math.min(page.pageWidth, left + item.width!),
      top,
      bottom: Math.min(page.pageHeight, top + item.height!),
      height: item.height!,
    };
  });
}

function sameVisualRow(left: VisualAtom, right: VisualAtom): boolean {
  const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  const smallerHeight = Math.min(left.height, right.height);
  if (overlap >= smallerHeight * 0.22) return true;
  const leftCenter = (left.top + left.bottom) / 2;
  const rightCenter = (right.top + right.bottom) / 2;
  return Math.abs(leftCenter - rightCenter) <= Math.max(left.height, right.height) * 0.68;
}

function joinAtoms(atoms: readonly VisualAtom[]): string {
  let output = '';
  let previous: VisualAtom | undefined;
  for (const atom of atoms) {
    if (!previous) {
      output = atom.text;
      previous = atom;
      continue;
    }
    const leftBoundary = output.at(-1) ?? '';
    const rightBoundary = atom.text[0] ?? '';
    const gap = Math.max(0, atom.left - previous.right);
    const omitSpace =
      /\s$/u.test(output) ||
      /^\s/u.test(atom.text) ||
      (CJK_BOUNDARY.test(leftBoundary) && CJK_BOUNDARY.test(rightBoundary)) ||
      /^[,.;:!?%\)\]}\u201d\u2019]/u.test(atom.text) ||
      /[(\[{\u201c\u2018/]$/u.test(output) ||
      (gap <= Math.max(1.5, Math.min(previous.height, atom.height) * 0.14) &&
        !(LATIN_OR_DIGIT_END.test(leftBoundary) && LATIN_OR_DIGIT_START.test(rightBoundary)));
    output += `${omitSpace ? '' : ' '}${atom.text}`;
    previous = atom;
  }
  return output.trim();
}

function lineFromAtoms(atoms: readonly VisualAtom[], structured = false): VisualLine {
  return {
    text: joinAtoms(atoms),
    left: Math.min(...atoms.map((atom) => atom.left)),
    right: Math.max(...atoms.map((atom) => atom.right)),
    top: Math.min(...atoms.map((atom) => atom.top)),
    bottom: Math.max(...atoms.map((atom) => atom.bottom)),
    height: median(atoms.map((atom) => atom.height)),
    structured,
  };
}

function visualLines(page: PdfDocumentTranslationPageInput): VisualLine[] | undefined {
  const atoms = visualAtoms(page);
  if (!atoms) return undefined;
  const ordered = [...atoms].sort((left, right) => left.top - right.top || left.left - right.left);
  const rows: VisualAtom[][] = [];
  for (const atom of ordered) {
    let closest: VisualAtom[] | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows.slice(-4)) {
      const reference = row[0]!;
      if (!sameVisualRow(reference, atom)) continue;
      const distance = Math.abs(
        (reference.top + reference.bottom) / 2 - (atom.top + atom.bottom) / 2,
      );
      if (distance < closestDistance) {
        closest = row;
        closestDistance = distance;
      }
    }
    if (closest) closest.push(atom);
    else rows.push([atom]);
  }

  const output: VisualLine[] = [];
  for (const row of rows) {
    row.sort((left, right) => left.left - right.left);
    const rowHeight = median(row.map((atom) => atom.height));
    const splitGap = Math.max(16, rowHeight * 1.65, page.pageWidth * 0.025);
    const chunks: VisualAtom[][] = [];
    for (const atom of row) {
      const current = chunks.at(-1);
      const previous = current?.at(-1);
      if (current && previous && atom.left - previous.right <= splitGap) current.push(atom);
      else chunks.push([atom]);
    }
    if (chunks.length >= 3) {
      const cells = chunks.map((chunk) => lineFromAtoms(chunk));
      output.push({
        text: cells.map((cell) => cell.text).join('\t'),
        left: cells[0]!.left,
        right: cells.at(-1)!.right,
        top: Math.min(...cells.map((cell) => cell.top)),
        bottom: Math.max(...cells.map((cell) => cell.bottom)),
        height: median(cells.map((cell) => cell.height)),
        structured: true,
      });
      continue;
    }
    if (chunks.length === 2) {
      const first = lineFromAtoms(chunks[0]!);
      const second = lineFromAtoms(chunks[1]!);
      if (EQUATION_NUMBER.test(second.text) && looksMathDominant(first.text)) {
        output.push({
          ...first,
          text: `${first.text}\t${second.text}`,
          right: second.right,
          bottom: Math.max(first.bottom, second.bottom),
          structured: true,
        });
        continue;
      }
    }
    output.push(...chunks.map((chunk) => lineFromAtoms(chunk)));
  }
  return output.filter((line) => line.text);
}

function looksMathDominant(text: string): boolean {
  const operators = text.match(/[=+*/^_<>{}\u00b1\u00d7\u2212\u2211\u220f\u222b\u221a\u2260\u2248\u2264\u2265]/gu)?.length ?? 0;
  const mathGlyphs = text.match(/[\u2070-\u209f\u2100-\u214f\u2190-\u22ff\u25a0-\u25ff\u{1d400}-\u{1d7ff}]/gu)?.length ?? 0;
  if (operators + mathGlyphs < 2) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters <= Math.max(12, (operators + mathGlyphs) * 4);
}

function looksProtectedStructure(text: string): boolean {
  return text.includes('\t') || looksMathDominant(text) || CODE_LINE.test(text.trim());
}

function looksHeadingLine(line: VisualLine, typicalHeight: number): boolean {
  const text = line.text.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 150 || HEADING_SENTENCE_END.test(text)) return false;
  const normalized = text.replace(/\s*[:：]\s*$/u, '').toLocaleLowerCase('en-US');
  if (KNOWN_SECTION_HEADINGS.has(normalized) || SECTION_HEADING_LINE.test(text)) return true;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return words.length <= 18 && line.height >= typicalHeight * 1.18;
}

function regionLeftEdges(lines: readonly VisualLine[]): Map<VisualLineRegion | 'single', number> {
  const grouped = new Map<VisualLineRegion | 'single', number[]>();
  for (const line of lines) {
    if (line.structured) continue;
    const key = line.region ?? 'single';
    const values = grouped.get(key) ?? [];
    values.push(line.left);
    grouped.set(key, values);
  }
  return new Map([...grouped.entries()].map(([key, values]) => {
    values.sort((left, right) => left - right);
    return [key, values[Math.floor((values.length - 1) * 0.2)] ?? values[0] ?? 0];
  }));
}

function candidateColumnDivider(lines: readonly VisualLine[], pageWidth: number): number | undefined {
  const usable = lines.filter((line) => !line.structured && line.text.length >= 3);
  if (usable.length < 6) return undefined;
  const totalCharacters = usable.reduce((sum, line) => sum + line.text.length, 0);
  let best: { divider: number; score: number } | undefined;
  for (const ratio of [0.42, 0.46, 0.5, 0.54, 0.58]) {
    const divider = pageWidth * ratio;
    const left = usable.filter((line) => line.right <= divider);
    const right = usable.filter((line) => line.left >= divider);
    const crossing = usable.filter((line) => line.left < divider && line.right > divider);
    const leftCharacters = left.reduce((sum, line) => sum + line.text.length, 0);
    const rightCharacters = right.reduce((sum, line) => sum + line.text.length, 0);
    const separatedCharacters = leftCharacters + rightCharacters;
    if (
      left.length < 3 || right.length < 3 ||
      leftCharacters < totalCharacters * 0.18 ||
      rightCharacters < totalCharacters * 0.18 ||
      separatedCharacters < totalCharacters * 0.58
    ) continue;
    const crossingCharacters = crossing.reduce((sum, line) => sum + line.text.length, 0);
    const balance = Math.min(leftCharacters, rightCharacters) /
      Math.max(leftCharacters, rightCharacters);
    const score = separatedCharacters - crossingCharacters * 0.55 + balance * totalCharacters * 0.15;
    if (!best || score > best.score) best = { divider, score };
  }
  return best?.divider;
}

function sortTopLeft(left: VisualLine, right: VisualLine): number {
  return left.top - right.top || left.left - right.left;
}

function orderedLayoutLines(
  source: readonly VisualLine[],
  pageWidth: number,
): { lines: VisualLine[]; multiColumn: boolean } {
  const lines = source.map((line) => ({ ...line }));
  const divider = candidateColumnDivider(lines, pageWidth);
  if (!divider) return { lines: lines.sort(sortTopLeft), multiColumn: false };
  const tolerance = Math.max(3, median(lines.map((line) => line.height)) * 0.35);
  for (const line of lines) {
    line.region = line.right <= divider + tolerance
      ? 'left'
      : line.left >= divider - tolerance
        ? 'right'
        : 'spanning';
  }
  const spanning = lines.filter((line) => line.region === 'spanning').sort(sortTopLeft);
  const columns = lines.filter((line) => line.region !== 'spanning');
  const output: VisualLine[] = [];
  let bandTop = Number.NEGATIVE_INFINITY;
  const appendBand = (bandBottom: number) => {
    const band = columns.filter((line) => line.top >= bandTop && line.top < bandBottom);
    const left = band.filter((line) => line.region === 'left').sort(sortTopLeft);
    const right = band.filter((line) => line.region === 'right').sort(sortTopLeft);
    if (left.length) left[0]!.breakBefore = output.length > 0;
    if (right.length) right[0]!.breakBefore = output.length > 0 || left.length > 0;
    output.push(...left, ...right);
    bandTop = bandBottom;
  };
  for (const line of spanning) {
    appendBand(line.top - tolerance);
    line.breakBefore = output.length > 0;
    output.push(line);
    bandTop = Math.max(bandTop, line.bottom - tolerance);
  }
  appendBand(Number.POSITIVE_INFINITY);
  return { lines: output, multiColumn: true };
}

function marginSignature(line: VisualLine, pageHeight: number): string | undefined {
  const inTopMargin = line.top <= pageHeight * 0.055;
  const inBottomMargin = line.bottom >= pageHeight * 0.945;
  if (!inTopMargin && !inBottomMargin) return undefined;
  const normalized = line.text
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\d+/gu, '#')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim()
    .slice(0, 180);
  return normalized ? `${inTopMargin ? 'top' : 'bottom'}:${normalized}` : undefined;
}

function repeatedMarginSignatures(pages: readonly AnalyzedPage[]): Set<string> {
  if (pages.length < 2) return new Set();
  const appearances = new Map<string, Set<number>>();
  for (const page of pages) {
    if (!page.geometryTrusted) continue;
    for (const line of page.lines) {
      const signature = marginSignature(line, page.input.pageHeight);
      if (!signature) continue;
      const pageNumbers = appearances.get(signature) ?? new Set<number>();
      pageNumbers.add(page.input.pageNumber);
      appearances.set(signature, pageNumbers);
    }
  }
  const requiredPages = Math.max(2, Math.ceil(pages.length * 0.4));
  return new Set([...appearances.entries()].flatMap(([signature, pageNumbers]) => (
    pageNumbers.size >= requiredPages ? [signature] : []
  )));
}

function joinedLineText(lines: readonly VisualLine[]): JoinedLayoutText {
  if (!lines.length) return { text: '', lines: [], paragraphs: [] };
  const verticalSteps = lines.flatMap((line, index) => {
    const next = lines[index + 1];
    return next && line.region === next.region && next.top > line.top
      ? [next.top - line.top]
      : [];
  });
  const ordinaryStep = lowerQuartile(verticalSteps.filter((step) => step > 0)) ||
    median(lines.map((line) => line.height)) * 1.65;
  const typicalHeight = median(lines.filter((line) => !line.structured).map((line) => line.height)) ||
    median(lines.map((line) => line.height));
  const leftEdges = regionLeftEdges(lines);
  let output = lines[0]!.text;
  let paragraphStart = 0;
  const paragraphs: Array<{ start: number; end: number }> = [];
  const joinedLines: JoinedLayoutLine[] = [{
    line: lines[0]!,
    start: 0,
    end: output.length,
  }];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1]!;
    const current = lines[index]!;
    const verticalStep = current.top - previous.top;
    const protectedBoundary = looksProtectedStructure(previous.text) ||
      looksProtectedStructure(current.text);
    const headingBoundary = looksHeadingLine(previous, typicalHeight) ||
      looksHeadingLine(current, typicalHeight);
    const currentRegion = current.region ?? 'single';
    const currentIndent = current.left - (leftEdges.get(currentRegion) ?? current.left);
    const startsIndentedParagraph =
      currentIndent >= Math.max(7, typicalHeight * 0.7) &&
      SENTENCE_END.test(previous.text.trim());
    const paragraphBreak = Boolean(
      current.breakBefore ||
      previous.region !== current.region ||
      protectedBoundary ||
      headingBoundary ||
      LIST_ITEM_LINE.test(current.text.trim()) ||
      startsIndentedParagraph ||
      (verticalStep > 0 && verticalStep > ordinaryStep * 1.35),
    );
    if (paragraphBreak) {
      output = output.trimEnd();
      if (output.length > paragraphStart) paragraphs.push({ start: paragraphStart, end: output.length });
      output += '\n\n';
      paragraphStart = output.length;
      output += current.text;
      joinedLines.push({
        line: current,
        start: output.length - current.text.length,
        end: output.length,
      });
      continue;
    }
    const leftBoundary = output.at(-1) ?? '';
    const rightBoundary = current.text[0] ?? '';
    const omitSpace =
      (CJK_BOUNDARY.test(leftBoundary) && CJK_BOUNDARY.test(rightBoundary)) ||
      /^[,.;:!?%\)\]}\u201d\u2019]/u.test(current.text) ||
      /[(\[{\u201c\u2018/]$/u.test(output);
    output += `${omitSpace ? '' : ' '}${current.text}`;
    joinedLines.push({
      line: current,
      start: output.length - current.text.length,
      end: output.length,
    });
  }
  output = output.trimEnd();
  if (output.length > paragraphStart) paragraphs.push({ start: paragraphStart, end: output.length });
  return { text: output, lines: joinedLines, paragraphs };
}

function sourceAnchorForBlock(
  start: number,
  end: number,
  layout: JoinedLayoutText | undefined,
  pageSize: { width: number; height: number } | undefined,
): PdfDocumentTranslationSourceAnchor | undefined {
  if (!layout || !pageSize || !finitePositive(pageSize.width) || !finitePositive(pageSize.height)) {
    return undefined;
  }
  const overlapping = layout.lines.filter((entry) => entry.end > start && entry.start < end);
  const first = overlapping[0];
  if (!first) return undefined;
  const nearby = [first];
  for (const candidate of overlapping.slice(1, 4)) {
    const previous = nearby.at(-1)!.line;
    const sameFlow = candidate.line.region === first.line.region &&
      !candidate.line.breakBefore &&
      candidate.line.top >= previous.top &&
      candidate.line.top - previous.bottom <= Math.max(
        previous.height,
        candidate.line.height,
      ) * 1.5;
    if (!sameFlow) break;
    nearby.push(candidate);
  }
  const paddingX = Math.max(3, pageSize.width * 0.006);
  const paddingY = Math.max(2, pageSize.height * 0.004);
  const left = Math.max(0, Math.min(...nearby.map((entry) => entry.line.left)) - paddingX);
  const top = Math.max(0, Math.min(...nearby.map((entry) => entry.line.top)) - paddingY);
  const right = Math.min(
    pageSize.width,
    Math.max(...nearby.map((entry) => entry.line.right)) + paddingX,
  );
  const bottom = Math.min(
    pageSize.height,
    Math.max(...nearby.map((entry) => entry.line.bottom)) + paddingY,
  );
  if (right <= left || bottom <= top) return undefined;
  return {
    leftRatio: left / pageSize.width,
    topRatio: top / pageSize.height,
    widthRatio: (right - left) / pageSize.width,
    heightRatio: (bottom - top) / pageSize.height,
  };
}

function blocksFromText(
  pageNumber: number,
  value: string | JoinedLayoutText,
  pageSize?: { width: number; height: number },
): PdfDocumentTranslationBlock[] {
  const safePageNumber = Math.max(1, Math.round(pageNumber));
  const layout = typeof value === 'string' ? undefined : value;
  const text = typeof value === 'string' ? value : value.text;
  if (!text.trim()) return [];
  const ranges = layout?.paragraphs.length
    ? layout.paragraphs
    : [{ start: 0, end: text.length }];
  const chunks = ranges.flatMap((range) => {
    const paragraph = text.slice(range.start, range.end).trim();
    if (!paragraph) return [];
    const paragraphOffset = text.indexOf(paragraph, range.start);
    let cursor = Math.max(range.start, paragraphOffset);
    return splitLongTranslationText(paragraph, PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH).map((block) => {
      const start = text.indexOf(block, cursor);
      const safeStart = start >= 0 && start < range.end ? start : cursor;
      cursor = safeStart + block.length;
      return { text: block, start: safeStart, end: cursor };
    });
  });
  return chunks.map((chunk, blockIndex) => {
    const { text: block, start, end } = chunk;
    const sourceAnchor = sourceAnchorForBlock(start, end, layout, pageSize);
    return {
      id: `P${safePageNumber}B${blockIndex + 1}`,
      pageNumber: safePageNumber,
      blockIndex,
      text: block,
      ...(sourceAnchor ? { sourceAnchor } : {}),
    };
  });
}

/**
 * Builds translation blocks for a single page. Coordinate-free callers retain
 * extraction order; positioned PDF.js items receive conservative layout-aware
 * ordering without requiring OCR or sending page images.
 */
export function pdfDocumentTranslationBlocks(
  pageNumber: number,
  items: readonly PdfDocumentTranslationTextItem[],
  pageSize?: { width: number; height: number },
): PdfDocumentTranslationBlock[] {
  if (pageSize) {
    const lines = visualLines({
      pageNumber,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
      items,
    });
    if (lines?.length) {
      return blocksFromText(
        pageNumber,
        joinedLineText(orderedLayoutLines(lines, pageSize.width).lines),
        pageSize,
      );
    }
  }
  const text = buildPdfSearchPageIndex(pageNumber, items).displayText.trim();
  return blocksFromText(pageNumber, text);
}

/**
 * Performs the complete local preview pass. It detects confident multi-column
 * layouts and removes only repeated top/bottom margin lines across pages.
 */
export function preparePdfDocumentTranslationPages(
  inputs: readonly PdfDocumentTranslationPageInput[],
): PdfDocumentTranslationPreparation {
  const analyzed: AnalyzedPage[] = inputs.map((input) => {
    const lines = visualLines(input);
    return {
      input,
      lines: lines ?? [],
      geometryTrusted: Boolean(lines),
    };
  });
  const repeatedMargins = repeatedMarginSignatures(analyzed);
  const blocks: PdfDocumentTranslationBlock[] = [];
  let unreadablePages = 0;
  let layoutAwarePages = 0;
  let multiColumnPages = 0;
  let removedRepeatedMarginLines = 0;
  for (const page of analyzed) {
    if (!page.geometryTrusted) {
      const fallback = pdfDocumentTranslationBlocks(page.input.pageNumber, page.input.items);
      if (!fallback.length) unreadablePages += 1;
      blocks.push(...fallback);
      continue;
    }
    layoutAwarePages += 1;
    const filtered = page.lines.filter((line) => {
      const signature = marginSignature(line, page.input.pageHeight);
      const remove = Boolean(signature && repeatedMargins.has(signature));
      if (remove) removedRepeatedMarginLines += 1;
      return !remove;
    });
    const ordered = orderedLayoutLines(filtered, page.input.pageWidth);
    if (ordered.multiColumn) multiColumnPages += 1;
    const pageBlocks = blocksFromText(page.input.pageNumber, joinedLineText(ordered.lines), {
      width: page.input.pageWidth,
      height: page.input.pageHeight,
    });
    if (!pageBlocks.length) unreadablePages += 1;
    blocks.push(...pageBlocks);
  }
  return {
    blocks,
    unreadablePages,
    layoutAwarePages,
    multiColumnPages,
    removedRepeatedMarginLines,
  };
}

export function pdfDocumentTranslationPriority(
  block: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  currentPage: number,
): [number, number, number] {
  const distance = Math.abs(block.pageNumber - currentPage);
  const direction = block.pageNumber >= currentPage ? 0 : 1;
  return [distance, direction, block.blockIndex];
}

export function comparePdfDocumentTranslationPriority(
  left: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  right: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  currentPage: number,
): number {
  const leftPriority = pdfDocumentTranslationPriority(left, currentPage);
  const rightPriority = pdfDocumentTranslationPriority(right, currentPage);
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = leftPriority[index]! - rightPriority[index]!;
    if (difference) return difference;
  }
  return 0;
}
