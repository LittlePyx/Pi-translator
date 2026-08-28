import { describe, expect, it } from 'vitest';

import {
  bilingualPageDisplayMode,
  bilingualPageLanguageSwitchConfirmation,
  bilingualPageViewportPriority,
  buildBilingualPageReferenceContext,
  isBilingualPageState,
  isBilingualPageTextCandidate,
  isIsolatedBilingualBlockError,
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

  it('prioritizes the current viewport before upcoming and already-passed paragraphs', () => {
    const viewportHeight = 800;
    const positions = [
      { id: 'far-below', bounds: { top: 2_400, bottom: 2_480 } },
      { id: 'just-above', bounds: { top: -120, bottom: -20 } },
      { id: 'lower-visible', bounds: { top: 620, bottom: 700 } },
      { id: 'upper-visible', bounds: { top: 80, bottom: 160 } },
      { id: 'next-screen', bounds: { top: 940, bottom: 1_020 } },
    ];
    positions.sort((left, right) => {
      const leftPriority = bilingualPageViewportPriority(left.bounds, viewportHeight);
      const rightPriority = bilingualPageViewportPriority(right.bounds, viewportHeight);
      return leftPriority.tier - rightPriority.tier ||
        leftPriority.distance - rightPriority.distance;
    });
    expect(positions.map(({ id }) => id)).toEqual([
      'upper-visible',
      'lower-visible',
      'next-screen',
      'far-below',
      'just-above',
    ]);
    expect(bilingualPageViewportPriority(
      { top: Number.NaN, bottom: Number.NaN },
      viewportHeight,
    )).toEqual({ tier: 3, distance: Number.MAX_SAFE_INTEGER });
  });

  it('validates tab state updates without accepting arbitrary languages or counts', () => {
    expect(isBilingualPageState({
      phase: 'running',
      total: 12,
      translated: 4,
      failed: 0,
      contentTruncated: true,
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    })).toBe(true);
    expect(isBilingualPageState({
      phase: 'complete',
      total: 1_200,
      translated: 1_200,
      failed: 0,
      contentTruncated: 'yes',
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'paused',
      total: 12,
      translated: 4,
      failed: 0,
      displayMode: 'source',
      translationsHidden: true,
      targetLanguage: 'zh-CN',
      pauseReason: 'interactive',
      message: '正在处理划词，正文稍后继续。',
    })).toBe(true);
    expect(isBilingualPageState({
      phase: 'complete',
      total: 2,
      translated: 2,
      failed: 0,
      displayMode: 'translation',
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    })).toBe(true);
    expect(isBilingualPageState({
      phase: 'complete',
      total: 2,
      translated: 2,
      failed: 0,
      displayMode: 'source',
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'running',
      total: 2,
      translated: 3,
      failed: 0,
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'complete',
      total: 1,
      translated: 1,
      failed: 0,
      translationsHidden: false,
      targetLanguage: 'xx',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'paused',
      total: 1,
      translated: 0,
      failed: 0,
      translationsHidden: false,
      pauseReason: 'unexpected',
    })).toBe(false);
    expect(isBilingualPageState({
      phase: 'idle',
      total: 0,
      translated: 0,
      failed: 0,
    })).toBe(false);
  });

  it('derives a compatible display mode for older tab state updates', () => {
    expect(bilingualPageDisplayMode({ translationsHidden: false })).toBe('bilingual');
    expect(bilingualPageDisplayMode({ translationsHidden: true })).toBe('source');
    expect(bilingualPageDisplayMode({
      displayMode: 'translation',
      translationsHidden: false,
    })).toBe('translation');
  });

  it('confirms a language switch only when completed paragraph translations will be replaced', () => {
    const state = {
      phase: 'running' as const,
      total: 12,
      translated: 4,
      failed: 1,
      translationsHidden: false,
      targetLanguage: 'zh-CN',
    };
    expect(bilingualPageLanguageSwitchConfirmation(state, 'en'))
      .toBe('切换为英文将清除已译 4 段，并重新调用翻译接口。');
    expect(bilingualPageLanguageSwitchConfirmation(state, 'zh-CN')).toBeUndefined();
    expect(bilingualPageLanguageSwitchConfirmation({ ...state, translated: 0 }, 'ja'))
      .toBeUndefined();
    expect(bilingualPageLanguageSwitchConfirmation({
      ...state,
      phase: 'idle',
      total: 0,
      translated: 0,
      failed: 0,
    }, 'de')).toBeUndefined();
  });

  it('isolates paragraph-specific output failures without retrying global outages', () => {
    expect(isIsolatedBilingualBlockError('LATEX_VALIDATION_FAILED')).toBe(true);
    expect(isIsolatedBilingualBlockError('SELECTION_TOO_LONG')).toBe(true);
    expect(isIsolatedBilingualBlockError('INVALID_RESPONSE')).toBe(true);
    expect(isIsolatedBilingualBlockError('RATE_LIMITED')).toBe(false);
    expect(isIsolatedBilingualBlockError('NETWORK_ERROR')).toBe(false);
    expect(isIsolatedBilingualBlockError('AUTH_FAILED')).toBe(false);
  });

  it('builds bounded article context without repeating the paragraph being translated', () => {
    const context = buildBilingualPageReferenceContext({
      currentText: 'It remains stable under the perturbation considered below.',
      articleTitle: 'A Practical Guide to Robust Estimation',
      previousSource: 'The estimator converges under the stated assumptions.',
      previousTranslation: '在给定假设下，该估计量收敛。',
    });
    expect(context).toContain('Article title:\nA Practical Guide to Robust Estimation');
    expect(context).toContain(
      'Immediately preceding source paragraph:\nThe estimator converges under the stated assumptions.',
    );
    expect(context).toContain('Translation of the immediately preceding paragraph');
    expect(context).not.toContain('It remains stable under the perturbation');
    expect(context!.length).toBeLessThanOrEqual(800);
  });

  it('uses a translated heading as context without duplicating its source', () => {
    const context = buildBilingualPageReferenceContext({
      currentText: 'This section introduces the experimental setup.',
      articleTitle: 'Experimental Setup for Adaptive Sensing',
      previousSource: 'Experimental Setup for Adaptive Sensing',
      previousTranslation: '自适应感知的实验设置',
    });
    expect(context?.match(/Experimental Setup for Adaptive Sensing/gu)).toHaveLength(1);
    expect(context).toContain('Translation of the article title:\n自适应感知的实验设置');
  });

  it('enforces the context budget even when every reference is very long', () => {
    const context = buildBilingualPageReferenceContext({
      currentText: 'Current paragraph remains separate.',
      articleTitle: `Title ${'T'.repeat(500)}`,
      previousSource: `Source ${'S'.repeat(1_000)}`,
      previousTranslation: `Translation ${'译'.repeat(1_000)}`,
    }, 320);
    expect(context!.length).toBeLessThanOrEqual(320);
    expect(context).not.toContain('Current paragraph remains separate.');
  });
});
