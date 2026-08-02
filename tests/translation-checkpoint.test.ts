import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTranslationCheckpoint,
  getTranslationCheckpoint,
  saveTranslationCheckpoint,
  type TranslationCheckpointChunk,
} from '../core/translation/checkpoint-repository';

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

function completed(
  sourceText: string,
  translatedText: string,
): TranslationCheckpointChunk {
  return {
    sourceText,
    translatedText,
    warnings: [],
  };
}

describe('translation checkpoints', () => {
  it('restores completed chunks and resumes at the first unfinished chunk', async () => {
    const sourceChunks = ['first source', 'second source', 'third source'];
    await saveTranslationCheckpoint(7, 'same-content-and-settings', sourceChunks, [
      completed(sourceChunks[0]!, '第一段'),
      completed(sourceChunks[1]!, '第二段'),
    ]);

    const restored = await getTranslationCheckpoint(
      7,
      'same-content-and-settings',
      sourceChunks,
    );

    expect(restored?.completedChunks.map((chunk) => chunk.translatedText)).toEqual([
      '第一段',
      '第二段',
    ]);
    expect(restored?.completedChunks.length).toBe(2);
    expect(sourceChunks[restored!.completedChunks.length]).toBe('third source');
  });

  it('invalidates the previous checkpoint when text or translation settings change', async () => {
    await saveTranslationCheckpoint(7, 'old-identity', ['old source'], [
      completed('old source', '旧译文'),
    ]);

    await expect(getTranslationCheckpoint(7, 'new-identity', ['new source']))
      .resolves.toBeUndefined();
    await expect(getTranslationCheckpoint(7, 'old-identity', ['old source']))
      .resolves.toBeUndefined();
  });

  it('serializes concurrent writes without losing checkpoints from other tabs', async () => {
    await Promise.all([
      saveTranslationCheckpoint(11, 'key-11', ['source 11'], [
        completed('source 11', '译文 11'),
      ]),
      saveTranslationCheckpoint(22, 'key-22', ['source 22'], [
        completed('source 22', '译文 22'),
      ]),
    ]);

    await expect(getTranslationCheckpoint(11, 'key-11', ['source 11']))
      .resolves.toMatchObject({ completedChunks: [{ translatedText: '译文 11' }] });
    await expect(getTranslationCheckpoint(22, 'key-22', ['source 22']))
      .resolves.toMatchObject({ completedChunks: [{ translatedText: '译文 22' }] });
  });

  it('does not let stale completion cleanup remove a newer checkpoint', async () => {
    await saveTranslationCheckpoint(7, 'new-request', ['new source'], [
      completed('new source', '新译文'),
    ]);

    await clearTranslationCheckpoint(7, 'old-request');

    await expect(getTranslationCheckpoint(7, 'new-request', ['new source']))
      .resolves.toMatchObject({ identity: 'new-request' });
  });

  it('clears only the requested tab or all checkpoints', async () => {
    await saveTranslationCheckpoint(11, 'key-11', ['source 11'], [
      completed('source 11', '译文 11'),
    ]);
    await saveTranslationCheckpoint(22, 'key-22', ['source 22'], [
      completed('source 22', '译文 22'),
    ]);

    await clearTranslationCheckpoint(11);
    await expect(getTranslationCheckpoint(11, 'key-11', ['source 11']))
      .resolves.toBeUndefined();
    await expect(getTranslationCheckpoint(22, 'key-22', ['source 22']))
      .resolves.toBeDefined();

    await clearTranslationCheckpoint();
    await expect(getTranslationCheckpoint(22, 'key-22', ['source 22']))
      .resolves.toBeUndefined();
  });
});
