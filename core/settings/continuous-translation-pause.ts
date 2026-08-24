import { browser } from 'wxt/browser';

const STORAGE_KEY = 'continuousTranslationPausedTabIdsV1';
const MAX_PAUSED_TABS = 200;

let pauseWriteTail: Promise<void> = Promise.resolve();

export function normalizeContinuousTranslationPausedTabIds(
  values: Iterable<unknown>,
): number[] {
  return [
    ...new Set(
      [...values].filter((value): value is number => (
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      )),
    ),
  ].sort((left, right) => left - right).slice(-MAX_PAUSED_TABS);
}

async function readPausedTabIds(): Promise<number[]> {
  const stored = await browser.storage.session.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return Array.isArray(value) ? normalizeContinuousTranslationPausedTabIds(value) : [];
}

export async function isContinuousTranslationPaused(tabId: number): Promise<boolean> {
  await pauseWriteTail.catch(() => undefined);
  return (await readPausedTabIds()).includes(tabId);
}

export function setContinuousTranslationPaused(
  tabId: number,
  paused: boolean,
): Promise<void> {
  const operation = pauseWriteTail.catch(() => undefined).then(async () => {
    const tabIds = new Set(await readPausedTabIds());
    if (paused) tabIds.add(tabId);
    else tabIds.delete(tabId);
    const normalized = normalizeContinuousTranslationPausedTabIds(tabIds);
    if (normalized.length) {
      await browser.storage.session.set({ [STORAGE_KEY]: normalized });
    } else {
      await browser.storage.session.remove(STORAGE_KEY);
    }
  });
  pauseWriteTail = operation;
  return operation;
}
