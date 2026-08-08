import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLIED_CONFIGURATION_REVISION_STORAGE_KEY,
  CONFIGURATION_REVISION_STORAGE_KEY,
  ConfigurationRevisionBarrier,
  ConfigurationRevisionMismatchError,
  commitConfigurationRevision,
  configurationRevisionFromStorageChange,
  type ConfigurationRevision,
} from '../core/settings/configuration-revision';

type StorageRecord = Record<string, unknown>;

function createStorageArea(initial: StorageRecord = {}) {
  const values: StorageRecord = { ...initial };
  return {
    values,
    async get(keys: string | string[] | null) {
      if (keys === null) return { ...values };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => key in values).map((key) => [key, values[key]]),
      );
    },
    async set(next: StorageRecord) {
      Object.assign(values, next);
    },
  };
}

function revision(id: string, invalidatesTranslationState = true): ConfigurationRevision {
  return { id, committedAt: 100, invalidatesTranslationState };
}

describe('configuration revision commits', () => {
  let local: ReturnType<typeof createStorageArea>;
  let session: ReturnType<typeof createStorageArea>;

  beforeEach(() => {
    local = createStorageArea();
    session = createStorageArea();
    vi.stubGlobal('browser', { storage: { local, session } });
  });

  it('advances an opaque marker without persisting settings or credentials', async () => {
    const first = await commitConfigurationRevision(true);
    const firstRecord = local.values[CONFIGURATION_REVISION_STORAGE_KEY];
    const second = await commitConfigurationRevision(false);
    const secondRecord = local.values[CONFIGURATION_REVISION_STORAGE_KEY];

    expect(first).not.toBe(second);
    expect(firstRecord).toMatchObject({
      id: first,
      invalidatesTranslationState: true,
    });
    expect(secondRecord).toMatchObject({
      id: second,
      invalidatesTranslationState: false,
    });
    expect(Object.keys(secondRecord as object).sort()).toEqual([
      'committedAt',
      'id',
      'invalidatesTranslationState',
    ]);
  });

  it('extracts only valid local commit markers from storage changes', () => {
    const value = revision('revision-1');
    expect(configurationRevisionFromStorageChange('local', {
      [CONFIGURATION_REVISION_STORAGE_KEY]: { newValue: value },
    })).toEqual(value);
    expect(configurationRevisionFromStorageChange('session', {
      [CONFIGURATION_REVISION_STORAGE_KEY]: { newValue: value },
    })).toBeUndefined();
    expect(configurationRevisionFromStorageChange('local', {
      [CONFIGURATION_REVISION_STORAGE_KEY]: { newValue: { id: 'incomplete' } },
    })).toBeUndefined();
  });

  it('applies and acknowledges the exact revision once across worker restarts', async () => {
    const current = revision('revision-1');
    local.values[CONFIGURATION_REVISION_STORAGE_KEY] = current;
    const apply = vi.fn(async () => undefined);
    const firstWorker = new ConfigurationRevisionBarrier({ apply });

    await firstWorker.waitFor(current.id);

    expect(apply).toHaveBeenCalledOnce();
    expect(session.values[APPLIED_CONFIGURATION_REVISION_STORAGE_KEY]).toBe(current.id);

    const restartedApply = vi.fn(async () => undefined);
    const restartedWorker = new ConfigurationRevisionBarrier({ apply: restartedApply });
    await restartedWorker.waitFor(current.id);
    expect(restartedApply).not.toHaveBeenCalled();
  });

  it('refuses to acknowledge a revision superseded during application', async () => {
    let current = revision('revision-1');
    let releaseApply: (() => void) | undefined;
    const applyBlocked = new Promise<void>((resolve) => { releaseApply = resolve; });
    const barrier = new ConfigurationRevisionBarrier({
      readCurrent: async () => current,
      readApplied: async () => undefined,
      writeApplied: async () => undefined,
      apply: async () => applyBlocked,
    });

    const waiting = barrier.waitFor(current.id);
    await vi.waitFor(() => expect(releaseApply).toBeTypeOf('function'));
    current = revision('revision-2');
    releaseApply?.();

    await expect(waiting).rejects.toBeInstanceOf(ConfigurationRevisionMismatchError);
  });

  it('rejects a stale expected id before retry delivery', async () => {
    const barrier = new ConfigurationRevisionBarrier({
      readCurrent: async () => revision('revision-2'),
      readApplied: async () => undefined,
      writeApplied: async () => undefined,
      apply: async () => undefined,
    });
    await expect(barrier.waitFor('revision-1'))
      .rejects.toBeInstanceOf(ConfigurationRevisionMismatchError);
  });
});
