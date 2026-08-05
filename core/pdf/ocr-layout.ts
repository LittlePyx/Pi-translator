import type { CoordinateOcrBlock, OcrBlockKind } from './ocr-text-layer';

const SPANNING_WIDTH = 0.62;
const LEFT_COLUMN_CENTER_LIMIT = 0.48;
const RIGHT_COLUMN_CENTER_LIMIT = 0.52;
const MIN_COLUMN_OVERLAP = 0.04;

function topLeftOrder(left: CoordinateOcrBlock, right: CoordinateOcrBlock): number {
  const topDifference = left.box.top - right.box.top;
  if (Math.abs(topDifference) > 0.004) return topDifference;
  const leftDifference = left.box.left - right.box.left;
  return leftDifference || left.order - right.order;
}

function bottom(block: CoordinateOcrBlock): number {
  return block.box.top + block.box.height;
}

function centerY(block: CoordinateOcrBlock): number {
  return block.box.top + block.box.height / 2;
}

function centerX(block: CoordinateOcrBlock): number {
  return block.box.left + block.box.width / 2;
}

function isSpanningBlock(block: CoordinateOcrBlock): boolean {
  const right = block.box.left + block.box.width;
  return block.box.width >= SPANNING_WIDTH || (block.box.left <= 0.2 && right >= 0.8);
}

function orderColumnBand(blocks: CoordinateOcrBlock[]): CoordinateOcrBlock[] {
  if (blocks.length < 4) return [...blocks].sort(topLeftOrder);

  const left = blocks.filter((block) => centerX(block) < LEFT_COLUMN_CENTER_LIMIT);
  const right = blocks.filter((block) => centerX(block) > RIGHT_COLUMN_CENTER_LIMIT);
  const assigned = new Set([...left, ...right]);
  if (left.length < 2 || right.length < 2 || assigned.size !== blocks.length) {
    return [...blocks].sort(topLeftOrder);
  }

  const overlap = Math.min(
    Math.max(...left.map(bottom)),
    Math.max(...right.map(bottom)),
  ) - Math.max(
    Math.min(...left.map((block) => block.box.top)),
    Math.min(...right.map((block) => block.box.top)),
  );
  if (overlap < MIN_COLUMN_OVERLAP) return [...blocks].sort(topLeftOrder);

  return [...left].sort(topLeftOrder).concat([...right].sort(topLeftOrder));
}

/**
 * Orders common academic layouts without asking a generative model to invent a
 * reading order. Full-width titles and footnotes split the page into bands;
 * a band is treated as two columns only when both columns have enough evidence.
 */
export function orderAcademicOcrBlocks(
  blocks: CoordinateOcrBlock[],
): CoordinateOcrBlock[] {
  const spanning = blocks.filter(isSpanningBlock).sort(topLeftOrder);
  const remaining = blocks.filter((block) => !isSpanningBlock(block));
  const ordered: CoordinateOcrBlock[] = [];
  const consumed = new Set<CoordinateOcrBlock>();

  for (const divider of spanning) {
    const band = remaining.filter(
      (block) => !consumed.has(block) && centerY(block) < centerY(divider),
    );
    band.forEach((block) => consumed.add(block));
    ordered.push(...orderColumnBand(band), divider);
  }
  ordered.push(...orderColumnBand(remaining.filter((block) => !consumed.has(block))));

  return ordered.map((block, order) => ({ ...block, order }));
}

/** Returns the visible text-line angle normalized to the [-90, 90] range. */
export function ocrLineRotationDegrees(location: number[]): number {
  if (location.length < 4) return 0;
  const degrees = Math.atan2(
    location[3]! - location[1]!,
    location[2]! - location[0]!,
  ) * 180 / Math.PI;
  let normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  if (normalized > 90) normalized -= 180;
  if (normalized < -90) normalized += 180;
  return normalized;
}

/**
 * Conservative local classification. OCR text that looks like a formula or a
 * table stays available for diagnostics/fallback, but is not exposed as a
 * misleading selectable text line.
 */
export function inferOcrBlockKind(text: string): OcrBlockKind {
  const normalized = text.trim();
  if (/\t/.test(normalized) || (normalized.match(/\|/g)?.length ?? 0) >= 2) return 'table';
  if (
    /\\(?:begin|end|frac|dfrac|tfrac|sum|prod|int|sqrt|mathbf|mathbb|boldsymbol|hat|tilde|lambda|sigma|rho|eta|arg|min|max)\b/i.test(normalized) ||
    /[$_^{}]/.test(normalized) ||
    /[=∑∏∫√≤≥≈±×÷∞∂∇]/.test(normalized)
  ) return 'formula';
  return 'text';
}
