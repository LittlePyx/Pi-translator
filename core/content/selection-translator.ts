import type {
  PublicSettings,
  PublicSettingsResponse,
  DocumentMemoryResponse,
  DocumentMemoryLocator,
  RuntimeMessage,
  TranslateRuntimeResponse,
} from '../messaging/messages';
import {
  runtimeConnectionErrorMessage,
  translationErrorMessage,
} from '../messaging/user-facing-error';
import { captureSelectionSnapshot } from '../selection/generic-selection';
import type { SelectionSnapshot, ViewportRect } from '../selection/types';
import { isLikelyTargetLanguage } from '../language/target-language';
import { normalizePdfSelectionText } from '../pdf/text-normalizer';
import type { SidebarSide } from '../settings/schema';
import type { DocumentMemorySnapshot } from '../document/document-memory-repository';
import type {
  PdfSourceLocation,
  TranslateResult,
  TranslationHistoryEntry,
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
  type ViewportInsetsProvider,
} from '../../ui/translation-overlay';

interface ContentScriptRuntimeContext {
  onInvalidated(callback: () => void): unknown;
}

type TranslationSurface = 'overleaf' | 'general' | 'pdf';

interface SelectionTranslatorOptions {
  pageUrl?: () => string;
  sourceLabel?: () => string | undefined;
  allowSitePause?: boolean;
  viewportInsets?: ViewportInsetsProvider;
  onSidebarLayoutChange?: (layout: SelectionTranslatorSidebarLayout) => void;
  onPublicSettingsChange?: (settings: PublicSettings) => void;
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
  recapture?: (padding: number) => Promise<ImageRegionTranslationCapture | undefined>;
}

export interface PdfRegionTextTranslationCapture {
  text: string;
  rect: ViewportRect;
  pageUrl: string;
  sourceLabel?: string;
  sourceLocation: PdfSourceLocation;
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
  let activeTextMetadata: {
    sourceLabel?: string;
    sourceLocation?: PdfSourceLocation;
  } | undefined;
  let inFlightRequestId: string | undefined;
  let completedEarlyRequestId: string | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let autoTranslateTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAutoSelectionHash: string | undefined;
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

  function currentDocumentLocator(): DocumentMemoryLocator {
    const sourceLocation = activePdfRegionLocation ?? activeTextMetadata?.sourceLocation;
    const sourceLabel = activeImageRegion?.sourceLabel ??
      activeTextMetadata?.sourceLabel ??
      options.sourceLabel?.();
    return {
      pageUrl: activeImageRegion?.pageUrl ?? options.pageUrl?.() ?? location.href,
      ...(sourceLabel ? { sourceLabel } : {}),
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
    if (!requestId) return;
    void browser.runtime
      .sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId },
      } satisfies RuntimeMessage)
      .catch(() => undefined);
  }

  const overlay = new TranslationOverlay({
    onTranslate: () => {
      if (latestSelection) void translateSelection(latestSelection);
    },
    onRetry: () => {
      if (activeImageRegion) void translateImageRegion(activeImageRegion, true);
      else if (activeSelection) void translate(activeSelection, true, activeTextMetadata);
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
          }
        : undefined);
    },
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
    onClearDocumentMemory: () => documentMemoryRequest({
      type: 'CLEAR_DOCUMENT_MEMORY',
      payload: currentDocumentLocator(),
    }),
    onOpenSettings: () => {
      void browser.runtime.sendMessage({
        type: 'OPEN_OPTIONS_PAGE',
      } satisfies RuntimeMessage);
    },
    ...(options.allowSitePause === false
      ? {}
      : {
          onPauseSite: async () => {
            await browser.runtime.sendMessage({
              type: 'PAUSE_CURRENT_SITE',
              payload: { pageUrl: location.href },
            } satisfies RuntimeMessage);
          },
        }),
    onSidebarChange: (active) => {
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
    onDismiss: cancelActiveTranslation,
  }, {
    ...(options.viewportInsets ? { viewportInsets: options.viewportInsets } : {}),
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
    onChange: (entries) => queuePersistentMarkerSave(entries),
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
    persistedMarkerHistory = persistedMarkerHistory.filter((entry) => (
      entry.requestId !== markerId && !removedStoredIds.has(entry.requestId)
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
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
        autoRenderLatex: settings.autoRenderLatex,
      });
    }
  } catch {
    // Defaults keep the content UI usable while the service worker restarts.
  }

  function selectionRect(snapshot: SelectionSnapshot): ViewportRect | undefined {
    return snapshot.rect;
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
    if (overlay.isSidebarActive()) {
      overlay.hideTrigger();
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
        overlay.showSensitiveNotice(selectionRect(snapshot));
        return;
      }
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      autoTranslateTimer = setTimeout(() => {
        const current = captureSelectionSnapshot(settings.contextMode);
        if (!current || current.selectionHash !== snapshot.selectionHash) return;
        lastAutoSelectionHash = snapshot.selectionHash;
        void translateSelection(snapshot);
      }, 220);
      return;
    }
    if (!shouldShowFloatingButton(settings, surface)) {
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
      overlay.showTrigger(snapshot.rect);
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

  async function translate(
    snapshot: SelectionSnapshot,
    bypassCache = false,
    metadata?: { sourceLabel?: string; sourceLocation?: PdfSourceLocation },
  ): Promise<void> {
    if (inFlightRequestId && inFlightRequestId !== snapshot.requestId) {
      const previousRequestId = inFlightRequestId;
      void browser.runtime.sendMessage({
        type: 'CANCEL_TRANSLATION',
        payload: { requestId: previousRequestId },
      } satisfies RuntimeMessage).catch(() => undefined);
    }
    const isRetry = activeSelection?.requestId === snapshot.requestId;
    if (!isRetry) overlay.resetCardPosition();
    activeImageRegion = undefined;
    activePdfRegionLocation = metadata?.sourceLocation;
    activeTextMetadata = metadata;
    activeSelection = snapshot;
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
    overlay.showLoading(selectionRect(snapshot));
    const sourceLabel = metadata?.sourceLabel ?? options.sourceLabel?.();
    const requestText = surface === 'pdf'
      ? normalizePdfSelectionText(snapshot.normalizedText)
      : snapshot.normalizedText;
    const requestContext = snapshot.contextText
      ? surface === 'pdf'
        ? normalizePdfSelectionText(snapshot.contextText)
        : snapshot.contextText
      : undefined;
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_SELECTION',
        payload: {
          requestId: snapshot.requestId,
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
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;

      if (activeSelection?.requestId !== snapshot.requestId) return;
      const alreadyRendered = completedEarlyRequestId === snapshot.requestId;
      inFlightRequestId = undefined;
      if (response.ok) {
        const responseRequestId = response.data.result.requestId;
        const anchor = markerAnchors.get(snapshot.requestId);
        if (anchor && responseRequestId !== snapshot.requestId) {
          markerAnchors.set(responseRequestId, anchor);
        }
        overlayHistory = response.data.history;
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
      const message = translationErrorMessage(
        response.error.code,
        response.error.message,
      );
      overlay.showError(
        {
          message,
          showSettings:
            response.error.code === 'NO_API_KEY' ||
            response.error.code === 'AUTH_FAILED' ||
            response.error.code === 'PAYMENT_REQUIRED' ||
            response.error.code === 'MODEL_NOT_FOUND' ||
            response.error.code === 'API_PERMISSION_REQUIRED',
        },
        selectionRect(snapshot),
      );
    } catch (error) {
      if (activeSelection?.requestId !== snapshot.requestId) return;
      if (completedEarlyRequestId === snapshot.requestId) return;
      inFlightRequestId = undefined;
      overlay.showError(
        {
          message: runtimeConnectionErrorMessage(error),
          showSettings: false,
        },
        selectionRect(snapshot),
      );
    }
  }

  async function translateSelection(snapshot: SelectionSnapshot): Promise<void> {
    if (options.captureVisualSelection && snapshot.source === 'window-selection') {
      try {
        const capture = await options.captureVisualSelection(snapshot);
        if (capture) {
          await translateImageRegion(capture);
          return;
        }
      } catch {
        // Visual formula recognition is an enhancement. If capture is not
        // available, retain the selectable-text translation path.
      }
    }
    await translate(snapshot);
  }

  async function translateImageRegion(
    capture: ImageRegionTranslationCapture,
    isRetry = false,
    expandedFormulaCrop = false,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
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
    inFlightRequestId = requestId;
    completedEarlyRequestId = undefined;
    if (capture.selectionReference) {
      rememberMarkerAnchor(requestId, '', capture.selectionReference);
    } else if (capture.sourceSelection) {
      rememberMarkerAnchor(requestId, capture.sourceSelection.normalizedText);
    }
    overlay.showLoading(capture.rect);
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'TRANSLATE_IMAGE_REGION',
        payload: {
          requestId,
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
        },
      } satisfies RuntimeMessage)) as TranslateRuntimeResponse;
      if (inFlightRequestId !== requestId && completedEarlyRequestId !== requestId) return;
      const alreadyRendered = completedEarlyRequestId === requestId;
      inFlightRequestId = undefined;
      if (response.ok) {
        overlayHistory = response.data.history;
        if (
          response.data.result.formulaNeedsReview &&
          capture.recapture &&
          !expandedFormulaCrop
        ) {
          completedEarlyRequestId = undefined;
          const expandedCapture = await capture.recapture(24);
          if (expandedCapture) {
            await translateImageRegion(expandedCapture, true, true);
            return;
          }
        }
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
      overlay.showError(
        {
          message: translationErrorMessage(response.error.code, response.error.message),
          showSettings:
            response.error.code === 'NO_API_KEY' ||
            response.error.code === 'AUTH_FAILED' ||
            response.error.code === 'PAYMENT_REQUIRED' ||
            response.error.code === 'MODEL_NOT_FOUND' ||
            response.error.code === 'API_PERMISSION_REQUIRED' ||
            response.error.code === 'VISION_NOT_CONFIGURED' ||
            response.error.code === 'VISION_MODEL_UNSUPPORTED',
        },
        capture.rect,
      );
    } catch (error) {
      if (inFlightRequestId !== requestId && completedEarlyRequestId !== requestId) return;
      if (completedEarlyRequestId === requestId) return;
      inFlightRequestId = undefined;
      overlay.showError(
        { message: runtimeConnectionErrorMessage(error), showSettings: false },
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
    });
  }

  const messageListener = (message: unknown): void => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const typed = message as RuntimeMessage;
    if (typed.type === 'TRANSLATION_PROGRESS') {
      if (typed.payload.requestId === inFlightRequestId) {
        if (typed.payload.result) {
          const result = typed.payload.result;
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
        overlay.showProgress(
          typed.payload.partialText,
          typed.payload.completedChunks,
          typed.payload.totalChunks,
        );
      }
      return;
    }
    if (typed.type === 'PUBLIC_SETTINGS_UPDATED') {
      settings = typed.payload;
      options.onPublicSettingsChange?.(settings);
      temporaryTargetLanguage = settings.targetLanguage;
      temporaryStyle = settings.style;
      overlay.setPreferences({
        targetLanguage: temporaryTargetLanguage,
        style: temporaryStyle,
        sidebarSide: settings.sidebarSide,
        sidebarWidth: settings.sidebarWidth,
        autoRenderLatex: settings.autoRenderLatex,
      });
      refreshSelection();
      return;
    }
    if (typed.type === 'OPEN_SIDEBAR') {
      overlay.openSidebar();
      refreshSelection();
      return;
    }
    if (typed.type === 'TRIGGER_TRANSLATE') {
      const snapshot = captureSelectionSnapshot(settings.contextMode);
      if (snapshot) {
        latestSelection = snapshot;
        rememberSelectionMarkerAnchor(snapshot);
        void translateSelection(snapshot);
      } else {
        cancelActiveTranslation();
        overlay.hide();
        void browser.runtime.sendMessage({
          type: 'OPEN_OPTIONS_PAGE',
        } satisfies RuntimeMessage);
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
    overlay.destroy();
    markerManager?.destroy();
    markerManager = undefined;
    markerAnchors.clear();
    segmentMarkerAnchors.clear();
    pendingSelectionMarkerRequestId = undefined;
    activeImageRegion = undefined;
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
      cancelActiveTranslation();
      overlay.hide();
    },
    refreshPersistentMarkers,
    reset: () => {
      persistenceRevision += 1;
      persistentMarkersEnabled = false;
      persistentStoredMarkerCount = 0;
      storedPersistentMarkers = [];
      cancelActiveTranslation();
      latestSelection = undefined;
      activePdfRegionLocation = undefined;
      activeTextMetadata = undefined;
      overlayHistory = [];
      persistedMarkerHistory = [];
      markerManager?.clear();
      markerAnchors.clear();
      segmentMarkerAnchors.clear();
      pendingSelectionMarkerRequestId = undefined;
      lastAutoSelectionHash = undefined;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (autoTranslateTimer) clearTimeout(autoTranslateTimer);
      pdfSelectionPointerId = undefined;
      pdfSelectionInProgress = false;
      overlay.hide();
    },
  };
}
