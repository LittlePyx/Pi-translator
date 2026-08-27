import { protectLatex, restoreLatex, restoreLatexPreview } from '../core/latex/protector';
import {
  getLocalDiagnosticEvents,
  getLocalPerformanceSamples,
  recordLocalDiagnosticError,
  recordLocalPerformanceSample,
  type DiagnosticOperation,
  type PerformancePhase,
} from '../core/diagnostics/event-log';
import { buildLocalDiagnosticReport } from '../core/diagnostics/local-report';
import { toTranslationError, TranslationError } from '../core/messaging/errors';
import {
  isRuntimeMessage,
  type ConnectionTestResponse,
  type VisionCapabilityTestResponse,
  type ApiDiagnosticResponse,
  type BilingualPageExportResponse,
  type BilingualPageStateResponse,
  type ModelListResponse,
  type PdfSidePanelSession,
  type PublicSettings,
  type PublicSettingsResponse,
  type RecognizePdfPageResponse,
  type RuntimeMessage,
  type RuntimeResponse,
  type TranslationBatchRuntimeResponse,
  type TranslateRuntimeResponse,
} from '../core/messaging/messages';
import {
  beginSettingsRecoveryDelivery,
  claimSettingsRecoveryTicket,
  clearSettingsRecoveryTicketsForTab,
  createSettingsRecoveryTicket,
  discardSettingsRecoveryTicket,
  finishSettingsRecoveryDelivery,
  type SettingsRecoveryTicket,
} from '../core/messaging/settings-recovery';
import { createContextMenuSnapshot } from '../core/selection/generic-selection';
import { visibleTabCaptureFailure } from '../core/selection/visible-tab-capture';
import { MAX_SELECTION_LENGTH } from '../core/selection/types';
import { createSerialTaskRunner } from '../core/runtime/serial-task';
import {
  getApiKey,
  getSettings,
  mutateSettings,
  restrictSensitiveStorageAccess,
} from '../core/settings/repository';
import {
  ConfigurationRevisionBarrier,
  ConfigurationRevisionMismatchError,
  configurationRevisionFromStorageChange,
} from '../core/settings/configuration-revision';
import { translationBehaviorFingerprint } from '../core/settings/translation-configuration';
import { apiOriginPattern } from '../core/settings/api-access';
import {
  getAutoInjectionPatterns,
  isInjectableWebUrl,
  isOverleafProjectUrl,
  VISIBLE_TAB_CAPTURE_PERMISSION,
} from '../core/settings/site-access';
import { getPausedSiteHosts, setSitePaused, siteHostFromUrl } from '../core/settings/site-pause';
import {
  isContinuousTranslationPaused,
  setContinuousTranslationPaused,
} from '../core/settings/continuous-translation-pause';
import {
  dismissSidebarObstructionHint,
  isSidebarObstructionHintDismissed,
} from '../core/settings/sidebar-obstruction-hint';
import {
  completeFeatureDiscovery,
  featureDiscoveryFeatureForTranslation,
  type FeatureDiscoveryFeature,
} from '../core/settings/feature-discovery';
import { shouldProtectLatex } from '../core/translation/content-mode';
import { translateWithLatexRetry } from '../core/translation/latex-safe-translation';
import {
  CONNECTION_SAMPLE_SOURCE,
  OpenAiCompatibleTranslator,
} from '../core/translation/openai-compatible-translator';
import {
  addTranslationHistory,
  clearTranslationHistory,
} from '../core/translation/history-repository';
import {
  cacheTranslation,
  clearTranslationCache,
  getCachedTranslation,
  translationCacheKey,
} from '../core/translation/cache-repository';
import {
  cacheImageRegionTranslation,
  clearImageRegionTranslationCache,
  getCachedImageRegionTranslation,
  imageRegionCacheKey,
} from '../core/translation/image-region-cache-repository';
import {
  clearTranslationCheckpoint,
  getTranslationCheckpoint,
  saveTranslationCheckpoint,
  type TranslationCheckpointChunk,
} from '../core/translation/checkpoint-repository';
import { splitTranslationSegments } from '../core/translation/sentence-segmentation';
import { splitLongTranslationText } from '../core/translation/text-chunker';
import { validTranslationBatchItems } from '../core/translation/document-batch';
import type { SupportedTargetLanguage } from '../core/language/supported-target-languages';
import type { BilingualPageAction } from '../core/translation/bilingual-page';
import {
  bilingualPageSessionBehaviorKey,
  clearBilingualPageSession,
  clearRetainedBilingualPageSession,
  getBilingualPageSession,
  getRetainedBilingualPageSession,
  saveBilingualPageSession,
  saveRetainedBilingualPageSession,
} from '../core/translation/bilingual-page-session';
import { isLexicalLookupCandidate } from '../core/translation/lexical-lookup';
import { findGlossaryTermEvidence } from '../core/translation/applied-glossary';
import {
  MAX_GLOSSARY_ENTRIES,
  normalizeGlossaryTermKey,
  rollbackGlossaryEntry,
  upsertGlossaryEntry,
} from '../core/translation/glossary';
import {
  ManualCorrectionError,
  validateManualCorrectionText,
  validateManualTermCandidate,
} from '../core/translation/manual-correction';
import {
  AlignedSegmentCorrectionError,
  applyAlignedSegmentCorrection,
} from '../core/translation/aligned-segment-correction';
import { createPerTabAsyncLane } from '../core/runtime/per-tab-async-lane';
import { startCommittedTask } from '../core/runtime/committed-task';
import {
  createPerTabLifecycle,
  type TabLifecycleToken,
} from '../core/runtime/per-tab-lifecycle';
import {
  clearTranslationHead,
  readTranslationHead,
  writeTranslationHead,
} from '../core/translation/head-repository';
import {
  edgePdfSourceUrl,
  isEdgePdfSidePanelTab,
  isEdgeNativePdfContext,
  isExtensionPdfReaderUrl,
  isSamePdfDocumentLocationChange,
  parsePdfSourceUrl,
  pdfDocumentIdentity,
  pdfFilename,
  pdfInitialPage,
  pdfPermissionPattern,
  pdfSidePanelOpenTarget,
  resolvePdfContextTab,
  shouldOpenEdgePdfSidePanelImmediately,
} from '../core/pdf/source';
import { normalizePdfSelectionText } from '../core/pdf/text-normalizer';
import {
  resolveNativePdfTranslationProvider,
  type NativePdfTranslationProvider,
} from '../core/pdf/native-translation-profile';
import { recognizeQwenPdfPage } from '../core/pdf/qwen-coordinate-ocr';
import type { RecognizePdfPageRequest } from '../core/pdf/ocr-text-layer';
import {
  documentIdentity,
  type DocumentIdentityInput,
} from '../core/document/document-identity';
import {
  buildDocumentReferenceContext,
  clearDocumentMemory,
  confirmDocumentTerm,
  type DocumentTermChangeReceipt,
  DocumentTermCapacityError,
  dismissDocumentTermCandidate,
  getDocumentMemory,
  mergeDocumentGlossaryWithScope,
  rememberDocumentCorrection,
  rememberDocumentTranslation,
  removeDocumentTerm,
  rollbackDocumentCorrectionChange,
  rollbackDocumentTermChange,
  resolveDocumentReview,
  restoreDocumentCorrectionIfCurrent,
  upsertDocumentTerm,
  upsertDocumentTermWithReceipt,
} from '../core/document/document-memory-repository';
import {
  isSamePdfSidePanelSession,
  reopenExistingPdfSidePanelFromUserGesture,
  removeStoredPdfSidePanelSession,
  restorePdfSidePanelSessions,
  storePdfSidePanelSession,
} from '../core/pdf/sidepanel-session';
import type {
  GlossaryEntry,
  LexicalLookup,
  ScopedGlossaryTerm,
  TranslateBatchRequest,
  TranslateRequest,
  TranslateImageRegionRequest,
  TranslateResult,
  TranslationCorrectionReceipt,
  TranslationCorrectionTermReceipt,
  TranslationHistoryEntry,
  TranslationMemoryScope,
  TranslationRevisionScope,
  TranslationSegment,
  TranslationTermScope,
} from '../core/translation/types';

const CONTEXT_MENU_ID = 'translate-selection-with-pi-translator';
const LEGACY_CONTEXT_MENU_ID = 'translate-selection-with-deepseek';
const GENERAL_CONTENT_SCRIPT_ID = 'pi-translator-general-pages';
const GENERAL_CONTENT_SCRIPT_FILE = '/content-scripts/general.js';
const PDF_SIDE_PANEL_PATH = 'sidepanel.html';
const PI_PDF_READER_URL = browser.runtime.getURL('/pdf.html');

function withGlossaryTermEvidence(
  result: TranslateResult,
  glossary: ScopedGlossaryTerm[],
): TranslateResult {
  const evidence = findGlossaryTermEvidence(
    result.originalText,
    result.translatedText,
    glossary,
  );
  const evidenced = { ...result };
  if (evidence.applied.length) evidenced.appliedGlossaryTerms = evidence.applied;
  else delete evidenced.appliedGlossaryTerms;
  if (evidence.needsReview.length) evidenced.glossaryTermsNeedingReview = evidence.needsReview;
  else delete evidenced.glossaryTermsNeedingReview;
  return evidenced;
}
const LEGACY_FAVORITES_KEY = 'translationFavorites';
const translator = new OpenAiCompatibleTranslator();
const activeRequests = new Map<number, { requestId: string; controller: AbortController }>();
const pendingTranslationRequests = new Map<number, string>();
const runTranslationCommit = createPerTabAsyncLane();
const tabLifecycles = createPerTabLifecycle();
const pdfSidePanelSessions = new Map<number, PdfSidePanelSession>();
const pdfSidePanelCorrectionClaims = new Map<number, string>();
const piPdfReaderTabIds = new Set<number>();
const activeTabIdsByWindow = new Map<number, number>();
const WEB_CAPTURE_PERMISSION_PROMPT_TTL_MS = 5 * 60_000;
const pendingWebCapturePermissionTabs = new Map<number, number>();
let lastActiveBrowserTab: { id: number; windowId: number } | undefined;

function markWebCapturePermissionPrompt(tabId: number): void {
  pendingWebCapturePermissionTabs.set(tabId, Date.now() + WEB_CAPTURE_PERMISSION_PROMPT_TTL_MS);
}

function hasWebCapturePermissionPrompt(tabId: number): boolean {
  const expiresAt = pendingWebCapturePermissionTabs.get(tabId);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  pendingWebCapturePermissionTabs.delete(tabId);
  return false;
}

async function withCompletedTranslationDiscovery(
  request: Pick<TranslateRequest | TranslateImageRegionRequest, 'pageUrl' | 'sourceLocation'>,
  kind: 'text' | 'image',
  task: Promise<TranslateRuntimeResponse>,
  forcedFeature?: FeatureDiscoveryFeature,
): Promise<TranslateRuntimeResponse> {
  const response = await task;
  if (!response.ok) return response;
  const feature = forcedFeature ?? featureDiscoveryFeatureForTranslation({
    pageUrl: request.pageUrl,
    kind,
    ...(request.sourceLocation ? { sourceLocation: request.sourceLocation } : {}),
    pdfReaderUrl: PI_PDF_READER_URL,
  });
  await completeFeatureDiscovery(feature).catch(() => undefined);
  return response;
}

function rememberActiveBrowserTab(tabId: number, windowId: number): void {
  if (tabId < 0 || windowId < 0) return;
  activeTabIdsByWindow.set(windowId, tabId);
  lastActiveBrowserTab = { id: tabId, windowId };
}

function immediatePdfSidePanelTab(
  tab?: { id?: number | undefined; windowId?: number | undefined },
): { id?: number | undefined; windowId?: number | undefined } | undefined {
  if (tab?.id !== undefined && tab.id >= 0) return tab;
  if (tab?.windowId !== undefined && tab.windowId >= 0) {
    const cachedTabId = activeTabIdsByWindow.get(tab.windowId);
    if (cachedTabId !== undefined) {
      return { id: cachedTabId, windowId: tab.windowId };
    }
    return tab;
  }
  return lastActiveBrowserTab ?? tab;
}

function beginActiveRequest(tabId: number, requestId: string): AbortController {
  activeRequests.get(tabId)?.controller.abort();
  const controller = new AbortController();
  activeRequests.set(tabId, { requestId, controller });
  return controller;
}

function assertActiveRequest(
  tabId: number,
  requestId: string,
  controller: AbortController,
): void {
  const current = activeRequests.get(tabId);
  if (
    controller.signal.aborted ||
    current?.requestId !== requestId ||
    current.controller !== controller
  ) {
    throw new TranslationError('REQUEST_ABORTED', 'The request was replaced.');
  }
}

function sourceHostForRequest(
  request: Pick<TranslateRequest | TranslateImageRegionRequest, 'pageUrl' | 'sourceLabel'>,
): string | undefined {
  const sourceLabel = request.sourceLabel?.trim().slice(0, 120);
  if (sourceLabel) return sourceLabel;
  try {
    return new URL(request.pageUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

function revisionDraftChunk(
  draft: string | undefined,
  chunkIndex: number,
  chunkCount: number,
): string | undefined {
  if (!draft) return undefined;
  if (chunkCount <= 1) return draft;
  const preferred = splitLongTranslationText(
    draft,
    Math.max(200, Math.ceil(draft.length / chunkCount)),
  );
  if (preferred.length === chunkCount) return preferred[chunkIndex];
  const start = Math.floor((draft.length * chunkIndex) / chunkCount);
  const end = Math.floor((draft.length * (chunkIndex + 1)) / chunkCount);
  return draft.slice(start, end).trim() || undefined;
}

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
    autoRenderLatex: settings.autoRenderLatex,
    historyLimit: settings.historyLimit,
    sidebarMode: settings.sidebarMode,
    sidebarSide: settings.sidebarSide,
    sidebarWidth: settings.sidebarWidth,
    contextMode: settings.contextMode,
    enableStreaming: settings.enableStreaming,
    protectSensitiveFields: settings.protectSensitiveFields,
    pdfKeyboardShortcutsEnabled: settings.pdfKeyboardShortcutsEnabled,
    pdfRegionShortcutKey: settings.pdfRegionShortcutKey,
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

function safePerformanceDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(30 * 60 * 1_000, Math.max(0, value));
}

type TranslationProgressPayload = Extract<
  RuntimeMessage,
  { type: 'TRANSLATION_PROGRESS' }
>['payload'];
type TranslationProgressTarget = 'tab' | 'runtime' | 'none';

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

function publishPdfSidePanelSession(
  session: PdfSidePanelSession,
  persist = true,
): void {
  pdfSidePanelSessions.set(session.tabId, session);
  if (persist) void storePdfSidePanelSession(session).catch(() => undefined);
  void browser.runtime.sendMessage({
    type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
    payload: session,
  } satisfies RuntimeMessage).catch(() => undefined);
}

async function publishPdfSidePanelSessionDurably(
  session: PdfSidePanelSession,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await storePdfSidePanelSession(session);
  try {
    assertCurrent?.();
  } catch (error) {
    // A navigation may occur while storage.session is being written. Remove
    // the just-written stale session before it can be restored by a later
    // service-worker instance.
    await removeStoredPdfSidePanelSession(session.tabId).catch(() => undefined);
    throw error;
  }
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
): Promise<void> {
  if (target === 'none') return Promise.resolve();
  const message = {
    type: 'TRANSLATION_PROGRESS',
    payload,
  } satisfies RuntimeMessage;
  const delivery = (target === 'runtime'
    ? browser.runtime.sendMessage(message)
    : browser.tabs.sendMessage(tabId, message))
    .then(() => undefined)
    .catch(() => undefined);

  const session = pdfSidePanelSessions.get(tabId);
  if (session?.requestId !== payload.requestId || session.status !== 'translating') {
    return delivery;
  }
  if (payload.result) {
    // The completed native-PDF session is committed durably together with the
    // translation head. Keeping this notification transport-only avoids a
    // fire-and-forget storage write racing that transaction.
    return delivery;
  }
  publishPdfSidePanelSession({
    ...session,
    ...(payload.partialText ? { partialText: payload.partialText } : {}),
    ...(payload.progressStage ? { progressStage: payload.progressStage } : {}),
    completedChunks: payload.completedChunks,
    totalChunks: payload.totalChunks,
  }, false);
  return delivery;
}

async function commitTranslationResultState(
  tabId: number,
  result: TranslateResult,
  assertCurrent: () => void,
): Promise<void> {
  assertCurrent();
  const nextHead = {
    tabId,
    currentResultRequestId: result.requestId,
    rootRequestId: translationResultRootRequestId(result),
  } as const;
  const session = pdfSidePanelSessions.get(tabId);
  const previousHead = await readTranslationHead(tabId);
  assertCurrent();
  await writeTranslationHead(nextHead);
  try {
    if (session?.requestId === result.requestId) {
      const completedSession: PdfSidePanelSession = {
        ...session,
        status: 'complete',
        result,
        partialText: result.translatedText,
        completedChunks: result.chunkCount ?? session.totalChunks ?? 1,
        totalChunks: result.chunkCount ?? session.totalChunks ?? 1,
      };
      delete completedSession.progressStage;
      await publishPdfSidePanelSessionDurably(completedSession, assertCurrent);
    } else {
      assertCurrent();
    }
  } catch (error) {
    // The result head and any native-PDF session are one commit. A storage
    // failure or lifecycle change conditionally puts the old head back; a
    // genuinely newer head always wins.
    try {
      if (previousHead) {
        await writeTranslationHead({
          tabId,
          currentResultRequestId: previousHead.currentResultRequestId,
          rootRequestId: previousHead.rootRequestId,
        }, {
          currentResultRequestId: nextHead.currentResultRequestId,
          rootRequestId: nextHead.rootRequestId,
        });
      } else {
        await clearTranslationHead(tabId, {
          currentResultRequestId: nextHead.currentResultRequestId,
          rootRequestId: nextHead.rootRequestId,
        });
      }
    } catch (rollbackError) {
      await recordLocalDiagnosticError('translate-finalization', rollbackError);
    }
    throw error;
  }
}

async function settleTranslationFinalization(
  scope: DiagnosticOperation,
  historyTask: Promise<TranslationHistoryEntry[]>,
  maintenanceTasks: Promise<unknown>[],
): Promise<TranslationHistoryEntry[]> {
  const [historyOutcome, ...maintenanceOutcomes] = await Promise.allSettled([
    historyTask,
    ...maintenanceTasks,
  ]);
  for (const outcome of [historyOutcome, ...maintenanceOutcomes]) {
    if (outcome.status === 'rejected') {
      void recordLocalDiagnosticError(scope, outcome.reason);
    }
  }
  return historyOutcome.status === 'fulfilled' ? historyOutcome.value : [];
}

async function settleTransientTranslationMaintenance(
  tasks: Promise<unknown>[],
): Promise<void> {
  const outcomes = await Promise.allSettled(tasks);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      void recordLocalDiagnosticError('translate-finalization', outcome.reason);
    }
  }
}

function progressTargetForSender(senderUrl: string | undefined): TranslationProgressTarget {
  const pdfUrl = browser.runtime.getURL('/pdf.html');
  return senderUrl?.startsWith(pdfUrl) ? 'runtime' : 'tab';
}

async function beginPdfSidePanelTranslation(
  tabId: number,
  expectedRequestId?: string,
): Promise<void> {
  const session = pdfSidePanelSessions.get(tabId);
  if (!session || (expectedRequestId && session.requestId !== expectedRequestId)) return;
  const lifecycleToken = tabLifecycles.capture(tabId);
  const isCurrent = (): boolean => tabLifecycles.isCurrent(lifecycleToken);
  try {
    if (!isCurrent()) return;
    const settings = await getSettings();
    if (session.sourceKind === 'web') {
      const profile = settings.apiProfiles.find(
        (candidate) => candidate.id === settings.activeApiProfileId,
      ) ?? settings.apiProfiles[0];
      const pending = pdfSidePanelSessions.get(tabId);
      if (
        !isCurrent() ||
        pending?.requestId !== session.requestId ||
        pending.status !== 'translating'
      ) return;
      if (profile) {
        publishPdfSidePanelSession({
          ...pending,
          providerContext: {
            role: 'text',
            profileName: profile.name,
            model: profile.model,
          },
        }, false);
      }
      const request: TranslateRequest = {
        requestId: session.requestId,
        text: session.sourceText,
        pageUrl: session.pageUrl,
        sourceLabel: session.sourceLabel,
        targetLanguage: session.targetLanguage ?? settings.targetLanguage,
        sourceLanguage: settings.sourceLanguage,
        style: settings.style,
        contentMode: settings.contentMode,
      };
      const response = await withCompletedTranslationDiscovery(
        request,
        'text',
        translate(request, tabId, 'runtime'),
      );
      const current = pdfSidePanelSessions.get(tabId);
      if (
        !response.ok &&
        isCurrent() &&
        current?.requestId === session.requestId &&
        current.status === 'translating'
      ) {
        publishPdfSidePanelSession({ ...current, status: 'error', error: response.error });
      }
      return;
    }
    const visionApiKeyConfigured = settings.visionApiProfileId
      ? Boolean(await getApiKey(settings.visionApiProfileId))
      : false;
    const provider = resolveNativePdfTranslationProvider(
      settings,
      session.sourceText,
      visionApiKeyConfigured,
    );
    if (!provider) {
      throw new TranslationError('NO_API_KEY', 'Configure a translation API profile first.');
    }
    const providerContext = {
      role: provider.role,
      profileName: provider.profileName,
      model: provider.model,
    } as const;
    const pending = pdfSidePanelSessions.get(tabId);
    if (
      !isCurrent() ||
      pending?.requestId !== session.requestId ||
      pending.status !== 'translating'
    ) return;
    publishPdfSidePanelSession({ ...pending, providerContext }, false);
    const response = await translate({
      requestId: session.requestId,
      text: normalizePdfSelectionText(session.sourceText),
      pageUrl: session.pageUrl,
      sourceLabel: session.sourceLabel,
      targetLanguage: session.targetLanguage ?? settings.targetLanguage,
      sourceLanguage: settings.sourceLanguage,
      style: settings.style,
      contentMode: settings.contentMode,
    }, tabId, 'tab', provider);
    if (response.ok) {
      await completeFeatureDiscovery('pdf-selection').catch(() => undefined);
    }
    const current = pdfSidePanelSessions.get(tabId);
    if (
      !isCurrent() ||
      current?.requestId !== session.requestId ||
      current.status !== 'translating'
    ) return;
    if (response.ok) {
      // translate() has already committed the completed session durably with
      // the result head. Do not issue a second best-effort persistence write.
      return;
    }
    publishPdfSidePanelSession({
      ...current,
      status: 'error',
      error: response.error,
    });
  } catch (error) {
    const current = pdfSidePanelSessions.get(tabId);
    if (
      !isCurrent() ||
      current?.requestId !== session.requestId ||
      current.status !== 'translating'
    ) return;
    const normalized = toTranslationError(error);
    publishPdfSidePanelSession({
      ...current,
      status: 'error',
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      },
    });
  }
}

function preparePdfSidePanelTranslation(
  tabId: number,
  sourceText: string,
  sourceUrl: string | undefined,
  targetLanguage: string,
  pageNumber?: number,
): PdfSidePanelSession {
  const session: PdfSidePanelSession = {
    tabId,
    sourceKind: 'pdf',
    targetLanguage,
    requestId: crypto.randomUUID(),
    sourceText: sourceText.trim(),
    pageUrl: sourceUrl ?? '',
    ...(pageNumber ? { pageNumber } : {}),
    sourceLabel: pdfSourceLabel(sourceUrl),
    status: 'translating',
    progressStage: 'provider',
    startedAt: Date.now(),
    completedChunks: 0,
    totalChunks: 1,
  };
  return session;
}

function webSidePanelSourceLabel(
  request: Pick<TranslateRequest, 'pageUrl' | 'sourceLabel'>,
): string {
  return sourceHostForRequest(request) ?? '当前网页';
}

function prepareWebSidePanelTranslation(
  tabId: number,
  request: TranslateRequest,
  providerContext?: PdfSidePanelSession['providerContext'],
): PdfSidePanelSession {
  return {
    tabId,
    sourceKind: 'web',
    targetLanguage: request.targetLanguage,
    requestId: request.requestId,
    sourceText: request.text.trim(),
    pageUrl: request.pageUrl,
    sourceLabel: webSidePanelSourceLabel(request),
    status: 'translating',
    progressStage: 'provider',
    startedAt: Date.now(),
    completedChunks: 0,
    totalChunks: 1,
    ...(providerContext ? { providerContext } : {}),
  };
}

function mirroredWebSidePanelSession(
  tabId: number,
  payload: {
    result: TranslateResult;
    pageUrl: string;
    sourceLabel?: string;
  },
): PdfSidePanelSession {
  return {
    tabId,
    sourceKind: 'web',
    ...(payload.result.targetLanguage
      ? { targetLanguage: payload.result.targetLanguage }
      : {}),
    requestId: payload.result.requestId,
    sourceText: payload.result.originalText,
    pageUrl: payload.pageUrl,
    sourceLabel: payload.sourceLabel?.trim() || webSidePanelSourceLabel({
      pageUrl: payload.pageUrl,
    }),
    status: 'complete',
    startedAt: Date.now(),
    partialText: payload.result.translatedText,
    completedChunks: payload.result.chunkCount ?? 1,
    totalChunks: payload.result.chunkCount ?? 1,
    result: payload.result,
  };
}

async function translateSelectionInBrowserSidePanel(
  request: TranslateRequest,
  tabId: number,
): Promise<TranslateRuntimeResponse> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrentLifecycle = (): void => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('网页已经关闭或跳转，旧的侧栏翻译没有启动。');
    }
  };
  try {
    const settings = await getSettings();
    assertCurrentLifecycle();
    const profile = settings.apiProfiles.find(
      (candidate) => candidate.id === settings.activeApiProfileId,
    ) ?? settings.apiProfiles[0];
    const session = prepareWebSidePanelTranslation(
      tabId,
      request,
      profile
        ? { role: 'text', profileName: profile.name, model: profile.model }
        : undefined,
    );
    await runTranslationCommit(tabId, () =>
      publishPdfSidePanelSessionDurably(session, assertCurrentLifecycle));
    const response = await translate(request, tabId, 'runtime');
    if (!response.ok) {
      const current = pdfSidePanelSessions.get(tabId);
      if (
        tabLifecycles.isCurrent(lifecycleToken) &&
        current?.requestId === request.requestId &&
        current.status === 'translating'
      ) {
        publishPdfSidePanelSession({ ...current, status: 'error', error: response.error });
      }
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

function showPdfSidePanelSelectionError(
  tabId: number,
  sourceUrl: string | undefined,
  pageNumber?: number,
): PdfSidePanelSession {
  const session: PdfSidePanelSession = {
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
  };
  return session;
}

function getNativeChromeApi(): {
  sidePanel?: typeof browser.sidePanel;
  tabs?: typeof browser.tabs;
  contextMenus?: {
    onShown?: {
      addListener(callback: (
        info: { contexts: string[]; pageUrl?: string; frameUrl?: string },
        tab: { id?: number; windowId?: number; url?: string },
      ) => void): void;
    };
  };
} | undefined {
  return (globalThis as typeof globalThis & {
    chrome?: {
      sidePanel?: typeof browser.sidePanel;
      tabs?: typeof browser.tabs;
      contextMenus?: {
        onShown?: {
          addListener(callback: (
            info: { contexts: string[]; pageUrl?: string; frameUrl?: string },
            tab: { id?: number; windowId?: number; url?: string },
          ) => void): void;
        };
      };
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

let pdfSidePanelInitialization: Promise<void> = Promise.resolve();
let pdfSidePanelInitializationStarted = false;
let pdfSidePanelOptionsTail: Promise<void> = Promise.resolve();

function initializePdfSidePanelSessions(): Promise<void> {
  if (pdfSidePanelInitializationStarted) return pdfSidePanelInitialization;
  pdfSidePanelInitializationStarted = true;
  pdfSidePanelInitialization = (async () => {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (
        tab.id !== undefined &&
        isExtensionPdfReaderUrl(tab.url, PI_PDF_READER_URL)
      ) {
        piPdfReaderTabIds.add(tab.id);
      }
      if (tab.active && tab.id !== undefined) {
        rememberActiveBrowserTab(tab.id, tab.windowId);
      }
    }
    const restored = await restorePdfSidePanelSessions(tabs);
    for (const session of restored) {
      if (!pdfSidePanelSessions.has(session.tabId)) {
        publishPdfSidePanelSession(session, false);
      }
    }
  })().catch((error: unknown) => {
    pdfSidePanelInitializationStarted = false;
    throw error;
  });
  return pdfSidePanelInitialization;
}

function queuePdfSidePanelOptionsSync(): Promise<void> {
  const next = pdfSidePanelOptionsTail.catch(() => undefined).then(async () => {
    await initializePdfSidePanelSessions();
    const [tabs, settings] = await Promise.all([
      browser.tabs.query({}),
      getSettings(),
    ]);
    await Promise.all(tabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [setPdfSidePanelEnabled(
            tab.id,
            !piPdfReaderTabIds.has(tab.id) && (
              pdfSidePanelSessions.has(tab.id) ||
                isEdgePdfSidePanelTab(tab.url, PI_PDF_READER_URL) ||
                Boolean(tab.url && (
                  isOverleafProjectUrl(tab.url) ||
                  (settings.generalPageMode !== 'off' && isInjectableWebUrl(tab.url))
                )) ||
                // Tab.url is intentionally unavailable on sites for which the
                // user has not granted host access. Treating that as a normal
                // page used to disable native PDF tabs before the menu click.
                tab.url === undefined
            ),
          )],
    ));
  });
  pdfSidePanelOptionsTail = next;
  return next;
}

function openBrowserTranslationSidePanel(
  tab: { id: number; windowId: number; url?: string },
  mirrored?: NonNullable<Extract<
    RuntimeMessage,
    { type: 'OPEN_BROWSER_SIDEBAR' }
  >['payload']>,
): Promise<RuntimeResponse<{ opened: true }>> {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi || !tab.url || !isInjectableWebUrl(tab.url)) {
    return Promise.resolve(errorResponse(new TranslationError(
      'UNSUPPORTED_PAGE',
      '当前页面无法使用浏览器侧栏。',
      false,
    )));
  }
  let openPromise: Promise<unknown>;
  try {
    // This call must remain synchronous with the content-script or popup click.
    openPromise = sidePanelApi.open({ tabId: tab.id });
  } catch (error) {
    openPromise = Promise.reject(error);
  }
  const lifecycleToken = tabLifecycles.capture(tab.id);
  return openPromise.then(async () => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('网页已经关闭或跳转，浏览器侧栏没有继续打开。');
    }
    if (mirrored?.result && mirrored.pageUrl) {
      const result = mirrored.result;
      const pageUrl = mirrored.pageUrl;
      await runTranslationCommit(tab.id, () => publishPdfSidePanelSessionDurably(
        mirroredWebSidePanelSession(tab.id, {
          result,
          pageUrl,
          ...(mirrored.sourceLabel ? { sourceLabel: mirrored.sourceLabel } : {}),
        }),
        () => assertTabLifecycleCurrent(lifecycleToken),
      ));
    }
    if (mirrored?.persistPreference !== false) {
      await mutateSettings((settings) => ({
        nextSettings: { ...settings, sidebarMode: 'browser' },
        value: undefined,
      }));
    }
    void browser.tabs.sendMessage(tab.id, {
      type: 'BROWSER_SIDEBAR_ACTIVE',
    } satisfies RuntimeMessage).catch(() => undefined);
    if (tab.url && !isOverleafProjectUrl(tab.url)) {
      await completeFeatureDiscovery('web-sidebar').catch(() => undefined);
    }
    return { ok: true as const, data: { opened: true as const } };
  }).catch((error: unknown) => errorResponse(error));
}

function openWebCapturePermissionSidePanel(
  tab: { id: number; windowId: number },
): Promise<RuntimeResponse<{ opened: true }>> {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) {
    return Promise.resolve(errorResponse(new TranslationError(
      'UNSUPPORTED_PAGE',
      '当前 Edge 版本无法自动打开浏览器侧栏。',
      false,
    )));
  }
  // Notify an already-open panel immediately; a newly opened panel also reads
  // the pending state from the service worker during its initial load.
  void browser.runtime.sendMessage({
    type: 'WEB_CAPTURE_PERMISSION_PANEL_OPENED',
    payload: { tabId: tab.id },
  } satisfies RuntimeMessage).catch(() => undefined);
  let openPromise: Promise<unknown>;
  try {
    // Keep this call synchronous with the button click in the content script.
    // Chromium explicitly permits sidePanel.open() from a content-script gesture.
    openPromise = sidePanelApi.open({ tabId: tab.id });
  } catch (error) {
    openPromise = Promise.reject(error);
  }
  return openPromise.then(() => ({
    ok: true as const,
    data: { opened: true as const },
  })).catch((error: unknown) => errorResponse(error));
}

async function useFloatingSidebar(
  requestedTabId?: number,
): Promise<RuntimeResponse<{ opened: true }>> {
  try {
    const tab = requestedTabId === undefined
      ? (await browser.tabs.query({ active: true, currentWindow: true }))[0]
      : await browser.tabs.get(requestedTabId).catch(() => undefined);
    if (tab?.id === undefined || !tab.url || !isInjectableWebUrl(tab.url)) {
      throw new TranslationError('UNSUPPORTED_PAGE', '当前页面无法打开网页浮动侧栏。');
    }
    await mutateSettings((settings) => ({
      nextSettings: { ...settings, sidebarMode: 'floating' },
      value: undefined,
    }));
    await sendToSelectionContentScript(tab, { type: 'OPEN_SIDEBAR' });
    if (!isOverleafProjectUrl(tab.url)) {
      await completeFeatureDiscovery('web-sidebar').catch(() => undefined);
    }
    const sidePanelApi = getSidePanelApi();
    if (sidePanelApi) {
      await sidePanelApi.setOptions({ tabId: tab.id, enabled: false }).catch(() => undefined);
      await sidePanelApi.setOptions({
        tabId: tab.id,
        enabled: true,
        path: PDF_SIDE_PANEL_PATH,
      }).catch(() => undefined);
    }
    return { ok: true, data: { opened: true } };
  } catch (error) {
    return errorResponse(error);
  }
}

function beginPdfSidePanelOpenFromUserGesture(
  tab?: { id?: number | undefined; windowId?: number | undefined },
): Promise<unknown> | undefined {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) return undefined;
  let openPromise: Promise<unknown>;
  try {
    openPromise = sidePanelApi.open(
      pdfSidePanelOpenTarget(immediatePdfSidePanelTab(tab)),
    );
  } catch (error) {
    openPromise = Promise.reject(error);
  }
  // The real handler is attached as soon as Edge resolves the actual PDF tab.
  // Attach a rejection observer immediately so a very fast API rejection does
  // not become an unhandled promise while tabs.query is still in flight.
  void openPromise.catch(() => undefined);
  return openPromise;
}

function publishPdfSidePanelTargetError(
  tabId: number | undefined,
  sourceUrl: string | undefined,
): void {
  const error = new TranslationError(
    'UNSUPPORTED_PAGE',
    '无法确认触发右键菜单的 PDF 标签页。请保持该 PDF 为当前标签，并重新右键选择“使用 Pi Translator 翻译选中文本”。',
    false,
  );
  void recordLocalDiagnosticError('resolve-pdf-context-tab', error);
  if (tabId !== undefined && tabId >= 0) {
    const lifecycleToken = tabLifecycles.capture(tabId);
    void runTranslationCommit(tabId, () => {
      if (!tabLifecycles.isCurrent(lifecycleToken)) return;
      publishPdfSidePanelSession({
        tabId,
        requestId: crypto.randomUUID(),
        sourceText: '',
        pageUrl: sourceUrl ?? 'edge://pdf',
        sourceLabel: sourceUrl ? pdfFilename(sourceUrl, 'PDF') : 'PDF',
        status: 'error',
        startedAt: Date.now(),
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      });
    });
  }
  void browser.action.setBadgeBackgroundColor({ color: '#b4233b' });
  void browser.action.setBadgeText({
    ...(tabId !== undefined && tabId >= 0 ? { tabId } : {}),
    text: '!',
  });
  void browser.action.setTitle({
    ...(tabId !== undefined && tabId >= 0 ? { tabId } : {}),
    title: '无法确认当前 PDF 标签页，请保持 PDF 为当前标签后重试',
  });
}

function openPdfTranslationSidePanel(
  tab: { id: number; windowId: number },
  sourceText: string | undefined,
  sourceUrl: string | undefined,
  pageNumber?: number,
  userGestureOpenPromise?: Promise<unknown>,
): void {
  const hasSelection = Boolean(sourceText?.trim());
  const lifecycleToken = tabLifecycles.capture(tab.id);
  const assertCurrentLifecycle = (): void => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('PDF 标签页已经关闭或跳转，请重新选择内容。');
    }
  };
  const createSession = async (): Promise<PdfSidePanelSession> => {
    assertCurrentLifecycle();
    const previousSession = pdfSidePanelSessions.get(tab.id);
    const defaultTargetLanguage = previousSession?.targetLanguage ??
      previousSession?.result?.targetLanguage ??
      (await getSettings()).targetLanguage;
    assertCurrentLifecycle();
    const session = hasSelection
      ? preparePdfSidePanelTranslation(
          tab.id,
          sourceText!,
          sourceUrl,
          defaultTargetLanguage,
          pageNumber,
        )
      : showPdfSidePanelSelectionError(tab.id, sourceUrl, pageNumber);
    await publishPdfSidePanelSessionDurably(session, assertCurrentLifecycle);
    return session;
  };

  // Prefer the native Chrome namespace here. Edge exposes both namespaces,
  // but sidePanel is defined and documented on chrome.sidePanel.
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) {
    void runTranslationCommit(tab.id, createSession).then((session) => {
      assertCurrentLifecycle();
      publishPdfSidePanelSession({
        ...session,
        status: 'error',
        error: {
          code: 'UNSUPPORTED_PAGE',
          message: '当前 Edge 版本无法打开扩展侧边栏，翻译请求尚未发送。',
          retryable: false,
        },
      });
    }).catch((error: unknown) => recordLocalDiagnosticError('open-pdf-side-panel', error));
    void browser.action.setBadgeText({ tabId: tab.id, text: '!' });
    void browser.action.setTitle({
      tabId: tab.id,
      title: '当前 Edge 版本未提供侧边栏接口',
    });
    return;
  }
  // PDF tabs are enabled ahead of time by queuePdfSidePanelOptionsSync(). The
  // click handler must call open() directly during the user gesture; racing a
  // just-in-time setOptions() against open() is unreliable in Edge.
  const openPromise = userGestureOpenPromise ?? beginPdfSidePanelOpenFromUserGesture(tab);
  if (!openPromise) return;
  const sessionPromise = runTranslationCommit(tab.id, createSession);
  void openPromise.then(
    () => {
      void sessionPromise.then((session) => {
        assertCurrentLifecycle();
        if (hasSelection) void beginPdfSidePanelTranslation(tab.id, session.requestId);
        void queuePdfSidePanelOptionsSync().catch(() => undefined);
        void browser.action.setBadgeText({ tabId: tab.id, text: '' });
        void browser.action.setTitle({ tabId: tab.id, title: 'Pi Translator' });
      }).catch((error: unknown) => recordLocalDiagnosticError('open-pdf-side-panel', error));
    },
    (error: unknown) => {
      void recordLocalDiagnosticError('open-pdf-side-panel', error);
      void sessionPromise.then((session) => {
        assertCurrentLifecycle();
        const current = pdfSidePanelSessions.get(tab.id);
        if (!isSamePdfSidePanelSession(current, session)) return;
        publishPdfSidePanelSession({
          ...current,
          status: 'error',
          error: {
            code: 'UNSUPPORTED_PAGE',
            message: 'PDF 侧边栏打开失败，翻译请求尚未发送。请重新加载扩展后重试。',
            retryable: false,
          },
        });
      }).catch((sessionError: unknown) =>
        recordLocalDiagnosticError('open-pdf-side-panel', sessionError));
      void queuePdfSidePanelOptionsSync().catch(() => undefined);
      void browser.action.setBadgeBackgroundColor({ color: '#b4233b' });
      void browser.action.setBadgeText({ tabId: tab.id, text: '!' });
      void browser.action.setTitle({
        tabId: tab.id,
        title: 'PDF 侧边栏打开失败，请在扩展管理页重新加载 Pi Translator',
      });
    },
  );
}

async function disableSidePanelForPiPdfViewer(
  tab: { id?: number | undefined },
): Promise<void> {
  const sidePanelApi = getSidePanelApi();
  if (!sidePanelApi) return;

  // Pi PDF already has its own compact translation card, so the extension
  // side panel is deliberately unavailable on this one tab.
  if (tab.id !== undefined) {
    piPdfReaderTabIds.add(tab.id);
    await sidePanelApi.setOptions({ tabId: tab.id, enabled: false }).catch(
      () => undefined,
    );
  }
  void queuePdfSidePanelOptionsSync().catch(() => undefined);
}

async function retryPdfSidePanelTranslation(
  tabId: number,
  expectedRequestId: string,
): Promise<RuntimeResponse<{ started: true }>> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrentLifecycle = (): void => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('PDF 标签页已经关闭或跳转，没有重新发起请求。');
    }
  };
  try {
    const outcome = await runTranslationCommit(tabId, async () => {
    try {
      assertCurrentLifecycle();
    } catch (error) {
      return {
        response: errorResponse(error) as RuntimeResponse<{ started: true }>,
      };
    }
    const session = pdfSidePanelSessions.get(tabId);
    if (!session || !session.sourceText.trim()) {
      return {
        response: errorResponse(
          new TranslationError('EMPTY_SELECTION', '请先在 PDF 中选择文字并使用右键翻译。'),
        ) as RuntimeResponse<{ started: true }>,
      };
    }
    if (session.status !== 'error' || session.requestId !== expectedRequestId) {
      return {
        response: errorResponse(
          new TranslationError(
            'REQUEST_ABORTED',
            '原 PDF 翻译任务已经变化，没有发起新的 API 请求。',
            false,
          ),
        ) as RuntimeResponse<{ started: true }>,
      };
    }
    if (session.error?.code === 'UNSUPPORTED_PAGE') {
      return {
        response: errorResponse(
          new TranslationError('UNSUPPORTED_PAGE', session.error.message, false),
        ) as RuntimeResponse<{ started: true }>,
      };
    }
    const nextSession: PdfSidePanelSession = {
      ...session,
      requestId: crypto.randomUUID(),
      status: 'translating',
      progressStage: 'provider',
      startedAt: Date.now(),
      completedChunks: 0,
      totalChunks: 1,
    };
    delete nextSession.partialText;
    delete nextSession.result;
    delete nextSession.error;
    delete nextSession.providerContext;
    delete nextSession.settingsRecoveryConfirmation;
    await publishPdfSidePanelSessionDurably(nextSession, assertCurrentLifecycle);
    return {
      response: { ok: true, data: { started: true } } as const,
      requestId: nextSession.requestId,
    };
    });
    if (outcome.requestId && tabLifecycles.isCurrent(lifecycleToken)) {
      void beginPdfSidePanelTranslation(tabId, outcome.requestId);
    }
    return outcome.response;
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

function assertSidePanelRetranslationSource(
  session: PdfSidePanelSession | undefined,
  expectedRequestId: string,
): asserts session is PdfSidePanelSession {
  if (!session || session.requestId !== expectedRequestId) {
    throw new TranslationError(
      'REQUEST_ABORTED',
      '侧栏已显示新的翻译，没有重译旧结果。',
      false,
    );
  }
  if (session.status === 'translating') {
    throw new TranslationError(
      'REQUEST_ABORTED',
      '当前翻译尚未完成，请稍后再切换目标语言。',
      false,
    );
  }
  if (!session.sourceText.trim() || (session.status === 'complete' && !session.result)) {
    throw new TranslationError(
      'EMPTY_SELECTION',
      '当前侧栏没有可重译的原文。',
      false,
    );
  }
}

async function retranslateSidePanelTranslation(
  tabId: number,
  expectedRequestId: string,
  targetLanguage: SupportedTargetLanguage,
): Promise<RuntimeResponse<{ started: true }>> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrentLifecycle = (): void => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('当前标签页已关闭或跳转，没有重译旧内容。');
    }
  };
  try {
    await initializePdfSidePanelSessions();
    assertCurrentLifecycle();
    const session = pdfSidePanelSessions.get(tabId);
    assertSidePanelRetranslationSource(session, expectedRequestId);

    if (session.sourceKind === 'web') {
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION',
        payload: {
          expectedRequestId,
          targetLanguage,
          ...(session.result ? { result: session.result } : {}),
        },
      } satisfies RuntimeMessage) as RuntimeResponse<{ started: true }> | undefined;
      if (!response) {
        throw new TranslationError(
          'UNSUPPORTED_PAGE',
          '无法连接当前网页，请刷新页面后重试。',
          true,
        );
      }
      return response;
    }

    const nextRequestId = await runTranslationCommit(tabId, async () => {
      assertCurrentLifecycle();
      const current = pdfSidePanelSessions.get(tabId);
      assertSidePanelRetranslationSource(current, expectedRequestId);
      const nextSession: PdfSidePanelSession = {
        ...current,
        targetLanguage,
        requestId: crypto.randomUUID(),
        status: 'translating',
        progressStage: 'provider',
        startedAt: Date.now(),
        completedChunks: 0,
        totalChunks: 1,
      };
      delete nextSession.partialText;
      delete nextSession.result;
      delete nextSession.error;
      delete nextSession.providerContext;
      delete nextSession.settingsRecoveryConfirmation;
      delete nextSession.correctionReceipt;
      await publishPdfSidePanelSessionDurably(nextSession, assertCurrentLifecycle);
      return nextSession.requestId;
    });
    if (tabLifecycles.isCurrent(lifecycleToken)) {
      void beginPdfSidePanelTranslation(tabId, nextRequestId);
    }
    return { ok: true, data: { started: true } };
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

async function cancelPdfSidePanelTranslation(
  tabId: number,
  expectedRequestId: string,
): Promise<RuntimeResponse<{ cancelled: boolean }>> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrentLifecycle = (): void => {
    if (!tabLifecycles.isCurrent(lifecycleToken)) {
      throw staleTranslationMutationError('PDF 标签页已经关闭或跳转，无法停止旧的翻译任务。');
    }
  };
  try {
    await initializePdfSidePanelSessions();
    const cancelled = await runTranslationCommit(tabId, async () => {
      assertCurrentLifecycle();
      const session = pdfSidePanelSessions.get(tabId);
      const active = activeRequests.get(tabId);
      if (
        !session ||
        session.status !== 'translating' ||
        session.requestId !== expectedRequestId ||
        (active !== undefined && active.requestId !== expectedRequestId)
      ) {
        return false;
      }

      active?.controller.abort();
      const stoppedSession: PdfSidePanelSession = {
        ...session,
        status: 'error',
        error: {
          code: 'REQUEST_ABORTED',
          message: '翻译已停止。',
          retryable: false,
        },
      };
      delete stoppedSession.result;
      delete stoppedSession.settingsRecoveryConfirmation;
      delete stoppedSession.correctionReceipt;
      await publishPdfSidePanelSessionDurably(stoppedSession, assertCurrentLifecycle);
      await clearTranslationCheckpoint(tabId).catch((error: unknown) => {
        void recordLocalDiagnosticError('translate', error);
      });
      return true;
    });
    return { ok: true, data: { cancelled } };
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

interface SettingsRecoveryAck {
  handled: boolean;
  resumed: boolean;
  requiresConfirmation: boolean;
}

async function activateSettingsRecoverySource(ticket: SettingsRecoveryTicket): Promise<void> {
  const tab = await browser.tabs.get(ticket.sourceTabId);
  if (tab.windowId !== undefined) {
    await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
  await browser.tabs.update(ticket.sourceTabId, { active: true }).catch(() => undefined);
}

async function deliverSettingsRecovery(
  ticket: SettingsRecoveryTicket,
): Promise<SettingsRecoveryAck> {
  const requiresConfirmation = ticket.hadPartialOutput || !ticket.autoResume;
  const payload = {
    token: ticket.token,
    role: ticket.role,
    failedRequestId: ticket.failedRequestId,
    hadPartialOutput: ticket.hadPartialOutput,
    autoResume: ticket.autoResume,
    targetKind: ticket.targetKind,
    sourceTabId: ticket.sourceTabId,
    ...(ticket.clientId ? { clientId: ticket.clientId } : {}),
  } as const;
  if (ticket.targetKind === 'native-pdf') {
    const lifecycleToken = tabLifecycles.capture(ticket.sourceTabId);
    const assertCurrentLifecycle = (): void => {
      assertTabLifecycleCurrent(lifecycleToken);
    };
    await initializePdfSidePanelSessions();
    if (!requiresConfirmation) {
      assertCurrentLifecycle();
      const response = await retryPdfSidePanelTranslation(
        ticket.sourceTabId,
        ticket.failedRequestId,
      );
      if (!response.ok) return { handled: false, resumed: false, requiresConfirmation: false };
    } else {
      const confirmed = await runTranslationCommit(ticket.sourceTabId, async () => {
        assertCurrentLifecycle();
        const session = pdfSidePanelSessions.get(ticket.sourceTabId);
        if (
          !session ||
          session.status !== 'error' ||
          session.requestId !== ticket.failedRequestId
        ) {
          return false;
        }
        await publishPdfSidePanelSessionDurably({
          ...session,
          settingsRecoveryConfirmation: {
            failedRequestId: ticket.failedRequestId,
            hadPartialOutput: ticket.hadPartialOutput,
          },
        }, assertCurrentLifecycle);
        return true;
      });
      if (!confirmed) {
        return { handled: false, resumed: false, requiresConfirmation: true };
      }
    }
    assertCurrentLifecycle();
    await activateSettingsRecoverySource(ticket);
    return {
      handled: true,
      resumed: !requiresConfirmation,
      requiresConfirmation,
    };
  }

  const message = {
    type: 'SETTINGS_RECOVERY_READY',
    payload,
  } satisfies RuntimeMessage;
  let ack: SettingsRecoveryAck | undefined;
  if (ticket.targetKind === 'extension-page') {
    ack = await browser.runtime.sendMessage(message).catch(() => undefined) as
      | SettingsRecoveryAck
      | undefined;
  } else {
    ack = await browser.tabs.sendMessage(
      ticket.sourceTabId,
      message,
      ticket.sourceFrameId !== undefined ? { frameId: ticket.sourceFrameId } : undefined,
    ).catch(() => undefined) as SettingsRecoveryAck | undefined;
  }
  if (!ack?.handled) {
    return { handled: false, resumed: false, requiresConfirmation };
  }
  await activateSettingsRecoverySource(ticket);
  return ack;
}

async function localDiagnosticReport(): Promise<string> {
  const settings = await getSettings();
  const [apiKeyConfigured, apiPermissionGranted, recentErrors, recentPerformance] = await Promise.all([
    getApiKey(settings.activeApiProfileId).then(Boolean),
    browser.permissions.contains({ origins: [apiOriginPattern(settings.apiBaseUrl)] }),
    getLocalDiagnosticEvents(),
    getLocalPerformanceSamples(),
  ]);
  const manifest = browser.runtime.getManifest();
  return buildLocalDiagnosticReport({
    generatedAt: new Date().toISOString(),
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    apiState: {
      profileCount: settings.apiProfiles.length,
      apiKeyConfigured,
      apiPermissionGranted,
    },
    performanceContext: {
      streaming: settings.enableStreaming,
      autoRenderLatex: settings.autoRenderLatex,
    },
    recentErrors,
    recentPerformance,
  });
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
  providerOverride?: NativePdfTranslationProvider,
  persistence: 'persistent' | 'transient' = 'persistent',
): Promise<TranslateRuntimeResponse> {
  const performanceStartedAt = performance.now();
  const performanceTimings: Partial<Record<PerformancePhase, number>> = {};
  const captureMs = safePerformanceDuration(request.clientPerformance?.captureMs);
  const queueMs = safePerformanceDuration(request.clientPerformance?.queueMs);
  if (captureMs !== undefined) performanceTimings.captureMs = captureMs;
  if (queueMs !== undefined) performanceTimings.queueMs = queueMs;
  let performanceError: unknown;
  let performanceRecorded = false;
  const finishPerformance = (): void => {
    if (performanceRecorded) return;
    performanceRecorded = true;
    performanceTimings.totalMs = Math.max(0, performance.now() - performanceStartedAt);
    void recordLocalPerformanceSample({
      operation: 'translate-text',
      timings: performanceTimings,
      ...(performanceError
        ? { errorCode: toTranslationError(performanceError).code }
        : {}),
    });
  };
  const text = request.text.trim();
  const revisionInstruction = request.revision?.instruction.trim().slice(0, 500);
  const previousTranslation = request.revision?.previousTranslation
    ?.trim()
    .slice(0, MAX_SELECTION_LENGTH);
  if (!text) {
    performanceError = new TranslationError('EMPTY_SELECTION', 'No text was selected.');
    performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
    finishPerformance();
    return errorResponse(performanceError);
  }
  if (text.length > MAX_SELECTION_LENGTH) {
    performanceError = new TranslationError(
      'SELECTION_TOO_LONG',
      'The selected text is too long.',
    );
    performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
    finishPerformance();
    return errorResponse(performanceError);
  }

  const lifecycleToken = tabLifecycles.capture(tabId);
  await runTranslationCommit(tabId, () => undefined);
  if (!tabLifecycles.isCurrent(lifecycleToken)) {
    performanceError = new TranslationError('REQUEST_ABORTED', 'The source tab changed.', false);
    performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
    finishPerformance();
    return errorResponse(staleTranslationMutationError(
      '页面已经关闭或跳转，旧的翻译请求没有启动。',
    ));
  }
  if (providerOverride) {
    const nativePdfSession = pdfSidePanelSessions.get(tabId);
    if (
      nativePdfSession?.requestId !== request.requestId ||
      nativePdfSession.status !== 'translating'
    ) {
      performanceError = new TranslationError('REQUEST_ABORTED', 'The PDF request was stopped.', false);
      performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
      finishPerformance();
      return errorResponse(new TranslationError(
        'REQUEST_ABORTED',
        'PDF 翻译已停止，没有调用翻译接口。',
        false,
      ));
    }
  }
  const controller = beginActiveRequest(tabId, request.requestId);
  pendingTranslationRequests.set(tabId, request.requestId);
  const assertCurrentRequest = (): void => {
    assertTabLifecycleCurrent(lifecycleToken);
    assertActiveRequest(tabId, request.requestId, controller);
  };
  let progressDeliveryTail: Promise<void> = Promise.resolve();
  const queueProgress = (payload: TranslationProgressPayload): void => {
    progressDeliveryTail = progressDeliveryTail.then(() => {
      if (!tabLifecycles.isCurrent(lifecycleToken)) return;
      if (activeRequests.get(tabId)?.controller !== controller) return;
      return publishTranslationProgress(tabId, payload, progressTarget);
    });
  };
  try {
    const settings = await getSettings();
    assertActiveRequest(tabId, request.requestId, controller);
    const provider = providerOverride ?? (() => {
      const profile = settings.apiProfiles.find(
        (candidate) => candidate.id === settings.activeApiProfileId,
      ) ?? settings.apiProfiles[0];
      return profile
        ? {
            profileId: profile.id,
            profileName: profile.name,
            apiBaseUrl: profile.apiBaseUrl,
            model: profile.model,
            role: 'text' as const,
          }
        : undefined;
    })();
    if (!provider) {
      throw new TranslationError('NO_API_KEY', 'Configure a translation API profile first.');
    }
    const identity = documentIdentity(request);
    const documentMemory = await getDocumentMemory(identity);
    assertActiveRequest(tabId, request.requestId, controller);
    const scopedGlossary = mergeDocumentGlossaryWithScope(
      settings.academicGlossary,
      documentMemory,
    );
    const glossary = scopedGlossary.map(({ source, target }) => ({ source, target }));
    const contextText = buildDocumentReferenceContext(
      text,
      request.contextText,
      documentMemory,
    );
    const lexicalLookupRequested = isLexicalLookupCandidate(request);
    const effectiveRequest: TranslateRequest = contextText
      ? { ...request, contextText }
      : request;
    const cacheKey = translationCacheKey(effectiveRequest, {
      apiBaseUrl: provider.apiBaseUrl,
      model: provider.model,
      glossary,
    });
    const chunks = splitLongTranslationText(text);
    const checkpoint = await getTranslationCheckpoint(tabId, cacheKey, chunks);
    assertActiveRequest(tabId, request.requestId, controller);
    if (settings.enableSessionCache && !request.bypassCache && !request.revision) {
      const cached = await getCachedTranslation(
        tabId,
        cacheKey,
        request.requestId,
        sourceHostForRequest(request),
        request.sourceLocation,
      );
      assertActiveRequest(tabId, request.requestId, controller);
      if (cached) {
        const evidencedCached = withGlossaryTermEvidence(cached, scopedGlossary);
        performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
        queueProgress({
          requestId: request.requestId,
          completedChunks: evidencedCached.chunkCount ?? 1,
          totalChunks: evidencedCached.chunkCount ?? 1,
          progressStage: 'committing',
        });
        await progressDeliveryTail;
        assertActiveRequest(tabId, request.requestId, controller);
        if (persistence === 'transient') {
          await clearTranslationCheckpoint(tabId, cacheKey).catch(() => undefined);
          assertActiveRequest(tabId, request.requestId, controller);
          return { ok: true, data: { result: evidencedCached, history: [] } };
        }
        const commitStartedAt = performance.now();
        const finalization = startCommittedTask(
          (operation) => runTranslationCommit(tabId, operation),
          async () => {
            assertActiveRequest(tabId, request.requestId, controller);
            await commitTranslationResultState(tabId, evidencedCached, assertCurrentRequest);
            performanceTimings.commitMs = Math.max(0, performance.now() - commitStartedAt);
          },
          async () => {
            const maintenanceStartedAt = performance.now();
            const history = await settleTranslationFinalization(
              'translate-finalization',
              settings.rememberRecentTranslations
                ? addTranslationHistory(tabId, evidencedCached, settings.historyLimit)
                : Promise.resolve([]),
              [
                clearTranslationCheckpoint(tabId, cacheKey),
                rememberDocumentTranslation(identity, evidencedCached),
              ],
            );
            performanceTimings.maintenanceMs = Math.max(
              0,
              performance.now() - maintenanceStartedAt,
            );
            return history;
          },
        );
        await finalization.committed;
        await publishTranslationProgress(tabId, {
          requestId: request.requestId,
          partialText: evidencedCached.translatedText,
          completedChunks: evidencedCached.chunkCount ?? 1,
          totalChunks: evidencedCached.chunkCount ?? 1,
          result: evidencedCached,
        }, progressTarget);
        const history = await finalization.finished;
        assertActiveRequest(tabId, request.requestId, controller);
        return { ok: true, data: { result: evidencedCached, history } };
      }
    }

    const apiKey = await getApiKey(provider.profileId);
    assertActiveRequest(tabId, request.requestId, controller);
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', 'Configure an API Key first.');
    }
    const apiPermission = apiOriginPattern(provider.apiBaseUrl);
    const permissionGranted = await browser.permissions.contains({ origins: [apiPermission] });
    assertActiveRequest(tabId, request.requestId, controller);
    if (!permissionGranted) {
      throw new TranslationError(
        'API_PERMISSION_REQUIRED',
        `Permission for ${apiPermission} is required.`,
      );
    }
    const startedAt = performance.now();
    performanceTimings.preflightMs = Math.max(0, startedAt - performanceStartedAt);
    let providerMs = 0;
    let firstProviderRequestStartedAt: number | undefined;
    const timedTranslator = {
      translate: async (...args: Parameters<typeof translator.translate>) => {
        const providerStartedAt = performance.now();
        firstProviderRequestStartedAt ??= providerStartedAt;
        try {
          return await translator.translate(...args);
        } finally {
          providerMs += Math.max(0, performance.now() - providerStartedAt);
          performanceTimings.providerMs = providerMs;
        }
      },
    };
    let latexValidationMs = 0;
    const protect = shouldProtectLatex(request.contentMode, request.pageUrl, text);
    const completedCheckpointChunks: TranslationCheckpointChunk[] =
      checkpoint?.completedChunks.map((chunk) => ({ ...chunk })) ?? [];
    const translatedChunks = completedCheckpointChunks.map((chunk) => chunk.translatedText);
    const warnings: TranslateResult['warnings'] = completedCheckpointChunks.flatMap(
      (chunk) => chunk.warnings,
    );
    const alignmentCompleteFromCheckpoint = completedCheckpointChunks.every(
      (chunk) => Boolean(chunk.alignedSegments?.length),
    );
    const combinedSegments: TranslationSegment[] = alignmentCompleteFromCheckpoint
      ? completedCheckpointChunks.flatMap((chunk) => chunk.alignedSegments ?? [])
      : [];
    let alignmentComplete = alignmentCompleteFromCheckpoint;
    let detectedLanguage = completedCheckpointChunks.find(
      (chunk) => Boolean(chunk.detectedLanguage),
    )?.detectedLanguage;
    const termCandidates = completedCheckpointChunks.flatMap(
      (chunk) => chunk.termCandidates ?? [],
    );
    let lexicalLookup: LexicalLookup | undefined;

    if (completedCheckpointChunks.length) {
      queueProgress({
        requestId: request.requestId,
        partialText: translatedChunks.join('\n\n'),
        completedChunks: completedCheckpointChunks.length,
        totalChunks: chunks.length,
      });
    }

    for (
      let chunkIndex = completedCheckpointChunks.length;
      chunkIndex < chunks.length;
      chunkIndex += 1
    ) {
      const chunk = chunks[chunkIndex]!;
      const protectedLatex = protect ? protectLatex(chunk, `FULL${chunkIndex + 1}`) : undefined;
      const sourceSegments = request.segments
        ? request.segments.map((segment) => ({ ...segment }))
        : splitTranslationSegments(chunk, request.sourceLanguage).map(
            (segment) => ({ ...segment, id: `C${chunkIndex + 1}${segment.id}` }),
          );
      const requestProviderAlignment =
        Boolean(request.segments?.length) ||
        (settings.sentenceAlignmentDefault && sourceSegments.length > 1);
      const preparedSegments = sourceSegments.map((segment, index) => ({
        source: segment,
        protected: protect && requestProviderAlignment
          ? protectLatex(segment.text, `C${chunkIndex + 1}SEG${index + 1}`)
          : undefined,
      }));
      const prefix = translatedChunks.length ? `${translatedChunks.join('\n\n')}\n\n` : '';
      let lastPartial = '';
      let lastProgressAt = 0;
      const callbacks = settings.enableStreaming
        ? {
            onPartialText: (partialText: string) => {
              if (activeRequests.get(tabId)?.controller !== controller) return;
              const visiblePartial = protectedLatex
                ? restoreLatexPreview(partialText, protectedLatex)
                : partialText;
              if (!visiblePartial || visiblePartial === lastPartial) return;
              const now = performance.now();
              performanceTimings.providerFirstOutputMs ??= Math.max(
                0,
                now - (firstProviderRequestStartedAt ?? now),
              );
              if (lastProgressAt > 0 && now - lastProgressAt < 80) return;
              lastPartial = visiblePartial;
              lastProgressAt = now;
              queueProgress({
                requestId: request.requestId,
                partialText: `${prefix}${visiblePartial}`,
                completedChunks: chunkIndex,
                totalChunks: chunks.length,
              });
            },
          }
        : undefined;
      const previousTranslationChunk = revisionDraftChunk(
        previousTranslation,
        chunkIndex,
        chunks.length,
      );
      const preparedInput = {
        text: protectedLatex?.protectedText ?? chunk,
        placeholderTokens: [
          ...(protectedLatex?.fragments.map((fragment) => fragment.token) ?? []),
          ...preparedSegments.flatMap(
            (segment) => segment.protected?.fragments.map((fragment) => fragment.token) ?? [],
          ),
        ],
        ...(requestProviderAlignment
          ? {
              segments: preparedSegments.map((segment) => ({
                id: segment.source.id,
                text: segment.protected?.protectedText ?? segment.source.text,
              })),
            }
          : {}),
        ...(contextText ? { contextText } : {}),
        ...(lexicalLookupRequested ? { lexicalLookup: true } : {}),
        ...(revisionInstruction ? { adjustmentInstruction: revisionInstruction } : {}),
        ...(previousTranslationChunk ? { previousTranslation: previousTranslationChunk } : {}),
      };
      const chunkValidationBaseMs = latexValidationMs;
      const { providerResult, restored, diagnostics } = await translateWithLatexRetry(
        timedTranslator,
        preparedInput,
        {
          model: provider.model,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          style: request.style,
          glossary,
        },
        { apiKey, apiBaseUrl: provider.apiBaseUrl },
        controller.signal,
        protectedLatex,
        callbacks,
        (diagnostic) => {
          performanceTimings.latexValidationMs =
            chunkValidationBaseMs + diagnostic.latexValidationMs;
        },
        (phase) => {
          queueProgress({
            requestId: request.requestId,
            completedChunks: chunkIndex,
            totalChunks: chunks.length,
            progressStage: phase,
          });
        },
      );
      assertActiveRequest(tabId, request.requestId, controller);
      latexValidationMs += diagnostics.latexValidationMs;

      detectedLanguage ??= providerResult.detectedLanguage;
      translatedChunks.push(restored.text);
      warnings.push(...restored.warnings);
      if (providerResult.termCandidates?.length) {
        termCandidates.push(...providerResult.termCandidates);
      }
      if (lexicalLookupRequested && providerResult.lexicalLookup) {
        lexicalLookup = providerResult.lexicalLookup;
      }
      let checkpointAlignedSegments: TranslationSegment[] | undefined;
      if (request.segments?.length) {
        const returnedCounts = new Map<string, number>();
        for (const segment of providerResult.alignedSegments ?? []) {
          returnedCounts.set(segment.id, (returnedCounts.get(segment.id) ?? 0) + 1);
        }
        const translatedById = new Map(
          (providerResult.alignedSegments ?? [])
            .filter((segment) => returnedCounts.get(segment.id) === 1)
            .map((segment) => [segment.id, segment.translatedText]),
        );
        checkpointAlignedSegments = preparedSegments.flatMap(({
          source,
          protected: protectedSegment,
        }) => {
          const translated = translatedById.get(source.id)?.trim();
          if (!translated) return [];
          try {
            return [{
              id: source.id,
              originalText: source.text,
              translatedText: protectedSegment
                ? restoreLatex(translated, protectedSegment).text
                : translated,
            }];
          } catch {
            return [];
          }
        });
        combinedSegments.push(...checkpointAlignedSegments);
        if (checkpointAlignedSegments.length !== preparedSegments.length) {
          alignmentComplete = false;
        }
      } else if (
        requestProviderAlignment &&
        providerResult.alignedSegments?.length === preparedSegments.length
      ) {
        try {
          const translatedById = new Map(
            providerResult.alignedSegments.map((segment) => [segment.id, segment.translatedText]),
          );
          checkpointAlignedSegments = preparedSegments.map(({ source, protected: protectedSegment }) => {
            const translated = translatedById.get(source.id);
            if (!translated) throw new Error(`Missing aligned segment ${source.id}.`);
            return {
              id: source.id,
              originalText: source.text,
              translatedText: protectedSegment
                ? restoreLatex(translated, protectedSegment).text
                : translated,
            };
          });
          if (alignmentComplete) combinedSegments.push(...checkpointAlignedSegments);
        } catch {
          combinedSegments.length = 0;
          alignmentComplete = false;
        }
      } else if (!requestProviderAlignment) {
        const translatedSegments = splitTranslationSegments(
          restored.text,
          request.targetLanguage,
        );
        if (translatedSegments.length === sourceSegments.length) {
          checkpointAlignedSegments = sourceSegments.map((source, index) => ({
            id: source.id,
            originalText: source.text,
            translatedText: translatedSegments[index]!.text,
          }));
          if (alignmentComplete) combinedSegments.push(...checkpointAlignedSegments);
        } else {
          combinedSegments.length = 0;
          alignmentComplete = false;
        }
      } else alignmentComplete = false;
      const completedCheckpointChunk: TranslationCheckpointChunk = {
        sourceText: chunk,
        translatedText: restored.text,
        warnings: restored.warnings,
        ...(providerResult.detectedLanguage
          ? { detectedLanguage: providerResult.detectedLanguage }
          : {}),
        ...(checkpointAlignedSegments ? { alignedSegments: checkpointAlignedSegments } : {}),
        ...(providerResult.termCandidates?.length
          ? { termCandidates: providerResult.termCandidates }
          : {}),
      };
      completedCheckpointChunks.push(completedCheckpointChunk);
      if (chunkIndex < chunks.length - 1) {
        await saveTranslationCheckpoint(
          tabId,
          cacheKey,
          chunks,
          completedCheckpointChunks,
        );
        assertActiveRequest(tabId, request.requestId, controller);
      }
      queueProgress({
        requestId: request.requestId,
        partialText: translatedChunks.join('\n\n'),
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
      });
    }
    performanceTimings.latexValidationMs = latexValidationMs;
    const sourceHost = sourceHostForRequest(request);
    const translatedText = translatedChunks.join('\n\n');
    const result = withGlossaryTermEvidence({
      requestId: request.requestId,
      documentId: identity.documentId,
      originalText: text,
      translatedText,
      ...(detectedLanguage ? { detectedLanguage } : {}),
      warnings,
      ...((request.segments?.length ? combinedSegments.length > 0 : alignmentComplete && combinedSegments.length)
        ? { alignedSegments: combinedSegments }
        : {}),
      ...(sourceHost ? { sourceHost } : {}),
      sourceKind: request.revision?.sourceKind ?? (request.sourceLocation ? 'pdf-region-text' : 'text'),
      ...(request.sourceLocation ? { sourceLocation: request.sourceLocation } : {}),
      targetLanguage: request.targetLanguage,
      style: request.style,
      completedAt: Date.now(),
      cached: false,
      latencyMs: Math.round(performance.now() - startedAt),
      contextUsed: Boolean(contextText),
      chunkCount: chunks.length,
      ...(termCandidates.length
        ? {
            termCandidates: [...new Map(
              termCandidates.map((term) => [term.source.trim().toLocaleLowerCase(), term]),
            ).values()].slice(0, 6),
          }
        : {}),
      ...(lexicalLookup ? { lexicalLookup } : {}),
      ...(request.revision?.formulaLatex?.length
        ? { formulaLatex: [...request.revision.formulaLatex] }
        : {}),
      ...(request.revision?.uncertainSpans?.length
        ? { uncertainSpans: [...request.revision.uncertainSpans] }
        : {}),
      ...(request.revision?.formulaNeedsReview ? { formulaNeedsReview: true } : {}),
      ...(request.revision
        ? {
            revision: {
              rootRequestId: request.revision.rootRequestId,
              kind: request.revision.kind,
              label: request.revision.label,
              scope: request.revision.scope ?? 'current',
            },
          }
        : {}),
    }, scopedGlossary);
    assertActiveRequest(tabId, request.requestId, controller);
    queueProgress({
      requestId: request.requestId,
      completedChunks: chunks.length,
      totalChunks: chunks.length,
      progressStage: 'committing',
    });
    await progressDeliveryTail;
    assertActiveRequest(tabId, request.requestId, controller);
    if (persistence === 'transient') {
      await settleTransientTranslationMaintenance([
        settings.enableSessionCache
          ? cacheTranslation(tabId, cacheKey, result)
          : Promise.resolve(),
        clearTranslationCheckpoint(tabId, cacheKey),
      ]);
      assertActiveRequest(tabId, request.requestId, controller);
      return { ok: true, data: { result, history: [] } };
    }
    const commitStartedAt = performance.now();
    const finalization = startCommittedTask(
      (operation) => runTranslationCommit(tabId, operation),
      async () => {
        assertActiveRequest(tabId, request.requestId, controller);
        await commitTranslationResultState(tabId, result, assertCurrentRequest);
        performanceTimings.commitMs = Math.max(0, performance.now() - commitStartedAt);
      },
      async () => {
        const maintenanceStartedAt = performance.now();
        const history = await settleTranslationFinalization(
          'translate-finalization',
          settings.rememberRecentTranslations
            ? addTranslationHistory(tabId, result, settings.historyLimit)
            : Promise.resolve([]),
          [
            request.revision
              ? clearTranslationCache(tabId)
              : settings.enableSessionCache
                ? cacheTranslation(tabId, cacheKey, result)
                : Promise.resolve(),
            clearTranslationCheckpoint(tabId, cacheKey),
            !request.revision || request.revision.scope === 'document'
              ? rememberDocumentTranslation(identity, result)
              : Promise.resolve(),
          ],
        );
        performanceTimings.maintenanceMs = Math.max(
          0,
          performance.now() - maintenanceStartedAt,
        );
        return history;
      },
    );
    await finalization.committed;
    queueProgress({
      requestId: request.requestId,
      partialText: result.translatedText,
      completedChunks: chunks.length,
      totalChunks: chunks.length,
      result,
    });
    await progressDeliveryTail;
    const history = await finalization.finished;
    assertActiveRequest(tabId, request.requestId, controller);
    return { ok: true, data: { result, history } };
  } catch (error) {
    performanceError = error;
    performanceTimings.preflightMs ??= Math.max(0, performance.now() - performanceStartedAt);
    await progressDeliveryTail.catch(() => undefined);
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  } finally {
    finishPerformance();
    const current = activeRequests.get(tabId);
    if (current?.requestId === request.requestId) {
      activeRequests.delete(tabId);
    }
    if (pendingTranslationRequests.get(tabId) === request.requestId) {
      pendingTranslationRequests.delete(tabId);
    }
  }
}

async function translateDocumentBatch(
  request: TranslateBatchRequest,
  tabId: number,
): Promise<TranslationBatchRuntimeResponse> {
  if (!validTranslationBatchItems(request.items)) {
    return errorResponse(new TranslationError(
      'INVALID_RESPONSE',
      '全文翻译批次格式不正确。',
      false,
    ));
  }
  const { items, ...baseRequest } = request;
  const response = await translate({
    ...baseRequest,
    text: items.map((item) => item.text.trim()).join('\n\n'),
    segments: items.map((item) => ({ id: item.id, text: item.text.trim() })),
  }, tabId, 'none', undefined, 'transient');
  if (!response.ok) return response;

  const requestedIds = new Set(items.map((item) => item.id));
  const returnedCounts = new Map<string, number>();
  for (const segment of response.data.result.alignedSegments ?? []) {
    if (!requestedIds.has(segment.id)) continue;
    returnedCounts.set(segment.id, (returnedCounts.get(segment.id) ?? 0) + 1);
  }
  const returned = new Map(
    (response.data.result.alignedSegments ?? [])
      .filter((segment) => (
        requestedIds.has(segment.id) &&
        returnedCounts.get(segment.id) === 1 &&
        Boolean(segment.translatedText.trim())
      ))
      .map((segment) => [segment.id, segment.translatedText.trim()]),
  );
  if (items.length === 1 && !returned.has(items[0]!.id)) {
    const translatedText = response.data.result.translatedText.trim();
    if (translatedText) returned.set(items[0]!.id, translatedText);
  }
  return {
    ok: true,
    data: {
      items: items.flatMap((item) => {
        const translatedText = returned.get(item.id);
        return translatedText ? [{ id: item.id, translatedText }] : [];
      }),
      missingItemIds: items
        .filter((item) => !returned.has(item.id))
        .map((item) => item.id),
    },
  };
}

function correctionTermSourceKey(value: string): string {
  return normalizeGlossaryTermKey(value);
}

function manualCorrectionError(error: unknown): TranslationError {
  if (!(error instanceof ManualCorrectionError)) return toTranslationError(error);
  if (error.code === 'EMPTY_TRANSLATION') {
    return new TranslationError('EMPTY_SELECTION', '修正后的译文不能为空。');
  }
  if (error.code === 'TRANSLATION_TOO_LONG') {
    return new TranslationError('SELECTION_TOO_LONG', '修正后的译文过长。');
  }
  if (error.code === 'LATEX_CHANGED') {
    return new TranslationError(
      'LATEX_VALIDATION_FAILED',
      '公式已锁定。请只修改自然语言部分，不要增删或改变 LaTeX。',
    );
  }
  return new TranslationError('INVALID_RESPONSE', '修正内容已过期或格式不正确，请重新打开编辑器。');
}

function translationResultRootRequestId(result: TranslateResult): string {
  return result.revision?.rootRequestId?.trim() || result.requestId;
}

function staleTranslationMutationError(
  message = '当前译文已经变化，请重新打开修正。',
): TranslationError {
  return new TranslationError('REQUEST_ABORTED', message);
}

function assertTabLifecycleCurrent(token: TabLifecycleToken | undefined): void {
  if (!tabLifecycles.isCurrent(token)) {
    throw staleTranslationMutationError('页面已经关闭或跳转，请在当前页面重新操作。');
  }
}

async function assertTranslationHead(
  tabId: number,
  expectedResultRequestId: string,
  expectedRootRequestId?: string,
): Promise<void> {
  const pendingRequestId = pendingTranslationRequests.get(tabId);
  if (pendingRequestId && pendingRequestId !== expectedResultRequestId) {
    throw staleTranslationMutationError();
  }
  const head = await readTranslationHead(tabId);
  if (
    !head ||
    (
      head.currentResultRequestId !== expectedResultRequestId ||
      (expectedRootRequestId !== undefined && head.rootRequestId !== expectedRootRequestId)
    )
  ) {
    throw staleTranslationMutationError();
  }
}

async function applyCorrectionTerm(
  locator: DocumentIdentityInput,
  scope: TranslationTermScope | undefined,
  term: GlossaryEntry | undefined,
): Promise<TranslationCorrectionTermReceipt | undefined> {
  if (!scope || !term) return undefined;
  let validated: { source: string; target: string };
  try {
    validated = validateManualTermCandidate(term);
  } catch (error) {
    throw manualCorrectionError(error);
  }

  if (scope === 'document') {
    if (!locator.documentId?.trim() && !locator.sourceLocation?.documentId.trim() && !locator.pageUrl.trim()) {
      throw new TranslationError(
        'UNSUPPORTED_PAGE',
        '无法确认当前 PDF 的稳定身份，请先用 Pi PDF 打开后再保存本文术语。',
      );
    }
    const identity = documentIdentity(locator);
    const update = await upsertDocumentTermWithReceipt(identity, validated);
    return update.termChange;
  }

  const mutation = await mutateSettings((settings) => {
    const key = correctionTermSourceKey(validated.source);
    const hasExisting = settings.academicGlossary.some(
      (entry) => correctionTermSourceKey(entry.source) === key,
    );
    if (!hasExisting && settings.academicGlossary.length >= MAX_GLOSSARY_ENTRIES) {
      throw new TranslationError(
        'INVALID_RESPONSE',
        `全局术语表已满（最多 ${MAX_GLOSSARY_ENTRIES} 条），请先在设置中整理术语。`,
      );
    }
    const updated = upsertGlossaryEntry(settings.academicGlossary, validated);
    return {
      nextSettings: { ...settings, academicGlossary: updated.entries },
      value: {
        scope: 'global' as const,
        source: validated.source,
        appliedTarget: validated.target,
        ...(updated.previousTarget !== undefined
          ? { previousTarget: updated.previousTarget }
          : {}),
      },
    };
  });
  return mutation.value;
}

async function rollbackCorrectionTerm(
  locator: DocumentIdentityInput,
  change: TranslationCorrectionTermReceipt | undefined,
): Promise<boolean> {
  if (!change) return true;
  if (change.scope === 'global') {
    const mutation = await mutateSettings((settings) => {
      const rollback = rollbackGlossaryEntry(settings.academicGlossary, change);
      if (!rollback.rolledBack) {
        return { nextSettings: null, value: false };
      }
      return {
        nextSettings: { ...settings, academicGlossary: rollback.entries },
        value: true,
      };
    });
    return mutation.value;
  }

  if (!locator.documentId?.trim() && !locator.sourceLocation?.documentId.trim() && !locator.pageUrl.trim()) {
    return false;
  }
  const identity = documentIdentity(locator);
  return (await rollbackDocumentTermChange(identity, change)).rolledBack;
}

async function compensateCorrectionTerm(
  locator: DocumentIdentityInput,
  change: TranslationCorrectionTermReceipt,
): Promise<void> {
  // A conditional rollback may return false because another tab deliberately
  // edited the same global term. That is a successful later-edit-wins outcome,
  // not a failed compensation, so it must not block translation-head rollback.
  await rollbackCorrectionTerm(locator, change);
}

type TranslationMutationCompensation = () => Promise<boolean | void>;

interface TranslationResultCommitOptions {
  assertCurrent?: () => void;
  documentUndo?: {
    termChange?: TranslationCorrectionTermReceipt | DocumentTermChangeReceipt;
    rollbackResult: TranslateResult;
  };
  preserveAlignedSegments?: boolean;
  preserveRevisionMetadata?: boolean;
  glossaryUndo?: TranslationCorrectionTermReceipt | DocumentTermChangeReceipt;
  commitSideEffect?: (commit: {
    result: TranslateResult;
    correctionReceipt: TranslationCorrectionReceipt;
  }) => Promise<void>;
}

function effectiveGlossaryForTranslationMutation(
  glossary: ScopedGlossaryTerm[],
  termScope: TranslationTermScope | undefined,
  correctionTerm: GlossaryEntry | undefined,
  undo: TranslationCorrectionTermReceipt | DocumentTermChangeReceipt | undefined,
): ScopedGlossaryTerm[] {
  let source: string | undefined;
  let replacement: ScopedGlossaryTerm | undefined;
  if (termScope && correctionTerm) {
    source = correctionTerm.source;
    replacement = { ...correctionTerm, scope: termScope };
  } else if (undo) {
    if ('scope' in undo) {
      source = undo.source;
      if (undo.previousTarget !== undefined) {
        replacement = { source: undo.source, target: undo.previousTarget, scope: undo.scope };
      }
    } else {
      source = undo.applied?.source ?? undo.previous?.source ?? undo.sourceKey;
      if (undo.previous) {
        replacement = {
          source: undo.previous.source,
          target: undo.previous.target,
          scope: 'document',
        };
      }
    }
  }
  if (!source) return glossary;
  const sourceKey = normalizeGlossaryTermKey(source);
  return [
    ...(replacement ? [replacement] : []),
    ...glossary.filter((term) => normalizeGlossaryTermKey(term.source) !== sourceKey),
  ];
}

async function compensateTranslationMutation(
  compensations: TranslationMutationCompensation[],
): Promise<boolean> {
  let complete = true;
  for (const compensate of [...compensations].reverse()) {
    try {
      if (await compensate() === false) complete = false;
    } catch (error) {
      complete = false;
      await recordLocalDiagnosticError('translate', error);
    }
  }
  return complete;
}

async function updateTranslationResultCommitted(
  payload: Extract<RuntimeMessage, { type: 'UPDATE_TRANSLATION_RESULT' }>['payload'],
  tabId: number,
  options?: TranslationResultCommitOptions,
): Promise<TranslateRuntimeResponse> {
  const compensations: TranslationMutationCompensation[] = [];
  let attemptedHead: {
    baseRequestId: string;
    nextRequestId: string;
    rootRequestId: string;
  } | undefined;
  try {
    options?.assertCurrent?.();
    await assertTranslationHead(
      tabId,
      payload.baseRequestId,
      translationResultRootRequestId(payload.result),
    );
    options?.assertCurrent?.();
    const originalText = payload.result.originalText.trim();
    const translatedText = payload.result.translatedText.trim();
    if (!originalText || !translatedText) {
      throw new TranslationError('EMPTY_SELECTION', 'The edited translation cannot be empty.');
    }
    if (originalText.length > MAX_SELECTION_LENGTH || translatedText.length > MAX_SELECTION_LENGTH * 4) {
      throw new TranslationError('SELECTION_TOO_LONG', 'The edited translation is too long.');
    }
    if (payload.previousTranslatedText !== undefined) {
      try {
        validateManualCorrectionText(payload.previousTranslatedText, translatedText);
      } catch (error) {
        throw manualCorrectionError(error);
      }
    }
    const scope: TranslationMemoryScope = payload.scope ??
      (payload.rememberForDocument ? 'document' : 'current');
    const termScope = payload.term?.scope;
    let correctionTerm: GlossaryEntry | undefined;
    if (termScope && payload.term) {
      try {
        const validated = validateManualTermCandidate(payload.term);
        correctionTerm = { source: validated.source, target: validated.target };
      } catch (error) {
        throw manualCorrectionError(error);
      }
    }
    const rootRequestId = payload.result.revision?.rootRequestId?.trim() ||
      payload.result.requestId;
    const result: TranslateResult = {
      ...payload.result,
      originalText,
      translatedText,
      warnings: payload.result.warnings ?? [],
      completedAt: Date.now(),
      cached: false,
      latencyMs: 0,
      revision: options?.preserveRevisionMetadata && payload.result.revision
        ? { ...payload.result.revision, rootRequestId, scope }
        : {
            rootRequestId,
            kind: 'manual',
            label: '手动修改',
            scope,
          },
    };
    if (!options?.preserveAlignedSegments) delete result.alignedSegments;
    const settings = await getSettings();
    options?.assertCurrent?.();
    const memoryForGlossary = await getDocumentMemory(documentIdentity(payload));
    options?.assertCurrent?.();
    const effectiveGlossary = effectiveGlossaryForTranslationMutation(
      mergeDocumentGlossaryWithScope(settings.academicGlossary, memoryForGlossary),
      termScope,
      correctionTerm,
      options?.glossaryUndo,
    );
    const evidencedResult = withGlossaryTermEvidence(result, effectiveGlossary);
    delete result.appliedGlossaryTerms;
    delete result.glossaryTermsNeedingReview;
    if (evidencedResult.appliedGlossaryTerms?.length) {
      result.appliedGlossaryTerms = evidencedResult.appliedGlossaryTerms;
    }
    if (evidencedResult.glossaryTermsNeedingReview?.length) {
      result.glossaryTermsNeedingReview = evidencedResult.glossaryTermsNeedingReview;
    }
    let termChange: TranslationCorrectionTermReceipt | undefined;
    let documentTermChange: DocumentTermChangeReceipt | undefined;
    let termRollbackSkipped = false;
    if (scope === 'document') {
      const identity = documentIdentity(payload);
      if (options?.documentUndo) {
        const restored = await restoreDocumentCorrectionIfCurrent(
          identity,
          options.documentUndo.rollbackResult,
          result,
          options.documentUndo.termChange,
        );
        termRollbackSkipped = Boolean(options.documentUndo.termChange) &&
          !restored.termRolledBack;
        if (restored.change) {
          compensations.push(async () => {
            await rollbackDocumentCorrectionChange(identity, restored.change!);
          });
        }
      } else if (termScope === 'document') {
        const remembered = await rememberDocumentCorrection(identity, result, correctionTerm);
        termChange = remembered.termChange;
        documentTermChange = remembered.change.termChange;
        compensations.push(async () => {
          await rollbackDocumentCorrectionChange(identity, remembered.change);
        });
      } else {
        termChange = await applyCorrectionTerm(payload, termScope, correctionTerm);
        if (termChange) {
          const appliedTermChange = termChange;
          compensations.push(() => compensateCorrectionTerm(payload, appliedTermChange));
        }
        const remembered = await rememberDocumentCorrection(identity, result);
        compensations.push(async () => {
          await rollbackDocumentCorrectionChange(identity, remembered.change);
        });
      }
      options?.assertCurrent?.();
    } else {
      termChange = await applyCorrectionTerm(payload, termScope, correctionTerm);
      if (termChange) {
        const appliedTermChange = termChange;
        compensations.push(() => compensateCorrectionTerm(payload, appliedTermChange));
      }
      options?.assertCurrent?.();
    }
    const correctionReceipt = {
      baseRequestId: payload.baseRequestId,
      correctedRequestId: result.requestId,
      scope,
      previousTranslation: payload.previousTranslatedText,
      correctedTranslation: result.translatedText,
      ...(termChange ? { termChange } : {}),
      ...(documentTermChange ? { documentTermChange } : {}),
    } satisfies TranslationCorrectionReceipt;
    options?.assertCurrent?.();
    attemptedHead = {
      baseRequestId: payload.baseRequestId,
      nextRequestId: result.requestId,
      rootRequestId,
    };
    const advanced = await writeTranslationHead({
      tabId,
      currentResultRequestId: result.requestId,
      rootRequestId,
    }, {
      currentResultRequestId: payload.baseRequestId,
      rootRequestId,
    });
    if (!advanced) throw staleTranslationMutationError();
    await options?.commitSideEffect?.({ result, correctionReceipt });
    compensations.length = 0;
    const historyTask = settings.rememberRecentTranslations
      ? addTranslationHistory(tabId, result, settings.historyLimit)
      : Promise.resolve([]);
    const history = await settleTranslationFinalization(
      'translate-finalization',
      historyTask,
      [clearTranslationCache(tabId)],
    );
    return {
      ok: true,
      data: {
        result,
        history,
        correctionReceipt,
        ...(termRollbackSkipped ? { termRollbackSkipped: true } : {}),
      },
    };
  } catch (error) {
    const rollbackComplete = await compensateTranslationMutation(compensations);
    if (attemptedHead && rollbackComplete) {
      try {
        const head = await readTranslationHead(tabId);
        if (head?.currentResultRequestId === attemptedHead.nextRequestId) {
          await writeTranslationHead({
            tabId,
            currentResultRequestId: attemptedHead.baseRequestId,
            rootRequestId: attemptedHead.rootRequestId,
          }, {
            currentResultRequestId: attemptedHead.nextRequestId,
            rootRequestId: attemptedHead.rootRequestId,
          });
        }
      } catch (rollbackError) {
        await recordLocalDiagnosticError('translate', rollbackError);
      }
    }
    if (error instanceof DocumentTermCapacityError) {
      return errorResponse(new TranslationError(
        'INVALID_RESPONSE',
        '本文术语表已满（最多 100 条），请先在本文侧栏中整理术语。',
      ));
    }
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

function updateTranslationResult(
  payload: Extract<RuntimeMessage, { type: 'UPDATE_TRANSLATION_RESULT' }>['payload'],
  tabId: number,
  options?: TranslationResultCommitOptions,
): Promise<TranslateRuntimeResponse> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrent = (): void => {
    assertTabLifecycleCurrent(lifecycleToken);
    options?.assertCurrent?.();
  };
  return runTranslationCommit(tabId, () =>
    updateTranslationResultCommitted(payload, tabId, {
      ...options,
      assertCurrent,
    }));
}

async function undoTranslationResultCommitted(
  payload: Extract<RuntimeMessage, { type: 'UNDO_TRANSLATION_RESULT' }>['payload'],
  tabId: number,
  options?: Pick<TranslationResultCommitOptions, 'assertCurrent' | 'commitSideEffect'>,
): Promise<TranslateRuntimeResponse> {
  try {
    options?.assertCurrent?.();
    if (
      payload.result.requestId !== payload.receipt.correctedRequestId ||
      payload.result.translatedText !== payload.receipt.correctedTranslation
    ) {
      throw new TranslationError(
        'REQUEST_ABORTED',
        '这条译文已发生变化，无法撤销旧的修正。',
      );
    }
    let restoredSegments = payload.result.alignedSegments;
    if (payload.receipt.segmentChange) {
      const change = payload.receipt.segmentChange;
      const matching = payload.result.alignedSegments?.filter(
        (segment) => segment.id === change.segmentId,
      ) ?? [];
      if (
        matching.length !== 1 ||
        matching[0]?.translatedText !== change.correctedTranslatedText
      ) {
        throw new TranslationError(
          'REQUEST_ABORTED',
          '本句对照已经变化，无法撤销旧的修正。',
        );
      }
      restoredSegments = payload.result.alignedSegments!.map((segment) => (
        segment.id === change.segmentId
          ? { ...segment, translatedText: change.previousTranslatedText }
          : segment
      ));
    }
    const restored: TranslateResult = {
      ...payload.result,
      requestId: crypto.randomUUID(),
      translatedText: payload.receipt.previousTranslation,
      ...(restoredSegments ? { alignedSegments: restoredSegments } : {}),
      completedAt: Date.now(),
      revision: {
        rootRequestId: payload.result.revision?.rootRequestId ?? payload.receipt.baseRequestId,
        kind: 'manual',
        label: '撤销修改',
        scope: 'current',
      },
    };
    const documentUndo = payload.receipt.scope === 'document';
    const response = await updateTranslationResultCommitted({
      pageUrl: payload.pageUrl,
      ...(payload.documentId ? { documentId: payload.documentId } : {}),
      ...(payload.sourceLabel ? { sourceLabel: payload.sourceLabel } : {}),
      ...(payload.sourceLocation ? { sourceLocation: payload.sourceLocation } : {}),
      result: restored,
      scope: payload.receipt.scope === 'document' ? 'document' : 'current',
      previousTranslatedText: payload.receipt.correctedTranslation,
      baseRequestId: payload.receipt.correctedRequestId,
    }, tabId, {
      ...(options?.assertCurrent ? { assertCurrent: options.assertCurrent } : {}),
      ...(options?.commitSideEffect ? { commitSideEffect: options.commitSideEffect } : {}),
      ...(payload.receipt.segmentChange ? { preserveAlignedSegments: true } : {}),
      preserveRevisionMetadata: true,
      ...(payload.receipt.termChange || payload.receipt.documentTermChange
        ? { glossaryUndo: payload.receipt.documentTermChange ?? payload.receipt.termChange }
        : {}),
      ...(documentUndo
        ? {
            documentUndo: {
              rollbackResult: payload.result,
              ...(payload.receipt.documentTermChange
                ? { termChange: payload.receipt.documentTermChange }
                : payload.receipt.termChange?.scope === 'document'
                  ? { termChange: payload.receipt.termChange }
                : {}),
            },
          }
        : {}),
    });
    if (!response.ok) return response;
    let termRollbackSkipped = Boolean(response.data.termRollbackSkipped);
    const separateTermRollback = payload.receipt.termChange && (
      !documentUndo || payload.receipt.termChange.scope === 'global'
    );
    if (separateTermRollback) {
      try {
        termRollbackSkipped = !await rollbackCorrectionTerm(payload, payload.receipt.termChange);
      } catch (error) {
        termRollbackSkipped = true;
        await recordLocalDiagnosticError('translate', error);
      }
    }
    return {
      ok: true,
      data: {
        result: response.data.result,
        history: response.data.history,
        ...(termRollbackSkipped ? { termRollbackSkipped: true } : {}),
      },
    };
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

function undoTranslationResult(
  payload: Extract<RuntimeMessage, { type: 'UNDO_TRANSLATION_RESULT' }>['payload'],
  tabId: number,
  options?: Pick<TranslationResultCommitOptions, 'assertCurrent' | 'commitSideEffect'>,
): Promise<TranslateRuntimeResponse> {
  const lifecycleToken = tabLifecycles.capture(tabId);
  const assertCurrent = (): void => {
    assertTabLifecycleCurrent(lifecycleToken);
    options?.assertCurrent?.();
  };
  return runTranslationCommit(tabId, () =>
    undoTranslationResultCommitted(payload, tabId, {
      ...options,
      assertCurrent,
    }));
}

async function updateTranslationSegment(
  payload: Extract<RuntimeMessage, { type: 'UPDATE_TRANSLATION_SEGMENT' }>['payload'],
  tabId: number,
): Promise<TranslateRuntimeResponse> {
  try {
    let correction: ReturnType<typeof applyAlignedSegmentCorrection>;
    try {
      correction = applyAlignedSegmentCorrection({
        result: payload.result,
        segmentId: payload.segmentId,
        expectedSegmentTranslation: payload.expectedTranslatedText,
        correctedSegmentTranslation: payload.correctedTranslatedText.trim(),
      });
    } catch (error) {
      if (error instanceof ManualCorrectionError) throw manualCorrectionError(error);
      if (error instanceof AlignedSegmentCorrectionError) {
        if (error.code === 'STALE_SEGMENT') {
          throw new TranslationError(
            'REQUEST_ABORTED',
            '本句译文已经变化，请重新打开修正。',
          );
        }
        throw new TranslationError(
          'INVALID_RESPONSE',
          '逐句对照已变化，无法安全定位本句；请改用整段修正。',
        );
      }
      throw error;
    }
    const edited: TranslateResult = {
      ...payload.result,
      requestId: crypto.randomUUID(),
      translatedText: correction.translatedText,
      alignedSegments: correction.alignedSegments,
      completedAt: Date.now(),
      cached: false,
      latencyMs: 0,
      revision: {
        rootRequestId: payload.result.revision?.rootRequestId ?? payload.result.requestId,
        kind: 'manual',
        label: '修正本句',
        scope: 'current',
      },
    };
    const response = await updateTranslationResult({
      pageUrl: payload.pageUrl,
      ...(payload.documentId ? { documentId: payload.documentId } : {}),
      ...(payload.sourceLabel ? { sourceLabel: payload.sourceLabel } : {}),
      ...(payload.sourceLocation ? { sourceLocation: payload.sourceLocation } : {}),
      result: edited,
      scope: 'current',
      previousTranslatedText: payload.result.translatedText,
      baseRequestId: payload.result.requestId,
    }, tabId, { preserveAlignedSegments: true, preserveRevisionMetadata: true });
    if (!response.ok) return response;
    const receipt = response.data.correctionReceipt;
    if (!receipt) {
      throw new TranslationError('INVALID_RESPONSE', '无法建立本句修正的撤销记录。');
    }
    return {
      ok: true,
      data: {
        ...response.data,
        correctionReceipt: {
          ...receipt,
          segmentChange: {
            segmentId: payload.segmentId,
            previousTranslatedText: payload.expectedTranslatedText,
            correctedTranslatedText: payload.correctedTranslatedText.trim(),
          },
        },
      },
    };
  } catch (error) {
    await recordLocalDiagnosticError('translate', error);
    return errorResponse(error);
  }
}

function pdfSessionLocator(session: PdfSidePanelSession): DocumentIdentityInput {
  return {
    pageUrl: session.pageUrl,
    sourceLabel: session.sourceLabel,
    ...(session.result?.documentId ? { documentId: session.result.documentId } : {}),
    ...(session.result?.sourceLocation ? { sourceLocation: session.result.sourceLocation } : {}),
  };
}

async function updatePdfSidePanelTranslationResultCommitted(
  payload: Extract<RuntimeMessage, { type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT' }>['payload'],
  lifecycleToken: TabLifecycleToken | undefined,
): Promise<TranslateRuntimeResponse> {
  if (pdfSidePanelCorrectionClaims.has(payload.tabId)) {
    return errorResponse(new TranslationError(
      'REQUEST_ABORTED',
      '另一项 PDF 译文修正仍在保存，请稍后再试。',
    ));
  }
  const claim = crypto.randomUUID();
  pdfSidePanelCorrectionClaims.set(payload.tabId, claim);
  try {
    const session = pdfSidePanelSessions.get(payload.tabId);
    const assertCurrent = (): void => {
      assertTabLifecycleCurrent(lifecycleToken);
      const current = pdfSidePanelSessions.get(payload.tabId);
      if (
        pdfSidePanelCorrectionClaims.get(payload.tabId) !== claim ||
        !current ||
        current.requestId !== payload.expectedRequestId ||
        current.status !== 'complete' ||
        current.result?.requestId !== payload.expectedResultRequestId
      ) {
        throw new TranslationError(
          'REQUEST_ABORTED',
          '当前 PDF 或译文已经变化，请重新打开修正。',
        );
      }
    };
    assertCurrent();
    const currentResult = session?.result;
    if (!session || !currentResult) {
      throw new TranslationError('REQUEST_ABORTED', '当前 PDF 或译文已经变化，请重新打开修正。');
    }
    const edited: TranslateResult = {
      ...currentResult,
      requestId: crypto.randomUUID(),
      translatedText: payload.translatedText.trim(),
      completedAt: Date.now(),
      cached: false,
      latencyMs: 0,
      revision: {
        rootRequestId: currentResult.revision?.rootRequestId ?? currentResult.requestId,
        kind: 'manual',
        label: '手动修改',
        scope: payload.scope,
      },
    };
    delete edited.alignedSegments;
    const response = await updateTranslationResultCommitted({
      ...pdfSessionLocator(session),
      result: edited,
      scope: payload.scope,
      previousTranslatedText: currentResult.translatedText,
      baseRequestId: currentResult.requestId,
      ...(payload.term ? { term: payload.term } : {}),
    }, session.tabId, {
      assertCurrent,
      commitSideEffect: async ({ result, correctionReceipt }) => {
        assertCurrent();
        const current = pdfSidePanelSessions.get(session.tabId);
        if (!current) throw staleTranslationMutationError();
        await publishPdfSidePanelSessionDurably({
          ...current,
          result,
          partialText: result.translatedText,
          correctionReceipt,
        }, assertCurrent);
      },
    });
    if (!response.ok) return response;
    return response;
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (pdfSidePanelCorrectionClaims.get(payload.tabId) === claim) {
      pdfSidePanelCorrectionClaims.delete(payload.tabId);
    }
  }
}

async function updatePdfSidePanelTranslationResult(
  payload: Extract<RuntimeMessage, { type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT' }>['payload'],
): Promise<TranslateRuntimeResponse> {
  const lifecycleToken = tabLifecycles.capture(payload.tabId);
  await initializePdfSidePanelSessions();
  return runTranslationCommit(payload.tabId, () =>
    updatePdfSidePanelTranslationResultCommitted(payload, lifecycleToken));
}

async function undoPdfSidePanelTranslationResultCommitted(
  payload: Extract<RuntimeMessage, { type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT' }>['payload'],
  lifecycleToken: TabLifecycleToken | undefined,
): Promise<TranslateRuntimeResponse> {
  if (pdfSidePanelCorrectionClaims.has(payload.tabId)) {
    return errorResponse(new TranslationError(
      'REQUEST_ABORTED',
      '另一项 PDF 译文修正仍在保存，请稍后再试。',
    ));
  }
  const claim = crypto.randomUUID();
  pdfSidePanelCorrectionClaims.set(payload.tabId, claim);
  try {
    const session = pdfSidePanelSessions.get(payload.tabId);
    const assertCurrent = (): void => {
      assertTabLifecycleCurrent(lifecycleToken);
      const current = pdfSidePanelSessions.get(payload.tabId);
      if (
        pdfSidePanelCorrectionClaims.get(payload.tabId) !== claim ||
        !current ||
        current.requestId !== payload.expectedRequestId ||
        current.status !== 'complete' ||
        current.result?.requestId !== payload.expectedResultRequestId ||
        current.correctionReceipt?.correctedRequestId !== payload.expectedCorrectedRequestId
      ) {
        throw new TranslationError('REQUEST_ABORTED', '没有可撤销的 PDF 译文修正。');
      }
    };
    assertCurrent();
    if (!session?.result || !session.correctionReceipt) {
      throw new TranslationError('REQUEST_ABORTED', '没有可撤销的 PDF 译文修正。');
    }
    const response = await undoTranslationResultCommitted({
      ...pdfSessionLocator(session),
      result: session.result,
      receipt: session.correctionReceipt,
    }, session.tabId, {
      assertCurrent,
      commitSideEffect: async ({ result }) => {
        assertCurrent();
        const current = pdfSidePanelSessions.get(session.tabId);
        if (!current) throw staleTranslationMutationError();
        const { correctionReceipt: _receipt, ...withoutReceipt } = current;
        await publishPdfSidePanelSessionDurably({
          ...withoutReceipt,
          result,
          partialText: result.translatedText,
        }, assertCurrent);
      },
    });
    if (!response.ok) return response;
    return response;
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (pdfSidePanelCorrectionClaims.get(payload.tabId) === claim) {
      pdfSidePanelCorrectionClaims.delete(payload.tabId);
    }
  }
}


async function undoPdfSidePanelTranslationResult(
  payload: Extract<RuntimeMessage, { type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT' }>['payload'],
): Promise<TranslateRuntimeResponse> {
  const lifecycleToken = tabLifecycles.capture(payload.tabId);
  await initializePdfSidePanelSessions();
  return runTranslationCommit(payload.tabId, () =>
    undoPdfSidePanelTranslationResultCommitted(payload, lifecycleToken));
}

function validateImagePayload(
  request: Pick<TranslateImageRegionRequest, 'imageDataUrl' | 'imageWidth' | 'imageHeight'>,
): void {
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

function validateImageRegionRequest(request: TranslateImageRegionRequest): void {
  validateImagePayload(request);
}

async function recognizePdfPage(
  request: RecognizePdfPageRequest,
  tabId: number,
): Promise<RecognizePdfPageResponse> {
  const performanceStartedAt = performance.now();
  const performanceTimings: Partial<Record<PerformancePhase, number>> = {};
  const captureMs = safePerformanceDuration(request.clientPerformance?.captureMs);
  if (captureMs !== undefined) performanceTimings.captureMs = captureMs;
  let performanceError: unknown;
  const controller = beginActiveRequest(tabId, request.requestId);
  try {
    validateImagePayload(request);
    if (!Number.isInteger(request.pageNumber) || request.pageNumber < 1) {
      throw new TranslationError('IMAGE_REGION_INVALID', 'The PDF page number is invalid.');
    }
    const settings = await getSettings();
    assertActiveRequest(tabId, request.requestId, controller);
    const profile = settings.apiProfiles.find(
      (candidate) => candidate.id === settings.visionApiProfileId,
    ) ?? settings.apiProfiles.find(
      (candidate) => candidate.id === settings.activeApiProfileId,
    );
    if (!profile) {
      throw new TranslationError('VISION_NOT_CONFIGURED', 'Configure a Qwen API profile first.');
    }
    const apiKey = await getApiKey(profile.id);
    assertActiveRequest(tabId, request.requestId, controller);
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', `Configure an API Key for ${profile.name} first.`);
    }
    const permission = apiOriginPattern(profile.apiBaseUrl);
    if (!await browser.permissions.contains({ origins: [permission] })) {
      throw new TranslationError('API_PERMISSION_REQUIRED', `Permission for ${permission} is required.`);
    }
    assertActiveRequest(tabId, request.requestId, controller);
    const providerStartedAt = performance.now();
    performanceTimings.preflightMs = Math.max(0, providerStartedAt - performanceStartedAt);
    const page = await (async () => {
      try {
        return await recognizeQwenPdfPage(
          request,
          settings.visionModel.trim() || profile.model,
          { apiKey, apiBaseUrl: profile.apiBaseUrl },
          controller.signal,
        );
      } finally {
        performanceTimings.providerMs = Math.max(
          0,
          performance.now() - providerStartedAt,
        );
      }
    })();
    assertActiveRequest(tabId, request.requestId, controller);
    return { ok: true, data: { page } };
  } catch (error) {
    performanceError = error;
    performanceTimings.preflightMs ??= Math.max(0, performance.now() - performanceStartedAt);
    await recordLocalDiagnosticError('recognize-pdf-page', error);
    return errorResponse(error);
  } finally {
    performanceTimings.totalMs = Math.max(0, performance.now() - performanceStartedAt);
    void recordLocalPerformanceSample({
      operation: 'recognize-pdf-page',
      timings: performanceTimings,
      ...(performanceError
        ? { errorCode: toTranslationError(performanceError).code }
        : {}),
    });
    const current = activeRequests.get(tabId);
    if (current?.requestId === request.requestId) activeRequests.delete(tabId);
  }
}

async function translateImageRegion(
  request: TranslateImageRegionRequest,
  tabId: number,
  progressTarget: TranslationProgressTarget,
): Promise<TranslateRuntimeResponse> {
  const performanceStartedAt = performance.now();
  const performanceTimings: Partial<Record<PerformancePhase, number>> = {};
  const captureMs = safePerformanceDuration(request.clientPerformance?.captureMs);
  const queueMs = safePerformanceDuration(request.clientPerformance?.queueMs);
  if (captureMs !== undefined) performanceTimings.captureMs = captureMs;
  if (queueMs !== undefined) performanceTimings.queueMs = queueMs;
  let performanceError: unknown;
  let performanceRecorded = false;
  const finishPerformance = (): void => {
    if (performanceRecorded) return;
    performanceRecorded = true;
    performanceTimings.totalMs = Math.max(0, performance.now() - performanceStartedAt);
    void recordLocalPerformanceSample({
      operation: 'translate-image-region',
      timings: performanceTimings,
      ...(performanceError
        ? { errorCode: toTranslationError(performanceError).code }
        : {}),
    });
  };
  const lifecycleToken = tabLifecycles.capture(tabId);
  await runTranslationCommit(tabId, () => undefined);
  if (!tabLifecycles.isCurrent(lifecycleToken)) {
    performanceError = new TranslationError('REQUEST_ABORTED', 'The source tab changed.', false);
    performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
    finishPerformance();
    return errorResponse(staleTranslationMutationError(
      '页面已经关闭或跳转，旧的框选翻译没有启动。',
    ));
  }
  const controller = beginActiveRequest(tabId, request.requestId);
  pendingTranslationRequests.set(tabId, request.requestId);
  const assertCurrentRequest = (): void => {
    assertTabLifecycleCurrent(lifecycleToken);
    assertActiveRequest(tabId, request.requestId, controller);
  };
  let progressDeliveryTail: Promise<void> = Promise.resolve();
  const queueProgress = (payload: TranslationProgressPayload): void => {
    progressDeliveryTail = progressDeliveryTail.then(() => {
      if (!tabLifecycles.isCurrent(lifecycleToken)) return;
      if (activeRequests.get(tabId)?.controller !== controller) return;
      return publishTranslationProgress(tabId, payload, progressTarget);
    });
  };
  try {
    validateImageRegionRequest(request);
    // A region request represents different source content and cannot resume a
    // text checkpoint. Clear it without ever storing the captured image.
    await clearTranslationCheckpoint(tabId);
    assertActiveRequest(tabId, request.requestId, controller);
    const settings = await getSettings();
    assertActiveRequest(tabId, request.requestId, controller);
    const identity = documentIdentity(request);
    const documentMemory = await getDocumentMemory(identity);
    assertActiveRequest(tabId, request.requestId, controller);
    const scopedGlossary = mergeDocumentGlossaryWithScope(
      settings.academicGlossary,
      documentMemory,
    );
    const glossary = scopedGlossary.map(({ source, target }) => ({ source, target }));
    const configuredVisionProfile = settings.apiProfiles.find(
      (candidate) => candidate.id === settings.visionApiProfileId,
    );
    const profile = configuredVisionProfile ?? settings.apiProfiles.find(
      (candidate) => candidate.id === settings.activeApiProfileId,
    );
    const visionModel = configuredVisionProfile && settings.visionModel.trim()
      ? settings.visionModel.trim()
      : profile?.model.trim() ?? '';
    const autoSelectedVisionProfile = !configuredVisionProfile || !settings.visionModel.trim();
    if (!profile || !visionModel) {
      throw new TranslationError(
        'VISION_NOT_CONFIGURED',
        'Configure an API profile and model in extension settings first.',
      );
    }
    const sourceHost = sourceHostForRequest(request);
    const cacheKey = await imageRegionCacheKey(request, {
      apiBaseUrl: profile.apiBaseUrl,
      model: visionModel,
      glossary,
    });
    assertActiveRequest(tabId, request.requestId, controller);
    if (settings.enableSessionCache && !request.bypassCache && !request.revision) {
      const cached = await getCachedImageRegionTranslation(
        tabId,
        cacheKey,
        request.requestId,
        sourceHost,
        request.sourceLocation,
      );
      assertActiveRequest(tabId, request.requestId, controller);
      if (cached) {
        const evidencedCached = withGlossaryTermEvidence(cached, scopedGlossary);
        performanceTimings.preflightMs = Math.max(0, performance.now() - performanceStartedAt);
        queueProgress({
          requestId: request.requestId,
          completedChunks: 1,
          totalChunks: 1,
          progressStage: 'committing',
        });
        await progressDeliveryTail;
        assertActiveRequest(tabId, request.requestId, controller);
        const commitStartedAt = performance.now();
        const finalization = startCommittedTask(
          (operation) => runTranslationCommit(tabId, operation),
          async () => {
            assertActiveRequest(tabId, request.requestId, controller);
            await commitTranslationResultState(tabId, evidencedCached, assertCurrentRequest);
            performanceTimings.commitMs = Math.max(0, performance.now() - commitStartedAt);
          },
          async () => {
            const maintenanceStartedAt = performance.now();
            const history = await settleTranslationFinalization(
              'translate-image-region-finalization',
              settings.rememberRecentTranslations
                ? addTranslationHistory(tabId, evidencedCached, settings.historyLimit)
                : Promise.resolve([]),
              [rememberDocumentTranslation(identity, evidencedCached)],
            );
            performanceTimings.maintenanceMs = Math.max(
              0,
              performance.now() - maintenanceStartedAt,
            );
            return history;
          },
        );
        await finalization.committed;
        await publishTranslationProgress(tabId, {
          requestId: request.requestId,
          partialText: evidencedCached.translatedText,
          completedChunks: 1,
          totalChunks: 1,
          result: evidencedCached,
        }, progressTarget);
        const history = await finalization.finished;
        assertActiveRequest(tabId, request.requestId, controller);
        return { ok: true, data: { result: evidencedCached, history } };
      }
    }
    const apiKey = await getApiKey(profile.id);
    assertActiveRequest(tabId, request.requestId, controller);
    if (!apiKey) {
      throw new TranslationError('NO_API_KEY', `Configure an API Key for ${profile.name} first.`);
    }
    const apiPermission = apiOriginPattern(profile.apiBaseUrl);
    const permissionGranted = await browser.permissions.contains({ origins: [apiPermission] });
    assertActiveRequest(tabId, request.requestId, controller);
    if (!permissionGranted) {
      throw new TranslationError(
        'API_PERMISSION_REQUIRED',
        `Permission for ${apiPermission} is required.`,
      );
    }
    queueProgress({
      requestId: request.requestId,
      completedChunks: 0,
      totalChunks: 1,
      progressStage: 'provider',
    });
    const startedAt = performance.now();
    performanceTimings.preflightMs = Math.max(0, startedAt - performanceStartedAt);
    let lastPartial = '';
    let lastProgressAt = 0;
    const providerResult = await (async () => {
      try {
        return await translator.translateImageRegion(
          {
            imageDataUrl: request.imageDataUrl,
            imageWidth: request.imageWidth,
            imageHeight: request.imageHeight,
            ...(request.recognizedTextHint
              ? { recognizedTextHint: request.recognizedTextHint }
              : {}),
          },
          {
            model: visionModel,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            style: request.style,
            glossary,
          },
          { apiKey, apiBaseUrl: profile.apiBaseUrl },
          controller.signal,
          settings.enableStreaming
            ? {
                onPartialText: (partialText) => {
                  if (activeRequests.get(tabId)?.controller !== controller) return;
                  if (!partialText || partialText === lastPartial) return;
                  const now = performance.now();
                  performanceTimings.providerFirstOutputMs ??= Math.max(0, now - startedAt);
                  if (lastProgressAt > 0 && now - lastProgressAt < 80) return;
                  lastPartial = partialText;
                  lastProgressAt = now;
                  queueProgress({
                    requestId: request.requestId,
                    partialText,
                    completedChunks: 0,
                    totalChunks: 1,
                  });
                },
              }
            : undefined,
        );
      } finally {
        performanceTimings.providerMs = Math.max(0, performance.now() - startedAt);
      }
    })();
    assertActiveRequest(tabId, request.requestId, controller);
    const maintainVisionProfile = (): Promise<void> => autoSelectedVisionProfile
      ? mutateSettings((latestSettings) => {
          const profileStillAvailable = latestSettings.apiProfiles.some(
            (candidate) => candidate.id === profile.id,
          );
          if (!latestSettings.visionApiProfileId && profileStillAvailable) {
            return {
              nextSettings: {
                ...latestSettings,
                visionApiProfileId: profile.id,
                visionModel,
              },
              value: undefined,
            };
          }
          return { nextSettings: null, value: undefined };
        }).then(() => undefined)
      : Promise.resolve();
    const result = withGlossaryTermEvidence({
      requestId: request.requestId,
      documentId: identity.documentId,
      originalText: providerResult.recognizedText,
      translatedText: providerResult.translatedText,
      warnings: [],
      ...(providerResult.uncertainSpans.length
        ? { uncertainSpans: providerResult.uncertainSpans }
        : {}),
      ...(providerResult.formulaLatex.length
        ? { formulaLatex: providerResult.formulaLatex }
        : {}),
      ...(providerResult.formulaNeedsReview ? { formulaNeedsReview: true } : {}),
      ...(request.revision?.formulaLatex?.length
        ? { formulaLatex: request.revision.formulaLatex }
        : {}),
      ...(request.revision?.uncertainSpans?.length
        ? { uncertainSpans: request.revision.uncertainSpans }
        : {}),
      ...(request.revision?.formulaNeedsReview ? { formulaNeedsReview: true } : {}),
      ...(sourceHost ? { sourceHost } : {}),
      sourceKind: 'image-region',
      ...(request.sourceLocation ? { sourceLocation: request.sourceLocation } : {}),
      targetLanguage: request.targetLanguage,
      style: request.style,
      completedAt: Date.now(),
      cached: false,
      latencyMs: Math.round(performance.now() - startedAt),
      contextUsed: false,
      chunkCount: 1,
      ...(request.revision
        ? {
            revision: {
              rootRequestId: request.revision.rootRequestId,
              kind: request.revision.kind,
              label: request.revision.label,
              scope: request.revision.scope ?? 'current',
            },
          }
        : {}),
    }, scopedGlossary);
    queueProgress({
      requestId: request.requestId,
      completedChunks: 1,
      totalChunks: 1,
      progressStage: 'committing',
    });
    await progressDeliveryTail;
    assertActiveRequest(tabId, request.requestId, controller);
    const commitStartedAt = performance.now();
    const finalization = startCommittedTask(
      (operation) => runTranslationCommit(tabId, operation),
      async () => {
        assertActiveRequest(tabId, request.requestId, controller);
        await commitTranslationResultState(tabId, result, assertCurrentRequest);
        performanceTimings.commitMs = Math.max(0, performance.now() - commitStartedAt);
      },
      async () => {
        const maintenanceStartedAt = performance.now();
        const history = await settleTranslationFinalization(
          'translate-image-region-finalization',
          settings.rememberRecentTranslations
            ? addTranslationHistory(tabId, result, settings.historyLimit)
            : Promise.resolve([]),
          [
            settings.enableSessionCache
              ? cacheImageRegionTranslation(tabId, cacheKey, result)
              : Promise.resolve(),
            maintainVisionProfile(),
            !request.revision || request.revision.scope === 'document'
              ? rememberDocumentTranslation(identity, result)
              : Promise.resolve(),
          ],
        );
        performanceTimings.maintenanceMs = Math.max(
          0,
          performance.now() - maintenanceStartedAt,
        );
        return history;
      },
    );
    await finalization.committed;
    queueProgress({
      requestId: request.requestId,
      partialText: result.translatedText,
      completedChunks: 1,
      totalChunks: 1,
      result,
    });
    await progressDeliveryTail;
    assertActiveRequest(tabId, request.requestId, controller);
    const history = await finalization.finished;
    assertActiveRequest(tabId, request.requestId, controller);
    return { ok: true, data: { result, history } };
  } catch (error) {
    performanceError = error;
    performanceTimings.preflightMs ??= Math.max(0, performance.now() - performanceStartedAt);
    await progressDeliveryTail.catch(() => undefined);
    await recordLocalDiagnosticError('translate-image-region', error);
    return errorResponse(error);
  } finally {
    finishPerformance();
    const current = activeRequests.get(tabId);
    if (current?.requestId === request.requestId) activeRequests.delete(tabId);
    if (pendingTranslationRequests.get(tabId) === request.requestId) {
      pendingTranslationRequests.delete(tabId);
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
    return errorResponse<{
      connected: true;
      sampleSource: string;
      sampleTranslation: string;
    }>(
      new TranslationError('NO_API_KEY', 'Configure an API Key first.'),
    );
  }
  const controller = new AbortController();
  try {
    const sampleTranslation = await translator.testConnection(
      { model },
      { apiKey, apiBaseUrl },
      controller.signal,
    );
    return {
      ok: true,
      data: {
        connected: true,
        sampleSource: CONNECTION_SAMPLE_SOURCE,
        sampleTranslation,
      },
    };
  } catch (error) {
    await recordLocalDiagnosticError('test-connection', error);
    return errorResponse<{
      connected: true;
      sampleSource: string;
      sampleTranslation: string;
    }>(error);
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
    if (message.type === 'OPEN_SIDEBAR' || message.type === 'START_WEB_REGION_SELECTION') {
      throw new TranslationError(
        'UNSUPPORTED_PAGE',
        'Enable ordinary web page support before using this action.',
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

async function bilingualPageTab(tabId: number): Promise<{
  id: number;
  url: string;
}> {
  const tab = await browser.tabs.get(tabId);
  if (
    tab.id === undefined ||
    !tab.url ||
    !isInjectableWebUrl(tab.url) ||
    isOverleafProjectUrl(tab.url) ||
    isEdgeNativePdfContext({ tabUrl: tab.url })
  ) {
    throw new TranslationError(
      'UNSUPPORTED_PAGE',
      '正文双语阅读仅支持普通网页，不会修改 Overleaf 编辑区或 PDF。',
      false,
    );
  }
  const settings = await getSettings();
  if (settings.generalPageMode === 'off') {
    throw new TranslationError(
      'UNSUPPORTED_PAGE',
      '请先在设置中启用普通网页翻译。',
      false,
    );
  }
  return { id: tab.id, url: tab.url };
}

async function currentBilingualPageSessionBehaviorKey(): Promise<string> {
  return bilingualPageSessionBehaviorKey(
    translationBehaviorFingerprint(await getSettings()),
  );
}

async function startBilingualPage(
  tabId: number,
  targetLanguage: SupportedTargetLanguage,
): Promise<BilingualPageStateResponse> {
  try {
    const tab = await bilingualPageTab(tabId);
    await sendToSelectionContentScript(tab, {
      type: 'START_BILINGUAL_PAGE_IN_TAB',
      payload: { targetLanguage },
    });
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'GET_BILINGUAL_PAGE_STATE_IN_TAB',
    } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
    if (!response) throw new Error('The page translator did not respond.');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

async function getBilingualPageState(tabId: number): Promise<BilingualPageStateResponse> {
  try {
    const tab = await bilingualPageTab(tabId);
    const stateMessage = {
      type: 'GET_BILINGUAL_PAGE_STATE_IN_TAB',
    } satisfies RuntimeMessage;
    const requestState = () => browser.tabs.sendMessage(
      tabId,
      stateMessage,
    ) as Promise<BilingualPageStateResponse | undefined>;
    let response: BilingualPageStateResponse | undefined;
    try {
      response = await requestState();
    } catch {
      // The current tab has not used Pi Translator yet in on-demand mode.
    }
    if (!response) {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: [GENERAL_CONTENT_SCRIPT_FILE],
      });
      response = await requestState();
    }
    return response ?? {
      ok: true,
      data: {
        state: {
          phase: 'idle',
          total: 0,
          translated: 0,
          failed: 0,
          translationsHidden: false,
        },
      },
    };
  } catch (error) {
    const normalized = toTranslationError(error);
    if (normalized.code === 'UNSUPPORTED_PAGE') return errorResponse(normalized);
    return {
      ok: true,
      data: {
        state: {
          phase: 'idle',
          total: 0,
          translated: 0,
          failed: 0,
          translationsHidden: false,
        },
      },
    };
  }
}

async function getBilingualPageExport(tabId: number): Promise<BilingualPageExportResponse> {
  try {
    await bilingualPageTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'GET_BILINGUAL_PAGE_EXPORT_IN_TAB',
    } satisfies RuntimeMessage) as BilingualPageExportResponse | undefined;
    if (!response) throw new Error('The page translator did not respond.');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

async function controlBilingualPage(
  tabId: number,
  action: BilingualPageAction,
): Promise<BilingualPageStateResponse> {
  try {
    await bilingualPageTab(tabId);
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'CONTROL_BILINGUAL_PAGE_IN_TAB',
      payload: { action },
    } satisfies RuntimeMessage) as BilingualPageStateResponse | undefined;
    if (!response) throw new Error('The page translator did not respond.');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

async function sendContextMenuTranslationToWebPage(
  tab: { id?: number | undefined; url?: string | undefined },
  snapshot: ReturnType<typeof createContextMenuSnapshot>,
  frameId?: number,
): Promise<void> {
  if (tab.id === undefined || !tab.url) return;
  const targetFrameId = frameId !== undefined && frameId >= 0 ? frameId : 0;
  const message = {
    type: 'CONTEXT_MENU_TRANSLATE',
    payload: snapshot,
  } satisfies RuntimeMessage;
  const sendToTargetFrame = () => browser.tabs.sendMessage(
    tab.id!,
    message,
    { frameId: targetFrameId },
  );
  if (isOverleafProjectUrl(tab.url) && targetFrameId === 0) {
    await sendToTargetFrame();
    return;
  }
  try {
    await sendToTargetFrame();
    return;
  } catch {
    // The top-level Overleaf translator deliberately does not run in every
    // frame. Inject the compact on-demand translator only into the frame that
    // produced the context-menu selection, then address that frame precisely.
  }
  const frameUrl = snapshot.pageUrl;
  if (!isInjectableWebUrl(frameUrl)) {
    if (isOverleafProjectUrl(tab.url) && targetFrameId !== 0) {
      await browser.tabs.sendMessage(tab.id, message, { frameId: 0 });
      return;
    }
    throw new Error('The selected frame cannot host a content script.');
  }
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [targetFrameId] },
      files: [GENERAL_CONTENT_SCRIPT_FILE],
    });
    await browser.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_MENU_TRANSLATE',
      payload: snapshot,
    } satisfies RuntimeMessage, { frameId: targetFrameId });
  } catch (error) {
    if (isOverleafProjectUrl(tab.url) && targetFrameId !== 0) {
      // Protected/blob preview frames cannot be injected. The top-level
      // Overleaf script can still translate the browser-provided selectionText
      // exactly once, although it cannot recover the child frame's rectangle.
      await browser.tabs.sendMessage(tab.id, message, { frameId: 0 });
      return;
    }
    throw error;
  }
}

export default defineBackground(() => {
  const configurationRevisionBarrier = new ConfigurationRevisionBarrier({
    apply: async (revision) => {
      if (!revision.invalidatesTranslationState) return;
      for (const active of activeRequests.values()) active.controller.abort();
      activeRequests.clear();
      await Promise.all([
        clearTranslationCheckpoint(),
        clearBilingualPageSession(),
      ]);
    },
  });
  void restrictSensitiveStorageAccess();
  // Reconcile a commit that occurred while the MV3 worker was stopped. The
  // applied id in storage.session makes this idempotent across worker restarts.
  void configurationRevisionBarrier.applyCurrent().catch(() => undefined);
  void synchronizeContextMenu();
  void initializePdfSidePanelSessions()
    .then(() => queuePdfSidePanelOptionsSync())
    .catch(() => undefined);
  scheduleGeneralPageAccessSync();

  browser.runtime.onInstalled.addListener((details) => {
    void synchronizeContextMenu();
    scheduleGeneralPageAccessSync();
    // Favorites were removed from the product UI. Delete the now-inaccessible
    // legacy records on upgrade instead of retaining hidden page content.
    void browser.storage.local.remove(LEGACY_FAVORITES_KEY);
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onStartup.addListener(() => {
    void synchronizeContextMenu();
    void initializePdfSidePanelSessions()
      .then(() => queuePdfSidePanelOptionsSync())
      .catch(() => undefined);
    scheduleGeneralPageAccessSync();
  });

  browser.action.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    const revision = configurationRevisionFromStorageChange(areaName, changes);
    if (revision) {
      void configurationRevisionBarrier.observe(revision).catch(() => undefined);
    }
    if (areaName === 'local' && 'extensionSettings' in changes) {
      void synchronizeContextMenu();
      scheduleGeneralPageAccessSync();
      void queuePdfSidePanelOptionsSync().catch(() => undefined);
      void broadcastPublicSettings();
      const next = changes.extensionSettings?.newValue as
        | { rememberRecentTranslations?: boolean; enableSessionCache?: boolean }
        | undefined;
      if (next?.rememberRecentTranslations === false) {
        void clearTranslationHistory();
      }
      if (next?.enableSessionCache === false) {
        void clearTranslationCache();
        void clearImageRegionTranslationCache();
      }
    }
    if (areaName === 'session' && 'pausedSiteHosts' in changes) {
      void broadcastPublicSettings();
    }
  });

  getNativeChromeApi()?.contextMenus?.onShown?.addListener((info, tab) => {
    if (!info.contexts.includes('selection')) return;
    const contextUrls = {
      ...(tab?.url ? { tabUrl: tab.url } : {}),
      ...(info.pageUrl ? { pageUrl: info.pageUrl } : {}),
      ...(info.frameUrl ? { frameUrl: info.frameUrl } : {}),
    };
    if (!isEdgeNativePdfContext(contextUrls)) return;
    if (
      [contextUrls.tabUrl, contextUrls.pageUrl, contextUrls.frameUrl]
        .some((url) => isExtensionPdfReaderUrl(url, PI_PDF_READER_URL))
    ) {
      return;
    }
    const target = immediatePdfSidePanelTab(tab);
    if (target?.id === undefined || target.id < 0) return;
    // Edge exposes the native viewer context here before the user chooses a
    // menu item. This is the last reliable opportunity to clear a stale
    // tab-specific `enabled: false` override without consuming the click's
    // user gesture.
    void setPdfSidePanelEnabled(target.id, true).catch((error: unknown) => {
      void recordLocalDiagnosticError('open-pdf-side-panel', error);
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;

    const eventContextUrls = {
      ...(tab?.url ? { tabUrl: tab.url } : {}),
      ...(info.pageUrl ? { pageUrl: info.pageUrl } : {}),
      ...(info.frameUrl ? { frameUrl: info.frameUrl } : {}),
    };
    if (
      [eventContextUrls.tabUrl, eventContextUrls.pageUrl, eventContextUrls.frameUrl]
        .some((url) => isExtensionPdfReaderUrl(url, PI_PDF_READER_URL))
    ) {
      // Pi PDF owns its compact in-page translator. Forward the selection to
      // that page and never re-enable Edge's native side panel for this tab.
      if (info.selectionText?.trim() && tab?.url) {
        const snapshot = createContextMenuSnapshot(info.selectionText, tab.url);
        void browser.runtime.sendMessage({
          type: 'CONTEXT_MENU_TRANSLATE',
          payload: snapshot,
        } satisfies RuntimeMessage).catch(() => undefined);
      }
      return;
    }

    if (
      tab?.id !== undefined &&
      tab.id >= 0 &&
      isEdgeNativePdfContext(eventContextUrls)
    ) {
      const sourceUrl = edgePdfSourceUrl(eventContextUrls);
      const userGestureOpenPromise = beginPdfSidePanelOpenFromUserGesture(tab);
      openPdfTranslationSidePanel(
        { id: tab.id, windowId: tab.windowId },
        info.selectionText,
        sourceUrl,
        pdfPageFromContext(eventContextUrls, sourceUrl),
        userGestureOpenPromise,
      );
      return;
    }

    if (shouldOpenEdgePdfSidePanelImmediately(
      eventContextUrls,
      tab?.id,
      tab?.windowId,
    )) {
      const nativeChrome = getNativeChromeApi();
      // Invoke open() before any query/await. Edge requires sidePanel.open() to
      // run directly from the context-menu user gesture. The PDF tab itself was
      // enabled earlier by queuePdfSidePanelOptionsSync().
      const userGestureOpenPromise = beginPdfSidePanelOpenFromUserGesture(tab);
      if (!userGestureOpenPromise) {
        publishPdfSidePanelTargetError(undefined, edgePdfSourceUrl(eventContextUrls));
        return;
      }
      const handleCandidateTabs = (candidateTabs: Array<{
        id?: number | undefined;
        windowId?: number | undefined;
        url?: string | undefined;
      }>) => {
        const resolvedTab = resolvePdfContextTab(candidateTabs, eventContextUrls);
        if (
          resolvedTab?.id === undefined ||
          resolvedTab.id < 0 ||
          resolvedTab.windowId < 0
        ) {
          const onlyCandidate = candidateTabs.length === 1 &&
            candidateTabs[0]?.id !== undefined &&
            candidateTabs[0].id >= 0
            ? candidateTabs[0]
            : undefined;
          publishPdfSidePanelTargetError(
            onlyCandidate?.id,
            edgePdfSourceUrl(eventContextUrls),
          );
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
          userGestureOpenPromise,
        );
      };
      const query = { active: true, lastFocusedWindow: true } as const;
      if (nativeChrome?.tabs) {
        nativeChrome.tabs.query(query, handleCandidateTabs);
      } else {
        void browser.tabs.query(query).then(handleCandidateTabs).catch((error: unknown) => {
          void recordLocalDiagnosticError('resolve-pdf-context-tab', error);
          publishPdfSidePanelTargetError(undefined, edgePdfSourceUrl(eventContextUrls));
        });
      }
      return;
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
        resolvedTab = resolvePdfContextTab(
          await browser.tabs.query({ active: true, lastFocusedWindow: true }),
          eventContextUrls,
        );
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
      const selectionPageUrl = info.frameUrl ?? info.pageUrl ?? resolvedTab.url;
      const snapshot = createContextMenuSnapshot(info.selectionText, selectionPageUrl);
      await sendContextMenuTranslationToWebPage(
        resolvedTab,
        snapshot,
        info.frameId,
      ).catch((error: unknown) => {
        // Some PDF endpoints keep their original HTTPS URL instead of exposing
        // the internal viewer URL. Failed injection is therefore treated as a
        // protected-document fallback and rendered in the native side panel.
        console.warn('Falling back to the side panel for a protected selection.', error);
        openPdfTranslationSidePanel(
          activeTab,
          info.selectionText,
          sourceUrl ?? selectionPageUrl,
          pageNumber,
        );
      });
    })().catch((error: unknown) => {
      void recordLocalDiagnosticError('translate-context-menu-selection', error);
    });
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'translate-selection' || tab?.id === undefined) return;
    const recovery = reopenExistingPdfSidePanelFromUserGesture(
      tab,
      (tabId) => (
        // On a cold MV3 service-worker start, storage restoration can still be
        // pending when the keyboard gesture arrives. The command grants
        // activeTab access, so the PDF URL is available synchronously and lets
        // us call open() before the user-gesture window closes.
        !piPdfReaderTabIds.has(tabId) && (
          pdfSidePanelSessions.has(tabId) ||
          isEdgePdfSidePanelTab(tab.url, PI_PDF_READER_URL)
        )
      ),
      beginPdfSidePanelOpenFromUserGesture,
    );
    if (recovery.matchedSession) {
      // Do not await or query tabs before open(): Edge only accepts this call
      // while the keyboard command's user gesture is still active.
      if (!recovery.openPromise) {
        void browser.action.setBadgeBackgroundColor({ color: '#b4233b' });
        void browser.action.setBadgeText({ tabId: tab.id, text: '!' });
        void browser.action.setTitle({
          tabId: tab.id,
          title: '当前 Edge 版本未提供侧边栏接口',
        });
        return;
      }
      void recovery.openPromise.then(
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
            title: 'PDF 侧边栏恢复失败，请重新加载扩展后重试',
          });
        },
      );
      return;
    }
    void sendToSelectionContentScript(tab, {
      type: 'TRIGGER_TRANSLATE',
    }).catch(() => undefined);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabLifecycles.close(tabId);
    activeRequests.get(tabId)?.controller.abort();
    activeRequests.delete(tabId);
    piPdfReaderTabIds.delete(tabId);
    pendingWebCapturePermissionTabs.delete(tabId);
    for (const [windowId, activeTabId] of activeTabIdsByWindow) {
      if (activeTabId === tabId) activeTabIdsByWindow.delete(windowId);
    }
    if (lastActiveBrowserTab?.id === tabId) lastActiveBrowserTab = undefined;
    void runTranslationCommit(tabId, async () => {
      pendingTranslationRequests.delete(tabId);
      pdfSidePanelCorrectionClaims.delete(tabId);
      pdfSidePanelSessions.delete(tabId);
      await Promise.allSettled([
        clearTranslationHead(tabId),
        clearTranslationHistory(tabId),
        clearTranslationCache(tabId),
        clearImageRegionTranslationCache(tabId),
        clearTranslationCheckpoint(tabId),
        clearBilingualPageSession(tabId),
        clearSettingsRecoveryTicketsForTab(tabId),
        removeStoredPdfSidePanelSession(tabId),
        setContinuousTranslationPaused(tabId, false),
      ]);
    }).finally(() => {
      void queuePdfSidePanelOptionsSync().catch(() => undefined);
    });
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) tabLifecycles.reopen(tab.id);
    void queuePdfSidePanelOptionsSync().catch(() => undefined);
  });

  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    rememberActiveBrowserTab(tabId, windowId);
    // Keep the active native PDF tab ready before a context-menu click. This
    // lets sidePanel.open() be the only browser API needed during the gesture.
    void queuePdfSidePanelOptionsSync().catch(() => undefined);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active) rememberActiveBrowserTab(tabId, tab.windowId);
    if (changeInfo.status === 'loading' || changeInfo.url) {
      pendingWebCapturePermissionTabs.delete(tabId);
    }
    if (changeInfo.status === 'loading' && !changeInfo.url) {
      const currentSession = pdfSidePanelSessions.get(tabId);
      if (currentSession && isSamePdfDocumentLocationChange(
        currentSession.pageUrl,
        currentSession.pageNumber,
        tab.url,
      )) {
        return;
      }
      // Edge reports an ordinary same-URL reload without a URL change. Rotate
      // the generation anyway so work captured by the previous document
      // instance cannot publish progress or revive its result after reload.
      tabLifecycles.invalidate(tabId);
      activeRequests.get(tabId)?.controller.abort();
      activeRequests.delete(tabId);
      void runTranslationCommit(tabId, async () => {
        await Promise.allSettled([
          clearTranslationHead(tabId),
          clearTranslationCheckpoint(tabId),
        ]);
      }).finally(() => {
        void queuePdfSidePanelOptionsSync().catch(() => undefined);
      });
      return;
    }
    if (!changeInfo.url) return;
    if (isExtensionPdfReaderUrl(changeInfo.url, PI_PDF_READER_URL)) {
      piPdfReaderTabIds.add(tabId);
    } else {
      piPdfReaderTabIds.delete(tabId);
    }
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
          void runTranslationCommit(tabId, () => {
            const current = pdfSidePanelSessions.get(tabId);
            if (!isSamePdfSidePanelSession(current, session)) return;
            const currentSource = pdfDocumentIdentity(current.pageUrl);
            if (!currentSource || currentSource !== nextSource) return;
            publishPdfSidePanelSession({ ...current, pageNumber });
          });
        }
        return;
      }
      tabLifecycles.invalidate(tabId);
      activeRequests.get(tabId)?.controller.abort();
      activeRequests.delete(tabId);
      void runTranslationCommit(tabId, async () => {
        const current = pdfSidePanelSessions.get(tabId);
        const cleanupTasks: Promise<unknown>[] = [
          clearTranslationHead(tabId),
          clearTranslationCheckpoint(tabId),
        ];
        if (isSamePdfSidePanelSession(current, session)) {
          pdfSidePanelSessions.delete(tabId);
          pdfSidePanelCorrectionClaims.delete(tabId);
          cleanupTasks.push(removeStoredPdfSidePanelSession(tabId));
        }
        await Promise.allSettled(cleanupTasks);
      }).finally(() => {
        void queuePdfSidePanelOptionsSync().catch(() => undefined);
      });
      return;
    }
    tabLifecycles.invalidate(tabId);
    activeRequests.get(tabId)?.controller.abort();
    activeRequests.delete(tabId);
    void runTranslationCommit(tabId, async () => {
      await Promise.allSettled([
        clearTranslationHead(tabId),
        clearTranslationCheckpoint(tabId),
      ]);
    }).finally(() => {
      void queuePdfSidePanelOptionsSync().catch(() => undefined);
    });
  });

  browser.runtime.onMessage.addListener(
    (message: unknown, sender): Promise<unknown> | undefined => {
      if (!isRuntimeMessage(message)) return undefined;

      if (
        message.type === 'GET_BILINGUAL_PAGE_SESSION' ||
        message.type === 'SAVE_BILINGUAL_PAGE_SESSION' ||
        message.type === 'CLEAR_BILINGUAL_PAGE_SESSION' ||
        message.type === 'GET_RETAINED_BILINGUAL_PAGE_SESSION' ||
        message.type === 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION' ||
        message.type === 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION'
      ) {
        const tabId = sender.tab?.id;
        const sourceUrl = sender.url ?? sender.tab?.url;
        if (
          tabId === undefined ||
          (sender.frameId ?? 0) !== 0 ||
          !sourceUrl ||
          !isInjectableWebUrl(sourceUrl) ||
          isOverleafProjectUrl(sourceUrl)
        ) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '正文会话只能由当前普通网页恢复。',
            false,
          )));
        }
        return (async () => {
          try {
            const behaviorKey = await currentBilingualPageSessionBehaviorKey();
            if (message.type === 'GET_BILINGUAL_PAGE_SESSION') {
              const session = await getBilingualPageSession(
                tabId,
                message.payload.descriptor,
                behaviorKey,
              );
              return {
                ok: true as const,
                data: { ...(session ? { session } : {}) },
              };
            }
            if (message.type === 'GET_RETAINED_BILINGUAL_PAGE_SESSION') {
              const session = await getRetainedBilingualPageSession(
                message.payload.descriptor,
                behaviorKey,
              );
              return {
                ok: true as const,
                data: { ...(session ? { session } : {}) },
              };
            }
            if (message.type === 'SAVE_BILINGUAL_PAGE_SESSION') {
              await saveBilingualPageSession(
                tabId,
                message.payload,
                behaviorKey,
              );
              return { ok: true as const, data: {} };
            }
            if (message.type === 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION') {
              await saveRetainedBilingualPageSession(message.payload, behaviorKey);
              return { ok: true as const, data: {} };
            }
            if (message.type === 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION') {
              await clearRetainedBilingualPageSession(message.payload.descriptor);
              return { ok: true as const, data: {} };
            }
            await clearBilingualPageSession(tabId, message.payload.descriptor);
            return { ok: true as const, data: {} };
          } catch (error) {
            return errorResponse(error);
          }
        })();
      }

      if (message.type === 'GET_PUBLIC_SETTINGS') {
        return Promise.all([getSettings(), getPausedSiteHosts()]).then(
          ([settings, pausedSiteHosts]): PublicSettingsResponse => ({
            ok: true,
            data: toPublicSettings(settings, pausedSiteHosts),
          }),
        );
      }

      if (message.type === 'RENDER_LATEX_MATHML') {
        const tex = message.payload.tex.trim();
        if (!tex || tex.length > 10_000) {
          return Promise.resolve({ ok: true as const, data: {} });
        }
        return import('../core/translation/latex-mathml').then(({ renderLatexMathMl }) => {
          const html = renderLatexMathMl(tex, message.payload.displayMode);
          return { ok: true as const, data: { ...(html ? { html } : {}) } };
        }).catch(() => ({ ok: true as const, data: {} }));
      }

      if (message.type === 'RENDER_LATEX_MATHML_BATCH') {
        const items = message.payload.items.slice(0, 64);
        return import('../core/translation/latex-mathml').then(({ renderLatexMathMl }) => ({
          ok: true as const,
          data: {
            html: items.map((item) => {
              const tex = item.tex.trim();
              if (!tex || tex.length > 10_000) return null;
              return renderLatexMathMl(tex, item.displayMode) ?? null;
            }),
          },
        })).catch(() => ({
          ok: true as const,
          data: { html: items.map(() => null) },
        }));
      }

      if (message.type === 'RECORD_LOCAL_PERFORMANCE') {
        return recordLocalPerformanceSample(message.payload)
          .then(() => ({ ok: true as const, data: { recorded: true as const } }));
      }

      if (message.type === 'GET_LOCAL_DIAGNOSTIC_REPORT') {
        return localDiagnosticReport()
          .then((report) => ({ ok: true as const, data: { report } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'OPEN_OPTIONS_PAGE') {
        const focus = message.payload?.focus;
        return (async () => {
          let ticket: SettingsRecoveryTicket | undefined;
          const recovery = message.payload?.recovery;
          if (recovery && focus) {
            let sourceTabId = sender.tab?.id;
            let sourceWindowId = sender.tab?.windowId;
            let targetKind: SettingsRecoveryTicket['targetKind'];
            if (recovery.nativePdfTabId !== undefined) {
              await initializePdfSidePanelSessions();
              const session = pdfSidePanelSessions.get(recovery.nativePdfTabId);
              if (
                !session ||
                session.status !== 'error' ||
                session.requestId !== recovery.failedRequestId
              ) {
                throw new TranslationError(
                  'REQUEST_ABORTED',
                  '原 PDF 翻译任务已经失效，请返回 PDF 后重新触发。',
                  false,
                );
              }
              sourceTabId = recovery.nativePdfTabId;
              sourceWindowId = (await browser.tabs.get(sourceTabId)).windowId;
              targetKind = 'native-pdf';
            } else {
              if (sourceTabId === undefined) {
                throw new TranslationError(
                  'REQUEST_ABORTED',
                  '原翻译页面已经失效，请返回页面重新选择。',
                  false,
                );
              }
              targetKind = isExtensionPdfReaderUrl(
                sender.url ?? sender.tab?.url,
                PI_PDF_READER_URL,
              )
                ? 'extension-page'
                : 'content-script';
            }
            ticket = await createSettingsRecoveryTicket({
              targetKind,
              sourceTabId,
              ...(sourceWindowId !== undefined ? { sourceWindowId } : {}),
              ...(targetKind === 'content-script' && sender.frameId !== undefined
                ? { sourceFrameId: sender.frameId }
                : {}),
              ...(recovery.clientId ? { clientId: recovery.clientId } : {}),
              failedRequestId: recovery.failedRequestId,
              role: recovery.role,
              focus,
              errorCode: recovery.errorCode,
              hadPartialOutput: recovery.hadPartialOutput,
              autoResume: recovery.autoResume,
            });
          }
          const optionsUrl = new URL(browser.runtime.getURL('/options.html'));
          if (focus) optionsUrl.searchParams.set('focus', focus);
          if (ticket) optionsUrl.searchParams.set('recovery', ticket.token);
          optionsUrl.hash = focus === 'support'
            ? 'support'
            : focus === 'glossary'
              ? 'translation'
              : focus
                ? 'connection'
                : '';
          try {
            await browser.tabs.create({ url: optionsUrl.href, active: true });
          } catch (error) {
            if (ticket) await discardSettingsRecoveryTicket(ticket.token);
            throw error;
          }
          return {
            ok: true as const,
            data: {
              opened: true as const,
              ...(ticket ? { recoveryToken: ticket.token } : {}),
            },
          };
        })().catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'GET_SETTINGS_RECOVERY') {
        return (async () => {
          if (sender.tab?.id === undefined || !sender.url?.startsWith(browser.runtime.getURL('/options.html'))) {
            throw new TranslationError('UNSUPPORTED_PAGE', '恢复信息只能由设置页读取。');
          }
          const ticket = await claimSettingsRecoveryTicket(
            message.payload.token,
            sender.tab.id,
          );
          if (!ticket) {
            throw new TranslationError(
              'REQUEST_ABORTED',
              '恢复任务已过期或已被其他设置页使用。',
              false,
            );
          }
          return {
            ok: true as const,
            data: {
              recovery: {
                token: ticket.token,
                role: ticket.role,
                focus: ticket.focus,
                errorCode: ticket.errorCode,
                hadPartialOutput: ticket.hadPartialOutput,
                autoResume: ticket.autoResume,
                expiresAt: ticket.expiresAt,
              },
            },
          };
        })().catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'COMPLETE_SETTINGS_RECOVERY') {
        return (async () => {
          if (sender.tab?.id === undefined || !sender.url?.startsWith(browser.runtime.getURL('/options.html'))) {
            throw new TranslationError('UNSUPPORTED_PAGE', '恢复任务只能由设置页完成。');
          }
          try {
            await configurationRevisionBarrier.waitFor(
              message.payload.configurationRevision,
            );
          } catch (error) {
            if (error instanceof ConfigurationRevisionMismatchError) {
              throw new TranslationError(
                'REQUEST_ABORTED',
                'API 设置在验证后又发生了变化，请重新验证并保存后继续。',
                false,
              );
            }
            throw error;
          }
          const ticket = await beginSettingsRecoveryDelivery(
            message.payload.token,
            sender.tab.id,
          );
          if (!ticket) {
            throw new TranslationError(
              'REQUEST_ABORTED',
              '原翻译任务已过期，请返回页面重新选择。',
              false,
            );
          }
          let delivered: SettingsRecoveryAck;
          try {
            delivered = await deliverSettingsRecovery(ticket);
          } catch (error) {
            await finishSettingsRecoveryDelivery(ticket.token, sender.tab.id, false);
            throw error;
          }
          await finishSettingsRecoveryDelivery(
            ticket.token,
            sender.tab.id,
            delivered.handled,
          );
          return {
            ok: true as const,
            data: {
              returned: delivered.handled,
              resumed: delivered.resumed,
              requiresConfirmation: delivered.requiresConfirmation,
            },
          };
        })().catch((error: unknown) => errorResponse(error));
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
        return (async () => {
          if (source) {
            const parsed = parsePdfSourceUrl(source)!;
            if (
              parsed.protocol === 'file:' &&
              !(await browser.extension.isAllowedFileSchemeAccess())
            ) {
              throw new TranslationError(
                'UNSUPPORTED_PAGE',
                '请先在 Edge 扩展管理页的 Pi Translator 详情中开启“允许访问文件 URL”。',
                true,
              );
            }
            const origin = pdfPermissionPattern(source);
            if (origin && !await browser.permissions.contains({ origins: [origin] })) {
              throw new TranslationError(
                'UNSUPPORTED_PAGE',
                '尚未授权读取当前 PDF 所在地址，请从快捷面板或 PDF 侧边栏重新授权。',
                true,
              );
            }
          }
          const tab = await browser.tabs.create({ url: viewerUrl.href, active: true });
          await disableSidePanelForPiPdfViewer(tab);
          await completeFeatureDiscovery('pdf-reader').catch(() => undefined);
          return { ok: true as const, data: { opened: true } };
        })().catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'GET_PDF_SIDE_PANEL_SESSION') {
        return initializePdfSidePanelSessions().then(() => ({
          ok: true as const,
          data: {
            session: pdfSidePanelSessions.get(message.payload.tabId) ?? null,
          },
        }));
      }

      if (message.type === 'RETRY_PDF_SIDE_PANEL_TRANSLATION') {
        return initializePdfSidePanelSessions().then(() =>
          retryPdfSidePanelTranslation(
            message.payload.tabId,
            message.payload.expectedRequestId,
          ));
      }

      if (message.type === 'RETRANSLATE_SIDE_PANEL_TRANSLATION') {
        const extensionSender = Boolean(
          sender.url?.startsWith(browser.runtime.getURL('')),
        );
        if (!extensionSender) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '只能从 Pi Translator 浏览器侧栏切换当前翻译的语言。',
            false,
          )));
        }
        return retranslateSidePanelTranslation(
          message.payload.tabId,
          message.payload.expectedRequestId,
          message.payload.targetLanguage,
        );
      }

      if (message.type === 'BILINGUAL_PAGE_STATE_UPDATED') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return undefined;
        void browser.runtime.sendMessage({
          type: 'BILINGUAL_PAGE_TAB_STATE_UPDATED',
          payload: { tabId, state: message.payload.state },
        } satisfies RuntimeMessage).catch(() => undefined);
        return Promise.resolve({ ok: true as const, data: { received: true as const } });
      }

      if (
        message.type === 'START_BILINGUAL_PAGE' ||
        message.type === 'GET_BILINGUAL_PAGE_STATE' ||
        message.type === 'GET_BILINGUAL_PAGE_EXPORT' ||
        message.type === 'CONTROL_BILINGUAL_PAGE'
      ) {
        const extensionSender = Boolean(sender.url?.startsWith(browser.runtime.getURL('')));
        if (!extensionSender) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '正文双语阅读只能从 Pi Translator 界面启动。',
            false,
          )));
        }
        if (message.type === 'START_BILINGUAL_PAGE') {
          return startBilingualPage(
            message.payload.tabId,
            message.payload.targetLanguage,
          );
        }
        if (message.type === 'GET_BILINGUAL_PAGE_STATE') {
          return getBilingualPageState(message.payload.tabId);
        }
        if (message.type === 'GET_BILINGUAL_PAGE_EXPORT') {
          return getBilingualPageExport(message.payload.tabId);
        }
        return controlBilingualPage(message.payload.tabId, message.payload.action);
      }

      if (message.type === 'CANCEL_PDF_SIDE_PANEL_TRANSLATION') {
        return cancelPdfSidePanelTranslation(
          message.payload.tabId,
          message.payload.expectedRequestId,
        );
      }

      if (message.type === 'PDF_SIDE_PANEL_SESSION_UPDATED') {
        return undefined;
      }

      if (message.type === 'PREPARE_WEB_CAPTURE_PERMISSION') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '只能从当前网页的 Pi Translator 准备截图授权。',
            false,
          )));
        }
        const intent = message.payload?.intent ?? 'restore';
        return browser.permissions.contains({
          origins: [VISIBLE_TAB_CAPTURE_PERMISSION],
        }).then((granted) => {
          if (granted && intent === 'start') {
            pendingWebCapturePermissionTabs.delete(tabId);
          } else {
            markWebCapturePermissionPrompt(tabId);
          }
          return {
            ok: true as const,
            data: { ready: true as const, granted },
          };
        });
      }

      if (message.type === 'GET_CURRENT_WEB_CAPTURE_PERMISSION_PROMPT') {
        const tabId = sender.tab?.id;
        return Promise.resolve({
          ok: true as const,
          data: { pending: tabId !== undefined && hasWebCapturePermissionPrompt(tabId) },
        });
      }

      if (message.type === 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT') {
        if (sender.tab?.id !== undefined) {
          pendingWebCapturePermissionTabs.delete(sender.tab.id);
        }
        return Promise.resolve({ ok: true as const, data: { cleared: true as const } });
      }

      if (message.type === 'GET_WEB_CAPTURE_PERMISSION_PROMPT') {
        return Promise.resolve({
          ok: true as const,
          data: { pending: hasWebCapturePermissionPrompt(message.payload.tabId) },
        });
      }

      if (message.type === 'OPEN_WEB_CAPTURE_PERMISSION_PANEL') {
        const tab = sender.tab;
        if (tab?.id === undefined) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '需要从网页中的 Pi Translator 打开截图授权入口。',
            false,
          )));
        }
        markWebCapturePermissionPrompt(tab.id);
        return openWebCapturePermissionSidePanel({
          id: tab.id,
          windowId: tab.windowId,
        }).then((response) => {
          if (!response.ok) pendingWebCapturePermissionTabs.delete(tab.id!);
          return response;
        });
      }

      if (message.type === 'WEB_CAPTURE_PERMISSION_PANEL_OPENED') {
        return undefined;
      }

      if (message.type === 'OPEN_BROWSER_SIDEBAR') {
        const tab = sender.tab;
        if (tab?.id === undefined) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '需要从网页中的 Pi Translator 切换浏览器侧栏。',
            false,
          )));
        }
        return openBrowserTranslationSidePanel(
          { id: tab.id, windowId: tab.windowId, ...(tab.url ? { url: tab.url } : {}) },
          message.payload,
        );
      }

      if (message.type === 'USE_FLOATING_SIDEBAR') {
        return useFloatingSidebar(message.payload?.tabId);
      }

      if (
        message.type === 'BROWSER_SIDEBAR_ACTIVE' ||
        message.type === 'BROWSER_SIDEBAR_CLOSED' ||
        message.type === 'CONTINUOUS_TRANSLATION_STATE_UPDATED'
      ) {
        return undefined;
      }

      if (
        message.type === 'GET_CONTINUOUS_TRANSLATION_STATE' ||
        message.type === 'SET_CONTINUOUS_TRANSLATION_PAUSED'
      ) {
        const requestedTabId = message.payload?.tabId;
        const extensionSender = Boolean(
          sender.url?.startsWith(browser.runtime.getURL('')),
        );
        const tabId = extensionSender ? requestedTabId : sender.tab?.id;
        if (tabId === undefined || tabId < 0) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '当前标签页无法调整连续翻译状态。',
            false,
          )));
        }
        if (message.type === 'GET_CONTINUOUS_TRANSLATION_STATE') {
          return isContinuousTranslationPaused(tabId).then((paused) => ({
            ok: true as const,
            data: { paused },
          }));
        }
        const paused = message.payload.paused === true;
        return setContinuousTranslationPaused(tabId, paused).then(async () => {
          const update = {
            type: 'CONTINUOUS_TRANSLATION_STATE_UPDATED',
            payload: { tabId, paused },
          } satisfies RuntimeMessage;
          await browser.tabs.sendMessage(tabId, update).catch(() => undefined);
          void browser.runtime.sendMessage(update).catch(() => undefined);
          return {
            ok: true as const,
            data: { paused },
          };
        });
      }

      if (
        message.type === 'GET_SIDEBAR_OBSTRUCTION_HINT' ||
        message.type === 'DISMISS_SIDEBAR_OBSTRUCTION_HINT'
      ) {
        const hostname = sender.tab?.url ? siteHostFromUrl(sender.tab.url) : undefined;
        if (!hostname) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '当前页面无法保存侧栏提示偏好。',
            false,
          )));
        }
        if (message.type === 'GET_SIDEBAR_OBSTRUCTION_HINT') {
          return isSidebarObstructionHintDismissed(hostname).then((dismissed) => ({
            ok: true as const,
            data: { dismissed },
          }));
        }
        return dismissSidebarObstructionHint(hostname).then(() => ({
          ok: true as const,
          data: { dismissed: true as const },
        }));
      }

      if (message.type === 'OPEN_SIDEBAR') {
        return browser.tabs
          .query({ active: true, currentWindow: true })
          .then(async ([tab]) => {
            if (!tab) return { ok: false, error: { code: 'UNSUPPORTED_PAGE' as const, message: 'No active tab.', retryable: false } };
            await sendToSelectionContentScript(tab, message);
            if (tab.url && !isOverleafProjectUrl(tab.url)) {
              await completeFeatureDiscovery('web-sidebar').catch(() => undefined);
            }
            return { ok: true, data: { opened: true } };
          })
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'START_WEB_REGION_SELECTION') {
        return browser.tabs
          .query({ active: true, currentWindow: true })
          .then(async ([tab]) => {
            if (!tab) {
              return errorResponse(new TranslationError(
                'UNSUPPORTED_PAGE',
                'No active web page is available.',
                false,
              ));
            }
            await sendToSelectionContentScript(tab, message);
            pendingWebCapturePermissionTabs.delete(tab.id!);
            if (tab.url) {
              await completeFeatureDiscovery(
                isOverleafProjectUrl(tab.url) ? 'overleaf-region' : 'web-region',
              ).catch(() => undefined);
            }
            return { ok: true as const, data: { started: true as const } };
          })
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'SET_SIDEBAR_WIDTH') {
        const width = Math.min(640, Math.max(320, Math.round(message.payload.width)));
        return mutateSettings((settings) => ({
          nextSettings: { ...settings, sidebarWidth: width },
          value: undefined,
        }))
          .then(() => ({ ok: true as const, data: { width } }));
      }

      if (message.type === 'PAUSE_CURRENT_SITE') {
        return setSitePaused(message.payload.pageUrl, true).then((hostname) => ({
          ok: true as const,
          data: { hostname },
        }));
      }

      if (message.type === 'GET_DOCUMENT_MEMORY') {
        return getDocumentMemory(documentIdentity(message.payload))
          .then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'CONFIRM_DOCUMENT_TERM') {
        return confirmDocumentTerm(
          documentIdentity(message.payload),
          message.payload.candidateId,
        ).then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'UPSERT_DOCUMENT_TERM') {
        return upsertDocumentTerm(
          documentIdentity(message.payload),
          message.payload.term,
        ).then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'REMOVE_DOCUMENT_TERM') {
        return removeDocumentTerm(
          documentIdentity(message.payload),
          message.payload.termId,
        ).then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'DISMISS_DOCUMENT_TERM_CANDIDATE') {
        return dismissDocumentTermCandidate(
          documentIdentity(message.payload),
          message.payload.candidateId,
        ).then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'RESOLVE_DOCUMENT_REVIEW') {
        return resolveDocumentReview(
          documentIdentity(message.payload),
          message.payload.reviewId,
        ).then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'CLEAR_DOCUMENT_MEMORY') {
        return clearDocumentMemory(documentIdentity(message.payload))
          .then((memory) => ({ ok: true as const, data: { memory } }))
          .catch((error: unknown) => errorResponse(error));
      }

      if (message.type === 'UPDATE_TRANSLATION_RESULT') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(
            errorResponse(
              new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
            ),
          );
        }
        return updateTranslationResult(message.payload, tabId);
      }

      if (message.type === 'UNDO_TRANSLATION_RESULT') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(
            new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
          ));
        }
        return undoTranslationResult(message.payload, tabId);
      }

      if (message.type === 'UPDATE_TRANSLATION_SEGMENT') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(
            new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
          ));
        }
        return updateTranslationSegment(message.payload, tabId);
      }

      if (message.type === 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT') {
        return updatePdfSidePanelTranslationResult(message.payload);
      }

      if (message.type === 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT') {
        return undoPdfSidePanelTranslationResult(message.payload);
      }

      if (message.type === 'CANCEL_TRANSLATION') {
        const tabId = sender.tab?.id;
        const active = tabId === undefined ? undefined : activeRequests.get(tabId);
        const cancelled = active?.requestId === message.payload.requestId;
        if (cancelled) {
          active.controller.abort();
        }
        return (cancelled ? clearTranslationCheckpoint(tabId) : Promise.resolve()).then(() => ({
          ok: true as const,
          data: { cancelled },
        }));
      }

      if (message.type === 'CAPTURE_VISIBLE_TAB') {
        const windowId = sender.tab?.windowId;
        const tabUrl = sender.tab?.url;
        if (windowId === undefined || !tabUrl || !isInjectableWebUrl(tabUrl)) {
          return Promise.resolve(errorResponse(
            new TranslationError('UNSUPPORTED_PAGE', 'This page cannot be captured.'),
          ));
        }
        return browser.permissions.contains({
          origins: [VISIBLE_TAB_CAPTURE_PERMISSION],
        }).then(async (hasPersistentWebCaptureAccess) => {
          try {
            const imageDataUrl = await browser.tabs.captureVisibleTab(windowId, {
              format: 'png',
            });
            return {
              ok: true as const,
              data: { imageDataUrl },
            };
          } catch (error) {
            return errorResponse(visibleTabCaptureFailure(
              error,
              hasPersistentWebCaptureAccess,
            ));
          }
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
        return withCompletedTranslationDiscovery(
          message.payload,
          'text',
          translate(message.payload, tabId, progressTargetForSender(sender.url)),
          isExtensionPdfReaderUrl(sender.url, PI_PDF_READER_URL)
            ? 'pdf-selection'
            : undefined,
        );
      }

      if (message.type === 'TRANSLATE_BILINGUAL_PAGE_SEGMENT') {
        const tabId = sender.tab?.id;
        const sourceUrl = sender.url ?? sender.tab?.url;
        if (
          tabId === undefined ||
          !sourceUrl ||
          !isInjectableWebUrl(sourceUrl) ||
          isOverleafProjectUrl(sourceUrl)
        ) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '正文双语阅读请求必须来自当前普通网页。',
            false,
          )));
        }
        return translate(
          message.payload,
          tabId,
          'none',
          undefined,
          'transient',
        );
      }

      if (message.type === 'TRANSLATE_DOCUMENT_BATCH') {
        const tabId = sender.tab?.id;
        const sourceUrl = sender.url ?? sender.tab?.url;
        const isOrdinaryWebSource = Boolean(
          sourceUrl && isInjectableWebUrl(sourceUrl) && !isOverleafProjectUrl(sourceUrl),
        );
        const isPiPdfSource = Boolean(
          sourceUrl && isExtensionPdfReaderUrl(sourceUrl, PI_PDF_READER_URL),
        );
        if (tabId === undefined || (!isOrdinaryWebSource && !isPiPdfSource)) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            '全文批量翻译请求必须来自当前网页或 Pi PDF。',
            false,
          )));
        }
        return translateDocumentBatch(message.payload, tabId);
      }

      if (message.type === 'TRANSLATE_SELECTION_IN_BROWSER_SIDEBAR') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(new TranslationError(
            'UNSUPPORTED_PAGE',
            'A browser tab is required.',
          )));
        }
        return withCompletedTranslationDiscovery(
          message.payload,
          'text',
          translateSelectionInBrowserSidePanel(message.payload, tabId),
        );
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
        return withCompletedTranslationDiscovery(
          message.payload,
          'image',
          translateImageRegion(
            message.payload,
            tabId,
            progressTargetForSender(sender.url),
          ),
          isExtensionPdfReaderUrl(sender.url, PI_PDF_READER_URL)
            ? 'pdf-region'
            : undefined,
        );
      }

      if (message.type === 'RECOGNIZE_PDF_PAGE') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          return Promise.resolve(errorResponse(
            new TranslationError('UNSUPPORTED_PAGE', 'A browser tab is required.'),
          ));
        }
        return recognizePdfPage(message.payload, tabId);
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

      return undefined;
    },
  );
});
