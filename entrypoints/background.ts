import { protectLatex, restoreLatex } from '../core/latex/protector';
import {
  getLocalDiagnosticEvents,
  recordLocalDiagnosticError,
} from '../core/diagnostics/event-log';
import { toTranslationError, TranslationError } from '../core/messaging/errors';
import {
  isRuntimeMessage,
  type ConnectionTestResponse,
  type ApiDiagnosticResponse,
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
  saveSettings,
} from '../core/settings/repository';
import { apiOriginPattern } from '../core/settings/api-access';
import {
  getAutoInjectionPatterns,
  isInjectableWebUrl,
  isOverleafProjectUrl,
} from '../core/settings/site-access';
import { getPausedSiteHosts, setSitePaused } from '../core/settings/site-pause';
import { shouldProtectLatex } from '../core/translation/content-mode';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';
import {
  addTranslationHistory,
  clearTranslationHistory,
  deleteTranslationHistoryEntry,
  getTranslationHistory,
  setTranslationHistoryPinned,
} from '../core/translation/history-repository';
import {
  cacheTranslation,
  clearTranslationCache,
  getCachedTranslation,
  translationCacheKey,
} from '../core/translation/cache-repository';
import { splitTranslationSegments } from '../core/translation/sentence-segmentation';
import { splitLongTranslationText } from '../core/translation/text-chunker';
import {
  addTranslationFavorite,
  deleteTranslationFavorite,
  getTranslationFavorites,
} from '../core/translation/favorites-repository';
import type {
  TranslateRequest,
  TranslateResult,
  TranslationSegment,
} from '../core/translation/types';

const CONTEXT_MENU_ID = 'translate-selection-with-pi-translator';
const LEGACY_CONTEXT_MENU_ID = 'translate-selection-with-deepseek';
const GENERAL_CONTENT_SCRIPT_ID = 'pi-translator-general-pages';
const GENERAL_CONTENT_SCRIPT_FILE = '/content-scripts/general.js';
const translator = new OpenAiCompatibleTranslator();
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
    sentenceAlignmentDefault: settings.sentenceAlignmentDefault,
    historyLimit: settings.historyLimit,
    sidebarSide: settings.sidebarSide,
    sidebarWidth: settings.sidebarWidth,
    contextMode: settings.contextMode,
    enableStreaming: settings.enableStreaming,
    protectSensitiveFields: settings.protectSensitiveFields,
    activeApiProfileId: settings.activeApiProfileId,
    apiProfiles: settings.apiProfiles.map(({ id, name, model }) => ({ id, name, model })),
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

async function localDiagnosticReport(): Promise<string> {
  const settings = await getSettings();
  const [apiKeyConfigured, apiPermissionGranted, recentErrors] = await Promise.all([
    getApiKey(settings.activeApiProfileId).then(Boolean),
    browser.permissions.contains({ origins: [apiOriginPattern(settings.apiBaseUrl)] }),
    getLocalDiagnosticEvents(),
  ]);
  const manifest = browser.runtime.getManifest();
  return JSON.stringify({
    product: 'Pi Translator',
    generatedAt: new Date().toISOString(),
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    locale: navigator.language,
    browser: navigator.userAgent,
    activeApi: {
      profileName: settings.apiProfiles.find((profile) => profile.id === settings.activeApiProfileId)?.name ?? 'unknown',
      profileCount: settings.apiProfiles.length,
      origin: new URL(settings.apiBaseUrl).origin,
      model: settings.model,
      apiKeyConfigured,
      apiPermissionGranted,
    },
    behavior: {
      generalPageMode: settings.generalPageMode,
      siteAllowlistCount: settings.siteAllowlist.length,
      contentMode: settings.contentMode,
      contextMode: settings.contextMode,
      streaming: settings.enableStreaming,
      sensitiveFieldProtection: settings.protectSensitiveFields,
      historyLimit: settings.historyLimit,
      sidebarSide: settings.sidebarSide,
    },
    recentErrors,
    privacy: 'This report excludes API Keys, selected text, translations, page URLs, glossary entries, and site names.',
  }, null, 2);
}

async function synchronizeContextMenu(): Promise<void> {
  for (const menuId of [CONTEXT_MENU_ID, LEGACY_CONTEXT_MENU_ID]) {
    try {
      await browser.contextMenus.remove(menuId);
    } catch {
      // The menu does not exist on first install.
    }
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

  try {
    const previous = activeRequests.get(tabId);
    if (previous?.requestId !== request.requestId) previous?.controller.abort();
    const settings = await getSettings();
    const cacheKey = translationCacheKey(request, {
      apiBaseUrl: settings.apiBaseUrl,
      model: settings.model,
      glossary: settings.academicGlossary,
    });
    if (settings.enableSessionCache && !request.bypassCache) {
      const cached = await getCachedTranslation(tabId, cacheKey, request.requestId);
      if (cached) {
        const history = settings.rememberRecentTranslations
          ? await addTranslationHistory(tabId, cached, settings.historyLimit)
          : [];
        return { ok: true, data: { result: cached, history } };
      }
    }

    const apiKey = await getApiKey(settings.activeApiProfileId);
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', 'Configure an API Key first.');
    }
    const apiPermission = apiOriginPattern(settings.apiBaseUrl);
    if (!(await browser.permissions.contains({ origins: [apiPermission] }))) {
      throw new TranslationError(
        'API_PERMISSION_REQUIRED',
        `Permission for ${apiPermission} is required.`,
      );
    }
    const controller = new AbortController();
    activeRequests.set(tabId, { requestId: request.requestId, controller });
    const startedAt = performance.now();
    const protect = shouldProtectLatex(request.contentMode, request.pageUrl, text);
    const chunks = splitLongTranslationText(text);
    const translatedChunks: string[] = [];
    const warnings: TranslateResult['warnings'] = [];
    const combinedSegments: TranslationSegment[] = [];
    let alignmentComplete = true;
    let detectedLanguage: string | undefined;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex]!;
      const protectedLatex = protect ? protectLatex(chunk, `FULL${chunkIndex + 1}`) : undefined;
      const sourceSegments = splitTranslationSegments(chunk, request.sourceLanguage).map(
        (segment) => ({ ...segment, id: `C${chunkIndex + 1}${segment.id}` }),
      );
      const preparedSegments = sourceSegments.map((segment, index) => ({
        source: segment,
        protected: protect
          ? protectLatex(segment.text, `C${chunkIndex + 1}SEG${index + 1}`)
          : undefined,
      }));
      const prefix = translatedChunks.length ? `${translatedChunks.join('\n\n')}\n\n` : '';
      let lastPartial = '';
      let lastProgressAt = 0;
      const providerResult = await translator.translate(
        {
          text: protectedLatex?.protectedText ?? chunk,
          placeholderTokens:
            protectedLatex?.fragments.map((fragment) => fragment.token) ?? [],
          segments: preparedSegments.map((segment) => ({
            id: segment.source.id,
            text: segment.protected?.protectedText ?? segment.source.text,
          })),
          ...(request.contextText ? { contextText: request.contextText } : {}),
        },
        {
          model: settings.model,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          style: request.style,
          glossary: settings.academicGlossary,
        },
        { apiKey, apiBaseUrl: settings.apiBaseUrl },
        controller.signal,
        settings.enableStreaming && !protect
          ? {
              onPartialText: (partialText) => {
                if (!partialText || partialText === lastPartial) return;
                const now = performance.now();
                if (now - lastProgressAt < 80) return;
                lastPartial = partialText;
                lastProgressAt = now;
                void browser.tabs.sendMessage(tabId, {
                  type: 'TRANSLATION_PROGRESS',
                  payload: {
                    requestId: request.requestId,
                    partialText: `${prefix}${partialText}`,
                    completedChunks: chunkIndex,
                    totalChunks: chunks.length,
                  },
                } satisfies RuntimeMessage).catch(() => undefined);
              },
            }
          : undefined,
      );
      const current = activeRequests.get(tabId);
      if (current?.requestId !== request.requestId) {
        throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
      }

      detectedLanguage ??= providerResult.detectedLanguage;
      const restored = protectedLatex
        ? restoreLatex(providerResult.translatedText, protectedLatex)
        : { text: providerResult.translatedText, warnings: [] };
      translatedChunks.push(restored.text);
      warnings.push(...restored.warnings);
      if (providerResult.alignedSegments?.length === preparedSegments.length) {
        try {
          const translatedById = new Map(
            providerResult.alignedSegments.map((segment) => [segment.id, segment.translatedText]),
          );
          combinedSegments.push(...preparedSegments.map(({ source, protected: protectedSegment }) => {
            const translated = translatedById.get(source.id);
            if (!translated) throw new Error(`Missing aligned segment ${source.id}.`);
            return {
              id: source.id,
              originalText: source.text,
              translatedText: protectedSegment
                ? restoreLatex(translated, protectedSegment).text
                : translated,
            };
          }));
        } catch {
          combinedSegments.length = 0;
          alignmentComplete = false;
        }
      } else alignmentComplete = false;
      await browser.tabs.sendMessage(tabId, {
        type: 'TRANSLATION_PROGRESS',
        payload: {
          requestId: request.requestId,
          completedChunks: chunkIndex + 1,
          totalChunks: chunks.length,
        },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    let sourceHost: string | undefined;
    try {
      sourceHost = new URL(request.pageUrl).hostname;
    } catch {
      sourceHost = undefined;
    }
    const result: TranslateResult = {
      requestId: request.requestId,
      originalText: text,
      translatedText: translatedChunks.join('\n\n'),
      ...(detectedLanguage ? { detectedLanguage } : {}),
      warnings,
      ...(alignmentComplete && combinedSegments.length
        ? { alignedSegments: combinedSegments }
        : {}),
      ...(sourceHost ? { sourceHost } : {}),
      targetLanguage: request.targetLanguage,
      style: request.style,
      completedAt: Date.now(),
      cached: false,
      latencyMs: Math.round(performance.now() - startedAt),
      contextUsed: Boolean(request.contextText),
      chunkCount: chunks.length,
    };
    if (settings.enableSessionCache) {
      await cacheTranslation(tabId, cacheKey, result);
    }
    const history = settings.rememberRecentTranslations
      ? await addTranslationHistory(tabId, result, settings.historyLimit)
      : [];
    return { ok: true, data: { result, history } };
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
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
  apiBaseUrl: string,
  model: string,
  profileId?: string,
): Promise<ConnectionTestResponse> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey(profileId));
  if (!apiKey) {
    return errorResponse<{ connected: true }>(
      new TranslationError('NO_API_KEY', 'Configure an API Key first.'),
    );
  }
  const controller = new AbortController();
  try {
    await translator.testConnection(
      { model },
      { apiKey, apiBaseUrl },
      controller.signal,
    );
    return { ok: true, data: { connected: true } };
  } catch (error) {
    await recordLocalDiagnosticError('test-connection', error);
    return errorResponse<{ connected: true }>(error);
  }
}

async function listModels(
  apiKeyOverride: string | undefined,
  apiBaseUrl: string,
  profileId?: string,
): Promise<ModelListResponse> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey(profileId));
  if (!apiKey) {
    return errorResponse<{ models: string[] }>(
      new TranslationError('NO_API_KEY', 'Configure an API Key first.'),
    );
  }
  try {
    const models = await translator.listModels(
      { apiKey, apiBaseUrl },
      new AbortController().signal,
    );
    return { ok: true, data: { models } };
  } catch (error) {
    await recordLocalDiagnosticError('list-models', error);
    return errorResponse(error);
  }
}

async function diagnoseApi(
  apiKeyOverride: string | undefined,
  apiBaseUrl: string,
  model: string,
  profileId?: string,
): Promise<ApiDiagnosticResponse> {
  const originPattern = apiOriginPattern(apiBaseUrl);
  const permissionGranted = await browser.permissions.contains({ origins: [originPattern] });
  const apiKey = apiKeyOverride?.trim() || (await getApiKey(profileId));
  if (!apiKey) {
    return errorResponse(new TranslationError('NO_API_KEY', 'Configure an API Key first.'));
  }
  if (!permissionGranted) {
    return errorResponse(
      new TranslationError('API_PERMISSION_REQUIRED', `Permission for ${originPattern} is required.`),
    );
  }

  const notes: string[] = [];
  const controller = new AbortController();
  try {
    const startedAt = performance.now();
    const models = await translator.listModels(
      { apiKey, apiBaseUrl },
      controller.signal,
    );
    const configuredModelAvailable = models.length === 0 || models.includes(model);
    if (!models.length) notes.push('接口未返回模型列表，可继续使用手动模型名称。');
    if (!configuredModelAvailable) notes.push('当前模型不在接口返回的模型列表中。');

    const diagnosticResult = await translator.translate(
      {
        text: 'Hello.',
        placeholderTokens: [],
        segments: [{ id: 'S1', text: 'Hello.' }],
      },
      {
        model,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        style: 'general',
      },
      { apiKey, apiBaseUrl },
      controller.signal,
    );
    const structuredOutput = diagnosticResult.structuredResponse !== false;
    const sentenceAlignment = diagnosticResult.alignedSegments?.some(
      (segment) => segment.id === 'S1' && Boolean(segment.translatedText.trim()),
    ) ?? false;
    if (!structuredOutput) notes.push('接口返回了纯文本，完整翻译可用，但高级结构化功能会自动降级。');
    if (!sentenceAlignment) notes.push('接口未返回逐句结果，扩展会保留完整译文。');

    return {
      ok: true,
      data: {
        origin: new URL(apiBaseUrl).origin,
        permissionGranted,
        authenticated: true,
        modelCount: models.length,
        configuredModelAvailable,
        chatCompletion: Boolean(diagnosticResult.translatedText.trim()),
        structuredOutput,
        sentenceAlignment,
        latencyMs: Math.round(performance.now() - startedAt),
        notes,
      },
    };
  } catch (error) {
    await recordLocalDiagnosticError('api-diagnosis', error);
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
    if (message.type === 'OPEN_SIDEBAR') {
      throw new TranslationError(
        'UNSUPPORTED_PAGE',
        'Enable ordinary web page support before opening the sidebar.',
      );
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
      const next = changes.extensionSettings?.newValue as
        | { rememberRecentTranslations?: boolean; enableSessionCache?: boolean }
        | undefined;
      if (next?.rememberRecentTranslations === false) {
        void clearTranslationHistory();
      }
      if (next?.enableSessionCache === false) void clearTranslationCache();
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
    void clearTranslationHistory(tabId);
    void clearTranslationCache(tabId);
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

      if (message.type === 'GET_LOCAL_DIAGNOSTIC_REPORT') {
        return localDiagnosticReport()
          .then((report) => ({ ok: true as const, data: { report } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'OPEN_SIDEBAR') {
        return browser.tabs
          .query({ active: true, currentWindow: true })
          .then(async ([tab]) => {
            if (!tab) return { ok: false, error: { code: 'UNSUPPORTED_PAGE' as const, message: 'No active tab.', retryable: false } };
            await sendToSelectionContentScript(tab, message);
            return { ok: true, data: { opened: true } };
          })
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'SET_SIDEBAR_WIDTH') {
        const width = Math.min(640, Math.max(320, Math.round(message.payload.width)));
        return getSettings()
          .then((settings) => saveSettings({ ...settings, sidebarWidth: width }))
          .then(() => ({ ok: true as const, data: { width } }));
      }

      if (message.type === 'PAUSE_CURRENT_SITE') {
        return setSitePaused(message.payload.pageUrl, true).then((hostname) => ({
          ok: true as const,
          data: { hostname },
        }));
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

      if (message.type === 'TEST_API_CONNECTION') {
        return testConnection(
          message.payload.apiKey,
          message.payload.apiBaseUrl,
          message.payload.model,
          message.payload.profileId,
        );
      }

      if (message.type === 'LIST_API_MODELS') {
        return listModels(
          message.payload.apiKey,
          message.payload.apiBaseUrl,
          message.payload.profileId,
        );
      }

      if (message.type === 'DIAGNOSE_API') {
        return diagnoseApi(
          message.payload.apiKey,
          message.payload.apiBaseUrl,
          message.payload.model,
          message.payload.profileId,
        );
      }

      if (message.type === 'GET_TRANSLATION_HISTORY') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(
            errorResponse(
              new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
            ),
          );
        }
        return getTranslationHistory(tabId).then((history) => ({
          ok: true as const,
          data: { history },
        }));
      }

      if (message.type === 'CLEAR_TRANSLATION_HISTORY') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(
            errorResponse(
              new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
            ),
          );
        }
        return clearTranslationHistory(tabId).then(() => ({
          ok: true as const,
          data: { history: [] },
        }));
      }

      if (message.type === 'DELETE_TRANSLATION_HISTORY') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.')));
        }
        return deleteTranslationHistoryEntry(tabId, message.payload.historyId).then((history) => ({
          ok: true as const,
          data: { history },
        }));
      }

      if (message.type === 'PIN_TRANSLATION_HISTORY') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.')));
        }
        return setTranslationHistoryPinned(
          tabId,
          message.payload.historyId,
          message.payload.pinned,
        ).then((history) => ({ ok: true as const, data: { history } }));
      }

      if (message.type === 'GET_TRANSLATION_FAVORITES') {
        return getTranslationFavorites(message.payload?.query).then((favorites) => ({
          ok: true as const,
          data: { favorites },
        }));
      }

      if (message.type === 'ADD_TRANSLATION_FAVORITE') {
        return addTranslationFavorite(message.payload.result).then((favorites) => ({
          ok: true as const,
          data: { favorites },
        }));
      }

      if (message.type === 'DELETE_TRANSLATION_FAVORITE') {
        return deleteTranslationFavorite(message.payload.favoriteId).then((favorites) => ({
          ok: true as const,
          data: { favorites },
        }));
      }

      return undefined;
    },
  );
});
