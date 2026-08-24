import type {
  PublicSettings,
  PublicSettingsResponse,
  DocumentMemoryResponse,
  DocumentMemoryLocator,
  OpenOptionsPageResponse,
  RuntimeMessage,
  RuntimeResponse,
  SettingsRecoveryReadyPayload,
  SettingsRecoveryRequest,
  TranslateRuntimeResponse,
  UpdateTranslationResultResponse,
} from '../messaging/messages';
import {
  runtimeConnectionErrorMessage,
  type SettingsFocus,
  translationCorrectionErrorMessage,
  translationErrorRecovery,
  translationErrorMessage,
} from '../messaging/user-facing-error';
import { captureSelectionSnapshot } from '../selection/generic-selection';
import { shouldSuppressPassiveSelectionTranslation } from '../selection/passive-selection-intent';
import type { SelectionSnapshot, ViewportRect } from '../selection/types';
import { isLikelyTargetLanguage } from '../language/target-language';
import { normalizePdfSelectionText } from '../pdf/text-normalizer';
import { shouldUseVisionForPdfFormula } from '../translation/formula-detection';
import type { SidebarSide } from '../settings/schema';
import {
  documentMemoryTranslationResult,
  type DocumentMemorySnapshot,
  type DocumentMemoryTranslation,
} from '../document/document-memory-repository';
import type {
  PdfSourceLocation,
  TranslateResult,
  TranslationCorrectionReceipt,
  TranslationCorrectionTermInput,
  TranslationHistoryEntry,
  TranslationMemoryScope,
  TranslationRevisionRequest,
  TranslationRevisionScope,
  TranslationSegment,
} from '../translation/types';
import {
  captureDomTranslationMarkerAnchor,
  buildTranslationMarkerMarkdown,
  createSegmentTranslationMarkerAnchor,
  markerTextStillMatches,
  persistedPdfMarkerKey,
  persistablePdfMarkerAnchor,
  persistPdfTranslationMarker,
  restorePersistedPdfTranslationMarker,
  SessionTranslationMarkerManager,
  type PersistedPdfTranslationMarker,
  type TranslationMarkerAnchor,
  type TranslationMarkerContent,
  type TranslationMarkerLocationState,
  type TranslationMarkerSummary,
} from './session-translation-markers';
import {
  TranslationOverlay,
  type OverlayRetryTarget,
  type SelectionTriggerPreview,
  type TranslationAdjustmentRequest,
  type ViewportInsetsProvider,
} from '../../ui/translation-overlay';
import { captureWebRegion, WebRegionCaptureError } from './web-region-capture';
import {
  createWebRegionSelection,
  type WebRegionSelectionHandle,
  type WebRegionSelectionSeed,
} from './web-region-selection';

interface ContentScriptRuntimeContext {
  onInvalidated(callback: () => void): unknown;
}

type TranslationSurface = 'overleaf' | 'general' | 'pdf';

interface SelectionTranslatorOptions {
  pageUrl?: () => string;
  sourceLabel?: () => string | undefined;
  documentId?: () => string | undefined;
  allowSitePause?: boolean;
  viewportInsets?: ViewportInsetsProvider;
  onSidebarLayoutChange?: (layout: SelectionTranslatorSidebarLayout) => void;
  onSidebarActiveChange?: (active: boolean) => void;
  onPublicSettingsChange?: (settings: PublicSettings) => void;
  selectionPreview?: (snapshot: SelectionSnapshot) => SelectionTriggerPreview | undefined;
  onAdjustPdfRegion?: (sourceLocation: PdfSourceLocation) => void | Promise<void>;
  onNavigateToPdfRegion?: (sourceLocation: PdfSourceLocation) => void | Promise<void>;
  resolvePdfRegionRects?: (sourceLocation: PdfSourceLocation) => ViewportRect[];
  captureVisualSelection?: (
    snapshot: SelectionSnapshot,
  ) => Promise<ImageRegionTranslationCapture | undefined>;
  onNavigateToPdfMarker?: (pageNumber: number) => void | Promise<void>;
  pdfMarkerPersistence?: {
    isAvailable(): boolean;
    currentDocumentId(): string;
    load(): Promise<{ enabled: boolean; markers: PersistedPdfTranslationMarker[] }>;
    setEnabled(enabled: boolean): Promise<void>;
    save(markers: PersistedPdfTranslationMarker[]): Promise<void>;
    clear(): Promise<void>;
  };
}

export interface SelectionTranslatorSidebarLayout {
  expanded: boolean;
  side: SidebarSide;
  width: number;
}

export interface ImageRegionTranslationCapture {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  recognizedTextHint?: string;
  rect: ViewportRect;
  pageUrl: string;
  sourceLabel?: string;
  selectionReference?: PdfSourceLocation;
  sourceSelection?: SelectionSnapshot;
  /** In-memory only; allows an explicitly selected webpage region to be adjusted. */
  webRegionSelection?: WebRegionSelectionSeed;
  /** Numeric local timings only; never contains selection or page data. */
  clientPerformance?: { captureMs?: number; queueMs?: number };
}

export interface PdfRegionTextTranslationCapture {
  text: string;
  rect: ViewportRect;
  pageUrl: string;
  sourceLabel?: string;
  sourceLocation: PdfSourceLocation;
  /** Numeric local timings only; never contains selection or page data. */
  clientPerformance?: { queueMs?: number };
}

type TextTranslationMetadata = {
  sourceLabel?: string;
  sourceLocation?: PdfSourceLocation;
  /** In-memory only; allows an explicitly selected webpage region to be adjusted. */
  webRegionSelection?: WebRegionSelectionSeed;
  clientPerformance?: { captureMs?: number; queueMs?: number };
};

type TranslationRetryContext =
  | {
      kind: 'text';
      snapshot: SelectionSnapshot;
      metadata?: TextTranslationMetadata;
      revision?: TranslationRevisionRequest;
    }
  | {
      kind: 'image';
      capture: ImageRegionTranslationCapture;
      revision?: TranslationRevisionRequest;
    };

interface PendingSettingsRecovery {
  token: string;
  context: TranslationRetryContext;
  failedRequestId: string;
  partialText?: string;
  autoResume: boolean;
  pageUrl: string;
  targetLanguage: string;
  style: PublicSettings['style'];
}

interface SettingsRecoveryAck {
  handled: boolean;
  resumed: boolean;
  requiresConfirmation: boolean;
}

export interface SelectionTranslatorController {
  translateImageRegion(capture: ImageRegionTranslationCapture): Promise<void>;
  translatePdfRegionText(capture: PdfRegionTextTranslationCapture): Promise<void>;
  openSidebar(): void;
  cancelActiveTranslation(): void;
  refreshPersistentMarkers(): Promise<void>;
  reset(): void;
}

const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  showFloatingButtonOnOverleaf: true,
  hideFloatingButtonForTargetLanguage: true,
  generalPageMode: 'on-demand',
  siteAllowlist: [],
  pausedSiteHosts: [],
  sentenceAlignmentDefault: false,
  autoRenderLatex: true,
  historyLimit: 5,
  sidebarMode: 'floating',
  sidebarSide: 'right',
  sidebarWidth: 390,
  contextMode: 'off',
  enableStreaming: true,
  protectSensitiveFields: true,
  pdfKeyboardShortcutsEnabled: true,
  pdfRegionShortcutKey: 'r',
  activeApiProfileId: 'default',
  apiProfiles: [{ id: 'default', name: '默认接口', model: '' }],
};

function shouldShowFloatingButton(
  settings: PublicSettings,
  surface: TranslationSurface,
): boolean {
  if (surface === 'pdf') return true;
  if (settings.pausedSiteHosts.includes(location.hostname.toLowerCase())) {
    return false;
  }
  if (surface === 'overleaf') return settings.showFloatingButtonOnOverleaf;
  return (
    settings.generalPageMode === 'allowlist' ||
    settings.generalPageMode === 'all-sites'
  );
}

function sameExtensionPage(left: string, right: string): boolean {
  try {
    const first = new URL(left);
    const second = new URL(right);
    return (
      first.hostname === second.hostname &&
      first.pathname === second.pathname &&
      first.search === second.search
    );
  } catch {
    return left === right;
  }
}

export async function startSelectionTranslator(
  ctx: ContentScriptRuntimeContext,
  surface: TranslationSurface,
  options: SelectionTranslatorOptions = {},
): Promise<SelectionTranslatorController> {
  let settings = DEFAULT_PUBLIC_SETTINGS;
  let latestSelection: SelectionSnapshot | undefined;
  let activeSelection: SelectionSnapshot | undefined;
  let activeImageRegion: ImageRegionTranslationCapture | undefined;
  let activePdfRegionLocation: PdfSourceLocation | undefined;
  let activeTextMetadata: TextTranslationMetadata | undefined;
  let activeRetryContext: TranslationRetryContext | undefined;
  let activePartialText: string | undefined;
  let pendingSettingsRecovery: PendingSettingsRecovery | undefined;
  const recoveryClientId = crypto.randomUUID();
  const resultRetryContexts = new Map<string, TranslationRetryContext>();
  let inFlightRequestId: string | undefined;
  let completedEarlyRequestId: string | undefined;
  let activeWebRegionSelection: WebRegionSelectionHandle | undefined;
  let failedWebRegionSelection: WebRegionSelectionSeed | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let autoTranslateTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAutoSelectionHash: string | undefined;
  let dismissedPassiveSelectionHash: string | undefined;
  let browserSidebarActive = false;
  let continuousTranslationPaused = false;
  let pdfSelectionPointerId: number | undefined;
  let pdfSelectionInProgress = false;
  let temporaryTargetLanguage = settings.targetLanguage;
  let temporaryStyle = settings.style;
  const markerAnchors = new Map<string, TranslationMarkerAnchor>();
  const segmentMarkerAnchors = new Map<string, TranslationMarkerAnchor>();
  let pendingSelectionMarkerRequestId: string | undefined;
  let markerManager: SessionTranslationMarkerManager | undefined;
  let overlayHistory: TranslationHistoryEntry[] = [];
  let persistedMarkerHistory: TranslationHistoryEntry[] = [];
  let persistentMarkersEnabled = false;
  let persistentStoredMarkerCount = 0;
  let storedPersistentMarkers: PersistedPdfTranslationMarker[] = [];
  let persistenceRevision = 0;
  let persistenceWriteQueue: Promise<void> = Promise.resolve();

  function currentPartialOutput(): string | undefined {
    const partialText: string | undefined = activePartialText;
    return partialText?.trim() ? partialText : undefined;
  }

  function hasActivePartialOutput(): boolean {
    return Boolean(currentPartialOutput());
  }

  function currentDocumentLocator(): DocumentMemoryLocator {
    const sourceLocation = activePdfRegionLocation ?? activeTextMetadata?.sourceLocation;
    const sourceLabel = activeImageRegion?.sourceLabel ??
      activeTextMetadata?.sourceLabel ??
      options.sourceLabel?.();
    const documentId = options.documentId?.();
    return {
      pageUrl: activeImageRegion?.pageUrl ?? options.pageUrl?.() ?? location.href,
      ...(documentId ? { documentId } : {}),
      ...(sourceLabel ? { sourceLabel } : {}),
      ...(sourceLocation ? { sourceLocation } : {}),
    };
  }

  function documentLocatorForResult(result: TranslateResult): DocumentMemoryLocator {
    const context = retryContextForResult(result);
    const current = currentDocumentLocator();
    const contextPageUrl = context?.kind === 'image'
      ? context.capture.pageUrl
      : context?.snapshot.pageUrl;
    const contextSourceLabel = context?.kind === 'image'
      ? context.capture.sourceLabel
      : context?.metadata?.sourceLabel;
    const contextSourceLocation = context?.kind === 'image'
      ? context.capture.selectionReference
      : context?.metadata?.sourceLocation;
    const sourceLabel = contextSourceLabel ?? result.sourceHost;
    const sourceLocation = result.sourceLocation ?? contextSourceLocation;
    return {
      ...current,
      pageUrl: contextPageUrl ?? current.pageUrl,
      ...(result.documentId ? { documentId: result.documentId } : {}),
      ...(sourceLabel && !current.sourceLabel
        ? { sourceLabel }
        : {}),
      ...(sourceLocation ? { sourceLocation } : {}),
    };
  }

  async function documentMemoryRequest(
    message: Extract<RuntimeMessage, {
      type:
        | 'GET_DOCUMENT_MEMORY'
        | 'CONFIRM_DOCUMENT_TERM'
        | 'UPSERT_DOCUMENT_TERM'
        | 'REMOVE_DOCUMENT_TERM'
        | 'DISMISS_DOCUMENT_TERM_CANDIDATE'
        | 'RESOLVE_DOCUMENT_REVIEW'
        | 'CLEAR_DOCUMENT_MEMORY';
    }>,
  ): Promise<DocumentMemorySnapshot> {
    const response = await browser.runtime.sendMessage(message) as DocumentMemoryResponse;
    if (!response.ok) throw new Error(response.error.message);
    return response.data.memory;
  }

  function cancelActiveTranslation(): void {
    const requestId = inFlightRequestId;
    activeSelection = undefined;
    inFlightRequestId = undefined;
    activeImageRegion = undefined;
    activePdfRegionLocation = undefined;
    activeTextMetadata = undefined;
    activeRetryContext = undefined;
    activePartialText = undefined;
    pendingSettingsRecovery = undefined;
    if (!requestId) return;
    void browser.runtime
      .sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId },
      } satisfies RuntimeMessage)
      .catch(() => undefined);
  }

  function stopActiveTranslation(): void {
    if (!inFlightRequestId) return;
    const partialText = currentPartialOutput();
    const rect = activeImageRegion?.rect ??
      (activeSelection ? selectionRect(activeSelection) : undefined);
    const selectionHash = activeSelection?.selectionHash;
    if (autoTranslateTimer) {
      clearTimeout(autoTranslateTimer);
      autoTranslateTimer = undefined;
    }
    if (selectionHash) lastAutoSelectionHash = selectionHash;
    cancelActiveTranslation();
    overlay.showStopped(partialText, rect);
  }

  async function openSettingsPage(
    focus?: SettingsFocus,
    recovery?: SettingsRecoveryRequest,
  ): Promise<boolean> {
    const context = activeRetryContext;
    const partialText = activePartialText;
    try {
      const response = await browser.runtime.sendMessage({
        type: 'OPEN_OPTIONS_PAGE',
        ...((focus || recovery)
          ? {
              payload: {
                ...(focus ? { focus } : {}),
                ...(recovery && context ? { recovery } : {}),
              },
            }
          : {}),
      } satisfies RuntimeMessage) as OpenOptionsPageResponse;
      if (!response.ok) return false;
      if (response.data.recoveryToken && recovery && context) {
        pendingSettingsRecovery = {
          token: response.data.recoveryToken,
          context,
          failedRequestId: recovery.failedRequestId,
          ...(partialText ? { partialText } : {}),
          autoResume: recovery.autoResume,
          pageUrl: context.kind === 'image'
            ? context.capture.pageUrl
            : context.snapshot.pageUrl,
          targetLanguage: temporaryTargetLanguage,
          style: temporaryStyle,
        };
      }
      return true;
    } catch {
      return false;
    }
  }

  function applyContinuousTranslationPaused(paused: boolean): boolean {
    continuousTranslationPaused = paused;
    if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
    autoTranslateTimer = undefined;
    const current = captureSelectionSnapshot(settings.contextMode);
    if (current) latestSelection = current;
    lastAutoSelectionHash = current?.selectionHash ?? latestSelection?.selectionHash;
    overlay.setContinuousTranslationPaused(paused);
    return paused;
  }

  const overlay = new TranslationOverlay({
    onTranslate: () => {
      if (latestSelection) void translateSelection(latestSelection);
    },
    onRetry: (target) => {
      void retryTranslation(target);
    },
    ...(surface === 'pdf'
      ? {}
      : { onStartWebRegion: () => void startWebRegionSelectionWithPreflight() }),
    canAdjustWebRegion: (result) => Boolean(webRegionSelectionForResult(result)),
    onAdjustWebRegion: (result) => {
      const selection = result
        ? webRegionSelectionForResult(result)
        : failedWebRegionSelection ?? webRegionSelectionForContext(activeRetryContext);
      if (selection) startWebRegionSelection(selection);
    },
    onReselectWebRegion: () => {
      startWebRegionSelection();
    },
    onTranslateText: (text) => {
      const imageRegion = activeImageRegion;
      const pdfRegionLocation = activePdfRegionLocation;
      const pdfRegionSourceLabel = imageRegion?.sourceLabel ?? activeTextMetadata?.sourceLabel;
      const basis = activeSelection ?? (imageRegion ? undefined : latestSelection);
      const requestId = crypto.randomUUID();
      const snapshot: SelectionSnapshot | undefined = basis
        ? {
            ...basis,
            requestId,
            sourceText: text,
            normalizedText: text.trim(),
            capturedAt: Date.now(),
            selectionHash: `${requestId}:${text.length}`,
          }
        : imageRegion
          ? {
              requestId,
              sourceText: text,
              normalizedText: text.trim(),
              source: 'window-selection',
              pageUrl: imageRegion.pageUrl,
              capturedAt: Date.now(),
              selectionHash: `${requestId}:${text.length}`,
              rect: imageRegion.rect,
            }
          : undefined;
      if (!snapshot) return;
      void translate({
        ...snapshot,
        requestId,
      }, true, pdfRegionLocation
        ? {
            ...(pdfRegionSourceLabel ? { sourceLabel: pdfRegionSourceLabel } : {}),
            sourceLocation: pdfRegionLocation,
            ...(imageRegion?.webRegionSelection
              ? { webRegionSelection: imageRegion.webRegionSelection }
              : {}),
          }
        : imageRegion?.webRegionSelection
          ? { webRegionSelection: imageRegion.webRegionSelection }
          : undefined);
    },
    onAdjustTranslation: (result, adjustment) => {
      void adjustTranslation(result, adjustment);
    },
    onSaveTranslationEdit: (result, translatedText, scope, term) =>
      saveTranslationEdit(result, translatedText, scope, term),
    onSaveSegmentTranslationEdit: (result, segmentId, expectedTranslatedText, correctedTranslatedText) =>
      saveSegmentTranslationEdit(
        result,
        segmentId,
        expectedTranslatedText,
        correctedTranslatedText,
      ),
    onUndoTranslationEdit: (result, receipt) => undoTranslationEdit(result, receipt),
    ...(options.onAdjustPdfRegion
      ? {
          onAdjustPdfRegion: () => {
            const sourceLocation = activePdfRegionLocation;
            if (sourceLocation) void options.onAdjustPdfRegion?.(sourceLocation);
          },
        }
      : {}),
    ...(options.onNavigateToPdfRegion
      ? {
          onNavigateToPdfRegion: (sourceLocation: PdfSourceLocation) => {
            void options.onNavigateToPdfRegion?.(sourceLocation);
          },
        }
      : {}),
    canMarkSource: (result: TranslateResult, segment?: TranslationSegment) => Boolean(
      markerAnchorForTarget(result, segment),
    ),
    isSourceMarked: (result: TranslateResult, segment?: TranslationSegment) => Boolean(
      markedMarkerIdForTarget(result, segment),
    ),
    hasSourceMarksForResult: (result: TranslateResult) => Boolean(
      markerManager?.hasMarksForResult(result.requestId) ||
      markedMarkerIdForTarget(result) ||
      result.alignedSegments?.some((segment) => markedMarkerIdForTarget(result, segment)),
    ),
    hasAnySourceMarks: () => Boolean(markerManager?.hasMarks() || storedPersistentMarkers.length),
    onToggleSourceMark: (result: TranslateResult, segment?: TranslationSegment) => {
      const markedId = markedMarkerIdForTarget(result, segment);
      if (markedId) {
        if (markerManager?.isMarked(markedId)) markerManager.remove(markedId);
        else void removeSourceMark(markedId);
        return false;
      }
      const sourceAnchor = markerAnchorForTarget(result, segment) ??
        (segment ? undefined : bindCurrentSelectionMarkerAnchor(result));
      const anchor = stablePdfMarkerAnchor(sourceAnchor);
      const marked = markerManager?.toggle(
        markerIdForTarget(result, segment),
        result,
        anchor,
        markerContentForTarget(result, segment),
      ) ?? false;
      if (marked && sourceAnchor?.kind === 'dom-range') {
        window.getSelection()?.removeAllRanges();
      }
      return marked;
    },
    onCopyMarkedNotes: async () => {
      const entries = navigatorMarkerEntries();
      const markdown = buildTranslationMarkerMarkdown(entries.map(({ content }) => content));
      if (!markdown) return 0;
      await navigator.clipboard.writeText(markdown);
      return entries.length;
    },
    canPersistSourceMarks: () => Boolean(
      surface === 'pdf' && options.pdfMarkerPersistence?.isAvailable(),
    ),
    isSourceMarkPersistenceEnabled: () => persistentMarkersEnabled,
    hasStoredSourceMarks: () => persistentStoredMarkerCount > 0,
    onSetSourceMarkPersistence: (enabled) => setPersistentMarkersEnabled(enabled),
    onClearSourceMarks: () => clearSourceMarks(),
    getSourceMarkSummaries: () => sourceMarkSummaries(),
    onNavigateSourceMark: (markerId) => navigateSourceMark(markerId),
    onRemoveSourceMark: (markerId) => removeSourceMark(markerId),
    onGetDocumentMemory: () => documentMemoryRequest({
      type: 'GET_DOCUMENT_MEMORY',
      payload: currentDocumentLocator(),
    }),
    onConfirmDocumentTerm: (candidateId) => documentMemoryRequest({
      type: 'CONFIRM_DOCUMENT_TERM',
      payload: { ...currentDocumentLocator(), candidateId },
    }),
    onUpsertDocumentTerm: (term) => documentMemoryRequest({
      type: 'UPSERT_DOCUMENT_TERM',
      payload: { ...currentDocumentLocator(), term },
    }),
    onRemoveDocumentTerm: (termId) => documentMemoryRequest({
      type: 'REMOVE_DOCUMENT_TERM',
      payload: { ...currentDocumentLocator(), termId },
    }),
    onDismissDocumentTermCandidate: (candidateId) => documentMemoryRequest({
      type: 'DISMISS_DOCUMENT_TERM_CANDIDATE',
      payload: { ...currentDocumentLocator(), candidateId },
    }),
    onResolveDocumentReview: (reviewId) => documentMemoryRequest({
      type: 'RESOLVE_DOCUMENT_REVIEW',
      payload: { ...currentDocumentLocator(), reviewId },
    }),
    canRetryDocumentReview: (entry: DocumentMemoryTranslation) => {
      if (entry.sourceKind !== 'image-region') return false;
      return Boolean(retryContextForResult(
        documentMemoryTranslationResult(entry, options.sourceLabel?.()),
      ));
    },
    onRetryDocumentReview: (entry: DocumentMemoryTranslation) => {
      const result = documentMemoryTranslationResult(entry, options.sourceLabel?.());
      void retryTranslation({ kind: 'result', result, intent: 'repeat' });
    },
    onClearDocumentMemory: () => documentMemoryRequest({
      type: 'CLEAR_DOCUMENT_MEMORY',
      payload: currentDocumentLocator(),
    }),
    onOpenSettings: openSettingsPage,
    ...(options.allowSitePause === false
      ? {}
      : {
          onPauseSite: async () => {
            const response = await browser.runtime.sendMessage({
              type: 'PAUSE_CURRENT_SITE',
              payload: { pageUrl: location.href },
            } satisfies RuntimeMessage) as RuntimeResponse<{ hostname?: string }>;
            if (!response.ok) throw new Error(response.error.message);
          },
        }),
    ...(surface === 'pdf'
      ? {}
      : {
          onOpenWebCapturePermissionPanel: async () => {
            const response = await browser.runtime.sendMessage({
              type: 'OPEN_WEB_CAPTURE_PERMISSION_PANEL',
            } satisfies RuntimeMessage) as RuntimeResponse<{ opened: true }>;
            if (!response.ok) throw new Error(response.error.message);
          },
          onOpenBrowserSidebar: async (
            result: TranslateResult | undefined,
            openOptions?: { persistPreference?: boolean },
          ) => {
            const sourceLabel = options.sourceLabel?.();
            const pageUrl = options.pageUrl?.() ?? location.href;
            const response = await browser.runtime.sendMessage({
              type: 'OPEN_BROWSER_SIDEBAR',
              payload: {
                ...(result ? {
                  result,
                  pageUrl,
                  ...(sourceLabel ? { sourceLabel } : {}),
                } : {}),
                ...(openOptions?.persistPreference === false
                  ? { persistPreference: false }
                  : {}),
              },
            } satisfies RuntimeMessage) as RuntimeResponse<{ opened: true }>;
            if (!response.ok) throw new Error(response.error.message);
            browserSidebarActive = true;
            overlay.deactivateSidebar();
            lastAutoSelectionHash = activeSelection?.selectionHash;
            scheduleRefresh();
          },
          isSidebarObstructionHintDismissed: async () => {
            const response = await browser.runtime.sendMessage({
              type: 'GET_SIDEBAR_OBSTRUCTION_HINT',
            } satisfies RuntimeMessage) as RuntimeResponse<{ dismissed: boolean }>;
            if (!response.ok) throw new Error(response.error.message);
            return response.data.dismissed;
          },
          onDismissSidebarObstructionHint: async () => {
            const response = await browser.runtime.sendMessage({
              type: 'DISMISS_SIDEBAR_OBSTRUCTION_HINT',
            } satisfies RuntimeMessage) as RuntimeResponse<{ dismissed: true }>;
            if (!response.ok) throw new Error(response.error.message);
          },
        }),
    onSetContinuousTranslationPaused: async (paused) => {
      const response = await browser.runtime.sendMessage({
        type: 'SET_CONTINUOUS_TRANSLATION_PAUSED',
        payload: { paused },
      } satisfies RuntimeMessage) as RuntimeResponse<{ paused: boolean }>;
      if (!response.ok) throw new Error(response.error.message);
      return applyContinuousTranslationPaused(response.data.paused);
    },
    onSidebarChange: (active) => {
      options.onSidebarActiveChange?.(active);
      if (active) {
        lastAutoSelectionHash = activeSelection?.selectionHash;
        scheduleRefresh();
        return;
      }
      if (!active) {
        lastAutoSelectionHash = undefined;
        if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      }
    },
    onSidebarWidthChange: (width) => {
      void browser.runtime.sendMessage({
        type: 'SET_SIDEBAR_WIDTH',
        payload: { width },
      } satisfies RuntimeMessage);
    },
    onSidebarLayoutChange: (expanded, side, width) => {
      options.onSidebarLayoutChange?.({ expanded, side, width });
    },
    onPreferencesChange: (preferences) => {
      temporaryTargetLanguage = preferences.targetLanguage;
      temporaryStyle = preferences.style;
    },
    onStop: stopActiveTranslation,
    onDismiss: () => {
      cancelActiveTranslation();
      failedWebRegionSelection = undefined;
      void browser.runtime.sendMessage({
        type: 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT',
      } satisfies RuntimeMessage).catch(() => undefined);
    },
    onDismissTrigger: () => {
      dismissedPassiveSelectionHash = latestSelection?.selectionHash;
    },
  }, {
    ...(options.viewportInsets ? { viewportInsets: options.viewportInsets } : {}),
    ...(surface === 'pdf' ? { normalizeFormulaPresentation: true } : {}),
  });

  markerManager = new SessionTranslationMarkerManager({
    ...(options.resolvePdfRegionRects
      ? { resolvePdfRegionRects: options.resolvePdfRegionRects }
      : {}),
    onActivate: (result, rect) => {
      overlay.showResult(
        result,
        rect,
        overlayHistoryForResult(result),
        false,
      );
    },
    onChange: (entries) => {
      persistedMarkerHistory = markerHistoryFromEntries(entries);
      queuePersistentMarkerSave(entries);
    },
    onTooltipUnmark: () => overlay.refreshSourceMarkState(),
  });

  function overlayHistoryForResult(result: TranslateResult): TranslationHistoryEntry[] {
    const history = combinedOverlayHistory();
    return history.some((entry) => entry.requestId === result.requestId) ? history : [];
  }

  function combinedOverlayHistory(): TranslationHistoryEntry[] {
    const seen = new Set<string>();
    return [...overlayHistory, ...persistedMarkerHistory].filter((entry) => {
      if (seen.has(entry.requestId)) return false;
      seen.add(entry.requestId);
      return true;
    });
  }

  function markerIdForTarget(
    result: TranslateResult,
    segment?: TranslationSegment,
  ): string {
    return `${result.requestId}::${segment ? `segment:${segment.id}` : 'full'}`;
  }

  function markerAnchorForTarget(
    result: TranslateResult,
    segment?: TranslationSegment,
  ): TranslationMarkerAnchor | undefined {
    let parent = markerAnchors.get(result.requestId);
    if (parent?.kind === 'dom-range') {
      const ancestor = parent.range.commonAncestorContainer;
      if (
        !ancestor.isConnected ||
        !markerTextStillMatches(parent.range.toString(), parent.sourceText)
      ) {
        markerAnchors.delete(result.requestId);
        parent = undefined;
      }
    }
    if (!parent && result.sourceKind === 'text') {
      const current = captureSelectionSnapshot('off');
      const currentText = current
        ? surface === 'pdf'
          ? normalizePdfSelectionText(current.normalizedText)
          : current.normalizedText
        : '';
      if (current && currentText === result.originalText.trim()) {
        parent = captureDomTranslationMarkerAnchor(current.normalizedText);
        if (parent) markerAnchors.set(result.requestId, parent);
      }
    }
    if (!segment) return parent;
    if (!parent || parent.kind !== 'dom-range') return undefined;
    const markerId = markerIdForTarget(result, segment);
    const existing = segmentMarkerAnchors.get(markerId);
    if (existing) return existing;
    try {
      const anchor = createSegmentTranslationMarkerAnchor(parent, segment.originalText);
      if (anchor) segmentMarkerAnchors.set(markerId, anchor);
      return anchor;
    } catch {
      return undefined;
    }
  }

  function bindCurrentSelectionMarkerAnchor(
    result: TranslateResult,
  ): TranslationMarkerAnchor | undefined {
    const current = captureSelectionSnapshot('off');
    if (!current) return undefined;
    const anchor = captureDomTranslationMarkerAnchor(current.normalizedText);
    if (!anchor) return undefined;
    markerAnchors.set(result.requestId, anchor);
    return anchor;
  }

  function stablePdfMarkerAnchor(
    anchor: TranslationMarkerAnchor | undefined,
  ): TranslationMarkerAnchor | undefined {
    if (surface !== 'pdf' || anchor?.kind !== 'dom-range') return anchor;
    const persisted = persistablePdfMarkerAnchor(anchor);
    if (!persisted || persisted.kind !== 'text-quote') return anchor;
    return {
      kind: 'pdf-text-quote',
      pageNumber: persisted.pageNumber,
      sourceText: persisted.sourceText,
      prefix: persisted.prefix,
      suffix: persisted.suffix,
    };
  }

  function markerPageNumber(anchor?: TranslationMarkerAnchor): number | undefined {
    if (!anchor) return undefined;
    if (anchor.kind === 'pdf-region') return anchor.sourceLocation.pageNumber;
    if (anchor.kind === 'pdf-text-quote') return anchor.pageNumber;
    const commonElement = anchor.range.commonAncestorContainer instanceof Element
      ? anchor.range.commonAncestorContainer
      : anchor.range.commonAncestorContainer.parentElement;
    const value = commonElement?.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber;
    const pageNumber = Number(value);
    return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
  }

  function markerContentForTarget(
    result: TranslateResult,
    segment?: TranslationSegment,
  ): TranslationMarkerContent {
    const anchor = markerAnchorForTarget(result, segment);
    const sourceTitle = surface === 'pdf'
      ? result.sourceHost ?? options.sourceLabel?.() ?? 'PDF 文档'
      : document.title.trim() || result.sourceHost || location.hostname || '网页';
    const pageNumber = result.sourceLocation?.pageNumber ?? markerPageNumber(anchor);
    return {
      originalText: segment?.originalText ?? result.originalText,
      translatedText: segment?.translatedText ?? result.translatedText,
      sourceTitle,
      ...(surface === 'pdf' ? {} : { sourceUrl: options.pageUrl?.() ?? location.href }),
      ...(pageNumber ? { pageNumber } : {}),
    };
  }

  function persistedMarkerForTarget(
    result: TranslateResult,
    segment?: TranslationSegment,
  ): PersistedPdfTranslationMarker | undefined {
    if (surface !== 'pdf') return undefined;
    const anchor = markerAnchorForTarget(result, segment);
    if (!anchor) return undefined;
    return persistPdfTranslationMarker({
      markerId: markerIdForTarget(result, segment),
      result,
      anchor,
      content: markerContentForTarget(result, segment),
    });
  }

  function markedMarkerIdForTarget(
    result: TranslateResult,
    segment?: TranslationSegment,
  ): string | undefined {
    const directId = markerIdForTarget(result, segment);
    if (markerManager?.isMarked(directId)) return directId;
    const rootRequestId = revisionRootRequestId(result);
    const targetSource = (segment?.originalText ?? result.originalText).trim();
    const revised = markerManager?.entries().find((entry) => (
      revisionRootRequestId(entry.result) === rootRequestId &&
      entry.content.originalText.trim() === targetSource &&
      (segment ? entry.markerId.includes('::segment:') : !entry.markerId.includes('::segment:'))
    ))?.markerId;
    if (revised) return revised;
    const target = persistedMarkerForTarget(result, segment);
    if (!target) return undefined;
    const targetKey = persistedPdfMarkerKey(target.anchor, target.content);
    const active = markerManager?.entries().find((entry) => {
      const persisted = persistPdfTranslationMarker(entry);
      return persisted && persistedPdfMarkerKey(persisted.anchor, persisted.content) === targetKey;
    })?.markerId;
    if (active) return active;
    return storedPersistentMarkers.find((marker) => (
      persistedPdfMarkerKey(marker.anchor, marker.content) === targetKey
    ))?.markerId;
  }

  function serializablePdfMarkers(): PersistedPdfTranslationMarker[] {
    return markerManager?.entries()
      .map(persistPdfTranslationMarker)
      .filter((marker): marker is PersistedPdfTranslationMarker => Boolean(marker)) ?? [];
  }

  function navigatorMarkerEntries() {
    const entries = markerManager?.entries() ?? [];
    const keys = new Set(entries.flatMap((entry) => {
      const persisted = persistPdfTranslationMarker(entry);
      return persisted ? [persistedPdfMarkerKey(persisted.anchor, persisted.content)] : [];
    }));
    const documentId = options.pdfMarkerPersistence?.currentDocumentId();
    if (!documentId) return entries;
    for (const marker of storedPersistentMarkers) {
      const key = persistedPdfMarkerKey(marker.anchor, marker.content);
      if (keys.has(key)) continue;
      keys.add(key);
      entries.push(restorePersistedPdfTranslationMarker(marker, documentId));
    }
    return entries;
  }

  function sourceMarkSummaries(): TranslationMarkerSummary[] {
    const active = new Map(
      (markerManager?.summaries() ?? []).map((summary) => [summary.markerId, summary]),
    );
    return navigatorMarkerEntries()
      .map((entry) => active.get(entry.markerId) ?? {
        markerId: entry.markerId,
        ...entry.content,
        createdAt: entry.result.completedAt ?? 0,
        locationState: 'pending' as const,
      })
      .sort((left, right) => (
        (left.pageNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt - right.createdAt
      ));
  }

  async function navigateSourceMark(
    markerId: string,
  ): Promise<TranslationMarkerLocationState> {
    let entry = markerManager?.entries().find((candidate) => candidate.markerId === markerId);
    if (!entry) {
      const stored = storedPersistentMarkers.find((candidate) => candidate.markerId === markerId);
      const documentId = options.pdfMarkerPersistence?.currentDocumentId();
      if (stored && documentId) {
        entry = restorePersistedPdfTranslationMarker(stored, documentId);
        markerManager?.add(entry);
      }
    }
    if (!entry) return 'missing';
    if (entry.anchor.kind === 'pdf-region') {
      await options.onNavigateToPdfRegion?.(entry.anchor.sourceLocation);
      const state = markerManager?.locationState(markerId) ?? 'missing';
      if (state === 'ready') markerManager?.focus(markerId);
      return state;
    }
    const pageNumber = entry.content.pageNumber ?? markerPageNumber(entry.anchor);
    if (pageNumber) await options.onNavigateToPdfMarker?.(pageNumber);
    return markerManager?.reveal(markerId) ?? 'missing';
  }

  async function removeSourceMark(markerId: string): Promise<void> {
    const activeEntry = markerManager?.entries().find((entry) => entry.markerId === markerId);
    const storedEntry = storedPersistentMarkers.find((marker) => marker.markerId === markerId);
    const target = activeEntry
      ? persistPdfTranslationMarker(activeEntry)
      : storedEntry;
    const targetKey = target
      ? persistedPdfMarkerKey(target.anchor, target.content)
      : undefined;
    const removedStoredIds = new Set<string>();
    storedPersistentMarkers = storedPersistentMarkers.filter((marker) => {
      const matches = marker.markerId === markerId || (
        targetKey && persistedPdfMarkerKey(marker.anchor, marker.content) === targetKey
      );
      if (matches) removedStoredIds.add(marker.markerId);
      return !matches;
    });
    markerManager?.remove(markerId);
    persistentStoredMarkerCount = storedPersistentMarkers.length;
    const removedHistoryIds = new Set([
      `pdf-marker:${markerId}`,
      ...[...removedStoredIds].map((id) => `pdf-marker:${id}`),
    ]);
    persistedMarkerHistory = persistedMarkerHistory.filter((entry) => (
      !removedHistoryIds.has(entry.historyId)
    ));
    const adapter = options.pdfMarkerPersistence;
    if (!adapter?.isAvailable() || (!removedStoredIds.size && !persistentMarkersEnabled)) return;
    const revision = persistenceRevision;
    const markers = persistentMarkersEnabled
      ? serializablePdfMarkers()
      : [...storedPersistentMarkers];
    await enqueuePersistenceWrite(async () => {
      if (revision !== persistenceRevision || !adapter.isAvailable()) return;
      await adapter.save(markers);
      storedPersistentMarkers = markers;
      persistentStoredMarkerCount = markers.length;
    });
  }

  function enqueuePersistenceWrite(task: () => Promise<void>): Promise<void> {
    const run = persistenceWriteQueue.catch(() => undefined).then(task);
    persistenceWriteQueue = run.catch(() => undefined);
    return run;
  }

  function queuePersistentMarkerSave(
    entries = markerManager?.entries() ?? [],
  ): void {
    const adapter = options.pdfMarkerPersistence;
    if (!persistentMarkersEnabled || !adapter?.isAvailable()) return;
    const revision = persistenceRevision;
    const markers = entries
      .map(persistPdfTranslationMarker)
      .filter((marker): marker is PersistedPdfTranslationMarker => Boolean(marker));
    void enqueuePersistenceWrite(async () => {
      if (
        revision !== persistenceRevision ||
        !persistentMarkersEnabled ||
        !adapter.isAvailable()
      ) return;
      await adapter.save(markers);
      storedPersistentMarkers = markers;
      persistentStoredMarkerCount = markers.length;
    });
  }

  function markerHistoryFromEntries(
    entries: ReturnType<SessionTranslationMarkerManager['entries']>,
  ): TranslationHistoryEntry[] {
    return entries.map((entry) => ({
      ...entry.result,
      historyId: `pdf-marker:${entry.markerId}`,
      createdAt: entry.result.completedAt ?? Date.now(),
    }));
  }

  function restoredMarkerEntries(markers: PersistedPdfTranslationMarker[]) {
    const documentId = options.pdfMarkerPersistence?.currentDocumentId();
    return documentId
      ? markers.map((marker) => restorePersistedPdfTranslationMarker(marker, documentId))
      : [];
  }

  function mergeRestoredMarkers(markers: PersistedPdfTranslationMarker[]): void {
    const current = markerManager?.entries() ?? [];
    const keys = new Set(
      current.flatMap((entry) => {
        const persisted = persistPdfTranslationMarker(entry);
        return persisted ? [persistedPdfMarkerKey(persisted.anchor, persisted.content)] : [];
      }),
    );
    const restored = restoredMarkerEntries(markers).filter((entry) => {
      const persisted = persistPdfTranslationMarker(entry);
      if (!persisted) return false;
      const key = persistedPdfMarkerKey(persisted.anchor, persisted.content);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    const entries = [...current, ...restored];
    markerManager?.replace(entries);
    persistedMarkerHistory = markerHistoryFromEntries(entries);
  }

  async function setPersistentMarkersEnabled(enabled: boolean): Promise<void> {
    const adapter = options.pdfMarkerPersistence;
    if (!adapter?.isAvailable()) return;
    const revision = persistenceRevision;
    await enqueuePersistenceWrite(async () => {
      if (revision !== persistenceRevision || !adapter.isAvailable()) return;
      await adapter.setEnabled(enabled);
    });
    if (revision !== persistenceRevision || !adapter.isAvailable()) return;
    persistentMarkersEnabled = enabled;
    if (!enabled) return;
    const state = await adapter.load();
    if (revision !== persistenceRevision || !adapter.isAvailable()) return;
    storedPersistentMarkers = state.markers;
    persistentStoredMarkerCount = state.markers.length;
    mergeRestoredMarkers(state.markers);
    await enqueuePersistenceWrite(async () => {
      if (
        revision !== persistenceRevision ||
        !persistentMarkersEnabled ||
        !adapter.isAvailable()
      ) return;
      const markers = serializablePdfMarkers();
      await adapter.save(markers);
      storedPersistentMarkers = markers;
      persistentStoredMarkerCount = markers.length;
    });
  }

  async function clearSourceMarks(): Promise<void> {
    const adapter = options.pdfMarkerPersistence;
    const revision = persistenceRevision;
    markerManager?.clear();
    persistedMarkerHistory = [];
    storedPersistentMarkers = [];
    persistentStoredMarkerCount = 0;
    if (!adapter?.isAvailable()) return;
    await enqueuePersistenceWrite(async () => {
      if (revision !== persistenceRevision || !adapter.isAvailable()) return;
      await adapter.clear();
      persistentStoredMarkerCount = 0;
    });
  }

  async function refreshPersistentMarkers(): Promise<void> {
    const adapter = options.pdfMarkerPersistence;
    const revision = ++persistenceRevision;
    persistentMarkersEnabled = false;
    persistedMarkerHistory = [];
    storedPersistentMarkers = [];
    persistentStoredMarkerCount = 0;
    if (!adapter?.isAvailable()) return;
    const state = await adapter.load().catch(() => undefined);
    if (!state || revision !== persistenceRevision || !adapter.isAvailable()) return;
    persistentMarkersEnabled = state.enabled;
    storedPersistentMarkers = state.markers;
    persistentStoredMarkerCount = state.markers.length;
    if (!state.enabled) return;
    const entries = restoredMarkerEntries(state.markers);
    markerManager?.replace(entries);
    persistedMarkerHistory = markerHistoryFromEntries(entries);
  }

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_PUBLIC_SETTINGS',
    } satisfies RuntimeMessage)) as PublicSettingsResponse;
    if (response.ok) {
      settings = response.data;
      options.onPublicSettingsChange?.(settings);
      temporaryTargetLanguage = settings.targetLanguage;
      temporaryStyle = settings.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarMode: settings.sidebarMode,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
        autoRenderLatex: settings.autoRenderLatex,
      });
    }
  } catch {
    // Defaults keep the content UI usable while the service worker restarts.
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'GET_CONTINUOUS_TRANSLATION_STATE',
    } satisfies RuntimeMessage) as RuntimeResponse<{ paused: boolean }>;
    if (response.ok) applyContinuousTranslationPaused(response.data.paused);
  } catch {
    // A temporary pause defaults to active translation after an unavailable
    // service worker rather than making the sidebar appear unresponsive.
  }

  function selectionRect(snapshot: SelectionSnapshot): ViewportRect | undefined {
    return snapshot.rect;
  }

  function webRegionSelectionForContext(
    context: TranslationRetryContext | undefined,
  ): WebRegionSelectionSeed | undefined {
    if (context?.kind === 'image') return context.capture.webRegionSelection;
    return context?.metadata?.webRegionSelection;
  }

  function webRegionSelectionForResult(
    result: TranslateResult,
  ): WebRegionSelectionSeed | undefined {
    return webRegionSelectionForContext(retryContextForResult(result));
  }

  function startWebRegionSelection(initialSelection?: WebRegionSelectionSeed): void {
    const restoreSidebarOnCancel = overlay.isSidebarActive();
    activeWebRegionSelection?.cancel();
    cancelActiveTranslation();
    failedWebRegionSelection = undefined;
    void browser.runtime.sendMessage({
      type: 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT',
    } satisfies RuntimeMessage).catch(() => undefined);
    overlay.hide();
    const handle = createWebRegionSelection(initialSelection);
    let attemptedSelection = initialSelection;
    activeWebRegionSelection = handle;
    void handle.result.then(async (region) => {
      if (activeWebRegionSelection !== handle) return;
      if (!region) {
        activeWebRegionSelection = undefined;
        if (restoreSidebarOnCancel) overlay.restoreSidebar();
        return;
      }
      const pageUrl = options.pageUrl?.() ?? location.href;
      const webRegionSelection: WebRegionSelectionSeed = {
        rect: region.rect,
        mode: region.mode,
      };
      attemptedSelection = webRegionSelection;
      const capture = await captureWebRegion(region.rect, pageUrl);
      if (activeWebRegionSelection !== handle) return;
      activeWebRegionSelection = undefined;
      capture.webRegionSelection = webRegionSelection;
      await translateImageRegion(capture);
    }).catch(async (error: unknown) => {
      if (activeWebRegionSelection !== handle) return;
      activeWebRegionSelection = undefined;
      failedWebRegionSelection = attemptedSelection;
      const permissionFailure = error instanceof WebRegionCaptureError &&
        error.kind === 'permission';
      if (permissionFailure) {
        await browser.runtime.sendMessage({
          type: 'PREPARE_WEB_CAPTURE_PERMISSION',
          payload: { intent: 'restore' },
        } satisfies RuntimeMessage).catch(() => undefined);
      }
      overlay.showError({
        message: permissionFailure
          ? 'Edge 还没有获得网页截图权限。完成一次授权后，Pi Translator 会自动恢复刚才的框选区域。'
          : error instanceof WebRegionCaptureError
            ? error.message
          : runtimeConnectionErrorMessage(error),
        showSettings: false,
        retryable: !permissionFailure,
        ...(permissionFailure ? { webCapturePermissionRecovery: true } : {}),
        ...(attemptedSelection ? { webRegionRecovery: true } : {}),
      }, attemptedSelection?.rect);
    });
  }

  async function startWebRegionSelectionWithPreflight(): Promise<void> {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'PREPARE_WEB_CAPTURE_PERMISSION',
        payload: { intent: 'start' },
      } satisfies RuntimeMessage) as RuntimeResponse<{
        ready: true;
        granted: boolean;
      }>;
      if (response.ok && !response.data.granted) {
        cancelActiveTranslation();
        failedWebRegionSelection = undefined;
        overlay.showWebCapturePermissionPrompt();
        return;
      }
    } catch {
      // Fall through to the existing capture recovery path if the service
      // worker restarts while checking the optional permission.
    }
    startWebRegionSelection();
  }

  function rememberMarkerAnchor(
    requestId: string,
    sourceText: string,
    sourceLocation?: PdfSourceLocation,
  ): void {
    if (markerAnchors.has(requestId)) return;
    const anchor: TranslationMarkerAnchor | undefined = sourceLocation
      ? { kind: 'pdf-region', sourceLocation }
      : captureDomTranslationMarkerAnchor(sourceText);
    if (anchor) markerAnchors.set(requestId, anchor);
  }

  function rememberSelectionMarkerAnchor(snapshot: SelectionSnapshot): void {
    if (
      pendingSelectionMarkerRequestId &&
      pendingSelectionMarkerRequestId !== snapshot.requestId &&
      pendingSelectionMarkerRequestId !== activeSelection?.requestId
    ) {
      markerAnchors.delete(pendingSelectionMarkerRequestId);
    }
    rememberMarkerAnchor(snapshot.requestId, snapshot.normalizedText);
    pendingSelectionMarkerRequestId = markerAnchors.has(snapshot.requestId)
      ? snapshot.requestId
      : undefined;
  }

  function refreshSelection(): void {
    if (surface === 'pdf' && pdfSelectionInProgress) {
      overlay.hideTrigger();
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      return;
    }
    if (overlay.ownsCurrentSelection()) return;
    const snapshot = captureSelectionSnapshot(settings.contextMode);
    latestSelection = snapshot;
    if (snapshot) rememberSelectionMarkerAnchor(snapshot);
    const suppressPassiveTranslation = Boolean(
      snapshot && shouldSuppressPassiveSelectionTranslation(snapshot, surface),
    );
    if (overlay.isSidebarActive() || browserSidebarActive) {
      overlay.hideTrigger();
      if (continuousTranslationPaused) {
        if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
        autoTranslateTimer = undefined;
        return;
      }
      if (
        !snapshot ||
        (surface === 'general' &&
          settings.hideFloatingButtonForTargetLanguage &&
          isLikelyTargetLanguage(snapshot.normalizedText, temporaryTargetLanguage)) ||
        snapshot.selectionHash === lastAutoSelectionHash
      ) {
        return;
      }
      if (settings.protectSensitiveFields && snapshot.sensitiveField) {
        lastAutoSelectionHash = snapshot.selectionHash;
        if (!browserSidebarActive) overlay.showSensitiveNotice(selectionRect(snapshot));
        return;
      }
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      if (options.selectionPreview?.(snapshot)?.suppressAutoTranslate) {
        lastAutoSelectionHash = snapshot.selectionHash;
        return;
      }
      autoTranslateTimer = setTimeout(() => {
        const current = captureSelectionSnapshot(settings.contextMode);
        if (!current || current.selectionHash !== snapshot.selectionHash) return;
        lastAutoSelectionHash = snapshot.selectionHash;
        void translateSelection(snapshot);
      }, 220);
      return;
    }
    if (!snapshot || snapshot.selectionHash !== dismissedPassiveSelectionHash) {
      dismissedPassiveSelectionHash = undefined;
    }
    if (snapshot?.selectionHash === dismissedPassiveSelectionHash) {
      overlay.hideTrigger();
      return;
    }
    if (!shouldShowFloatingButton(settings, surface)) {
      overlay.hideTrigger();
      return;
    }
    if (suppressPassiveTranslation) {
      overlay.hideTrigger();
      return;
    }
    if (
      surface === 'general' &&
      settings.hideFloatingButtonForTargetLanguage &&
      snapshot &&
      isLikelyTargetLanguage(snapshot.normalizedText, temporaryTargetLanguage)
    ) {
      overlay.hideTrigger();
      return;
    }
    if (snapshot?.rect) {
      if (
        overlay.isShowingCard() &&
        activeSelection?.selectionHash === snapshot.selectionHash
      ) {
        overlay.keepCardInViewport();
        return;
      }
      if (overlay.isShowingCard()) cancelActiveTranslation();
      overlay.showTrigger(snapshot.rect, options.selectionPreview?.(snapshot));
    } else {
      overlay.hideTrigger();
    }
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (surface === 'pdf' && pdfSelectionInProgress) return;
    refreshTimer = setTimeout(refreshSelection, surface === 'pdf' ? 100 : 60);
  }

  function beginPdfSelection(event: PointerEvent): void {
    if (
      surface !== 'pdf' ||
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element) ||
      !event.target.closest('.textLayer')
    ) return;
    pdfSelectionPointerId = event.pointerId;
    pdfSelectionInProgress = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
    overlay.hideTrigger();
  }

  function finishPdfSelection(event: PointerEvent): void {
    if (
      surface !== 'pdf' ||
      !pdfSelectionInProgress ||
      event.pointerId !== pdfSelectionPointerId
    ) return;
    pdfSelectionPointerId = undefined;
    pdfSelectionInProgress = false;
    scheduleRefresh();
  }

  function revisionRootRequestId(result: TranslateResult): string {
    return result.revision?.rootRequestId ?? result.requestId;
  }

  function rememberResultRetryContext(
    result: TranslateResult,
    context: TranslationRetryContext | undefined,
  ): void {
    if (!context) return;
    resultRetryContexts.delete(result.requestId);
    resultRetryContexts.set(result.requestId, context);
    while (resultRetryContexts.size > 18) {
      const oldest = resultRetryContexts.keys().next().value as string | undefined;
      if (!oldest) break;
      resultRetryContexts.delete(oldest);
    }
  }

  function retryContextForResult(result: TranslateResult): TranslationRetryContext | undefined {
    return resultRetryContexts.get(result.requestId) ??
      resultRetryContexts.get(revisionRootRequestId(result));
  }

  function revisionRequestForResult(
    result: TranslateResult,
    adjustment: TranslationAdjustmentRequest,
  ): TranslationRevisionRequest {
    return {
      rootRequestId: revisionRootRequestId(result),
      kind: adjustment.kind,
      label: adjustment.label,
      instruction: adjustment.instruction.slice(0, 500),
      previousTranslation: result.translatedText,
      scope: adjustment.scope,
      ...(result.sourceKind ? { sourceKind: result.sourceKind } : {}),
      ...(result.formulaLatex?.length ? { formulaLatex: [...result.formulaLatex] } : {}),
      ...(result.uncertainSpans?.length ? { uncertainSpans: [...result.uncertainSpans] } : {}),
      ...(result.formulaNeedsReview ? { formulaNeedsReview: true } : {}),
    };
  }

  function cloneSnapshotForRetry(snapshot: SelectionSnapshot): SelectionSnapshot {
    const requestId = crypto.randomUUID();
    const anchor = markerAnchors.get(snapshot.requestId);
    if (anchor) markerAnchors.set(requestId, anchor);
    return {
      ...snapshot,
      requestId,
      capturedAt: Date.now(),
      // A retry is still tied to the same DOM/PDF selection. Keep the stable
      // selection hash so a delayed settings refresh does not mistake the new
      // request id for a changed selection and cancel the recovery request.
      selectionHash: snapshot.selectionHash,
    };
  }

  async function replayRetryContext(context: TranslationRetryContext): Promise<void> {
    if (context.kind === 'image') {
      await translateImageRegion(context.capture, true, context.revision);
      return;
    }
    await translate(
      cloneSnapshotForRetry(context.snapshot),
      true,
      context.metadata,
      context.revision,
    );
  }

  async function retryTranslation(target: OverlayRetryTarget): Promise<void> {
    if (target.kind === 'failed') {
      const context = activeRetryContext;
      pendingSettingsRecovery = undefined;
      activePartialText = undefined;
      if (context) await replayRetryContext(context);
      return;
    }
    const context = retryContextForResult(target.result);
    if (
      target.intent === 'repeat' &&
      target.result.sourceKind === 'image-region' &&
      context?.kind === 'image'
    ) {
      const imageRevision = revisionRequestForResult(
        target.result,
        {
          kind: 'custom',
          label: '重新识别',
          instruction: 'Recognize the same image region again and regenerate the translation.',
          // Re-recognition corrects the source extraction rather than merely
          // offering an alternate wording. Replace the cached/document copy
          // so reopening the same region cannot resurrect stale OCR text.
          scope: 'document',
        },
      );
      delete imageRevision.formulaLatex;
      delete imageRevision.uncertainSpans;
      delete imageRevision.formulaNeedsReview;
      await translateImageRegion(context.capture, true, imageRevision);
      return;
    }
    await adjustTranslation(target.result, {
      kind: 'custom',
      label: target.intent === 'language-change' ? '切换目标语言' : '重新翻译',
      instruction: target.intent === 'language-change'
        ? 'Translate the source into the newly selected target language while preserving all technical details and formulas.'
        : 'Regenerate the current translation while preserving deliberate terminology and formula corrections.',
      scope: 'current',
    });
  }

  async function retranslateBrowserSidebarInLanguage(
    expectedRequestId: string,
    targetLanguage: string,
    result?: TranslateResult,
  ): Promise<RuntimeResponse<{ started: true }>> {
    if (surface === 'pdf' || !browserSidebarActive) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_PAGE',
          message: '当前网页没有使用浏览器侧栏。',
          retryable: false,
        },
      };
    }
    if (inFlightRequestId) {
      return {
        ok: false,
        error: {
          code: 'REQUEST_ABORTED',
          message: '当前翻译尚未完成，请稍后再切换目标语言。',
          retryable: false,
        },
      };
    }
    if (!result && activeSelection?.requestId !== expectedRequestId) {
      return {
        ok: false,
        error: {
          code: 'REQUEST_ABORTED',
          message: '当前网页已无法恢复这次翻译，请重新划选。',
          retryable: false,
        },
      };
    }

    temporaryTargetLanguage = targetLanguage;
    overlay.setPreferences({
      targetLanguage: temporaryTargetLanguage,
      style: temporaryStyle,
      sidebarMode: settings.sidebarMode,
      sidebarSide: settings.sidebarSide,
      sidebarWidth: settings.sidebarWidth,
      autoRenderLatex: settings.autoRenderLatex,
    });
    if (result) {
      await retryTranslation({ kind: 'result', result, intent: 'language-change' });
    } else if (activeRetryContext) {
      await replayRetryContext(activeRetryContext);
    } else {
      return {
        ok: false,
        error: {
          code: 'REQUEST_ABORTED',
          message: '当前网页已无法恢复这次翻译，请重新划选。',
          retryable: false,
        },
      };
    }
    return { ok: true, data: { started: true } };
  }

  function carryRevisionAnchor(result: TranslateResult, requestId: string): void {
    const rootRequestId = revisionRootRequestId(result);
    const markerEntry = markerManager?.entries().find((entry) => (
      entry.markerId === result.requestId ||
      entry.result.requestId === result.requestId ||
      revisionRootRequestId(entry.result) === rootRequestId
    ));
    const anchor = markerAnchors.get(result.requestId) ??
      markerAnchors.get(rootRequestId) ??
      markerEntry?.anchor;
    if (anchor) markerAnchors.set(requestId, anchor);
  }

  function syncRevisionMarkers(result: TranslateResult): void {
    const revision = result.revision;
    if (!revision) return;
    carryRevisionAnchor(result, result.requestId);
    let updated = markerManager?.updateResult(revision.rootRequestId, result) ?? 0;
    const target = persistedMarkerForTarget(result);
    const targetKey = target
      ? persistedPdfMarkerKey(target.anchor, target.content)
      : undefined;
    if (!updated && targetKey) {
      const matchingRoots = new Set(
        (markerManager?.entries() ?? []).flatMap((entry) => {
          const persisted = persistPdfTranslationMarker(entry);
          if (!persisted || persistedPdfMarkerKey(persisted.anchor, persisted.content) !== targetKey) {
            return [];
          }
          return [revisionRootRequestId(entry.result)];
        }),
      );
      for (const rootRequestId of matchingRoots) {
        updated += markerManager?.updateResult(rootRequestId, result) ?? 0;
      }
    }
    const entries = markerManager?.entries() ?? [];
    persistedMarkerHistory = markerHistoryFromEntries(entries);
    if (persistentMarkersEnabled || (!updated && !targetKey)) return;
    const adapter = options.pdfMarkerPersistence;
    if (!adapter?.isAvailable() || !storedPersistentMarkers.length) return;
    const activeById = new Map(
      entries.flatMap((entry) => {
        const persisted = persistPdfTranslationMarker(entry);
        return persisted ? [[persisted.markerId, persisted] as const] : [];
      }),
    );
    let changed = false;
    const nextStored = storedPersistentMarkers.map((stored) => {
      const replacement = activeById.get(stored.markerId);
      if (replacement) {
        changed ||= (
          replacement.content.originalText !== stored.content.originalText ||
          replacement.content.translatedText !== stored.content.translatedText
        );
        return replacement;
      }
      const storedRootRequestId = stored.markerId.replace(
        /::(?:full|segment:[^:]+)$/u,
        '',
      );
      if (storedRootRequestId === revision.rootRequestId) {
        const segmentId = stored.markerId.match(/::segment:(.+)$/u)?.[1];
        const segment = segmentId
          ? result.alignedSegments?.find((candidate) => candidate.id === segmentId)
          : undefined;
        if (segmentId && !segment) return stored;
        const originalText = segment?.originalText ?? result.originalText;
        const translatedText = segment?.translatedText ?? result.translatedText;
        changed ||= (
          stored.content.originalText !== originalText ||
          stored.content.translatedText !== translatedText
        );
        return {
          ...stored,
          content: { ...stored.content, originalText, translatedText },
          createdAt: result.completedAt ?? stored.createdAt,
        };
      }
      if (
        targetKey &&
        persistedPdfMarkerKey(stored.anchor, stored.content) === targetKey
      ) {
        changed ||= stored.content.translatedText !== result.translatedText;
        return {
          ...stored,
          content: { ...stored.content, translatedText: result.translatedText },
          createdAt: result.completedAt ?? stored.createdAt,
        };
      }
      return stored;
    });
    if (!changed) return;
    storedPersistentMarkers = nextStored;
    const revisionNumber = persistenceRevision;
    void enqueuePersistenceWrite(async () => {
      if (revisionNumber !== persistenceRevision || !adapter.isAvailable()) return;
      await adapter.save(nextStored);
      persistentStoredMarkerCount = nextStored.length;
    });
  }

  async function saveTranslationEdit(
    result: TranslateResult,
    translatedText: string,
    scope: TranslationMemoryScope,
    term?: TranslationCorrectionTermInput,
  ): Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    correctionReceipt?: TranslationCorrectionReceipt;
  }> {
    const requestId = crypto.randomUUID();
    const rootRequestId = revisionRootRequestId(result);
    carryRevisionAnchor(result, requestId);
    const edited: TranslateResult = {
      ...result,
      requestId,
      translatedText: translatedText.trim(),
      completedAt: Date.now(),
      cached: false,
      latencyMs: 0,
      revision: {
        rootRequestId,
        kind: 'manual',
        label: '手动修改',
        scope,
      },
    };
    delete edited.alignedSegments;
    const response = await browser.runtime.sendMessage({
      type: 'UPDATE_TRANSLATION_RESULT',
      payload: {
        ...documentLocatorForResult(result),
        result: edited,
        scope,
        previousTranslatedText: result.translatedText,
        baseRequestId: result.requestId,
        ...(term ? { term } : {}),
      },
    } satisfies RuntimeMessage) as UpdateTranslationResultResponse;
    if (!response.ok) {
      throw new Error(
        translationCorrectionErrorMessage(response.error.code, response.error.message),
      );
    }
    overlayHistory = response.data.history;
    rememberResultRetryContext(response.data.result, retryContextForResult(result));
    syncRevisionMarkers(response.data.result);
    return {
      result: response.data.result,
      history: combinedOverlayHistory(),
      ...(response.data.correctionReceipt
        ? { correctionReceipt: response.data.correctionReceipt }
        : {}),
    };
  }

  async function undoTranslationEdit(
    result: TranslateResult,
    receipt: TranslationCorrectionReceipt,
  ): Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    termRollbackSkipped?: boolean;
  }> {
    const response = await browser.runtime.sendMessage({
      type: 'UNDO_TRANSLATION_RESULT',
      payload: {
        ...documentLocatorForResult(result),
        result,
        receipt,
      },
    } satisfies RuntimeMessage) as UpdateTranslationResultResponse;
    if (!response.ok) {
      throw new Error(
        translationCorrectionErrorMessage(response.error.code, response.error.message),
      );
    }
    overlayHistory = response.data.history;
    rememberResultRetryContext(response.data.result, retryContextForResult(result));
    syncRevisionMarkers(response.data.result);
    return {
      result: response.data.result,
      history: combinedOverlayHistory(),
      ...(response.data.termRollbackSkipped ? { termRollbackSkipped: true } : {}),
    };
  }

  async function saveSegmentTranslationEdit(
    result: TranslateResult,
    segmentId: string,
    expectedTranslatedText: string,
    correctedTranslatedText: string,
  ): Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    correctionReceipt?: TranslationCorrectionReceipt;
  }> {
    carryRevisionAnchor(result, result.requestId);
    const response = await browser.runtime.sendMessage({
      type: 'UPDATE_TRANSLATION_SEGMENT',
      payload: {
        ...documentLocatorForResult(result),
        result,
        segmentId,
        expectedTranslatedText,
        correctedTranslatedText,
      },
    } satisfies RuntimeMessage) as UpdateTranslationResultResponse;
    if (!response.ok) {
      throw new Error(
        translationCorrectionErrorMessage(response.error.code, response.error.message),
      );
    }
    overlayHistory = response.data.history;
    carryRevisionAnchor(result, response.data.result.requestId);
    rememberResultRetryContext(response.data.result, retryContextForResult(result));
    syncRevisionMarkers(response.data.result);
    return {
      result: response.data.result,
      history: combinedOverlayHistory(),
      ...(response.data.correctionReceipt
        ? { correctionReceipt: response.data.correctionReceipt }
        : {}),
    };
  }

  async function adjustTranslation(
    result: TranslateResult,
    adjustment: TranslationAdjustmentRequest,
  ): Promise<void> {
    const text = result.originalText.trim();
    if (!text) return;
    const requestId = crypto.randomUUID();
    carryRevisionAnchor(result, requestId);
    const sourceContext = retryContextForResult(result);
    const contextSnapshot = sourceContext?.kind === 'text'
      ? sourceContext.snapshot
      : undefined;
    const activeBasis = activeSelection &&
      activeSelection.normalizedText.trim() === text &&
      (
        activeSelection.requestId === result.requestId ||
        activeSelection.requestId === revisionRootRequestId(result)
      )
      ? activeSelection
      : undefined;
    const basis = contextSnapshot?.normalizedText.trim() === text
      ? contextSnapshot
      : activeBasis;
    const locator = documentLocatorForResult(result);
    const resultRect = sourceContext?.kind === 'image'
      ? sourceContext.capture.rect
      : basis?.rect;
    const snapshot: SelectionSnapshot = {
      requestId,
      sourceText: text,
      normalizedText: text,
      source: basis?.source ?? 'window-selection',
      pageUrl: locator.pageUrl,
      capturedAt: Date.now(),
      selectionHash: `${requestId}:${text.length}`,
      ...(basis?.contextText ? { contextText: basis.contextText } : {}),
      ...(resultRect ? { rect: resultRect } : {}),
    };
    await translate(snapshot, true, {
      ...(locator.sourceLabel ? { sourceLabel: locator.sourceLabel } : {}),
      ...(result.sourceLocation ? { sourceLocation: result.sourceLocation } : {}),
      ...(webRegionSelectionForContext(sourceContext)
        ? { webRegionSelection: webRegionSelectionForContext(sourceContext)! }
        : {}),
    }, revisionRequestForResult(result, adjustment));
  }

  async function translate(
    snapshot: SelectionSnapshot,
    bypassCache = false,
    metadata?: TextTranslationMetadata,
    revision?: TranslationRevisionRequest,
  ): Promise<void> {
    const useBrowserSidebar = surface !== 'pdf' && browserSidebarActive;
    failedWebRegionSelection = metadata?.webRegionSelection;
    pendingSettingsRecovery = undefined;
    activePartialText = undefined;
    if (inFlightRequestId && inFlightRequestId !== snapshot.requestId) {
      const previousRequestId = inFlightRequestId;
      void browser.runtime.sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId: previousRequestId },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    if (!bypassCache) overlay.resetCardPosition();
    activeImageRegion = undefined;
    activePdfRegionLocation = metadata?.sourceLocation;
    activeTextMetadata = metadata;
    activeSelection = snapshot;
    activeRetryContext = {
      kind: 'text',
      snapshot,
      ...(metadata ? { metadata } : {}),
      ...(revision ? { revision } : {}),
    };
    inFlightRequestId = snapshot.requestId;
    completedEarlyRequestId = undefined;
    if (pendingSelectionMarkerRequestId === snapshot.requestId) {
      pendingSelectionMarkerRequestId = undefined;
    }
    rememberMarkerAnchor(
      snapshot.requestId,
      snapshot.normalizedText,
      metadata?.sourceLocation,
    );
    if (useBrowserSidebar) overlay.hide();
    else overlay.showLoading(snapshot.requestId, selectionRect(snapshot));
    const sourceLabel = metadata?.sourceLabel ?? options.sourceLabel?.();
    const documentId = options.documentId?.();
    const requestText = surface === 'pdf'
      ? normalizePdfSelectionText(snapshot.normalizedText)
      : snapshot.normalizedText;
    const requestContext = snapshot.contextText
      ? surface === 'pdf'
        ? normalizePdfSelectionText(snapshot.contextText)
        : snapshot.contextText
      : undefined;
    try {
      const payload = {
          requestId: snapshot.requestId,
          ...(documentId ? { documentId } : {}),
          text: requestText,
          pageUrl: options.pageUrl?.() ?? snapshot.pageUrl,
          ...(sourceLabel ? { sourceLabel } : {}),
          targetLanguage: temporaryTargetLanguage,
          sourceLanguage: settings.sourceLanguage,
          style: temporaryStyle,
          contentMode: settings.contentMode,
          ...(requestContext ? { contextText: requestContext } : {}),
          ...(bypassCache ? { bypassCache: true } : {}),
          ...(metadata?.sourceLocation ? { sourceLocation: metadata.sourceLocation } : {}),
          ...(metadata?.clientPerformance
            ? { clientPerformance: metadata.clientPerformance }
            : {}),
          ...(revision ? { revision } : {}),
        };
      const requestMessage: RuntimeMessage = useBrowserSidebar
        ? { type: 'TRANSLATE_SELECTION_IN_BROWSER_SIDEBAR', payload }
        : { type: 'TRANSLATE_SELECTION', payload };
      const response = (await browser.runtime.sendMessage(requestMessage)) as TranslateRuntimeResponse;

      if (activeSelection?.requestId !== snapshot.requestId) return;
      const alreadyRendered = completedEarlyRequestId === snapshot.requestId;
      inFlightRequestId = undefined;
      if (response.ok) {
        failedWebRegionSelection = undefined;
        activePartialText = undefined;
        rememberResultRetryContext(response.data.result, activeRetryContext);
        syncRevisionMarkers(response.data.result);
        overlay.refreshDocumentMemory();
        const responseRequestId = response.data.result.requestId;
        const anchor = markerAnchors.get(snapshot.requestId);
        if (anchor && responseRequestId !== snapshot.requestId) {
          markerAnchors.set(responseRequestId, anchor);
        }
        overlayHistory = response.data.history;
        if (useBrowserSidebar) return;
        if (alreadyRendered) {
          overlay.updateHistory(combinedOverlayHistory());
          completedEarlyRequestId = undefined;
          return;
        }
        overlay.showResult(
          response.data.result,
          selectionRect(snapshot),
          combinedOverlayHistory(),
          settings.sentenceAlignmentDefault,
        );
        return;
      }
      if (useBrowserSidebar) return;
      const message = translationErrorMessage(
        response.error.code,
        response.error.message,
      );
      const recovery = translationErrorRecovery(
        response.error.code,
        response.error.retryable,
        'text',
      );
      overlay.showError(
        {
          message,
          showSettings: Boolean(recovery.settingsFocus),
          retryable: recovery.showRetry,
          ...(currentPartialOutput() ? { partialText: currentPartialOutput() } : {}),
          ...(recovery.settingsFocus ? { settingsFocus: recovery.settingsFocus } : {}),
          ...(recovery.settingsLabel ? { settingsLabel: recovery.settingsLabel } : {}),
          ...(recovery.settingsFocus
            ? {
                settingsRecovery: {
                  role: 'text',
                  errorCode: response.error.code,
                  failedRequestId: snapshot.requestId,
                  hadPartialOutput: hasActivePartialOutput(),
                  autoResume: Boolean(recovery.autoResumeAfterSettings),
                  clientId: recoveryClientId,
                },
              }
            : {}),
          ...(metadata?.webRegionSelection ? { webRegionRecovery: true } : {}),
        },
        selectionRect(snapshot),
      );
    } catch (error) {
      if (activeSelection?.requestId !== snapshot.requestId) return;
      if (completedEarlyRequestId === snapshot.requestId) return;
      inFlightRequestId = undefined;
      if (useBrowserSidebar) return;
      overlay.showError(
        {
          message: runtimeConnectionErrorMessage(error),
          showSettings: false,
          retryable: true,
          ...(currentPartialOutput() ? { partialText: currentPartialOutput() } : {}),
          ...(metadata?.webRegionSelection ? { webRegionRecovery: true } : {}),
        },
        selectionRect(snapshot),
      );
    }
  }

  async function translateSelection(snapshot: SelectionSnapshot): Promise<void> {
    const requiresPdfVision = surface === 'pdf' && shouldUseVisionForPdfFormula(
      normalizePdfSelectionText(snapshot.normalizedText),
    );
    if (options.captureVisualSelection && snapshot.source === 'window-selection') {
      try {
        const captureStartedAt = performance.now();
        const capture = await options.captureVisualSelection(snapshot);
        if (capture) {
          capture.clientPerformance = {
            ...capture.clientPerformance,
            captureMs: Math.max(0, performance.now() - captureStartedAt),
          };
          await translateImageRegion(capture);
          return;
        }
      } catch {
        // Formula selections are handled below. Plain text may still use the
        // selectable PDF text layer when visual capture is unavailable.
      }
    }
    if (requiresPdfVision) {
      activeSelection = snapshot;
      activeImageRegion = undefined;
      activePdfRegionLocation = undefined;
      activeTextMetadata = undefined;
      const message = snapshot.source === 'window-selection'
        ? '检测到选区中包含公式，但没有成功获取 PDF 页面截图。为了避免破坏公式，本次没有降级到文字 API。请重新划选后重试，或使用“框选翻译”。'
        : '检测到选中内容包含公式，但右键菜单打开后无法安全获取原选区截图。请关闭菜单后重新划选并点击浮动按钮，或使用“框选翻译”。';
      overlay.showError({ message, showSettings: false, retryable: false }, selectionRect(snapshot));
      return;
    }
    await translate(snapshot);
  }

  async function translateImageRegion(
    capture: ImageRegionTranslationCapture,
    isRetry = false,
    revision?: TranslationRevisionRequest,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    failedWebRegionSelection = capture.webRegionSelection;
    pendingSettingsRecovery = undefined;
    activePartialText = undefined;
    if (inFlightRequestId) {
      const previousRequestId = inFlightRequestId;
      void browser.runtime.sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId: previousRequestId },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    if (!isRetry) overlay.resetCardPosition();
    activeSelection = capture.sourceSelection;
    activeImageRegion = capture;
    activePdfRegionLocation = capture.selectionReference;
    activeTextMetadata = undefined;
    activeRetryContext = {
      kind: 'image',
      capture,
      ...(revision ? { revision } : {}),
    };
    inFlightRequestId = requestId;
    completedEarlyRequestId = undefined;
    if (capture.selectionReference) {
      rememberMarkerAnchor(requestId, '', capture.selectionReference);
    } else if (capture.sourceSelection) {
      rememberMarkerAnchor(requestId, capture.sourceSelection.normalizedText);
    }
    overlay.showLoading(requestId, capture.rect);
    const documentId = options.documentId?.();
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_IMAGE_REGION',
        payload: {
          requestId,
          ...(documentId ? { documentId } : {}),
          imageDataUrl: capture.imageDataUrl,
          imageWidth: capture.imageWidth,
          imageHeight: capture.imageHeight,
          ...(capture.recognizedTextHint
            ? { recognizedTextHint: capture.recognizedTextHint }
            : {}),
          pageUrl: capture.pageUrl,
          ...(capture.sourceLabel ? { sourceLabel: capture.sourceLabel } : {}),
          targetLanguage: temporaryTargetLanguage,
          sourceLanguage: settings.sourceLanguage,
          style: temporaryStyle,
          ...(isRetry ? { bypassCache: true } : {}),
          ...(capture.selectionReference
            ? { sourceLocation: capture.selectionReference }
            : {}),
          ...(capture.clientPerformance
            ? { clientPerformance: capture.clientPerformance }
            : {}),
          ...(revision ? { revision } : {}),
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;
      if (inFlightRequestId !== requestId && completedEarlyRequestId !== requestId) return;
      const alreadyRendered = completedEarlyRequestId === requestId;
      inFlightRequestId = undefined;
      if (response.ok) {
        failedWebRegionSelection = undefined;
        activePartialText = undefined;
        rememberResultRetryContext(response.data.result, activeRetryContext);
        syncRevisionMarkers(response.data.result);
        overlay.refreshDocumentMemory();
        overlayHistory = response.data.history;
        if (alreadyRendered) {
          overlay.updateHistory(combinedOverlayHistory());
          completedEarlyRequestId = undefined;
          return;
        }
        overlay.showResult(
          response.data.result,
          capture.rect,
          combinedOverlayHistory(),
          false,
        );
        return;
      }
      const recovery = translationErrorRecovery(
        response.error.code,
        response.error.retryable,
        'vision',
      );
      overlay.showError(
        {
          message: translationErrorMessage(response.error.code, response.error.message),
          showSettings: Boolean(recovery.settingsFocus),
          retryable: recovery.showRetry,
          ...(currentPartialOutput() ? { partialText: currentPartialOutput() } : {}),
          ...(recovery.settingsFocus ? { settingsFocus: recovery.settingsFocus } : {}),
          ...(recovery.settingsLabel ? { settingsLabel: recovery.settingsLabel } : {}),
          ...(recovery.settingsFocus
            ? {
                settingsRecovery: {
                  role: 'vision',
                  errorCode: response.error.code,
                  failedRequestId: requestId,
                  hadPartialOutput: hasActivePartialOutput(),
                  autoResume: Boolean(recovery.autoResumeAfterSettings),
                  clientId: recoveryClientId,
                },
              }
            : {}),
          ...(capture.webRegionSelection ? { webRegionRecovery: true } : {}),
        },
        capture.rect,
      );
    } catch (error) {
      if (inFlightRequestId !== requestId && completedEarlyRequestId !== requestId) return;
      if (completedEarlyRequestId === requestId) return;
      inFlightRequestId = undefined;
      overlay.showError(
        {
          message: runtimeConnectionErrorMessage(error),
          showSettings: false,
          retryable: true,
          ...(currentPartialOutput() ? { partialText: currentPartialOutput() } : {}),
          ...(capture.webRegionSelection ? { webRegionRecovery: true } : {}),
        },
        capture.rect,
      );
    }
  }

  async function translatePdfRegionText(
    capture: PdfRegionTextTranslationCapture,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    await translate({
      requestId,
      sourceText: capture.text,
      normalizedText: capture.text.trim(),
      source: 'window-selection',
      pageUrl: capture.pageUrl,
      capturedAt: Date.now(),
      selectionHash: `${requestId}:${capture.text.length}`,
      rect: capture.rect,
    }, false, {
      ...(capture.sourceLabel ? { sourceLabel: capture.sourceLabel } : {}),
      sourceLocation: capture.sourceLocation,
      ...(capture.clientPerformance ? { clientPerformance: capture.clientPerformance } : {}),
    });
  }

  const messageListener = (
    message: unknown,
  ): void | Promise<SettingsRecoveryAck | RuntimeResponse<{ started: true }>> => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const typed = message as RuntimeMessage;
    if (typed.type === 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION') {
      return retranslateBrowserSidebarInLanguage(
        typed.payload.expectedRequestId,
        typed.payload.targetLanguage,
        typed.payload.result,
      );
    }
    if (typed.type === 'SETTINGS_RECOVERY_READY') {
      const payload: SettingsRecoveryReadyPayload = typed.payload;
      const pending = pendingSettingsRecovery;
      if (
        payload.targetKind === 'native-pdf' ||
        !pending ||
        payload.token !== pending.token ||
        payload.failedRequestId !== pending.failedRequestId ||
        payload.clientId !== recoveryClientId
      ) {
        // runtime.sendMessage accepts only one listener response. Non-target
        // Pi PDF pages must stay silent so they cannot win the response race
        // against the page that owns this recovery token/client id.
        return;
      }
      const currentPageUrl = options.pageUrl?.() ?? location.href;
      if (!sameExtensionPage(pending.pageUrl, currentPageUrl)) {
        pendingSettingsRecovery = undefined;
        return Promise.resolve({
          handled: false,
          resumed: false,
          requiresConfirmation: true,
        });
      }
      pendingSettingsRecovery = undefined;
      activeRetryContext = pending.context;
      temporaryTargetLanguage = pending.targetLanguage;
      temporaryStyle = pending.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarMode: settings.sidebarMode,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
        autoRenderLatex: settings.autoRenderLatex,
      });
      const requiresConfirmation = payload.hadPartialOutput ||
        !payload.autoResume ||
        Boolean(pending.partialText?.trim());
      if (requiresConfirmation) {
        overlay.showSettingsRecoveryConfirmation(
          pending.partialText,
          pending.context.kind === 'image'
            ? pending.context.capture.rect
            : selectionRect(pending.context.snapshot),
        );
        return Promise.resolve({
          handled: true,
          resumed: false,
          requiresConfirmation: true,
        });
      }
      activePartialText = undefined;
      void replayRetryContext(pending.context);
      return Promise.resolve({
        handled: true,
        resumed: true,
        requiresConfirmation: false,
      });
    }
    if (typed.type === 'TRANSLATION_PROGRESS') {
      if (typed.payload.requestId === inFlightRequestId) {
        if (browserSidebarActive && surface !== 'pdf') return;
        if (typed.payload.result) {
          activePartialText = undefined;
          const result = typed.payload.result;
          rememberResultRetryContext(result, activeRetryContext);
          syncRevisionMarkers(result);
          const snapshot = activeSelection;
          const anchor = markerAnchors.get(typed.payload.requestId);
          if (anchor && result.requestId !== typed.payload.requestId) {
            markerAnchors.set(result.requestId, anchor);
          }
          completedEarlyRequestId = typed.payload.requestId;
          inFlightRequestId = undefined;
          overlay.showResult(
            result,
            activeImageRegion?.rect ?? (snapshot ? selectionRect(snapshot) : undefined),
            combinedOverlayHistory(),
            result.sourceKind !== 'image-region' && settings.sentenceAlignmentDefault,
          );
          return;
        }
        if (typed.payload.partialText?.trim()) {
          activePartialText = typed.payload.partialText;
        }
        overlay.showProgress(
          typed.payload.requestId,
          typed.payload.partialText,
          typed.payload.completedChunks,
          typed.payload.totalChunks,
          typed.payload.progressStage,
        );
      }
      return;
    }
    if (typed.type === 'PUBLIC_SETTINGS_UPDATED') {
      settings = typed.payload;
      if (settings.sidebarMode === 'floating') browserSidebarActive = false;
      options.onPublicSettingsChange?.(settings);
      temporaryTargetLanguage = settings.targetLanguage;
      temporaryStyle = settings.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarMode: settings.sidebarMode,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
        autoRenderLatex: settings.autoRenderLatex,
      });
      refreshSelection();
      return;
    }
    if (typed.type === 'BROWSER_SIDEBAR_ACTIVE' && surface !== 'pdf') {
      browserSidebarActive = true;
      overlay.deactivateSidebar();
      lastAutoSelectionHash = activeSelection?.selectionHash;
      scheduleRefresh();
      return;
    }
    if (typed.type === 'BROWSER_SIDEBAR_CLOSED' && surface !== 'pdf') {
      browserSidebarActive = false;
      lastAutoSelectionHash = undefined;
      dismissedPassiveSelectionHash = undefined;
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      scheduleRefresh();
      return;
    }
    if (typed.type === 'CONTINUOUS_TRANSLATION_STATE_UPDATED') {
      applyContinuousTranslationPaused(typed.payload.paused);
      return;
    }
    if (typed.type === 'OPEN_SIDEBAR') {
      activeWebRegionSelection?.cancel();
      activeWebRegionSelection = undefined;
      overlay.openSidebar();
      refreshSelection();
      return;
    }
    if (typed.type === 'START_WEB_REGION_SELECTION') {
      startWebRegionSelection(
        typed.payload?.restorePreviousRegion ? failedWebRegionSelection : undefined,
      );
      return;
    }
    if (typed.type === 'TRIGGER_TRANSLATE') {
      activeWebRegionSelection?.cancel();
      activeWebRegionSelection = undefined;
      const snapshot = captureSelectionSnapshot(settings.contextMode);
      if (snapshot) {
        latestSelection = snapshot;
        rememberSelectionMarkerAnchor(snapshot);
        void translateSelection(snapshot);
      } else {
        cancelActiveTranslation();
        overlay.hide();
        void openSettingsPage().then((opened)=>{if(!opened)overlay.showError({message:'无法打开完整设置，请从 Edge 扩展菜单进入 Pi Translator 设置。',showSettings:false,retryable:false})});
      }
    }
    if (typed.type === 'CONTEXT_MENU_TRANSLATE') {
      if (
        surface === 'pdf' &&
        (document.visibilityState === 'hidden' ||
          !sameExtensionPage(typed.payload.pageUrl, location.href))
      ) return;
      const current = captureSelectionSnapshot(settings.contextMode);
      // Prefer the live DOM selection when it is still available. Besides a
      // more accurate rectangle, it may contain TeX recovered from KaTeX,
      // MathJax, or MathML that the browser's context-menu selectionText lost.
      const snapshot = current
        ? {
            ...current,
            requestId: typed.payload.requestId,
            pageUrl: typed.payload.pageUrl,
          }
        : typed.payload;
      latestSelection = snapshot;
      rememberSelectionMarkerAnchor(snapshot);
      void translateSelection(snapshot);
    }
  };

  document.addEventListener('pointerdown', beginPdfSelection, true);
  document.addEventListener('pointerup', finishPdfSelection, true);
  document.addEventListener('pointercancel', finishPdfSelection, true);
  document.addEventListener('selectionchange', scheduleRefresh);
  document.addEventListener('mouseup', scheduleRefresh, true);
  document.addEventListener('keyup', scheduleRefresh, true);
  window.addEventListener('resize', scheduleRefresh);
  window.addEventListener('scroll', scheduleRefresh, true);
  browser.runtime.onMessage.addListener(messageListener);

  ctx.onInvalidated(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
    document.removeEventListener('pointerdown', beginPdfSelection, true);
    document.removeEventListener('pointerup', finishPdfSelection, true);
    document.removeEventListener('pointercancel', finishPdfSelection, true);
    document.removeEventListener('selectionchange', scheduleRefresh);
    document.removeEventListener('mouseup', scheduleRefresh, true);
    document.removeEventListener('keyup', scheduleRefresh, true);
    window.removeEventListener('resize', scheduleRefresh);
    window.removeEventListener('scroll', scheduleRefresh, true);
    browser.runtime.onMessage.removeListener(messageListener);
    activeWebRegionSelection?.cancel();
    activeWebRegionSelection = undefined;
    overlay.destroy();
    markerManager?.destroy();
    markerManager = undefined;
    markerAnchors.clear();
    segmentMarkerAnchors.clear();
    pendingSelectionMarkerRequestId = undefined;
    activeImageRegion = undefined;
    activeRetryContext = undefined;
    failedWebRegionSelection = undefined;
    activePartialText = undefined;
    pendingSettingsRecovery = undefined;
    resultRetryContexts.clear();
  });

  return {
    translateImageRegion: (capture) => translateImageRegion(capture),
    translatePdfRegionText: (capture) => translatePdfRegionText(capture),
    openSidebar: () => {
      overlay.openSidebar();
      const firstPersisted = persistedMarkerHistory[0];
      if (!activeSelection && firstPersisted) {
        overlay.showResult(firstPersisted, undefined, combinedOverlayHistory(), false);
      }
    },
    cancelActiveTranslation: () => {
      activeWebRegionSelection?.cancel();
      activeWebRegionSelection = undefined;
      cancelActiveTranslation();
      overlay.hide();
    },
    refreshPersistentMarkers,
    reset: () => {
      persistenceRevision += 1;
      persistentMarkersEnabled = false;
      persistentStoredMarkerCount = 0;
      storedPersistentMarkers = [];
      activeWebRegionSelection?.cancel();
      activeWebRegionSelection = undefined;
      cancelActiveTranslation();
      latestSelection = undefined;
      activePdfRegionLocation = undefined;
      activeTextMetadata = undefined;
      activeRetryContext = undefined;
      failedWebRegionSelection = undefined;
      activePartialText = undefined;
      pendingSettingsRecovery = undefined;
      resultRetryContexts.clear();
      overlayHistory = [];
      persistedMarkerHistory = [];
      markerManager?.clear();
      markerAnchors.clear();
      segmentMarkerAnchors.clear();
      pendingSelectionMarkerRequestId = undefined;
      lastAutoSelectionHash = undefined;
      dismissedPassiveSelectionHash = undefined;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      pdfSelectionPointerId = undefined;
      pdfSelectionInProgress = false;
      overlay.resetSession();
    },
  };
}
