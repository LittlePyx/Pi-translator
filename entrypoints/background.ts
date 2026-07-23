import { protectLatex, restoreLatex } from '../core/latex/protector';
import { toTranslationError, TranslationError } from '../core/messaging/errors';
import {
  isRuntimeMessage,
  type ConnectionTestResponse,
  type ModelListResponse,
  type PublicSettings,
  type PublicSettingsResponse,
  type RuntimeMessage,
  type RuntimeResponse,
  type TranslateRuntimeResponse,
} from '../core/messaging/messages';
import { createContextMenuSnapshot } from '../core/selection/generic-selection';
import { MAX_SELECTION_LENGTH } from '../core/selection/types';
import { createSerialTaskRunner } from '../core/runtime/serial-task';
import {
  getApiKey,
  getSettings,
  restrictSensitiveStorageAccess,
} from '../core/settings/repository';
import {
  getAutoInjectionPatterns,
  isInjectableWebUrl,
  isOverleafProjectUrl,
} from '../core/settings/site-access';
import { getPausedSiteHosts } from '../core/settings/site-pause';
import { shouldProtectLatex } from '../core/translation/content-mode';
import { DeepSeekTranslator } from '../core/translation/deepseek-translator';
import type { TranslateRequest, TranslateResult } from '../core/translation/types';

const CONTEXT_MENU_ID = 'translate-selection-with-deepseek';
const GENERAL_CONTENT_SCRIPT_ID = 'pi-translator-general-pages';
const GENERAL_CONTENT_SCRIPT_FILE = '/content-scripts/general.js';
const translator = new DeepSeekTranslator();
const activeRequests = new Map<number, { requestId: string; controller: AbortController }>();

function toPublicSettings(
  settings: Awaited<ReturnType<typeof getSettings>>,
  pausedSiteHosts: string[],
): PublicSettings {
  return {
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    style: settings.style,
    contentMode: settings.contentMode,
    showFloatingButtonOnOverleaf: settings.showFloatingButtonOnOverleaf,
    hideFloatingButtonForTargetLanguage:
      settings.hideFloatingButtonForTargetLanguage,
    generalPageMode: settings.generalPageMode,
    siteAllowlist: settings.siteAllowlist,
    pausedSiteHosts,
  };
}

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
    title: '使用 Pi Translator 翻译选中文本',
    contexts: ['selection'],
    documentUrlPatterns:
      settings.generalPageMode === 'off'
        ? ['https://www.overleaf.com/*']
        : ['http://*/*', 'https://*/*'],
  });
}

async function synchronizeGeneralPageAccessNow(): Promise<void> {
  const registered = await browser.scripting.getRegisteredContentScripts({
    ids: [GENERAL_CONTENT_SCRIPT_ID],
  });
  if (registered.length > 0) {
    await browser.scripting.unregisterContentScripts({
      ids: [GENERAL_CONTENT_SCRIPT_ID],
    });
  }

  const settings = await getSettings();
  const matches = getAutoInjectionPatterns(
    settings.generalPageMode,
    settings.siteAllowlist,
  );
  if (matches.length === 0) return;

  const hasPermission = await browser.permissions.contains({ origins: matches });
  if (!hasPermission) return;

  await browser.scripting.registerContentScripts([
    {
      id: GENERAL_CONTENT_SCRIPT_ID,
      js: [GENERAL_CONTENT_SCRIPT_FILE],
      matches,
      excludeMatches: ['https://www.overleaf.com/project/*'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

const synchronizeGeneralPageAccess = createSerialTaskRunner(
  synchronizeGeneralPageAccessNow,
);

function scheduleGeneralPageAccessSync(): void {
  void synchronizeGeneralPageAccess().catch((error: unknown) => {
    console.error('Failed to synchronize general page access.', error);
  });
}

async function broadcastPublicSettings(): Promise<void> {
  const [settings, pausedSiteHosts] = await Promise.all([
    getSettings(),
    getPausedSiteHosts(),
  ]);
  const publicSettings = toPublicSettings(settings, pausedSiteHosts);
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
      .map((tab) =>
        browser.tabs.sendMessage(tab.id, {
          type: 'PUBLIC_SETTINGS_UPDATED',
          payload: publicSettings,
        } satisfies RuntimeMessage),
      ),
  );
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
    const protect = shouldProtectLatex(request.contentMode, request.pageUrl, text);
    const protectedLatex = protect ? protectLatex(text) : undefined;
    const providerResult = await translator.translate(
      {
        text: protectedLatex?.protectedText ?? text,
        placeholderTokens:
          protectedLatex?.fragments.map((fragment) => fragment.token) ?? [],
      },
      {
        model: settings.model,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        style: request.style,
        glossary: settings.academicGlossary,
      },
      { apiKey },
      controller.signal,
    );
    const current = activeRequests.get(tabId);
    if (current?.requestId !== request.requestId) {
      throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
    }

    const restored = protectedLatex
      ? restoreLatex(providerResult.translatedText, protectedLatex)
      : { text: providerResult.translatedText, warnings: [] };
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
    return errorResponse<{ connected: true }>(
      new TranslationError('NO_API_KEY', 'Configure a DeepSeek API Key first.'),
    );
  }
  const controller = new AbortController();
  try {
    await translator.testConnection({ model }, { apiKey }, controller.signal);
    return { ok: true, data: { connected: true } };
  } catch (error) {
    return errorResponse<{ connected: true }>(error);
  }
}

async function listModels(
  apiKeyOverride: string | undefined,
): Promise<ModelListResponse> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey());
  if (!apiKey) {
    return errorResponse<{ models: string[] }>(
      new TranslationError('NO_API_KEY', 'Configure a DeepSeek API Key first.'),
    );
  }
  try {
    const models = await translator.listModels(
      { apiKey },
      new AbortController().signal,
    );
    return { ok: true, data: { models } };
  } catch (error) {
    return errorResponse(error);
  }
}

async function sendToSelectionContentScript(
  tab: { id?: number | undefined; url?: string | undefined },
  message: RuntimeMessage,
): Promise<void> {
  if (tab.id === undefined || !tab.url) {
    if (message.type === 'TRIGGER_TRANSLATE') {
      await browser.runtime.openOptionsPage();
    }
    return;
  }

  if (isOverleafProjectUrl(tab.url)) {
    await browser.tabs.sendMessage(tab.id, message);
    return;
  }

  const settings = await getSettings();
  if (
    settings.generalPageMode === 'off' ||
    !isInjectableWebUrl(tab.url)
  ) {
    if (message.type === 'TRIGGER_TRANSLATE') {
      await browser.runtime.openOptionsPage();
    }
    return;
  }

  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: [GENERAL_CONTENT_SCRIPT_FILE],
  });
  await browser.tabs.sendMessage(tab.id, message);
}

export default defineBackground(() => {
  void restrictSensitiveStorageAccess();
  void synchronizeContextMenu();
  scheduleGeneralPageAccessSync();

  browser.runtime.onInstalled.addListener((details) => {
    void synchronizeContextMenu();
    scheduleGeneralPageAccessSync();
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onStartup.addListener(() => {
    void synchronizeContextMenu();
    scheduleGeneralPageAccessSync();
  });

  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'extensionSettings' in changes) {
      void synchronizeContextMenu();
      scheduleGeneralPageAccessSync();
      void broadcastPublicSettings();
    }
    if (areaName === 'session' && 'pausedSiteHosts' in changes) {
      void broadcastPublicSettings();
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
    void sendToSelectionContentScript(tab, {
      type: 'CONTEXT_MENU_TRANSLATE',
      payload: snapshot,
    }).catch(() => undefined);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'translate-selection' || tab?.id === undefined) return;
    void sendToSelectionContentScript(tab, {
      type: 'TRIGGER_TRANSLATE',
    }).catch(() => undefined);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    activeRequests.get(tabId)?.controller.abort();
    activeRequests.delete(tabId);
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender): Promise<unknown> | undefined => {
      if (!isRuntimeMessage(message)) return undefined;

      if (message.type === 'GET_PUBLIC_SETTINGS') {
        return Promise.all([getSettings(), getPausedSiteHosts()]).then(
          ([settings, pausedSiteHosts]): PublicSettingsResponse => ({
            ok: true,
            data: toPublicSettings(settings, pausedSiteHosts),
          }),
        );
      }

      if (message.type === 'CANCEL_TRANSLATION') {
        const tabId = sender.tab?.id;
        const active = tabId === undefined ? undefined : activeRequests.get(tabId);
        const cancelled = active?.requestId === message.payload.requestId;
        if (cancelled) {
          active.controller.abort();
        }
        return Promise.resolve({
          ok: true,
          data: { cancelled },
        });
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

      if (message.type === 'LIST_DEEPSEEK_MODELS') {
        return listModels(message.payload.apiKey);
      }

      return undefined;
    },
  );
});
