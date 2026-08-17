import type { GlossaryEntry, TranslationStyle } from '../translation/types';

export type ApiKeyStorageMode = 'session' | 'local';
export type GeneralPageMode = 'off' | 'on-demand' | 'allowlist' | 'all-sites';
export type ContentMode = 'auto' | 'plain' | 'latex';
export type HistoryLimit = 5 | 10 | 20;
export type SidebarSide = 'left' | 'right';
export type SidebarMode = 'floating' | 'browser';
export type ContextMode = 'off' | 'sentence' | 'paragraph';

export interface ApiProfile {
  id: string;
  name: string;
  apiBaseUrl: string;
  model: string;
}

export interface ExtensionSettingsV8 {
  schemaVersion: 8;
  provider: 'openai-compatible';
  apiProfiles: ApiProfile[];
  activeApiProfileId: string;
  visionApiProfileId: string;
  visionModel: string;
  apiBaseUrl: string;
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
  rememberRecentTranslations: boolean;
  enableSessionCache: boolean;
  historyLimit: HistoryLimit;
  sentenceAlignmentDefault: boolean;
  autoRenderLatex: boolean;
  sidebarMode: SidebarMode;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
  contextMode: ContextMode;
  enableStreaming: boolean;
  protectSensitiveFields: boolean;
  pdfKeyboardShortcutsEnabled: boolean;
  pdfRegionShortcutKey: string;
  onboardingCompleted: boolean;
}

export type ExtensionSettings = ExtensionSettingsV8;

export const DEFAULT_API_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_API_PROFILE: ApiProfile = {
  id: 'default',
  name: '默认接口',
  apiBaseUrl: DEFAULT_API_BASE_URL,
  model: 'deepseek-v4-flash',
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: 8,
  provider: 'openai-compatible',
  apiProfiles: [DEFAULT_API_PROFILE],
  activeApiProfileId: DEFAULT_API_PROFILE.id,
  visionApiProfileId: '',
  visionModel: 'qwen3.7-plus',
  apiBaseUrl: DEFAULT_API_BASE_URL,
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
  rememberRecentTranslations: true,
  enableSessionCache: true,
  historyLimit: 5,
  sentenceAlignmentDefault: false,
  autoRenderLatex: true,
  sidebarMode: 'floating',
  sidebarSide: 'right',
  sidebarWidth: 390,
  contextMode: 'off',
  enableStreaming: true,
  protectSensitiveFields: true,
  pdfKeyboardShortcutsEnabled: true,
  pdfRegionShortcutKey: 'r',
  onboardingCompleted: false,
};
