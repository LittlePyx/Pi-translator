import {
  DEFAULT_API_PROFILE,
  DEFAULT_SETTINGS,
  type ApiKeyStorageMode,
  type ApiProfile,
  type ExtensionSettings,
} from './schema';
import { normalizeGlossaryEntries } from '../translation/glossary';
import type { GlossaryEntry } from '../translation/types';
import { normalizePdfRegionShortcutKey } from '../pdf/region-shortcuts';
import {
  CONFIGURATION_REVISION_STORAGE_KEY,
  commitConfigurationRevision,
} from './configuration-revision';
import { translationBehaviorFingerprint } from './translation-configuration';

const SETTINGS_KEY = 'extensionSettings';
const API_KEY_KEY = 'apiKey';
const LEGACY_API_KEY_KEY = 'deepseekApiKey';
export const API_KEYS_STORAGE_KEY = 'apiKeysByProfile';
const API_KEYS_KEY = API_KEYS_STORAGE_KEY;

let settingsWriteQueue: Promise<void> = Promise.resolve();
const SETTINGS_WRITE_LOCK = 'pi-translator:settings-write:v1';

export interface SettingsMutationUpdate<Value> {
  /** Return null when the condition no longer holds and no write should occur. */
  nextSettings: ExtensionSettings | null;
  value: Value;
}

export interface SettingsMutationResult<Value> {
  /** The settings that are current after the queued operation completes. */
  settings: ExtensionSettings;
  value: Value;
  /** Null when the updater intentionally skipped the write. */
  revisionId: string | null;
}

export interface ApiConfigurationCredentialPlan {
  /**
   * Abort before any settings or credential writes when an existing profile
   * disappeared or changed providers since the caller loaded its draft.
   */
  requireCurrentProfiles?: Array<Pick<ApiProfile, 'id' | 'apiBaseUrl'>>;
  /** Remove every stored API key before exposing the new settings. */
  clearAllApiKeys?: boolean;
  /** Remove keys whose profile endpoint changed or whose profile was deleted. */
  clearProfileIds?: string[];
  /** Move the remaining keys before committing the storage-mode setting. */
  moveApiKeysTo?: ApiKeyStorageMode;
  /** Store a newly supplied key only after the new settings have committed. */
  saveApiKey?: {
    apiKey: string;
    mode: ApiKeyStorageMode;
    profileId: string;
  };
}

export interface ApiConfigurationMutationUpdate<Value>
  extends SettingsMutationUpdate<Value> {
  credentials?: ApiConfigurationCredentialPlan;
}

/** A key is bound to a provider origin, not to one model at that origin. */
export function changedApiCredentialProfileIds(
  previous: readonly ApiProfile[],
  next: readonly ApiProfile[],
): string[] {
  const nextById = new Map(next.map((profile) => [profile.id, profile]));
  return previous.flatMap((profile) => {
    const replacement = nextById.get(profile.id);
    return !replacement || replacement.apiBaseUrl !== profile.apiBaseUrl
      ? [profile.id]
      : [];
  });
}

function runSettingsWrite<Value>(operation: () => Promise<Value>): Promise<Value> {
  const runWithOriginLock = async (): Promise<Value> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks
      ? await locks.request(SETTINGS_WRITE_LOCK, async () => await operation())
      : operation();
  };
  // The local queue orders calls in this realm. Web Locks also serializes the
  // background worker, options page, and popup, which are separate realms but
  // share the same extension origin.
  const queued = settingsWriteQueue.then(runWithOriginLock, runWithOriginLock);
  settingsWriteQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

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
    sidebarMode: value.sidebarMode === 'browser' ? 'browser' : 'floating',
    sidebarSide: value.sidebarSide === 'left' ? 'left' : 'right',
    sidebarWidth:
      typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)
        ? Math.min(640, Math.max(320, Math.round(value.sidebarWidth)))
        : DEFAULT_SETTINGS.sidebarWidth,
    contextMode:
      value.contextMode === 'sentence' || value.contextMode === 'paragraph'
        ? value.contextMode
        : 'off',
    autoRenderLatex: value.autoRenderLatex !== false,
    enableStreaming: value.enableStreaming !== false,
    protectSensitiveFields: value.protectSensitiveFields !== false,
    pdfKeyboardShortcutsEnabled: value.pdfKeyboardShortcutsEnabled !== false,
    pdfRegionShortcutKey: normalizePdfRegionShortcutKey(value.pdfRegionShortcutKey),
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

async function commitSettings(
  settings: ExtensionSettings,
): Promise<{ settings: ExtensionSettings; revisionId: string }> {
  const previous = await browser.storage.local.get(SETTINGS_KEY);
  const storedSettings: ExtensionSettings = {
    ...settings,
    schemaVersion: 8 as const,
    provider: 'openai-compatible' as const,
  };
  const invalidatesTranslationState =
    translationBehaviorFingerprint(previous[SETTINGS_KEY]) !==
    translationBehaviorFingerprint(storedSettings);
  const revision = {
    id: crypto.randomUUID(),
    committedAt: Date.now(),
    invalidatesTranslationState,
  };
  await browser.storage.local.set({
    [SETTINGS_KEY]: storedSettings,
    [CONFIGURATION_REVISION_STORAGE_KEY]: revision,
  });
  return { settings: storedSettings, revisionId: revision.id };
}

async function storeSettingsWithoutRevision(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const storedSettings: ExtensionSettings = {
    ...settings,
    schemaVersion: 8 as const,
    provider: 'openai-compatible' as const,
  };
  await browser.storage.local.set({ [SETTINGS_KEY]: storedSettings });
  return storedSettings;
}

export async function saveSettings(settings: ExtensionSettings): Promise<string> {
  const committed = await runSettingsWrite(() => commitSettings(settings));
  return committed.revisionId;
}

export async function mutateSettings<Value>(
  updater: (
    current: ExtensionSettings,
  ) => SettingsMutationUpdate<Value> | Promise<SettingsMutationUpdate<Value>>,
): Promise<SettingsMutationResult<Value>> {
  return runSettingsWrite(async () => {
    const current = await getSettings();
    const update = await updater(current);
    if (!update.nextSettings) {
      return {
        settings: current,
        value: update.value,
        revisionId: null,
      };
    }

    const committed = await commitSettings(update.nextSettings);
    return {
      settings: committed.settings,
      value: update.value,
      revisionId: committed.revisionId,
    };
  });
}

export async function activateApiProfile(profileId: string): Promise<ExtensionSettings> {
  const result = await mutateSettings((settings) => {
    const profile = settings.apiProfiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('API 配置不存在。');
    const next = {
      ...settings,
      activeApiProfileId: profile.id,
      apiBaseUrl: profile.apiBaseUrl,
      model: profile.model,
    };
    return { nextSettings: next, value: undefined };
  });
  return result.settings;
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

interface ApiKeyStorageState {
  session: ApiKeyMap;
  local: ApiKeyMap;
}

function apiKeyMap(value: unknown): ApiKeyMap {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1]),
    ),
  );
}

async function readApiKeyStorageState(): Promise<ApiKeyStorageState> {
  const [session, local] = await Promise.all([
    browser.storage.session.get(API_KEYS_KEY),
    browser.storage.local.get(API_KEYS_KEY),
  ]);
  return {
    session: apiKeyMap(session[API_KEYS_KEY]),
    local: apiKeyMap(local[API_KEYS_KEY]),
  };
}

async function migrateLegacyApiKeysLocked(): Promise<void> {
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
  ]);
  // Legacy values are deleted only after both profile maps are durable. A
  // failed migration can therefore be retried without losing the credential.
  await Promise.all([
    browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
    browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
  ]);
}

async function clearApiKeysLocked(profileIds?: readonly string[]): Promise<void> {
  await migrateLegacyApiKeysLocked();
  if (!profileIds) {
    await Promise.all([
      browser.storage.session.remove([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
      browser.storage.local.remove([API_KEYS_KEY, API_KEY_KEY, LEGACY_API_KEY_KEY]),
    ]);
    const remaining = await readApiKeyStorageState();
    if (Object.keys(remaining.session).length || Object.keys(remaining.local).length) {
      throw new Error('Failed to clear all API keys.');
    }
    return;
  }

  const uniqueIds = [...new Set(profileIds)];
  if (!uniqueIds.length) return;
  const state = await readApiKeyStorageState();
  for (const profileId of uniqueIds) {
    delete state.session[profileId];
    delete state.local[profileId];
  }
  await Promise.all([
    browser.storage.session.set({ [API_KEYS_KEY]: state.session }),
    browser.storage.local.set({ [API_KEYS_KEY]: state.local }),
  ]);
  if (uniqueIds.includes('default')) {
    await Promise.all([
      browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
      browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
    ]);
  }
  const remaining = await readApiKeyStorageState();
  if (
    uniqueIds.some(
      (profileId) => remaining.session[profileId] || remaining.local[profileId],
    )
  ) {
    throw new Error('Failed to clear an API key.');
  }
}

async function saveApiKeyLocked(
  apiKey: string,
  mode: ApiKeyStorageMode,
  profileId: string,
): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error('API Key cannot be empty.');
  await migrateLegacyApiKeysLocked();
  const state = await readApiKeyStorageState();
  if (mode === 'session') {
    state.session[profileId] = normalized;
    await browser.storage.session.set({ [API_KEYS_KEY]: state.session });
    delete state.local[profileId];
    await browser.storage.local.set({ [API_KEYS_KEY]: state.local });
  } else {
    // Session storage has lookup priority. Remove it first so an old session
    // value can never mask the newly persisted local value.
    delete state.session[profileId];
    await browser.storage.session.set({ [API_KEYS_KEY]: state.session });
    state.local[profileId] = normalized;
    await browser.storage.local.set({ [API_KEYS_KEY]: state.local });
  }
  await Promise.all([
    browser.storage.session.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
    browser.storage.local.remove([API_KEY_KEY, LEGACY_API_KEY_KEY]),
  ]);
}

async function moveApiKeysLocked(
  mode: ApiKeyStorageMode,
  profileIds: readonly string[],
): Promise<void> {
  await migrateLegacyApiKeysLocked();
  const state = await readApiKeyStorageState();
  const keys = Object.fromEntries(
    profileIds.flatMap((profileId) => {
      const key = state.session[profileId] ?? state.local[profileId];
      return key ? [[profileId, key] as const] : [];
    }),
  );
  if (mode === 'session') {
    await browser.storage.session.set({
      [API_KEYS_KEY]: { ...state.session, ...keys },
    });
    for (const profileId of profileIds) delete state.local[profileId];
    await browser.storage.local.set({ [API_KEYS_KEY]: state.local });
  } else {
    await browser.storage.local.set({
      [API_KEYS_KEY]: { ...state.local, ...keys },
    });
    for (const profileId of profileIds) delete state.session[profileId];
    await browser.storage.session.set({ [API_KEYS_KEY]: state.session });
  }
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
): Promise<string> {
  return runSettingsWrite(async () => {
    const activeProfileId = profileId ?? (await getSettings()).activeApiProfileId;
    await saveApiKeyLocked(apiKey, mode, activeProfileId);
    return commitConfigurationRevision(true);
  });
}

export async function moveApiKey(mode: ApiKeyStorageMode): Promise<string> {
  return runSettingsWrite(async () => {
    const settings = await getSettings();
    await moveApiKeysLocked(mode, settings.apiProfiles.map((profile) => profile.id));
    return commitConfigurationRevision(true);
  });
}

export async function clearApiKey(profileId?: string): Promise<string> {
  return runSettingsWrite(async () => {
    await clearApiKeysLocked(profileId ? [profileId] : undefined);
    return commitConfigurationRevision(true);
  });
}

/**
 * Commits settings and credentials under one extension-origin lock. Keys that
 * could otherwise become associated with a changed endpoint are removed
 * first. A settings/key write failure can therefore leave the profile without
 * a key, but can never expose an old key to a new provider configuration.
 */
export async function mutateApiConfiguration<Value>(
  updater: (
    current: ExtensionSettings,
  ) =>
    | ApiConfigurationMutationUpdate<Value>
    | Promise<ApiConfigurationMutationUpdate<Value>>,
): Promise<SettingsMutationResult<Value>> {
  return runSettingsWrite(async () => {
    const current = await getSettings();
    const update = await updater(current);
    if (!update.nextSettings) {
      return { settings: current, value: update.value, revisionId: null };
    }

    const plan = update.credentials;
    if (plan?.requireCurrentProfiles?.length) {
      const currentById = new Map(
        current.apiProfiles.map((profile) => [profile.id, profile] as const),
      );
      const staleProfile = plan.requireCurrentProfiles.find((expected) => {
        const currentProfile = currentById.get(expected.id);
        return !currentProfile || currentProfile.apiBaseUrl !== expected.apiBaseUrl;
      });
      if (staleProfile) {
        throw new Error(
          '当前 API 配置已在另一个设置页中删除或更改，请重新加载后再保存 Key。',
        );
      }
    }
    if (
      plan?.saveApiKey &&
      !update.nextSettings.apiProfiles.some(
        (profile) => profile.id === plan.saveApiKey?.profileId,
      )
    ) {
      throw new Error('API Key 对应的配置不存在，设置与 Key 均未保存。');
    }
    if (plan?.clearAllApiKeys) {
      await clearApiKeysLocked();
    } else if (plan?.clearProfileIds?.length) {
      await clearApiKeysLocked(plan.clearProfileIds);
    }
    if (plan?.moveApiKeysTo) {
      await moveApiKeysLocked(
        plan.moveApiKeysTo,
        update.nextSettings.apiProfiles.map((profile) => profile.id),
      );
    }

    const storedSettings = await storeSettingsWithoutRevision(update.nextSettings);
    if (plan?.saveApiKey) {
      await saveApiKeyLocked(
        plan.saveApiKey.apiKey,
        plan.saveApiKey.mode,
        plan.saveApiKey.profileId,
      );
    }
    const credentialsChanged = Boolean(
      plan?.clearAllApiKeys ||
        plan?.clearProfileIds?.length ||
        plan?.moveApiKeysTo ||
        plan?.saveApiKey,
    );
    const invalidatesTranslationState =
      credentialsChanged ||
      translationBehaviorFingerprint(current) !==
        translationBehaviorFingerprint(storedSettings);
    const revisionId = await commitConfigurationRevision(invalidatesTranslationState);
    return { settings: storedSettings, value: update.value, revisionId };
  });
}

export async function restrictSensitiveStorageAccess(): Promise<void> {
  const trustedContexts = { accessLevel: 'TRUSTED_CONTEXTS' as const };
  await Promise.allSettled([
    browser.storage.local.setAccessLevel(trustedContexts),
    browser.storage.session.setAccessLevel(trustedContexts),
  ]);
}
