import { describe, expect, it } from 'vitest';
import {
  AlignedSegmentCorrectionError,
  applyAlignedSegmentCorrection,
} from '../core/translation/aligned-segment-correction';
import { ManualCorrectionError } from '../core/translation/manual-correction';
import type { TranslateResult, TranslationSegment } from '../core/translation/types';

function result(
  translatedText: string,
  alignedSegments?: TranslationSegment[],
): TranslateResult {
  return {
    requestId: 'request-1',
    originalText: 'Source text.',
    translatedText,
    warnings: [],
    ...(alignedSegments ? { alignedSegments } : {}),
  };
}

function alignedErrorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof AlignedSegmentCorrectionError ? error.code : undefined;
  }
}

describe('aligned sentence correction', () => {
  it('replaces only the requested sentence and preserves all surrounding layout', () => {
    const first = { id: 'S1', originalText: 'First.', translatedText: '第一句。' };
    const second = { id: 'S2', originalText: 'Second.', translatedText: '第二句。' };
    const source = result(
      '  标题\n\n第一句。\n  \n第二句。\n\n尾注  ',
      [first, second],
    );

    const corrected = applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S2',
      expectedSegmentTranslation: '第二句。',
      correctedSegmentTranslation: '修正后的第二句。',
    });

    expect(corrected.translatedText).toBe(
      '  标题\n\n第一句。\n  \n修正后的第二句。\n\n尾注  ',
    );
    expect(corrected.alignedSegments).toEqual([
      first,
      { ...second, translatedText: '修正后的第二句。' },
    ]);
    expect(corrected.alignedSegments[0]).toBe(first);
  });

  it('uses segment order to distinguish adjacent repeated sentences', () => {
    const repeated = '结论相同。';
    const corrected = applyAlignedSegmentCorrection({
      result: result(`${repeated}\n\n${repeated}`, [
        { id: 'S1', originalText: 'Same one.', translatedText: repeated },
        { id: 'S2', originalText: 'Same two.', translatedText: repeated },
      ]),
      segmentId: 'S2',
      expectedSegmentTranslation: repeated,
      correctedSegmentTranslation: '第二个结论相同。',
    });

    expect(corrected.translatedText).toBe(`${repeated}\n\n第二个结论相同。`);
    expect(corrected.alignedSegments.map((segment) => segment.translatedText))
      .toEqual([repeated, '第二个结论相同。']);
  });

  it('rejects an ambiguous repeated sentence instead of replacing the first match', () => {
    const source = result('重复句。\n过渡文字。\n重复句。', [
      { id: 'S1', originalText: 'Repeated.', translatedText: '重复句。' },
    ]);
    expect(alignedErrorCode(() => applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S1',
      expectedSegmentTranslation: '重复句。',
      correctedSegmentTranslation: '已修正。',
    }))).toBe('AMBIGUOUS_ALIGNMENT');
  });

  it('rejects a correction that changes a protected formula', () => {
    const source = result('数值 $x$ 保持稳定。', [
      { id: 'S1', originalText: 'The value is stable.', translatedText: '数值 $x$ 保持稳定。' },
    ]);
    expect(() => applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S1',
      expectedSegmentTranslation: '数值 $x$ 保持稳定。',
      correctedSegmentTranslation: '数值 $y$ 保持稳定。',
    })).toThrowError(ManualCorrectionError);
    try {
      applyAlignedSegmentCorrection({
        result: source,
        segmentId: 'S1',
        expectedSegmentTranslation: '数值 $x$ 保持稳定。',
        correctedSegmentTranslation: '数值 $y$ 保持稳定。',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'LATEX_CHANGED' });
    }
  });

  it('rejects a missing target segment', () => {
    const source = result('第一句。', [
      { id: 'S1', originalText: 'First.', translatedText: '第一句。' },
    ]);
    expect(alignedErrorCode(() => applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S9',
      expectedSegmentTranslation: '第一句。',
      correctedSegmentTranslation: '修正。',
    }))).toBe('TARGET_NOT_FOUND');
  });

  it('rejects a stale expected sentence before locating or changing text', () => {
    const source = result('当前译文。', [
      { id: 'S1', originalText: 'Current.', translatedText: '当前译文。' },
    ]);
    expect(alignedErrorCode(() => applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S1',
      expectedSegmentTranslation: '编辑器中的旧译文。',
      correctedSegmentTranslation: '修正。',
    }))).toBe('STALE_SEGMENT');
  });

  it('rejects alignment text that cannot be located in the full translation', () => {
    const source = result('第一句。\n实际第二句。', [
      { id: 'S1', originalText: 'First.', translatedText: '第一句。' },
      { id: 'S2', originalText: 'Second.', translatedText: '另一条第二句。' },
    ]);
    expect(alignedErrorCode(() => applyAlignedSegmentCorrection({
      result: source,
      segmentId: 'S1',
      expectedSegmentTranslation: '第一句。',
      correctedSegmentTranslation: '修正后的第一句。',
    }))).toBe('SEGMENT_NOT_LOCATED');
  });
});
