export interface LocalSpeechVoice {
  lang: string;
  localService: boolean;
}

export function normalizedSpeechLanguage(
  detectedLanguage: string | undefined,
): string | undefined {
  const language = detectedLanguage?.trim().toLocaleLowerCase();
  if (!language) return undefined;
  if (language.startsWith('zh') || language.includes('chinese')) return 'zh-CN';
  if (language.startsWith('en') || language.includes('english')) return 'en-US';
  if (language.startsWith('ja') || language.includes('japanese')) return 'ja-JP';
  if (language.startsWith('de') || language.includes('german')) return 'de-DE';
  if (language.startsWith('fr') || language.includes('french')) return 'fr-FR';
  return undefined;
}

export function selectLocalSpeechVoice<T extends LocalSpeechVoice>(
  voices: readonly T[],
  requestedLanguage: string | undefined,
): T | undefined {
  const local = voices.filter((voice) => voice.localService);
  if (!local.length) return undefined;
  if (!requestedLanguage) return local[0];
  const requested = requestedLanguage.toLocaleLowerCase();
  const base = requested.split('-')[0];
  return local.find((voice) => voice.lang.toLocaleLowerCase() === requested) ??
    local.find((voice) => voice.lang.toLocaleLowerCase().split('-')[0] === base) ??
    local[0];
}
