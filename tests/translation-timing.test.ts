import { describe, expect, it } from 'vitest';
import {
  formatTranslationDuration,
  translationCompletionStatus,
} from '../ui/translation-timing';

describe('translation timing presentation', () => {
  it('uses milliseconds for sub-second translations', () => {
    expect(formatTranslationDuration(1)).toBe('1 毫秒');
    expect(formatTranslationDuration(850)).toBe('850 毫秒');
    expect(formatTranslationDuration(999)).toBe('999 毫秒');
  });

  it('uses one decimal second for longer translations', () => {
    expect(formatTranslationDuration(1_000)).toBe('1.0 秒');
    expect(formatTranslationDuration(1_549)).toBe('1.5 秒');
    expect(formatTranslationDuration(12_560)).toBe('12.6 秒');
  });

  it('omits unavailable or invalid durations', () => {
    expect(formatTranslationDuration(undefined)).toBeUndefined();
    expect(formatTranslationDuration(0)).toBeUndefined();
    expect(formatTranslationDuration(-1)).toBeUndefined();
    expect(formatTranslationDuration(Number.NaN)).toBeUndefined();
  });

  it('prefers the cache state over stale duration metadata', () => {
    expect(translationCompletionStatus({ cached: true, latencyMs: 12_560 }))
      .toBe('会话缓存');
    expect(translationCompletionStatus({ latencyMs: 850 })).toBe('850 毫秒');
    expect(translationCompletionStatus({})).toBe('已完成');
  });
});
