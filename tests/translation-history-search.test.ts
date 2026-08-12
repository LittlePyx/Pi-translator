import { describe, expect, it } from 'vitest';
import type { TranslationHistoryEntry } from '../core/translation/types';
import {
  searchTranslationHistory,
  translationHistorySearchTerms,
} from '../ui/translation-history-search';

function historyEntry(
  requestId: string,
  originalText: string,
  translatedText: string,
  sourceHost?: string,
): TranslationHistoryEntry {
  return {
    requestId,
    historyId: `history-${requestId}`,
    createdAt: 1,
    originalText,
    translatedText,
    ...(sourceHost ? { sourceHost } : {}),
    targetLanguage: 'zh-CN',
    style: 'academic',
    warnings: [],
  };
}

describe('translation history search', () => {
  const entries = [
    historyEntry('newest', 'Adaptive sensing policy', '自适应感知策略', 'overleaf.com'),
    historyEntry('middle', 'Stable academic translation', '稳定的学术翻译', 'example.org'),
    historyEntry('oldest', 'Bayesian inference boundary', '贝叶斯推理边界', 'paper.local'),
  ];

  it('keeps the original order for an empty query', () => {
    expect(searchTranslationHistory(entries, '   ')).toEqual(entries);
  });

  it('matches source, translation, and source host without case sensitivity', () => {
    expect(searchTranslationHistory(entries, 'SENSING').map((entry) => entry.requestId))
      .toEqual(['newest']);
    expect(searchTranslationHistory(entries, '学术').map((entry) => entry.requestId))
      .toEqual(['middle']);
    expect(searchTranslationHistory(entries, 'PAPER.LOCAL').map((entry) => entry.requestId))
      .toEqual(['oldest']);
  });

  it('requires every normalized query term to match', () => {
    expect(searchTranslationHistory(entries, 'stable 翻译').map((entry) => entry.requestId))
      .toEqual(['middle']);
    expect(searchTranslationHistory(entries, 'stable sensing')).toEqual([]);
  });

  it('normalizes full-width text and repeated whitespace', () => {
    expect(translationHistorySearchTerms('  ＡＤＡＰＴＩＶＥ\n  policy  '))
      .toEqual(['adaptive', 'policy']);
    expect(searchTranslationHistory(entries, 'ＡＤＡＰＴＩＶＥ policy').map((entry) => entry.requestId))
      .toEqual(['newest']);
  });
});
