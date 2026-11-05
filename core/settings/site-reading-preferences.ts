import { isSupportedTargetLanguage, type SupportedTargetLanguage } from '../language/supported-target-languages';
import { getPausedSiteHosts, setSitePaused, siteHostFromUrl } from './site-pause';

export const SITE_READING_PREFERENCES_KEY = 'siteReadingPreferencesV1';

export interface SiteReadingPreference {
  targetLanguage: SupportedTargetLanguage;
  paused: boolean;
}

export type SiteReadingPreferences = Record<string, SiteReadingPreference>;

export function normalizeSiteReadingPreferences(value: unknown): SiteReadingPreferences {
  const result: SiteReadingPreferences = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [host, preference] of Object.entries(value)) {
    if (host !== siteHostFromUrl(`https://${host}/`) || !preference ||
      typeof preference !== 'object' || Array.isArray(preference)) continue;
    const candidate = preference as Partial<SiteReadingPreference>;
    if (!isSupportedTargetLanguage(candidate.targetLanguage) || typeof candidate.paused !== 'boolean') continue;
    result[host] = { targetLanguage: candidate.targetLanguage, paused: candidate.paused };
  }
  return result;
}

export async function getSiteReadingPreferences(): Promise<SiteReadingPreferences> {
  const stored = await browser.storage.local.get(SITE_READING_PREFERENCES_KEY);
  return normalizeSiteReadingPreferences(stored[SITE_READING_PREFERENCES_KEY]);
}

export function siteReadingPreferenceForUrl(
  preferences: SiteReadingPreferences,
  url: string | undefined,
): SiteReadingPreference | undefined {
  const host = url ? siteHostFromUrl(url) : undefined;
  return host && Object.hasOwn(preferences, host) ? preferences[host] : undefined;
}

export function effectivePausedSiteHosts(
  sessionHosts: string[],
  preferences: SiteReadingPreferences,
): string[] {
  const hosts = new Set(sessionHosts);
  for (const [host, preference] of Object.entries(preferences)) {
    if (preference.paused) hosts.add(host);
    else hosts.delete(host);
  }
  return [...hosts].sort();
}

// Popup and worker share this origin lock, including simultaneous writes in other tabs.
let writeQueue: Promise<unknown> = Promise.resolve();
function writePreference<T>(operation: () => Promise<T>): Promise<T> {
  const task = writeQueue.then(async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks
      ? locks.request('pi-translator:site-reading-preferences:v1', operation)
      : operation();
  });
  writeQueue = task.catch(() => undefined);
  return task;
}

export function saveSiteReadingPreference(
  url: string,
  preference: SiteReadingPreference | null,
): Promise<void> {
  return writePreference(async () => {
    const host = siteHostFromUrl(url);
    if (!host) throw new Error('Unsupported site URL.');
    const preferences = await getSiteReadingPreferences();
    if (preference) {
      const normalized = normalizeSiteReadingPreferences({ [host]: preference });
      if (!normalized[host]) throw new Error('Invalid site reading preference.');
      preferences[host] = normalized[host];
    } else {
      // Drop a prior session pause as well: restoring global means automatic selection is active.
      await setSitePaused(url, false);
      delete preferences[host];
    }
    await browser.storage.local.set({ [SITE_READING_PREFERENCES_KEY]: preferences });
  });
}

/** Only add explicitly saved hosts; the current device wins on conflicts. */
export function mergeSiteReadingPreferences(incoming: SiteReadingPreferences): Promise<void> {
  return writePreference(async () => {
    const current = await getSiteReadingPreferences();
    await browser.storage.local.set({
      [SITE_READING_PREFERENCES_KEY]: { ...normalizeSiteReadingPreferences(incoming), ...current },
    });
  });
}

export function setSiteReadingPaused(url: string, paused: boolean): Promise<string | undefined> {
  return writePreference(async () => {
    const host = siteHostFromUrl(url);
    if (!host) return undefined;
    const preferences = await getSiteReadingPreferences();
    const preference = siteReadingPreferenceForUrl(preferences, url);
    if (preference) {
      preferences[host] = { ...preference, paused };
      await browser.storage.local.set({ [SITE_READING_PREFERENCES_KEY]: preferences });
    } else {
      await setSitePaused(url, paused);
    }
    return host;
  });
}

export async function getEffectivePausedSiteHosts(): Promise<string[]> {
  const [sessionHosts, preferences] = await Promise.all([getPausedSiteHosts(), getSiteReadingPreferences()]);
  return effectivePausedSiteHosts(sessionHosts, preferences);
}
