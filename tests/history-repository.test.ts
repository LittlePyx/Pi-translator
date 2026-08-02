import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTranslationHistory, clearTranslationHistory } from '../core/translation/history-repository';

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

describe('recent translation history', () => {
  it('keeps a compact newest-first session history and deduplicates source text', async () => {
    const result = (index: number, originalText = `source-${index}`) => ({
      requestId: `request-${index}`,
      originalText,
      translatedText: `translation-${index}`,
      warnings: [],
      targetLanguage: 'zh-CN',
    });

    await addTranslationHistory(4, result(1), 2);
    await addTranslationHistory(4, result(2), 2);
    const latest = await addTranslationHistory(4, result(3, 'source-1'), 2);

    expect(latest).toHaveLength(2);
    expect(latest.map((entry) => entry.requestId)).toEqual(['request-3', 'request-2']);
    await clearTranslationHistory(4);
    expect(JSON.stringify(storage)).not.toContain('request-3');
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
      addTranslationHistory(11, result(1)),
      addTranslationHistory(22, result(2)),
    ]);

    const history = storage.translationHistoryByTab as Record<
      string,
      Array<{ requestId: string }>
    >;
    expect(history['11']?.[0]?.requestId).toBe('request-1');
    expect(history['22']?.[0]?.requestId).toBe('request-2');
  });
});
