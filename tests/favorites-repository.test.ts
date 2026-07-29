import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addTranslationFavorite,
  deleteTranslationFavorite,
  getTranslationFavorites,
} from '../core/translation/favorites-repository';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('translation favorites', () => {
  it('stores, searches, deduplicates, and deletes explicit favorites', async () => {
    const result = {
      requestId: 'request-1',
      originalText: 'A stable estimator.',
      translatedText: '一个稳定的估计器。',
      warnings: [],
      sourceHost: 'example.org',
      targetLanguage: 'zh-CN',
    };
    const first = await addTranslationFavorite(result);
    const second = await addTranslationFavorite({ ...result, requestId: 'request-2' });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    await expect(getTranslationFavorites('估计器')).resolves.toHaveLength(1);
    await expect(getTranslationFavorites('example.org')).resolves.toHaveLength(1);
    await expect(deleteTranslationFavorite(first[0]!.favoriteId)).resolves.toEqual([]);
  });

  it('never persists embedded image data as a favorite', async () => {
    await expect(addTranslationFavorite({
      requestId: 'malicious-image-result',
      originalText: 'data:image/png;base64,private-image',
      translatedText: '译文',
      warnings: [],
      targetLanguage: 'zh-CN',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(JSON.stringify(storage)).not.toContain('data:image/');
  });
});
