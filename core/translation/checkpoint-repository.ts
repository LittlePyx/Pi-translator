import type { GlossaryEntry, TranslationSegment, TranslationWarning } from './types';

const CHECKPOINT_KEY = 'translationCheckpointsByTab';

export interface TranslationCheckpointChunk {
  sourceText: string;
  translatedText: string;
  warnings: TranslationWarning[];
  detectedLanguage?: string;
  alignedSegments?: TranslationSegment[];
  termCandidates?: GlossaryEntry[];
}

export interface TranslationCheckpoint {
  identity: string;
  totalChunks: number;
  completedChunks: TranslationCheckpointChunk[];
  updatedAt: number;
}

type CheckpointsByTab = Record<string, TranslationCheckpoint>;

let checkpointWriteTail: Promise<void> = Promise.resolve();

function serializeCheckpointOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = checkpointWriteTail.catch(() => undefined).then(operation);
  checkpointWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function checkpointsByTab(value: unknown): CheckpointsByTab {
  return value && typeof value === 'object' ? (value as CheckpointsByTab) : {};
}

async function readAll(): Promise<CheckpointsByTab> {
  const stored = await browser.storage.session.get(CHECKPOINT_KEY);
  return checkpointsByTab(stored[CHECKPOINT_KEY]);
}

function isValidCheckpoint(
  value: TranslationCheckpoint | undefined,
  identity: string,
  sourceChunks: readonly string[],
): value is TranslationCheckpoint {
  if (
    !value ||
    value.identity !== identity ||
    value.totalChunks !== sourceChunks.length ||
    !Array.isArray(value.completedChunks) ||
    value.completedChunks.length > sourceChunks.length
  ) return false;

  return value.completedChunks.every((chunk, index) => (
    chunk?.sourceText === sourceChunks[index] &&
    typeof chunk.translatedText === 'string' &&
    Boolean(chunk.translatedText.trim()) &&
    Array.isArray(chunk.warnings)
  ));
}

function cloneCheckpoint(checkpoint: TranslationCheckpoint): TranslationCheckpoint {
  return {
    ...checkpoint,
    completedChunks: checkpoint.completedChunks.map((chunk) => ({
      ...chunk,
      warnings: chunk.warnings.map((warning) => ({ ...warning })),
      ...(chunk.alignedSegments
        ? { alignedSegments: chunk.alignedSegments.map((segment) => ({ ...segment })) }
        : {}),
      ...(chunk.termCandidates
        ? { termCandidates: chunk.termCandidates.map((term) => ({ ...term })) }
        : {}),
    })),
  };
}

/**
 * Loads the only resumable text translation for a tab. A different request
 * identity or chunk plan invalidates the previous checkpoint immediately.
 */
export function getTranslationCheckpoint(
  tabId: number,
  identity: string,
  sourceChunks: readonly string[],
): Promise<TranslationCheckpoint | undefined> {
  return serializeCheckpointOperation(async () => {
    const all = await readAll();
    const key = String(tabId);
    const checkpoint = all[key];
    if (!checkpoint) return undefined;
    if (isValidCheckpoint(checkpoint, identity, sourceChunks)) {
      return cloneCheckpoint(checkpoint);
    }
    delete all[key];
    await browser.storage.session.set({ [CHECKPOINT_KEY]: all });
    return undefined;
  });
}

export function saveTranslationCheckpoint(
  tabId: number,
  identity: string,
  sourceChunks: readonly string[],
  completedChunks: readonly TranslationCheckpointChunk[],
): Promise<void> {
  if (
    completedChunks.length > sourceChunks.length ||
    completedChunks.some((chunk, index) => chunk.sourceText !== sourceChunks[index])
  ) {
    return Promise.reject(new Error('Translation checkpoint does not match its chunk plan.'));
  }

  return serializeCheckpointOperation(async () => {
    const all = await readAll();
    all[String(tabId)] = cloneCheckpoint({
      identity,
      totalChunks: sourceChunks.length,
      completedChunks: completedChunks.map((chunk) => ({
        ...chunk,
        warnings: chunk.warnings.map((warning) => ({ ...warning })),
        ...(chunk.alignedSegments
          ? { alignedSegments: chunk.alignedSegments.map((segment) => ({ ...segment })) }
          : {}),
        ...(chunk.termCandidates
          ? { termCandidates: chunk.termCandidates.map((term) => ({ ...term })) }
          : {}),
      })),
      updatedAt: Date.now(),
    });
    await browser.storage.session.set({ [CHECKPOINT_KEY]: all });
  });
}

export function clearTranslationCheckpoint(
  tabId?: number,
  expectedIdentity?: string,
): Promise<void> {
  return serializeCheckpointOperation(async () => {
    if (tabId === undefined) {
      await browser.storage.session.remove(CHECKPOINT_KEY);
      return;
    }
    const all = await readAll();
    const key = String(tabId);
    if (!(key in all)) return;
    if (expectedIdentity !== undefined && all[key]?.identity !== expectedIdentity) return;
    delete all[key];
    await browser.storage.session.set({ [CHECKPOINT_KEY]: all });
  });
}
