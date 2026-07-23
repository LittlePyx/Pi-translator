import type {
  ConnectionTestResponse,
  ModelListResponse,
  RuntimeMessage,
} from '../../core/messaging/messages';
import {
  runtimeConnectionErrorMessage,
  translationErrorMessage,
} from '../../core/messaging/user-facing-error';
import {
  clearApiKey,
  getSettings,
  hasApiKey,
  moveApiKey,
  saveApiKey,
  saveSettings,
} from '../../core/settings/repository';
import {
  DEEPSEEK_MODEL_PRESETS,
  type ApiKeyStorageMode,
  type ContentMode,
  type ExtensionSettings,
  type GeneralPageMode,
} from '../../core/settings/schema';
import {
  getAutoInjectionPatterns,
  normalizeSiteAllowlist,
} from '../../core/settings/site-access';
import type { TranslationStyle } from '../../core/translation/types';
import {
  formatGlossaryEntries,
  parseGlossaryText,
} from '../../core/translation/glossary';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing options element #${id}`);
  return value as T;
}

const form = element<HTMLFormElement>('settings-form');
const apiKeyInput = element<HTMLInputElement>('api-key');
const apiKeyState = element<HTMLElement>('api-key-state');
const persistKey = element<HTMLInputElement>('persist-key');
const modelPreset = element<HTMLSelectElement>('model-preset');
const refreshModelsButton = element<HTMLButtonElement>('refresh-models');
const customModelField = element<HTMLElement>('custom-model-field');
const customModel = element<HTMLInputElement>('custom-model');
const sourceLanguage = element<HTMLSelectElement>('source-language');
const targetLanguage = element<HTMLSelectElement>('target-language');
const styleSelect = element<HTMLSelectElement>('style');
const contentMode = element<HTMLSelectElement>('content-mode');
const academicGlossary = element<HTMLTextAreaElement>('academic-glossary');
const generalPageMode = element<HTMLSelectElement>('general-page-mode');
const pageModeHelp = element<HTMLElement>('page-mode-help');
const siteAllowlistField = element<HTMLElement>('site-allowlist-field');
const siteAllowlist = element<HTMLTextAreaElement>('site-allowlist');
const floatingButton = element<HTMLInputElement>('floating-button');
const hideTargetLanguageTrigger = element<HTMLInputElement>(
  'hide-target-language-trigger',
);
const contextMenu = element<HTMLInputElement>('context-menu');
const testButton = element<HTMLButtonElement>('test-connection');
const clearButton = element<HTMLButtonElement>('clear-key');
const status = element<HTMLParagraphElement>('status');
const shortcutsButton = element<HTMLButtonElement>('open-shortcuts');

let originalMode: ApiKeyStorageMode = 'session';
let loadedSettings: ExtensionSettings | undefined;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function selectedModel(): string {
  return modelPreset.value === 'custom'
    ? customModel.value.trim()
    : modelPreset.value;
}

function refreshModelField(): void {
  customModelField.hidden = modelPreset.value !== 'custom';
}

function populateModelOptions(models: string[], selected?: string): void {
  modelPreset.replaceChildren();
  const knownLabels = new Map<string, string>(
    DEEPSEEK_MODEL_PRESETS.map((preset) => [preset.value, preset.label]),
  );
  for (const model of [...new Set(models)]) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = knownLabels.get(model) ?? model;
    modelPreset.append(option);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = '自定义模型…';
  modelPreset.append(custom);

  if (selected && models.includes(selected)) {
    modelPreset.value = selected;
    customModel.value = '';
  } else if (selected) {
    modelPreset.value = 'custom';
    customModel.value = selected;
  }
  refreshModelField();
}

function refreshPageModeFields(): void {
  const mode = generalPageMode.value as GeneralPageMode;
  siteAllowlistField.hidden = mode !== 'allowlist';
  const messages: Record<GeneralPageMode, string> = {
    off: '普通网页不会显示菜单或浮动按钮。',
    'on-demand': '仅在你使用右键菜单或快捷键时临时访问当前网页，不申请长期权限。',
    allowlist: '只在指定网站持续启用划词按钮；其他普通网页仍可按需翻译。',
    'all-sites': '会请求所有 HTTP/HTTPS 网站的长期访问权限，以显示划词按钮。',
  };
  pageModeHelp.textContent = messages[mode];
}

async function refreshKeyState(): Promise<void> {
  apiKeyState.textContent = (await hasApiKey())
    ? '已配置；留空可保留当前 Key'
    : '尚未配置';
}

async function load(): Promise<void> {
  const settings = await getSettings();
  loadedSettings = settings;
  originalMode = settings.apiKeyStorage;
  persistKey.checked = settings.apiKeyStorage === 'local';

  const knownModel = DEEPSEEK_MODEL_PRESETS.some(
    (preset) => preset.value === settings.model,
  );
  modelPreset.value = knownModel ? settings.model : 'custom';
  customModel.value = knownModel ? '' : settings.model;
  refreshModelField();

  sourceLanguage.value = settings.sourceLanguage;
  targetLanguage.value = settings.targetLanguage;
  styleSelect.value = settings.style;
  contentMode.value = settings.contentMode;
  academicGlossary.value = formatGlossaryEntries(settings.academicGlossary);
  generalPageMode.value = settings.generalPageMode;
  siteAllowlist.value = settings.siteAllowlist.join('\n');
  floatingButton.checked = settings.showFloatingButtonOnOverleaf;
  hideTargetLanguageTrigger.checked =
    settings.hideFloatingButtonForTargetLanguage;
  contextMenu.checked = settings.enableContextMenu;
  refreshPageModeFields();
  await refreshKeyState();
}

async function requestAutomaticPageAccess(
  mode: GeneralPageMode,
  allowlist: string[],
): Promise<void> {
  const origins = getAutoInjectionPatterns(mode, allowlist);
  if (origins.length === 0) return;
  const granted = await browser.permissions.request({ origins });
  if (!granted) {
    throw new Error('未获得网页访问权限，页面范围设置没有保存。');
  }
}

modelPreset.addEventListener('change', refreshModelField);
generalPageMode.addEventListener('change', refreshPageModeFields);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const mode = generalPageMode.value as GeneralPageMode;
  const allowlist = normalizeSiteAllowlist(siteAllowlist.value.split(/\r?\n|,/));
  const model = selectedModel();
  const glossary = parseGlossaryText(academicGlossary.value);

  if (!model) {
    setStatus('请填写模型名称。', true);
    return;
  }
  if (mode === 'allowlist' && allowlist.length === 0) {
    setStatus('请至少填写一个有效的网站域名。', true);
    return;
  }
  if (glossary.errors.length > 0) {
    setStatus(glossary.errors[0] ?? '术语表格式不正确。', true);
    return;
  }

  void (async () => {
    await requestAutomaticPageAccess(mode, allowlist);

    const keyMode: ApiKeyStorageMode = persistKey.checked ? 'local' : 'session';
    const current = loadedSettings ?? (await getSettings());
    const nextSettings: ExtensionSettings = {
      ...current,
      model,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
      style: styleSelect.value as TranslationStyle,
      contentMode: contentMode.value as ContentMode,
      apiKeyStorage: keyMode,
      showFloatingButtonOnOverleaf: floatingButton.checked,
      hideFloatingButtonForTargetLanguage: hideTargetLanguageTrigger.checked,
      generalPageMode: mode,
      siteAllowlist: allowlist,
      enableContextMenu: contextMenu.checked,
      academicGlossary: glossary.entries,
    };
    await saveSettings(nextSettings);

    if (apiKeyInput.value.trim()) {
      await saveApiKey(apiKeyInput.value, keyMode);
      apiKeyInput.value = '';
    } else if (keyMode !== originalMode) {
      await moveApiKey(keyMode);
    }

    originalMode = keyMode;
    loadedSettings = nextSettings;
    await refreshKeyState();
    setStatus('设置已保存，并已同步到打开的页面。');
  })().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : '保存设置失败。', true);
  });
});

refreshModelsButton.addEventListener('click', () => {
  const currentModel = selectedModel();
  void (async () => {
    refreshModelsButton.disabled = true;
    setStatus('正在读取 DeepSeek 可用模型…');
    const apiKey = apiKeyInput.value.trim();
    const response = (await browser.runtime.sendMessage({
      type: 'LIST_DEEPSEEK_MODELS',
      payload: {
        ...(apiKey ? { apiKey } : {}),
      },
    } satisfies RuntimeMessage)) as ModelListResponse;
    if (!response.ok) {
      setStatus(
        translationErrorMessage(response.error.code, response.error.message),
        true,
      );
      return;
    }
    if (response.data.models.length === 0) {
      setStatus('DeepSeek 没有返回可用模型，请稍后重试。', true);
      return;
    }
    populateModelOptions(response.data.models, currentModel);
    setStatus(`已读取 ${response.data.models.length} 个可用模型。`);
  })()
    .catch((error: unknown) => {
      setStatus(runtimeConnectionErrorMessage(error), true);
    })
    .finally(() => {
      refreshModelsButton.disabled = false;
    });
});

testButton.addEventListener('click', () => {
  const model = selectedModel();
  if (!model) {
    setStatus('请先选择或填写模型名称。', true);
    return;
  }
  void (async () => {
    testButton.disabled = true;
    setStatus('正在测试 DeepSeek 连接…');
    const apiKey = apiKeyInput.value.trim();
    const response = (await browser.runtime.sendMessage({
      type: 'TEST_DEEPSEEK_CONNECTION',
      payload: {
        model,
        ...(apiKey ? { apiKey } : {}),
      },
    } satisfies RuntimeMessage)) as ConnectionTestResponse;
    if (response.ok) {
      setStatus('连接成功，API Key 和模型可用。');
    } else {
      setStatus(
        translationErrorMessage(response.error.code, response.error.message),
        true,
      );
    }
  })()
    .catch((error: unknown) => {
      setStatus(runtimeConnectionErrorMessage(error), true);
    })
    .finally(() => {
      testButton.disabled = false;
    });
});

clearButton.addEventListener('click', () => {
  void clearApiKey()
    .then(async () => {
      apiKeyInput.value = '';
      await refreshKeyState();
      setStatus('API Key 已清除。');
    })
    .catch(() => setStatus('清除 API Key 失败。', true));
});

shortcutsButton.addEventListener('click', () => {
  void browser.tabs.create({ url: 'edge://extensions/shortcuts' });
});

populateModelOptions(DEEPSEEK_MODEL_PRESETS.map((preset) => preset.value));
void load().catch(() => setStatus('读取设置失败，请重新加载页面。', true));
