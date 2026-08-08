import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEYS_STORAGE_KEY,
  changedApiCredentialProfileIds,
  clearApiKey,
  getApiKey,
  getSettings,
  mutateApiConfiguration,
  mutateSettings,
  saveApiKey,
  saveSettings,
} from '../core/settings/repository';
import { CONFIGURATION_REVISION_STORAGE_KEY } from '../core/settings/configuration-revision';
import { DEFAULT_SETTINGS } from '../core/settings/schema';

type StorageRecord = Record<string, unknown>;

function createStorageArea(initial: StorageRecord = {}) {
  const values: StorageRecord = { ...initial };
  const setFailures: Array<(next: StorageRecord) => boolean> = [];
  const removeFailures: Array<(keys: string[]) => boolean> = [];
  return {
    values,
    failNextSet(predicate: (next: StorageRecord) => boolean) {
      setFailures.push(predicate);
    },
    failNextRemove(predicate: (keys: string[]) => boolean) {
      removeFailures.push(predicate);
    },
    async get(keys: string | string[] | null) {
      if (keys === null) return { ...values };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested
          .filter((key) => key in values)
          .map((key) => [key, values[key]]),
      );
    },
    async set(next: StorageRecord) {
      const failureIndex = setFailures.findIndex((predicate) => predicate(next));
      if (failureIndex >= 0) {
        setFailures.splice(failureIndex, 1);
        throw new Error('Injected storage.set failure');
      }
      Object.assign(values, next);
    },
    async remove(keys: string | string[]) {
      const requested = Array.isArray(keys) ? keys : [keys];
      const failureIndex = removeFailures.findIndex((predicate) => predicate(requested));
      if (failureIndex >= 0) {
        removeFailures.splice(failureIndex, 1);
        throw new Error('Injected storage.remove failure');
      }
      for (const key of requested) delete values[key];
    },
    async setAccessLevel() {},
  };
}

function createOriginLockManager() {
  let tail: Promise<void> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => T | Promise<T>): Promise<T> {
      const operation = tail.then(callback, callback);
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

describe('settings upgrade and browser-restart storage policy', () => {
  let local: ReturnType<typeof createStorageArea>;
  let session: ReturnType<typeof createStorageArea>;

  beforeEach(() => {
    local = createStorageArea();
    session = createStorageArea();
    vi.stubGlobal('browser', {
      storage: { local, session },
    });
    vi.stubGlobal('navigator', { locks: createOriginLockManager() });
  });

  it('upgrades a pre-profile configuration without losing user preferences', async () => {
    local.values.extensionSettings = {
      schemaVersion: 4,
      apiBaseUrl: 'https://legacy.example/v1',
      model: 'legacy-academic-model',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      style: 'literal',
      contentMode: 'latex',
      apiKeyStorage: 'local',
      generalPageMode: 'allowlist',
      siteAllowlist: ['arxiv.org', 42, 'docs.example.org'],
      academicGlossary: [
        { source: 'single-pixel imaging', target: '単一画素イメージング' },
        { source: 3, target: 'invalid' },
      ],
      sidebarWidth: 999,
      pdfRegionShortcutKey: 'Q',
    };

    const settings = await getSettings();

    expect(settings.schemaVersion).toBe(8);
    expect(settings.apiProfiles).toEqual([{
      id: 'default',
      name: '默认接口',
      apiBaseUrl: 'https://legacy.example/v1',
      model: 'legacy-academic-model',
    }]);
    expect(settings.activeApiProfileId).toBe('default');
    expect(settings.apiBaseUrl).toBe('https://legacy.example/v1');
    expect(settings.model).toBe('legacy-academic-model');
    expect(settings.targetLanguage).toBe('ja');
    expect(settings.style).toBe('literal');
    expect(settings.contentMode).toBe('latex');
    expect(settings.generalPageMode).toBe('allowlist');
    expect(settings.siteAllowlist).toEqual(['arxiv.org', 'docs.example.org']);
    expect(settings.academicGlossary).toEqual([
      { source: 'single-pixel imaging', target: '単一画素イメージング' },
    ]);
    expect(settings.sidebarWidth).toBe(640);
    expect(settings.pdfRegionShortcutKey).toBe('q');
    expect(settings.autoRenderLatex).toBe(true);
    expect(settings.onboardingCompleted).toBe(true);
  });

  it('keeps local keys across a simulated restart and drops session-only keys', async () => {
    const sessionRevision = await saveApiKey('session-only-key', 'session', 'session-profile');
    const localRevision = await saveApiKey('persistent-key', 'local', 'local-profile');

    expect(await getApiKey('session-profile')).toBe('session-only-key');
    expect(await getApiKey('local-profile')).toBe('persistent-key');
    expect(sessionRevision).not.toBe(localRevision);
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toMatchObject({
      id: localRevision,
      invalidatesTranslationState: true,
    });

    session = createStorageArea();
    vi.stubGlobal('browser', {
      storage: { local, session },
    });

    expect(await getApiKey('session-profile')).toBeUndefined();
    expect(await getApiKey('local-profile')).toBe('persistent-key');
    expect(local.values[API_KEYS_STORAGE_KEY]).toEqual({
      'local-profile': 'persistent-key',
    });
  });

  it('migrates the original single-key fields into the default profile', async () => {
    local.values.deepseekApiKey = 'legacy-local-key';

    expect(await getApiKey('default')).toBe('legacy-local-key');
    await saveApiKey('replacement-key', 'local', 'default');

    expect(await getApiKey('default')).toBe('replacement-key');
    expect(local.values.deepseekApiKey).toBeUndefined();
    expect(local.values.apiKey).toBeUndefined();
    expect(local.values[API_KEYS_STORAGE_KEY]).toEqual({
      default: 'replacement-key',
    });
  });

  it('commits settings with a revision and avoids invalidating presentation-only changes', async () => {
    const firstRevision = await saveSettings(DEFAULT_SETTINGS);
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toMatchObject({
      id: firstRevision,
      invalidatesTranslationState: true,
    });

    const secondRevision = await saveSettings({
      ...DEFAULT_SETTINGS,
      sidebarWidth: DEFAULT_SETTINGS.sidebarWidth + 20,
    });
    expect(secondRevision).not.toBe(firstRevision);
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toMatchObject({
      id: secondRevision,
      invalidatesTranslationState: false,
    });

    const visionRevision = await saveSettings({
      ...DEFAULT_SETTINGS,
      sidebarWidth: DEFAULT_SETTINGS.sidebarWidth + 20,
      visionApiProfileId: DEFAULT_SETTINGS.activeApiProfileId,
      visionModel: 'vision-model-v2',
    });
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toMatchObject({
      id: visionRevision,
      invalidatesTranslationState: true,
    });
  });

  it('serializes a slow glossary mutation after an ordinary settings save', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    let releaseMutation!: () => void;
    let markMutationStarted!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });

    const save = saveSettings({
      ...DEFAULT_SETTINGS,
      sidebarWidth: 444,
    });
    const mutation = mutateSettings(async (current) => {
      markMutationStarted();
      await mutationGate;
      return {
        nextSettings: {
          ...current,
          academicGlossary: [
            ...current.academicGlossary,
            { source: 'single-pixel imaging', target: '单像素成像' },
          ],
        },
        value: 'term-added',
      };
    });

    await mutationStarted;
    releaseMutation();
    const [revisionId, result] = await Promise.all([save, mutation]);

    expect(result.value).toBe('term-added');
    expect(result.revisionId).not.toBeNull();
    expect(result.revisionId).not.toBe(revisionId);
    expect(result.settings.sidebarWidth).toBe(444);
    expect(result.settings.academicGlossary).toEqual([
      { source: 'single-pixel imaging', target: '单像素成像' },
    ]);
    expect(await getSettings()).toMatchObject({
      sidebarWidth: 444,
      academicGlossary: [
        { source: 'single-pixel imaging', target: '单像素成像' },
      ],
    });
  });

  it('skips a conditional rollback when the glossary term changed later', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      academicGlossary: [{ source: 'attention', target: '注意力' }],
    });

    const applied = await mutateSettings((current) => ({
      nextSettings: {
        ...current,
        academicGlossary: [{ source: 'attention', target: '注意机制' }],
      },
      value: { source: 'attention', appliedTarget: '注意机制' },
    }));
    await mutateSettings((current) => ({
      nextSettings: {
        ...current,
        academicGlossary: [{ source: 'attention', target: '注意力机制' }],
      },
      value: undefined,
    }));

    const rollback = await mutateSettings((current) => {
      const currentTerm = current.academicGlossary.find(
        (entry) => entry.source === applied.value.source,
      );
      if (currentTerm?.target !== applied.value.appliedTarget) {
        return { nextSettings: null, value: false };
      }
      return {
        nextSettings: {
          ...current,
          academicGlossary: [{ source: 'attention', target: '注意力' }],
        },
        value: true,
      };
    });

    expect(rollback.value).toBe(false);
    expect(rollback.revisionId).toBeNull();
    expect(rollback.settings.academicGlossary).toEqual([
      { source: 'attention', target: '注意力机制' },
    ]);
    expect((await getSettings()).academicGlossary).toEqual([
      { source: 'attention', target: '注意力机制' },
    ]);
  });

  it('uses the origin lock to serialize mutations from separate extension realms', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    vi.resetModules();
    const firstRealm = await import('../core/settings/repository');
    vi.resetModules();
    const secondRealm = await import('../core/settings/repository');
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });

    const first = firstRealm.mutateSettings(async (current) => {
      firstStarted();
      await gate;
      return {
        nextSettings: { ...current, sidebarWidth: 470 },
        value: undefined,
      };
    });
    await started;
    const second = secondRealm.mutateSettings((current) => ({
      nextSettings: {
        ...current,
        academicGlossary: [{ source: 'diffusion model', target: '扩散模型' }],
      },
      value: undefined,
    }));
    releaseFirst();
    await Promise.all([first, second]);

    expect(await secondRealm.getSettings()).toMatchObject({
      sidebarWidth: 470,
      academicGlossary: [{ source: 'diffusion model', target: '扩散模型' }],
    });
  });

  it('does not lose another profile when separate realms save and clear keys concurrently', async () => {
    await saveApiKey('key-a', 'local', 'profile-a');
    await saveApiKey('key-b', 'local', 'profile-b');
    await saveApiKey('key-c', 'local', 'profile-c');
    vi.resetModules();
    const firstRealm = await import('../core/settings/repository');
    vi.resetModules();
    const secondRealm = await import('../core/settings/repository');

    await Promise.all([
      firstRealm.clearApiKey('profile-a'),
      secondRealm.clearApiKey('profile-b'),
      firstRealm.saveApiKey('key-d', 'local', 'profile-d'),
    ]);

    expect(await secondRealm.getApiKey('profile-a')).toBeUndefined();
    expect(await secondRealm.getApiKey('profile-b')).toBeUndefined();
    expect(await secondRealm.getApiKey('profile-c')).toBe('key-c');
    expect(await secondRealm.getApiKey('profile-d')).toBe('key-d');
    expect(local.values[API_KEYS_STORAGE_KEY]).toEqual({
      'profile-c': 'key-c',
      'profile-d': 'key-d',
    });
  });

  it('keeps a key for model-only changes but isolates endpoint changes and deletions', () => {
    const profile = DEFAULT_SETTINGS.apiProfiles[0]!;
    expect(changedApiCredentialProfileIds(
      [profile],
      [{ ...profile, model: 'another-model-at-the-same-endpoint' }],
    )).toEqual([]);
    expect(changedApiCredentialProfileIds(
      [profile],
      [{ ...profile, apiBaseUrl: 'https://another.example/v1' }],
    )).toEqual([profile.id]);
    expect(changedApiCredentialProfileIds([profile], [])).toEqual([profile.id]);
  });

  it('rejects a pending key when another settings page deleted its profile', async () => {
    const deletedProfile = { ...DEFAULT_SETTINGS.apiProfiles[0]! };
    const remainingProfile = {
      ...deletedProfile,
      id: 'remaining-profile',
      name: 'Remaining profile',
    };
    await saveSettings({
      ...DEFAULT_SETTINGS,
      apiProfiles: [remainingProfile],
      activeApiProfileId: remainingProfile.id,
      apiBaseUrl: remainingProfile.apiBaseUrl,
      model: remainingProfile.model,
    });
    const revisionBefore = local.values[CONFIGURATION_REVISION_STORAGE_KEY];

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: {
        ...current,
        apiProfiles: [...current.apiProfiles, deletedProfile],
      },
      credentials: {
        requireCurrentProfiles: [{
          id: deletedProfile.id,
          apiBaseUrl: deletedProfile.apiBaseUrl,
        }],
        saveApiKey: {
          apiKey: 'stale-page-key',
          mode: 'session',
          profileId: deletedProfile.id,
        },
      },
      value: undefined,
    }))).rejects.toThrow('另一个设置页');

    expect((await getSettings()).apiProfiles).toEqual([remainingProfile]);
    expect(await getApiKey(deletedProfile.id)).toBeUndefined();
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toBe(revisionBefore);
  });

  it('never writes a key for a profile missing from the committed settings', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const revisionBefore = local.values[CONFIGURATION_REVISION_STORAGE_KEY];

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: current,
      credentials: {
        saveApiKey: {
          apiKey: 'orphan-key',
          mode: 'local',
          profileId: 'missing-profile',
        },
      },
      value: undefined,
    }))).rejects.toThrow('配置不存在');

    expect(await getApiKey('missing-profile')).toBeUndefined();
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toBe(revisionBefore);
  });

  it('allows a pending key after a concurrent model-only change at the same endpoint', async () => {
    const profile = DEFAULT_SETTINGS.apiProfiles[0]!;
    const modelChanged = { ...profile, model: 'newer-model' };
    await saveSettings({
      ...DEFAULT_SETTINGS,
      apiProfiles: [modelChanged],
      model: modelChanged.model,
    });

    await mutateApiConfiguration((current) => ({
      nextSettings: current,
      credentials: {
        requireCurrentProfiles: [{ id: profile.id, apiBaseUrl: profile.apiBaseUrl }],
        saveApiKey: {
          apiKey: 'same-endpoint-key',
          mode: 'session',
          profileId: profile.id,
        },
      },
      value: undefined,
    }));

    expect((await getSettings()).model).toBe('newer-model');
    expect(await getApiKey(profile.id)).toBe('same-endpoint-key');
  });

  it('rejects a pending key when another settings page changed its endpoint', async () => {
    const baselineProfile = DEFAULT_SETTINGS.apiProfiles[0]!;
    const endpointChanged = {
      ...baselineProfile,
      apiBaseUrl: 'https://newer-provider.example/v1',
    };
    await saveSettings({
      ...DEFAULT_SETTINGS,
      apiProfiles: [endpointChanged],
      apiBaseUrl: endpointChanged.apiBaseUrl,
    });
    const revisionBefore = local.values[CONFIGURATION_REVISION_STORAGE_KEY];

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: current,
      credentials: {
        requireCurrentProfiles: [{
          id: baselineProfile.id,
          apiBaseUrl: baselineProfile.apiBaseUrl,
        }],
        saveApiKey: {
          apiKey: 'wrong-provider-key',
          mode: 'session',
          profileId: baselineProfile.id,
        },
      },
      value: undefined,
    }))).rejects.toThrow('另一个设置页');

    expect((await getSettings()).apiBaseUrl).toBe(endpointChanged.apiBaseUrl);
    expect(await getApiKey(baselineProfile.id)).toBeUndefined();
    expect(local.values[CONFIGURATION_REVISION_STORAGE_KEY]).toBe(revisionBefore);
  });

  it('serializes a storage-mode move with a concurrent profile clear', async () => {
    const profileA = { ...DEFAULT_SETTINGS.apiProfiles[0]!, id: 'profile-a' };
    const profileB = { ...DEFAULT_SETTINGS.apiProfiles[0]!, id: 'profile-b' };
    await saveSettings({
      ...DEFAULT_SETTINGS,
      apiProfiles: [profileA, profileB],
      activeApiProfileId: profileA.id,
      apiBaseUrl: profileA.apiBaseUrl,
      model: profileA.model,
    });
    await saveApiKey('key-a', 'session', profileA.id);
    await saveApiKey('key-b', 'session', profileB.id);
    vi.resetModules();
    const firstRealm = await import('../core/settings/repository');
    vi.resetModules();
    const secondRealm = await import('../core/settings/repository');

    await Promise.all([
      firstRealm.moveApiKey('local'),
      secondRealm.clearApiKey(profileB.id),
    ]);

    expect(await getApiKey(profileA.id)).toBe('key-a');
    expect(await getApiKey(profileB.id)).toBeUndefined();
    expect(local.values[API_KEYS_STORAGE_KEY]).toEqual({ [profileA.id]: 'key-a' });
    expect(session.values[API_KEYS_STORAGE_KEY]).toEqual({});
  });

  it('clears an old profile key before committing a changed endpoint', async () => {
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      apiProfiles: [{
        ...DEFAULT_SETTINGS.apiProfiles[0]!,
        apiBaseUrl: 'https://old.example/v1',
        model: 'old-model',
      }],
      apiBaseUrl: 'https://old.example/v1',
      model: 'old-model',
    };
    await saveSettings(oldSettings);
    await saveApiKey('old-key', 'session', 'default');
    local.failNextSet((next) =>
      (next.extensionSettings as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ===
      'https://new.example/v1',
    );

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: {
        ...current,
        apiProfiles: [{
          ...current.apiProfiles[0]!,
          apiBaseUrl: 'https://new.example/v1',
          model: 'new-model',
        }],
        apiBaseUrl: 'https://new.example/v1',
        model: 'new-model',
      },
      credentials: {
        clearProfileIds: ['default'],
        saveApiKey: { apiKey: 'new-key', mode: 'session', profileId: 'default' },
      },
      value: undefined,
    }))).rejects.toThrow('Injected storage.set failure');

    expect((await getSettings()).apiBaseUrl).toBe('https://old.example/v1');
    expect(await getApiKey('default')).toBeUndefined();
  });

  it('leaves a changed profile without a key when the new key write fails', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    await saveApiKey('old-key', 'session', 'default');
    session.failNextSet((next) =>
      (next[API_KEYS_STORAGE_KEY] as Record<string, string> | undefined)?.default ===
      'new-key',
    );

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: {
        ...current,
        apiProfiles: [{
          ...current.apiProfiles[0]!,
          apiBaseUrl: 'https://new.example/v1',
          model: 'new-model',
        }],
        apiBaseUrl: 'https://new.example/v1',
        model: 'new-model',
      },
      credentials: {
        clearProfileIds: ['default'],
        saveApiKey: { apiKey: 'new-key', mode: 'session', profileId: 'default' },
      },
      value: undefined,
    }))).rejects.toThrow('Injected storage.set failure');

    expect((await getSettings()).apiBaseUrl).toBe('https://new.example/v1');
    expect(await getApiKey('default')).toBeUndefined();
  });

  it('does not import new provider settings when clearing old credentials fails', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    await saveApiKey('old-key', 'local', 'default');
    local.failNextRemove((keys) => keys.includes(API_KEYS_STORAGE_KEY));

    await expect(mutateApiConfiguration((current) => ({
      nextSettings: {
        ...current,
        apiProfiles: [{
          ...current.apiProfiles[0]!,
          apiBaseUrl: 'https://imported.example/v1',
        }],
        apiBaseUrl: 'https://imported.example/v1',
      },
      credentials: { clearAllApiKeys: true },
      value: undefined,
    }))).rejects.toThrow('Injected storage.remove failure');

    expect((await getSettings()).apiBaseUrl).toBe(DEFAULT_SETTINGS.apiBaseUrl);
    expect(await getApiKey('default')).toBe('old-key');
  });
});
