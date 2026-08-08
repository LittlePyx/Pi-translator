import { validateManualCorrectionText } from './manual-correction';
import type { TranslateResult, TranslationSegment } from './types';

export type AlignedSegmentCorrectionErrorCode =
  | 'MISSING_ALIGNMENT'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_UNIQUE'
  | 'STALE_SEGMENT'
  | 'EMPTY_SEGMENT'
  | 'SEGMENT_NOT_LOCATED'
  | 'AMBIGUOUS_ALIGNMENT';

export class AlignedSegmentCorrectionError extends Error {
  constructor(
    public readonly code: AlignedSegmentCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AlignedSegmentCorrectionError';
  }
}

export interface ApplyAlignedSegmentCorrectionInput {
  readonly result: TranslateResult;
  readonly segmentId: string;
  /** Compare-and-swap guard supplied by the caller's editor snapshot. */
  readonly expectedSegmentTranslation: string;
  readonly correctedSegmentTranslation: string;
}

export interface ApplyAlignedSegmentCorrectionResult {
  readonly translatedText: string;
  readonly alignedSegments: TranslationSegment[];
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

function assertLocatableSegments(
  segments: readonly TranslationSegment[],
): void {
  const empty = segments.find((segment) => !segment.translatedText);
  if (empty) {
    throw new AlignedSegmentCorrectionError(
      'EMPTY_SEGMENT',
      `Aligned segment ${empty.id} has no translated text and cannot be located safely.`,
    );
  }
}

function earliestMonotonicRanges(
  translatedText: string,
  segments: readonly TranslationSegment[],
): TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const start = translatedText.indexOf(segment.translatedText, cursor);
    if (start < 0) {
      throw new AlignedSegmentCorrectionError(
        'SEGMENT_NOT_LOCATED',
        `Aligned segment ${segment.id} cannot be located in the full translation in segment order.`,
      );
    }
    const end = start + segment.translatedText.length;
    ranges.push({ start, end });
    cursor = end;
  }
  return ranges;
}

function latestMonotonicRanges(
  translatedText: string,
  segments: readonly TranslationSegment[],
): TextRange[] {
  const ranges = new Array<TextRange>(segments.length);
  let cursor = translatedText.length;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const latestStart = cursor - segment.translatedText.length;
    const start = latestStart < 0
      ? -1
      : translatedText.lastIndexOf(segment.translatedText, latestStart);
    if (start < 0) {
      throw new AlignedSegmentCorrectionError(
        'SEGMENT_NOT_LOCATED',
        `Aligned segment ${segment.id} cannot be located in the full translation in segment order.`,
      );
    }
    ranges[index] = { start, end: start + segment.translatedText.length };
    cursor = start;
  }
  return ranges;
}

/**
 * Locates every aligned sentence without normalizing or rebuilding the full
 * translation. Earliest and latest valid monotonic layouts must agree, which
 * proves that the existing text has one safe alignment even when sentences
 * repeat.
 */
function uniqueMonotonicRanges(
  translatedText: string,
  segments: readonly TranslationSegment[],
): TextRange[] {
  assertLocatableSegments(segments);
  const earliest = earliestMonotonicRanges(translatedText, segments);
  const latest = latestMonotonicRanges(translatedText, segments);
  if (earliest.some((range, index) => (
    range.start !== latest[index]!.start || range.end !== latest[index]!.end
  ))) {
    throw new AlignedSegmentCorrectionError(
      'AMBIGUOUS_ALIGNMENT',
      'The aligned sentences have more than one possible position in the full translation.',
    );
  }
  return earliest;
}

/**
 * Applies one sentence correction to an aligned result.
 *
 * The original full-text layout is retained byte-for-byte outside the target
 * range. This function deliberately never joins aligned segments as a fallback.
 */
export function applyAlignedSegmentCorrection(
  input: ApplyAlignedSegmentCorrectionInput,
): ApplyAlignedSegmentCorrectionResult {
  const segments = input.result.alignedSegments;
  if (!segments?.length) {
    throw new AlignedSegmentCorrectionError(
      'MISSING_ALIGNMENT',
      'This translation does not contain sentence alignment data.',
    );
  }

  const targetIndexes = segments.flatMap((segment, index) => (
    segment.id === input.segmentId ? [index] : []
  ));
  if (!targetIndexes.length) {
    throw new AlignedSegmentCorrectionError(
      'TARGET_NOT_FOUND',
      `Aligned segment ${input.segmentId} does not exist in this translation.`,
    );
  }
  if (targetIndexes.length > 1) {
    throw new AlignedSegmentCorrectionError(
      'TARGET_NOT_UNIQUE',
      `Aligned segment id ${input.segmentId} is not unique.`,
    );
  }

  const targetIndex = targetIndexes[0]!;
  const target = segments[targetIndex]!;
  if (target.translatedText !== input.expectedSegmentTranslation) {
    throw new AlignedSegmentCorrectionError(
      'STALE_SEGMENT',
      'The sentence translation changed after this correction editor was opened.',
    );
  }

  validateManualCorrectionText(
    target.translatedText,
    input.correctedSegmentTranslation,
  );
  const ranges = uniqueMonotonicRanges(input.result.translatedText, segments);
  const targetRange = ranges[targetIndex]!;
  const translatedText = [
    input.result.translatedText.slice(0, targetRange.start),
    input.correctedSegmentTranslation,
    input.result.translatedText.slice(targetRange.end),
  ].join('');

  // Recheck the complete value at the persistence boundary as defense in depth.
  validateManualCorrectionText(input.result.translatedText, translatedText);
  return {
    translatedText,
    alignedSegments: segments.map((segment, index) => (
      index === targetIndex
        ? { ...segment, translatedText: input.correctedSegmentTranslation }
        : segment
    )),
  };
}
