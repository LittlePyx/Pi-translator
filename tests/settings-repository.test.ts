import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEYS_STORAGE_KEY,
  getApiKey,
  getSettings,
  saveApiKey,
} from '../core/settings/repository';

type StorageRecord = Record<string, unknown>;

function createStorageArea(initial: StorageRecord = {}) {
  const values: StorageRecord = { ...initial };
  return {
    values,
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
      Object.assign(values, next);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    async setAccessLevel() {},
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
    await saveApiKey('session-only-key', 'session', 'session-profile');
    await saveApiKey('persistent-key', 'local', 'local-profile');

    expect(await getApiKey('session-profile')).toBe('session-only-key');
    expect(await getApiKey('local-profile')).toBe('persistent-key');

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
});
