import { buildPdfSearchPageIndex, type PdfSearchTextItem } from './search';
import { splitLongTranslationText } from '../translation/text-chunker';
import type { CoordinateOcrPage } from './ocr-text-layer';
import { shouldUseVisionForPdfFormula } from '../translation/formula-detection';

export type PdfDocumentTranslationBlockKind = 'text' | 'formula' | 'code' | 'table' | 'figure';

export interface PdfDocumentTranslationBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  /** Ordinary prose omits this field to keep existing session plans compact. */
  kind?: Exclude<PdfDocumentTranslationBlockKind, 'text'>;
  sourceAnchor?: PdfDocumentTranslationSourceAnchor;
  /**
   * A semantic block can continue through a layout break, figure, or full-width
   * interruption. In that case every tight source crop is retained in reading
   * order instead of replacing them with one large, ambiguous bounding box.
   */
  sourceRegions?: readonly PdfDocumentTranslationSourceRegion[];
}

export interface PdfDocumentTranslationSourceAnchor {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface PdfDocumentTranslationSourceRegion {
  pageNumber: number;
  sourceAnchor: PdfDocumentTranslationSourceAnchor;
}

/** Coordinates use a top-left origin in the scale-1 PDF viewport. */
export interface PdfDocumentTranslationTextItem extends PdfSearchTextItem {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  kind?: PdfDocumentTranslationBlockKind;
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

/** Converts trusted, upright OCR blocks into the same local layout input as a PDF text layer. */
export function pdfDocumentTranslationItemsFromOcr(
  page: CoordinateOcrPage,
  pageWidth: number,
  pageHeight: number,
  minimumConfidence = 0.82,
): PdfDocumentTranslationTextItem[] {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return [];
  return page.blocks.filter((block) => (
    block.confidence >= minimumConfidence &&
    Math.abs(block.rotationDegrees ?? 0) <= 5
  )).map((block) => ({
    str: block.text,
    hasEOL: true,
    left: block.box.left * pageWidth,
    top: block.box.top * pageHeight,
    width: block.box.width * pageWidth,
    height: block.box.height * pageHeight,
    kind: block.kind,
  }));
}

interface VisualAtom {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  kind?: PdfDocumentTranslationBlockKind;
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
  kind?: PdfDocumentTranslationBlockKind;
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

/** Keeps ordinary academic abstracts intact while staying below the 5,200-character batch cap. */
export const PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH = 2_400;
export const PDF_DOCUMENT_TRANSLATION_CONTINUATION_LENGTH = 4_800;
const PDF_DOCUMENT_TRANSLATION_CONTINUATION_REGIONS = 8;
const PDF_DOCUMENT_TRANSLATION_CONTINUATION_MEMBERS = 24;

const LATIN_OR_DIGIT_END = /[\p{L}\p{N}]$/u;
const LATIN_OR_DIGIT_START = /^[\p{L}\p{N}]/u;
const CJK_BOUNDARY = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const EQUATION_NUMBER = /^(?:\(?\d{1,4}[a-z]?\)?|\[\d{1,4}\])$/iu;
const HIGH_CONFIDENCE_CODE_LINE = /^(?:[$>#]\s|(?:const|let|var)\s+[$\p{L}_][$\p{L}\p{N}_]*|(?:function|class|def)\s+[$\p{L}_][$\p{L}\p{N}_]*|from\s+[\w.]+\s+import\s+|import\s+(?:[{*]|[\w.]+(?:\s*,\s*[\w.]+)*\s*$)|(?:return|if|for|while)\s*\(|\w+\s*(?:\([^)]*\))?\s*(?:=>|:=|==|!=|<=|>=)|;\s*$)/u;
const CODE_LINE = /^(?:[$>#]\s|(?:const|let|var)\s+[$\p{L}_][$\p{L}\p{N}_]*|(?:function|class|def)\s+[$\p{L}_][$\p{L}\p{N}_]*|from\s+[\w.]+\s+import\s+|import\s+(?:[{*]|[\w.]+(?:\s*,\s*[\w.]+)*\s*$)|(?:return|if|for|while)\s*\(|\w+\s*(?:\([^)]*\))?\s*(?:=>|:=|==|!=|<=|>=)|;\s*$|\S+\s*=\s*\S+)/u;
const STANDALONE_MATH_DELIMITER = /^[{}[\]]+$/u;
const LIST_ITEM_LINE = /^(?:[-*\u2022\u2023\u25aa\u25e6\u2013\u2014]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+|[A-Za-z][.)]\s+|\([A-Za-z]\)\s+|\[\d{1,4}\]\s+)/u;
const SECTION_HEADING_LINE = /^(?:(?:\d+(?:\.\d+){0,4}|[IVXLC]+)\.?\s+)[\p{Lu}\d]/u;
const SENTENCE_END = /[.!?。！？:：][\])}\u201d\u2019'"]?$/u;
const HEADING_SENTENCE_END = /[.!?。！？][\])}\u201d\u2019'"]?$/u;
const CONTINUITY_SENTENCE_END = /[.!?。！？][\])}\u201d\u2019'"]?$/u;
// Treat a block as an interrupting caption only when the label has an explicit
// caption separator. A prose sentence such as "Figure 2 clearly illustrates"
// is a semantic paragraph, not a caption; skipping it would let its lower-case
// continuation lines attach to the preceding equation or paragraph.
const CAPTION_BLOCK = /^(?:fig(?:ure)?\.?|table|algorithm|listing|scheme|图|表|算法)\s*(?:[A-Z]?\d+[A-Z]?|[IVXLC]+)\s*[.:-](?:\s|$)/iu;
const FIGURE_CAPTION = /(?:^|\s)((?:fig(?:ure)?\.?|scheme|图)\s*(?:[A-Z]?\d+[A-Z]?|[IVXLC]+)\s*[.:-](?:\s|$))/iu;
const TABLE_CAPTION = /(?:^|\s)((?:table|表)\s*(?:[A-Z]?\d+[A-Z]?|[IVXLC]+)\s*[.:-](?:\s|$))/iu;
const INLINE_SECTION_LEAD = /^[\p{Lu}\d][^.!?。！？:：\t]{2,72}[:：]\s+\p{Lu}/u;
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
      ...(item.kind ? { kind: item.kind } : {}),
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
  const kind = atoms.some((atom) => atom.kind === 'formula')
    ? 'formula'
    : atoms.some((atom) => atom.kind === 'table')
      ? 'table'
      : atoms.some((atom) => atom.kind === 'code')
        ? 'code'
        : undefined;
  return {
    text: joinAtoms(atoms),
    left: Math.min(...atoms.map((atom) => atom.left)),
    right: Math.max(...atoms.map((atom) => atom.right)),
    top: Math.min(...atoms.map((atom) => atom.top)),
    bottom: Math.max(...atoms.map((atom) => atom.bottom)),
    height: median(atoms.map((atom) => atom.height)),
    structured,
    ...(kind ? { kind } : {}),
  };
}

function structuredLineFromChunks(chunks: readonly VisualAtom[][]): VisualLine {
  const cells = chunks.map((chunk) => lineFromAtoms(chunk));
  const text = cells.map((cell) => cell.text).join('\t');
  const proseEquationRow = chunksLookLikeProse(chunks) && /[=≈≠≤≥]/u.test(text);
  const fragmentedEquationRow = cells.length >= 2 &&
    cells.every((cell) => cell.text.length <= 14) &&
    cells.every((cell) => !/[A-Za-z]{2,}/u.test(cell.text)) &&
    cells.some((cell) => (
      /[\d=+\-−*/×÷^_<>≤≥≈≠Α-Ωα-ω]/u.test(cell.text) ||
      /^[()~]*[A-Za-z][()~]*$/u.test(cell.text.trim())
    ));
  return {
    text,
    left: cells[0]!.left,
    right: cells.at(-1)!.right,
    top: Math.min(...cells.map((cell) => cell.top)),
    bottom: Math.max(...cells.map((cell) => cell.bottom)),
    height: median(cells.map((cell) => cell.height)),
    structured: true,
    kind: proseEquationRow || fragmentedEquationRow ||
      cells.some((cell) => cell.kind === 'formula') ||
      shouldUseVisionForPdfFormula(text.replace(/\t/gu, ' '))
      ? 'formula'
      : 'table',
  };
}

function chunksLookLikeProse(chunks: readonly VisualAtom[][]): boolean {
  const text = chunks.map((chunk) => joinAtoms(chunk)).join(' ');
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const words = text.match(/\p{L}+/gu)?.length ?? 0;
  return letters >= 20 && words >= 4 && !looksMathDominant(text);
}

function visualLines(page: PdfDocumentTranslationPageInput): VisualLine[] | undefined {
  const atoms = visualAtoms(page);
  if (!atoms) return undefined;
  const provisionalDivider = candidateColumnDivider(
    atoms.map((atom) => lineFromAtoms([atom])),
    page.pageWidth,
  );
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
      if (provisionalDivider) {
        const tolerance = Math.max(3, rowHeight * .35);
        const leftChunks = chunks.filter((chunk) => chunk.at(-1)!.right <= provisionalDivider + tolerance);
        const rightChunks = chunks.filter((chunk) => chunk[0]!.left >= provisionalDivider - tolerance);
        const crossingChunks = chunks.filter((chunk) => (
          chunk[0]!.left < provisionalDivider - tolerance &&
          chunk.at(-1)!.right > provisionalDivider + tolerance
        ));
        if (
          leftChunks.length && rightChunks.length && !crossingChunks.length &&
          leftChunks.length + rightChunks.length === chunks.length
        ) {
          output.push(
            ...(leftChunks.length === 1
              ? [lineFromAtoms(leftChunks[0]!)]
              : [structuredLineFromChunks(leftChunks)]),
            ...(rightChunks.length === 1
              ? [lineFromAtoms(rightChunks[0]!)]
              : [structuredLineFromChunks(rightChunks)]),
          );
          continue;
        }
      }
      const gaps = chunks.slice(0, -1).map((chunk, index) => ({
        index,
        gap: chunks[index + 1]![0]!.left - chunk.at(-1)!.right,
      }));
      const widestGap = gaps.reduce((best, candidate) => (
        candidate.gap > best.gap ? candidate : best
      ));
      const leftChunks = chunks.slice(0, widestGap.index + 1);
      const rightChunks = chunks.slice(widestGap.index + 1);
      const separatesColumnProse = widestGap.gap >= Math.max(page.pageWidth * .1, rowHeight * 5) && (
        (leftChunks.length === 1 && rightChunks.length >= 2 && chunksLookLikeProse(leftChunks)) ||
        (rightChunks.length === 1 && leftChunks.length >= 2 && chunksLookLikeProse(rightChunks))
      );
      if (separatesColumnProse) {
        output.push(
          ...(leftChunks.length === 1
            ? [lineFromAtoms(leftChunks[0]!)]
            : [structuredLineFromChunks(leftChunks)]),
          ...(rightChunks.length === 1
            ? [lineFromAtoms(rightChunks[0]!)]
            : [structuredLineFromChunks(rightChunks)]),
        );
        continue;
      }
      output.push(structuredLineFromChunks(chunks));
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
          kind: 'formula',
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
  return text.includes('\t') || looksMathDominant(text) ||
    CODE_LINE.test(text.trim()) || STANDALONE_MATH_DELIMITER.test(text.trim());
}

/**
 * Classifies only high-confidence standalone structures. Mixed prose remains
 * text so its surrounding language is still translated; explicit OCR kinds
 * take precedence over heuristics derived from a PDF text layer.
 */
export function pdfDocumentTranslationBlockKind(
  text: string,
  sourceKinds: readonly PdfDocumentTranslationBlockKind[] = [],
): PdfDocumentTranslationBlockKind {
  const trimmed = text.trim();
  if (sourceKinds.includes('formula')) return 'formula';
  if (sourceKinds.includes('table')) return 'table';
  if (STANDALONE_MATH_DELIMITER.test(trimmed)) return 'formula';
  if (sourceKinds.includes('code') || HIGH_CONFIDENCE_CODE_LINE.test(trimmed)) return 'code';
  const withoutEquationNumber = trimmed.replace(
    /\s*\t\s*(?:\(?\d{1,4}[a-z]?\)?|\[\d{1,4}\])\s*$/iu,
    '',
  );
  if (
    looksMathDominant(withoutEquationNumber) ||
    (
      withoutEquationNumber.length <= 280 &&
      !SENTENCE_END.test(withoutEquationNumber) &&
      shouldUseVisionForPdfFormula(withoutEquationNumber)
    )
  ) return 'formula';
  if (CODE_LINE.test(trimmed)) return 'code';
  if (trimmed.includes('\t')) return 'table';
  return 'text';
}

export function pdfDocumentTranslationBlockContainsFormula(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): boolean {
  return block.kind === 'formula' || shouldUseVisionForPdfFormula(block.text);
}

export function pdfDocumentTranslationSourceRegions(
  block: Pick<
    PdfDocumentTranslationBlock,
    'pageNumber' | 'sourceAnchor' | 'sourceRegions'
  >,
): PdfDocumentTranslationSourceRegion[] {
  if (block.sourceRegions?.length) {
    return block.sourceRegions.map((region) => ({
      pageNumber: region.pageNumber,
      sourceAnchor: { ...region.sourceAnchor },
    }));
  }
  return block.sourceAnchor
    ? [{ pageNumber: block.pageNumber, sourceAnchor: { ...block.sourceAnchor } }]
    : [];
}

function coalesceAdjacentPdfDocumentTranslationSourceRegions(
  regions: readonly PdfDocumentTranslationSourceRegion[],
): PdfDocumentTranslationSourceRegion[] {
  const output: PdfDocumentTranslationSourceRegion[] = [];
  for (const region of regions) {
    const previous = output.at(-1);
    if (!previous || previous.pageNumber !== region.pageNumber) {
      output.push({
        pageNumber: region.pageNumber,
        sourceAnchor: { ...region.sourceAnchor },
      });
      continue;
    }
    const left = Math.max(previous.sourceAnchor.leftRatio, region.sourceAnchor.leftRatio);
    const right = Math.min(
      previous.sourceAnchor.leftRatio + previous.sourceAnchor.widthRatio,
      region.sourceAnchor.leftRatio + region.sourceAnchor.widthRatio,
    );
    const horizontalOverlap = Math.max(0, right - left);
    const minimumWidth = Math.min(
      previous.sourceAnchor.widthRatio,
      region.sourceAnchor.widthRatio,
    );
    const previousBottom = previous.sourceAnchor.topRatio + previous.sourceAnchor.heightRatio;
    const verticalGap = region.sourceAnchor.topRatio - previousBottom;
    const followsSameColumn =
      horizontalOverlap >= minimumWidth * .55 &&
      region.sourceAnchor.topRatio >= previous.sourceAnchor.topRatio - .004 &&
      verticalGap <= .018;
    if (!followsSameColumn) {
      output.push({
        pageNumber: region.pageNumber,
        sourceAnchor: { ...region.sourceAnchor },
      });
      continue;
    }
    const mergedLeft = Math.min(previous.sourceAnchor.leftRatio, region.sourceAnchor.leftRatio);
    const mergedTop = Math.min(previous.sourceAnchor.topRatio, region.sourceAnchor.topRatio);
    const mergedRight = Math.max(
      previous.sourceAnchor.leftRatio + previous.sourceAnchor.widthRatio,
      region.sourceAnchor.leftRatio + region.sourceAnchor.widthRatio,
    );
    const mergedBottom = Math.max(
      previousBottom,
      region.sourceAnchor.topRatio + region.sourceAnchor.heightRatio,
    );
    previous.sourceAnchor = {
      leftRatio: mergedLeft,
      topRatio: mergedTop,
      widthRatio: mergedRight - mergedLeft,
      heightRatio: mergedBottom - mergedTop,
    };
  }
  return output;
}

interface PdfDocumentTranslationAnchorBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function pdfDocumentTranslationBlockBounds(
  block: PdfDocumentTranslationBlock,
): PdfDocumentTranslationAnchorBounds | undefined {
  const regions = pdfDocumentTranslationSourceRegions(block).filter(
    (region) => region.pageNumber === block.pageNumber,
  );
  if (!regions.length) return undefined;
  return {
    left: Math.min(...regions.map((region) => region.sourceAnchor.leftRatio)),
    top: Math.min(...regions.map((region) => region.sourceAnchor.topRatio)),
    right: Math.max(...regions.map((region) => (
      region.sourceAnchor.leftRatio + region.sourceAnchor.widthRatio
    ))),
    bottom: Math.max(...regions.map((region) => (
      region.sourceAnchor.topRatio + region.sourceAnchor.heightRatio
    ))),
  };
}

function pdfDocumentTranslationBoundsShareLane(
  left: PdfDocumentTranslationAnchorBounds,
  right: PdfDocumentTranslationAnchorBounds,
): boolean {
  const overlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const minimumWidth = Math.min(left.right - left.left, right.right - right.left);
  const leftCenter = (left.left + left.right) / 2;
  const rightCenter = (right.left + right.right) / 2;
  return overlap >= minimumWidth * .16 ||
    (leftCenter >= right.left - .02 && leftCenter <= right.right + .02) ||
    (rightCenter >= left.left - .02 && rightCenter <= left.right + .02);
}

function pdfDocumentTranslationUnionAnchor(
  blocks: readonly PdfDocumentTranslationBlock[],
  padding: { x: number; top: number; bottom: number },
): PdfDocumentTranslationSourceAnchor | undefined {
  const bounds = blocks.flatMap((block) => {
    const value = pdfDocumentTranslationBlockBounds(block);
    return value ? [value] : [];
  });
  if (!bounds.length) return undefined;
  const left = Math.max(0, Math.min(...bounds.map((bound) => bound.left)) - padding.x);
  const top = Math.max(0, Math.min(...bounds.map((bound) => bound.top)) - padding.top);
  const right = Math.min(1, Math.max(...bounds.map((bound) => bound.right)) + padding.x);
  const bottom = Math.min(1, Math.max(...bounds.map((bound) => bound.bottom)) + padding.bottom);
  if (right <= left || bottom <= top) return undefined;
  return {
    leftRatio: left,
    topRatio: top,
    widthRatio: right - left,
    heightRatio: bottom - top,
  };
}

function pdfDocumentTranslationCaptionText(
  text: string,
  pattern: RegExp,
): string | undefined {
  const match = pattern.exec(text);
  if (!match?.[1]) return undefined;
  const captionStart = match.index + match[0].lastIndexOf(match[1]);
  return text.slice(captionStart).replace(/\s+/gu, ' ').trim() || undefined;
}

function pdfDocumentTranslationLooksFigureFragment(
  block: PdfDocumentTranslationBlock,
): boolean {
  if (!block.sourceAnchor || block.kind === 'code' || block.kind === 'figure') return false;
  const text = block.text.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 120 || FIGURE_CAPTION.test(text) || TABLE_CAPTION.test(text)) {
    return false;
  }
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}+−'’_-]*/gu) ?? [];
  if (SENTENCE_END.test(text) && words.length > 6) return false;
  // Numbered display equations sit near prose just like plots do. Never absorb
  // an equation into a chart merely because a figure caption follows it.
  if (block.kind === 'formula' && /(?:=|≤|≥|≈|\barg\s*min\b|\barg\s*max\b)/iu.test(text)) {
    return false;
  }
  const numericCharacters = text.match(/[\d.,%+−-]/gu)?.length ?? 0;
  const axisOrLegend = /\b(?:accuracy|epoch|error|iteration|loss|method|model|number|phase|psnr|ratio|score|ssim|time|training)\b|\bdb\b/iu.test(text);
  return block.kind === 'table' || block.kind === 'formula' || axisOrLegend ||
    (text.length <= 28 && numericCharacters >= Math.max(1, text.length * .28));
}

function reindexPdfDocumentTranslationPageBlocks(
  blocks: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  return blocks.map((block, blockIndex) => ({
    ...block,
    blockIndex,
    id: `P${block.pageNumber}B${blockIndex + 1}`,
  }));
}

function groupPdfDocumentTranslationFigures(
  input: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  const output = [...input];
  for (let captionIndex = 0; captionIndex < output.length; captionIndex += 1) {
    const caption = output[captionIndex]!;
    const captionText = pdfDocumentTranslationCaptionText(caption.text, FIGURE_CAPTION);
    const captionBounds = pdfDocumentTranslationBlockBounds(caption);
    if (!captionText || !captionBounds) continue;
    const members: number[] = [];
    let nextTop = captionBounds.top;
    let structuredEvidence = 0;
    let numericEvidence = 0;
    for (
      let candidateIndex = captionIndex - 1;
      candidateIndex >= 0 && members.length < 28;
      candidateIndex -= 1
    ) {
      const candidate = output[candidateIndex]!;
      const bounds = pdfDocumentTranslationBlockBounds(candidate);
      if (
        candidate.pageNumber !== caption.pageNumber || !bounds ||
        !pdfDocumentTranslationLooksFigureFragment(candidate) ||
        !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds) ||
        bounds.bottom > captionBounds.bottom + .025 ||
        nextTop - bounds.bottom > .085 ||
        captionBounds.bottom - bounds.top > .38
      ) break;
      members.unshift(candidateIndex);
      nextTop = Math.min(nextTop, bounds.top);
      if (candidate.kind === 'formula' || candidate.kind === 'table') structuredEvidence += 1;
      if (/\d/u.test(candidate.text)) numericEvidence += 1;
    }
    const hasFragmentEvidence = members.length >= 3 && structuredEvidence >= 2 &&
      (numericEvidence >= 1 || structuredEvidence >= 4);
    if (hasFragmentEvidence) {
      const firstIndex = members[0]!;
      const grouped = [...members.map((index) => output[index]!), caption];
      const sourceAnchor = pdfDocumentTranslationUnionAnchor(grouped, {
        x: .012,
        top: .012,
        bottom: .006,
      });
      if (!sourceAnchor) continue;
      output.splice(firstIndex, captionIndex - firstIndex + 1, {
        id: output[firstIndex]!.id,
        pageNumber: caption.pageNumber,
        blockIndex: output[firstIndex]!.blockIndex,
        text: captionText,
        kind: 'figure',
        sourceAnchor,
      });
      captionIndex = firstIndex;
      continue;
    }

    // Raster figures and diagrams often contribute no text-layer atoms at all.
    // Keep the explicit caption plus its wrapped continuation as one object and
    // conservatively extend the crop upward to include the visual it describes.
    const captionMembers = [caption];
    let completeCaption = captionText;
    let cursor = captionIndex + 1;
    let previousBounds = captionBounds;
    while (!SENTENCE_END.test(completeCaption) && cursor < output.length && captionMembers.length < 4) {
      const candidate = output[cursor]!;
      const bounds = pdfDocumentTranslationBlockBounds(candidate);
      const candidateText = candidate.text.replace(/\s+/gu, ' ').trim();
      if (
        candidate.pageNumber !== caption.pageNumber || candidate.kind || !bounds ||
        CAPTION_BLOCK.test(candidateText) || SECTION_HEADING_LINE.test(candidateText) ||
        candidateText.length > 260 ||
        !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds) ||
        bounds.top - previousBounds.bottom > .035
      ) break;
      captionMembers.push(candidate);
      completeCaption = joinPdfDocumentTranslationContinuationText(
        completeCaption,
        candidateText,
      );
      previousBounds = bounds;
      cursor += 1;
    }
    const sourceAnchor = pdfDocumentTranslationUnionAnchor(captionMembers, {
      x: .012,
      top: .006,
      bottom: .006,
    });
    if (!sourceAnchor) continue;
    const inferredVisualHeight = Math.min(.3, Math.max(.12, sourceAnchor.widthRatio * .42));
    const inferredTop = Math.max(0, sourceAnchor.topRatio - inferredVisualHeight);
    sourceAnchor.heightRatio += sourceAnchor.topRatio - inferredTop;
    sourceAnchor.topRatio = inferredTop;
    output.splice(captionIndex, captionMembers.length, {
      id: caption.id,
      pageNumber: caption.pageNumber,
      blockIndex: caption.blockIndex,
      text: completeCaption,
      kind: 'figure',
      sourceAnchor,
    });
  }
  return output;
}

function groupPdfDocumentTranslationTables(
  input: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  const output: PdfDocumentTranslationBlock[] = [];
  for (let index = 0; index < input.length;) {
    const first = input[index]!;
    const captionText = pdfDocumentTranslationCaptionText(first.text, TABLE_CAPTION);
    if (captionText) {
      const captionBounds = pdfDocumentTranslationBlockBounds(first);
      const members = [first];
      let cursor = index + 1;
      let previousBounds = captionBounds;
      let strongEvidence = 0;
      while (cursor < input.length && members.length < 80) {
        const candidate = input[cursor]!;
        const bounds = pdfDocumentTranslationBlockBounds(candidate);
        const text = candidate.text.replace(/\s+/gu, ' ').trim();
        const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}+−'’_-]*/gu) ?? [];
        const numericCharacters = text.match(/[\d.%+−-]/gu)?.length ?? 0;
        const numericRatio = numericCharacters / Math.max(1, text.length);
        const structured = candidate.kind === 'table' || candidate.kind === 'formula' ||
          candidate.text.includes('\t');
        const numericRow = numericCharacters >= 2 && numericRatio >= .08;
        const heading = SECTION_HEADING_LINE.test(text) && numericRatio < .08;
        const proseLike = words.length > 12 && !structured && numericRatio < .08;
        const strong = structured || numericRow;
        const compactLabel = text.length <= 80 && words.length <= 8 &&
          !SENTENCE_END.test(text) && !heading;
        const tableLike = Boolean(text) && !heading && !proseLike &&
          text.length <= 520 && (strong || compactLabel);
        if (
          candidate.pageNumber !== first.pageNumber || !bounds || !captionBounds || !tableLike ||
          !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds) ||
          (previousBounds && bounds.top - previousBounds.bottom > .065) ||
          bounds.bottom - captionBounds.top > .36
        ) break;
        members.push(candidate);
        previousBounds = bounds;
        if (strong) strongEvidence += 1;
        cursor += 1;
      }
      if (members.length >= 3 && strongEvidence >= 2) {
        const sourceAnchor = pdfDocumentTranslationUnionAnchor(members, {
          x: .008,
          top: .006,
          bottom: .006,
        });
        if (sourceAnchor) {
          output.push({
            id: first.id,
            pageNumber: first.pageNumber,
            blockIndex: first.blockIndex,
            text: [
              captionText,
              ...members.slice(1).map((block) => block.text.trim()),
            ].join('\n'),
            kind: 'table',
            sourceAnchor,
          });
          index = cursor;
          continue;
        }
      }
      output.push(first);
      index += 1;
      continue;
    }
    if (first.kind !== 'table') {
      output.push(first);
      index += 1;
      continue;
    }
    const members: PdfDocumentTranslationBlock[] = [];
    let previousBounds: PdfDocumentTranslationAnchorBounds | undefined;
    let cursor = index;
    while (cursor < input.length && members.length < 80) {
      const candidate = input[cursor]!;
      const bounds = pdfDocumentTranslationBlockBounds(candidate);
      if (
        candidate.pageNumber !== first.pageNumber || candidate.kind !== 'table' || !bounds ||
        (previousBounds && (
          !pdfDocumentTranslationBoundsShareLane(previousBounds, bounds) ||
          bounds.top - previousBounds.bottom > .065
        ))
      ) break;
      members.push(candidate);
      previousBounds = bounds;
      cursor += 1;
    }
    const rowCount = members.filter((block) => block.kind === 'table').length;
    if (rowCount < 2) {
      output.push(first);
      index += 1;
      continue;
    }
    const sourceAnchor = pdfDocumentTranslationUnionAnchor(members, {
      x: .008,
      top: .006,
      bottom: .006,
    });
    if (!sourceAnchor) {
      output.push(first);
      index += 1;
      continue;
    }
    output.push({
      id: first.id,
      pageNumber: first.pageNumber,
      blockIndex: first.blockIndex,
      text: members.map((block) => block.text.trim()).join('\n'),
      kind: 'table',
      sourceAnchor,
    });
    index = cursor;
  }
  return output;
}

/**
 * Collapses high-confidence chart and table fragments into one semantic object.
 * This pass is fully local: it neither renders the page nor authorizes a visual
 * request. The merged anchor is later used for one whole-object crop and one
 * source highlight instead of a list of ticks, legends, or individual cells.
 */
export function groupPdfDocumentTranslationVisualObjects(
  blocks: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  return reindexPdfDocumentTranslationPageBlocks(
    groupPdfDocumentTranslationTables(groupPdfDocumentTranslationFigures(blocks)),
  );
}

export interface PdfDocumentTranslationContinuity {
  previousIndex?: number;
  nextIndex?: number;
  continuesPrevious: boolean;
  continuesNext: boolean;
  skippedBefore: number;
  skippedAfter: number;
}

function pdfDocumentTranslationBlockLooksHeading(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): boolean {
  if (block.kind) return false;
  const text = block.text.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 160 || CONTINUITY_SENTENCE_END.test(text)) return false;
  const normalized = text.replace(/\s*[:：]\s*$/u, '').toLocaleLowerCase('en-US');
  return KNOWN_SECTION_HEADINGS.has(normalized) || SECTION_HEADING_LINE.test(text);
}

function pdfDocumentTranslationBlockIsSkippableInterruption(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): boolean {
  return block.kind === 'code' || block.kind === 'table' || block.kind === 'figure' ||
    CAPTION_BLOCK.test(block.text.trim());
}

function pdfDocumentTranslationContextNeighborIndex(
  blocks: readonly Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>[],
  index: number,
  direction: -1 | 1,
): number | undefined {
  for (let cursor = index + direction; cursor >= 0 && cursor < blocks.length; cursor += direction) {
    const candidate = blocks[cursor]!;
    if (pdfDocumentTranslationBlockLooksHeading(candidate)) return undefined;
    if (pdfDocumentTranslationBlockIsSkippableInterruption(candidate)) continue;
    return cursor;
  }
  return undefined;
}

function pdfDocumentTranslationBlocksContinueSentence(
  previous: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
  current: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): boolean {
  if (
    pdfDocumentTranslationBlockLooksHeading(previous) ||
    pdfDocumentTranslationBlockLooksHeading(current) ||
    pdfDocumentTranslationBlockIsSkippableInterruption(previous) ||
    pdfDocumentTranslationBlockIsSkippableInterruption(current)
  ) return false;
  const previousText = previous.text.trim();
  return Boolean(previousText) && !CONTINUITY_SENTENCE_END.test(previousText);
}

/**
 * Locates the semantic reading neighbors of one block. Captions, tables, and
 * code may interrupt the page visually without ending an unfinished prose
 * sentence; headings remain hard boundaries. No OCR or provider request is
 * involved in this local continuity graph.
 */
export function pdfDocumentTranslationContinuity(
  blocks: readonly Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>[],
  index: number,
): PdfDocumentTranslationContinuity {
  const current = blocks[index];
  if (!current || pdfDocumentTranslationBlockIsSkippableInterruption(current)) {
    return {
      continuesPrevious: false,
      continuesNext: false,
      skippedBefore: 0,
      skippedAfter: 0,
    };
  }
  const previousIndex = pdfDocumentTranslationContextNeighborIndex(blocks, index, -1);
  const nextIndex = pdfDocumentTranslationContextNeighborIndex(blocks, index, 1);
  return {
    ...(previousIndex === undefined ? {} : { previousIndex }),
    ...(nextIndex === undefined ? {} : { nextIndex }),
    continuesPrevious: previousIndex === undefined
      ? false
      : pdfDocumentTranslationBlocksContinueSentence(blocks[previousIndex]!, current),
    continuesNext: nextIndex === undefined
      ? false
      : pdfDocumentTranslationBlocksContinueSentence(current, blocks[nextIndex]!),
    skippedBefore: previousIndex === undefined ? 0 : Math.max(0, index - previousIndex - 1),
    skippedAfter: nextIndex === undefined ? 0 : Math.max(0, nextIndex - index - 1),
  };
}

const CONTINUATION_TRAILING_WORD = /(?:\b(?:a|an|and|are|as|be|because|been|being|but|by|called|defined|denoted|dubbed|for|from|given|if|including|is|named|nor|of|or|such|than|that|the|termed|to|unless|using|via|was|were|when|where|which|while|who|whose|with)|[,;:([{=+\-\u2013\u2014/])\s*$/iu;
const LOWERCASE_CONTINUATION_START = /^\s*[\p{Ll}\p{M}]/u;

/**
 * Uses stronger evidence than the context-only continuity graph before
 * changing block identity. This avoids folding an unpunctuated paper title
 * into the following abstract while still joining lower-case continuations,
 * equations, and phrases such as "dubbed / ISTA-Net+".
 */
function pdfDocumentTranslationBlocksStronglyContinue(
  previous: PdfDocumentTranslationBlock,
  current: PdfDocumentTranslationBlock,
): boolean {
  if (!pdfDocumentTranslationBlocksContinueSentence(previous, current)) return false;
  const previousText = previous.text.trim();
  const currentText = current.text.trim();
  if (!currentText) return false;
  if (current.kind === 'formula') return true;
  if (LOWERCASE_CONTINUATION_START.test(currentText)) return true;
  if (/^[,.;:!?%)\]}\u201d\u2019]/u.test(currentText)) return true;
  if (previous.kind === 'formula') return false;
  if (CONTINUATION_TRAILING_WORD.test(previousText)) return true;
  return CJK_BOUNDARY.test(previousText.at(-1) ?? '') &&
    CJK_BOUNDARY.test(currentText[0] ?? '');
}

function joinPdfDocumentTranslationContinuationText(left: string, right: string): string {
  const leftText = left.trimEnd();
  const rightText = right.trimStart();
  if (!leftText) return rightText;
  if (!rightText) return leftText;
  const omitSpace =
    (CJK_BOUNDARY.test(leftText.at(-1) ?? '') && CJK_BOUNDARY.test(rightText[0] ?? '')) ||
    /^[,.;:!?%)\]}\u201d\u2019]/u.test(rightText) ||
    /[(\[{\u201c\u2018/]$/u.test(leftText);
  return `${leftText}${omitSpace ? '' : ' '}${rightText}`;
}

/**
 * Coalesces only high-confidence, same-page semantic continuations. Skipped
 * captions/tables/code remain independent blocks, while the prose on either
 * side is translated from tight, ordered image crops in one provider request.
 */
export function mergePdfDocumentTranslationContinuationBlocks(
  blocks: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  const removed = new Set<number>();
  const replacement = new Map<number, PdfDocumentTranslationBlock>();
  for (let index = 0; index < blocks.length; index += 1) {
    if (removed.has(index) || pdfDocumentTranslationBlockIsSkippableInterruption(blocks[index]!)) {
      continue;
    }
    const members = [index];
    let text = blocks[index]!.text;
    let cursor = index;
    let regions = coalesceAdjacentPdfDocumentTranslationSourceRegions(
      pdfDocumentTranslationSourceRegions(blocks[index]!),
    );
    if (!regions.length) continue;
    while (members.length < PDF_DOCUMENT_TRANSLATION_CONTINUATION_MEMBERS) {
      const continuity = pdfDocumentTranslationContinuity(blocks, cursor);
      const nextIndex = continuity.nextIndex;
      if (!continuity.continuesNext || nextIndex === undefined || nextIndex <= cursor) break;
      const previous = blocks[cursor]!;
      const next = blocks[nextIndex]!;
      const nextRegions = pdfDocumentTranslationSourceRegions(next);
      if (
        next.pageNumber !== blocks[index]!.pageNumber ||
        !nextRegions.length ||
        nextRegions.some((region) => region.pageNumber !== blocks[index]!.pageNumber) ||
        !pdfDocumentTranslationBlocksStronglyContinue(previous, next)
      ) break;
      const joined = joinPdfDocumentTranslationContinuationText(text, next.text);
      if (joined.length > PDF_DOCUMENT_TRANSLATION_CONTINUATION_LENGTH) break;
      const joinedRegions = coalesceAdjacentPdfDocumentTranslationSourceRegions([
        ...regions,
        ...nextRegions,
      ]);
      if (joinedRegions.length > PDF_DOCUMENT_TRANSLATION_CONTINUATION_REGIONS) break;
      text = joined;
      regions = joinedRegions;
      members.push(nextIndex);
      cursor = nextIndex;
    }
    if (members.length < 2) continue;
    const first = blocks[index]!;
    const sourceKinds = members.map((memberIndex) => blocks[memberIndex]!.kind ?? 'text');
    const kind = pdfDocumentTranslationBlockKind(text, sourceKinds);
    replacement.set(index, {
      id: first.id,
      pageNumber: first.pageNumber,
      blockIndex: first.blockIndex,
      text,
      ...(kind === 'text' ? {} : { kind }),
      sourceRegions: regions,
    });
    for (const memberIndex of members.slice(1)) removed.add(memberIndex);
  }
  const pageIndexes = new Map<number, number>();
  return blocks.flatMap((block, index) => {
    if (removed.has(index)) return [];
    const resolved = replacement.get(index) ?? block;
    const blockIndex = pageIndexes.get(resolved.pageNumber) ?? 0;
    pageIndexes.set(resolved.pageNumber, blockIndex + 1);
    return [{ ...resolved, blockIndex }];
  });
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
  const appendBand = (bandBottom: number): number => {
    const band = columns.filter((line) => line.top >= bandTop && line.top < bandBottom);
    const left = band.filter((line) => line.region === 'left').sort(sortTopLeft);
    const right = band.filter((line) => line.region === 'right').sort(sortTopLeft);
    if (left.length) left[0]!.breakBefore = output.length > 0;
    if (right.length) right[0]!.breakBefore = output.length > 0 || left.length > 0;
    output.push(...left, ...right);
    bandTop = bandBottom;
    return left.length + right.length;
  };
  for (const line of spanning) {
    const appendedColumns = appendBand(line.top - tolerance);
    const previous = output.at(-1);
    const continuesSpanningFlow = appendedColumns === 0 && previous?.region === 'spanning' &&
      line.top >= previous.top &&
      line.top - previous.bottom <= Math.max(previous.height, line.height) * 1.5;
    line.breakBefore = output.length > 0 && !continuesSpanningFlow;
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
      INLINE_SECTION_LEAD.test(current.text.trim()) ||
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
  // The block text may span far more than four visual lines. Cropping only the
  // first few lines makes the extracted-text hint disagree with the pixels the
  // vision model can see, which truncates long paragraphs and multiline
  // equations. Paragraph construction already separates columns and visual
  // flows, so every overlapping line belongs to this translation block.
  const anchoredLines = overlapping;
  const rawLeft = Math.min(...anchoredLines.map((entry) => entry.line.left));
  const rawTop = Math.min(...anchoredLines.map((entry) => entry.line.top));
  const rawRight = Math.max(...anchoredLines.map((entry) => entry.line.right));
  const rawBottom = Math.max(...anchoredLines.map((entry) => entry.line.bottom));
  const paddingX = Math.max(3, pageSize.width * 0.006);
  const defaultPaddingY = Math.max(2, pageSize.height * 0.004);
  const targetLines = new Set(anchoredLines);
  const targetRegions = new Set(anchoredLines.map((entry) => entry.line.region));
  const adjacentLines = layout.lines.filter((entry) => (
    !targetLines.has(entry) &&
    targetRegions.has(entry.line.region) &&
    entry.line.right > rawLeft &&
    entry.line.left < rawRight
  ));
  const previousBottom = Math.max(
    Number.NEGATIVE_INFINITY,
    ...adjacentLines
      .filter((entry) => entry.line.bottom <= rawTop)
      .map((entry) => entry.line.bottom),
  );
  const nextTop = Math.min(
    Number.POSITIVE_INFINITY,
    ...adjacentLines
      .filter((entry) => entry.line.top >= rawBottom)
      .map((entry) => entry.line.top),
  );
  const paddingTop = Number.isFinite(previousBottom)
    ? Math.min(defaultPaddingY, Math.max(0, (rawTop - previousBottom) / 2))
    : defaultPaddingY;
  const paddingBottom = Number.isFinite(nextTop)
    ? Math.min(defaultPaddingY, Math.max(0, (nextTop - rawBottom) / 2))
    : defaultPaddingY;
  const left = Math.max(0, rawLeft - paddingX);
  const top = Math.max(0, rawTop - paddingTop);
  const right = Math.min(
    pageSize.width,
    rawRight + paddingX,
  );
  const bottom = Math.min(
    pageSize.height,
    rawBottom + paddingBottom,
  );
  if (right <= left || bottom <= top) return undefined;
  return {
    leftRatio: left / pageSize.width,
    topRatio: top / pageSize.height,
    widthRatio: (right - left) / pageSize.width,
    heightRatio: (bottom - top) / pageSize.height,
  };
}

function layoutAlignedParagraphChunks(
  text: string,
  range: { start: number; end: number },
  layout: JoinedLayoutText,
): Array<{ text: string; start: number; end: number }> {
  const paragraph = text.slice(range.start, range.end).trim();
  if (!paragraph) return [];
  const paragraphOffset = text.indexOf(paragraph, range.start);
  const paragraphStart = Math.max(range.start, paragraphOffset);
  const paragraphEnd = paragraphStart + paragraph.length;
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  let cursor = paragraphStart;
  while (cursor < paragraphEnd) {
    const maximumEnd = Math.min(paragraphEnd, cursor + PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH);
    let chunkEnd = maximumEnd;
    if (maximumEnd < paragraphEnd) {
      const minimumEnd = cursor + Math.floor(PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH * 0.55);
      const lineBoundaries = layout.lines.filter((entry) => (
        entry.end > cursor && entry.end <= maximumEnd && entry.end <= paragraphEnd
      ));
      const preferredBoundaries = lineBoundaries.filter((entry) => entry.end >= minimumEnd);
      const sentenceBoundary = preferredBoundaries
        .filter((entry) => SENTENCE_END.test(entry.line.text.trim()))
        .at(-1);
      const containingLine = layout.lines.find((entry) => (
        entry.start < maximumEnd && entry.end > maximumEnd && entry.end <= paragraphEnd
      ));
      chunkEnd = (
        sentenceBoundary ??
        preferredBoundaries.at(-1) ??
        lineBoundaries.at(-1) ??
        containingLine
      )?.end ?? maximumEnd;
    }
    const rawChunk = text.slice(cursor, chunkEnd);
    const block = rawChunk.trim();
    if (block) {
      const leadingWhitespace = rawChunk.indexOf(block);
      const start = cursor + Math.max(0, leadingWhitespace);
      chunks.push({ text: block, start, end: start + block.length });
    }
    cursor = chunkEnd;
    while (cursor < paragraphEnd && /\s/u.test(text[cursor]!)) cursor += 1;
  }
  return chunks;
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
    if (layout) return layoutAlignedParagraphChunks(text, range, layout);
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
    const kind = pdfDocumentTranslationBlockKind(
      block,
      layout?.lines
        .filter((entry) => entry.end > start && entry.start < end)
        .flatMap((entry) => entry.line.kind ? [entry.line.kind] : []) ?? [],
    );
    return {
      id: `P${safePageNumber}B${blockIndex + 1}`,
      pageNumber: safePageNumber,
      blockIndex,
      text: block,
      ...(kind === 'text' ? {} : { kind }),
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
    blocks.push(...groupPdfDocumentTranslationVisualObjects(pageBlocks));
  }
  return {
    blocks: mergePdfDocumentTranslationContinuationBlocks(blocks),
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
