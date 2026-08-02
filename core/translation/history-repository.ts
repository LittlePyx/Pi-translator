import type { TranslateResult, TranslationHistoryEntry } from './types';

const HISTORY_KEY = 'translationHistoryByTab';
export const MAX_RECENT_TRANSLATIONS = 20;

type HistoryByTab = Record<string, TranslationHistoryEntry[]>;

let historyWriteTail: Promise<void> = Promise.resolve();

function serializeHistoryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = historyWriteTail.catch(() => undefined).then(operation);
  historyWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function validHistory(value: unknown): HistoryByTab {
  return value && typeof value === 'object' ? (value as HistoryByTab) : {};
}

async function readAll(): Promise<HistoryByTab> {
  const stored = await browser.storage.session.get(HISTORY_KEY);
  return validHistory(stored[HISTORY_KEY]);
}

export async function addTranslationHistory(
  tabId: number,
  result: TranslateResult,
  limit = 5,
): Promise<TranslationHistoryEntry[]> {
  return serializeHistoryWrite(async () => {
    const history = await readAll();
    const entry: TranslationHistoryEntry = {
      ...result,
      historyId: `${result.requestId}-${Date.now()}`,
      createdAt: Date.now(),
    };
    const storedEntries = history[String(tabId)];
    const previous = Array.isArray(storedEntries) ? storedEntries : [];
    const retained = previous.filter((item) => item.originalText !== result.originalText);
    history[String(tabId)] = [entry, ...retained].slice(
      0,
      Math.min(MAX_RECENT_TRANSLATIONS, Math.max(1, limit)),
    );
    await browser.storage.session.set({ [HISTORY_KEY]: history });
    return history[String(tabId)] ?? [];
  });
}

export async function clearTranslationHistory(tabId?: number): Promise<void> {
  return serializeHistoryWrite(async () => {
    if (tabId === undefined) {
      await browser.storage.session.remove(HISTORY_KEY);
      return;
    }
    const history = await readAll();
    delete history[String(tabId)];
    await browser.storage.session.set({ [HISTORY_KEY]: history });
  });
}
