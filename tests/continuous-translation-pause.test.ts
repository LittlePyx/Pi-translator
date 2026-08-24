import { describe, expect, it } from 'vitest';

import {
  normalizeContinuousTranslationPausedTabIds,
} from '../core/settings/continuous-translation-pause';

describe('continuous translation pause state', () => {
  it('keeps only valid unique tab identifiers in stable order', () => {
    expect(normalizeContinuousTranslationPausedTabIds([
      9,
      3,
      9,
      -1,
      2.5,
      Number.NaN,
      '7',
      undefined,
    ])).toEqual([3, 9]);
  });

  it('bounds stale tab identifiers kept in one browser session', () => {
    const normalized = normalizeContinuousTranslationPausedTabIds(
      Array.from({ length: 240 }, (_, index) => index),
    );
    expect(normalized).toHaveLength(200);
    expect(normalized[0]).toBe(40);
    expect(normalized.at(-1)).toBe(239);
  });
});
