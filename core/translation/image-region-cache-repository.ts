import type { GlossaryEntry, PdfSourceLocation, TranslateImageRegionRequest, TranslateResult } from './types';

const CACHE_KEY = 'imageRegionTranslationCacheByTab';
const MAX_CACHE_ENTRIES = 20;

interface ImageRegionCacheEntry {
  key: string;
  result: TranslateResult;
  createdAt: number;
}

type ImageRegionCacheByTab = Record<string, ImageRegionCacheEntry[]>;

let cacheWriteTail: Promise<void> = Promise.resolve();

function serializeCacheWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = cacheWriteTail.catch(() => undefined).then(operation);
  cacheWriteTail = next.then(() => undefined, () => undefined);
  return next;
}

function cacheByTab(value: unknown): ImageRegionCacheByTab {
  return value && typeof value === 'object' ? value as ImageRegionCacheByTab : {};
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function imageRegionCacheKey(
  request: TranslateImageRegionRequest,
  provider: { apiBaseUrl: string; model: string; glossary?: GlossaryEntry[] },
): Promise<string> {
  const imageDigest = await sha256(request.imageDataUrl);
  return sha256(JSON.stringify({
    imageDigest,
    imageWidth: request.imageWidth,
    imageHeight: request.imageHeight,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    style: request.style,
    apiBaseUrl: provider.apiBaseUrl,
    model: provider.model,
    glossary: provider.glossary,
  }));
}

async function readAll(): Promise<ImageRegionCacheByTab> {
  const stored = await browser.storage.session.get(CACHE_KEY);
  return cacheByTab(stored[CACHE_KEY]);
}

export async function getCachedImageRegionTranslation(
  tabId: number,
  key: string,
  requestId: string,
  sourceHost?: string,
  sourceLocation?: PdfSourceLocation,
): Promise<TranslateResult | undefined> {
  const all = await readAll();
  const entry = all[String(tabId)]?.find((item) => item.key === key);
  if (!entry) return undefined;
  const {
    sourceHost: _storedSourceHost,
    sourceLocation: _storedSourceLocation,
    ...storedResult
  } = entry.result;
  return {
    ...storedResult,
    requestId,
    cached: true,
    completedAt: Date.now(),
    ...(sourceHost ? { sourceHost } : {}),
    ...(sourceLocation ? { sourceLocation } : {}),
  };
}

export async function cacheImageRegionTranslation(
  tabId: number,
  key: string,
  result: TranslateResult,
): Promise<void> {
  return serializeCacheWrite(async () => {
    const all = await readAll();
    const previous = all[String(tabId)] ?? [];
    all[String(tabId)] = [
      { key, result: { ...result, cached: false }, createdAt: Date.now() },
      ...previous.filter((entry) => entry.key !== key),
    ].slice(0, MAX_CACHE_ENTRIES);
    await browser.storage.session.set({ [CACHE_KEY]: all });
  });
}

export async function clearImageRegionTranslationCache(tabId?: number): Promise<void> {
  return serializeCacheWrite(async () => {
    if (tabId === undefined) {
      await browser.storage.session.remove(CACHE_KEY);
      return;
    }
    const all = await readAll();
    delete all[String(tabId)];
    await browser.storage.session.set({ [CACHE_KEY]: all });
  });
}
