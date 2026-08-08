import { mergeGlossaryDraft } from '../translation/glossary';
import type { ApiProfile, ExtensionSettings } from './schema';

export class SettingsDraftConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsDraftConflictError';
  }
}

export interface SettingsDraftMergeResult {
  settings: ExtensionSettings;
  removedProfileIds: string[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeApiProfiles(
  baseline: ApiProfile[],
  draft: ApiProfile[],
  latest: ApiProfile[],
): { profiles: ApiProfile[]; removedProfileIds: string[] } {
  const baselineById = new Map(baseline.map((profile) => [profile.id, profile] as const));
  const draftIds = new Set(draft.map((profile) => profile.id));
  const removedProfileIds = baseline
    .filter((profile) => !draftIds.has(profile.id))
    .map((profile) => profile.id);
  const removed = new Set(removedProfileIds);
  const profiles = latest
    .filter((profile) => !removed.has(profile.id))
    .map((profile) => ({ ...profile }));

  for (const profile of draft) {
    const baselineProfile = baselineById.get(profile.id);
    if (baselineProfile && sameValue(profile, baselineProfile)) continue;
    const index = profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index >= 0) profiles[index] = { ...profile };
    else profiles.push({ ...profile });
  }
  if (profiles.length > 6) {
    throw new SettingsDraftConflictError(
      '另一个设置页刚刚新增了 API 配置，合并后会超过 6 个上限。请重新加载后再保存。',
    );
  }
  if (!profiles.length) {
    throw new SettingsDraftConflictError('至少需要保留一个 API 配置。');
  }
  return { profiles, removedProfileIds };
}

/**
 * Three-way merges a visible settings-page draft into the latest stored state.
 * Fields the user did not change keep newer popup/background edits. Profiles
 * are merged by id, and only profiles present in the baseline but explicitly
 * removed from the draft are deleted.
 */
export function mergeSettingsDraft(
  baseline: ExtensionSettings,
  draft: ExtensionSettings,
  latest: ExtensionSettings,
): SettingsDraftMergeResult {
  const merged = { ...latest } as ExtensionSettings;
  const record = merged as unknown as Record<string, unknown>;
  const baselineRecord = baseline as unknown as Record<string, unknown>;
  const draftRecord = draft as unknown as Record<string, unknown>;
  const special = new Set([
    'apiProfiles',
    'academicGlossary',
    'activeApiProfileId',
    'visionApiProfileId',
    'apiBaseUrl',
    'model',
  ]);
  for (const key of Object.keys(draftRecord)) {
    if (special.has(key)) continue;
    if (!sameValue(draftRecord[key], baselineRecord[key])) {
      record[key] = draftRecord[key];
    }
  }

  const profileMerge = mergeApiProfiles(
    baseline.apiProfiles,
    draft.apiProfiles,
    latest.apiProfiles,
  );
  merged.apiProfiles = profileMerge.profiles;
  merged.academicGlossary = mergeGlossaryDraft(
    baseline.academicGlossary,
    draft.academicGlossary,
    latest.academicGlossary,
  );

  const requestedActiveId = draft.activeApiProfileId !== baseline.activeApiProfileId
    ? draft.activeApiProfileId
    : latest.activeApiProfileId;
  const active = merged.apiProfiles.find((profile) => profile.id === requestedActiveId) ??
    merged.apiProfiles[0]!;
  merged.activeApiProfileId = active.id;
  merged.apiBaseUrl = active.apiBaseUrl;
  merged.model = active.model;

  const requestedVisionId = draft.visionApiProfileId !== baseline.visionApiProfileId
    ? draft.visionApiProfileId
    : latest.visionApiProfileId;
  merged.visionApiProfileId = merged.apiProfiles.some(
    (profile) => profile.id === requestedVisionId,
  ) ? requestedVisionId : '';

  return {
    settings: merged,
    removedProfileIds: profileMerge.removedProfileIds,
  };
}
