import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SITE_READING_PREFERENCES_KEY as key,
  effectivePausedSiteHosts, getSiteReadingPreferences, getEffectivePausedSiteHosts,
  normalizeSiteReadingPreferences, saveSiteReadingPreference,
  mergeSiteReadingPreferences,
  setSiteReadingPaused, siteReadingPreferenceForUrl,
} from '../core/settings/site-reading-preferences';

function storage(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  return {
    values,
    get: vi.fn(async (key: string) => structuredClone({ [key]: values[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, structuredClone(next)); }),
  };
}
let local: ReturnType<typeof storage>;
let session: ReturnType<typeof storage>;
beforeEach(() => {
  local = storage({ extensionSettings: { targetLanguage: 'zh-CN' }, oldTranslation: '旧译文 $x=y$ · 人工修正' });
  session = storage();
  vi.stubGlobal('browser', { storage: { local, session } });
});
afterEach(() => vi.unstubAllGlobals());

describe('opt-in site reading preferences', () => {
  it('merges migrated hosts while keeping local conflicts, session pauses and saved work', async () => {
    local.values[key]={'example.com':{targetLanguage:'ja',paused:true}};
    session.values.pausedSiteHosts=['temporary.example'];
    await Promise.all([
      mergeSiteReadingPreferences({'example.com':{targetLanguage:'en',paused:false},'new.example':{targetLanguage:'en',paused:true}}),
      saveSiteReadingPreference('https://third.example/',{targetLanguage:'de',paused:false}),
    ]);
    expect(await getSiteReadingPreferences()).toEqual({'example.com':{targetLanguage:'ja',paused:true},'new.example':{targetLanguage:'en',paused:true},'third.example':{targetLanguage:'de',paused:false}});
    expect(local.values.oldTranslation).toBe('旧译文 $x=y$ · 人工修正');
    expect(session.values.pausedSiteHosts).toEqual(['temporary.example']);
  });
  it('validates language, boolean, canonical exact host and excludes metadata', () => {
    const result = normalizeSiteReadingPreferences({
      'example.com': { targetLanguage: 'en', paused: false, url: 'private/path' },
      'EXAMPLE.com': { targetLanguage: 'en', paused: false },
      'other.com/path': { targetLanguage: 'en', paused: false },
      'invalid.com': { targetLanguage: 'unknown', paused: true },
      'flag.com': { targetLanguage: 'ja', paused: 'false' },
    });
    expect(result).toEqual({ 'example.com': { targetLanguage: 'en', paused: false } });
    expect(siteReadingPreferenceForUrl(result, 'https://EXAMPLE.com/private?q=secret')).toEqual(result['example.com']);
    for (const url of ['https://sub.example.com', 'https://other.com', 'file:///example.com', 'edge://extensions', undefined]) {
      expect(siteReadingPreferenceForUrl(result, url)).toBeUndefined();
    }
    expect(siteReadingPreferenceForUrl({}, 'https://constructor')).toBeUndefined();
    expect(normalizeSiteReadingPreferences(null)).toEqual({});
    expect(normalizeSiteReadingPreferences([])).toEqual({});
  });

  it('keeps unremembered pauses in session only and remembered false overrides stale session pause', async () => {
    await setSiteReadingPaused('https://example.com/a', true);
    expect(local.values[key]).toBeUndefined();
    expect(session.values.pausedSiteHosts).toEqual(['example.com']);
    await saveSiteReadingPreference('https://example.com/b', { targetLanguage: 'en', paused: false });
    expect(await getEffectivePausedSiteHosts()).toEqual([]);
    expect(effectivePausedSiteHosts(['other.com', 'example.com'], await getSiteReadingPreferences())).toEqual(['other.com']);
  });

  it('survives loss of session data, preserves unrelated values and updates remembered pause', async () => {
    const before = structuredClone(local.values);
    await saveSiteReadingPreference('https://example.com/private?secret=1', { targetLanguage: 'ja', paused: true });
    delete session.values.pausedSiteHosts;
    expect(await getEffectivePausedSiteHosts()).toEqual(['example.com']);
    await setSiteReadingPaused('https://example.com/new', false);
    expect(await getSiteReadingPreferences()).toEqual({ 'example.com': { targetLanguage: 'ja', paused: false } });
    expect(local.values).toEqual({ ...before, [key]: { 'example.com': { targetLanguage: 'ja', paused: false } } });
  });

  it('serializes independent host writes and restores global without leaving a session pause', async () => {
    await Promise.all([
      saveSiteReadingPreference('https://one.com', { targetLanguage: 'en', paused: true }),
      saveSiteReadingPreference('https://two.com', { targetLanguage: 'ja', paused: true }),
    ]);
    session.values.pausedSiteHosts = ['one.com', 'elsewhere.com'];
    await saveSiteReadingPreference('https://one.com', null);
    expect(await getSiteReadingPreferences()).toEqual({ 'two.com': { targetLanguage: 'ja', paused: true } });
    expect(await getEffectivePausedSiteHosts()).toEqual(['elsewhere.com', 'two.com']);
    expect(local.values.oldTranslation).toBe('旧译文 $x=y$ · 人工修正');
  });

  it('preserves previous preferences on write failure and permits the next independent write', async () => {
    await saveSiteReadingPreference('https://one.com', { targetLanguage: 'en', paused: true });
    const before = structuredClone(local.values);
    local.set.mockRejectedValueOnce(new Error('storage full'));
    await expect(saveSiteReadingPreference('https://one.com', { targetLanguage: 'ja', paused: false })).rejects.toThrow('storage full');
    expect(local.values).toEqual(before);
    await saveSiteReadingPreference('https://two.com', { targetLanguage: 'ja', paused: false });
    expect(Object.keys(await getSiteReadingPreferences())).toEqual(['one.com', 'two.com']);
    await expect(saveSiteReadingPreference('file:///a.pdf', null)).rejects.toThrow('Unsupported site URL');
  });
});
