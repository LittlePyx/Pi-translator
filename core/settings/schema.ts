import type { TranslationStyle } from '../translation/types';

export type ApiKeyStorageMode = 'session' | 'local';

export interface ExtensionSettingsV1 {
  schemaVersion: 1;
  provider: 'deepseek';
  model: string;
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  apiKeyStorage: ApiKeyStorageMode;
  showFloatingButtonOnOverleaf: boolean;
  enableContextMenu: boolean;
}

export type ExtensionSettings = ExtensionSettingsV1;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 1,
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  apiKeyStorage: 'session',
  showFloatingButtonOnOverleaf: true,
  enableContextMenu: true,
};
