import type {
  ConnectionTestResponse,
  RuntimeMessage,
} from '../../core/messaging/messages';
import {
  clearApiKey,
  getSettings,
  hasApiKey,
  moveApiKey,
  saveApiKey,
  saveSettings,
} from '../../core/settings/repository';
import type { ApiKeyStorageMode } from '../../core/settings/schema';
import type { TranslationStyle } from '../../core/translation/types';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing options element #${id}`);
  return value as T;
}

const form = element<HTMLFormElement>('settings-form');
const apiKeyInput = element<HTMLInputElement>('api-key');
const apiKeyState = element<HTMLElement>('api-key-state');
const persistKey = element<HTMLInputElement>('persist-key');
const modelInput = element<HTMLInputElement>('model');
const targetLanguage = element<HTMLSelectElement>('target-language');
const styleSelect = element<HTMLSelectElement>('style');
const floatingButton = element<HTMLInputElement>('floating-button');
const contextMenu = element<HTMLInputElement>('context-menu');
const testButton = element<HTMLButtonElement>('test-connection');
const clearButton = element<HTMLButtonElement>('clear-key');
const status = element<HTMLParagraphElement>('status');
const shortcutsButton = element<HTMLButtonElement>('open-shortcuts');

let originalMode: ApiKeyStorageMode = 'session';

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

async function refreshKeyState(): Promise<void> {
  apiKeyState.textContent = (await hasApiKey())
    ? '已配置；留空可保留当前 Key'
    : '尚未配置';
}

async function load(): Promise<void> {
  const settings = await getSettings();
  originalMode = settings.apiKeyStorage;
  persistKey.checked = settings.apiKeyStorage === 'local';
  modelInput.value = settings.model;
  targetLanguage.value = settings.targetLanguage;
  styleSelect.value = settings.style;
  floatingButton.checked = settings.showFloatingButtonOnOverleaf;
  contextMenu.checked = settings.enableContextMenu;
  await refreshKeyState();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const mode: ApiKeyStorageMode = persistKey.checked ? 'local' : 'session';
    const current = await getSettings();
    await saveSettings({
      ...current,
      model: modelInput.value.trim() || current.model,
      targetLanguage: targetLanguage.value,
      style: styleSelect.value as TranslationStyle,
      apiKeyStorage: mode,
      showFloatingButtonOnOverleaf: floatingButton.checked,
      enableContextMenu: contextMenu.checked,
    });

    if (apiKeyInput.value.trim()) {
      await saveApiKey(apiKeyInput.value, mode);
      apiKeyInput.value = '';
    } else if (mode !== originalMode) {
      await moveApiKey(mode);
    }
    originalMode = mode;
    await refreshKeyState();
    setStatus('设置已保存。刷新 Overleaf 页面后应用浮动按钮设置。');
  })().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : '保存设置失败。', true);
  });
});

testButton.addEventListener('click', () => {
  void (async () => {
    testButton.disabled = true;
    setStatus('正在测试 DeepSeek 连接…');
    const apiKey = apiKeyInput.value.trim();
    const response = (await browser.runtime.sendMessage({
      type: 'TEST_DEEPSEEK_CONNECTION',
      payload: {
        model: modelInput.value.trim(),
        ...(apiKey ? { apiKey } : {}),
      },
    } satisfies RuntimeMessage)) as ConnectionTestResponse;
    if (response.ok) {
      setStatus('连接成功，API Key 和模型可用。');
    } else {
      setStatus(response.error.message, true);
    }
  })()
    .catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : '连接测试失败。', true);
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

void load().catch(() => setStatus('读取设置失败，请重新加载页面。', true));
