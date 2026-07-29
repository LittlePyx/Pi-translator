import {
  DEFAULT_API_PROFILE,
  DEFAULT_SETTINGS,
  type ApiKeyStorageMode,
  type ApiProfile,
  type ExtensionSettings,
} from './schema';
import { normalizeGlossaryEntries } from '../translation/glossary';
import type { GlossaryEntry } from '../translation/types';

const SETTINGS_KEY = 'extensionSettings';
const API_KEY_KEY = 'apiKey';
const LEGACY_API_KEY_KEY = 'deepseekApiKey';
const API_KEYS_KEY = 'apiKeysByProfile';

function isSettings(value: unknown): value is Partial<ExtensionSettings> {
  return Boolean(value && typeof value === 'object');
}

function isGlossaryEntry(value: unknown): value is GlossaryEntry {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'source' in value &&
      typeof value.source === 'string' &&
      'target' in value &&
      typeof value.target === 'string',
  );
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY];
  if (!isSettings(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const storedProfiles = Array.isArray(value.apiProfiles)
    ? value.apiProfiles.filter(isApiProfile)
    : [];
  const migratedProfile: ApiProfile = {
    ...DEFAULT_API_PROFILE,
    apiBaseUrl:
      typeof value.apiBaseUrl === 'string'
        ? value.apiBaseUrl
        : DEFAULT_API_PROFILE.apiBaseUrl,
    model: typeof value.model === 'string' ? value.model : DEFAULT_API_PROFILE.model,
  };
  const apiProfiles = storedProfiles.length ? storedProfiles : [migratedProfile];
  const requestedActiveId =
    typeof value.activeApiProfileId === 'string'
      ? value.activeApiProfileId
      : apiProfiles[0]?.id;
  const activeProfile =
    apiProfiles.find((profile) => profile.id === requestedActiveId) ??
    apiProfiles[0] ??
    migratedProfile;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    schemaVersion: 8,
    provider: 'openai-compatible',
    apiProfiles,
    activeApiProfileId: activeProfile.id,
    visionApiProfileId:
      typeof value.visionApiProfileId === 'string' &&
      apiProfiles.some((profile) => profile.id === value.visionApiProfileId)
        ? value.visionApiProfileId
        : '',
    visionModel:
      typeof value.visionModel === 'string' && value.visionModel.trim()
        ? value.visionModel.trim()
        : DEFAULT_SETTINGS.visionModel,
    apiBaseUrl: activeProfile.apiBaseUrl,
    model: activeProfile.model,
    historyLimit:
      value.historyLimit === 10 || value.historyLimit === 20 ? value.historyLimit : 5,
    sidebarSide: value.sidebarSide === 'left' ? 'left' : 'right',
    sidebarWidth:
      typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)
        ? Math.min(640, Math.max(320, Math.round(value.sidebarWidth)))
        : DEFAULT_SETTINGS.sidebarWidth,
    contextMode:
      value.contextMode === 'sentence' || value.contextMode === 'paragraph'
        ? value.contextMode
        : 'off',
    enableStreaming: value.enableStreaming !== false,
    protectSensitiveFields: value.protectSensitiveFields !== false,
    onboardingCompleted:
      typeof value.onboardingCompleted === 'boolean'
        ? value.onboardingCompleted
        : true,
    siteAllowlist: Array.isArray(value.siteAllowlist)
      ? value.siteAllowlist.filter((entry): entry is string => typeof entry === 'string')
      : [],
    academicGlossary: Array.isArray(value.academicGlossary)
      ? normalizeGlossaryEntries(value.academicGlossary.filter(isGlossaryEntry))
      : [],
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await browser.storage.local.set({
    [SETTINGS_KEY]: {
      ...settings,
      schemaVersion: 8,
      provider: 'openai-compatible',
    },
  });
}

export async function activateApiProfile(profileId: string): Promise<ExtensionSettings> {
  const settings = await getSettings();
  const profile = settings.apiProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('API 配置不存在。');
  const next = {
    ...settings,
    activeApiProfileId: profile.id,
    apiBaseUrl: profile.apiBaseUrl,
    model: profile.model,
  };
  await saveSettings(next);
  return next;
}

function isApiProfile(value: unknown): value is ApiProfile {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof value.id === 'string' &&
      'name' in value &&
      typeof value.name === 'string' &&
      'apiBaseUrl' in value &&
      typeof value.apiBaseUrl === 'string' &&
      'model' in value &&
      typeof value.model === 'string',
  );
}

type ApiKeyMap = Record<string, string>;

function apiKeyMap(value: unknown): ApiKeyMap {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1]),
    ),
  );
}

async function migrateLegacyApiKeys(): Promise<void> {
  const [session, local] = await Promise.all([
    browser.storage.session.get([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
    browser.storage.local.get([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
  ]);
  const sessionMap = apiKeyMap(session[API_KEYS_KEY]);
  const localMap = apiKeyMap(local[API_KEYS_KEY]);
  const sessionLegacy = session[API_KEY_KEY] ?? session[LEGACY_API_KEY_KEY];
  const localLegacy = local[API_KEY_KEY] ?? local[LEGACY_API_KEY_KEY];
  if (typeof sessionLegacy === 'string' && sessionLegacy && !sessionMap.default) {
    sessionMap.default = sessionLegacy;
  }
  if (typeof localLegacy === 'string' && localLegacy && !localMap.default) {
    localMap.default = localLegacy;
  }
  await Promise.all([
    browser.storage.session.set({ [API_KEYS_KEY]: sessionMap }),
    browser.storage.local.set({ [API_KEYS_KEY]: localMap }),
    browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
    browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
  ]);
}

export async function getApiKey(profileId?: string): Promise<string | undefined> {
  const activeProfileId = profileId ?? (await getSettings()).activeApiProfileId;
  const session = await browser.storage.session.get([
    API_KEYS_KEY,
    API_KEY_KEY,
    LEGACY_API_KEY_KEY,
  ]);
  const sessionKey =
    apiKeyMap(session[API_KEYS_KEY])[activeProfileId] ??
    (activeProfileId === 'default'
      ? session[API_KEY_KEY] ?? session[LEGACY_API_KEY_KEY]
      : undefined);
  if (typeof sessionKey === 'string' && sessionKey.length > 0) {
    return sessionKey;
  }

  const local = await browser.storage.local.get([
    API_KEYS_KEY,
    API_KEY_KEY,
    LEGACY_API_KEY_KEY,
  ]);
  const localKey =
    apiKeyMap(local[API_KEYS_KEY])[activeProfileId] ??
    (activeProfileId === 'default'
      ? local[API_KEY_KEY] ?? local[LEGACY_API_KEY_KEY]
      : undefined);
  return typeof localKey === 'string' && localKey.length > 0 ? localKey : undefined;
}

export async function hasApiKey(profileId?: string): Promise<boolean> {
  return Boolean(await getApiKey(profileId));
}

export async function saveApiKey(
  apiKey: string,
  mode: ApiKeyStorageMode,
  profileId?: string,
): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new Error('API Key cannot be empty.');
  }

  await migrateLegacyApiKeys();
  const activeProfileId = profileId ?? (await getSettings()).activeApiProfileId;
  if (mode === 'session') {
    const stored = await browser.storage.session.get(API_KEYS_KEY);
    await browser.storage.session.set({
      [API_KEYS_KEY]: {
        ...apiKeyMap(stored[API_KEYS_KEY]),
        [activeProfileId]: normalized,
      },
    });
    await browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]);
    const localMaps = await browser.storage.local.get(API_KEYS_KEY);
    const nextLocalMap = apiKeyMap(localMaps[API_KEYS_KEY]);
    delete nextLocalMap[activeProfileId];
    await browser.storage.local.set({ [API_KEYS_KEY]: nextLocalMap });
    await browser.storage.session.remove(LEGACY_API_KEY_KEY);
    return;
  }

  const stored = await browser.storage.local.get(API_KEYS_KEY);
  await browser.storage.local.set({
    [API_KEYS_KEY]: {
      ...apiKeyMap(stored[API_KEYS_KEY]),
      [activeProfileId]: normalized,
    },
  });
  await browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]);
  const sessionMaps = await browser.storage.session.get(API_KEYS_KEY);
  const nextSessionMap = apiKeyMap(sessionMaps[API_KEYS_KEY]);
  delete nextSessionMap[activeProfileId];
  await browser.storage.session.set({ [API_KEYS_KEY]: nextSessionMap });
  await browser.storage.local.remove(LEGACY_API_KEY_KEY);
}

export async function moveApiKey(mode: ApiKeyStorageMode): Promise<void> {
  const settings = await getSettings();
  for (const profile of settings.apiProfiles) {
    const apiKey = await getApiKey(profile.id);
    if (apiKey) await saveApiKey(apiKey, mode, profile.id);
  }
}

export async function clearApiKey(profileId?: string): Promise<void> {
  if (profileId) {
    const [session, local] = await Promise.all([
      browser.storage.session.get(API_KEYS_KEY),
      browser.storage.local.get(API_KEYS_KEY),
    ]);
    const sessionMap = apiKeyMap(session[API_KEYS_KEY]);
    const localMap = apiKeyMap(local[API_KEYS_KEY]);
    delete sessionMap[profileId];
    delete localMap[profileId];
    await Promise.all([
      browser.storage.session.set({ [API_KEYS_KEY]: sessionMap }),
      browser.storage.local.set({ [API_KEYS_KEY]: localMap }),
    ]);
    if (profileId === 'default') {
      await Promise.all([
        browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
        browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
      ]);
    }
    return;
  }
  await Promise.all([
    browser.storage.session.remove([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
    browser.storage.local.remove([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
  ]);
}

export async function restrictSensitiveStorageAccess(): Promise<void> {
  const trustedContexts = { accessLevel: 'TRUSTED_CONTEXTS' as const };
  await Promise.allSettled([
    browser.storage.local.setAccessLevel(trustedContexts),
    browser.storage.session.setAccessLevel(trustedContexts),
  ]);
}
