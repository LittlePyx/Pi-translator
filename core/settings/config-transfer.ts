import { normalizeGlossaryEntries } from '../translation/glossary';
import { normalizeApiBaseUrl } from './api-access';
import { normalizeSiteAllowlist } from './site-access';
import type { ApiProfile, ExtensionSettings } from './schema';

const CONFIG_FORMAT = 'pi-translator-settings';
const CONFIG_VERSION = 1;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('配置文件格式不正确。');
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

export function exportSettingsConfiguration(settings: ExtensionSettings): string {
  const activeApiProfileIndex = Math.max(
    0,
    settings.apiProfiles.findIndex((profile) => profile.id === settings.activeApiProfileId),
  );
  return JSON.stringify({
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    containsApiKeys: false,
    settings: {
      apiProfiles: settings.apiProfiles.map(({ name, apiBaseUrl, model }) => ({
        name,
        apiBaseUrl,
        model,
      })),
      activeApiProfileIndex,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      style: settings.style,
      contentMode: settings.contentMode,
      showFloatingButtonOnOverleaf: settings.showFloatingButtonOnOverleaf,
      hideFloatingButtonForTargetLanguage: settings.hideFloatingButtonForTargetLanguage,
      generalPageMode: settings.generalPageMode,
      siteAllowlist: settings.siteAllowlist,
      enableContextMenu: settings.enableContextMenu,
      academicGlossary: settings.academicGlossary,
      rememberRecentTranslations: settings.rememberRecentTranslations,
      enableSessionCache: settings.enableSessionCache,
      historyLimit: settings.historyLimit,
      sentenceAlignmentDefault: settings.sentenceAlignmentDefault,
      sidebarSide: settings.sidebarSide,
      sidebarWidth: settings.sidebarWidth,
      contextMode: settings.contextMode,
      enableStreaming: settings.enableStreaming,
      protectSensitiveFields: settings.protectSensitiveFields,
    },
  }, null, 2);
}

export function importSettingsConfiguration(
  input: string,
  current: ExtensionSettings,
): ExtensionSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('配置文件不是有效的 JSON。');
  }
  const envelope = record(parsed);
  if (envelope.format !== CONFIG_FORMAT || envelope.version !== CONFIG_VERSION) {
    throw new Error('这不是受支持的 Pi Translator 配置文件。');
  }
  const source = record(envelope.settings);
  if (!Array.isArray(source.apiProfiles) || !source.apiProfiles.length) {
    throw new Error('配置文件中没有翻译 API 配置。');
  }
  const apiProfiles = source.apiProfiles.slice(0, 6).map((value, index): ApiProfile => {
    const profile = record(value);
    const name = typeof profile.name === 'string'
      ? profile.name.trim().slice(0, 30)
      : `导入接口 ${index + 1}`;
    const model = typeof profile.model === 'string' ? profile.model.trim() : '';
    if (!model) throw new Error(`第 ${index + 1} 个 API 配置缺少模型名称。`);
    return {
      id: crypto.randomUUID(),
      name: name || `导入接口 ${index + 1}`,
      apiBaseUrl: normalizeApiBaseUrl(String(profile.apiBaseUrl ?? '')),
      model,
    };
  });
  const requestedIndex = typeof source.activeApiProfileIndex === 'number'
    ? Math.round(source.activeApiProfileIndex)
    : 0;
  const active = apiProfiles[Math.min(apiProfiles.length - 1, Math.max(0, requestedIndex))]!;
  const historyLimit = source.historyLimit === 10 || source.historyLimit === 20 ? source.historyLimit : 5;
  const sidebarWidth = typeof source.sidebarWidth === 'number' && Number.isFinite(source.sidebarWidth)
    ? Math.min(640, Math.max(320, Math.round(source.sidebarWidth)))
    : current.sidebarWidth;
  const glossary = Array.isArray(source.academicGlossary)
    ? normalizeGlossaryEntries(source.academicGlossary.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        return typeof item.source === 'string' && typeof item.target === 'string'
          ? [{ source: item.source, target: item.target }]
          : [];
      }))
    : [];
  return {
    ...current,
    schemaVersion: 7,
    provider: 'openai-compatible',
    apiProfiles,
    activeApiProfileId: active.id,
    apiBaseUrl: active.apiBaseUrl,
    model: active.model,
    apiKeyStorage: 'session',
    sourceLanguage: typeof source.sourceLanguage === 'string' ? source.sourceLanguage : 'auto',
    targetLanguage: typeof source.targetLanguage === 'string' ? source.targetLanguage : current.targetLanguage,
    style: oneOf(source.style, ['academic', 'general', 'literal'] as const, 'academic'),
    contentMode: oneOf(source.contentMode, ['auto', 'plain', 'latex'] as const, 'auto'),
    showFloatingButtonOnOverleaf: source.showFloatingButtonOnOverleaf !== false,
    hideFloatingButtonForTargetLanguage: source.hideFloatingButtonForTargetLanguage !== false,
    generalPageMode: oneOf(source.generalPageMode, ['off', 'on-demand', 'allowlist', 'all-sites'] as const, 'on-demand'),
    siteAllowlist: Array.isArray(source.siteAllowlist)
      ? normalizeSiteAllowlist(source.siteAllowlist.filter((value): value is string => typeof value === 'string'))
      : [],
    enableContextMenu: source.enableContextMenu !== false,
    academicGlossary: glossary,
    rememberRecentTranslations: source.rememberRecentTranslations !== false,
    enableSessionCache: source.enableSessionCache !== false,
    historyLimit,
    sentenceAlignmentDefault: source.sentenceAlignmentDefault === true,
    sidebarSide: source.sidebarSide === 'left' ? 'left' : 'right',
    sidebarWidth,
    contextMode: oneOf(source.contextMode, ['off', 'sentence', 'paragraph'] as const, 'off'),
    enableStreaming: source.enableStreaming !== false,
    protectSensitiveFields: source.protectSensitiveFields !== false,
    onboardingCompleted: true,
  };
}
