import { describe, expect, it } from 'vitest';

import {
  isBilingualPageState,
  isBilingualPageTextCandidate,
  normalizeBilingualPageText,
} from '../core/translation/bilingual-page';

describe('bilingual webpage reading', () => {
  it('keeps readable prose while rejecting tiny labels and link-heavy navigation', () => {
    expect(normalizeBilingualPageText('  A readable\n article   paragraph. '))
      .toBe('A readable article paragraph.');
    expect(isBilingualPageTextCandidate(
      'A readable article paragraph explains the result in enough detail.',
      'P',
    )).toBe(true);
    expect(isBilingualPageTextCandidate('Open', 'P')).toBe(false);
    expect(isBilingualPageTextCandidate(
      'Documentation reference links and related pages',
      'P',
      38,
    )).toBe(false);
    expect(isBilingualPageTextCandidate('Methods overview', 'H2')).toBe(true);
  });

  it('validates tab state updates without accepting arbitrary languages or counts', () => {
    expect(isBilingualPageState({
      phase: 'running',
      total: 12,
      translated: 4,
      failed: 0,
      targetLanguage: 'zh-CN',
    })).toBe(true);
    expect(isBilingualPageState({
      phase: 'running',
      total: 2,
      translated: 3,
      failed: 0,
      targetLanguage: 'zh-CN',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'complete',
      total: 1,
      translated: 1,
      failed: 0,
      targetLanguage: 'xx',
    })).toBe(false);
  });
});
