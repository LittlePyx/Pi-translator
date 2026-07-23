import { DEFAULT_SETTINGS, type ApiKeyStorageMode, type ExtensionSettings } from './schema';
import { normalizeGlossaryEntries } from '../translation/glossary';
import type { GlossaryEntry } from '../translation/types';

const SETTINGS_KEY = 'extensionSettings';
const API_KEY_KEY = 'deepseekApiKey';

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

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    schemaVersion: 3,
    provider: 'deepseek',
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
      schemaVersion: 3,
      provider: 'deepseek',
    },
  });
}

export async function getApiKey(): Promise<string | undefined> {
  const session = await browser.storage.session.get(API_KEY_KEY);
  const sessionKey = session[API_KEY_KEY];
  if (typeof sessionKey === 'string' && sessionKey.length > 0) {
    return sessionKey;
  }

  const local = await browser.storage.local.get(API_KEY_KEY);
  const localKey = local[API_KEY_KEY];
  return typeof localKey === 'string' && localKey.length > 0 ? localKey : undefined;
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await getApiKey());
}

export async function saveApiKey(
  apiKey: string,
  mode: ApiKeyStorageMode,
): Promise<void> {
  const normalized = apiKey.trim();
  if (!normalized) {
    throw new Error('API Key cannot be empty.');
  }

  if (mode === 'session') {
    await browser.storage.session.set({ [API_KEY_KEY]: normalized });
    await browser.storage.local.remove(API_KEY_KEY);
    return;
  }

  await browser.storage.local.set({ [API_KEY_KEY]: normalized });
  await browser.storage.session.remove(API_KEY_KEY);
}

export async function moveApiKey(mode: ApiKeyStorageMode): Promise<void> {
  const apiKey = await getApiKey();
  if (apiKey) {
    await saveApiKey(apiKey, mode);
  }
}

export async function clearApiKey(): Promise<void> {
  await Promise.all([
    browser.storage.session.remove(API_KEY_KEY),
    browser.storage.local.remove(API_KEY_KEY),
  ]);
}

export async function restrictSensitiveStorageAccess(): Promise<void> {
  const trustedContexts = { accessLevel: 'TRUSTED_CONTEXTS' as const };
  await Promise.allSettled([
    browser.storage.local.setAccessLevel(trustedContexts),
    browser.storage.session.setAccessLevel(trustedContexts),
  ]);
}
