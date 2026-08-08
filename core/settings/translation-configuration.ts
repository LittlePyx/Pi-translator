/** Fields that can change the request, provider output, or checkpoint identity. */
export function translationBehaviorFingerprint(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const settings = value as Record<string, unknown>;
  const apiProfiles = Array.isArray(settings.apiProfiles)
    ? settings.apiProfiles.map((value) => {
        if (!value || typeof value !== 'object') return value;
        const profile = value as Record<string, unknown>;
        return {
          id: profile.id,
          apiBaseUrl: profile.apiBaseUrl,
          model: profile.model,
        };
      })
    : settings.apiProfiles;
  return JSON.stringify({
    provider: settings.provider,
    apiProfiles,
    activeApiProfileId: settings.activeApiProfileId,
    visionApiProfileId: settings.visionApiProfileId,
    visionModel: settings.visionModel,
    apiBaseUrl: settings.apiBaseUrl,
    model: settings.model,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    style: settings.style,
    contentMode: settings.contentMode,
    academicGlossary: settings.academicGlossary,
    contextMode: settings.contextMode,
    enableStreaming: settings.enableStreaming,
    sentenceAlignmentDefault: settings.sentenceAlignmentDefault,
  });
}
