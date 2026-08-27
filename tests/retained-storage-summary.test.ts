import { describe, expect, it } from 'vitest';
import { summarizeRetainedTranslationStorage } from '../core/translation/retained-storage-summary';

describe('retained translation storage summary', () => {
  it('counts only translated output and reports the newest anonymous record', () => {
    const sessions = [
      {
        updatedAt: 120,
        blocks: [{ translatedText: '第一段' }, { translatedText: '第二段译文' }],
      },
      {
        updatedAt: 240,
        blocks: [{ translatedText: 'PDF translation' }],
      },
    ];
    const summary = summarizeRetainedTranslationStorage(
      sessions,
      'retainedV1',
      6,
      1_000_000,
    );

    expect(summary).toMatchObject({
      documentCount: 2,
      translationCharacters: 23,
      maximumDocuments: 6,
      maximumTranslationCharacters: 1_000_000,
      nearingCapacity: false,
      newestUpdatedAt: 240,
    });
    expect(summary.estimatedBytes).toBeGreaterThan(0);
  });

  it('uses zero space for an absent store and warns near either limit', () => {
    expect(summarizeRetainedTranslationStorage([], 'retainedV1', 6, 100)).toEqual({
      documentCount: 0,
      translationCharacters: 0,
      estimatedBytes: 0,
      maximumDocuments: 6,
      maximumTranslationCharacters: 100,
      nearingCapacity: false,
    });
    expect(summarizeRetainedTranslationStorage([
      { updatedAt: 1, blocks: [{ translatedText: 'x'.repeat(90) }] },
    ], 'retainedV1', 6, 100).nearingCapacity).toBe(true);
    expect(summarizeRetainedTranslationStorage(Array.from({ length: 6 }, (_, index) => ({
      updatedAt: index,
      blocks: [{ translatedText: 'x' }],
    })), 'retainedV1', 6, 100).nearingCapacity).toBe(true);
  });
});
