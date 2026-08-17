import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheTranslation,
  getCachedTranslation,
  translationCacheKey,
} from '../core/translation/cache-repository';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
        remove: vi.fn(async (key: string) => { delete storage[key]; }),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const request = {
  requestId: 'one',
  text: 'Translate this sentence.',
  pageUrl: 'https://example.com',
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto' as const,
  style: 'general' as const,
  contentMode: 'plain' as const,
};

describe('translation cache key', () => {
  it('ignores request ids but includes translation behavior', () => {
    const provider = { apiBaseUrl: 'https://api.example.com/v1', model: 'a', glossary: [] };
    expect(translationCacheKey(request, provider)).toBe(
      translationCacheKey({ ...request, requestId: 'two' }, provider),
    );
    expect(translationCacheKey(request, provider)).not.toBe(
      translationCacheKey({ ...request, targetLanguage: 'ja' }, provider),
    );
    expect(translationCacheKey(request, provider)).not.toBe(
      translationCacheKey(request, {
        ...provider,
        glossary: [{ source: 'ROI', target: '感兴趣区域' }],
      }),
    );
    expect(translationCacheKey(request, provider)).not.toBe(
      translationCacheKey({ ...request, contextText: 'Earlier document context.' }, provider),
    );
    expect(translationCacheKey({ ...request, text: 'continuity' }, provider)).not.toBe(
      translationCacheKey({ ...request, text: 'continuity', contentMode: 'latex' }, provider),
    );
    expect(translationCacheKey(request, provider)).not.toBe(
      translationCacheKey({
        ...request,
        revision: {
          rootRequestId: 'one',
          kind: 'custom',
          label: 'Custom',
          instruction: 'Use a more formal term.',
        },
      }, provider),
    );
    const revision = {
      rootRequestId: 'one',
      kind: 'custom' as const,
      label: 'Custom',
      instruction: 'Use a more formal term.',
      previousTranslation: 'First draft.',
    };
    expect(translationCacheKey({ ...request, revision }, provider)).not.toBe(
      translationCacheKey({
        ...request,
        revision: { ...revision, previousTranslation: 'Manually corrected draft.' },
      }, provider),
    );
    expect(translationCacheKey({ ...request, revision }, provider)).toBe(
      translationCacheKey({
        ...request,
        revision: { ...revision, rootRequestId: 'different-root', label: 'Different label' },
      }, provider),
    );
  });

  it('preserves concurrent writes for different tabs', async () => {
    const result = (index: number) => ({
      requestId: `request-${index}`,
      originalText: `source-${index}`,
      translatedText: `translation-${index}`,
      warnings: [],
      targetLanguage: 'zh-CN',
    });

    await Promise.all([
      cacheTranslation(11, 'key-1', result(1)),
      cacheTranslation(22, 'key-2', result(2)),
    ]);

    await expect(getCachedTranslation(11, 'key-1', 'read-1')).resolves.toMatchObject({
      requestId: 'read-1',
      translatedText: 'translation-1',
      cached: true,
    });
    await expect(getCachedTranslation(22, 'key-2', 'read-2')).resolves.toMatchObject({
      requestId: 'read-2',
      translatedText: 'translation-2',
      cached: true,
    });
  });

  it('refreshes cached source metadata for the current document', async () => {
    await cacheTranslation(11, 'shared-text', {
      requestId: 'old-request',
      originalText: 'A common sentence.',
      translatedText: '一个常见句子。',
      warnings: [],
      sourceHost: 'first-paper.pdf',
    });

    await expect(getCachedTranslation(
      11,
      'shared-text',
      'new-request',
      'second-paper.pdf',
    )).resolves.toMatchObject({
      requestId: 'new-request',
      translatedText: '一个常见句子。',
      sourceHost: 'second-paper.pdf',
      cached: true,
    });

    await expect(getCachedTranslation(11, 'shared-text', 'no-source'))
      .resolves.not.toHaveProperty('sourceHost');
  });
});
