import type { TranslateResult, TranslationHistoryEntry } from './types';

const HISTORY_KEY = 'translationHistoryByTab';
export const MAX_RECENT_TRANSLATIONS = 20;

type HistoryByTab = Record<string, TranslationHistoryEntry[]>;

function validHistory(value: unknown): HistoryByTab {
  return value && typeof value === 'object' ? (value as HistoryByTab) : {};
}

async function readAll(): Promise<HistoryByTab> {
  const stored = await browser.storage.session.get(HISTORY_KEY);
  return validHistory(stored[HISTORY_KEY]);
}

export async function getTranslationHistory(tabId: number): Promise<TranslationHistoryEntry[]> {
  const history = await readAll();
  const entries = history[String(tabId)];
  return Array.isArray(entries) ? entries : [];
}

export async function addTranslationHistory(
  tabId: number,
  result: TranslateResult,
  limit = 5,
): Promise<TranslationHistoryEntry[]> {
  const history = await readAll();
  const entry: TranslationHistoryEntry = {
    ...result,
    historyId: `${result.requestId}-${Date.now()}`,
    createdAt: Date.now(),
  };
  const storedEntries = history[String(tabId)];
  const previous = Array.isArray(storedEntries) ? storedEntries : [];
  const retained = previous.filter((item) => item.originalText !== result.originalText);
  const pinned = retained.filter((item) => item.pinned);
  const regular = retained.filter((item) => !item.pinned);
  history[String(tabId)] = [entry, ...pinned, ...regular].slice(
    0,
    Math.min(MAX_RECENT_TRANSLATIONS, Math.max(1, limit)),
  );
  await browser.storage.session.set({ [HISTORY_KEY]: history });
  return history[String(tabId)] ?? [];
}

export async function deleteTranslationHistoryEntry(
  tabId: number,
  historyId: string,
): Promise<TranslationHistoryEntry[]> {
  const history = await readAll();
  history[String(tabId)] = (history[String(tabId)] ?? []).filter(
    (entry) => entry.historyId !== historyId,
  );
  await browser.storage.session.set({ [HISTORY_KEY]: history });
  return history[String(tabId)] ?? [];
}

export async function setTranslationHistoryPinned(
  tabId: number,
  historyId: string,
  pinned: boolean,
): Promise<TranslationHistoryEntry[]> {
  const history = await readAll();
  history[String(tabId)] = (history[String(tabId)] ?? []).map((entry) =>
    entry.historyId === historyId ? { ...entry, pinned } : entry,
  );
  await browser.storage.session.set({ [HISTORY_KEY]: history });
  return history[String(tabId)] ?? [];
}

export async function clearTranslationHistory(tabId?: number): Promise<void> {
  if (tabId === undefined) {
    await browser.storage.session.remove(HISTORY_KEY);
    return;
  }
  const history = await readAll();
  delete history[String(tabId)];
  await browser.storage.session.set({ [HISTORY_KEY]: history });
}
