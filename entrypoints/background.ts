import { protectLatex, restoreLatex, restoreLatexPreview } from '../core/latex/protector';
import {
  getLocalDiagnosticEvents,
  recordLocalDiagnosticError,
} from '../core/diagnostics/event-log';
import { toTranslationError, TranslationError } from '../core/messaging/errors';
import {
  isRuntimeMessage,
  type ConnectionTestResponse,
  type VisionCapabilityTestResponse,
  type ApiDiagnosticResponse,
  type ModelListResponse,
  type PdfSidePanelSession,
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
import { translateWithLatexRetry } from '../core/translation/latex-safe-translation';
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
  edgePdfSourceUrl,
  isEdgeNativePdfContext,
  parsePdfSourceUrl,
  pdfDocumentIdentity,
  pdfFilename,
  pdfInitialPage,
  shouldOpenEdgePdfSidePanelImmediately,
} from '../core/pdf/source';
import {
  addTranslationFavorite,
  deleteTranslationFavorite,
  getTranslationFavorites,
} from '../core/translation/favorites-repository';
import type {
  TranslateRequest,
  TranslateImageRegionRequest,
  TranslateResult,
  TranslationSegment,
} from '../core/translation/types';

const CONTEXT_MENU_ID = 'translate-selection-with-pi-translator';
const LEGACY_CONTEXT_MENU_ID = 'translate-selection-with-deepseek';
const GENERAL_CONTENT_SCRIPT_ID = 'pi-translator-general-pages';
const GENERAL_CONTENT_SCRIPT_FILE = '/content-scripts/general.js';
const PDF_SIDE_PANEL_PATH = 'sidepanel.html';
const translator = new OpenAiCompatibleTranslator();
const activeRequests = new Map<number, { requestId: string; controller: AbortController }>();
const pdfSidePanelSessions = new Map<number, PdfSidePanelSession>();

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

type TranslationProgressPayload = Extract<
  RuntimeMessage,
  { type: 'TRANSLATION_PROGRESS' }
>['payload'];
type TranslationProgressTarget = 'tab' | 'runtime';

function pdfSourceLabel(sourceUrl: string | undefined): string {
  if (!sourceUrl) return 'Edge PDF';
  const remoteName = pdfFilename(sourceUrl, '');
  if (remoteName) return remoteName;
  try {
    const url = new URL(sourceUrl);
    const name = url.pathname.split('/').filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : url.hostname || '本地 PDF';
  } catch {
    return 'Edge PDF';
  }
}

function pdfPageFromContext(
  urls: { tabUrl?: string; pageUrl?: string; frameUrl?: string },
  sourceUrl?: string,
): number | undefined {
  for (const value of [urls.pageUrl, urls.frameUrl, urls.tabUrl, sourceUrl]) {
    const page = pdfInitialPage(value);
    if (page) return page;
  }
  return undefined;
}

function publishPdfSidePanelSession(session: PdfSidePanelSession): void {
  pdfSidePanelSessions.set(session.tabId, session);
  void browser.runtime.sendMessage({
    type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
    payload: session,
  } satisfies RuntimeMessage).catch(() => undefined);
}

function publishTranslationProgress(
  tabId: number,
  payload: TranslationProgressPayload,
  target: TranslationProgressTarget = 'tab',
): void {
  const message = {
    type: 'TRANSLATION_PROGRESS',
    payload,
  } satisfies RuntimeMessage;
  if (target === 'runtime') {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  } else {
    void browser.tabs.sendMessage(tabId, message).catch(() => undefined);
  }

  const session = pdfSidePanelSessions.get(tabId);
  if (session?.requestId !== payload.requestId) return;
  publishPdfSidePanelSession({
    ...session,
    ...(payload.partialText ? { partialText: payload.partialText } : {}),
    completedChunks: payload.completedChunks,
    totalChunks: payload.totalChunks,
  });
}

function progressTargetForSender(senderUrl: string | undefined): TranslationProgressTarget {
  const pdfUrl = browser.runtime.getURL('/pdf.html');
  return senderUrl?.startsWith(pdfUrl) ? 'runtime' : 'tab';
}

async function beginPdfSidePanelTranslation(tabId: number): Promise<void> {
  const session = pdfSidePanelSessions.get(tabId);
  if (!session) return;
  const settings = await getSettings();
  const response = await translate({
    requestId: session.requestId,
    text: session.sourceText,
    pageUrl: session.pageUrl,
    sourceLabel: session.sourceLabel,
    targetLanguage: settings.targetLanguage,
    sourceLanguage: settings.sourceLanguage,
    style: settings.style,
    contentMode: settings.contentMode,
  }, tabId);
  const current = pdfSidePanelSessions.get(tabId);
  if (current?.requestId !== session.requestId) return;
  if (response.ok) {
    publishPdfSidePanelSession({
      ...current,
      status: 'complete',
      result: response.data.result,
      partialText: response.data.result.translatedText,
      completedChunks: response.data.result.chunkCount ?? current.totalChunks ?? 1,
      totalChunks: response.data.result.chunkCount ?? current.totalChunks ?? 1,
    });
    return;
  }
  publishPdfSidePanelSession({
    ...current,
    status: 'error',
    error: response.error,
  });
}

function startPdfSidePanelTranslation(
  tabId: number,
  sourceText: string,
  sourceUrl: string | undefined,
  pageNumber?: number,
): void {
  const session: PdfSidePanelSession = {
    tabId,
    requestId: crypto.randomUUID(),
    sourceText: sourceText.trim(),
    pageUrl: sourceUrl ?? '',
    ...(pageNumber ? { pageNumber } : {}),
    sourceLabel: pdfSourceLabel(sourceUrl),
    status: 'translating',
    startedAt: Date.now(),
    completedChunks: 0,
    totalChunks: 1,
  };
  publishPdfSidePanelSession(session);
  void beginPdfSidePanelTranslation(tabId);
}

function showPdfSidePanelSelectionError(
  tabId: number,
  sourceUrl: string | undefined,
  pageNumber?: number,
): void {
  publishPdfSidePanelSession({
    tabId,
    requestId: crypto.randomUUID(),
    sourceText: '',
    pageUrl: sourceUrl ?? '',
    ...(pageNumber ? { pageNumber } : {}),
    sourceLabel: pdfSourceLabel(sourceUrl),
    status: 'error',
    startedAt: Date.now(),
    error: {
      code: 'EMPTY_SELECTION',
      message: 'Edge 没有把 PDF 选区文字传递给扩展，请重新选择文字后再试，或使用 Pi PDF 阅读器。',
      retryable: false,
    },
  });
}

function getNativeChromeApi(): {
  sidePanel?: typeof browser.sidePanel;
  tabs?: typeof browser.tabs;
} | undefined {
  return (globalThis as typeof globalThis & {
    chrome?: {
      sidePanel?: typeof browser.sidePanel;
      tabs?: typeof browser.tabs;
    };
  }).chrome;
}

function getSidePanelApi(): typeof browser.sidePanel | undefined {
  const nativeChrome = getNativeChromeApi();
  return nativeChrome?.sidePanel ?? browser.sidePanel;
}

async function setPdfSidePanelEnabled(tabId: number, enabled: boolean): Promise<void> {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) return;
  await sidePanelApi.setOptions({
    tabId,
    enabled,
    ...(enabled ? { path: PDF_SIDE_PANEL_PATH } : {}),
  });
}

async function isolatePdfSidePanelToTab(tabId: number): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.flatMap((tab) => {
    if (tab.id === undefined) return [];
    const enabled = tab.id === tabId || pdfSidePanelSessions.has(tab.id);
    return [setPdfSidePanelEnabled(tab.id, enabled).catch(() => undefined)];
  }));
}

async function initializePdfSidePanelIsolation(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.flatMap((tab) =>
    tab.id === undefined
      ? []
      : [setPdfSidePanelEnabled(tab.id, false).catch(() => undefined)],
  ));
}

function openPdfTranslationSidePanel(
  tab: { id: number; windowId: number },
  sourceText: string | undefined,
  sourceUrl: string | undefined,
  pageNumber?: number,
): void {
  if (sourceText?.trim()) {
    startPdfSidePanelTranslation(tab.id, sourceText, sourceUrl, pageNumber);
  } else {
    showPdfSidePanelSelectionError(tab.id, sourceUrl, pageNumber);
  }

  // Prefer the native Chrome namespace here. Edge exposes both namespaces,
  // but sidePanel is defined and documented on chrome.sidePanel.
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) {
    void browser.action.setBadgeText({ tabId: tab.id, text: '!' });
    void browser.action.setTitle({
      tabId: tab.id,
      title: '当前 Edge 版本未提供侧边栏接口',
    });
    return;
  }
  void isolatePdfSidePanelToTab(tab.id);
  // Issue setOptions and open back-to-back. Awaiting between them can consume
  // Chromium's short-lived context-menu user gesture.
  void sidePanelApi.setOptions({
    tabId: tab.id,
    path: PDF_SIDE_PANEL_PATH,
    enabled: true,
  }).catch((error: unknown) => {
    void recordLocalDiagnosticError('open-pdf-side-panel', error);
  });
  void sidePanelApi.open({ tabId: tab.id }).then(
    () => {
      void browser.action.setBadgeText({ tabId: tab.id, text: '' });
      void browser.action.setTitle({ tabId: tab.id, title: 'Pi Translator' });
    },
    (error: unknown) => {
      void recordLocalDiagnosticError('open-pdf-side-panel', error);
      void browser.action.setBadgeBackgroundColor({ color: '#b4233b' });
      void browser.action.setBadgeText({ tabId: tab.id, text: '!' });
      void browser.action.setTitle({
        tabId: tab.id,
        title: 'PDF 侧边栏打开失败，请在扩展管理页重新加载 Pi Translator',
      });
    },
  );
}

async function closePdfSidePanelAfterOpeningViewer(
  tab: { id?: number | undefined; windowId: number },
): Promise<void> {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) return;

  // Pi PDF already has its own compact translation card, so the extension
  // side panel is deliberately unavailable on this one tab.
  if (tab.id !== undefined) {
    await sidePanelApi.setOptions({ tabId: tab.id, enabled: false }).catch(
      () => undefined,
    );
  }

  if (typeof sidePanelApi.close === 'function') {
    try {
      await sidePanelApi.close({ windowId: tab.windowId });
      return;
    } catch {
      // Older Edge builds can expose the method before fully supporting it.
      // The tab-specific disable below keeps the Pi PDF page uncluttered.
    }
  }
}

function retryPdfSidePanelTranslation(tabId: number): Promise<RuntimeResponse<{ started: true }>> {
  const session = pdfSidePanelSessions.get(tabId);
  if (!session) {
    return Promise.resolve(errorResponse(
      new TranslationError('EMPTY_SELECTION', '请先在 PDF 中选择文字并使用右键翻译。'),
    ));
  }
  const nextSession: PdfSidePanelSession = {
    ...session,
    requestId: crypto.randomUUID(),
    status: 'translating',
    startedAt: Date.now(),
    completedChunks: 0,
    totalChunks: 1,
  };
  delete nextSession.partialText;
  delete nextSession.result;
  delete nextSession.error;
  publishPdfSidePanelSession(nextSession);
  void beginPdfSidePanelTranslation(tabId);
  return Promise.resolve({ ok: true, data: { started: true } });
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
  progressTarget: TranslationProgressTarget = 'tab',
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
      const callbacks = settings.enableStreaming
        ? {
            onPartialText: (partialText: string) => {
              const visiblePartial = protectedLatex
                ? restoreLatexPreview(partialText, protectedLatex)
                : partialText;
              if (!visiblePartial || visiblePartial === lastPartial) return;
              const now = performance.now();
              if (now - lastProgressAt < 80) return;
              lastPartial = visiblePartial;
              lastProgressAt = now;
              publishTranslationProgress(tabId, {
                requestId: request.requestId,
                partialText: `${prefix}${visiblePartial}`,
                completedChunks: chunkIndex,
                totalChunks: chunks.length,
              }, progressTarget);
            },
          }
        : undefined;
      const preparedInput = {
        text: protectedLatex?.protectedText ?? chunk,
        placeholderTokens: [
          ...(protectedLatex?.fragments.map((fragment) => fragment.token) ?? []),
          ...preparedSegments.flatMap(
            (segment) => segment.protected?.fragments.map((fragment) => fragment.token) ?? [],
          ),
        ],
        segments: preparedSegments.map((segment) => ({
          id: segment.source.id,
          text: segment.protected?.protectedText ?? segment.source.text,
        })),
        ...(request.contextText ? { contextText: request.contextText } : {}),
      };
      const { providerResult, restored } = await translateWithLatexRetry(
        translator,
        preparedInput,
        {
          model: settings.model,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          style: request.style,
          glossary: settings.academicGlossary,
        },
        { apiKey, apiBaseUrl: settings.apiBaseUrl },
        controller.signal,
        protectedLatex,
        callbacks,
      );
      const current = activeRequests.get(tabId);
      if (current?.requestId !== request.requestId) {
        throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
      }

      detectedLanguage ??= providerResult.detectedLanguage;
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
      publishTranslationProgress(tabId, {
        requestId: request.requestId,
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
      }, progressTarget);
    }
    let sourceHost = request.sourceLabel?.trim().slice(0, 120) || undefined;
    if (!sourceHost) {
      try {
        sourceHost = new URL(request.pageUrl).hostname;
      } catch {
        sourceHost = undefined;
      }
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

function validateImageRegionRequest(request: TranslateImageRegionRequest): void {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
    request.imageDataUrl,
  );
  if (!match) {
    throw new TranslationError(
      'IMAGE_REGION_INVALID',
      'Only Base64 PNG, JPEG, or WebP image regions are supported.',
    );
  }
  const encoded = match[2] ?? '';
  const estimatedBytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > 3 * 1024 * 1024) {
    throw new TranslationError('IMAGE_REGION_INVALID', 'The selected image exceeds the 3 MB limit.');
  }
  if (
    !Number.isFinite(request.imageWidth) ||
    !Number.isFinite(request.imageHeight) ||
    request.imageWidth < 11 ||
    request.imageHeight < 11 ||
    request.imageWidth > 8192 ||
    request.imageHeight > 8192 ||
    Math.max(
      request.imageWidth / request.imageHeight,
      request.imageHeight / request.imageWidth,
    ) > 200
  ) {
    throw new TranslationError('IMAGE_REGION_INVALID', 'The selected image dimensions are invalid.');
  }
}

async function translateImageRegion(
  request: TranslateImageRegionRequest,
  tabId: number,
  progressTarget: TranslationProgressTarget,
): Promise<TranslateRuntimeResponse> {
  try {
    validateImageRegionRequest(request);
    const previous = activeRequests.get(tabId);
    if (previous?.requestId !== request.requestId) previous?.controller.abort();
    const settings = await getSettings();
    const profile = settings.apiProfiles.find(
      (candidate) => candidate.id === settings.visionApiProfileId,
    );
    if (!profile || !settings.visionModel.trim()) {
      throw new TranslationError(
        'VISION_NOT_CONFIGURED',
        'Select a vision API profile and model in extension settings.',
      );
    }
    const apiKey = await getApiKey(profile.id);
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', `Configure an API Key for ${profile.name} first.`);
    }
    const apiPermission = apiOriginPattern(profile.apiBaseUrl);
    if (!(await browser.permissions.contains({ origins: [apiPermission] }))) {
      throw new TranslationError(
        'API_PERMISSION_REQUIRED',
        `Permission for ${apiPermission} is required.`,
      );
    }
    const controller = new AbortController();
    activeRequests.set(tabId, { requestId: request.requestId, controller });
    const startedAt = performance.now();
    let lastPartial = '';
    let lastProgressAt = 0;
    const providerResult = await translator.translateImageRegion(
      {
        imageDataUrl: request.imageDataUrl,
        imageWidth: request.imageWidth,
        imageHeight: request.imageHeight,
      },
      {
        model: settings.visionModel,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        style: request.style,
      },
      { apiKey, apiBaseUrl: profile.apiBaseUrl },
      controller.signal,
      settings.enableStreaming
        ? {
            onPartialText: (partialText) => {
              if (!partialText || partialText === lastPartial) return;
              const now = performance.now();
              if (now - lastProgressAt < 80) return;
              lastPartial = partialText;
              lastProgressAt = now;
              publishTranslationProgress(tabId, {
                requestId: request.requestId,
                partialText,
                completedChunks: 0,
                totalChunks: 1,
              }, progressTarget);
            },
          }
        : undefined,
    );
    if (activeRequests.get(tabId)?.requestId !== request.requestId) {
      throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
    }
    let sourceHost = request.sourceLabel?.trim().slice(0, 120) || undefined;
    if (!sourceHost) {
      try {
        sourceHost = new URL(request.pageUrl).hostname;
      } catch {
        sourceHost = undefined;
      }
    }
    const result: TranslateResult = {
      requestId: request.requestId,
      originalText: providerResult.recognizedText,
      translatedText: providerResult.translatedText,
      warnings: [],
      ...(providerResult.uncertainSpans.length
        ? { uncertainSpans: providerResult.uncertainSpans }
        : {}),
      ...(sourceHost ? { sourceHost } : {}),
      sourceKind: 'image-region',
      targetLanguage: request.targetLanguage,
      style: request.style,
      completedAt: Date.now(),
      cached: false,
      latencyMs: Math.round(performance.now() - startedAt),
      contextUsed: false,
      chunkCount: 1,
    };
    publishTranslationProgress(tabId, {
      requestId: request.requestId,
      completedChunks: 1,
      totalChunks: 1,
    }, progressTarget);
    const history = settings.rememberRecentTranslations
      ? await addTranslationHistory(tabId, result, settings.historyLimit)
      : [];
    return { ok: true, data: { result, history } };
  } catch (error) {
    await recordLocalDiagnosticError('translate-image-region', error);
    return errorResponse(error);
  } finally {
    const current = activeRequests.get(tabId);
    if (current?.requestId === request.requestId) activeRequests.delete(tabId);
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

async function testVisionCapability(
  apiKeyOverride: string | undefined,
  apiBaseUrl: string,
  model: string,
  profileId?: string,
): Promise<VisionCapabilityTestResponse> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey(profileId));
  if (!apiKey) {
    return errorResponse(
      new TranslationError('NO_API_KEY', 'Configure an API Key first.'),
    );
  }
  const originPattern = apiOriginPattern(apiBaseUrl);
  if (!(await browser.permissions.contains({ origins: [originPattern] }))) {
    return errorResponse(
      new TranslationError(
        'API_PERMISSION_REQUIRED',
        `Permission for ${originPattern} is required.`,
      ),
    );
  }

  const controller = new AbortController();
  try {
    const startedAt = performance.now();
    await translator.testVisionCapability(
      { model },
      { apiKey, apiBaseUrl },
      controller.signal,
    );
    return {
      ok: true,
      data: {
        supported: true,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    };
  } catch (error) {
    await recordLocalDiagnosticError('test-vision-capability', error);
    return errorResponse(error);
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

async function sendContextMenuTranslationToWebPage(
  tab: { id?: number | undefined; url?: string | undefined },
  snapshot: ReturnType<typeof createContextMenuSnapshot>,
): Promise<void> {
  if (tab.id === undefined || !tab.url) return;
  if (isOverleafProjectUrl(tab.url)) {
    await browser.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_TRANSLATE',
      payload: snapshot,
    } satisfies RuntimeMessage);
    return;
  }
  if (!isInjectableWebUrl(tab.url)) return;
  await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: [GENERAL_CONTENT_SCRIPT_FILE],
  });
  await browser.tabs.sendMessage(tab.id, {
    type: 'CONTEXT_MENU_TRANSLATE',
    payload: snapshot,
  } satisfies RuntimeMessage);
}

export default defineBackground(() => {
  void restrictSensitiveStorageAccess();
  void synchronizeContextMenu();
  void initializePdfSidePanelIsolation();
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
    void initializePdfSidePanelIsolation();
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
    if (info.menuItemId !== CONTEXT_MENU_ID) return;

    const eventContextUrls = {
      ...(tab?.url ? { tabUrl: tab.url } : {}),
      ...(info.pageUrl ? { pageUrl: info.pageUrl } : {}),
      ...(info.frameUrl ? { frameUrl: info.frameUrl } : {}),
    };
    if (shouldOpenEdgePdfSidePanelImmediately(
      eventContextUrls,
      tab?.id,
      tab?.windowId,
    )) {
      const nativeChrome = getNativeChromeApi();
      if (nativeChrome?.tabs && nativeChrome.sidePanel) {
        nativeChrome.tabs.query(
          { active: true, lastFocusedWindow: true },
          ([resolvedTab]) => {
            if (
              resolvedTab?.id === undefined ||
              resolvedTab.id < 0 ||
              resolvedTab.windowId < 0
            ) {
              return;
            }
            const contextUrls = {
              ...(resolvedTab.url ? { tabUrl: resolvedTab.url } : {}),
              ...(info.pageUrl ? { pageUrl: info.pageUrl } : {}),
              ...(info.frameUrl ? { frameUrl: info.frameUrl } : {}),
            };
            const sourceUrl = edgePdfSourceUrl(contextUrls);
            openPdfTranslationSidePanel(
              { id: resolvedTab.id, windowId: resolvedTab.windowId },
              info.selectionText,
              sourceUrl,
              pdfPageFromContext(contextUrls, sourceUrl),
            );
          },
        );
        return;
      }
    }

    void (async () => {
      // Edge reports tabId/windowId as -1 when a context-menu click originates
      // from its built-in PDF viewer. Resolve the real browser tab before
      // opening the side panel or sending a content-script message.
      let resolvedTab = tab;
      if (
        resolvedTab?.id === undefined ||
        resolvedTab.id < 0 ||
        resolvedTab.windowId < 0
      ) {
        [resolvedTab] = await browser.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
      }
      if (
        resolvedTab?.id === undefined ||
        resolvedTab.id < 0 ||
        resolvedTab.windowId < 0
      ) {
        throw new Error('Unable to resolve the active Edge tab for this selection.');
      }

      const contextUrls = {
        ...(resolvedTab.url ? { tabUrl: resolvedTab.url } : {}),
        ...(info.pageUrl ? { pageUrl: info.pageUrl } : {}),
        ...(info.frameUrl ? { frameUrl: info.frameUrl } : {}),
      };
      const activeTab = { id: resolvedTab.id, windowId: resolvedTab.windowId };
      const sourceUrl = edgePdfSourceUrl(contextUrls);
      const pageNumber = pdfPageFromContext(contextUrls, sourceUrl);
      if (
        isEdgeNativePdfContext(contextUrls) ||
        !resolvedTab.url ||
        !isInjectableWebUrl(resolvedTab.url)
      ) {
        openPdfTranslationSidePanel(activeTab, info.selectionText, sourceUrl, pageNumber);
        return;
      }
      if (!info.selectionText) {
        openPdfTranslationSidePanel(activeTab, undefined, sourceUrl, pageNumber);
        return;
      }
      const snapshot = createContextMenuSnapshot(info.selectionText, resolvedTab.url);
      await sendContextMenuTranslationToWebPage(resolvedTab, snapshot).catch((error: unknown) => {
        // Some PDF endpoints keep their original HTTPS URL instead of exposing
        // the internal viewer URL. Failed injection is therefore treated as a
        // protected-document fallback and rendered in the native side panel.
        console.warn('Falling back to the side panel for a protected selection.', error);
        openPdfTranslationSidePanel(
          activeTab,
          info.selectionText,
          resolvedTab.url,
          pageNumber,
        );
      });
    })().catch((error: unknown) => {
      void recordLocalDiagnosticError('translate-context-menu-selection', error);
    });
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
    pdfSidePanelSessions.delete(tabId);
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id === undefined) return;
    void setPdfSidePanelEnabled(tab.id, false).catch(() => undefined);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    const session = pdfSidePanelSessions.get(tabId);
    if (session) {
      const previousSource = pdfDocumentIdentity(session.pageUrl);
      const nextSourceUrl = edgePdfSourceUrl({ tabUrl: changeInfo.url }) ?? changeInfo.url;
      const nextSource = pdfDocumentIdentity(nextSourceUrl);
      if (
        previousSource &&
        nextSource &&
        previousSource === nextSource
      ) {
        const pageNumber = pdfInitialPage(changeInfo.url) ?? pdfInitialPage(nextSourceUrl);
        if (pageNumber && pageNumber !== session.pageNumber) {
          publishPdfSidePanelSession({ ...session, pageNumber });
        }
        return;
      }
      pdfSidePanelSessions.delete(tabId);
    }
    void setPdfSidePanelEnabled(tabId, false).catch(() => undefined);
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

      if (message.type === 'OPEN_OPTIONS_PAGE') {
        return browser.tabs
          .create({
            url: browser.runtime.getURL('/options.html'),
            active: true,
          })
          .then(() => ({ ok: true as const, data: { opened: true } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'OPEN_PDF_VIEWER') {
        const source = parsePdfSourceUrl(message.payload?.url)?.href;
        const requestedPage = message.payload?.page;
        const page = Number.isSafeInteger(requestedPage) && (requestedPage ?? 0) > 0
          ? requestedPage
          : pdfInitialPage(source);
        const viewerUrl = new URL(browser.runtime.getURL('/pdf.html'));
        if (source) viewerUrl.searchParams.set('url', source);
        if (page) viewerUrl.searchParams.set('page', String(page));
        return browser.tabs
          .create({ url: viewerUrl.href, active: true })
          .then(async (tab) => {
            await closePdfSidePanelAfterOpeningViewer(tab);
            return { ok: true as const, data: { opened: true } };
          })
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'GET_PDF_SIDE_PANEL_SESSION') {
        return Promise.resolve({
          ok: true as const,
          data: {
            session: pdfSidePanelSessions.get(message.payload.tabId) ?? null,
          },
        });
      }

      if (message.type === 'RETRY_PDF_SIDE_PANEL_TRANSLATION') {
        return retryPdfSidePanelTranslation(message.payload.tabId);
      }

      if (message.type === 'PDF_SIDE_PANEL_SESSION_UPDATED') {
        return undefined;
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
        return translate(message.payload, tabId, progressTargetForSender(sender.url));
      }

      if (message.type === 'TRANSLATE_IMAGE_REGION') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(
            errorResponse(
              new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
            ),
          );
        }
        return translateImageRegion(
          message.payload,
          tabId,
          progressTargetForSender(sender.url),
        );
      }

      if (message.type === 'TEST_API_CONNECTION') {
        return testConnection(
          message.payload.apiKey,
          message.payload.apiBaseUrl,
          message.payload.model,
          message.payload.profileId,
        );
      }

      if (message.type === 'TEST_VISION_CAPABILITY') {
        return testVisionCapability(
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
