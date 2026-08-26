import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILINGUAL_PAGE_SESSIONS_STORAGE_KEY,
  bilingualPageSessionBehaviorKey,
  bilingualPageSessionBlockSignature,
  bilingualPageSessionMatchesDocument,
  bilingualPageSessionPageKey,
  clearBilingualPageSession,
  getBilingualPageSession,
  saveBilingualPageSession,
  type BilingualPageSessionDescriptor,
  type BilingualPageSessionUpdate,
} from '../core/translation/bilingual-page-session';

const storage: Record<string, unknown> = {};

const descriptor = (page = 'https://example.com/article'): BilingualPageSessionDescriptor => ({
  pageKey: bilingualPageSessionPageKey(page),
  targetLanguage: 'zh-CN',
  sourceLanguage: 'auto',
  style: 'general',
  contentMode: 'auto',
});

const signatures = [
  bilingualPageSessionBlockSignature('h1', 'A durable article heading', 0),
  bilingualPageSessionBlockSignature('p', 'The first durable article paragraph.', 0),
  bilingualPageSessionBlockSignature('p', 'The second durable article paragraph.', 0),
];

const update = (
  sessionDescriptor = descriptor(),
  block = {
    signature: signatures[0]!,
    translatedText: '可恢复的文章标题',
    hidden: false,
  },
): BilingualPageSessionUpdate => ({
  descriptor: sessionDescriptor,
  documentSignatures: signatures,
  excludedSignatures: [signatures[2]!],
  translationsHidden: false,
  activity: 'active',
  block,
});

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

describe('bilingual webpage session repository', () => {
  it('restores exact page, language and behavior without persisting source text or URLs', async () => {
    const behavior = bilingualPageSessionBehaviorKey('model-a\nsettings-a');
    await saveBilingualPageSession(7, update(), behavior);

    await expect(getBilingualPageSession(7, descriptor(), behavior)).resolves.toMatchObject({
      pageKey: descriptor().pageKey,
      activity: 'active',
      excludedSignatures: [signatures[2]],
      blocks: [{ translatedText: '可恢复的文章标题', hidden: false }],
    });

    const serialized = JSON.stringify(storage[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]);
    expect(serialized).not.toContain('https://example.com/article');
    expect(serialized).not.toContain('The first durable article paragraph.');
  });

  it('upserts translated paragraphs and retains visibility and pause state', async () => {
    const behavior = bilingualPageSessionBehaviorKey('same-behavior');
    await saveBilingualPageSession(7, update(), behavior);
    await saveBilingualPageSession(7, {
      ...update(descriptor(), {
        signature: signatures[1]!,
        translatedText: '可恢复的第一段正文。',
        hidden: true,
      }),
      translationsHidden: true,
      activity: 'paused',
    }, behavior);

    const restored = await getBilingualPageSession(7, descriptor(), behavior);
    expect(restored).toMatchObject({
      translationsHidden: true,
      activity: 'paused',
    });
    expect(restored?.blocks).toEqual([
      {
        signature: signatures[1],
        translatedText: '可恢复的第一段正文。',
        hidden: true,
      },
      {
        signature: signatures[0],
        translatedText: '可恢复的文章标题',
        hidden: false,
      },
    ]);
  });

  it('invalidates stale model behavior and isolates tabs and page descriptors', async () => {
    const firstBehavior = bilingualPageSessionBehaviorKey('model-a');
    const secondBehavior = bilingualPageSessionBehaviorKey('model-b');
    await saveBilingualPageSession(7, update(), firstBehavior);

    await expect(getBilingualPageSession(8, descriptor(), firstBehavior)).resolves.toBeUndefined();
    await expect(getBilingualPageSession(
      7,
      descriptor('https://example.com/another'),
      firstBehavior,
    )).resolves.toBeUndefined();
    await expect(getBilingualPageSession(7, descriptor(), secondBehavior)).resolves.toBeUndefined();
    await expect(getBilingualPageSession(7, descriptor(), firstBehavior)).resolves.toBeUndefined();
  });

  it('clears one descriptor, one tab, or every session without losing concurrent writes', async () => {
    const behavior = bilingualPageSessionBehaviorKey('model-a');
    const anotherDescriptor = descriptor('https://example.com/another');
    await Promise.all([
      saveBilingualPageSession(7, update(), behavior),
      saveBilingualPageSession(7, update(anotherDescriptor), behavior),
      saveBilingualPageSession(8, update(), behavior),
    ]);

    await clearBilingualPageSession(7, descriptor());
    await expect(getBilingualPageSession(7, descriptor(), behavior)).resolves.toBeUndefined();
    await expect(getBilingualPageSession(7, anotherDescriptor, behavior)).resolves.toBeDefined();
    await clearBilingualPageSession(7);
    await expect(getBilingualPageSession(7, anotherDescriptor, behavior)).resolves.toBeUndefined();
    await expect(getBilingualPageSession(8, descriptor(), behavior)).resolves.toBeDefined();
    await clearBilingualPageSession();
    expect(storage[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]).toBeUndefined();
  });
});

describe('bilingual webpage document compatibility', () => {
  it('accepts a partially changed article but rejects unrelated content', () => {
    expect(bilingualPageSessionMatchesDocument(signatures, [
      signatures[0]!,
      signatures[1]!,
      bilingualPageSessionBlockSignature('p', 'A newly added paragraph.', 0),
    ])).toBe(true);
    expect(bilingualPageSessionMatchesDocument(signatures, [
      bilingualPageSessionBlockSignature('h1', 'An unrelated heading', 0),
      bilingualPageSessionBlockSignature('p', 'An unrelated body paragraph.', 0),
      bilingualPageSessionBlockSignature('p', 'Another unrelated paragraph.', 0),
    ])).toBe(false);
    expect(bilingualPageSessionMatchesDocument(
      [signatures[0]!],
      [signatures[0]!],
    )).toBe(true);
    expect(bilingualPageSessionMatchesDocument([], signatures)).toBe(false);
  });
});
