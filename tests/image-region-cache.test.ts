import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheImageRegionTranslation,
  getCachedImageRegionTranslation,
  imageRegionCacheKey,
} from '../core/translation/image-region-cache-repository';

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
  imageDataUrl: 'data:image/png;base64,QUJDRA==',
  imageWidth: 120,
  imageHeight: 60,
  pageUrl: 'https://example.com/paper.pdf',
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto' as const,
  style: 'academic' as const,
};

describe('image region translation cache', () => {
  it('keys pixels and translation behavior without retaining the image', async () => {
    const provider = { apiBaseUrl: 'https://api.example.com/v1', model: 'vision-a' };
    const key = await imageRegionCacheKey(request, provider);
    expect(key).toHaveLength(64);
    expect(key).not.toContain('QUJDRA');
    await expect(imageRegionCacheKey({ ...request, requestId: 'two' }, provider)).resolves.toBe(key);
    await expect(imageRegionCacheKey({ ...request, targetLanguage: 'ja' }, provider)).resolves.not.toBe(key);
    await expect(imageRegionCacheKey(request, {
      ...provider,
      glossary: [{ source: 'ROI', target: '感兴趣区域' }],
    })).resolves.not.toBe(key);
  });

  it('reuses only the result and refreshes source metadata', async () => {
    await cacheImageRegionTranslation(7, 'same-crop', {
      requestId: 'old',
      originalText: 'Recognized text',
      translatedText: '识别文本',
      warnings: [],
      sourceKind: 'image-region',
      sourceHost: 'old.pdf',
    });
    const sourceLocation = {
      documentId: 'document-session-4',
      pageNumber: 2,
      leftRatio: 0.1,
      topRatio: 0.2,
      widthRatio: 0.3,
      heightRatio: 0.4,
    };
    await expect(getCachedImageRegionTranslation(
      7,
      'same-crop',
      'new',
      'new.pdf',
      sourceLocation,
    )).resolves.toMatchObject({
      requestId: 'new',
      translatedText: '识别文本',
      sourceHost: 'new.pdf',
      sourceLocation,
      cached: true,
    });
    expect(JSON.stringify(storage)).not.toContain('data:image');
  });
});
