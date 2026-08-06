import type { ExtensionSettings } from '../settings/schema';
import { shouldUseVisionForPdfFormula } from '../translation/formula-detection';

export type NativePdfApiRole = 'text' | 'vision';

export interface NativePdfTranslationProvider {
  profileId: string;
  profileName: string;
  apiBaseUrl: string;
  model: string;
  role: NativePdfApiRole;
}

type ProviderSettings = Pick<
  ExtensionSettings,
  | 'apiProfiles'
  | 'activeApiProfileId'
  | 'visionApiProfileId'
  | 'visionModel'
>;

function provider(
  profile: ExtensionSettings['apiProfiles'][number],
  model: string,
  role: NativePdfApiRole,
): NativePdfTranslationProvider {
  return {
    profileId: profile.id,
    profileName: profile.name,
    apiBaseUrl: profile.apiBaseUrl,
    model,
    role,
  };
}

/**
 * Chooses the API used for text exposed by Edge's built-in PDF viewer.
 *
 * Edge does not expose the rendered PDF pixels to the extension, so this path
 * cannot perform vision recognition. A configured vision model can still
 * accept the selected text, however, which keeps formula-heavy selections on
 * the same provider that Pi PDF uses for them. The choice happens before any
 * request and never retries a failed request on another paid API.
 */
export function resolveNativePdfTranslationProvider(
  settings: ProviderSettings,
  sourceText: string,
  visionApiKeyConfigured: boolean,
): NativePdfTranslationProvider | undefined {
  const activeProfile = settings.apiProfiles.find(
    (candidate) => candidate.id === settings.activeApiProfileId,
  ) ?? settings.apiProfiles[0];
  const visionProfile = settings.apiProfiles.find(
    (candidate) => candidate.id === settings.visionApiProfileId,
  );
  const visionModel = settings.visionModel.trim() || visionProfile?.model.trim() || '';

  if (
    visionProfile &&
    visionModel &&
    visionApiKeyConfigured &&
    shouldUseVisionForPdfFormula(sourceText)
  ) {
    return provider(visionProfile, visionModel, 'vision');
  }

  return activeProfile
    ? provider(activeProfile, activeProfile.model, 'text')
    : undefined;
}
