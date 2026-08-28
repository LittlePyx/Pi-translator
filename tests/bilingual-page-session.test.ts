import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BILINGUAL_PAGE_RETAINED_STORAGE_KEY,
  BILINGUAL_PAGE_SESSIONS_STORAGE_KEY,
  bilingualPageSessionBehaviorKey,
  bilingualPageSessionBlockSignature,
  bilingualPageSessionMatchesDocument,
  bilingualPageSessionPageKey,
  clearBilingualPageSession,
  clearRetainedBilingualPageSession,
  getBilingualPageSession,
  getRetainedBilingualPageSession,
  getRetainedBilingualPageStorageSummary,
  saveBilingualPageSession,
  saveRetainedBilingualPageSession,
  type BilingualPageSessionDescriptor,
  type BilingualPageSessionUpdate,
} from '../core/translation/bilingual-page-session';

const sessionStorage: Record<string, unknown> = {};
const localStorage: Record<string, unknown> = {};

const area = (storage: Record<string, unknown>) => ({
  get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
  set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
  remove: vi.fn(async (key: string) => { delete storage[key]; }),
});

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
  displayMode: 'bilingual',
  translationsHidden: false,
  controlCollapsed: false,
  activity: 'active',
  block,
});

beforeEach(() => {
  for (const key of Object.keys(sessionStorage)) delete sessionStorage[key];
  for (const key of Object.keys(localStorage)) delete localStorage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: area(sessionStorage),
      local: area(localStorage),
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
      controlCollapsed: false,
      excludedSignatures: [signatures[2]],
      blocks: [{ translatedText: '可恢复的文章标题', hidden: false }],
    });

    const serialized = JSON.stringify(sessionStorage[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]);
    expect(serialized).not.toContain('https://example.com/article');
    expect(serialized).not.toContain('The first durable article paragraph.');
  });

  it('retains the compact webpage control state in the browser session', async () => {
    const behavior = bilingualPageSessionBehaviorKey('compact-control');
    await saveBilingualPageSession(7, {
      ...update(),
      controlCollapsed: true,
    }, behavior);

    await expect(getBilingualPageSession(7, descriptor(), behavior)).resolves.toMatchObject({
      controlCollapsed: true,
    });
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
      displayMode: 'source',
      translationsHidden: true,
      activity: 'paused',
    }, behavior);

    const restored = await getBilingualPageSession(7, descriptor(), behavior);
    expect(restored).toMatchObject({
      displayMode: 'source',
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

  it('restores more than the former 240-paragraph limit on long webpages', async () => {
    const behavior = bilingualPageSessionBehaviorKey('long-webpage');
    const longSignatures = Array.from({ length: 520 }, (_, index) => (
      bilingualPageSessionBlockSignature(
        'p',
        `Long webpage paragraph ${String(index + 1).padStart(4, '0')}.`,
        0,
      )
    ));
    const longBlocks = longSignatures.map((signature, index) => ({
      signature,
      translatedText: `长网页译文 ${index + 1}。`,
      hidden: false,
    }));
    await saveBilingualPageSession(7, {
      descriptor: descriptor(),
      documentSignatures: longSignatures,
      excludedSignatures: [],
      displayMode: 'bilingual',
      translationsHidden: false,
      controlCollapsed: true,
      activity: 'active',
      blocks: longBlocks,
      replaceBlocks: true,
    }, behavior);

    const restored = await getBilingualPageSession(7, descriptor(), behavior);
    expect(restored?.documentSignatures).toHaveLength(520);
    expect(restored?.blocks).toHaveLength(520);
    expect(restored?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ translatedText: '长网页译文 520。' }),
    ]));
  });

  it('retains translation-only reading mode without treating translations as hidden', async () => {
    const behavior = bilingualPageSessionBehaviorKey('translation-layout');
    await saveBilingualPageSession(7, {
      ...update(),
      displayMode: 'translation',
      translationsHidden: false,
    }, behavior);

    await expect(getBilingualPageSession(7, descriptor(), behavior)).resolves.toMatchObject({
      displayMode: 'translation',
      translationsHidden: false,
    });
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
    expect(sessionStorage[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]).toBeUndefined();
  });

  it('retains translations locally only after explicit opt-in without storing source or URL', async () => {
    const behavior = bilingualPageSessionBehaviorKey('retained-model');
    const initial = update();
    const { block: initialBlock, ...initialState } = initial;
    await saveRetainedBilingualPageSession({
      ...initialState,
      blocks: [
        initialBlock!,
        {
          signature: signatures[1]!,
          translatedText: '可恢复的第一段正文。',
          hidden: false,
        },
      ],
      replaceBlocks: true,
    }, behavior);

    await expect(getRetainedBilingualPageSession(descriptor(), behavior)).resolves.toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({ translatedText: '可恢复的文章标题' }),
        expect.objectContaining({ translatedText: '可恢复的第一段正文。' }),
      ]),
    });
    expect(sessionStorage[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]).toBeUndefined();
    const serialized = JSON.stringify(localStorage[BILINGUAL_PAGE_RETAINED_STORAGE_KEY]);
    expect(serialized).not.toContain('https://example.com/article');
    expect(serialized).not.toContain('The first durable article paragraph.');
    await expect(getRetainedBilingualPageStorageSummary()).resolves.toMatchObject({
      documentCount: 1,
      translationCharacters: 18,
      maximumDocuments: 6,
      nearingCapacity: false,
    });
  });

  it('keeps an older retained result on behavior changes and bounds local documents', async () => {
    const firstBehavior = bilingualPageSessionBehaviorKey('retained-a');
    const secondBehavior = bilingualPageSessionBehaviorKey('retained-b');
    await saveRetainedBilingualPageSession(update(), firstBehavior);
    await expect(getRetainedBilingualPageSession(descriptor(), secondBehavior)).resolves
      .toBeUndefined();
    await expect(getRetainedBilingualPageSession(descriptor(), firstBehavior)).resolves
      .toBeDefined();

    for (let index = 0; index < 8; index += 1) {
      const current = descriptor(`https://example.com/retained-${index}`);
      await saveRetainedBilingualPageSession(update(current), firstBehavior);
    }
    const retained = localStorage[BILINGUAL_PAGE_RETAINED_STORAGE_KEY];
    expect(Array.isArray(retained) ? retained : []).toHaveLength(6);

    const newest = descriptor('https://example.com/retained-7');
    await clearRetainedBilingualPageSession(newest);
    await expect(getRetainedBilingualPageSession(newest, firstBehavior)).resolves.toBeUndefined();
    await clearRetainedBilingualPageSession();
    expect(localStorage[BILINGUAL_PAGE_RETAINED_STORAGE_KEY]).toBeUndefined();
    await expect(getRetainedBilingualPageStorageSummary()).resolves.toMatchObject({
      documentCount: 0,
      translationCharacters: 0,
      estimatedBytes: 0,
    });
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
