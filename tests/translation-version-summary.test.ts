import { describe, expect, it } from 'vitest';
import type { TranslateResult } from '../core/translation/types';
import {
  summarizeTranslationVersionChange,
  translationVersionLabel,
  translationVersionScopeLabel,
} from '../ui/translation-version-summary';

function result(
  requestId: string,
  translatedText: string,
  segments?: Array<{ id: string; originalText: string; translatedText: string }>,
): TranslateResult {
  return {
    requestId,
    originalText: 'First sentence. Second sentence.',
    translatedText,
    targetLanguage: 'zh-CN',
    style: 'academic',
    warnings: [],
    ...(segments ? { alignedSegments: segments } : {}),
  };
}

describe('translation version summary', () => {
  it('uses revision labels and readable scope labels', () => {
    const revised = {
      ...result('revised', '修订译文。'),
      revision: {
        rootRequestId: 'original',
        kind: 'manual' as const,
        label: '修正本句',
        scope: 'document' as const,
      },
    };
    expect(translationVersionLabel(revised)).toBe('修正本句');
    expect(translationVersionLabel(result('original', '初始译文。'))).toBe('初始译文');
    expect(translationVersionScopeLabel(revised.revision.scope)).toBe('本文记忆');
    expect(translationVersionScopeLabel('current')).toBe('仅当前选择');
    expect(translationVersionScopeLabel('global')).toBe('全局偏好');
  });

  it('identifies changed aligned sentences in display order', () => {
    const original = result('original', '甲。乙。', [
      { id: 'S1', originalText: 'First sentence.', translatedText: '甲。' },
      { id: 'S2', originalText: 'Second sentence.', translatedText: '乙。' },
    ]);
    const revised = result('revised', '甲。修改后的乙。', [
      { id: 'S1', originalText: 'First sentence.', translatedText: '甲。' },
      { id: 'S2', originalText: 'Second sentence.', translatedText: '修改后的乙。' },
    ]);
    expect(summarizeTranslationVersionChange(revised, original)).toEqual({
      kind: 'segments',
      changedSegmentIds: ['S2'],
      changedCount: 1,
    });
  });

  it('treats source recognition changes and added segments as changes', () => {
    const original = result('original', '甲。', [
      { id: 'S1', originalText: 'Recognized text.', translatedText: '甲。' },
      { id: 'S0', originalText: 'Removed text.', translatedText: '旧句。' },
    ]);
    const revised = result('revised', '甲。新增。', [
      { id: 'S1', originalText: 'Corrected text.', translatedText: '甲。' },
      { id: 'S2', originalText: 'Added text.', translatedText: '新增。' },
    ]);
    expect(summarizeTranslationVersionChange(revised, original)).toEqual({
      kind: 'segments',
      changedSegmentIds: ['S1', 'S2', 'S0'],
      changedCount: 3,
    });
  });

  it('falls back to a full-text change without aligned sentence evidence', () => {
    expect(summarizeTranslationVersionChange(
      result('revised', '全文修订。'),
      result('original', '初始译文。'),
    )).toEqual({ kind: 'full', changedSegmentIds: [], changedCount: 1 });
  });

  it('ignores presentation-only whitespace differences', () => {
    expect(summarizeTranslationVersionChange(
      result('revised', '相同 译文。'),
      result('original', ' 相同\n译文。 '),
    )).toEqual({ kind: 'same', changedSegmentIds: [], changedCount: 0 });
  });
});
