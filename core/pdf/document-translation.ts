import { buildPdfSearchPageIndex, type PdfSearchTextItem } from './search';
import { splitLongTranslationText } from '../translation/text-chunker';
import type { CoordinateOcrPage } from './ocr-text-layer';
import { shouldUseVisionForPdfFormula } from '../translation/formula-detection';
import type { SourceEquation } from '../translation/source-equations';
import { sourceEquationsForRegion } from './source-equations';
import type {PdfMathFontHint} from './math-font-evidence';
import {classifyPdfPaperBlocks,type PdfPaperRole} from './paper-metadata';

export type PdfDocumentTranslationBlockKind =
  'text' | 'formula' | 'code' | 'table' | 'figure' | 'footnote';

export interface PdfDocumentTranslationBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
  paperRole?: PdfPaperRole;
  /** Ordinary prose omits this field to keep existing session plans compact. */
  kind?: Exclude<PdfDocumentTranslationBlockKind, 'text'>;
  sourceAnchor?: PdfDocumentTranslationSourceAnchor;
  /**
   * A semantic block can continue through a layout break, figure, or full-width
   * interruption. In that case every tight source crop is retained in reading
   * order instead of replacing them with one large, ambiguous bounding box.
   */
  sourceRegions?: readonly PdfDocumentTranslationSourceRegion[];
  /** Local request plan; reading/export still own one continuous block. */
  visualUnits?: readonly PdfDocumentVisualUnit[];
  equationNumbers?: readonly string[];
  sourceEquations?: readonly SourceEquation[];
  sourceFontHints?: readonly PdfMathFontHint[];
}

export interface PdfDocumentVisualUnit {
  text: string;
  sourceRegions: PdfDocumentTranslationSourceRegion[];
  equationNumbers: string[];
  sourceEquations?: readonly SourceEquation[];
  sourceFontHints?: readonly PdfMathFontHint[];
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
  mathFont?: PdfMathFontHint;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** Glyph descent below the PDF baseline; does not affect row assignment. */
  descent?: number;
  /** Verified embedded TeX glyph ink, independent of a broken Unicode map. */
  leftBraceInkBounds?: { top: number; bottom: number };
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
    // The Qwen adapter marks every line containing '$' as formula for text selection.
    // That local heuristic must not turn a prose paragraph into one standalone equation.
    kind: page.source==='qwen-advanced-recognition'&&block.confidenceSource==='trusted-adapter'&&block.kind==='formula'&&
      (block.text.replace(/\$[^$]*\$/gu,' ').replace(/\\[A-Za-z]+/gu,' ').match(/\b[A-Za-z]{3,}\b/gu)?.length??0)>=4
      ? 'text' : block.kind,
  }));
}

interface VisualAtom {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
  inkBottom?: number;
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
  inkBottom?: number;
  structured: boolean;
  kind?: PdfDocumentTranslationBlockKind;
  region?: VisualLineRegion;
  breakBefore?: boolean;
  footnoteStart?: boolean;
  raisedFootnoteMarker?: boolean;
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
const PDF_DOCUMENT_FIGURE_FRAGMENT_MEMBERS = 96;
const PDF_DOCUMENT_FIGURE_MAX_HEIGHT_RATIO = .68;

const LATIN_OR_DIGIT_END = /[\p{L}\p{N}]$/u;
const LATIN_OR_DIGIT_START = /^[\p{L}\p{N}]/u;
const CJK_BOUNDARY = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
const EQUATION_NUMBER = /^(?:\(?\d{1,4}[a-z]?\)?|\[\d{1,4}\])$/iu;
const HIGH_CONFIDENCE_CODE_LINE = /^(?:[$>#]\s|(?:const|let|var)\s+[$\p{L}_][$\p{L}\p{N}_]*(?=\s*(?:[=:;]|$))|(?:function\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\([^)]*\)\s*\{|def\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\([^)]*\)\s*(?:->[^:]+)?\s*:|(?:function|def)\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\(\s*$)|class\s+[$\p{L}_][$\p{L}\p{N}_]*(?=\s*(?:[:{]|extends\b))|from\s+[\w.]+\s+import\s+|import\s+(?:[{*]|[\w.]+(?:\s*,\s*[\w.]+)*\s*$)|(?:return|if|for|while)\s*\(|\w+\s*(?:\([^)]*\))?\s*(?:=>|==|!=|<=|>=)|;\s*$)/u;
const CODE_LINE = /^(?:[$>#]\s|(?:const|let|var)\s+[$\p{L}_][$\p{L}\p{N}_]*(?=\s*(?:[=:;]|$))|(?:function\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\([^)]*\)\s*\{|def\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\([^)]*\)\s*(?:->[^:]+)?\s*:|(?:function|def)\s+[$\p{L}_][$\p{L}\p{N}_]*\s*\(\s*$)|class\s+[$\p{L}_][$\p{L}\p{N}_]*(?=\s*(?:[:{]|extends\b))|from\s+[\w.]+\s+import\s+|import\s+(?:[{*]|[\w.]+(?:\s*,\s*[\w.]+)*\s*$)|(?:return|if|for|while)\s*\(|\w+\s*(?:\([^)]*\))?\s*(?:=>|:=|==|!=|<=|>=)|;\s*$|\S+\s*=\s*\S+)/u;
const STANDALONE_MATH_DELIMITER = /^[{}[\]]+$/u;
const LIST_ITEM_LINE = /^(?:[-*\u2022\u2023\u25aa\u25e6\u2013\u2014]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+|[A-Za-z][.)]\s+|\([A-Za-z]\)\s+|\[\d{1,4}\]\s+)/u;
const BODY_LIST_ITEM_LINE = /^(?:[-*\u2022\u2023\u25aa\u25e6\u2013\u2014]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+)/u;
const INLINE_CITATION_WRAP_LINE = /^\[\d{1,4}\]\s+[\p{Ll}]/u;
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
const FIGURE_FRAGMENT_LABEL = /\b(?:accuracy|epoch|error|iteration|loss|method|model|number|phase|psnr|ratio|score|ssim|time|training|train|predict|observe|aggregate|observations|targets|data)\b|\bdb\b/iu;
const CAPTION_TRAILING_CONNECTOR = /(?:\b(?:at|by|for|from|in|of|on|to|with)|[,;:([{=+\-\u2013\u2014/])\s*$/iu;
const FOOTNOTE_LEAD = /^(?:\d{1,3}|[*†‡§¶])(?:\s+|(?=\p{L}))/u;
const INLINE_SECTION_LEAD = /^[\p{Lu}\d][^.!?。！？:：\t]{2,72}[:：]\s+\p{Lu}/u;
// Title-case run-in headings such as "Large-Scale Results. As mentioned...".
// Their period is a heading boundary, not a continuation from an earlier block.
const PERIOD_SECTION_LEAD = /^(?:[A-Z][a-z]+(?:-[A-Z][a-z]+)*\s+){1,5}[A-Z][a-z]+\.\s+[A-Z]/u;
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
      ...(item.descent && item.descent > 0 ? { inkBottom: Math.min(page.pageHeight, top + item.height! + item.descent) } : {}),
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
    const largerHeight = Math.max(previous.height, atom.height);
    const smallerHeight = Math.min(previous.height, atom.height);
    const centerOffset = Math.abs(
      (previous.top + previous.bottom) / 2 - (atom.top + atom.bottom) / 2,
    );
    const leadingFootnoteMarker = /^\d{1,3}$/u.test(output) && /^\p{L}/u.test(atom.text);
    const scriptAttachment =
      !leadingFootnoteMarker &&
      gap <= Math.max(1.5, smallerHeight * .14) &&
      smallerHeight <= largerHeight * .82 &&
      centerOffset >= largerHeight * .12;
    const omitSpace =
      /\s$/u.test(output) ||
      /^\s/u.test(atom.text) ||
      scriptAttachment ||
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
  const first = [...atoms].sort((a,b) => a.left-b.left)[0];
  const typicalHeight = median(atoms.map(atom => atom.height));
  const kind = atoms.some((atom) => atom.kind === 'formula')
    ? 'formula'
    : atoms.some((atom) => atom.kind === 'table')
      ? 'table'
      : atoms.some((atom) => atom.kind === 'code')
        ? 'code'
        : atoms.some((atom) => atom.kind === 'footnote')
          ? 'footnote'
          : undefined;
  return {
    text: joinAtoms(atoms),
    left: Math.min(...atoms.map((atom) => atom.left)),
    right: Math.max(...atoms.map((atom) => atom.right)),
    top: Math.min(...atoms.map((atom) => atom.top)),
    bottom: Math.max(...atoms.map((atom) => atom.bottom)),
    inkBottom: Math.max(...atoms.map((atom) => atom.inkBottom ?? atom.bottom)),
    height: median(atoms.map((atom) => atom.height)),
    structured,
    ...(first && /^(?:\d{1,3}|[*†‡§¶])$/u.test(first.text.trim()) &&
      first.height < typicalHeight * .8 ? {raisedFootnoteMarker: true} : {}),
    ...(kind ? { kind } : {}),
  };
}

function structuredLineFromChunks(chunks: readonly VisualAtom[][]): VisualLine {
  const cells = chunks.map((chunk) => lineFromAtoms(chunk));
  const text = cells.map((cell) => cell.text).join('\t');
  const proseEquationRow = chunksLookLikeProse(chunks) && /[=≈≠≤≥]/u.test(text);
  const numberedMathTail = EQUATION_NUMBER.test(cells.at(-1)!.text) &&
    /^[+−-]/u.test(text.trim()) && /(?:\bln\b|\blog\b|∑|∫)/u.test(text) &&
    !/[A-Za-z]{4,}/u.test(text);
  const fragmentedEquationRow = cells.length >= 2 &&
    cells.every((cell) => cell.text.length <= 14) &&
    (cells.every((cell) => !/[A-Za-z]{2,}/u.test(cell.text)) ||
      (EQUATION_NUMBER.test(cells.at(-1)!.text) && /[⊤¯√]/u.test(text) &&
        cells.every((cell) => !/[A-Za-z]{4,}/u.test(cell.text)))) &&
    cells.some((cell) => (
      /[\d=+\-−*/×÷^_<>≤≥≈≠⊤¯Α-Ωα-ω]/u.test(cell.text) ||
      /^[()~]*[A-Za-z][()~]*$/u.test(cell.text.trim())
    ));
  return {
    text,
    left: cells[0]!.left,
    right: cells.at(-1)!.right,
    top: Math.min(...cells.map((cell) => cell.top)),
    bottom: Math.max(...cells.map((cell) => cell.bottom)),
    inkBottom: Math.max(...cells.map((cell) => cell.inkBottom ?? cell.bottom)),
    height: median(cells.map((cell) => cell.height)),
    structured: true,
    kind: proseEquationRow || numberedMathTail || fragmentedEquationRow || looksStandalonePdfEquation(text) ||
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
  const typicalHeight = median(atoms.filter((atom) => /\p{L}{4,}/u.test(atom.text)).map((atom) => atom.height)) ||
    median(atoms.map((atom) => atom.height));
  const scripts = atoms.filter((atom) => atom.height < typicalHeight * .82);
  const scriptSet = new Set(scripts);
  const ordered = atoms.filter((atom) => !scriptSet.has(atom))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const rows: VisualAtom[][] = [];
  for (const atom of ordered) {
    let closest: VisualAtom[] | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows.slice(-4)) {
      // PDF.js often emits inline superscripts before the surrounding baseline
      // atoms and subscripts after them. Comparing only with row[0] makes the
      // superscript the row reference, so the later subscript becomes a fake
      // visual line and splits the prose crop. The normal baseline atom can
      // safely bridge both pieces of the same inline expression.
      const laneReferences = row.filter((reference) => !provisionalDivider ||
        (atom.right <= provisionalDivider ? reference.left < provisionalDivider :
          atom.left >= provisionalDivider ? reference.right > provisionalDivider : true));
      if (!laneReferences.length) continue;
      const dominantHeight = Math.max(...laneReferences.map((reference) => reference.height));
      const baselineReferences = laneReferences.filter((reference) => (
        reference.height >= dominantHeight * .85
      ));
      const horizontalTolerance = Math.max(8, dominantHeight * 1.5);
      const localReferences = baselineReferences.filter((reference) => {
        const horizontalGap = Math.max(
          0,
          reference.left - atom.right,
          atom.left - reference.right,
        );
        return horizontalGap <= horizontalTolerance;
      });
      // Prefer the candidate's own column once the row contains atoms from
      // both columns. Falling back is needed when a superscript is emitted
      // before the first baseline atom and is horizontally farther away.
      const references = localReferences.length ? localReferences : baselineReferences;
      const matchingDistances = references.flatMap((reference) => {
        if (!sameVisualRow(reference, atom)) return [];
        return [Math.abs(
          (reference.top + reference.bottom) / 2 - (atom.top + atom.bottom) / 2,
        )];
      });
      if (!matchingDistances.length) continue;
      const distance = Math.min(...matchingDistances);
      if (distance < closestDistance) {
        closest = row;
        closestDistance = distance;
      }
    }
    if (closest) closest.push(atom);
    else rows.push([atom]);
  }

  // Establish prose/formula baselines before attaching small glyphs. A root
  // above a superscript must follow its radicand, not the preceding text line.
  const owner = new Map(rows.flatMap((row) => row.map((atom) => [atom, row] as const)));
  const pending = [...scripts].sort((a, b) =>
    Number(a.text === '√') - Number(b.text === '√') || b.height - a.height || a.top - b.top);
  for (const atom of pending) {
    let target: VisualAtom[] | undefined;
    if (atom.text === '√') {
      const radicand = atoms.filter((candidate) => candidate !== atom && owner.has(candidate) &&
        Math.abs(candidate.left - atom.right) <= Math.max(2, atom.height * .45) &&
        candidate.top >= atom.top && candidate.top - atom.top <= atom.height * 1.4)
        .sort((a, b) => Math.abs(a.left - atom.right) - Math.abs(b.left - atom.right) || a.top - b.top)[0];
      if (radicand) target = owner.get(radicand);
    }
    if (!target) {
      const operator = ordered.find((candidate) => /arg\s*(?:min|max)/u.test(candidate.text) &&
        atom.left >= candidate.left && atom.right <= candidate.right + 2 &&
        atom.top >= candidate.top + candidate.height * .5 &&
        atom.top - candidate.bottom <= candidate.height * .65);
      if (operator) target = owner.get(operator);
    }
    if (!target) {
      let closestDistance = Infinity;
      for (const row of rows) {
        for (const reference of row) {
          if (provisionalDivider && (
            atom.right <= provisionalDivider && reference.left >= provisionalDivider ||
            atom.left >= provisionalDivider && reference.right <= provisionalDivider
          )) continue;
          const gap = Math.max(0, reference.left - atom.right, atom.left - reference.right);
          const scale = Math.max(reference.height, atom.height);
          const distance = Math.abs((reference.top + reference.bottom - atom.top - atom.bottom) / 2);
          if (gap > Math.max(16, typicalHeight * 6) || distance > scale * .95) continue;
          const score = distance + gap * .04;
          if (score < closestDistance) { closestDistance = score; target = row; }
        }
      }
    }
    if (!target) { target = []; rows.push(target); }
    target.push(atom);
    owner.set(atom, target);
  }
  rows.sort((a, b) => Math.min(...a.map((atom) => atom.top)) - Math.min(...b.map((atom) => atom.top)));

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
      if (EQUATION_NUMBER.test(second.text) && (
        looksMathDominant(first.text) || looksStandalonePdfEquation(first.text)
      )) {
        output.push({
          ...first,
          text: `${first.text}\t${second.text}`,
          right: second.right,
          bottom: Math.max(first.bottom, second.bottom),
          inkBottom: Math.max(first.inkBottom ?? first.bottom, second.inkBottom ?? second.bottom),
          structured: true,
          kind: 'formula',
        });
        continue;
      }
    }
    output.push(...chunks.map((chunk) => lineFromAtoms(chunk)));
  }
  return markPdfDocumentTranslationFootnoteLines(
    joinOverlappingPdfMathLines(output.filter((line) => line.text), provisionalDivider),
    page.pageHeight,
  );
}

function joinOverlappingPdfMathLines(lines: VisualLine[], divider: number | undefined): VisualLine[] {
  const isMath = (line: VisualLine): boolean => line.kind !== 'table' && line.kind !== 'code' && (
    line.kind === 'formula' || looksStandalonePdfEquation(line.text) || looksMathDominant(line.text) ||
    (line.text.length <= 32 && !/\p{L}{4,}/u.test(line.text) &&
      /^[\p{L}\p{N}\s\p{P}\p{S}]+$/u.test(line.text))
  );
  const output: VisualLine[] = [];
  for (const line of [...lines].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const detachedLabel = EQUATION_NUMBER.test(line.text.trim());
    const previous = isMath(line) ? output.findLast((candidate) => isMath(candidate) &&
      (candidate.kind === 'formula' || line.kind === 'formula' ||
        looksStandalonePdfEquation(candidate.text) || looksStandalonePdfEquation(line.text)) &&
      Math.min(candidate.bottom, line.bottom) - Math.max(candidate.top, line.top) >
        (EQUATION_NUMBER.test(line.text) || EQUATION_NUMBER.test(candidate.text)
          ? -Math.min(candidate.height, line.height) * (detachedLabel && /[=≈≤≥]/u.test(candidate.text) ? 1.5 : .35) : .5) &&
      (!detachedLabel || line.left >= candidate.left + (candidate.right - candidate.left) * .65) &&
      (!detachedLabel || !output.some(intervening => intervening !== candidate &&
        !isMath(intervening) && intervening.top >= candidate.bottom && intervening.bottom <= line.top &&
        intervening.right > candidate.left && intervening.left < candidate.right)) &&
      (!divider || candidate.right <= divider && line.right <= divider ||
        candidate.left >= divider && line.left >= divider) &&
      Math.max(candidate.left - line.right, line.left - candidate.right) < 72) : undefined;
    if (!previous) { output.push(line); continue; }
    previous.text += ` ${line.text}`;
    previous.left = Math.min(previous.left, line.left);
    previous.right = Math.max(previous.right, line.right);
    previous.top = Math.min(previous.top, line.top);
    previous.bottom = Math.max(previous.bottom, line.bottom);
    previous.inkBottom = Math.max(previous.inkBottom ?? previous.bottom, line.inkBottom ?? line.bottom);
    previous.height = Math.max(previous.height, line.height);
    previous.kind = 'formula';
    previous.structured = true;
  }
  return output;
}

function pdfDocumentTranslationLinesShareLane(left: VisualLine, right: VisualLine): boolean {
  const overlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const minimumWidth = Math.min(left.right - left.left, right.right - right.left);
  return minimumWidth > 0 && overlap >= minimumWidth * .55;
}

/**
 * Marks high-confidence page-bottom footnotes before paragraph construction.
 * A numeric marker alone is not sufficient: the line must also be materially
 * smaller than the page body, and wrapped lines must remain in the same lane.
 */
function markPdfDocumentTranslationFootnoteLines(
  lines: VisualLine[],
  pageHeight: number,
): VisualLine[] {
  if (!(pageHeight > 0)) return lines;
  const bodyHeights = lines.filter((line) => (
    !line.structured &&
    line.top >= pageHeight * .08 &&
    line.bottom <= pageHeight * .82 &&
    /\p{L}/u.test(line.text)
  )).map((line) => line.height);
  const typicalHeight = median(bodyHeights) || median(lines.map((line) => line.height));
  if (!(typicalHeight > 0)) return lines;
  const maximumFootnoteHeight = typicalHeight * .88;
  const maximumBottom = pageHeight * .93;
  const footnoteProse = (line: VisualLine) => !line.structured ||
    ((line.text.match(/\p{L}{3,}/gu)?.length ?? 0) >= 6 && !looksStandalonePdfEquation(line.text));
  const starts = lines.filter((line) => (
    footnoteProse(line) &&
    line.top >= pageHeight * .72 &&
    line.bottom <= maximumBottom &&
    (line.height <= maximumFootnoteHeight || line.raisedFootnoteMarker ||
      /^Proceedings of the\b/iu.test(line.text.trim()) && line.height <= typicalHeight * .94) &&
    (FOOTNOTE_LEAD.test(line.text.trim()) || /^Proceedings of the\b/iu.test(line.text.trim()))
  ));
  for (const start of starts) {
    start.kind = 'footnote';
    start.footnoteStart = true;
    let previous = start;
    for (const candidate of lines) {
      if (
        candidate === start || candidate.top <= previous.top ||
        candidate.bottom > maximumBottom ||
        !pdfDocumentTranslationLinesShareLane(start, candidate)
      ) continue;
      const verticalGap = candidate.top - previous.bottom;
      if (verticalGap > Math.max(5, typicalHeight * .8)) break;
      if (!footnoteProse(candidate) || candidate.height > typicalHeight * .94) break;
      candidate.kind = 'footnote';
      if (FOOTNOTE_LEAD.test(candidate.text.trim())) candidate.footnoteStart = true;
      previous = candidate;
    }
  }
  return lines;
}

function looksMathDominant(text: string): boolean {
  const operators = text.match(/[=+*/^_<>{}\u00b1\u00d7\u2212\u2211\u220f\u222b\u221a\u2260\u2248\u2264\u2265]/gu)?.length ?? 0;
  const mathGlyphs = text.match(/[\u2070-\u209f\u2100-\u214f\u2190-\u22ff\u25a0-\u25ff\u{1d400}-\u{1d7ff}]/gu)?.length ?? 0;
  if (operators + mathGlyphs < 2) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters <= Math.max(12, (operators + mathGlyphs) * 4);
}

/** Function names and a right-aligned equation number are not table columns or code. */
function looksStandalonePdfEquation(text: string): boolean {
  if (HIGH_CONFIDENCE_CODE_LINE.test(text.trim())) return false;
  const body = text.replace(/\s*\(?\d{1,4}[a-z]?\)?\s*$/iu, '');
  if (!/[=≈≠≤≥]/u.test(body)) return false;
  const withoutFunctions = body
    .replace(/\b[A-Za-z][A-Za-z-]*\s*(?=\()/gu, '')
    .replace(/\b(?:[A-Z][a-z]?){2,}\b/gu, '')
    .replace(/\barg\s*(?:min|max)(?=[A-Z_\s{]|$)/gu, '')
    .replace(/\b(?:arg|min|max|log|exp|softmax|Concat|Sigmoid|ReLU|GAP)\b/giu, '');
  return !/\p{L}{3,}/u.test(withoutFunctions);
}

function looksPdfCode(text: string): boolean {
  if (HIGH_CONFIDENCE_CODE_LINE.test(text)) return true;
  // An assignment at the beginning of an academic sentence is not code.
  return CODE_LINE.test(text) && !looksStandalonePdfEquation(text) &&
    !/(?:\p{L}{2,}[\s,-]+){3,}/u.test(text);
}

function looksProtectedStructure(text: string): boolean {
  return text.includes('\t') || looksMathDominant(text) ||
    looksStandalonePdfEquation(text) || looksPdfCode(text.trim()) ||
    STANDALONE_MATH_DELIMITER.test(text.trim());
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
  if (sourceKinds.includes('footnote')) return 'footnote';
  if (sourceKinds.includes('formula')) return 'formula';
  if (sourceKinds.includes('table')) return 'table';
  if (STANDALONE_MATH_DELIMITER.test(trimmed)) return 'formula';
  if (sourceKinds.includes('code') || HIGH_CONFIDENCE_CODE_LINE.test(trimmed)) return 'code';
  const withoutEquationNumber = trimmed.replace(
    /\s*\t\s*(?:\(?\d{1,4}[a-z]?\)?|\[\d{1,4}\])\s*$/iu,
    '',
  );
  if (
    looksMathDominant(withoutEquationNumber) || looksStandalonePdfEquation(withoutEquationNumber) ||
    (
      withoutEquationNumber.length <= 280 &&
      !SENTENCE_END.test(withoutEquationNumber) &&
      shouldUseVisionForPdfFormula(withoutEquationNumber)
    )
  ) return 'formula';
  if (looksPdfCode(trimmed)) return 'code';
  if (trimmed.includes('\t')) return 'table';
  return 'text';
}

export function pdfDocumentTranslationBlockContainsFormula(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind' | 'sourceFontHints'>,
): boolean {
  return block.kind === 'formula' || shouldUseVisionForPdfFormula(block.text)||Boolean(block.sourceFontHints?.some(h=>h.variant==='script'||h.variant==='double-struck'));
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
  barriers: readonly PdfDocumentTranslationSourceRegion[] = [],
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
    // A skipped figure/table/code block still owns its pixels. Never turn the
    // crops on either side into one rectangle that submits that object twice.
    if (barriers.some(({ pageNumber, sourceAnchor: anchor }) => (
      pageNumber === region.pageNumber &&
      Math.min(mergedRight, anchor.leftRatio + anchor.widthRatio) >
        Math.max(mergedLeft, anchor.leftRatio) + .00001 &&
      Math.min(mergedBottom, anchor.topRatio + anchor.heightRatio) >
        Math.max(mergedTop, anchor.topRatio) + .00001
    ))) {
      output.push({ pageNumber: region.pageNumber, sourceAnchor: { ...region.sourceAnchor } });
      continue;
    }
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
  const prefix = text.slice(0, captionStart).replace(/\s+/gu, ' ').trim();
  const prefixDigits = prefix.match(/[\d.,%+−-]/gu)?.length ?? 0;
  const prefixLetters = prefix.match(/\p{L}/gu)?.length ?? 0;
  const numericFragment = prefixDigits >= 3 && prefixLetters <= 4;
  // A PDF paragraph can legitimately mention "Figure 2." in the middle of a
  // sentence. Only tolerate content before a caption label when it looks like
  // compact chart metadata that was joined to the caption by the text layer.
  // This keeps full-width captions as objects without turning the column prose
  // below them into duplicate figure objects.
  if (
    prefix && (
      prefix.length > 120 || SENTENCE_END.test(prefix) ||
      (!prefix.includes('\t') && !numericFragment && !FIGURE_FRAGMENT_LABEL.test(prefix))
    )
  ) return undefined;
  return text.slice(captionStart).replace(/\s+/gu, ' ').trim() || undefined;
}

function pdfDocumentTranslationLooksFigureFragment(
  block: PdfDocumentTranslationBlock,
): boolean {
  if (
    !pdfDocumentTranslationSourceRegions(block).length ||
    pdfDocumentTranslationSourceRegions(block).some(region => region.pageNumber !== block.pageNumber) ||
    block.kind === 'code' || block.kind === 'figure' ||
    block.kind === 'footnote'
  ) return false;
  const text = block.text.replace(/\s+/gu, ' ').trim();
  const packedPlotLabels = text.length <= 520 && /\b(?:nats|Architecture|Flow length)\b/u.test(text) &&
    (text.match(/[\d●]/gu)?.length ?? 0) >= 8 && !/[a-z]{6,}/u.test(text);
  if (!text || text.length > 120 && !packedPlotLabels || FIGURE_CAPTION.test(text) || TABLE_CAPTION.test(text)) {
    return false;
  }
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}+−'’_-]*/gu) ?? [];
  if (SENTENCE_END.test(text) && words.length > 6) return false;
  // Repeated panel settings are chart labels, not a sequence of equations.
  if (/^(?:[A-Za-z]\s*=\s*\d+\s*){2,}$/u.test(text) || repeatedPdfPlotSettings(text)) return true;
  // Numbered display equations sit near prose just like plots do. Never absorb
  // an equation into a chart merely because a figure caption follows it.
  if (block.kind === 'formula' && /(?:=|≤|≥|≈|\barg\s*min\b|\barg\s*max\b)/iu.test(text)) {
    return false;
  }
  const numericCharacters = text.match(/[\d.,%+−-]/gu)?.length ?? 0;
  const numericTokens = text.split(/\s+/u).filter(Boolean);
  const numericSequence = numericTokens.length >= 3 && numericTokens.every((token) => (
    /^[+−-]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:e[+−-]?\d+)?%?$/iu.test(token)
  ));
  const axisOrLegend = FIGURE_FRAGMENT_LABEL.test(text) ||
    (words.length <= 8 && /\b(?:flow length|variational bound|architecture|KL-divergences?|planar|radial|unit Gaussian|uniform)\b/iu.test(text));
  const compactPlotCodes=/^(?:[A-Z]{1,4}(?:\s+(?:[A-Z]{1,4}|[+−-]?\d+(?:\.\d+)?))*|[●•○□◯]|\([a-z]\)\s*.+)$/u.test(text)||/^([a-z])(?:\s+\1)+$/u.test(text);
  return block.kind === 'table' || block.kind === 'formula' || axisOrLegend || packedPlotLabels || compactPlotCodes || numericSequence ||
    (text.length <= 28 && numericCharacters >= Math.max(1, text.length * .28));
}

function repeatedPdfPlotSettings(text:string):boolean{
  return (text.match(/\bK\s*=\s*\d+/gu)?.length??0)>=3 &&
    /^(?:q\d+\s*)?(?:(?:Planar|Radial)\s*|K\s*=\s*\d+\s*)+$/u.test(text.replace(/\s+/gu,' ').trim());
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

function pdfDocumentTranslationFigureUpperBoundary(
  blocks: readonly PdfDocumentTranslationBlock[],
  captionIndex: number,
  captionBounds: PdfDocumentTranslationAnchorBounds,
): number | undefined {
  const caption = blocks[captionIndex]!;
  for (let candidateIndex = captionIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = blocks[candidateIndex]!;
    if (candidate.pageNumber !== caption.pageNumber) break;
    const bounds = pdfDocumentTranslationBlockBounds(candidate);
    if (
      !bounds || bounds.bottom > captionBounds.top + .01 ||
      !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds)
    ) continue;
    if (pdfDocumentTranslationLooksFigureFragment(candidate)) continue;
    return Math.min(captionBounds.top, bounds.bottom + .008);
  }
  return undefined;
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
    const captionMembers = [caption];
    let completeCaption = captionText;
    let captionCursor = captionIndex + 1;
    let previousCaptionBounds = captionBounds;
    while (
      !SENTENCE_END.test(completeCaption) && captionCursor < output.length &&
      captionMembers.length < 4
    ) {
      const candidate = output[captionCursor]!;
      const bounds = pdfDocumentTranslationBlockBounds(candidate);
      const candidateText = candidate.text.replace(/\s+/gu, ' ').trim();
      const structuredCaptionContinuation =
        (candidate.kind === 'formula' || candidate.kind === 'code') &&
        candidateText.length <= 120 && (CAPTION_TRAILING_CONNECTOR.test(completeCaption) ||
          /^(?:at|with|under|for)\s/iu.test(candidateText));
      if (
        candidate.pageNumber !== caption.pageNumber ||
        (candidate.kind && !structuredCaptionContinuation) || !bounds ||
        CAPTION_BLOCK.test(candidateText) || SECTION_HEADING_LINE.test(candidateText) ||
        candidateText.length > 260 ||
        !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds) ||
        bounds.top - previousCaptionBounds.bottom > .035
      ) break;
      captionMembers.push(candidate);
      completeCaption = joinPdfDocumentTranslationContinuationText(
        completeCaption,
        candidateText,
      );
      previousCaptionBounds = bounds;
      captionCursor += 1;
    }
    const members: number[] = [];
    let nextTop = captionBounds.top;
    let structuredEvidence = 0;
    let numericEvidence = 0;
    for (
      let candidateIndex = captionIndex - 1;
      candidateIndex >= 0 && members.length < PDF_DOCUMENT_FIGURE_FRAGMENT_MEMBERS;
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
        captionBounds.bottom - bounds.top > PDF_DOCUMENT_FIGURE_MAX_HEIGHT_RATIO
      ) break;
      members.unshift(candidateIndex);
      nextTop = Math.min(nextTop, bounds.top);
      if (candidate.kind === 'formula' || candidate.kind === 'table') structuredEvidence += 1;
      if (/\d/u.test(candidate.text)) numericEvidence += 1;
    }
    const hasFragmentEvidence = members.length >= 3 && structuredEvidence >= 2 &&
      (numericEvidence >= 1 || structuredEvidence >= 4) ||
      members.some(index=>repeatedPdfPlotSettings(output[index]!.text));
    if (hasFragmentEvidence) {
      const firstIndex = members[0]!;
      const grouped = [
        ...members.map((index) => output[index]!),
        ...captionMembers,
      ];
      const sourceAnchor = pdfDocumentTranslationUnionAnchor(grouped, {
        x: .012,
        top: .012,
        bottom: .006,
      });
      if (!sourceAnchor) continue;
      output.splice(firstIndex, captionCursor - firstIndex, {
        id: output[firstIndex]!.id,
        pageNumber: caption.pageNumber,
        blockIndex: output[firstIndex]!.blockIndex,
        text: completeCaption,
        kind: 'figure',
        sourceAnchor,
      });
      captionIndex = firstIndex;
      continue;
    }

    // Existing figure crops may gain proven adjacent labels, but must not be
    // heuristically extended again on each consolidation pass.
    if(caption.kind==='figure')continue;
    // Raster figures and diagrams often contribute no text-layer atoms at all.
    // Keep the explicit caption plus its wrapped continuation as one object and
    // conservatively extend the crop upward to include the visual it describes.
    const sourceAnchor = pdfDocumentTranslationUnionAnchor(captionMembers, {
      x: .012,
      top: .006,
      bottom: .006,
    });
    if (!sourceAnchor) continue;
    const precedingContentBoundary = pdfDocumentTranslationFigureUpperBoundary(
      output,
      captionIndex,
      captionBounds,
    );
    const inferredVisualHeight = Math.min(
      PDF_DOCUMENT_FIGURE_MAX_HEIGHT_RATIO,
      Math.max(.18, sourceAnchor.widthRatio * (sourceAnchor.widthRatio < .65 ? .5 : .45)),
    );
    const inferredTop = precedingContentBoundary ??
      Math.max(0, sourceAnchor.topRatio - inferredVisualHeight);
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

function pdfDocumentTranslationBoundsContainFragment(
  outer: PdfDocumentTranslationAnchorBounds,
  inner: PdfDocumentTranslationAnchorBounds,
): boolean {
  const intersectionWidth = Math.max(
    0,
    Math.min(outer.right, inner.right) - Math.max(outer.left, inner.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(outer.bottom, inner.bottom) - Math.max(outer.top, inner.top),
  );
  const innerArea = Math.max(0, inner.right - inner.left) * Math.max(0, inner.bottom - inner.top);
  return innerArea > 0 && intersectionWidth * intersectionHeight >= innerArea * .88;
}

/**
 * A vector chart can expose its axes, ticks, legends, and isolated caption
 * subscripts in PDF reading order before or after its caption. Once the whole
 * figure crop is known, suppress only high-confidence figure fragments that
 * are geometrically contained by that crop. The caption remains the single
 * translatable object; nearby prose, equations, and following tables remain
 * independent.
 */
function removePdfDocumentTranslationFigureInteriorFragments(
  input: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationBlock[] {
  const figures = input.flatMap((block) => {
    if (block.kind !== 'figure') return [];
    const bounds = pdfDocumentTranslationBlockBounds(block);
    return bounds ? [{ pageNumber: block.pageNumber, bounds }] : [];
  });
  if (!figures.length) return [...input];
  return input.filter((block) => {
    if (block.kind === 'figure' || !pdfDocumentTranslationLooksFigureFragment(block)) return true;
    const bounds = pdfDocumentTranslationBlockBounds(block);
    if (!bounds) return true;
    return !figures.some((figure) => (
      figure.pageNumber === block.pageNumber &&
      pdfDocumentTranslationBoundsContainFragment(figure.bounds, bounds)
    ));
  });
}

/** A numeric result grid can have its explicit table caption below it. Require
 * both that caption and local geometry so a matrix never becomes a table. */
function groupPdfDocumentTranslationTrailingTables(input: readonly PdfDocumentTranslationBlock[]): PdfDocumentTranslationBlock[] {
  const output: PdfDocumentTranslationBlock[] = [];
  for (let index = 0; index < input.length; index++) {
    const grid = input[index]!, caption = input[index + 1];
    const bounds = pdfDocumentTranslationBlockBounds(grid), captionBounds = caption && pdfDocumentTranslationBlockBounds(caption);
    const numericCells = grid.text.match(/(?<![\p{L}\d])[+-]?\d+(?:\.\d+)?(?![\p{L}\d])/gu)?.length ?? 0;
    if (grid.kind === 'formula' && grid.text.includes('\t') && numericCells >= 6 &&
        (grid.text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 3 && !/[=≈≤≥∈∑∫]/u.test(grid.text) &&
        caption && TABLE_CAPTION.test(caption.text.trim()) && caption.pageNumber === grid.pageNumber &&
        bounds && captionBounds && captionBounds.top >= bounds.bottom - .005 &&
        captionBounds.top - bounds.bottom <= .05 && pdfDocumentTranslationBoundsShareLane(bounds, captionBounds)) {
      const sourceAnchor = pdfDocumentTranslationTableAnchor([grid, caption], input);
      if (!sourceAnchor) {output.push(grid); continue;}
      const {sourceRegions: _regions, sourceAnchor: _anchor, ...base} = grid;
      output.push({...base, kind:'table', text:`${caption.text}\n${grid.text}`, sourceAnchor});
      index++;
    } else output.push(grid);
  }
  return output;
}

/** Resolve a bottom-captioned table before prose continuation can join its
 * final model label to the paragraph below. An explicit caption, one lane,
 * short adjacent rows and multiple numeric cells must all agree. */
function groupPdfDocumentTranslationBottomCaptionTables(input: readonly PdfDocumentTranslationBlock[]): PdfDocumentTranslationBlock[] {
  const output = [...input];
  for (let index = 0; index < output.length; index++) {
    const caption = output[index]!, bounds = pdfDocumentTranslationBlockBounds(caption);
    if (!TABLE_CAPTION.test(caption.text.trim()) || !bounds || caption.kind === 'table') continue;
    const members: PdfDocumentTranslationBlock[] = [];
    let nextTop = bounds.top;
    for (let previous = index - 1; previous >= 0; previous--) {
      const candidate = output[previous]!, row = pdfDocumentTranslationBlockBounds(candidate);
      const text = candidate.text.trim();
      if (candidate.pageNumber !== caption.pageNumber || !row || text.length > 180 ||
          candidate.kind === 'figure' || candidate.kind === 'footnote' || candidate.kind === 'code' ||
          SENTENCE_END.test(text) || CAPTION_BLOCK.test(text) || SECTION_HEADING_LINE.test(text) ||
          /[=≈≤≥∈∑∫]/u.test(text) || !pdfDocumentTranslationBoundsShareLane(row, bounds) ||
          row.bottom > bounds.top + .01 || nextTop - row.bottom > .04 || bounds.bottom - row.top > .3 ||
          (text.match(/\p{L}{4,}/gu)?.length ?? 0) > 8) break;
      members.unshift(candidate);nextTop = Math.min(nextTop, row.top);
    }
    const numericCells = members.reduce((sum,member)=>sum+(member.text.match(/(?<![\p{L}\d])\d+(?:\.\d+)?%?(?![\p{L}\d])/gu)?.length??0),0);
    const start = index-members.length, preceding = output[start-1];
    const precedingBounds = preceding && pdfDocumentTranslationBlockBounds(preceding);
    const firstBounds = members[0] && pdfDocumentTranslationBlockBounds(members[0]);
    // Rows immediately below an earlier table caption are already owned by
    // that table; the next caption must not steal them as preceding rows.
    if (preceding && preceding.pageNumber===caption.pageNumber && TABLE_CAPTION.test(preceding.text.trim()) &&
        precedingBounds && firstBounds && pdfDocumentTranslationBoundsShareLane(precedingBounds,firstBounds) &&
        firstBounds.top-precedingBounds.bottom<=.05) continue;
    const singleGrid = members.length === 1 && (() => {
      const row=pdfDocumentTranslationBlockBounds(members[0]!);
      return row && row.bottom-row.top >= .045;
    })();
    if ((!singleGrid && members.length < 2) || numericCells < 6) continue;
    const sourceAnchor = pdfDocumentTranslationTableAnchor([...members,caption],output);
    if (!sourceAnchor) continue;
    const first=members[0]!;
    output.splice(start,members.length+1,{id:first.id,pageNumber:caption.pageNumber,blockIndex:first.blockIndex,
      kind:'table',text:[caption.text,...members.map(member=>member.text)].join('\n'),sourceAnchor});
    index=start;
  }
  return output;
}

function pdfDocumentTranslationTableHeading(block: PdfDocumentTranslationBlock): boolean {
  if (block.kind || block.text.includes('\t')) return false;
  const text = block.text.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 160 || HEADING_SENTENCE_END.test(text)) return false;
  if (SECTION_HEADING_LINE.test(text)) {
    // A section number is not a data value. Counting "5." in the short title
    // "5. Conclusion" made it look more numeric than an ordinary table row.
    const title = text.replace(/^(?:\d+(?:\.\d+){0,4}|[IVXLC]+)\.?\s+/u, '');
    const digits = title.match(/[\d.%+−-]/gu)?.length ?? 0;
    return digits / Math.max(1, title.length) < .08;
  }
  const normalized = text.replace(/\s*[:：]\s*$/u, '').toLocaleLowerCase('en-US');
  // These also occur as compact column labels, without a section number.
  return KNOWN_SECTION_HEADINGS.has(normalized) && !['method', 'methods', 'results'].includes(normalized);
}

function pdfDocumentTranslationTableAnchor(
  members: readonly PdfDocumentTranslationBlock[],
  neighbors: readonly PdfDocumentTranslationBlock[],
): PdfDocumentTranslationSourceAnchor | undefined {
  const raw = pdfDocumentTranslationUnionAnchor(members, { x: 0, top: 0, bottom: 0 });
  const padded = pdfDocumentTranslationUnionAnchor(members, { x: .008, top: .006, bottom: .006 });
  if (!raw || !padded) return padded;
  let top = padded.topRatio;
  let bottom = padded.topRatio + padded.heightRatio;
  const rawBottom = raw.topRatio + raw.heightRatio;
  // Line anchors already stop at neighboring ink. Whole-table padding must not
  // undo that protection and include the previous row or next section/caption.
  for (const neighbor of neighbors) {
    if (members.includes(neighbor) || neighbor.pageNumber !== members[0]!.pageNumber) continue;
    const bounds = pdfDocumentTranslationBlockBounds(neighbor);
    if (!bounds || !pdfDocumentTranslationBoundsShareLane(bounds, {
      left: raw.leftRatio, right: raw.leftRatio + raw.widthRatio, top: raw.topRatio, bottom: rawBottom,
    })) continue;
    if (bounds.bottom <= raw.topRatio + .000001) top = Math.max(top, (bounds.bottom + raw.topRatio) / 2);
    if (bounds.top >= rawBottom - .000001) bottom = Math.min(bottom, (bounds.top + rawBottom) / 2);
  }
  return { ...padded, topRatio: top, heightRatio: bottom - top };
}

function groupPdfDocumentTranslationTables(
  input: readonly PdfDocumentTranslationBlock[],
  captionedOnly = false,
): PdfDocumentTranslationBlock[] {
  const output: PdfDocumentTranslationBlock[] = [];
  for (let index = 0; index < input.length;) {
    const first = input[index]!;
    const captionText = pdfDocumentTranslationCaptionText(first.text, TABLE_CAPTION);
    if (captionText) {
      const captionBounds = pdfDocumentTranslationBlockBounds(first);
      const captionMembers = [first];
      let completeCaption = captionText;
      let cursor = index + 1;
      let previousBounds = captionBounds;
      while (
        !SENTENCE_END.test(completeCaption) && cursor < input.length &&
        captionMembers.length < 4
      ) {
        const candidate = input[cursor]!;
        const bounds = pdfDocumentTranslationBlockBounds(candidate);
        const text = candidate.text.replace(/\s+/gu, ' ').trim();
        if (
          candidate.pageNumber !== first.pageNumber || candidate.kind || !bounds || !captionBounds ||
          CAPTION_BLOCK.test(text) || SECTION_HEADING_LINE.test(text) || text.length > 300 ||
          !pdfDocumentTranslationBoundsShareLane(bounds, captionBounds) ||
          (previousBounds && bounds.top - previousBounds.bottom > .035) ||
          bounds.bottom - captionBounds.top > .12
        ) break;
        captionMembers.push(candidate);
        completeCaption = joinPdfDocumentTranslationContinuationText(completeCaption, text);
        previousBounds = bounds;
        cursor += 1;
      }
      const members = [...captionMembers];
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
        const heading = pdfDocumentTranslationTableHeading(candidate);
        const grammaticalWords=text.match(/\b(?:the|we|this|that|which|with|since|because|is|are|was|were|and|for|in|as)\b/giu)?.length??0;
        const proseLike = words.length > 12 && (grammaticalWords>=4 || !structured && numericRatio < .08);
        const strong = structured || numericRow;
        const compactLabel = text.length <= 80 && words.length <= 8 &&
          !SENTENCE_END.test(text) && !heading;
        const tableLike = Boolean(text) && !heading && !proseLike &&
          text.length <= 520 && (strong || compactLabel);
        if (
          candidate.pageNumber !== first.pageNumber || !bounds || !captionBounds || !tableLike ||
          CAPTION_BLOCK.test(text) ||
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
        const sourceAnchor = pdfDocumentTranslationTableAnchor(members, input);
        if (sourceAnchor) {
          output.push({
            id: first.id,
            pageNumber: first.pageNumber,
            blockIndex: first.blockIndex,
            text: [
              completeCaption,
              ...members.slice(captionMembers.length).map((block) => block.text.trim()),
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
    if (first.kind !== 'table' || captionedOnly) {
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
        (cursor > index && CAPTION_BLOCK.test(candidate.text.trim())) ||
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
    const sourceAnchor = pdfDocumentTranslationTableAnchor(members, input);
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
  // Protect an explicit table and its rows before looking backward from a
  // following figure caption. Otherwise a tightly stacked table can look like
  // chart labels and make the figure crop climb into the table above it.
  const captionedTables = groupPdfDocumentTranslationTables(blocks, true);
  return reindexPdfDocumentTranslationPageBlocks(
    groupPdfDocumentTranslationTables(removePdfDocumentTranslationFigureInteriorFragments(
      groupPdfDocumentTranslationFigures(captionedTables),
    )),
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
  if (pdfDocumentTranslationStartsProseListItem(text)) return false;
  const normalized = text.replace(/\s*[:：]\s*$/u, '').toLocaleLowerCase('en-US');
  return KNOWN_SECTION_HEADINGS.has(normalized) || SECTION_HEADING_LINE.test(text);
}

function pdfDocumentTranslationBlockIsSkippableInterruption(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): boolean {
  return block.kind === 'code' || block.kind === 'table' || block.kind === 'figure' ||
    block.kind === 'footnote' ||
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
    BODY_LIST_ITEM_LINE.test(current.text.trim()) && current.kind !== 'formula' &&
      !EQUATION_PAIR_CONTINUATION.test(current.text.trim()) ||
    INLINE_SECTION_LEAD.test(current.text.trim()) || PERIOD_SECTION_LEAD.test(current.text.trim()) ||
    pdfDocumentTranslationBlockIsSkippableInterruption(previous) ||
    pdfDocumentTranslationBlockIsSkippableInterruption(current)
  ) return false;
  const previousText = previous.text.trim();
  return Boolean(previousText) && !CONTINUITY_SENTENCE_END.test(previousText);
}

/** Numbering alone does not make a heading. A sentence predicate distinguishes
 * scientific claims such as "1. A CNP is ..." from "2.3. Training CNPs". */
export function pdfDocumentTranslationStartsProseListItem(text: string): boolean {
  const body = /^\d{1,3}[.)]\s+(.+)$/su.exec(text.trim())?.[1];
  return Boolean(body && !/^(?:what|why|how|when|where|which|who)\b/iu.test(body) &&
    /\b(?:is|are|has|have|can|must|should|will|shall|requires?|defines?|provides?)\b/u
    .test(body.slice(0, 100)));
}

/** Display metadata comes from the source, never from model-added formatting.
 * Keep uncertain prose and non-prose objects at the ordinary body level. */
export function pdfDocumentTranslationHeadingLevel(
  block: Pick<PdfDocumentTranslationBlock, 'text' | 'kind'>,
): 1 | 2 | 3 | undefined {
  if (block.kind) return undefined;
  const text = block.text.replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 150 || CONTINUITY_SENTENCE_END.test(text) ||
      pdfDocumentTranslationStartsProseListItem(text)) return undefined;
  const normalized = text.replace(/\s*[:：]\s*$/u, '').toLocaleLowerCase('en-US');
  if (KNOWN_SECTION_HEADINGS.has(normalized) || /^acknowledg(?:e)?ments?$/u.test(normalized)) return 1;
  const numbered = /^(\d{1,3}(?:\.\d{1,3}){0,4})\.\s+[\p{Lu}\d]/u.exec(text) ??
    /^(\d{1,3}(?:\.\d{1,3}){1,4})\s+[\p{Lu}\d]/u.exec(text);
  if (numbered) return Math.min(3, numbered[1]!.split('.').length) as 1 | 2 | 3;
  return /^[IVXLC]+\.\s+\p{Lu}/u.test(text) ? 1 : undefined;
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
const EQUATION_PAIR_CONTINUATION = /^\(\d{1,3}\)\s+(?:and|or)\s+\(\d{1,3}\)\s+in\s+(?:fig(?:ure)?\.?|table)\s+\d/iu;

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
  if (EQUATION_PAIR_CONTINUATION.test(currentText)) return true;
  if (/^[,.;:!?%)\]}\u201d\u2019]/u.test(currentText)) return true;
  if (CONTINUATION_TRAILING_WORD.test(previousText)) return true;
  if (previous.kind === 'formula') return false;
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
      // A short diagram label above a caption is not the beginning of the
      // lower-case body paragraph below it. Let figure ownership resolve it.
      const lead = {...blocks[index]!, text, sourceRegions: regions};
      const previousBounds = pdfDocumentTranslationBlockBounds(lead), nextBounds = pdfDocumentTranslationBlockBounds(next);
      if (previousBounds && nextBounds &&
          (!CONTINUATION_TRAILING_WORD.test(text.trim()) && pdfDocumentTranslationLooksFigureFragment(lead) &&
            nextBounds.top - previousBounds.bottom > .04 ||
           pdfDocumentTranslationLooksFigureFragment(next) && !/[=≈≤≥∈]/u.test(next.text) &&
            !pdfDocumentTranslationBoundsShareLane(previousBounds, nextBounds))) break;
      if (!CONTINUATION_TRAILING_WORD.test(text.trim()) && pdfDocumentTranslationLooksFigureFragment(lead) &&
          previousBounds && nextBounds && blocks.some(block => {
            const figureBounds = block.kind === 'figure' && block.pageNumber === previous.pageNumber
              ? pdfDocumentTranslationBlockBounds(block) : undefined;
            return figureBounds && pdfDocumentTranslationBoundsContainFragment(figureBounds, previousBounds) &&
              !pdfDocumentTranslationBoundsContainFragment(figureBounds, nextBounds);
          })) break;
      const joined = joinPdfDocumentTranslationContinuationText(text, next.text);
      if (joined.length > PDF_DOCUMENT_TRANSLATION_CONTINUATION_LENGTH) break;
      const joinedRegions = coalesceAdjacentPdfDocumentTranslationSourceRegions([
        ...regions,
        ...nextRegions,
      ], blocks.slice(index, nextIndex).flatMap((block, offset) => (
        members.includes(index + offset) ? [] : pdfDocumentTranslationSourceRegions(block)
      )));
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

/** Resolve page-boundary continuations locally before choosing a range.
 * Geometry and sentence evidence must agree; headings remain boundaries. */
export function mergePdfCrossPageContinuations(blocks: readonly PdfDocumentTranslationBlock[]): PdfDocumentTranslationBlock[] {
  const result: PdfDocumentTranslationBlock[] = [];
  for (const block of blocks) {
    const previousIndex = pdfDocumentTranslationContextNeighborIndex(result, result.length, -1);
    const previous = previousIndex === undefined ? undefined : result[previousIndex];
    const before = previous && pdfDocumentTranslationSourceRegions(previous);
    const after = pdfDocumentTranslationSourceRegions(block);
    const tail = before?.at(-1);
    const head = after[0];
    const tornMath = previous && /(?:∈|=|\\in|\\in\s*\\mathbb)\s*$/u.test(previous.text) &&
      /^(?:[Rℝℂℕℤℚ]|\\mathbb|[({\[])/u.test(block.text.trim());
    const tornWord=previous&&/[A-Za-z]{2,}-\s*$/u.test(previous.text)&&/^(?:tions?|ing|ences?|ments?|ities|ity|able|ible|ations?)\b/u.test(block.text.trim());
    const continuingProse = previous && (!previous.kind || previous.kind === 'formula') && (!block.kind || block.kind==='formula'&&tornWord) &&
      pdfDocumentTranslationBlocksStronglyContinue(previous, block);
    // A top-of-page figure/table can push the first continuation down the page.
    // Require a contiguous column-overlapping object band from the page top
    // to the prose; captions remain independent and never enter its crop.
    const interruptions = previousIndex === undefined ? [] : result.slice(previousIndex + 1);
    const objectBand = head && interruptions.length > 0 && interruptions.every(item =>
      (item.kind === 'figure' || item.kind === 'table') && item.pageNumber === head.pageNumber)
      ? interruptions.flatMap(item => pdfDocumentTranslationSourceRegions(item)).filter(region => {
          const a=region.sourceAnchor,b=head.sourceAnchor;
          return region.pageNumber===head.pageNumber &&
            Math.min(a.leftRatio+a.widthRatio,b.leftRatio+b.widthRatio)-Math.max(a.leftRatio,b.leftRatio) >= Math.min(a.widthRatio,b.widthRatio)*.5;
        }).sort((a,b)=>a.sourceAnchor.topRatio-b.sourceAnchor.topRatio) : [];
    const followsTopObjects = objectBand.length === interruptions.length && objectBand.length > 0 &&
      objectBand[0]!.sourceAnchor.topRatio < .2 &&
      objectBand.slice(1).every((item,index)=>item.sourceAnchor.topRatio <= objectBand[index]!.sourceAnchor.topRatio+objectBand[index]!.sourceAnchor.heightRatio+.04) &&
      Math.abs(head!.sourceAnchor.topRatio-(objectBand.at(-1)!.sourceAnchor.topRatio+objectBand.at(-1)!.sourceAnchor.heightRatio)) <= .04;
    if (previous && tail && head && head.pageNumber === tail.pageNumber + 1 &&
      (tornMath || continuingProse) &&
      tail.sourceAnchor.topRatio + tail.sourceAnchor.heightRatio > .75 && (head.sourceAnchor.topRatio < .2 || followsTopObjects) &&
      !pdfDocumentTranslationBlockIsSkippableInterruption(previous) &&
      !pdfDocumentTranslationBlockIsSkippableInterruption(block) &&
      previous.text.length + block.text.length < PDF_DOCUMENT_TRANSLATION_CONTINUATION_LENGTH) {
      result[previousIndex!] = { ...previous, text: tornWord?previous.text.trimEnd().slice(0,-1)+block.text.trimStart():joinPdfDocumentTranslationContinuationText(previous.text, block.text),
        ...(tornMath||block.kind==='formula' ? {kind: 'formula'} : {}), sourceRegions: [...before!, ...after] };
    } else result.push(block);
  }
  return result;
}

/** Complete physical lines own disjoint crops. Prefer sentence/paragraph
 * boundaries; a bounded unit may carry a continuing sentence with context. */
function attachPdfVisualRequestPlans(blocks: PdfDocumentTranslationBlock[], pages: Map<number, { input: PdfDocumentTranslationPageInput; lines: VisualLine[] }>): PdfDocumentTranslationBlock[] {
  return blocks.map((block) => {
    if (['figure', 'table', 'code', 'footnote'].includes(block.kind ?? '')) return block;
    const units: PdfDocumentVisualUnit[] = [];
    const multipleNumberedCrops=pdfDocumentTranslationSourceRegions(block).length>1&&
      (block.text.match(/\t\(\d{1,4}[a-z]?\)/giu)?.length??0)>=2;
    const dense = block.text.length > 1200 && (block.text.match(/[∈∑√⊤^_=]|\\(?:frac|mathbb|sum)/gu)?.length ?? 0) >= 12 ||
      block.text.length>650&&multipleNumberedCrops;
    for (const region of pdfDocumentTranslationSourceRegions(block)) {
      const page = pages.get(region.pageNumber);
      if (!page) return block;
      const a = region.sourceAnchor;
      const selected = page.lines.filter((line) => {
        const x = (line.left + line.right) / 2 / page.input.pageWidth;
        const y = (line.top + line.bottom) / 2 / page.input.pageHeight;
        return x >= a.leftRatio && x <= a.leftRatio + a.widthRatio && y >= a.topRatio && y <= a.topRatio + a.heightRatio;
      });
      const layout = joinedLineText(selected);
      let start = 0;
      for (const [i, entry] of layout.lines.entries()) {
        const next = layout.lines[i + 1];
        const length = entry.end - start;
        const nextIsMath = next && (next.line.structured || next.line.kind === 'formula');
        const tornMath = /(?:∈|=|\\in|[+×^_])\s*$/u.test(entry.line.text) ||
          /^(?:[Rℝ][HWC\d^_]|\\mathbb)/u.test(next?.line.text ?? '');
        const currentBottom = Math.max(...layout.lines.filter((line) => line.end > start && line.start < entry.end)
          .map(({ line }) => line.inkBottom ?? line.bottom));
        const followingTop = Math.min(...layout.lines.slice(i + 1).map(({ line }) => line.top));
        const cutsVisibleInk = next && followingTop <= currentBottom;
        const safeBoundary = !nextIsMath && (SENTENCE_END.test(entry.line.text.trim()) ||
          /^(?:Then|Next|For (?:high|low)|where)\b/u.test(next?.line.text ?? ''));
        const finishedMathGroup = entry.line.structured && !nextIsMath && length >= 120;
        const continuesMathGroup = nextIsMath && (entry.line.structured || /[]/u.test(entry.line.text));
        if (next && (!dense || (!finishedMathGroup && length < 480) || continuesMathGroup || tornMath || cutsVisibleInk ||
          (!finishedMathGroup && !safeBoundary && length < 850))) continue;
        const end = entry.end;
        const anchor = sourceAnchorForBlock(start, end, { ...layout, lines: page.lines.map((line) =>
          layout.lines.find((item) => item.line === line) ?? { line, start: -2, end: -1 }) },
        { width: page.input.pageWidth, height: page.input.pageHeight });
        const owned = layout.lines.filter((line) => line.end > start && line.start < end);
        const equationNumbers = owned.flatMap(({ line }) => {
          const mathLine = line.structured || line.kind === 'formula' ||
            (/[=∈⊤∑√]/u.test(line.text) && (line.text.match(/[A-Za-z]{3,}/gu)?.length ?? 0) < 4);
          return mathLine ? [...line.text.matchAll(/\((\d{1,4}[a-z]?)\)/giu)].map((match) => match[1]!) : [];
        });
        if (anchor) {
          const sourceRegion = { pageNumber: region.pageNumber, sourceAnchor: anchor };
          const sourceFontHints=page.input.items.flatMap(item=>{
            const x=(item.left??0)+(item.width??0)/2,y=(item.top??0)+(item.height??0)/2;
            return item.mathFont&&x/page.input.pageWidth>=anchor.leftRatio&&x/page.input.pageWidth<=anchor.leftRatio+anchor.widthRatio&&
              y/page.input.pageHeight>=anchor.topRatio&&y/page.input.pageHeight<=anchor.topRatio+anchor.heightRatio?[item.mathFont]:[];
          });
          units.push({ text: layout.text.slice(start, end).trim(), sourceRegions: [sourceRegion], equationNumbers,
            sourceFontHints:[...new Map(sourceFontHints.map(h=>[`${h.variant}:${h.letter}`,h])).values()],
            sourceEquations: sourceEquationsForRegion(page.input, sourceRegion, equationNumbers) });
        }
        start = end;
      }
    }
    // A physical column boundary can split "vec- / tor" while the reading
    // block is already joined. Keep that sentence in one image request too.
    for(let index=1;index<units.length;index++){
      const previous=units[index-1]!,current=units[index]!;
      if(!/[A-Za-z]-\s*$/u.test(previous.text)||!/^\s*[a-z]/u.test(current.text))continue;
      units.splice(index-1,2,{text:`${previous.text} ${current.text}`,sourceRegions:[...previous.sourceRegions,...current.sourceRegions],equationNumbers:[...previous.equationNumbers,...current.equationNumbers],sourceEquations:[...(previous.sourceEquations??[]),...(current.sourceEquations??[])],sourceFontHints:[...(previous.sourceFontHints??[]),...(current.sourceFontHints??[])]});index--;
    }
    const normalize = (text: string) => text.replace(/\s+/gu, '');
    const equationNumbers = [...new Set(units.flatMap((unit) => unit.equationNumbers))];
    const sourceEquations = units.flatMap((unit) => unit.sourceEquations ?? []);
    const sourceFontHints=[...new Map(units.flatMap(unit=>unit.sourceFontHints??[]).map(h=>[`${h.variant}:${h.letter}`,h])).values()];
    // A crop/hint disagreement must not silently become duplicated or missing
    // input. Use the original atomic block when ownership cannot be proven.
    const matches = units.length && normalize(units.map((unit) => unit.text).join('')) === normalize(block.text);
    // Never tear the exact page-boundary expression we just reconnected.
    if (units.length > 1 && units[0]!.sourceRegions[0]!.pageNumber !== units[1]!.sourceRegions[0]!.pageNumber &&
      /(?:∈|=|\\in)\s*$/u.test(units[0]!.text)) {
      const first = units.shift()!;
      units[0] = { text: `${first.text} ${units[0]!.text}`, sourceRegions: [...first.sourceRegions, ...units[0]!.sourceRegions],
        sourceFontHints:[...(first.sourceFontHints??[]),...(units[0]!.sourceFontHints??[])],
        equationNumbers: [...first.equationNumbers, ...units[0]!.equationNumbers],
        sourceEquations: [...(first.sourceEquations ?? []), ...(units[0]!.sourceEquations ?? [])] };
    }
    return { ...block, ...(equationNumbers.length ? { equationNumbers } : {}),
      ...(sourceFontHints.length?{sourceFontHints}:{}),
      ...(sourceEquations.length ? { sourceEquations } : {}),
      ...(dense && matches && units.length > 1 ? { visualUnits: units } : {}) };
  });
}

/** A column continuation can contain one chart-label region between prose
 * regions. Remove only a fully owned label, reconstructing from native lines;
 * never drop the surrounding paragraph just because part touches a figure. */
function removePdfFigureRegionsFromProse(blocks:PdfDocumentTranslationBlock[],pages:Map<number,{input:PdfDocumentTranslationPageInput;lines:VisualLine[]}>):PdfDocumentTranslationBlock[]{
  const output=blocks.map(block=>block.kind==='figure'&&block.sourceAnchor?{...block,sourceAnchor:{...block.sourceAnchor}}:block);
  const figures=output.filter(block=>block.kind==='figure');
  return output.map(block=>{
    if(!block.sourceRegions||block.sourceRegions.length<2||['figure','table','code','footnote'].includes(block.kind??''))return block;
    const parts=block.sourceRegions.map(region=>{
      const page=pages.get(region.pageNumber),a=region.sourceAnchor;
      const lines=page?.lines.filter(line=>{
        const x=(line.left+line.right)/2/page.input.pageWidth,y=(line.top+line.bottom)/2/page.input.pageHeight;
        return x>=a.leftRatio&&x<=a.leftRatio+a.widthRatio&&y>=a.topRatio&&y<=a.topRatio+a.heightRatio;
      });
      return{region,text:lines?joinedLineText(lines).text.trim():undefined};
    });
    const removable=parts.filter(({region,text})=>text&&figures.some(figure=>{
      const bounds=pdfDocumentTranslationBlockBounds(figure);
      const fragment={...block,pageNumber:region.pageNumber,text:text!,sourceRegions:[region]};
      const inner=pdfDocumentTranslationBlockBounds(fragment);
      // Panel settings just above the first plot ticks belong to the figure;
      // include their ink in its crop before removing their prose occurrence.
      if(figure.pageNumber===region.pageNumber&&bounds&&inner&&figure.sourceAnchor&&
          /^(?:[A-Za-z]\s*=\s*\d+\s*){2,}$/u.test(text!.replace(/\s+/gu,' ').trim())&&
          inner.left>=bounds.left&&inner.right<=bounds.right&&inner.top<bounds.top&&
          bounds.top-inner.top<.025&&inner.bottom>bounds.top){
        figure.sourceAnchor.topRatio=inner.top;
        figure.sourceAnchor.heightRatio=bounds.bottom-inner.top;
        bounds.top=inner.top;
      }
      return figure.pageNumber===region.pageNumber&&bounds&&inner&&
        pdfDocumentTranslationBoundsContainFragment(bounds,inner)&&pdfDocumentTranslationLooksFigureFragment(fragment);
    }));
    if(!removable.length||removable.length===parts.length)return block;
    let text=block.text.replace(/\s+/gu,' ').trim();
    for(const part of removable){
      const label=part.text!.replace(/\s+/gu,' ').trim();
      if(text.split(label).length!==2)return block;
      text=text.replace(label,' ').replace(/\s+/gu,' ').trim();
    }
    const {sourceAnchor:_anchor,...rest}=block;
    return{...rest,text,sourceRegions:parts.filter(part=>!removable.includes(part)).map(part=>part.region)};
  });
}

/** Include the complete locally resolved source block, not every block on a
 * neighbouring page. Supplementary pages never become a new scope seed. */
export function pdfBlockTouchesScope(block: PdfDocumentTranslationBlock, includes: (page: number) => boolean): boolean {
  const regions = pdfDocumentTranslationSourceRegions(block);
  return regions.length ? regions.some(region => includes(region.pageNumber)) : includes(block.pageNumber);
}

export function pdfSupplementarySourcePages(blocks: readonly PdfDocumentTranslationBlock[], includes: (page: number) => boolean): number[] {
  return [...new Set(blocks.filter(block => pdfBlockTouchesScope(block, includes))
    .flatMap(block => pdfDocumentTranslationSourceRegions(block).map(region => region.pageNumber))
    .filter(page => !includes(page)))].sort((a, b) => a - b);
}

function looksHeadingLine(line: VisualLine, typicalHeight: number): boolean {
  if (line.kind === 'footnote') return false;
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
  // Author contact rows above the abstract belong to the title band, even
  // when addresses are right-aligned. Otherwise they can be prepended to the
  // second column's continuation of a body sentence.
  const contacts=lines.filter(line=>line.top<pageWidth*.32&&/^[\w.+-]+\s*@\s*[\w.-]+\.[A-Za-z]{2,}$/u.test(line.text.replace(/\s+/gu,'')));
  if(contacts.length){
    const height=median(contacts.map(line=>line.height)),top=Math.min(...contacts.map(line=>line.top))-height*1.2,bottom=Math.max(...contacts.map(line=>line.bottom))+height*2;
    const bodyStart=lines.find(line=>/^(?:abstract|1\.\s+introduction)$/iu.test(line.text.trim()));
    if(bodyStart&&bottom<bodyStart.top)for(const line of lines)if(line.top>=top&&line.bottom<=bottom)line.region='spanning';
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
  const inTopMargin = line.top <= pageHeight * 0.08;
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
    const previousText = previous.text.trim();
    const currentText = current.text.trim();
    const verticalStep = current.top - previous.top;
    const protectedBoundary = looksProtectedStructure(previous.text) ||
      looksProtectedStructure(current.text);
    const tableToProseBoundary=(previous.kind==='table'||/^[+−-]?\d+(?:\.\d+)?$/u.test(previousText))&&
      !current.structured&&!current.kind&&verticalStep>previous.height*.8&&
      (currentText.match(/[A-Za-z]+/gu)?.length??0)>=8&&
      (currentText.match(/\b(?:the|we|this|that|which|with|since|because|is|are|was|were|and|for|in|as)\b/giu)?.length??0)>=3;
    const hyphenatedContinuation = /\p{L}[-\u00ad]$/u.test(previousText) && /^\p{Ll}/u.test(currentText) &&
      previous.region === current.region && !current.breakBefore && verticalStep > 0 && verticalStep <= ordinaryStep * 1.35;
    const headingBoundary = !hyphenatedContinuation && (looksHeadingLine(previous, typicalHeight) ||
      looksHeadingLine(current, typicalHeight));
    const currentRegion = current.region ?? 'single';
    const currentIndent = current.left - (leftEdges.get(currentRegion) ?? current.left);
    const startsIndentedParagraph =
      currentIndent >= Math.max(7, typicalHeight * 0.7) &&
      SENTENCE_END.test(previous.text.trim());
    const footnoteBoundary =
      (previous.kind === 'footnote') !== (current.kind === 'footnote') ||
      Boolean(current.footnoteStart);
    // A wrapped prose line can begin with an inline citation, for example
    // "TVAL3" followed by "[23] using total variation ...". Keep that text
    // in its paragraph while preserving actual reference entries such as
    // "[23] Smith et al. ..." as list items.
    const citationContinuesPreviousLine =
      INLINE_CITATION_WRAP_LINE.test(currentText) &&
      !SENTENCE_END.test(previousText);
    const figureReferenceContinuesPreviousLine = CAPTION_BLOCK.test(currentText) &&
      CONTINUATION_TRAILING_WORD.test(previousText) && previous.region === current.region &&
      !current.breakBefore && verticalStep > 0 && verticalStep <= ordinaryStep * 1.35;
    const paragraphBreak = Boolean(
      current.breakBefore ||
      previous.region !== current.region ||
      footnoteBoundary ||
      protectedBoundary || tableToProseBoundary ||
      headingBoundary ||
      // Start a new caption before paragraph construction can hide it inside
      // the preceding table's final, unstructured cells. Only break before it:
      // the caption's wrapped continuation still belongs to the same object.
      (CAPTION_BLOCK.test(currentText) && !figureReferenceContinuesPreviousLine) ||
      INLINE_SECTION_LEAD.test(currentText) || PERIOD_SECTION_LEAD.test(currentText) ||
      (LIST_ITEM_LINE.test(currentText) && !citationContinuesPreviousLine) ||
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
  const baselineBottom = Math.max(...anchoredLines.map((entry) => entry.line.bottom));
  const rawBottom = Math.max(...anchoredLines.map((entry) => entry.line.inkBottom ?? entry.line.bottom));
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
      .map((entry) => entry.line.inkBottom ?? entry.line.bottom),
  );
  const nextTop = Math.min(
    Number.POSITIVE_INFINITY,
    ...adjacentLines
      .filter((entry) => entry.line.top >= baselineBottom)
      .map((entry) => entry.line.top),
  );
  const paddingTop = Number.isFinite(previousBottom)
    ? Math.min(defaultPaddingY, Math.max(0, (rawTop - previousBottom) / 2))
    : defaultPaddingY;
  const paddingBottom = Number.isFinite(nextTop)
    ? Math.min(defaultPaddingY, Math.max(0, (nextTop - rawBottom) / 2))
    : defaultPaddingY;
  const left = Math.max(0, rawLeft - paddingX);
  const top = Math.max(0, rawTop - paddingTop, Number.isFinite(previousBottom) ? previousBottom : 0);
  const right = Math.min(
    pageSize.width,
    rawRight + paddingX,
  );
  const bottom = Math.min(
    pageSize.height,
    rawBottom + paddingBottom,
    nextTop,
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
  const orderedPages = new Map<number, { input: PdfDocumentTranslationPageInput; lines: VisualLine[] }>();
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
    // A short document can repeat its only sentence near the top of every
    // page. Repetition alone must never erase the page's whole text layer.
    const hasBodyContent = page.lines.some(line => !marginSignature(line, page.input.pageHeight));
    const filtered = page.lines.filter((line) => {
      const signature = marginSignature(line, page.input.pageHeight);
      const remove = Boolean(hasBodyContent && signature && repeatedMargins.has(signature));
      if (remove) removedRepeatedMarginLines += 1;
      return !remove;
    });
    const ordered = orderedLayoutLines(filtered, page.input.pageWidth);
    orderedPages.set(page.input.pageNumber, { input: page.input, lines: ordered.lines });
    if (ordered.multiColumn) multiColumnPages += 1;
    const pageBlocks = blocksFromText(page.input.pageNumber, joinedLineText(ordered.lines), {
      width: page.input.pageWidth,
      height: page.input.pageHeight,
    });
    if (!pageBlocks.length) unreadablePages += 1;
    blocks.push(...groupPdfDocumentTranslationVisualObjects(groupPdfDocumentTranslationBottomCaptionTables(pageBlocks)));
  }
  return {
    blocks: classifyPdfPaperBlocks(attachPdfVisualRequestPlans(mergePdfCrossPageContinuations(removePdfFigureRegionsFromProse(mergePdfDocumentTranslationContinuationBlocks(groupPdfDocumentTranslationTrailingTables(
      removePdfDocumentTranslationFigureInteriorFragments(groupPdfDocumentTranslationFigures(
        mergePdfDocumentTranslationContinuationBlocks(blocks))))),orderedPages)), orderedPages),inputs),
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
