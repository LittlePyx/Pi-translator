import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTranslationHead,
  readTranslationHead,
  writeTranslationHead,
} from '../core/translation/head-repository';

const storage: Record<string, unknown> = {};

function installBrowserMock(): void {
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
        remove: vi.fn(async (key: string) => { delete storage[key]; }),
      },
    },
  });
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  installBrowserMock();
});

afterEach(() => vi.unstubAllGlobals());

describe('translation head repository', () => {
  it('stores only result identities and keeps tabs isolated', async () => {
    await writeTranslationHead({
      tabId: 7,
      currentResultRequestId: 'result-7',
      rootRequestId: 'root-7',
    });
    await writeTranslationHead({
      tabId: 8,
      currentResultRequestId: 'result-8',
      rootRequestId: 'root-8',
    });

    await expect(readTranslationHead(7)).resolves.toMatchObject({
      tabId: 7,
      currentResultRequestId: 'result-7',
      rootRequestId: 'root-7',
    });
    await expect(readTranslationHead(8)).resolves.toMatchObject({
      tabId: 8,
      currentResultRequestId: 'result-8',
      rootRequestId: 'root-8',
    });
    expect(JSON.stringify(storage)).not.toContain('selected text');
    expect(JSON.stringify(storage)).not.toContain('translated text');
  });

  it('recovers the current head after the repository module is restarted', async () => {
    await writeTranslationHead({
      tabId: 11,
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'original-result',
    });

    vi.resetModules();
    const restarted = await import('../core/translation/head-repository');
    await expect(restarted.readTranslationHead(11)).resolves.toMatchObject({
      tabId: 11,
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'original-result',
    });
  });

  it('rejects a stale compare-and-set without replacing the current result', async () => {
    await writeTranslationHead({
      tabId: 5,
      currentResultRequestId: 'new-result',
      rootRequestId: 'root-result',
    });

    await expect(writeTranslationHead({
      tabId: 5,
      currentResultRequestId: 'stale-correction',
      rootRequestId: 'root-result',
    }, {
      currentResultRequestId: 'old-result',
      rootRequestId: 'root-result',
    })).resolves.toBe(false);
    await expect(readTranslationHead(5)).resolves.toMatchObject({
      currentResultRequestId: 'new-result',
    });
  });

  it('allows a matching compare-and-set and protects newer heads from stale cleanup', async () => {
    await writeTranslationHead({
      tabId: 6,
      currentResultRequestId: 'base-result',
      rootRequestId: 'root-result',
    });
    await expect(writeTranslationHead({
      tabId: 6,
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'root-result',
    }, {
      currentResultRequestId: 'base-result',
      rootRequestId: 'root-result',
    })).resolves.toBe(true);

    await expect(clearTranslationHead(6, {
      currentResultRequestId: 'base-result',
    })).resolves.toBe(false);
    await expect(readTranslationHead(6)).resolves.toMatchObject({
      currentResultRequestId: 'corrected-result',
    });
    await expect(clearTranslationHead(6, {
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'root-result',
    })).resolves.toBe(true);
    await expect(readTranslationHead(6)).resolves.toBeUndefined();
  });

  it('allows exactly one concurrent correction to advance the same base result', async () => {
    await writeTranslationHead({
      tabId: 12,
      currentResultRequestId: 'base-result',
      rootRequestId: 'root-result',
    });

    const outcomes = await Promise.all([
      writeTranslationHead({
        tabId: 12,
        currentResultRequestId: 'correction-a',
        rootRequestId: 'root-result',
      }, {
        currentResultRequestId: 'base-result',
        rootRequestId: 'root-result',
      }),
      writeTranslationHead({
        tabId: 12,
        currentResultRequestId: 'correction-b',
        rootRequestId: 'root-result',
      }, {
        currentResultRequestId: 'base-result',
        rootRequestId: 'root-result',
      }),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const winner = outcomes[0] ? 'correction-a' : 'correction-b';
    await expect(readTranslationHead(12)).resolves.toMatchObject({
      currentResultRequestId: winner,
      rootRequestId: 'root-result',
    });
  });

  it('rejects a stale undo after a newer correction advanced the result head', async () => {
    await writeTranslationHead({
      tabId: 13,
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'root-result',
    });
    await writeTranslationHead({
      tabId: 13,
      currentResultRequestId: 'newer-correction',
      rootRequestId: 'root-result',
    }, {
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'root-result',
    });

    await expect(writeTranslationHead({
      tabId: 13,
      currentResultRequestId: 'stale-undo',
      rootRequestId: 'root-result',
    }, {
      currentResultRequestId: 'corrected-result',
      rootRequestId: 'root-result',
    })).resolves.toBe(false);
    await expect(readTranslationHead(13)).resolves.toMatchObject({
      currentResultRequestId: 'newer-correction',
    });
  });

  it('removes malformed stored heads instead of trusting them', async () => {
    storage['translationResultHead:9'] = {
      tabId: 9,
      currentResultRequestId: '',
      rootRequestId: 'root',
      updatedAt: Date.now(),
    };

    await expect(readTranslationHead(9)).resolves.toBeUndefined();
    expect(storage['translationResultHead:9']).toBeUndefined();
  });
});
