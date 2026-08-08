import { describe, expect, it } from 'vitest';
import {
  mergeSettingsDraft,
  SettingsDraftConflictError,
} from '../core/settings/draft-merge';
import {
  DEFAULT_SETTINGS,
  type ApiProfile,
  type ExtensionSettings,
} from '../core/settings/schema';

function profile(id: string, model = `${id}-model`): ApiProfile {
  return {
    id,
    name: `Profile ${id}`,
    apiBaseUrl: `https://${id}.example/v1`,
    model,
  };
}

function settingsWithProfiles(
  profiles: ApiProfile[],
  activeApiProfileId = profiles[0]!.id,
): ExtensionSettings {
  const active = profiles.find((item) => item.id === activeApiProfileId) ?? profiles[0]!;
  return {
    ...DEFAULT_SETTINGS,
    apiProfiles: profiles.map((item) => ({ ...item })),
    activeApiProfileId: active.id,
    apiBaseUrl: active.apiBaseUrl,
    model: active.model,
  };
}

describe('settings draft three-way merge', () => {
  it('keeps newer scalar, profile, and glossary changes for untouched draft fields', () => {
    const baseProfile = profile('base');
    const concurrentlyEditedBase = { ...baseProfile, model: 'base-newer-model' };
    const concurrentProfile = profile('concurrent');
    const baseline = {
      ...settingsWithProfiles([baseProfile]),
      academicGlossary: [{ source: 'baseline', target: '基线' }],
    };
    const draft = {
      ...baseline,
      sidebarSide: 'left' as const,
    };
    const latest = {
      ...baseline,
      targetLanguage: 'ja',
      apiProfiles: [concurrentlyEditedBase, concurrentProfile],
      academicGlossary: [
        ...baseline.academicGlossary,
        { source: 'concurrent', target: '并发' },
      ],
    };

    const merged = mergeSettingsDraft(baseline, draft, latest).settings;

    expect(merged.targetLanguage).toBe('ja');
    expect(merged.sidebarSide).toBe('left');
    expect(merged.apiProfiles).toEqual([concurrentlyEditedBase, concurrentProfile]);
    expect(merged.academicGlossary).toEqual(latest.academicGlossary);
  });

  it('deletes only baseline profiles explicitly removed by the user', () => {
    const originalA = profile('a');
    const originalB = profile('b');
    const concurrentC = profile('c');
    const editedA = { ...originalA, model: 'a-edited' };
    const baseline = settingsWithProfiles([originalA, originalB]);
    const draft = settingsWithProfiles([editedA]);
    const latest = settingsWithProfiles([originalA, originalB, concurrentC]);

    const merged = mergeSettingsDraft(baseline, draft, latest);

    expect(merged.removedProfileIds).toEqual(['b']);
    expect(merged.settings.apiProfiles).toEqual([editedA, concurrentC]);
  });

  it('uses an explicitly selected active profile and refreshes its derived fields', () => {
    const a = profile('a');
    const b = profile('b', 'vision-and-text');
    const c = profile('c');
    const baseline = settingsWithProfiles([a, b, c], 'a');
    const draft = {
      ...baseline,
      activeApiProfileId: 'b',
      visionApiProfileId: 'b',
    };
    const latest = settingsWithProfiles([a, b, c], 'c');

    const merged = mergeSettingsDraft(baseline, draft, latest).settings;

    expect(merged.activeApiProfileId).toBe('b');
    expect(merged.apiBaseUrl).toBe(b.apiBaseUrl);
    expect(merged.model).toBe('vision-and-text');
    expect(merged.visionApiProfileId).toBe('b');
  });

  it('reports a conflict instead of silently dropping a seventh profile', () => {
    const originals = Array.from({ length: 5 }, (_, index) => profile(`p${index}`));
    const baseline = settingsWithProfiles(originals);
    const draft = settingsWithProfiles([...originals, profile('draft')]);
    const latest = settingsWithProfiles([...originals, profile('concurrent')]);

    expect(() => mergeSettingsDraft(baseline, draft, latest)).toThrow(
      SettingsDraftConflictError,
    );
  });
});
