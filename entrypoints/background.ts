import { protectLatex, restoreLatex } from '../core/latex/protector';
import { toTranslationError, TranslationError } from '../core/messaging/errors';
import {
  isRuntimeMessage,
  type ConnectionTestResponse,
  type PublicSettingsResponse,
  type RuntimeMessage,
  type RuntimeResponse,
  type TranslateRuntimeResponse,
} from '../core/messaging/messages';
import { createContextMenuSnapshot } from '../core/selection/generic-selection';
import { MAX_SELECTION_LENGTH } from '../core/selection/types';
import {
  getApiKey,
  getSettings,
  restrictSensitiveStorageAccess,
} from '../core/settings/repository';
import { DeepSeekTranslator } from '../core/translation/deepseek-translator';
import type { TranslateRequest, TranslateResult } from '../core/translation/types';

const CONTEXT_MENU_ID = 'translate-selection-with-deepseek';
const translator = new DeepSeekTranslator();
const activeRequests = new Map<number, { requestId: string; controller: AbortController }>();

function errorResponse<T = never>(error: unknown): RuntimeResponse<T> {
  const normalized = toTranslationError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    },
  };
}

async function synchronizeContextMenu(): Promise<void> {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch {
    // The menu does not exist on first install.
  }
  const settings = await getSettings();
  if (!settings.enableContextMenu) return;
  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '使用 DeepSeek 翻译选中文本',
    contexts: ['selection'],
    documentUrlPatterns: ['https://www.overleaf.com/*'],
  });
}

async function translate(
  request: TranslateRequest,
  tabId: number,
): Promise<TranslateRuntimeResponse> {
  const text = request.text.trim();
  if (!text) {
    return errorResponse(new TranslationError('EMPTY_SELECTION', 'No text was selected.'));
  }
  if (text.length > MAX_SELECTION_LENGTH) {
    return errorResponse(
      new TranslationError('SELECTION_TOO_LONG', 'The selected text is too long.'),
    );
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return errorResponse(
      new TranslationError('NO_API_KEY', 'Configure a DeepSeek API Key first.'),
    );
  }

  const previous = activeRequests.get(tabId);
  previous?.controller.abort();
  const controller = new AbortController();
  activeRequests.set(tabId, { requestId: request.requestId, controller });

  try {
    const settings = await getSettings();
    const protectedLatex = protectLatex(text);
    const providerResult = await translator.translate(
      {
        text: protectedLatex.protectedText,
        placeholderTokens: protectedLatex.fragments.map((fragment) => fragment.token),
      },
      {
        model: settings.model,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        style: request.style,
      },
      { apiKey },
      controller.signal,
    );
    const current = activeRequests.get(tabId);
    if (current?.requestId !== request.requestId) {
      throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
    }
    const restored = restoreLatex(providerResult.translatedText, protectedLatex);
    const result: TranslateResult = {
      requestId: request.requestId,
      originalText: text,
      translatedText: restored.text,
      ...(providerResult.detectedLanguage
        ? { detectedLanguage: providerResult.detectedLanguage }
        : {}),
      warnings: restored.warnings,
    };
    return { ok: true, data: result };
  } catch (error) {
    return errorResponse(error);
  } finally {
    const current = activeRequests.get(tabId);
    if (current?.requestId === request.requestId) {
      activeRequests.delete(tabId);
    }
  }
}

async function testConnection(
  apiKeyOverride: string | undefined,
  model: string,
): Promise<ConnectionTestResponse> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey());
  if (!apiKey) {
    const failure = errorResponse<{ connected: true }>(
      new TranslationError('NO_API_KEY', 'Configure a DeepSeek API Key first.'),
    );
    return failure;
  }
  const controller = new AbortController();
  try {
    await translator.testConnection({ model }, { apiKey }, controller.signal);
    return { ok: true, data: { connected: true } };
  } catch (error) {
    return errorResponse<{ connected: true }>(error);
  }
}

export default defineBackground(() => {
  void restrictSensitiveStorageAccess();
  void synchronizeContextMenu();

  browser.runtime.onInstalled.addListener((details) => {
    void synchronizeContextMenu();
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'extensionSettings' in changes) {
      void synchronizeContextMenu();
    }
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId !== CONTEXT_MENU_ID ||
      !info.selectionText ||
      tab?.id === undefined
    ) {
      return;
    }
    const snapshot = createContextMenuSnapshot(info.selectionText, tab.url ?? '');
    void browser.tabs
      .sendMessage(tab.id, {
        type: 'CONTEXT_MENU_TRANSLATE',
        payload: snapshot,
      } satisfies RuntimeMessage)
      .catch(() => undefined);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'translate-selection' || tab?.id === undefined) return;
    void browser.tabs
      .sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' } satisfies RuntimeMessage)
      .catch(() => undefined);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    activeRequests.get(tabId)?.controller.abort();
    activeRequests.delete(tabId);
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender): Promise<unknown> | undefined => {
      if (!isRuntimeMessage(message)) return undefined;

      if (message.type === 'GET_PUBLIC_SETTINGS') {
        return getSettings().then(
          (settings): PublicSettingsResponse => ({
            ok: true,
            data: {
              sourceLanguage: settings.sourceLanguage,
              targetLanguage: settings.targetLanguage,
              style: settings.style,
              showFloatingButtonOnOverleaf: settings.showFloatingButtonOnOverleaf,
            },
          }),
        );
      }

      if (message.type === 'TRANSLATE_SELECTION') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(
            errorResponse(
              new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
            ),
          );
        }
        return translate(message.payload, tabId);
      }

      if (message.type === 'TEST_DEEPSEEK_CONNECTION') {
        return testConnection(message.payload.apiKey, message.payload.model);
      }

      return undefined;
    },
  );
});
