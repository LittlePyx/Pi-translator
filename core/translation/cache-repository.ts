import type { PdfSourceLocation, TranslateRequest, TranslateResult } from './types';

const CACHE_KEY = 'translationCacheByTab';
const MAX_CACHE_ENTRIES = 20;

interface CacheEntry {
  key: string;
  result: TranslateResult;
  createdAt: number;
}

type CacheByTab = Record<string, CacheEntry[]>;

let cacheWriteTail: Promise<void> = Promise.resolve();

function serializeCacheWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = cacheWriteTail.catch(() => undefined).then(operation);
  cacheWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function cacheByTab(value: unknown): CacheByTab {
  return value && typeof value === 'object' ? (value as CacheByTab) : {};
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function translationCacheKey(
  request: TranslateRequest,
  provider: {
    apiBaseUrl: string;
    model: string;
    glossary: Array<{ source: string; target: string }>;
  },
): string {
  return hash(JSON.stringify({
    text: request.text.trim(),
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    style: request.style,
    contentMode: request.contentMode,
    contextText: request.contextText?.trim() ?? '',
    revision: request.revision
      ? {
          kind: request.revision.kind,
          instruction: request.revision.instruction.trim(),
          previousTranslation: request.revision.previousTranslation?.trim() ?? '',
          scope: request.revision.scope ?? 'current',
        }
      : undefined,
    apiBaseUrl: provider.apiBaseUrl,
    model: provider.model,
    glossary: provider.glossary,
  }));
}

async function readAll(): Promise<CacheByTab> {
  const stored = await browser.storage.session.get(CACHE_KEY);
  return cacheByTab(stored[CACHE_KEY]);
}

export async function getCachedTranslation(
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
    ...result
  } = entry.result;
  return {
    ...result,
    requestId,
    cached: true,
    completedAt: Date.now(),
    ...(sourceHost ? { sourceHost } : {}),
    ...(sourceLocation ? { sourceLocation } : {}),
  };
}

export async function cacheTranslation(
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

export async function clearTranslationCache(tabId?: number): Promise<void> {
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
