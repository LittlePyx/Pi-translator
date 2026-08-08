import { createPerTabAsyncLane } from '../runtime/per-tab-async-lane';

const TRANSLATION_HEAD_KEY_PREFIX = 'translationResultHead:';
const MAX_REQUEST_ID_LENGTH = 256;

export interface TranslationHeadInput {
  tabId: number;
  currentResultRequestId: string;
  rootRequestId: string;
}

export interface TranslationHead extends TranslationHeadInput {
  updatedAt: number;
}

export interface TranslationHeadExpectation {
  currentResultRequestId: string;
  rootRequestId?: string;
}

const runForTab = createPerTabAsyncLane();

function storageKey(tabId: number): string {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error('A valid tab ID is required for the translation head.');
  }
  return `${TRANSLATION_HEAD_KEY_PREFIX}${tabId}`;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= MAX_REQUEST_ID_LENGTH;
}

function validHead(value: unknown, tabId: number): value is TranslationHead {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TranslationHead>;
  return candidate.tabId === tabId &&
    validRequestId(candidate.currentResultRequestId) &&
    validRequestId(candidate.rootRequestId) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt) &&
    candidate.updatedAt >= 0;
}

function assertHeadInput(head: TranslationHeadInput): void {
  storageKey(head.tabId);
  if (!validRequestId(head.currentResultRequestId) || !validRequestId(head.rootRequestId)) {
    throw new Error('Translation head request IDs must be non-empty.');
  }
}

function assertExpectation(expectation: TranslationHeadExpectation): void {
  if (
    !validRequestId(expectation.currentResultRequestId) ||
    (expectation.rootRequestId !== undefined && !validRequestId(expectation.rootRequestId))
  ) {
    throw new Error('Translation head expectation request IDs must be non-empty.');
  }
}

function matchesExpectation(
  head: TranslationHead | undefined,
  expectation: TranslationHeadExpectation,
): boolean {
  return Boolean(
    head &&
    head.currentResultRequestId === expectation.currentResultRequestId &&
    (
      expectation.rootRequestId === undefined ||
      head.rootRequestId === expectation.rootRequestId
    ),
  );
}

function cloneHead(head: TranslationHead): TranslationHead {
  return { ...head };
}

async function readStoredHead(tabId: number): Promise<TranslationHead | undefined> {
  const key = storageKey(tabId);
  const stored = await browser.storage.session.get(key);
  const value = stored[key];
  if (value === undefined) return undefined;
  if (validHead(value, tabId)) return cloneHead(value);
  await browser.storage.session.remove(key);
  return undefined;
}

/** Reads the current result identity for a tab from session-backed storage. */
export function readTranslationHead(tabId: number): Promise<TranslationHead | undefined> {
  return runForTab(tabId, () => readStoredHead(tabId));
}

/**
 * Writes a tab's current result identity. When an expectation is supplied the
 * write is a compare-and-set and returns false if a newer result is current.
 */
export function writeTranslationHead(
  head: TranslationHeadInput,
  expectation?: TranslationHeadExpectation,
): Promise<boolean> {
  assertHeadInput(head);
  if (expectation) assertExpectation(expectation);
  return runForTab(head.tabId, async () => {
    if (expectation && !matchesExpectation(await readStoredHead(head.tabId), expectation)) {
      return false;
    }
    const stored: TranslationHead = {
      ...head,
      updatedAt: Date.now(),
    };
    await browser.storage.session.set({ [storageKey(head.tabId)]: stored });
    return true;
  });
}

/**
 * Clears a tab head. An optional expectation prevents stale cleanup from
 * removing a newer result.
 */
export function clearTranslationHead(
  tabId: number,
  expectation?: TranslationHeadExpectation,
): Promise<boolean> {
  storageKey(tabId);
  if (expectation) assertExpectation(expectation);
  return runForTab(tabId, async () => {
    const current = await readStoredHead(tabId);
    if (!current || (expectation && !matchesExpectation(current, expectation))) return false;
    await browser.storage.session.remove(storageKey(tabId));
    return true;
  });
}
