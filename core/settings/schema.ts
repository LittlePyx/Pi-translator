import type { GlossaryEntry, TranslationStyle } from '../translation/types';

export type ApiKeyStorageMode = 'session' | 'local';
export type GeneralPageMode = 'off' | 'on-demand' | 'allowlist' | 'all-sites';
export type ContentMode = 'auto' | 'plain' | 'latex';

export interface ExtensionSettingsV3 {
  schemaVersion: 3;
  provider: 'deepseek';
  model: string;
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  contentMode: ContentMode;
  apiKeyStorage: ApiKeyStorageMode;
  showFloatingButtonOnOverleaf: boolean;
  hideFloatingButtonForTargetLanguage: boolean;
  generalPageMode: GeneralPageMode;
  siteAllowlist: string[];
  enableContextMenu: boolean;
  academicGlossary: GlossaryEntry[];
}

export type ExtensionSettings = ExtensionSettingsV3;

export const DEEPSEEK_MODEL_PRESETS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 3,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  apiKeyStorage: 'session',
  showFloatingButtonOnOverleaf: true,
  hideFloatingButtonForTargetLanguage: true,
  generalPageMode: 'on-demand',
  siteAllowlist: [],
  enableContextMenu: true,
  academicGlossary: [],
};
