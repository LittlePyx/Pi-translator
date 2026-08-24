export const SUPPORTED_TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文', shortLabel: '中文' },
  { value: 'en', label: 'English', shortLabel: '英文' },
  { value: 'ja', label: '日本語', shortLabel: '日语' },
  { value: 'de', label: 'Deutsch', shortLabel: '德语' },
  { value: 'fr', label: 'Français', shortLabel: '法语' },
] as const;

export type SupportedTargetLanguage =
  (typeof SUPPORTED_TARGET_LANGUAGES)[number]['value'];

export function isSupportedTargetLanguage(
  value: unknown,
): value is SupportedTargetLanguage {
  return SUPPORTED_TARGET_LANGUAGES.some((language) => language.value === value);
}

export function supportedTargetLanguageLabel(
  value: SupportedTargetLanguage,
): string {
  return SUPPORTED_TARGET_LANGUAGES.find((language) => language.value === value)!.shortLabel;
}
