import { describe, expect, it } from 'vitest';
import { translationCacheKey } from '../core/translation/cache-repository';

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
  });
});
