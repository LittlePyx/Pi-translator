export interface PdfTextLineGeometry {
  /** One-based page number. */
  pageNumber: number;
  /** Left coordinate in viewport units. */
  x: number;
  /** Top coordinate in viewport units, increasing downwards. */
  y: number;
  width: number;
  height: number;
}

export interface PdfTextLineMetadata {
  text: string;
  geometry?: PdfTextLineGeometry;
}

export interface PdfTextNormalizationOptions {
  /**
   * Optional extraction-order line metadata. Geometry is only trusted when every
   * non-empty source line has an exact matching entry with finite coordinates.
   * Lines are never reordered from geometry alone.
   */
  lines?: readonly PdfTextLineMetadata[];
}

type LineKind = 'body' | 'heading' | 'list' | 'protected';
type GeometryBreak = 'line' | 'paragraph';

interface NormalizedLine {
  text: string;
  kind: LineKind;
  sourceIndex: number;
}

const KNOWN_HEADINGS = new Set([
  'abstract',
  'acknowledgment',
  'acknowledgments',
  'acknowledgement',
  'acknowledgements',
  'appendix',
  'background',
  'conclusion',
  'conclusions',
  'discussion',
  'experiments',
  'introduction',
  'limitations',
  'materials and methods',
  'method',
  'methodology',
  'methods',
  'references',
  'related work',
  'results',
  'results and discussion',
  'supplementary material',
]);

const LIST_ITEM_PATTERN = /^(?:[-*\u2022\u2023\u25aa\u25e6\u2013\u2014]\s+|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+|[A-Za-z][.)]\s+|\([A-Za-z]\)\s+|\[\d{1,4}\]\s+)/u;
const SECTION_HEADING_PATTERN = /^(?:(?:\d+(?:\.\d+){0,4}|[IVXLC]+)\.?\s+)[\p{Lu}\d]/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/iu;
const DOI_PATTERN = /(?:\bdoi\s*:\s*)?10\.\d{4,9}\/[\w.()/:;-]+/iu;
const CJK_CHARACTER_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;

function finiteGeometry(value: PdfTextLineGeometry | undefined): value is PdfTextLineGeometry {
  return Boolean(
    value &&
    Number.isInteger(value.pageNumber) &&
    value.pageNumber > 0 &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    value.width >= 0 &&
    Number.isFinite(value.height) &&
    value.height > 0,
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] ?? 0;
  const low = sorted[Math.max(0, middle - 1)] ?? high;
  return sorted.length % 2 === 0 ? (low + high) / 2 : high;
}

interface GeometryBreakAnalysis {
  trusted: boolean;
  breaks: ReadonlyMap<number, GeometryBreak>;
}

function reliableGeometryBreaks(
  sourceLines: readonly string[],
  metadata: readonly PdfTextLineMetadata[] | undefined,
): GeometryBreakAnalysis {
  if (!metadata?.length) return { trusted: false, breaks: new Map() };
  const sourceEntries = sourceLines
    .map((text, sourceIndex) => ({ text: text.trim(), sourceIndex }))
    .filter(({ text }) => Boolean(text));
  if (
    sourceEntries.length !== metadata.length ||
    metadata.some((line, index) => (
      line.text.trim() !== sourceEntries[index]?.text || !finiteGeometry(line.geometry)
    ))
  ) {
    return { trusted: false, breaks: new Map() };
  }

  const lineHeight = median(metadata.map((line) => line.geometry!.height));
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return { trusted: false, breaks: new Map() };
  }
  const breaks = new Map<number, GeometryBreak>();
  for (let index = 1; index < metadata.length; index += 1) {
    const previous = metadata[index - 1]!.geometry!;
    const current = metadata[index]!.geometry!;
    const sourceIndex = sourceEntries[index]!.sourceIndex;
    if (current.pageNumber !== previous.pageNumber) {
      breaks.set(sourceIndex, 'paragraph');
      continue;
    }
    const verticalGap = current.y - (previous.y + previous.height);
    if (verticalGap > lineHeight * 0.9) {
      breaks.set(sourceIndex, 'paragraph');
      continue;
    }
    const movedUp = current.y < previous.y - lineHeight * 0.5;
    const movedSideways = Math.abs(current.x - previous.x) > Math.max(
      lineHeight * 3,
      Math.min(previous.width, current.width) * 0.45,
    );
    if (movedUp || (movedSideways && Math.abs(current.y - previous.y) < lineHeight)) {
      // A likely column transition. Preserve extraction order, but do not fuse
      // unrelated columns into one sentence.
      breaks.set(sourceIndex, 'line');
    }
  }
  return { trusted: true, breaks };
}

function isListItem(text: string): boolean {
  return LIST_ITEM_PATTERN.test(text);
}

function isHeading(text: string): boolean {
  if (text.length > 120 || text.split(/\s+/u).length > 15) return false;
  const withoutColon = text.replace(/\s*:\s*$/u, '').trim();
  if (KNOWN_HEADINGS.has(withoutColon.toLocaleLowerCase('en-US'))) return true;
  if (SECTION_HEADING_PATTERN.test(withoutColon) && !/[.!?]$/u.test(withoutColon)) return true;
  const words = withoutColon.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  if (words.length < 2 || words.length > 12 || /[.!?;,]$/u.test(withoutColon)) return false;
  const letters = withoutColon.match(/\p{L}/gu) ?? [];
  if (letters.length >= 3 && letters.every((letter) => letter === letter.toLocaleUpperCase())) {
    return true;
  }
  const titleWords = words.filter((word) => /^\p{Lu}/u.test(word));
  return titleWords.length / words.length >= 0.75;
}

function looksMathDominant(text: string): boolean {
  if (/^(?:\(?\d+(?:\.\d+)*\)?|\[\d+\])$/u.test(text)) return false;
  const operators = text.match(/[=+*/^_<>\u00b1\u00d7\u2212\u2211\u220f\u222b\u221a\u2260\u2248\u2264\u2265]/gu)?.length ?? 0;
  if (operators < 2) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters <= Math.max(8, operators * 3);
}

function classifyLines(lines: readonly string[]): NormalizedLine[] {
  const output: NormalizedLine[] = [];
  let latexEnvironmentDepth = 0;
  let displayMath = false;
  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex += 1) {
    const text = lines[sourceIndex]!.trim();
    if (!text) continue;
    const beginsEnvironment = /\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|displaymath|math)\}/u.test(text);
    const endsEnvironment = /\\end\{(?:equation\*?|align\*?|gather\*?|multline\*?|displaymath|math)\}/u.test(text);
    const beginsBracketMath = /^\s*\\\[/u.test(text);
    const endsBracketMath = /\\\]\s*$/u.test(text);
    const dollarDelimiters = text.match(/\$\$/gu)?.length ?? 0;
    const inLatexBlock = latexEnvironmentDepth > 0 || displayMath;
    const latexStructure = /^(?:\\(?:begin|end|section|subsection|subsubsection|paragraph|label|caption)\b|\\[\[\]])/u.test(text);
    const protectedLine =
      inLatexBlock ||
      beginsEnvironment ||
      endsEnvironment ||
      beginsBracketMath ||
      endsBracketMath ||
      dollarDelimiters > 0 ||
      latexStructure ||
      looksMathDominant(text) ||
      URL_PATTERN.test(text) ||
      DOI_PATTERN.test(text);

    let kind: LineKind = 'body';
    if (protectedLine) kind = 'protected';
    else if (isListItem(text)) kind = 'list';
    else if (isHeading(text)) kind = 'heading';
    output.push({ text, kind, sourceIndex });

    if (beginsEnvironment) latexEnvironmentDepth += 1;
    if (endsEnvironment) latexEnvironmentDepth = Math.max(0, latexEnvironmentDepth - 1);
    if (beginsBracketMath) displayMath = true;
    if (endsBracketMath) displayMath = false;
    if (dollarDelimiters % 2 === 1) displayMath = !displayMath;
  }
  return output;
}

function joinHardHyphenLine(left: string, right: string): string | undefined {
  // A visible U+002D hyphen may be lexical (p-value, F-score,
  // encoder-decoder). Without a dictionary there is no safe way to decide
  // whether it was inserted only for layout, so preserve it by default.
  return /-$/u.test(left) && /^[\p{L}\p{N}]/u.test(right)
    ? `${left}${right}`
    : undefined;
}

function joinWrappedBodyLine(left: string, right: string): string {
  const hardHyphenJoin = joinHardHyphenLine(left, right);
  if (hardHyphenJoin !== undefined) return hardHyphenJoin;
  const leftCharacter = left.at(-1) ?? '';
  const rightCharacter = right[0] ?? '';
  const omitSpace =
    (CJK_CHARACTER_PATTERN.test(leftCharacter) && CJK_CHARACTER_PATTERN.test(rightCharacter)) ||
    /[(\[{\u201c\u2018/]$/u.test(left) ||
    /^[,.;:!?%\)\]}\u201d\u2019]/u.test(right);
  return `${left}${omitSpace ? '' : ' '}${right}`;
}

/**
 * Normalizes text copied from a PDF without trying to infer or reorder columns.
 * It removes soft-hyphen artifacts, preserves visible hard hyphens, and keeps
 * explicit paragraphs, list items, headings, equations and references. Ordinary
 * line breaks are only collapsed when complete, matching geometry metadata is
 * available; without it a line might be a column boundary and is kept intact.
 */
export function normalizePdfSelectionText(
  value: string,
  options: PdfTextNormalizationOptions = {},
): string {
  const withoutSoftHyphens = value
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00ad[ \t]*\n[ \t]*/gu, '')
    .replace(/\u00ad/gu, '');
  const sourceLines = withoutSoftHyphens.split('\n');
  const lines = classifyLines(sourceLines);
  if (lines.length === 0) return '';
  const geometry = reliableGeometryBreaks(sourceLines, options.lines);
  let output = lines[0]!.text;
  let previous = lines[0]!;

  for (const current of lines.slice(1)) {
    const hadBlankLine = sourceLines
      .slice(previous.sourceIndex + 1, current.sourceIndex)
      .some((line) => !line.trim());
    const geometryBreak = geometry.breaks.get(current.sourceIndex);
    if (hadBlankLine || geometryBreak === 'paragraph') {
      output = `${output.trimEnd()}\n\n${current.text}`;
    } else if (
      geometryBreak === 'line' ||
      previous.kind === 'protected' ||
      current.kind === 'protected' ||
      previous.kind === 'heading' ||
      current.kind === 'heading' ||
      current.kind === 'list'
    ) {
      output = `${output.trimEnd()}\n${current.text}`;
    } else if (geometry.trusted) {
      output = joinWrappedBodyLine(output, current.text);
    } else {
      output = joinHardHyphenLine(output, current.text) ??
        `${output.trimEnd()}\n${current.text}`;
    }
    previous = current;
  }
  return output.trim();
}
