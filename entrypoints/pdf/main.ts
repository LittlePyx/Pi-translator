import {pdfDocumentProgress} from '../../core/pdf/document-progress';
import {bindPdfTermReuse} from '../../ui/pdf-term-reuse';
import {documentIdentity} from '../../core/document/document-identity';
import {termSourceUrl,termAppliesToLanguage,type TermSource} from '../../core/document/term-provenance';
import {containsPdfTerm} from '../../core/pdf/term-consistency';
import {bindPdfResearchReferences} from '../../ui/pdf-research-references';
import { bindAnchoredMenus } from '../../ui/anchored-menu';
import {retainedDocumentId} from '../../core/translation/fixed-document-storage';
import {listRetainedPdfDocumentTranslations,retainedPdfRecordsForBackup} from '../../core/pdf/document-translation-session';
import {retainedWebRecordsForBackup} from '../../core/translation/bilingual-page-session';
import {listRetainedDocuments} from '../../core/translation/retained-document-library';
import {applyPdfParagraphCorrection,pdfCorrectionParts,type PdfCorrectionValue} from '../../core/pdf/document-correction';
import {checkPdfTermConsistency,previewPdfTermCorrection,type PdfTermCandidate,type ConfirmedPdfTerm} from '../../core/pdf/term-consistency';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import type { TextLayerBuilder as PdfTextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  startSelectionTranslator,
  type ImageRegionTranslationCapture,
  type PdfRegionTextTranslationCapture,
} from '../../core/content/selection-translator';
import type { SelectionSnapshot } from '../../core/selection/types';
import { extractPdfRegionText, type PositionedPdfText } from '../../core/pdf/region-text';
import { resolvePdfFormulaCaptureRegion } from '../../core/pdf/formula-capture-region';
import {
  resolvePdfTextSelectionSnap,
  type PdfTextSelectionSnap,
} from '../../core/pdf/text-selection-snap';
import type { ImageTranslationPurpose, PdfSourceLocation } from '../../core/translation/types';
import { shouldUseVisionForPdfFormula } from '../../core/translation/formula-detection';
import { formulaDocumentIssues, formulaDocumentText, type FormulaDocument } from '../../core/translation/formula-document';
import { renderFormulaDocument } from '../../ui/formula-document-view';
import { pdfReviewQueue, pdfReviewConfirmation, pdfReviewConfirmed, type PdfReviewKind } from '../../core/pdf/review-queue';
import {paragraphValue,paragraphRevision,withParagraphHistory,restoredParagraphRevision,MAX_PDF_PARAGRAPH_REVISIONS,type PdfParagraphHistory,type PdfParagraphRevision} from '../../core/pdf/paragraph-history';
import { pdfLeftBraceGlyphMetrics } from '../../core/pdf/tex-font-glyphs';
import {pdfNativeMathFontHints,pdfFontHintText} from '../../core/pdf/math-font-evidence';
import {splitMarkdownTableRow} from '../../core/translation/table-output-validation';
import { bindPdfEquationNumbers } from '../../core/pdf/equation-binding';
import { addPdfReportedTokens, consumePdfRequest, emptyPdfRequestUsage, validPdfRequestLimit, type PdfRequestUsage } from '../../core/pdf/request-budget';
import { findModelPrice, formatCost, reportedCost, roughTextCost } from '../../core/translation/cost-estimate';
import {
  parsePdfSourceUrl,
  pdfDocumentIdentity,
  pdfFilename,
  pdfInitialPage,
  pdfPermissionPattern,
} from '../../core/pdf/source';
import {
  captureCanvasRegion,
  isUsableRegion,
  moveRegion,
  normalizeRegion,
  resizeRegion,
  suggestedPageRecognitionRegion,
  type Point,
  type RegionRect,
  type RegionResizeHandle,
} from '../../core/pdf/region-capture';
import type {
  PublicSettings,
  RecognizePdfPageResponse,
  RuntimeMessage,
  RuntimeResponse,
  TranslateRuntimeResponse,
  TranslationBatchRuntimeResponse,
} from '../../core/messaging/messages';
import {
  translationErrorRecovery,
  translationErrorMessage,
  type SettingsFocus,
} from '../../core/messaging/user-facing-error';
import { isIsolatedBilingualBlockError } from '../../core/translation/bilingual-page';
import { takeDocumentTranslationBatch } from '../../core/translation/document-batch';
import {
  buildDocumentTranslationExport,
  documentTranslationDownload,
  triggerDocumentTranslationDownload,
  type DocumentTranslationExportFormat,
  type DocumentTranslationExportPageImage,
} from '../../core/translation/document-export';
import {
  buildPdfLayoutTranslationExport,
  type PdfLayoutTranslationBlock,
  type PdfLayoutTranslationPageImage,
} from '../../core/translation/pdf-layout-export';
import { isSupportedTargetLanguage } from '../../core/language/supported-target-languages';
import {
  comparePdfDocumentTranslationPriority,
  pdfDocumentTranslationBlockContainsFormula,
  pdfDocumentTranslationStartsProseListItem,
  pdfDocumentTranslationHeadingLevel,
  pdfDocumentTranslationContinuity,
  pdfDocumentTranslationItemsFromOcr,
  pdfDocumentTranslationSourceRegions,
  preparePdfDocumentTranslationPages,
  pdfBlockTouchesScope,
  pdfSupplementarySourcePages,
  type PdfDocumentTranslationBlock,
  type PdfDocumentTranslationPageInput,
  type PdfDocumentTranslationTextItem,
} from '../../core/pdf/document-translation';
import {
  isPdfBackgroundDocumentMessage,
  pdfBackgroundVisualOutcome,
  pdfBackgroundTextOutcome,
  PDF_BACKGROUND_CACHE_NAME,
  type PdfBackgroundDocumentMessage,
  type PdfBackgroundTranslationSnapshot,
  type PdfBackgroundTranslationOutcome,
} from '../../core/pdf/background-document-translation';
import { capturePdfVisualRegions } from '../../core/pdf/document-visual-capture';
import { combinePdfVisualOutcomes, pdfVisualUnitContext } from '../../core/pdf/visual-unit-translation';
import {
  classifyPdfDocumentTranslationSections,
  parsePdfDocumentPageRange,
  pdfDocumentTranslationReferenceEntryStaysOriginal,
  type PdfDocumentTranslationSection,
} from '../../core/pdf/document-translation-range';
import {
  clearRetainedPdfDocumentTranslationSession,
  clearPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationSession,
  getPdfDocumentTranslationPlan,
  pdfTranslationSourceCompatible,
  reusablePdfTranslationBlocks,
  archivedPdfTranslationBlocks,
  type PdfDocumentTranslationSessionBlock,
  getPdfDocumentTranslationSession,
  pdfDocumentTranslationSessionBehaviorKey,
  pdfDocumentTranslationSessionBlockSignature,
  pdfDocumentTranslationSessionDocumentKey,
  saveRetainedPdfDocumentTranslationSession,
  savePdfDocumentTranslationSession,
  type PdfDocumentTranslationSessionActivity,
  type PdfDocumentTranslationSessionDescriptor,
} from '../../core/pdf/document-translation-session';
import {
  renderTranslationContent,
  renderTranslationContents,
} from '../../ui/translation-content';
import {
  mapCoordinateOcrPageToRegion,
  selectableOcrBlocks,
  type CoordinateOcrPage,
} from '../../core/pdf/ocr-text-layer';
import {readPdfOcrSession,savePdfOcrSessionPage} from '../../core/pdf/ocr-session-repository';
import {preparePdfFormulaProseRepair} from '../../core/pdf/formula-prose-repair';
import {
  DEFAULT_PDF_REGION_SHORTCUT_KEY,
  resolvePdfRegionShortcut,
} from '../../core/pdf/region-shortcuts';
import {
  getPdfReadingState,
  savePdfReadingState,
  type PdfReadingState,
  type PdfTranslationReadingAnchor,
} from '../../core/pdf/reading-state';
import {
  getPdfReadingBookmarkState,
  MAX_PDF_BOOKMARK_LABEL_LENGTH,
  MAX_PDF_BOOKMARK_NOTE_LENGTH,
  MAX_PDF_BOOKMARKS_PER_DOCUMENT,
  normalizePdfReadingBookmark,
  savePdfReadingBookmarks,
  type PdfReadingBookmark,
} from '../../core/pdf/reading-bookmark-repository';
import { pdfWheelZoomDelta, pdfWheelZoomStepCount } from '../../core/pdf/wheel-zoom';
import {
  hasPdfFileSignature,
  pdfOpenErrorMessage,
  validateLocalPdfFiles,
} from '../../core/pdf/local-file';
import {
  clearPdfTranslationMarkers,
  getPdfTranslationMarkerState,
  savePdfTranslationMarkers,
  setPdfTranslationMarkerPersistence,
} from '../../core/pdf/translation-marker-repository';
import {
  buildPdfSearchPageIndex,
  buildPdfSearchSnippet,
  findPdfSearchMatches,
  normalizePdfSearchText,
  type PdfSearchMatch,
  type PdfSearchPageIndex,
  type PdfSearchTextItem,
} from '../../core/pdf/search';
import {
  buildPdfOutlineEntries,
  flattenPdfOutlineEntries,
  pdfOutlineEntryForPage,
  type PdfOutlineEntry,
  type PdfOutlineSourceItem,
} from '../../core/pdf/outline';
import {
  pdfDestinationTopCoordinate,
  safePdfLinkAnnotations,
  type SafePdfLinkAction,
  type SafePdfNamedAction,
} from '../../core/pdf/link-annotations';

type PdfJsModule = typeof import('pdfjs-dist');
type PdfViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs');

interface PdfRuntime {
  getDocument: PdfJsModule['getDocument'];
  OPS: PdfJsModule['OPS'];
  AnnotationType: PdfJsModule['AnnotationType'];
  TextLayerBuilder: PdfViewerModule['TextLayerBuilder'];
}

let pdfRuntime: PdfRuntime | undefined;
let pdfRuntimePromise: Promise<PdfRuntime> | undefined;

function loadPdfRuntime(): Promise<PdfRuntime> {
  if (pdfRuntime) return Promise.resolve(pdfRuntime);
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = import('pdfjs-dist').then(async (pdfjs) => {
      // The viewer module reads PDF.js from its global compatibility hook
      // while it initializes, so the core module must finish first.
      const pdfViewer = await import('pdfjs-dist/web/pdf_viewer.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      pdfRuntime = {
        getDocument: pdfjs.getDocument,
        OPS: pdfjs.OPS,
        AnnotationType: pdfjs.AnnotationType,
        TextLayerBuilder: pdfViewer.TextLayerBuilder,
      };
      return pdfRuntime;
    }).catch((error: unknown) => {
      pdfRuntimePromise = undefined;
      throw error;
    });
  }
  return pdfRuntimePromise;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing PDF viewer element #${id}`);
  return value as T;
}

const fileInput = element<HTMLInputElement>('file-input');
const toolbar = element<HTMLElement>('pdf-toolbar');
const readerMenu = element<HTMLDetailsElement>('pdf-reader-menu');
bindAnchoredMenus('#pdf-reader-menu, #pdf-document-translation-copy-menu', ':scope > div');
readerMenu.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (button && !button.closest('.zoom-controls')) readerMenu.open = false;
});
const toolbarObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--pdf-toolbar-height', `${toolbar.getBoundingClientRect().height}px`);
});
toolbarObserver.observe(toolbar);
const chooseFile = element<HTMLButtonElement>('choose-file');
const emptyOpen = element<HTMLButtonElement>('empty-open');
const documentName = element<HTMLElement>('document-name');
const pageJump = element<HTMLElement>('page-jump');
const pageNumberInput = element<HTMLInputElement>('page-number');
const pageCount = element<HTMLOutputElement>('page-count');
const openOutline = element<HTMLButtonElement>('open-outline');
const outlinePanel = element<HTMLElement>('pdf-outline');
const outlineStatus = element<HTMLElement>('pdf-outline-status');
const outlineTree = element<HTMLElement>('pdf-outline-tree');
const outlineClose = element<HTMLButtonElement>('pdf-outline-close');
const outlineTab = element<HTMLButtonElement>('pdf-navigation-outline-tab');
const bookmarksTab = element<HTMLButtonElement>('pdf-navigation-bookmarks-tab');
const bookmarksPanel = element<HTMLElement>('pdf-bookmarks');
const bookmarkAdd = element<HTMLButtonElement>('pdf-bookmark-add');
const bookmarkStatus = element<HTMLElement>('pdf-bookmark-status');
const bookmarkList = element<HTMLElement>('pdf-bookmark-list');
const bookmarkEmpty = element<HTMLElement>('pdf-bookmark-empty');
const openSearch = element<HTMLButtonElement>('open-search');
const translateDocument = element<HTMLButtonElement>('translate-document');
const documentTranslationPanel = element<HTMLElement>('pdf-document-translation');
const documentTranslationStatus = element<HTMLElement>('pdf-document-translation-status');
const documentTranslationName = element<HTMLElement>('pdf-document-translation-document-name');
const documentTranslationClose = element<HTMLButtonElement>('pdf-document-translation-close');
const documentTranslationProgress = element<HTMLElement>('pdf-document-translation-progress');
const documentTranslationPrimary = element<HTMLButtonElement>('pdf-document-translation-primary');
const documentTranslationStop = element<HTMLButtonElement>('pdf-document-translation-stop');
const documentTranslationClear = element<HTMLButtonElement>('pdf-document-translation-clear');
const documentTranslationCopyMenu = element<HTMLDetailsElement>(
  'pdf-document-translation-copy-menu',
);
const documentTranslationExportActions = element<HTMLElement>('pdf-document-translation-export-actions');
const documentTranslationShowSettings = element<HTMLButtonElement>('pdf-document-translation-show-settings');
const documentTranslationSettingsSeparator = element<HTMLElement>('pdf-document-translation-settings-separator');
const documentTranslationRestartSeparator = element<HTMLElement>('pdf-document-translation-restart-separator');
const documentTranslationCopyTranslation = element<HTMLButtonElement>(
  'pdf-document-translation-copy-translation',
);
const documentTranslationCopyBilingual = element<HTMLButtonElement>(
  'pdf-document-translation-copy-bilingual',
);
const documentTranslationDownloadArchive = element<HTMLButtonElement>('pdf-document-translation-download-archive');
const documentTranslationDownloadTranslation = element<HTMLButtonElement>(
  'pdf-document-translation-download-translation',
);
const documentTranslationDownloadBilingual = element<HTMLButtonElement>(
  'pdf-document-translation-download-bilingual',
);
const documentTranslationDownloadHtml = element<HTMLButtonElement>(
  'pdf-document-translation-download-html',
);
const documentTranslationPrintLayout = element<HTMLButtonElement>(
  'pdf-document-translation-print-layout',
);
const documentTranslationCopyFeedback = element<HTMLElement>(
  'pdf-document-translation-copy-feedback',
);
const documentTranslationRetention = element<HTMLElement>(
  'pdf-document-translation-retention',
);
const documentTranslationRetentionStatus = element<HTMLElement>(
  'pdf-document-translation-retention-status',
);
const documentTranslationRetentionManage = element<HTMLButtonElement>(
  'pdf-document-translation-retention-manage',
);
const documentTranslationRetentionToggle = element<HTMLInputElement>(
  'pdf-document-translation-retention-toggle',
);
const documentTranslationRange = element<HTMLSelectElement>('pdf-document-translation-range');
const documentTranslationRangeCurrent = element<HTMLOptionElement>(
  'pdf-document-translation-range-current',
);
const documentTranslationCustomRange = element<HTMLFormElement>(
  'pdf-document-translation-custom-range',
);
const documentTranslationCustomPages = element<HTMLInputElement>(
  'pdf-document-translation-custom-pages',
);
const documentTranslationSkipReferences = element<HTMLInputElement>(
  'pdf-document-translation-skip-references',
);
const documentTranslationSkipAppendix = element<HTMLInputElement>(
  'pdf-document-translation-skip-appendix',
);
const documentTranslationRangeFeedback = element<HTMLElement>(
  'pdf-document-translation-range-feedback',
);
const documentTranslationMultimodal = element<HTMLElement>(
  'pdf-document-translation-multimodal',
);
const documentTranslationMultimodalToggle = element<HTMLInputElement>(
  'pdf-document-translation-multimodal-toggle',
);
const documentTranslationMultimodalStatus = element<HTMLElement>(
  'pdf-document-translation-multimodal-status',
);
const documentTranslationOcr = element<HTMLElement>('pdf-document-translation-ocr');
const documentTranslationOcrStatus = element<HTMLElement>(
  'pdf-document-translation-ocr-status',
);
const documentTranslationOcrAction = element<HTMLButtonElement>(
  'pdf-document-translation-ocr-action',
);
const documentTranslationNote = element<HTMLElement>('pdf-document-translation-note');
const documentTranslationProcessingDetails = element<HTMLElement>('pdf-document-processing-details');
const documentReview = element<HTMLDetailsElement>('pdf-document-review');
const documentReviewSummary = element<HTMLElement>('pdf-document-review-summary');
const documentReviewFilter = element<HTMLSelectElement>('pdf-document-review-filter');
const documentReviewList = element<HTMLElement>('pdf-document-review-list');
const documentTrial = element<HTMLDetailsElement>('pdf-document-trial');
const documentTrialBlock = element<HTMLSelectElement>('pdf-document-trial-block');
const documentTrialStart = element<HTMLButtonElement>('pdf-document-trial-start');
const documentTrialNote = element<HTMLElement>('pdf-document-trial-note');
const documentRequestLimit = element<HTMLInputElement>('pdf-document-request-limit');
const documentRequestUsage = element<HTMLOutputElement>('pdf-document-request-usage');
const documentCostEstimate = element<HTMLOutputElement>('pdf-document-cost-estimate');
const documentTranslationSettings = element<HTMLDetailsElement>(
  'pdf-document-translation-settings',
);
const documentTranslationSettingsSummary = element<HTMLElement>(
  'pdf-document-translation-settings-summary',
);
const documentTranslationReader = element<HTMLElement>('pdf-document-translation-reader');
const documentTranslationViewReading = element<HTMLButtonElement>(
  'pdf-document-translation-view-reading',
);
const documentTranslationViewCompare = element<HTMLButtonElement>(
  'pdf-document-translation-view-compare',
);
const documentTranslationPagePrevious = element<HTMLButtonElement>(
  'pdf-document-translation-page-previous',
);
const documentTranslationPageStatus = element<HTMLOutputElement>(
  'pdf-document-translation-page-status',
);
const documentTranslationPageNext = element<HTMLButtonElement>(
  'pdf-document-translation-page-next',
);
const documentTranslationPageEmpty = element<HTMLElement>(
  'pdf-document-translation-page-empty',
);
const documentTranslationPages = element<HTMLElement>('pdf-document-translation-pages');
const searchPanel = element<HTMLElement>('pdf-search');
const searchQuery = element<HTMLInputElement>('pdf-search-query');
const searchScope = element<HTMLSelectElement>('pdf-search-scope');
const searchStatus = element<HTMLOutputElement>('pdf-search-status');
const searchPrevious = element<HTMLButtonElement>('pdf-search-previous');
const searchNext = element<HTMLButtonElement>('pdf-search-next');
const searchResultsToggle = element<HTMLButtonElement>('pdf-search-results-toggle');
const searchResults = element<HTMLElement>('pdf-search-results');
const searchClose = element<HTMLButtonElement>('pdf-search-close');
const recognizePage = element<HTMLButtonElement>('recognize-page');
const regionTranslate = element<HTMLButtonElement>('region-translate');
const regionQueueButton = element<HTMLButtonElement>('region-queue');
const regionQueueCount = element<HTMLElement>('region-queue-count');
const regionQueuePanel = element<HTMLElement>('region-queue-panel');
const regionQueueList = element<HTMLElement>('region-queue-list');
const zoomOut = element<HTMLButtonElement>('zoom-out');
const zoomIn = element<HTMLButtonElement>('zoom-in');
const zoomValue = element<HTMLOutputElement>('zoom-value');
const fitWidth = element<HTMLButtonElement>('fit-width');
const openSettings = element<HTMLButtonElement>('open-settings');
const stage = element<HTMLElement>('document-stage');
const emptyState = element<HTMLElement>('empty-state');
const loading = element<HTMLElement>('loading');
const loadingText = element<HTMLElement>('loading-text');
const notice = element<HTMLElement>('notice');
const pdfLinkReturn = element<HTMLButtonElement>('pdf-link-return');
const viewer = element<HTMLElement>('pdf-viewer');
const dropOverlay = element<HTMLElement>('pdf-drop-overlay');
const dropTitle = element<HTMLElement>('pdf-drop-title');
const dropDescription = element<HTMLElement>('pdf-drop-description');

const ZOOM_LEVELS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const RETAINED_PAGE_RADIUS = 2;
const MAX_PAGE_CANVAS_PIXELS = 12_000_000;
let zoomLevel = 1.25;
let pdfDocument: PDFDocumentProxy | undefined;
let currentPdfBackgroundData: Uint8Array | undefined;
let currentSourceUrl = location.href;
let currentSourceLabel: string | undefined;
let renderGeneration = 0;
let documentEpoch = 0;
let currentDocumentSessionId = crypto.randomUUID();
let openOperationId = 0;
let openAbortController: AbortController | undefined;
let openLoadingTask: PDFDocumentLoadingTask | undefined;
let pageObserver: IntersectionObserver | undefined;
const activeRenderTasks = new Map<HTMLElement, RenderTask>();
const activeTextLayerBuilders = new Map<HTMLElement, PdfTextLayerBuilder>();
const temporaryOcrPages = new Map<number, CoordinateOcrPage>();
const pageRenderRevisions = new WeakMap<HTMLElement, number>();
const invalidationCallbacks: Array<() => void> = [];
type RegionSelectionMode = 'off' | 'single' | 'continuous';

let regionMode: RegionSelectionMode = 'off';
let pdfKeyboardShortcutsEnabled = true;
let pdfRegionShortcutKey = DEFAULT_PDF_REGION_SHORTCUT_KEY;
let scanHintShownForDocument = false;
let activePageRecognitionRequestId: string | undefined;
let noticeRevision = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let retentionFrame: number | undefined;
let fitWidthActive = false;
let fitWidthTimer: ReturnType<typeof setTimeout> | undefined;
let fitWidthTask: Promise<void> | undefined;
let wheelZoomTimer: ReturnType<typeof setTimeout> | undefined;
let wheelZoomAccumulatedDelta = 0;
let wheelZoomAnchor: PageAnchor | undefined;
let textSelectionSnapFrame: number | undefined;
let continuousSidebarActive = false;
let readingStateSaveTimer: ReturnType<typeof setTimeout> | undefined;
let currentReadingIdentity: string | undefined;
let restoringReadingState = false;
let fileDragDepth = 0;
let libraryRestoreId: string | undefined = new URLSearchParams(location.search).get('restore') ?? undefined;
type CachedReadingContext=({kind:'pdf';record:Awaited<ReturnType<typeof retainedPdfRecordsForBackup>>[number]}|{kind:'web';record:Awaited<ReturnType<typeof retainedWebRecordsForBackup>>[number]})&{id:string;name:string};
let cachedReadingContext:CachedReadingContext|undefined;
let libraryRestoreDocumentKey: string | undefined;
let currentPdfContentFingerprint: string | undefined;
const PDF_SEARCH_RESULT_LIMIT = 5_000;
const PDF_SEARCH_PREVIEW_LIMIT = 80;
const PDF_SEARCH_HIGHLIGHT_NAME = 'pi-pdf-search-match';
const PDF_SEARCH_CURRENT_HIGHLIGHT_NAME = 'pi-pdf-search-current';
const searchPageIndexes = new Map<number, PdfSearchPageIndex>();
type ReaderSearchMatch = PdfSearchMatch & { translationBlockId?: string };
let searchMatches: ReaderSearchMatch[] = [];
const translationSearchIndexes = new Map<string, PdfSearchPageIndex>();
let searchViewContext = '';
let translationSearchFrame = 0;
let activeParagraphEdit:{block:PdfDocumentTranslationRuntimeBlock;stamp:string;documentSessionId:string}|undefined;
let lastParagraphCorrection:{block:PdfDocumentTranslationRuntimeBlock;stamp:string;before:PdfCorrectionValue;confirmation?:string;documentSessionId:string}|undefined;
let searchResultIndex = -1;
let activeSearchQuery = '';
let searchIndexRunId = 0;
let searchIndexing = false;
let searchReturnFocus: HTMLElement | undefined;
let searchResultsExpanded = true;
let pdfOutlineEntries: PdfOutlineEntry[] = [];
let pdfOutlineEntryMap = new Map<string, PdfOutlineEntry>();
let pdfOutlineExpandedIds = new Set<string>();
let currentPdfOutlineEntryId: string | undefined;
let outlineReturnFocus: HTMLElement | undefined;
type PdfNavigationView = 'outline' | 'bookmarks';
let activePdfNavigationView: PdfNavigationView = 'bookmarks';
let pdfReadingBookmarks: PdfReadingBookmark[] = [];
let editingPdfBookmarkId: string | undefined;
let bookmarkSaveRevision = 0;
let bookmarkSaveQueue: Promise<void> = Promise.resolve();

type PdfDocumentTranslationPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'error';

interface PdfDocumentTranslationRuntimeBlock extends PdfDocumentTranslationBlock {
  savedHeadingLevel?:1|2|3;
  omitReadingMetadata?:true;
  manualCorrection?:true;
  retranslation?:true;
  revisions?:PdfParagraphRevision[];
  sessionSignature: string;
  section: PdfDocumentTranslationSection;
  included: boolean;
  status: 'idle' | 'translating' | 'done' | 'error';
  translatedText?: string;
  errorMessage?: string;
  singleRetry?: boolean;
  visualFallbackMessage?: string;
  formulaReviewMessage?: string;
  formulaReviewDraft?: true;
  formulaDocument?: FormulaDocument;
  reviewConfirmation?: string;
  visualProcessed?: boolean;
  referencePreserved?: boolean;
}

let pdfDocumentTranslationPhase: PdfDocumentTranslationPhase = 'idle';
let pdfRequestUsage: PdfRequestUsage = emptyPdfRequestUsage();
let pdfTrialRunning = false;
let pdfDocumentTranslationBlocksState: PdfDocumentTranslationRuntimeBlock[] = [];
let pdfDocumentTranslationArchivedBlocks: PdfDocumentTranslationSessionBlock[] = [];
let pdfDocumentTranslationPageInputs: PdfDocumentTranslationPageInput[] = [];
const stagedPdfReplacements=new WeakMap<PdfDocumentTranslationRuntimeBlock,PdfParagraphHistory>();
let pdfDocumentTranslationUnreadablePages = 0;
let pdfDocumentTranslationUnreadablePageNumbers: number[] = [];
let pdfDocumentTranslationMultiColumnPages = 0;
let pdfDocumentTranslationRemovedMarginLines = 0;
let pdfDocumentTranslationRequestId: string | undefined;
let pdfDocumentTranslationTask: Promise<void> | undefined;
let pdfDocumentBackgroundJobId: string | undefined;
let pdfDocumentBackgroundSnapshotRevision = 0;
let pdfDocumentTranslationRevision = 0;
let pdfDocumentTranslationMessage: string | undefined;
let pdfDocumentTranslationOcrRunning = false;
let pdfDocumentTranslationOcrProgress = { completed: 0, total: 0 };
let pdfDocumentTranslationOcrMessage: string | undefined;
let pdfDocumentTranslationOcrError = false;
let pdfDocumentTranslationOcrRevision = 0;
let pdfDocumentTranslationOcrRequestId: string | undefined;
let pdfDocumentTranslationCopyPending = false;
let pdfDocumentTranslationCopyFeedbackTimer: number | undefined;
let pdfDocumentTranslationRetainedLocally = false;
let pdfDocumentTranslationSessionWriteDirty = false;
let pdfDocumentTranslationRetentionWriteDirty = false;
let pdfDocumentTranslationRetentionPending = false;
let pdfDocumentTranslationRetentionMessage: string | undefined;
let pdfDocumentTranslationRetentionError = false;
let pdfDocumentTranslationSavesInFlight = 0;
type PdfDocumentTranslationRangeMode = 'all' | 'current' | 'custom';
type PdfDocumentTranslationViewMode = 'reading' | 'compare';
let pdfDocumentTranslationRangeMode: PdfDocumentTranslationRangeMode = 'all';
let pdfDocumentTranslationRangePages: number[] = [];
let pdfDocumentTranslationRangeSummary = '';
let pdfDocumentTranslationRangeError: string | undefined;
let pdfDocumentTranslationSkipReferencesEnabled = false;
let pdfDocumentTranslationSkipAppendixEnabled = false;
let pdfDocumentTranslationViewMode: PdfDocumentTranslationViewMode = 'compare';
let pdfDocumentTranslationDisplayedPage = 0;
let pdfDocumentTranslationReadingScrollTop = 0;
let pdfTranslationReadingAnchor: PdfTranslationReadingAnchor | undefined;
let pdfDocumentTranslationMultimodalEnabled = true;
let pdfDocumentTranslationMultimodalAuthorized = false;
interface PdfDocumentTranslationSessionContext {
  descriptor: PdfDocumentTranslationSessionDescriptor;
  behaviorKey: string;
}
let pdfDocumentTranslationSessionContext: PdfDocumentTranslationSessionContext | undefined;
let pdfDocumentTranslationSettings: Pick<
  PublicSettings,
  | 'sourceLanguage'
  | 'targetLanguage'
  | 'style'
  | 'contentMode'
  | 'autoRenderLatex'
  | 'activeApiProfileId'
  | 'visionApiProfileId'
  | 'visionModel'
  | 'apiProfiles'
  | 'modelPrices'
  | 'costTextSource'
> = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  autoRenderLatex: true,
  activeApiProfileId: 'default',
  visionApiProfileId: '',
  visionModel: '',
  apiProfiles: [],
};

interface TextSelectionGesture {
  pointerId: number;
  startX: number;
  startY: number;
  precise: boolean;
  pageElement: HTMLElement;
}

let textSelectionGesture: TextSelectionGesture | undefined;

interface CompletedTextSelectionGesture {
  documentEpoch: number;
  pageElement: HTMLElement;
  region: RegionRect;
  selectedText: string;
  capturedAt: number;
  startColumn?: 'left' | 'right';
  crossColumn?: 'constrained' | 'explicit';
  retainedSpanningContent?: boolean;
  tableLike?: boolean;
}

let completedTextSelectionGesture: CompletedTextSelectionGesture | undefined;

interface PdfSidebarLayout {
  expanded: boolean;
  side: 'left' | 'right';
  width: number;
}

let pdfSidebarLayout: PdfSidebarLayout = {
  expanded: false,
  side: 'right',
  width: 390,
};

type RegionInteraction =
  | { kind: 'draw'; pointerId: number; start: Point }
  | { kind: 'move'; pointerId: number; start: Point; initialRegion: RegionRect }
  | {
    kind: 'resize';
    pointerId: number;
    handle: RegionResizeHandle;
    start: Point;
    initialRegion: RegionRect;
  };

interface ActiveRegionSelection {
  documentEpoch: number;
  pageElement: HTMLElement;
  canvas: HTMLCanvasElement;
  region: RegionRect;
  box: HTMLElement;
  confirm?: HTMLElement;
  purpose: 'translate' | 'page-recognition';
  interaction: RegionInteraction | undefined;
}

let activeRegion: ActiveRegionSelection | undefined;
let sourceRegionHighlights: HTMLElement[] = [];
let sourceRegionHighlightTimer: ReturnType<typeof setTimeout> | undefined;

function clearSourceRegionHighlight(): void {
  for (const highlight of sourceRegionHighlights) highlight.remove();
  sourceRegionHighlights = [];
  if (sourceRegionHighlightTimer) clearTimeout(sourceRegionHighlightTimer);
  sourceRegionHighlightTimer = undefined;
}

type QueuedRegionTranslationPayload =
  | { kind: 'image'; capture: ImageRegionTranslationCapture }
  | { kind: 'text'; capture: PdfRegionTextTranslationCapture };

interface QueuedRegionTranslation {
  id: string;
  documentEpoch: number;
  pageLabel: string;
  cancelled: boolean;
  enqueuedAt: number;
  payload: QueuedRegionTranslationPayload;
}

const MAX_REGION_TRANSLATION_QUEUE = 3;
const regionTranslationQueue: QueuedRegionTranslation[] = [];
let regionTranslationRunning = false;
let activeRegionTranslation: QueuedRegionTranslation | undefined;

interface PageAnchor {
  pageNumber: number;
  ratio: number;
}

interface ResolvedPdfLinkDestination extends PageAnchor {
  destinationLabel: string;
}

const PDF_LINK_HISTORY_LIMIT = 20;
const pdfLinkHistory: PageAnchor[] = [];

interface DocumentOpenOperation {
  id: number;
  epoch: number;
  controller: AbortController;
}

function currentZoom(): number {
  return zoomLevel;
}

type PdfLoadingStage = 'reading-local' | 'reading-online' | 'runtime' | 'parsing' | 'pages';

function setLoading(message: string | undefined, stageName?: PdfLoadingStage): void {
  loading.hidden = !message;
  if (message) {
    loadingText.textContent = message;
    if (stageName) loading.dataset.stage = stageName;
    else loading.removeAttribute('data-stage');
  } else {
    loading.removeAttribute('data-stage');
  }
}

type PdfNoticeTone = 'info' | 'success' | 'warning' | 'error';

function showNotice(
  message: string | undefined,
  options: {
    transient?: boolean;
    tone?: PdfNoticeTone;
    sourceOnly?: boolean;
    action?: { label: string; ariaLabel?: string; onClick: () => void };
  } = {},
): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = undefined;
  noticeRevision += 1;
  notice.hidden = !message;
  notice.dataset.sourceOnly = String(Boolean(options.sourceOnly));
  notice.replaceChildren();
  if (!message) {
    notice.removeAttribute('data-tone');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
  } else {
    const tone = options.tone ?? 'info';
    notice.dataset.tone = tone;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    notice.append(document.createTextNode(message));
  }
  if (message && options.action) {
    const action = document.createElement('button');
    action.className = 'notice-action';
    action.type = 'button';
    action.textContent = options.action.label;
    action.setAttribute('aria-label', options.action.ariaLabel ?? options.action.label);
    action.addEventListener('click', () => options.action?.onClick());
    notice.append(action);
  }
  notice.classList.toggle('transient', Boolean(message && options.transient));
  if (!message || !options.transient) return;
  const revision = noticeRevision;
  noticeTimer = setTimeout(() => {
    if (noticeRevision !== revision) return;
    notice.hidden = true;
    notice.textContent = '';
    notice.classList.remove('transient');
    notice.removeAttribute('data-tone');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    noticeTimer = undefined;
  }, options.action || options.tone === 'error' ? 8000 : 4500);
}

async function openPdfSettings(focus?:SettingsFocus):Promise<boolean>{
  try{
    const response=await browser.runtime.sendMessage({type:'OPEN_OPTIONS_PAGE',...(focus?{payload:{focus}}:{})} satisfies RuntimeMessage) as RuntimeResponse<{opened:true}>;
    if(response.ok)return true;
  }catch{}
  showNotice('无法打开完整设置，请从 Edge 扩展菜单进入 Pi Translator 设置。', {
    tone: 'error',
  });
  return false;
}

function setDocumentControls(enabled: boolean): void {
  toolbar.dataset.loaded = String(enabled);
  element<HTMLElement>('pdf-reader-view-tools').hidden = !enabled;
  element<HTMLElement>('pdf-reader-recognition-tools').hidden = !enabled;
  chooseFile.textContent = enabled ? '更换 PDF' : '打开 PDF';
  chooseFile.title = enabled ? '选择另一份本地 PDF 替换当前文档' : '选择一份本地 PDF';
  chooseFile.setAttribute(
    'aria-label',
    enabled ? '更换当前 PDF 文档' : '打开本地 PDF 文档',
  );
  zoomOut.disabled = !enabled || currentZoom() <= ZOOM_LEVELS[0] + 0.001;
  zoomIn.disabled = !enabled || currentZoom() >= ZOOM_LEVELS.at(-1)! - 0.001;
  fitWidth.disabled = !enabled;
  openOutline.disabled = !enabled;
  openOutline.hidden = !enabled;
  openSearch.disabled = !enabled;
  translateDocument.disabled = !enabled;
  zoomValue.value = `${Math.round(currentZoom() * 100)}%`;
  recognizePage.hidden = !enabled;
  recognizePage.disabled = !enabled;
  regionTranslate.disabled = !enabled;
  updateRegionAction();
}

function resetPdfDocumentTranslationScope(): void {
  pdfDocumentTranslationRangeMode = 'all';
  pdfDocumentTranslationRangePages = [];
  pdfDocumentTranslationRangeSummary = '';
  pdfDocumentTranslationRangeError = undefined;
  pdfDocumentTranslationSkipReferencesEnabled = false;
  pdfDocumentTranslationSkipAppendixEnabled = false;
  documentTranslationRange.value = 'all';
  documentTranslationCustomRange.hidden = true;
  documentTranslationCustomPages.value = '';
  documentTranslationSkipReferences.checked = false;
  documentTranslationSkipAppendix.checked = false;
}

function pdfDocumentTranslationPageInRange(pageNumber: number): boolean {
  return pdfDocumentTranslationRangeMode === 'all' ||
    pdfDocumentTranslationRangePages.includes(pageNumber);
}

function pdfDocumentTranslationUnreadablePagesInScope(): number[] {
  return pdfDocumentTranslationUnreadablePageNumbers.filter(
    (pageNumber) => pdfDocumentTranslationPageInRange(pageNumber),
  );
}

function pdfDocumentTranslationBlockInScope(
  block: PdfDocumentTranslationRuntimeBlock,
): boolean {
  if (!pdfBlockTouchesScope(block, pdfDocumentTranslationPageInRange)) return false;
  if (
    pdfDocumentTranslationSkipReferencesEnabled &&
    block.section === 'references'
  ) return false;
  if (
    pdfDocumentTranslationSkipAppendixEnabled &&
    block.section === 'appendix'
  ) return false;
  return true;
}

function scopedPdfDocumentTranslationBlocks(): PdfDocumentTranslationRuntimeBlock[] {
  return pdfDocumentTranslationBlocksState.filter((block) => block.included);
}

function pdfDocumentTranslationFormulaBlocks(): PdfDocumentTranslationRuntimeBlock[] {
  return pdfDocumentTranslationBlocksState.filter((block) => (
    !block.referencePreserved && pdfDocumentTranslationBlockContainsFormula(block)
  ));
}

function pdfDocumentTranslationFormulaBlocksInScope(): PdfDocumentTranslationRuntimeBlock[] {
  return scopedPdfDocumentTranslationBlocks().filter((block) => (
    !block.referencePreserved && pdfDocumentTranslationBlockContainsFormula(block)
  ));
}

function pdfDocumentTranslationVisualPurpose(
  block: PdfDocumentTranslationRuntimeBlock,
): ImageTranslationPurpose {
  if (block.kind === 'figure' || block.kind === 'table') return block.kind;
  return pdfDocumentTranslationBlockContainsFormula(block) ? 'formula' : 'document';
}

function pdfDocumentTranslationVisualObjectsInScope(): PdfDocumentTranslationRuntimeBlock[] {
  return scopedPdfDocumentTranslationBlocks().filter(
    (block) => !block.referencePreserved && (
      block.kind === 'figure' || block.kind === 'table'
    ),
  );
}

function pdfDocumentTranslationUsesUnifiedVision(): boolean {
  return pdfDocumentTranslationMultimodalEnabled &&
    pdfDocumentTranslationFormulaBlocks().length > 0;
}

function pdfDocumentTranslationBlockUsesVision(
  block: PdfDocumentTranslationRuntimeBlock,
): boolean {
  return !block.referencePreserved && pdfDocumentTranslationMultimodalEnabled &&
    pdfDocumentTranslationMultimodalAuthorized && (
      pdfDocumentTranslationUsesUnifiedVision() ||
      pdfDocumentTranslationVisualPurpose(block) !== 'document'
    );
}

function pdfDocumentTranslationCounts(): {
  translated: number;
  failed: number;
  total: number;
} {
  const progress = pdfDocumentProgress(pdfDocumentTranslationBlocksState);
  return {
    translated: progress.processed,
    failed: progress.failed,
    total: progress.total,
  };
}

function pdfDocumentTranslationScopeFeedback(): string {
  const scoped = scopedPdfDocumentTranslationBlocks();
  if (!scoped.length) return '';
  const selectedPages = new Set(scoped.flatMap(block => {
    const regions = pdfDocumentTranslationSourceRegions(block);
    return regions.length ? regions.map(region => region.pageNumber) : [block.pageNumber];
  })).size;
  const supplements = pdfSupplementarySourcePages(scoped, pdfDocumentTranslationPageInRange);
  const baseLabel = pdfDocumentTranslationRangeMode === 'all'
    ? '整篇文档'
    : pdfDocumentTranslationRangeMode === 'current'
      ? `第 ${pdfDocumentTranslationRangePages[0] ?? 1} 页`
      : `${pdfDocumentTranslationRangeSummary} 页`;
  const skippedReferences = pdfDocumentTranslationSkipReferencesEnabled
    ? pdfDocumentTranslationBlocksState.filter((block) => (
        pdfDocumentTranslationPageInRange(block.pageNumber) && block.section === 'references'
      )).length
    : 0;
  const skippedAppendix = pdfDocumentTranslationSkipAppendixEnabled
    ? pdfDocumentTranslationBlocksState.filter((block) => (
        pdfDocumentTranslationPageInRange(block.pageNumber) && block.section === 'appendix'
      )).length
    : 0;
  const preservedReferences = scoped.filter((block) => block.referencePreserved).length;
  const skipped = [
    skippedReferences ? `参考文献 ${skippedReferences} 段` : '',
    skippedAppendix ? `附录 ${skippedAppendix} 段` : '',
  ].filter(Boolean);
  return `${baseLabel}${supplements.length ? ` · 已自动补齐第 ${supplements.join('、')} 页续段` : ''} · ${selectedPages} 页 / ${scoped.length} 段${
    skipped.length ? ` · 已跳过${skipped.join('、')}` : ''
  }${preservedReferences ? ` · 参考文献 ${preservedReferences} 段保留原文` : ''}`;
}

function currentPdfDocumentTranslationSessionContext():
  PdfDocumentTranslationSessionContext | undefined {
  if(cachedReadingContext?.kind==='pdf'){
    const {documentKey,targetLanguage,sourceLanguage,style,contentMode,behaviorKey}=cachedReadingContext.record;
    return {descriptor:{documentKey,targetLanguage,sourceLanguage,style,contentMode},behaviorKey};
  }
  const identity = currentReadingIdentity;
  const targetLanguage = pdfDocumentTranslationSettings.targetLanguage;
  if (!identity || !isSupportedTargetLanguage(targetLanguage)) return undefined;
  const activeProfile = pdfDocumentTranslationSettings.apiProfiles.find(
    (profile) => profile.id === pdfDocumentTranslationSettings.activeApiProfileId,
  );
  return {
    descriptor: {
      documentKey: libraryRestoreDocumentKey ?? pdfDocumentTranslationSessionDocumentKey(identity),
      targetLanguage,
      sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
      style: pdfDocumentTranslationSettings.style,
      contentMode: pdfDocumentTranslationSettings.contentMode,
    },
    behaviorKey: pdfDocumentTranslationSessionBehaviorKey([
      'pdf-semantic-visual-objects-v10',
      pdfDocumentTranslationUsesUnifiedVision()
        ? 'unified-vision'
        : pdfDocumentTranslationMultimodalEnabled &&
            pdfDocumentTranslationVisualObjectsInScope().length
          ? 'hybrid-vision'
          : 'text',
      pdfDocumentTranslationSettings.activeApiProfileId,
      activeProfile?.model ?? '',
      pdfDocumentTranslationSettings.visionApiProfileId ?? '',
      pdfDocumentTranslationSettings.visionModel ?? '',
    ].join('\n')),
  };
}

function samePdfDocumentTranslationSessionContext(
  left: PdfDocumentTranslationSessionContext | undefined,
  right: PdfDocumentTranslationSessionContext | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.behaviorKey === right.behaviorKey &&
    JSON.stringify(left.descriptor) === JSON.stringify(right.descriptor);
}

function pdfDocumentTranslationSessionActivity(): PdfDocumentTranslationSessionActivity {
  if (pdfDocumentTranslationPhase === 'complete') return 'complete';
  if (pdfDocumentTranslationPhase === 'stopped') return 'stopped';
  if (pdfDocumentTranslationPhase === 'running') return 'active';
  return 'paused';
}

function pdfDocumentTranslationSessionUpdate(
  context: PdfDocumentTranslationSessionContext,
  blocks: readonly PdfDocumentTranslationRuntimeBlock[],
  replaceBlocks = false,
) {
  const completed = [...new Set([...blocks,...pdfDocumentTranslationBlocksState.filter(block=>block.retranslation)])].flatMap((block) => (
    (block.status === 'done'||block.retranslation) && !block.referencePreserved && block.translatedText?.trim()
      ? [{ signature: block.sessionSignature, translatedText: block.formulaDocument
          ? block.formulaDocument.translationTemplate : block.translatedText.trim(),
          ...(!block.omitReadingMetadata?{pageNumber:block.pageNumber,...(pdfDisplayHeadingLevel(block)?{headingLevel:pdfDisplayHeadingLevel(block)!}:{})}:{}),
          ...(block.paperRole?{paperRole:block.paperRole}:{}),
          ...(block.manualCorrection?{manualCorrection:true as const}:{}),
          ...(block.retranslation?{retranslation:true as const}:{}),
          ...(block.revisions?{revisions:block.revisions}:{}),
          ...(block.reviewConfirmation ? { reviewConfirmation: block.reviewConfirmation } : {}),
          ...(block.formulaReviewMessage ? { formulaReviewMessage: block.formulaReviewMessage } : {}),
          ...(block.formulaReviewDraft ? { formulaReviewDraft: true as const } : {}),
          ...(block.formulaDocument ? { formulaDocument: block.formulaDocument } : {}),
          ...(block.visualFallbackMessage ? { visualFallbackMessage: block.visualFallbackMessage } : {}),
        }]
      : []
  ));
  const documentSignatures = pdfDocumentTranslationBlocksState.map(block => block.sessionSignature);
  const currentSignatures = new Set(documentSignatures);
  const archivedBlocks = pdfDocumentTranslationArchivedBlocks.filter(block => !currentSignatures.has(block.signature));
  return {
    descriptor: context.descriptor,
    documentSignatures,
    scopeSignatures: pdfDocumentTranslationBlocksState.filter(block => block.included).map(block => block.sessionSignature),
    preservedSignatures: pdfDocumentTranslationBlocksState.filter(block => block.referencePreserved && block.status === 'done').map(block => block.sessionSignature),
    ...(archivedBlocks.length ? {archivedBlocks} : {}),
    activity: pdfDocumentTranslationSessionActivity(),
    ...(currentPdfContentFingerprint ? {sourceFingerprint:currentPdfContentFingerprint} : {}),
    plan: {
      mode: pdfDocumentTranslationRangeMode,
      pages: [...pdfDocumentTranslationRangePages],
      skipReferences: pdfDocumentTranslationSkipReferencesEnabled,
      skipAppendix: pdfDocumentTranslationSkipAppendixEnabled,
      multimodal: pdfDocumentTranslationMultimodalEnabled,
      requestLimit: pdfRequestLimit(),
    },
    ...(completed.length ? { blocks: completed } : {}),
    ...(replaceBlocks ? { replaceBlocks: true } : {}),
  };
}

async function persistPdfDocumentTranslationSession(
  blocks: readonly PdfDocumentTranslationRuntimeBlock[] = [],
  replaceBlocks = false,
): Promise<boolean> {
  if(cachedReadingContext)return persistCachedReading();
  const context = pdfDocumentTranslationSessionContext;
  if (!context) return false;
  const update = pdfDocumentTranslationSessionUpdate(context, blocks, replaceBlocks);
  const sessionNeedsFull = pdfDocumentTranslationSessionWriteDirty;
  const retainedNeedsFull = pdfDocumentTranslationRetentionWriteDirty;
  const retainLocally = pdfDocumentTranslationRetainedLocally;
  const fullUpdate = sessionNeedsFull || retainedNeedsFull
    ? pdfDocumentTranslationSessionUpdate(context, pdfDocumentTranslationBlocksState.filter(block => block.status === 'done'), true)
    : update;
  const current = () => samePdfDocumentTranslationSessionContext(context, pdfDocumentTranslationSessionContext);
  let sessionSaved = false;
  let retainedSaved = false;
  if(current()){pdfDocumentTranslationSavesInFlight++;syncPdfDocumentTranslationUi()}
  try {
  try {
    const saved=await savePdfDocumentTranslationSession(sessionNeedsFull ? fullUpdate : update, context.behaviorKey);
    if(current())for(const result of saved.blocks){const block=pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===result.signature);if(block&&result.revisions)block.revisions=result.revisions}
    sessionSaved = true;
    if (current()) pdfDocumentTranslationSessionWriteDirty = false;
  } catch {
    if (current()) pdfDocumentTranslationSessionWriteDirty = true;
    // Session checkpoints are best effort and must never stop translation.
  }
  if (retainLocally) {
    try {
      await saveRetainedPdfDocumentTranslationSession(retainedNeedsFull ? fullUpdate : update, context.behaviorKey);
      retainedSaved = true;
      if (current()) pdfDocumentTranslationRetentionWriteDirty = false;
      if (current() && pdfDocumentTranslationRetentionError) {
        pdfDocumentTranslationRetentionError = false;
        pdfDocumentTranslationRetentionMessage = undefined;
      }
    } catch (error) {
      if (!current()) return sessionSaved;
      pdfDocumentTranslationRetentionWriteDirty = true;
      pdfDocumentTranslationRetentionError = true;
      pdfDocumentTranslationRetentionMessage =
        error instanceof Error ? error.message : '本机保留暂时失败；当前 Edge 会话中的进度仍然安全。';
      syncPdfDocumentTranslationUi();
    }
  }
  for(const block of blocks){
    const before=stagedPdfReplacements.get(block);if(!before)continue;
    if(!sessionSaved&&!retainedSaved&&current()){
      applyPdfParagraphValue(block,before);block.retranslation=true;block.status='error';block.errorMessage='新译文尚未保存，继续保留旧稿。请检查存储后重试。';renderPdfDocumentTranslationBlock(block);
    }
    stagedPdfReplacements.delete(block);
  }
  return sessionSaved || retainedSaved;
  } finally {
    if(current()){pdfDocumentTranslationSavesInFlight=Math.max(0,pdfDocumentTranslationSavesInFlight-1);syncPdfDocumentTranslationUi()}
  }
}

function showPdfParagraphSaveScope(): void {
  if (pdfDocumentTranslationRetentionWriteDirty) {
    showNotice('修正已保留在当前会话，本机保存暂未成功。', {tone: 'warning'});
  } else if (pdfDocumentTranslationSessionWriteDirty && pdfDocumentTranslationRetainedLocally) {
    showNotice('修正已保留到本机，当前会话写入暂未成功。', {tone: 'warning'});
  }
}

async function setPdfDocumentTranslationRetention(enabled: boolean): Promise<void> {
  const context = pdfDocumentTranslationSessionContext;
  if (!context || pdfDocumentTranslationRetentionPending) return;
  pdfDocumentTranslationRetentionPending = true;
  pdfDocumentTranslationRetentionError = false;
  pdfDocumentTranslationRetentionMessage = enabled ? '正在保存到本机…' : '正在清除本机保存…';
  pdfDocumentTranslationRetainedLocally = enabled;
  syncPdfDocumentTranslationUi();
  try {
    if (enabled) {
      pdfDocumentTranslationRetainedLocally = true;
      await saveRetainedPdfDocumentTranslationSession(
        pdfDocumentTranslationSessionUpdate(
          context,
          pdfDocumentTranslationBlocksState,
          true,
        ),
        context.behaviorKey,
      );
      pdfDocumentTranslationRetentionMessage =
        '已保留到本机；再次打开同一 PDF 会自动恢复。';
    } else {
      await clearRetainedPdfDocumentTranslationSession(context.descriptor);
      pdfDocumentTranslationRetentionMessage = '本机保存已清除；当前会话中的译文不受影响。';
    }
  } catch {
    pdfDocumentTranslationRetainedLocally = !enabled;
    pdfDocumentTranslationRetentionError = true;
    pdfDocumentTranslationRetentionMessage = enabled
      ? '无法保留到本机，请检查扩展存储空间后重试。'
      : '无法清除本机保存，请稍后重试。';
  } finally {
    pdfDocumentTranslationRetentionPending = false;
    syncPdfDocumentTranslationUi();
  }
}

function rebuildPdfDocumentTranslationResults(): void {
  documentTranslationPages.replaceChildren();
  for (const block of pdfDocumentTranslationBlocksState) {
    if (!block.included || block.status === 'idle') continue;
    renderPdfDocumentTranslationBlock(block);
  }
  syncPdfDocumentTranslationCurrentPage();
}

function applyPdfDocumentTranslationScope(): boolean {
  const included = pdfDocumentTranslationBlocksState.map(
    (block) => pdfDocumentTranslationBlockInScope(block),
  );
  if (pdfDocumentTranslationBlocksState.length && !included.some(Boolean)) {
    pdfDocumentTranslationRangeError = '这个范围没有可翻译正文，请调整页码或跳过选项。';
    syncPdfDocumentTranslationUi();
    return false;
  }
  const changed = included.some(
    (value, index) => value !== pdfDocumentTranslationBlocksState[index]?.included,
  );
  const previousPhase = pdfDocumentTranslationPhase;
  if (changed && (
    pdfDocumentBackgroundJobId ||
    pdfDocumentTranslationRequestId ||
    pdfDocumentTranslationBlocksState.some((block) => block.status === 'translating')
  )) {
    pdfDocumentTranslationRevision += 1;
    disposePdfDocumentBackgroundJob();
    cancelPdfDocumentTranslationRequest();
    for (const block of pdfDocumentTranslationBlocksState) {
      if (block.status === 'translating') block.status = 'idle';
    }
  }
  pdfDocumentTranslationBlocksState.forEach((block, index) => {
    block.included = included[index] ?? false;
  });
  if (changed) pdfDocumentTranslationMultimodalAuthorized = false;
  pdfDocumentTranslationRangeError = undefined;
  rebuildPdfDocumentTranslationResults();
  if (pdfDocumentTranslationRangeMode !== 'all' && !pdfDocumentTranslationPageInRange(visiblePageAnchor().pageNumber)) {
    const pageNumber = pdfDocumentTranslationRangePages[0];
    if (pageNumber) { scrollToPageAnchor({pageNumber, ratio: 0}); updatePageControl({pageNumber, ratio: 0}); syncPdfDocumentTranslationCurrentPage(pageNumber); }
  }
  if (!pdfDocumentTranslationBlocksState.length) {
    syncPdfDocumentTranslationUi();
    return true;
  }
  const scoped = scopedPdfDocumentTranslationBlocks();
  const allSettled = scoped.every((block) => ['done', 'error'].includes(block.status));
  const translated = scoped.some((block) => block.status === 'done');
  if (allSettled) {
    pdfDocumentTranslationPhase = 'complete';
  } else if (previousPhase === 'stopped') {
    pdfDocumentTranslationPhase = 'stopped';
  } else if (
    previousPhase === 'running' ||
    previousPhase === 'paused' ||
    previousPhase === 'complete' ||
    previousPhase === 'error' ||
    translated
  ) {
    pdfDocumentTranslationPhase = 'paused';
  } else if (pdfDocumentTranslationBlocksState.length) {
    pdfDocumentTranslationPhase = 'ready';
  }
  pdfDocumentTranslationMessage = previousPhase === 'running' && changed
    ? '范围已更新，全文翻译已暂停。'
    : undefined;
  syncPdfDocumentTranslationUi();
  if (pdfDocumentTranslationSessionContext) void persistPdfDocumentTranslationSession();
  return true;
}

function updatePdfDocumentTranslationRange(
  mode: PdfDocumentTranslationRangeMode,
  pages: number[],
  summary = '',
): boolean {
  const previous = {
    mode: pdfDocumentTranslationRangeMode,
    pages: [...pdfDocumentTranslationRangePages],
    summary: pdfDocumentTranslationRangeSummary,
  };
  pdfDocumentTranslationRangeMode = mode;
  pdfDocumentTranslationRangePages = [...pages];
  pdfDocumentTranslationRangeSummary = summary;
  documentTranslationRange.value = mode;
  documentTranslationCustomRange.hidden = mode !== 'custom';
  pdfDocumentTranslationOcrMessage = undefined;
  pdfDocumentTranslationOcrError = false;
  if (applyPdfDocumentTranslationScope()) return true;
  pdfDocumentTranslationRangeMode = previous.mode;
  pdfDocumentTranslationRangePages = previous.pages;
  pdfDocumentTranslationRangeSummary = previous.summary;
  documentTranslationRange.value = previous.mode;
  documentTranslationCustomRange.hidden = previous.mode !== 'custom';
  syncPdfDocumentTranslationUi();
  return false;
}

function updatePdfDocumentTranslationInset(): void {
  const width = !documentTranslationPanel.hidden &&
      pdfDocumentTranslationViewMode === 'compare' &&
      !matchMedia('(max-width: 620px)').matches
    ? Math.round(documentTranslationPanel.getBoundingClientRect().width)
    : 0;
  stage.style.setProperty('--pdf-document-sidebar-right', `${width}px`);
  scheduleFitWidthRefresh();
}

function syncPdfDocumentTranslationCurrentPage(pageNumber = visiblePageAnchor().pageNumber): void {
  const totalPages = pdfDocument?.numPages ?? 0;
  const safePageNumber = totalPages
    ? clamp(Math.round(pageNumber), 1, totalPages)
    : Math.max(1, Math.round(pageNumber));
  const displayedPageChanged = pdfDocumentTranslationDisplayedPage !== safePageNumber;
  pdfDocumentTranslationDisplayedPage = safePageNumber;
  documentTranslationPanel.dataset.viewMode = pdfDocumentTranslationViewMode;
  documentTranslationReader.dataset.viewMode = pdfDocumentTranslationViewMode;
  documentTranslationViewReading.setAttribute(
    'aria-pressed',
    String(pdfDocumentTranslationViewMode === 'reading'),
  );
  documentTranslationViewCompare.setAttribute(
    'aria-pressed',
    String(pdfDocumentTranslationViewMode === 'compare'),
  );
  const pageNavigation = documentTranslationPageStatus.closest<HTMLElement>('nav');
  if (pageNavigation) pageNavigation.hidden = pdfDocumentTranslationViewMode !== 'compare';
  documentTranslationPageStatus.textContent = `${safePageNumber} / ${Math.max(1, totalPages)}`;
  documentTranslationPagePrevious.disabled = !totalPages || safePageNumber <= 1;
  documentTranslationPageNext.disabled = !totalPages || safePageNumber >= totalPages;
  for (const section of documentTranslationPages.querySelectorAll<HTMLElement>(
    '.pdf-document-translation-page[data-page-number]',
  )) {
    section.toggleAttribute(
      'data-current',
      Number(section.dataset.pageNumber) === safePageNumber,
    );
  }
  const currentSection = documentTranslationPages.querySelector<HTMLElement>(
    `.pdf-document-translation-page[data-page-number="${safePageNumber}"]`,
  );
  const currentBlocks = pdfDocumentTranslationBlocksState.filter((block) => (
    block.included && block.pageNumber === safePageNumber
  ));
  documentTranslationPageEmpty.hidden = pdfDocumentTranslationViewMode !== 'compare' ||
    Boolean(currentSection);
  if (!documentTranslationPageEmpty.hidden) {
    const awaitingOcr = pdfDocumentTranslationPageInRange(safePageNumber) &&
      pdfDocumentTranslationUnreadablePageNumbers.includes(safePageNumber);
    documentTranslationPageEmpty.textContent = awaitingOcr
      ? pdfDocumentTranslationOcrRunning ? '正在识别本页文字…' : '本页需要先识别文字。'
      : pdfDocumentTranslationPhase === 'ready'
        ? '选择翻译范围，开始后在这里阅读译文。'
      : !currentBlocks.length
      ? `第 ${safePageNumber} 页不在当前翻译范围内。`
      : currentBlocks.some((block) => block.status === 'idle')
        ? `第 ${safePageNumber} 页译文尚未完成，全文翻译会继续在后台处理。`
        : `第 ${safePageNumber} 页暂时没有可显示的译文。`;
  }
  if (displayedPageChanged && pdfDocumentTranslationViewMode === 'compare') {
    documentTranslationPages.scrollTop = 0;
  }
}

function setPdfDocumentTranslationViewMode(mode: PdfDocumentTranslationViewMode): void {
  if (pdfDocumentTranslationViewMode === mode) return;
  if (pdfDocumentTranslationViewMode === 'reading') {
    pdfTranslationReadingAnchor=currentPdfTranslationReadingAnchor();
    pdfDocumentTranslationReadingScrollTop = documentTranslationPages.scrollTop;
  }
  pdfDocumentTranslationViewMode = mode;
  documentTranslationPages.scrollTop = 0;
  syncPdfDocumentTranslationCurrentPage();
  if (mode === 'reading') {
    documentTranslationSettings.open = false;
    (documentTrial as HTMLDetailsElement).open = false;
    documentTranslationPages.scrollTop = pdfDocumentTranslationReadingScrollTop;
    if(!pdfDocumentTranslationReadingScrollTop && pdfTranslationReadingAnchor?.mode==='compare'){
      pdfTranslationReadingAnchor={...pdfTranslationReadingAnchor,mode:'reading'};
      restorePdfTranslationReadingAnchor();
    }
  }
  updatePdfDocumentTranslationInset();
  scheduleReadingStateSave();
}

function movePdfDocumentTranslationReadingPage(direction: -1 | 1): void {
  const totalPages = pdfDocument?.numPages ?? 0;
  if (!totalPages) return;
  const pageNumber = clamp(pdfDocumentTranslationDisplayedPage + direction, 1, totalPages);
  if (pageNumber === pdfDocumentTranslationDisplayedPage) return;
  scrollToPageAnchor({ pageNumber, ratio: 0 });
  updatePageControl({ pageNumber, ratio: 0 });
  schedulePageRetention();
}

function pdfRequestLimit(): number {
  const limit = documentRequestLimit.valueAsNumber;
  return validPdfRequestLimit(limit) ? limit : 0;
}

function takePdfTaskRequest(kind: 'text' | 'vision' | 'ocr'): void {
  try { consumePdfRequest(pdfRequestUsage, kind, pdfRequestLimit()); }
  catch (error) {
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = error instanceof Error ? error.message : '已达到任务请求上限。';
    syncPdfDocumentTranslationUi();
    throw error;
  }
}

function pdfTrialUsesVision(block: PdfDocumentTranslationRuntimeBlock): boolean {
  return pdfDocumentTranslationMultimodalEnabled && (pdfDocumentTranslationUsesUnifiedVision() ||
    pdfDocumentTranslationVisualPurpose(block) !== 'document');
}

function syncPdfTrialUi(): void {
  const candidates = pdfDocumentTranslationBlocksState.filter((block) => block.included &&
    !block.referencePreserved && (block.status === 'idle' || block.status === 'error'));
  documentTrial.hidden = !candidates.length || ['idle', 'preparing', 'complete'].includes(pdfDocumentTranslationPhase) ||
    (!pdfTrialRunning && (pdfDocumentTranslationPhase === 'running' || pdfDocumentTranslationOcrRunning));
  if (pdfTrialRunning) {
    documentTrialStart.disabled = true;
    documentTrialNote.textContent = '正在试译所选段落…';
    return;
  }
  const selected = documentTrialBlock.value;
  const available = candidates.map((block) => block.id).join(',');
  if (documentTrialBlock.dataset.available !== available) {
    documentTrialBlock.replaceChildren(...candidates.map((block) => {
      const option = document.createElement('option');
      option.value = block.id;
      option.textContent = `第 ${block.pageNumber} 页 · ${block.text.replace(/\s+/gu, ' ').slice(0, 55)}`;
      return option;
    }));
    documentTrialBlock.dataset.available = available;
    if (candidates.some((block) => block.id === selected)) documentTrialBlock.value = selected;
  }
  const block = candidates.find((candidate) => candidate.id === documentTrialBlock.value);
  const busy = pdfDocumentTranslationPhase === 'running' || pdfDocumentTranslationOcrRunning;
  const preservedFormula = block?.kind === 'formula' && !pdfTrialUsesVision(block);
  documentTrialStart.disabled = !block || busy || preservedFormula;
  documentTrialBlock.disabled = busy || !candidates.length;
  documentTrialNote.textContent = preservedFormula
    ? '本段包含公式，纯文本模式会保留原文。开启智能多模态后可试译，或选择其他文字段落。'
    : block && pdfTrialUsesVision(block)
    ? `只发送本段原文区域，预计 ${block.visualUnits?.length ?? 1} 次视觉请求；点击后开始发送。`
    : '只发送本段文字；已完成结果可供后续全文任务复用。';
}

async function trialPdfDocumentBlock(blockId = documentTrialBlock.value): Promise<void> {
  if (pdfTrialRunning || ['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning) return;
  if (!documentRequestLimit.checkValidity()) { documentRequestLimit.reportValidity(); return; }
  const block = pdfDocumentTranslationBlocksState.find((candidate) => candidate.id === blockId && candidate.included);
  if (!block) return;
  if (block.kind === 'formula' && !pdfTrialUsesVision(block)) { syncPdfTrialUi(); return; }
  const previous = { ...block };
  await sendPdfDocumentBackgroundControl('dispose');
  const revision = pdfDocumentTranslationRevision;
  pdfTrialRunning = true;
  pdfDocumentTranslationPhase = 'running';
  syncPdfDocumentTranslationUi();
  try {
    if (pdfTrialUsesVision(block)) {
      const completed = await processPdfDocumentTranslationVisualBlock(block, revision, false, previous.status === 'done');
      if (!completed && revision === pdfDocumentTranslationRevision) {
        Object.assign(block, previous);
        renderPdfDocumentTranslationBlock(block);
      }
    } else if (block.kind === 'formula') {
      block.status = 'done';
      block.translatedText = block.text;
      block.visualFallbackMessage = '纯文本模式下公式保持原样';
      renderPdfDocumentTranslationBlock(block);
      await persistPdfDocumentTranslationSession([block]);
    } else {
      takePdfTaskRequest('text');
      const requestId = crypto.randomUUID();
      pdfDocumentTranslationRequestId = requestId;
      block.status = 'translating';
      renderPdfDocumentTranslationBlock(block);
      const response = await browser.runtime.sendMessage({ type: 'TRANSLATE_DOCUMENT_BATCH', payload: {
        requestId, items: [{ id: block.id, text: block.text }],
        documentId: currentReadingIdentity ?? currentDocumentSessionId, pageUrl: currentSourceUrl,
        targetLanguage: pdfDocumentTranslationSettings.targetLanguage, sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
        style: pdfDocumentTranslationSettings.style, contentMode: pdfDocumentTranslationSettings.contentMode,
      } } satisfies RuntimeMessage) as TranslationBatchRuntimeResponse;
      if (revision !== pdfDocumentTranslationRevision) return;
      pdfDocumentTranslationRequestId = undefined;
      if (!response.ok) throw new Error(translationErrorMessage(response.error.code, response.error.message));
      addPdfReportedTokens(pdfRequestUsage, response.data.usage, response.data.usageSource);
      const text = response.data.items.find((item) => item.id === block.id)?.translatedText.trim();
      if (!text) throw new Error('模型未返回所选段落的译文。');
      block.status = 'done';
      block.translatedText = text;
      delete block.errorMessage;
      renderPdfDocumentTranslationBlock(block);
      await persistPdfDocumentTranslationSession([block]);
    }
    if (revision === pdfDocumentTranslationRevision && pdfDocumentTranslationPhase === 'running') {
      pdfDocumentTranslationPhase = 'paused';
      const progress = pdfDocumentTranslationCounts();
      pdfDocumentTranslationMessage = `试译完成 · ${progress.translated}/${progress.total}`;
      documentTranslationSettings.open = false;
      documentTrial.open = false;
    }
  } catch (error) {
    if (revision !== pdfDocumentTranslationRevision) return;
    Object.assign(block, previous);
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = error instanceof Error ? error.message : '试译失败。';
    renderPdfDocumentTranslationBlock(block);
  } finally {
    pdfTrialRunning = false;
    syncPdfDocumentTranslationUi();
  }
}

function syncPdfReviewQueue(): void {
  const all = pdfReviewQueue(pdfDocumentTranslationBlocksState);
  documentReview.hidden = !pdfDocumentTranslationBlocksState.length || all.length === 0 ||
    all.every(item=>item.kind==='untranslated' && !item.block.formulaReviewMessage && !item.block.visualFallbackMessage && !item.block.errorMessage);
  const confirmed = all.filter((item) => item.confirmed).length;
  documentReviewSummary.textContent = `核对清单 · ${all.length - confirmed} 段待处理${confirmed ? ` · ${confirmed} 段已人工核对` : ''}`;
  if (!documentReview.open) return;
  const labels = { untranslated: '尚未翻译', failed: '翻译失败', formula: '译文待核对', original: '保留原文' };
  const items = pdfReviewQueue(pdfDocumentTranslationBlocksState, documentReviewFilter.value as 'all' | PdfReviewKind);
  const fragment = document.createDocumentFragment();
  for (const { block, kind, confirmed: reviewed } of items.slice(0, 50)) {
    const source = pdfDocumentTranslationBlocksState.find((candidate) => candidate.id === block.id)!;
    const row = document.createElement('div');
    row.className = 'pdf-document-review-item';
    row.dataset.reviewBlock = block.id;
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.textContent = `第 ${block.pageNumber} 页 · ${block.id} · ${reviewed ? '已人工核对' : labels[kind]}`;
    locate.title = block.formulaReviewMessage ?? block.visualFallbackMessage ?? block.errorMessage ?? '返回本段原文';
    locate.addEventListener('click', () => activatePdfDocumentTranslationSource(source));
    row.append(locate);
    if (kind !== 'untranslated') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试本段';
      retry.title = pdfTrialUsesVision(source) ? '重新发送本段原文区域进行视觉翻译' : '重新发送本段文字';
      retry.disabled = ['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning;
      retry.addEventListener('click', () => {
        foregroundVisualUnits.delete(source);
        void trialPdfDocumentBlock(source.id);
      });
      row.append(retry);
    }
    if (kind === 'formula' || kind === 'original') {
      const acknowledge = document.createElement('button');
      acknowledge.type = 'button';
      acknowledge.textContent = reviewed ? '撤销确认' : '标记已核对';
      acknowledge.title = '只记录人工核对状态，保留模型警告与原文';
      acknowledge.disabled = ['running', 'preparing'].includes(pdfDocumentTranslationPhase);
      acknowledge.addEventListener('click', async () => {
        acknowledge.disabled = true;
        acknowledge.textContent = '正在保存…';
        const previous = source.reviewConfirmation;
        if (reviewed) delete source.reviewConfirmation;
        else source.reviewConfirmation = pdfReviewConfirmation(source);
        const saved = await persistPdfDocumentTranslationSession([source]);
        if (!saved) {
          if (previous) source.reviewConfirmation = previous;
          else delete source.reviewConfirmation;
          showNotice('核对状态未能保存，请稍后再试。', { tone: 'error' });
        }
        syncPdfReviewQueue();
      });
      row.append(acknowledge);
    }
    fragment.append(row);
  }
  if (!items.length) fragment.append(document.createTextNode('没有符合筛选条件的段落。'));
  if (items.length > 50) fragment.append(document.createTextNode('先显示前 50 段；可选择类别缩小范围。'));
  documentReviewList.replaceChildren(fragment);
}

function syncPdfDocumentTranslationSetupUi(): void {
  const preparing = ['idle', 'preparing'].includes(pdfDocumentTranslationPhase);
  const preflight = pdfDocumentTranslationPhase === 'ready' && !pdfDocumentTranslationOcrRunning &&
    !pdfDocumentTranslationBlocksState.some((block) => block.included && block.status === 'done');
  documentTranslationPanel.dataset.setup = String(preflight);
  documentTranslationSettings.hidden = preparing || (!preflight && !documentTranslationSettings.open);
  documentTranslationShowSettings.hidden = preparing || preflight;
}

function syncPdfDocumentTranslationUi(): void {
  const canEdit=!['running','preparing'].includes(pdfDocumentTranslationPhase)&&!pdfDocumentTranslationOcrRunning;
  for(const button of documentTranslationPages.querySelectorAll<HTMLButtonElement>('.pdf-paragraph-edit-action'))button.disabled=!canEdit;
  element<HTMLButtonElement>('pdf-document-undo-correction').hidden=!canEdit||!lastParagraphCorrection||lastParagraphCorrection.documentSessionId!==currentDocumentSessionId||lastParagraphCorrection.stamp!==pdfParagraphStamp(lastParagraphCorrection.block);
  element<HTMLButtonElement>('pdf-document-history').hidden=!canEdit||!pdfDocumentTranslationBlocksState.some(block=>block.revisions?.length);
  element<HTMLButtonElement>('pdf-document-terms').hidden=!canEdit||!pdfDocument||!pdfDocumentTranslationBlocksState.some(block=>block.status==='done'&&!block.referencePreserved);
  if(cachedReadingContext){syncCachedReadingUi();return}
  syncPdfDocumentTranslationSetupUi();
  documentTranslationName.textContent = documentName.textContent;
  syncPdfReviewQueue();
  syncPdfTrialUi();
  documentRequestLimit.disabled = pdfDocumentTranslationPhase === 'running' || pdfTrialRunning;
  documentRequestUsage.textContent = `任务请求：文字 ${pdfRequestUsage.text} 次 · 视觉 ${pdfRequestUsage.vision} 次 · OCR ${pdfRequestUsage.ocr} 次` +
    (pdfRequestUsage.reportedTokens ? ` · 接口已报告 ${pdfRequestUsage.reportedTokens.totalTokens} tokens（未报告部分不计）` : ' · 接口用量未报告');
  const prices = pdfDocumentTranslationSettings.modelPrices ?? [];
  const costs = reportedCost(pdfRequestUsage.byModel ?? [], prices);
  const amounts = Object.entries(costs.amounts).map(([currency, amount]) => formatCost(amount!, currency as 'CNY' | 'USD'));
  const textSource = pdfDocumentTranslationSettings.costTextSource;
  const price = textSource ? findModelPrice(prices, textSource) : undefined;
  const pendingCharacters = pdfDocumentTranslationBlocksState.filter((block) => block.included && block.status !== 'done' && !block.referencePreserved && !pdfTrialUsesVision(block) && block.kind !== 'formula' && block.kind !== 'code')
    .reduce((sum, block) => sum + block.text.length, 0);
  const forecast = price && pendingCharacters ? roughTextCost(pendingCharacters, price).map((amount) => formatCost(amount, price.currency)).join('–') : '';
  documentCostEstimate.textContent = `已报告用量费用：${amounts.join(' + ') || '未知'}` +
    (costs.unpricedModels.length ? ` · 未设单价：${costs.unpricedModels.join('、')}` : '') +
    (forecast ? `。剩余文字粗估 ${forecast}` : !price ? '。可在设置中填写模型单价' : '');
  const { translated, failed, total } = pdfDocumentTranslationCounts();
  const pending = Math.max(0, total - translated - failed);
  const progressPercent = total
    ? Math.min(100, Math.round((translated / total) * 100))
    : 0;
  const hasPreparedBlocks = pdfDocumentTranslationBlocksState.length > 0;
  const unreadablePagesInScope = pdfDocumentTranslationUnreadablePagesInScope();
  const documentFormulaBlocks = pdfDocumentTranslationFormulaBlocks();
  const formulaBlocksInScope = pdfDocumentTranslationFormulaBlocksInScope();
  const visualObjectsInScope = pdfDocumentTranslationVisualObjectsInScope();
  const preservedReferencesInScope = scopedPdfDocumentTranslationBlocks().filter(
    (block) => block.referencePreserved,
  ).length;
  const requestableBlocksInScope = Math.max(0, total - preservedReferencesInScope);
  const visualRequestsInScope = scopedPdfDocumentTranslationBlocks().filter((block) => !block.referencePreserved)
    .reduce((count, block) => count + (block.visualUnits?.length ?? 1), 0);
  const referencePreservationNote = preservedReferencesInScope
    ? `；${preservedReferencesInScope} 段参考文献保留原文且不发送请求`
    : '';
  const referenceDetail = preservedReferencesInScope
    ? '参考文献条目按原文保留且不发送翻译请求。'
    : '';
  const figureObjectsInScope = visualObjectsInScope.filter((block) => block.kind === 'figure');
  const tableObjectsInScope = visualObjectsInScope.filter((block) => block.kind === 'table');
  const usesUnifiedVision = pdfDocumentTranslationUsesUnifiedVision();
  const visualFallbackCount = scopedPdfDocumentTranslationBlocks().filter(
    (block) => !pdfReviewConfirmed(block) && Boolean(block.visualFallbackMessage) && !block.formulaReviewMessage && block.visualFallbackMessage !== '纯文本模式下公式保持原样',
  ).length;
  const formulaReviewCount = scopedPdfDocumentTranslationBlocks().filter(
    (block) => !pdfReviewConfirmed(block) && Boolean(block.formulaReviewMessage),
  ).length;
  const scopeEnabled = (
    hasPreparedBlocks || pdfDocumentTranslationUnreadablePageNumbers.length > 0
  ) && pdfDocumentTranslationPhase !== 'preparing' && !pdfDocumentTranslationOcrRunning;
  const currentRangePage = pdfDocumentTranslationRangeMode === 'current'
    ? pdfDocumentTranslationRangePages[0] ?? visiblePageAnchor().pageNumber
    : visiblePageAnchor().pageNumber;
  documentTranslationPanel.dataset.phase = pdfDocumentTranslationPhase === 'error'
    ? 'error'
    : failed && !['running','preparing'].includes(pdfDocumentTranslationPhase)
      ? 'warning'
      : pdfDocumentTranslationPhase;
  documentTranslationPanel.style.setProperty(
    '--pdf-document-translation-progress',
    `${progressPercent}%`,
  );
  documentTranslationProgress.hidden = !hasPreparedBlocks || ['ready', 'complete'].includes(pdfDocumentTranslationPhase);
  documentTranslationProgress.setAttribute('aria-valuenow', String(progressPercent));
  documentTranslationProgress.setAttribute(
    'aria-valuetext',
    total ? `已翻译 ${translated}/${total} 段` : '尚未识别正文',
  );
  documentTranslationRangeCurrent.textContent = `当前页（第 ${currentRangePage} 页）`;
  documentTranslationRange.disabled = !scopeEnabled;
  documentTranslationCustomRange.hidden = documentTranslationRange.value !== 'custom';
  documentTranslationCustomPages.disabled = !scopeEnabled;
  documentTranslationCustomRange.querySelector<HTMLButtonElement>('button')!.disabled = !scopeEnabled;
  const hasReferences = pdfDocumentTranslationBlocksState.some(
    (block) => block.section === 'references',
  );
  const hasAppendix = pdfDocumentTranslationBlocksState.some(
    (block) => block.section === 'appendix',
  );
  documentTranslationSkipReferences.disabled = !scopeEnabled || !hasReferences;
  documentTranslationSkipAppendix.disabled = !scopeEnabled || !hasAppendix;
  documentTranslationRangeFeedback.textContent = pdfDocumentTranslationRangeError ??
    pdfDocumentTranslationScopeFeedback();
  documentTranslationRangeFeedback.dataset.tone = pdfDocumentTranslationRangeError
    ? 'error'
    : 'info';
  const settingsScopeLabel = pdfDocumentTranslationRangeMode === 'all'
    ? '整篇文档'
    : pdfDocumentTranslationRangeMode === 'current'
      ? `第 ${pdfDocumentTranslationRangePages[0] ?? currentRangePage} 页`
      : `${pdfDocumentTranslationRangeSummary || '指定页码'} 页`;
  documentTranslationSettingsSummary.textContent = `${settingsScopeLabel} · ${
    pdfDocumentTranslationMultimodalEnabled
      ? usesUnifiedVision
        ? '统一多模态'
        : '按内容选择接口'
      : '仅文字接口'
  }`;
  documentTranslationMultimodal.dataset.mode = pdfDocumentTranslationMultimodalEnabled
    ? 'smart'
    : 'text';
  documentTranslationMultimodalToggle.checked = pdfDocumentTranslationMultimodalEnabled;
  documentTranslationMultimodalToggle.disabled = pdfDocumentTranslationPhase === 'preparing' ||
    pdfDocumentTranslationOcrRunning ||
    pdfDocumentTranslationPhase === 'running' ||
    translated > 0;
  documentTranslationMultimodalStatus.textContent = pdfDocumentTranslationMultimodalEnabled
    ? usesUnifiedVision
      ? `文档检测到 ${documentFormulaBlocks.length} 个含公式段落；点击开始后，当前范围 ${requestableBlocksInScope} 段统一使用视觉模型，预计 ${visualRequestsInScope} 次视觉请求${referencePreservationNote}`
      : unreadablePagesInScope.length
        ? `点击开始后识别 ${unreadablePagesInScope.length} 个扫描页；若发现公式，当前范围全部段落改用视觉模型`
        : visualObjectsInScope.length
          ? `普通正文使用文字接口；${figureObjectsInScope.length ? `${figureObjectsInScope.length} 个图表` : ''}${figureObjectsInScope.length && tableObjectsInScope.length ? '、' : ''}${tableObjectsInScope.length ? `${tableObjectsInScope.length} 个表格` : ''}将整块使用视觉模型，预计 ${visualObjectsInScope.length} 次视觉请求${referencePreservationNote}`
          : `文档未检测到公式、图表或表格对象；普通正文使用文字接口${referencePreservationNote}`
    : `${formulaBlocksInScope.length ? '不会发送公式或正文图像；独立公式原样保留；' : ''}${visualObjectsInScope.length ? '图表与表格不会发送图像，只保留合并后的文字结构；' : ''}${unreadablePagesInScope.length ? `${unreadablePagesInScope.length} 个扫描页不会发送；` : ''}其他正文只使用文字接口${referencePreservationNote}`;
  documentTranslationMultimodalStatus.title = documentTranslationMultimodalStatus.textContent;
  documentTranslationMultimodalStatus.textContent = pdfDocumentTranslationMultimodalEnabled
    ? usesUnifiedVision ? `当前范围使用视觉模型 · 预计 ${visualRequestsInScope} 次请求` : unreadablePagesInScope.length ? '扫描页将先识别文字，再翻译' : visualObjectsInScope.length ? '正文用文字接口，图表用视觉模型' : '当前正文使用文字接口'
    : formulaBlocksInScope.length ? '正文用文字接口；公式保留原文' : '使用文字接口';
  const defaultStatus = pdfDocumentTranslationPhase === 'idle'
    ? '尚未读取正文'
    : pdfDocumentTranslationPhase === 'preparing'
      ? '正在本地读取文字层…'
      : pdfDocumentTranslationPhase === 'ready'
        ? `已识别 ${total} 段，等待确认`
        : pdfDocumentTranslationPhase === 'running'
          ? `全文翻译中 · ${translated}/${total}`
          : pdfDocumentTranslationPhase === 'paused'
            ? `已暂停 · ${translated}/${total}`
            : pdfDocumentTranslationPhase === 'stopped'
              ? `已停止 · ${translated}/${total}`
              : pdfDocumentTranslationPhase === 'complete'
                ? failed
                  ? `已完成 ${translated}/${total} · ${failed} 段待重试`
                  : `已完成 ${translated}/${total}`
                : `翻译中断 · ${translated}/${total}`;
  const saveState=pdfDocumentTranslationSavesInFlight||pdfDocumentTranslationRetentionPending?'saving'
    :pdfDocumentTranslationRetentionError||pdfDocumentTranslationRetentionWriteDirty||pdfDocumentTranslationSessionWriteDirty&&!pdfDocumentTranslationRetainedLocally?'error'
    :pdfDocumentTranslationRetainedLocally?'retained':'session';
  documentTranslationStatus.dataset.saveState=saveState;
  const saveLabel=saveState==='saving'?'正在保存':saveState==='error'
    ?pdfDocumentTranslationRetentionError||pdfDocumentTranslationRetentionWriteDirty?'本机保存失败':'最新进度未保存'
    :saveState==='retained'?'已保存到本机':'仅当前会话';
  documentTranslationStatus.textContent = (pdfDocumentTranslationOcrRunning
    ? `正在识别扫描页 · ${pdfDocumentTranslationOcrProgress.completed}/${pdfDocumentTranslationOcrProgress.total}`
    : pdfDocumentTranslationMessage ?? defaultStatus) +
    (formulaReviewCount ? ` · ${formulaReviewCount} 段译文待核对` : '') +
    (visualFallbackCount ? ` · ${visualFallbackCount} 段保留原文` : '') +
    (translated && pdfDocumentTranslationPhase!=='running' ? ` · ${saveLabel}` : '');
  const progress = pdfDocumentProgress(pdfDocumentTranslationBlocksState);
  documentTranslationStatus.title = `已处理 ${progress.processed}/${progress.total} 段，其中 ${progress.translated} 段译文、${progress.preserved} 段参考文献保留原文；${progress.review} 段待核对，${progress.confirmed} 段已人工核对。`;
  for (const button of documentTranslationPages.querySelectorAll<HTMLButtonElement>('[data-review-retry]')) {
    button.disabled = ['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning;
  }
  const canStartVisionOnly = pdfDocumentTranslationMultimodalEnabled &&
    !pdfDocumentTranslationMultimodalAuthorized &&
    unreadablePagesInScope.length > 0;
  documentTranslationPrimary.disabled = pdfDocumentTranslationPhase === 'preparing' ||
    (Boolean(pdfDocumentTranslationRangeError) && pdfDocumentTranslationPhase !== 'running') ||
    pdfDocumentTranslationOcrRunning || (total === 0 && !canStartVisionOnly);
  documentTranslationPrimary.hidden = pdfDocumentTranslationOcrRunning || pdfDocumentTranslationPhase === 'preparing' ||
    (pdfDocumentTranslationPhase === 'complete' && failed === 0);
  documentTranslationPrimary.textContent = pdfDocumentTranslationOcrRunning ? '正在识别…' : pdfDocumentTranslationPhase === 'running'
    ? '暂停'
    : pdfDocumentTranslationPhase === 'paused'
      ? '继续'
      : pdfDocumentTranslationPhase === 'complete' && failed > 0
        ? `重试 ${failed} 段`
        : pdfDocumentTranslationPhase === 'error'
          ? '继续'
          : canStartVisionOnly && total === 0
            ? '开始识别并翻译'
            : translated > 0 && pending > 0
            ? '继续翻译'
            : usesUnifiedVision
              ? '开始多模态全文翻译'
              : pdfDocumentTranslationMultimodalEnabled && (
                  unreadablePagesInScope.length || visualObjectsInScope.length
                )
                ? '开始智能翻译'
              : '开始翻译';
  documentTranslationStop.hidden = !pdfDocumentTranslationBlocksState.some(block=>block.retranslation)&&!pdfDocumentTranslationOcrRunning && ![
    'running',
    'paused',
  ].includes(pdfDocumentTranslationPhase);
  documentTranslationStop.textContent = pdfDocumentTranslationOcrRunning ? '停止识别' : '停止';
  documentTranslationClear.hidden = !total || (
    translated === 0 && failed === 0 && pdfDocumentTranslationPhase === 'ready'
  ) || pdfDocumentTranslationPhase === 'preparing';
  documentTranslationClear.textContent = '重新翻译';
  documentTranslationClear.title = '保留人工修正；其他段落的新结果通过校验并保存后替换旧稿';
  documentTranslationDownloadArchive.hidden = pdfDocumentTranslationArchivedBlocks.length === 0;
  const canExport=pdfDocumentTranslationBlocksState.some(block=>block.included&&(block.status==='done'||block.retranslation)&&Boolean(block.translatedText?.trim()));
  documentTranslationExportActions.hidden = !canExport && pdfDocumentTranslationArchivedBlocks.length === 0;
  documentTranslationSettingsSeparator.hidden = documentTranslationShowSettings.hidden ||
    (documentTranslationExportActions.hidden && documentTranslationClear.hidden);
  documentTranslationRestartSeparator.hidden = !canExport || documentTranslationClear.hidden;
  documentTranslationCopyMenu.hidden = !canExport && !pdfDocumentTranslationArchivedBlocks.length && documentTranslationClear.hidden && documentTranslationShowSettings.hidden;
  if (documentTranslationCopyMenu.hidden) documentTranslationCopyMenu.open = false;
  for (const button of [
    documentTranslationCopyTranslation,
    documentTranslationCopyBilingual,
    documentTranslationDownloadTranslation,
    documentTranslationDownloadBilingual,
    documentTranslationDownloadHtml,
    documentTranslationPrintLayout,
  ]) {
    button.hidden = !canExport;
    button.disabled = pdfDocumentTranslationCopyPending;
  }
  documentTranslationExportActions.querySelectorAll<HTMLElement>('span[role="separator"]').forEach(separator => {separator.hidden = !canExport;});
  documentTranslationRetention.hidden = !pdfDocumentTranslationSessionContext ||
    ['idle', 'preparing'].includes(pdfDocumentTranslationPhase);
  documentTranslationRetention.dataset.tone = pdfDocumentTranslationRetentionError
    ? 'error'
    : 'info';
  documentTranslationRetentionToggle.checked = pdfDocumentTranslationRetainedLocally;
  documentTranslationRetentionToggle.disabled = pdfDocumentTranslationRetentionPending ||
    !pdfDocumentTranslationSessionContext;
  documentTranslationRetentionStatus.textContent = pdfDocumentTranslationRetentionMessage ?? (
    pdfDocumentTranslationRetainedLocally
      ? '只保存译文和匿名段落标识；打开同一 PDF 自动恢复'
      : '默认只保留在当前 Edge 会话'
  );
  documentTranslationOcr.hidden = !pdfDocumentTranslationOcrRunning &&
    unreadablePagesInScope.length === 0;
  documentTranslationOcr.dataset.tone = pdfDocumentTranslationOcrError ? 'error' : 'info';
  documentTranslationOcrAction.disabled = pdfDocumentTranslationPhase === 'preparing' ||
    (pdfDocumentTranslationPhase === 'running' && !pdfDocumentTranslationOcrRunning);
  documentTranslationOcrAction.textContent = pdfDocumentTranslationOcrRunning
    ? '停止识别'
    : `识别 ${unreadablePagesInScope.length} 页`;
  documentTranslationOcrStatus.textContent = pdfDocumentTranslationOcrRunning
    ? `正在逐页识别 · ${pdfDocumentTranslationOcrProgress.completed}/${pdfDocumentTranslationOcrProgress.total}`
    : pdfDocumentTranslationOcrMessage ??
      `${unreadablePagesInScope.length} 页没有文字层；智能多模态开启时将在开始后自动识别`;
  translateDocument.setAttribute('aria-expanded', String(!documentTranslationPanel.hidden));
  translateDocument.title = total
    ? `PDF 全文翻译 · ${translated}/${total}${failed ? ` · ${failed} 段待重试` : ''}`
    : '翻译整篇 PDF';
  const localLayoutNotes = [
    pdfDocumentTranslationMultiColumnPages
      ? `已按阅读顺序整理 ${pdfDocumentTranslationMultiColumnPages} 页多栏正文`
      : '',
    pdfDocumentTranslationRemovedMarginLines
      ? `已跳过 ${pdfDocumentTranslationRemovedMarginLines} 行重复页眉页脚`
      : '',
  ].filter(Boolean).join('；');
  const retentionNote = pdfDocumentTranslationRetainedLocally
    ? '已完成译文会保留在本机；不会保存原文、PDF 文件或页面图像。'
    : '已完成译文默认只保留在当前 Edge 会话中。';
  const visualFallbackNote = (visualFallbackCount
    ? ` ${visualFallbackCount} 段暂保留原文，具体原因见核对清单。`
    : '') + (formulaReviewCount
      ? ` ${formulaReviewCount} 段有内容待核对，已保留返回译文，可展开原文截图对照。` : '');
  documentTranslationProcessingDetails.textContent = pdfDocumentTranslationUnreadablePages
    ? `预览与范围调整零请求；点击开始即确认当前任务的正文和多模态处理。检测到公式后，当前范围全部可翻译段落统一使用视觉模型。${referenceDetail}${retentionNote}仍有 ${pdfDocumentTranslationUnreadablePages} 页没有可用文字层。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 原始 PDF 始终保留。`
    : usesUnifiedVision
      ? `文档含公式，当前范围全部可翻译段落统一使用视觉模型，以保持术语、语气和公式处理一致。${referenceDetail}${retentionNote}原始 PDF、公式和图表始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 译文按页排列，点击可返回原文。`
      : visualObjectsInScope.length && pdfDocumentTranslationMultimodalEnabled
        ? `普通正文使用文字接口；图表与表格按完整对象各发送一次图像，避免把刻度、图例或单元格拆成零散译文。${referenceDetail}${retentionNote}原始 PDF 始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 点击对象译文可返回并高亮整块原文。`
        : `文档未检测到需要整块视觉处理的公式、图表或表格，普通正文使用文字接口。${referenceDetail}${retentionNote}原始 PDF、公式和图表始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 译文按页排列，点击可返回原文。`;
  documentTranslationNote.textContent = '预览在本地完成；开始后发送所选内容及必要的相邻页续段。';
  syncPdfDocumentTranslationCurrentPage();
}

function setPdfDocumentTranslationCopyFeedback(message: string, error = false): void {
  if (pdfDocumentTranslationCopyFeedbackTimer !== undefined) {
    window.clearTimeout(pdfDocumentTranslationCopyFeedbackTimer);
  }
  documentTranslationCopyFeedback.textContent = message;
  documentTranslationCopyFeedback.dataset.tone = error ? 'error' : 'success';
  pdfDocumentTranslationCopyFeedbackTimer = window.setTimeout(() => {
    documentTranslationCopyFeedback.textContent = '';
    delete documentTranslationCopyFeedback.dataset.tone;
    pdfDocumentTranslationCopyFeedbackTimer = undefined;
  }, 2_800);
}

function pdfDocumentTranslationExportNotice(block: PdfDocumentTranslationRuntimeBlock): string {
  const proseReview = /正文|漏译|目标语言/u.test(block.formulaReviewMessage ?? '');
  const notice = block.formulaReviewMessage
    ? `${block.formulaReviewDraft ? '待核对译文（非最终结果）' : proseReview ? '译文待核对' : '公式待核对'}：${block.formulaReviewMessage}。已保留返回内容，请对照原 PDF 第 ${block.pageNumber} 页核对。`
    : block.visualFallbackMessage ? `本段保留原文：${block.visualFallbackMessage}。` : '';
  const review=notice && pdfReviewConfirmed(block) ? `已人工核对。原警告：${block.formulaReviewMessage ?? block.visualFallbackMessage}。` : notice;
  return [block.retranslation?'重译尚未完成，以下保留上次译文。':'',review].filter(Boolean).join('\n\n');
}

function pdfDocumentTranslationExportText(block: PdfDocumentTranslationRuntimeBlock): string {
  return [pdfDocumentTranslationExportNotice(block), block.formulaDocument
    ? formulaDocumentText(block.formulaDocument) : block.translatedText ?? ''].filter(Boolean).join('\n\n');
}

function pdfDisplayHeadingLevel(block: PdfDocumentTranslationRuntimeBlock): 1 | 2 | 3 | undefined {
  return block.paperRole || block.formulaReviewMessage || block.visualFallbackMessage || block.referencePreserved
    ? undefined : block.savedHeadingLevel??pdfDocumentTranslationHeadingLevel(block);
}

function pdfDocumentTranslationExportResult(
  pageImages: readonly DocumentTranslationExportPageImage[] = [],
  visualImages: ReadonlyMap<string, { dataUrl: string; alt: string }> = new Map(),
) {
  return buildDocumentTranslationExport(
    pdfDocumentTranslationBlocksState.flatMap((block) => block.included
      ? [{
          sourceText: block.text,
          headingLevel: pdfDisplayHeadingLevel(block),
          paperRole: block.paperRole,
          ...((block.status === 'done'||block.retranslation) && block.translatedText
            ? { translatedText: pdfDocumentTranslationExportText(block) }
            : {}),
          ...(block.referencePreserved ? { sourceOnly: true } : {}),
          ...(visualImages.get(block.id)
            ? {
                sourceImageDataUrl: visualImages.get(block.id)!.dataUrl,
                sourceImageAlt: visualImages.get(block.id)!.alt,
              }
            : {}),
          pageNumber: block.pageNumber,
        }]
      : []),
    {
      unavailablePageCount: pdfDocumentTranslationUnreadablePagesInScope().length,
      pageImages,
    },
  );
}

function syncCachedReadingUi():void{
  const cached=cachedReadingContext;if(!cached)return;
  documentTranslationPanel.dataset.phase='complete';
  searchScope.value='translation';searchScope.disabled=true;
  documentTranslationName.textContent=cached.name;
  documentTranslationPanel.querySelector('.pdf-document-translation-title strong')!.textContent='译文阅读';
  documentTranslationViewReading.setAttribute('aria-pressed','true');documentTranslationViewCompare.hidden=true;
  documentTranslationClose.textContent='文档库';documentTranslationClose.title='返回文档库';documentTranslationClose.ariaLabel='返回文档库';
  documentTranslationStatus.textContent=pdfDocumentTranslationRetentionError?'最新修改尚未保存到本机':`已保存译文 · ${cached.record.blocks.length} 段${cached.record.blocks.some(block=>'retranslation' in block&&block.retranslation)?' · 部分段落保留旧稿，选择原 PDF 后可继续重译':''}`;
  documentTranslationCopyMenu.hidden=false;
  const allowed=new Set(['pdf-library-search','pdf-library-back','pdf-document-translation-copy-translation','pdf-document-translation-download-translation']);
  if(cached.kind==='pdf'){allowed.add('pdf-library-source');if(pdfDocumentTranslationBlocksState.some(block=>block.revisions?.length))allowed.add('pdf-document-history')}
  for(const button of documentTranslationCopyMenu.querySelectorAll<HTMLButtonElement>('button')){button.hidden=!allowed.has(button.id);if(allowed.has(button.id))button.disabled=false}
  documentTranslationPages.querySelectorAll<HTMLButtonElement>('.pdf-paragraph-edit-action').forEach(button=>{button.hidden=cached.kind!=='pdf';button.disabled=false});
}

async function persistCachedReading():Promise<boolean>{
  const cached=cachedReadingContext;if(!cached||cached.kind!=='pdf')return false;
  const context=currentPdfDocumentTranslationSessionContext()!;
  const values=pdfDocumentTranslationSessionUpdate(context,pdfDocumentTranslationBlocksState,true).blocks??[];
  const original=new Map(cached.record.blocks.map(block=>[block.signature,block]));
  const blocks:PdfDocumentTranslationSessionBlock[]=values.map(value=>{
    const block:PdfDocumentTranslationSessionBlock={...value};
    const old=original.get(block.signature);if(!old?.pageNumber)delete block.pageNumber;
    return block;
  });
  try{
    const result=await saveRetainedPdfDocumentTranslationSession({descriptor:context.descriptor,documentSignatures:cached.record.documentSignatures,
      ...(cached.record.scopeSignatures?{scopeSignatures:cached.record.scopeSignatures}:{}),...(cached.record.preservedSignatures?{preservedSignatures:cached.record.preservedSignatures}:{}),
      ...(cached.record.sourceFingerprint?{sourceFingerprint:cached.record.sourceFingerprint}:{}),...(cached.record.archivedBlocks?{archivedBlocks:cached.record.archivedBlocks}:{}),
      ...(cached.record.plan?{plan:cached.record.plan}:{}),activity:cached.record.activity,blocks,replaceBlocks:true},cached.record.behaviorKey);
    if(cachedReadingContext!==cached)return false;
    cached.record={...result,behaviorKey:cached.record.behaviorKey};pdfDocumentTranslationRetentionError=false;
    for(const block of pdfDocumentTranslationBlocksState){const saved=result.blocks.find(item=>item.signature===block.sessionSignature);if(saved?.revisions)block.revisions=saved.revisions}
    syncCachedReadingUi();return true;
  }catch{pdfDocumentTranslationRetentionError=true;syncCachedReadingUi();return false}
}

async function openCachedLibraryReading(id:string):Promise<void>{
  try{
    const entries=await listRetainedDocuments(),entry=entries.find(entry=>entry.id===id);
    if(!entry)throw new Error('这份译文已被移除，请返回文档库刷新。');
    if(entry.kind==='pdf'){
      const record=(await retainedPdfRecordsForBackup()).find(record=>retainedDocumentId('pdf',record)===id);if(!record)throw new Error('译文记录不可用。');
      cachedReadingContext={id,name:entry.name,kind:'pdf',record};currentPdfContentFingerprint=record.sourceFingerprint;
    }else{
      const record=(await retainedWebRecordsForBackup()).find(record=>retainedDocumentId('web',record)===id);if(!record)throw new Error('译文记录不可用。');
      cachedReadingContext={id,name:entry.name,kind:'web',record};
    }
    currentReadingIdentity=`library:${id}`;
    const identity=currentPdfContentFingerprint?`pdf-content:${currentPdfContentFingerprint}`:currentReadingIdentity;
    const [shared,legacy]=await Promise.all([getPdfReadingState(identity),getPdfReadingState(currentReadingIdentity)]);
    pdfTranslationReadingAnchor=(shared&&(!legacy||shared.updatedAt>=legacy.updatedAt)?shared:legacy)?.translation;
    document.documentElement.dataset.libraryReading='true';documentName.textContent=entry.name;document.title=`${entry.name} - Pi Translator`;
    emptyState.hidden=true;documentTranslationPanel.hidden=false;documentTranslationSettings.open=false;
    const records=cachedReadingContext.record;
    pdfDocumentTranslationBlocksState=[...records.blocks].sort((a,b)=>records.documentSignatures.indexOf(a.signature)-records.documentSignatures.indexOf(b.signature)).map((value,index)=>{
      const saved=value as PdfDocumentTranslationSessionBlock;
      return {...saved,id:`saved-${index}`,sessionSignature:saved.signature,pageNumber:saved.pageNumber??1,...(!saved.pageNumber?{omitReadingMetadata:true}:{}),blockIndex:index,text:'',section:'body',included:true,status:'done',translatedText:saved.formulaDocument?formulaDocumentText(saved.formulaDocument):saved.translatedText,
        ...(saved.headingLevel?{savedHeadingLevel:saved.headingLevel}:{})};
    });
    pdfDocumentTranslationPhase='complete';pdfDocumentTranslationRetainedLocally=true;pdfDocumentTranslationSessionContext=currentPdfDocumentTranslationSessionContext();
    pdfDocumentTranslationViewMode='reading';syncPdfDocumentTranslationCurrentPage();
    for(const block of pdfDocumentTranslationBlocksState)renderPdfDocumentTranslationBlock(block);
    for(const button of documentTranslationPages.querySelectorAll<HTMLButtonElement>('.pdf-document-translation-page > header button'))button.disabled=true;
    const unknownPages=new Set(pdfDocumentTranslationBlocksState.filter(block=>block.omitReadingMetadata).map(block=>block.pageNumber));
    for(const page of documentTranslationPages.querySelectorAll<HTMLElement>('.pdf-document-translation-page')){
      const header=page.querySelector<HTMLElement>(':scope > header');
      if(header&&unknownPages.has(Number(page.dataset.pageNumber)))header.hidden=true;
    }
    const signature=new URL(location.href).searchParams.get('block'),requested=pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===signature);
    if(requested)pdfTranslationReadingAnchor={mode:'reading',signature:requested.sessionSignature,pageNumber:requested.pageNumber,offsetRatio:0};
    else if(pdfTranslationReadingAnchor)pdfTranslationReadingAnchor={...pdfTranslationReadingAnchor,mode:'reading'};
    syncCachedReadingUi();restorePdfTranslationReadingAnchor();scheduleReadingStateSave();
    const query=new URL(location.href).searchParams.get('query');
    if(query){openPdfSearch();searchQuery.value=query;applyPdfSearchQuery()}
    const url=new URL(location.href);url.searchParams.delete('query');url.searchParams.delete('block');history.replaceState(null,'',url);
  }catch(error){showNotice(error instanceof Error?error.message:'无法打开保留译文。',{tone:'error'})}
}

async function capturePdfDocumentTranslationExportPageImages(
  mode: 'html' | 'layout' = 'html',
): Promise<
  PdfLayoutTranslationPageImage[]
> {
  const pdf = pdfDocument;
  if (!pdf) return [];
  const epoch = documentEpoch;
  const pages = [...new Set(pdfDocumentTranslationBlocksState.flatMap((block) => (
    block.included && block.status === 'done' ? pdfDocumentTranslationSourceRegions(block).map((region) => region.pageNumber) : []
  )))].sort((left, right) => left - right);
  const images: PdfLayoutTranslationPageImage[] = [];
  for (const pageNumber of pages) {
    if (documentEpoch !== epoch || pdfDocument !== pdf) break;
    try {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(mode === 'layout' ? 2.8 : 1.8, Math.max(
        .75,
        (mode === 'layout' ? 2_200 : 1_400) /
          Math.max(baseViewport.width, baseViewport.height, 1),
      ));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) continue;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      if (documentEpoch !== epoch || pdfDocument !== pdf) break;
      images.push({
        pageNumber,
        dataUrl: canvas.toDataURL('image/jpeg', mode === 'layout' ? .9 : .78),
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    } catch {
      // A page-image failure must not prevent exporting the completed text.
    }
  }
  return images;
}

async function capturePdfDocumentTranslationMarkdownVisualImages(): Promise<
  Map<string, { dataUrl: string; alt: string }>
> {
  const pdf = pdfDocument;
  if (!pdf) return new Map();
  const epoch = documentEpoch;
  const images = new Map<string, { dataUrl: string; alt: string }>();
  const visualBlocks = pdfDocumentTranslationBlocksState.filter((block) => (
    block.included && block.status === 'done' && Boolean(block.translatedText?.trim()) &&
    (block.kind === 'figure' || block.kind === 'table' || Boolean(block.formulaReviewMessage)) &&
    pdfDocumentTranslationSourceRegions(block).length > 0
  ));
  for (const block of visualBlocks) {
    if (documentEpoch !== epoch || pdfDocument !== pdf) break;
    try {
      const capture = await capturePdfDocumentTranslationVisualBlock(pdf, block, {
        maxEdge: 1_400,
        maxBytes: 900 * 1_024,
      });
      if (documentEpoch !== epoch || pdfDocument !== pdf) break;
      images.set(block.id, {
        dataUrl: capture.imageDataUrl,
        alt: `原 PDF 第 ${block.pageNumber} 页${block.formulaReviewMessage ? '含公式原文' : block.kind === 'table' ? '表格' : '图表'}截图`,
      });
    } catch {
      // A local crop failure must not prevent downloading the completed text.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  return images;
}

type PdfDocumentTranslationExportAction =
  | 'copy-translation'
  | 'copy-bilingual'
  | 'layout-pdf'
  | DocumentTranslationExportFormat;

function openPdfLayoutTranslationPreview(): Window | undefined {
  const preview = window.open('', '_blank');
  if (!preview) return undefined;
  preview.document.open();
  preview.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>正在生成原页对照翻译 PDF</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f4f5f8;color:#364152;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:420px;padding:28px;text-align:center}strong{display:block;margin-bottom:8px;color:#302d85;font-size:18px}</style></head><body><main><strong>正在本地生成原页对照翻译页…</strong><span>每张原页会完整保留；不会产生新的翻译或 OCR 请求。</span></main></body></html>`);
  preview.document.close();
  return preview;
}

function showPdfLayoutTranslationPreviewError(
  preview: Window,
  message: string,
): void {
  if (preview.closed) return;
  preview.document.open();
  preview.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>原页对照翻译 PDF 生成失败</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f8f5f5;color:#5f2730;font:14px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:520px;padding:30px}strong{display:block;margin-bottom:8px;font-size:18px}</style></head><body><main><strong>原页对照翻译 PDF 生成失败</strong><span>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span></main></body></html>`);
  preview.document.close();
}

function pdfLayoutTranslationBlocks(): PdfLayoutTranslationBlock[] {
  return pdfDocumentTranslationBlocksState.flatMap((block) => (
    block.included && (block.status === 'done'||block.retranslation) && block.translatedText
      ? [{
          id: block.id,
          pageNumber: block.pageNumber,
          translatedText: pdfDocumentTranslationExportText(block),
          headingLevel: pdfDisplayHeadingLevel(block),
          paperRole: block.paperRole,
          ...(block.formulaDocument ? { formulaDocument: block.formulaDocument } : {}),
          ...(block.formulaReviewDraft ? { formulaReviewDraft: true as const } : {}),
          ...(block.sourceAnchor ? { sourceAnchor: block.sourceAnchor } : {}),
          role: block.kind === 'code' || block.kind === 'table' || block.kind === 'figure' ||
            block.kind === 'footnote'
            ? block.kind
            : pdfDocumentTranslationBlockContainsFormula(block)
              ? 'formula' as const
              : 'text' as const,
        }]
      : []
  ));
}

async function renderPdfDocumentTranslationExportHtml(html: string): Promise<string> {
  const exportBlocks = pdfDocumentTranslationBlocksState.filter((block) => (
    block.included && (block.status === 'done'||block.retranslation) && Boolean(block.text.trim()) &&
    Boolean(block.translatedText?.trim())
  ));
  const exportDocument = new DOMParser().parseFromString(html, 'text/html');
  const pairs = [...exportDocument.querySelectorAll<HTMLElement>('.page-translations > .pair')];
  if (pairs.length !== exportBlocks.length) return html;
  const targets: Array<{ container: HTMLElement; text: string; renderLatex: boolean }> = [];
  const formulaTargets: Promise<void>[] = [];
  pairs.forEach((pair, index) => {
    const block = exportBlocks[index]!;
    const renderLatex = block.kind !== 'code';
    const sourceShell = pair.querySelector<HTMLElement>(':scope > .source');
    const source = sourceShell?.querySelector<HTMLElement>('.document-section-title,.document-paper-title') ?? sourceShell;
    if (source) targets.push({ container: source, text: block.text, renderLatex });
    const translationShell = pair.querySelector<HTMLElement>(':scope > .translation');
    const translation = translationShell?.querySelector<HTMLElement>('.document-section-title,.document-paper-title') ?? translationShell;
    if (translation && block.translatedText) {
      if (block.kind === 'table' && !block.formulaDocument) {
        formulaTargets.push(renderPdfDocumentTranslationTable(translation, pdfDocumentTranslationExportText(block), true)
          .then(async (rendered) => { if (!rendered) await renderTranslationContents([{container:translation,text:pdfDocumentTranslationExportText(block),renderLatex}]); }));
      } else if (block.formulaDocument) {
        const notice = exportDocument.createElement('p');
        notice.textContent = pdfDocumentTranslationExportNotice(block);
        const content = exportDocument.createElement('div');
        content.style.whiteSpace = 'pre-wrap';
        translation.replaceChildren(...(notice.textContent ? [notice] : []), content);
        formulaTargets.push(renderFormulaDocument(content, block.formulaDocument, renderLatex));
      } else targets.push({ container: translation, text: pdfDocumentTranslationExportText(block),
        renderLatex: renderLatex && !block.formulaReviewDraft });
    }
  });
  await renderTranslationContents(targets);
  await Promise.all(formulaTargets);
  return `<!doctype html>\n${exportDocument.documentElement.outerHTML}`;
}

async function renderPdfLayoutTranslationFragments(
  blocks: readonly PdfLayoutTranslationBlock[],
): Promise<Map<string, Node[]>> {
  const host = document.createElement('div');
  host.hidden = true;
  document.body.append(host);
  const containers = blocks.map((block) => {
    const container = document.createElement('div');
    container.dataset.layoutBlockId = block.id;
    host.append(container);
    return { block, container };
  });
  try {
    await renderTranslationContents(containers.filter(({ block }) => !block.formulaDocument && block.role !== 'table').map(({ block, container }) => ({
      container,
      text: block.translatedText,
      renderLatex: block.role !== 'code' && !block.formulaReviewDraft,
    })));
    await Promise.all(containers.filter(({block}) => block.role === 'table' && !block.formulaDocument).map(async ({block,container}) => {
      if (!await renderPdfDocumentTranslationTable(container, block.translatedText, true)) {
        await renderTranslationContents([{container,text:block.translatedText,renderLatex:!block.formulaReviewDraft}]);
      }
    }));
    await Promise.all(containers.filter(({ block }) => block.formulaDocument).map(async ({ block, container }) => {
      const runtime = pdfDocumentTranslationBlocksState.find((entry) => entry.id === block.id);
      const notice = document.createElement('p');
      notice.textContent = runtime ? pdfDocumentTranslationExportNotice(runtime) : '';
      const content = document.createElement('div');
      content.style.whiteSpace = 'pre-wrap';
      container.replaceChildren(...(notice.textContent ? [notice] : []), content);
      await renderFormulaDocument(content, block.formulaDocument!, true);
    }));
    return new Map(containers.map(({ block, container }) => [
      block.id,
      [...container.childNodes].map((node) => node.cloneNode(true)),
    ]));
  } finally {
    host.remove();
  }
}

function hydratePdfLayoutTranslationFragments(
  preview: Window,
  fragments: ReadonlyMap<string, readonly Node[]>,
): void {
  for (const placeholder of preview.document.querySelectorAll<HTMLElement>(
    '[data-layout-block-id]',
  )) {
    const blockId = placeholder.dataset.layoutBlockId;
    const nodes = blockId ? fragments.get(blockId) : undefined;
    if (!nodes?.length) continue;
    const content = placeholder.querySelector<HTMLElement>('.pdf-layout-block-content');
    if (!content) continue;
    content.replaceChildren(...nodes.map((node) => preview.document.importNode(node, true)));
  }
}

function pdfLayoutElementOverflows(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1 ||
    element.scrollWidth > element.clientWidth + 1;
}

/** Split rendered prose at grapheme boundaries; formula registries and MathML remain indivisible. */
function splitPdfLayoutOverflowItem(item:HTMLElement,page:HTMLElement):HTMLElement|undefined{
  const content=item.querySelector<HTMLElement>('.pdf-layout-block-content');
  if(!content||item.hasAttribute('data-heading-level'))return undefined;
  const original=content.cloneNode(true),doc=item.ownerDocument;
  const boundaries:{node:Node;offset:number}[]=[];
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const visit=(parent:Node)=>{
    [...parent.childNodes].forEach((node,index)=>{
      if(node.nodeType===Node.TEXT_NODE){for(const part of segmenter.segment(node.textContent??''))boundaries.push({node,offset:part.index+part.segment.length})}
      else if(node.nodeType===Node.ELEMENT_NODE){
        if((node as Element).matches('.pi-math,math,[data-formula-id],.pdf-equation-row-group,svg,img,table,pre,code,br'))boundaries.push({node:parent,offset:index+1});
        else visit(node);
      }
    });
  };
  visit(original);
  const fragment=(end:number,tail=false)=>{
    const range=doc.createRange();range.selectNodeContents(original);
    const point=boundaries[end-1]!;if(tail)range.setStart(point.node,point.offset);else range.setEnd(point.node,point.offset);
    return range.cloneContents();
  };
  let low=1,high=boundaries.length-1,best=0;
  while(low<=high){const mid=Math.floor((low+high)/2);content.replaceChildren(fragment(mid));if(pdfLayoutElementOverflows(page))high=mid-1;else{best=mid;low=mid+1}}
  if(!best){content.replaceChildren(...original.childNodes);return undefined}
  content.replaceChildren(fragment(best));
  const remainder=item.cloneNode(true) as HTMLElement;
  remainder.querySelector('.pdf-layout-block-content')!.replaceChildren(fragment(best,true));
  return remainder;
}

function paginatePdfLayoutTranslationContinuations(preview: Window): void {
  const basePages = [...preview.document.querySelectorAll<HTMLElement>(
    '.pdf-layout-continuation:not([hidden])',
  )];
  for (const base of basePages) {
    const baseList = base.querySelector<HTMLElement>('[data-layout-runtime-overflow]');
    if (!baseList) continue;
    const items = [...baseList.children].map((item) => item.cloneNode(true) as HTMLElement);
    baseList.replaceChildren();
    let currentPage = base;
    let currentList = baseList;
    let sequence = 1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      currentList.append(item);
      if (!pdfLayoutElementOverflows(currentPage)) continue;
      if (currentList.children.length > 1) {
        const previousList = currentList;
        const titles: Element[] = [];
        for (let prior = item.previousElementSibling; prior?.hasAttribute('data-heading-level'); prior = prior.previousElementSibling) titles.unshift(prior);
        // Move a section lead with its following block when the pair fits a
        // fresh page. Never create an empty page or clip an oversized pair.
        if (titles.length === currentList.children.length - 1) titles.length = 0;
        item.remove();
        sequence += 1;
        const nextPage = base.cloneNode(true) as HTMLElement;
        nextPage.removeAttribute('hidden');
        nextPage.dataset.layoutContinuationSequence = String(sequence);
        nextPage.dataset.layoutTranslationSequence = String(sequence);
        const heading = nextPage.querySelector<HTMLElement>('header strong');
        if (heading) heading.textContent += ` · ${sequence}`;
        const nextList = nextPage.querySelector<HTMLElement>('[data-layout-runtime-overflow]');
        if (!nextList) continue;
        nextList.replaceChildren(...titles, item);
        currentPage.after(nextPage);
        if (titles.length && pdfLayoutElementOverflows(nextPage)) previousList.append(...titles);
        currentPage = nextPage;
        currentList = nextList;
      }
      // Keep a short list together; a list taller than a whole page must be
      // allowed to continue between items rather than getting clipped.
      if (pdfLayoutElementOverflows(currentPage) && item.matches('[data-layout-list]') && item.children.length > 1) {
        const fragments = [...item.children].map((child) => {
          const fragment = item.cloneNode(false) as HTMLElement;
          fragment.append(child);
          return fragment;
        });
        item.remove();
        items.splice(index, 1, ...fragments);
        index -= 1;
      }else if(pdfLayoutElementOverflows(currentPage)){
        // A list wrapper with one item still needs paragraph-level pagination.
        const article=item.matches('[data-layout-list]')?item.firstElementChild as HTMLElement:item;
        const remainder=article&&splitPdfLayoutOverflowItem(article,currentPage);
        if(remainder){
          const next=item.matches('[data-layout-list]')?item.cloneNode(false) as HTMLElement:remainder;
          if(next!==remainder)next.append(remainder);
          items.splice(index+1,0,next);
        }else{
          // An indivisible object or heading can exceed a very short original
          // page. Give only this translation page room; never shrink its text.
          const height=Math.ceil(currentPage.scrollHeight*.75+2),width=Math.ceil(currentPage.clientWidth*.75);
          const name=`pi-layout-tall-${base.dataset.layoutTranslationPage}-${sequence}`;
          currentPage.style.setProperty('--page-height',`${height}pt`);currentPage.style.page=name;
          const style=preview.document.createElement('style');style.textContent=`@page ${name}{size:${width}pt ${height}pt;margin:0}`;preview.document.head.append(style);
        }
      }
    }
  }
}

async function waitForPdfLayoutTranslationPreview(preview: Window): Promise<void> {
  const images = [...preview.document.images];
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  await preview.document.fonts?.ready;
  await new Promise<void>((resolve) => preview.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => preview.requestAnimationFrame(() => resolve()));
}

async function populateAndPrintPdfLayoutTranslationPreview(
  preview: Window,
  html: string,
  fragments: ReadonlyMap<string, readonly Node[]>,
): Promise<void> {
  if (preview.closed) throw new Error('原页对照翻译页已被关闭。');
  preview.document.open();
  preview.document.write(html);
  preview.document.close();
  hydratePdfLayoutTranslationFragments(preview, fragments);
  await waitForPdfLayoutTranslationPreview(preview);
  paginatePdfLayoutTranslationContinuations(preview);
  preview.document.body.dataset.piLayoutReady = 'true';
  preview.document.getElementById('pi-layout-print')?.addEventListener('click', () => {
    preview.document.documentElement.dataset.piPrintRequested = 'true';
    preview.print();
  });
  preview.opener = null;
  preview.focus();
}

async function handlePdfDocumentTranslationExport(
  action: PdfDocumentTranslationExportAction,
): Promise<void> {
  if(cachedReadingContext){
    const text=pdfDocumentTranslationBlocksState.map(block=>pdfDocumentTranslationExportText(block)).join('\n\n');
    if(action==='copy-translation')await navigator.clipboard.writeText(text);
    else if(action==='translation-markdown')triggerDocumentTranslationDownload({content:`# ${cachedReadingContext.name.replace(/[\r\n]/gu,' ')}\n\n仅导出已保存译文，不含原文和来源。\n\n${text}`,filename:`${cachedReadingContext.name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').slice(0,80)}.md`,mimeType:'text/markdown;charset=utf-8'});
    setPdfDocumentTranslationCopyFeedback(action==='copy-translation'?'译文已复制。':'译文已导出。');return;
  }
  if (pdfDocumentTranslationCopyPending) return;
  const layoutPreview = action === 'layout-pdf'
    ? openPdfLayoutTranslationPreview()
    : undefined;
  if (action === 'layout-pdf' && !layoutPreview) {
    setPdfDocumentTranslationCopyFeedback('无法打开原页对照翻译页，请允许此页面打开新窗口。', true);
    return;
  }
  let result = pdfDocumentTranslationExportResult();
  if (!result.blockCount) {
    layoutPreview?.close();
    return;
  }
  pdfDocumentTranslationCopyPending = true;
  syncPdfDocumentTranslationUi();
  try {
    if (action === 'layout-pdf') {
      if (!layoutPreview) throw new Error('原页对照翻译页未打开。');
      setPdfDocumentTranslationCopyFeedback('正在本地生成原页对照翻译页…');
      const blocks = pdfLayoutTranslationBlocks();
      const [pageImages, fragments] = await Promise.all([
        capturePdfDocumentTranslationExportPageImages('layout'),
        renderPdfLayoutTranslationFragments(blocks),
      ]);
      const layout = buildPdfLayoutTranslationExport(blocks, pageImages, {
        totalBlockCount: result.totalBlockCount,
        unavailablePageCount: result.unavailablePageCount,
      });
      await populateAndPrintPdfLayoutTranslationPreview(
        layoutPreview,
        layout.html,
        fragments,
      );
      documentTranslationCopyMenu.open = false;
      setPdfDocumentTranslationCopyFeedback(
        `已打开原页对照打印页 · ${layout.pageCount} 个原页 · ${layout.blockCount} 段译文`,
      );
      return;
    }
    if (action === 'printable-html') {
      setPdfDocumentTranslationCopyFeedback('正在本地生成带原页图的双语 HTML…');
      result = pdfDocumentTranslationExportResult(
        await capturePdfDocumentTranslationExportPageImages(),
      );
      result = {
        ...result,
        printableHtml: await renderPdfDocumentTranslationExportHtml(result.printableHtml),
      };
    }
    if (action === 'bilingual-markdown') {
      setPdfDocumentTranslationCopyFeedback('正在本地截取图表并生成双语 Markdown…');
      result = pdfDocumentTranslationExportResult(
        [],
        await capturePdfDocumentTranslationMarkdownVisualImages(),
      );
    }
    const pageLabel = result.pageCount ? ` · ${result.pageCount} 页` : '';
    const partialLabel = result.complete
      ? ''
      : ` · 部分结果 ${result.blockCount}/${result.totalBlockCount} 段${result.unavailablePageCount ? `，${result.unavailablePageCount} 页未识别` : ''}`;
    let message: string;
    if (action === 'copy-translation' || action === 'copy-bilingual') {
      await navigator.clipboard.writeText(action === 'copy-translation'
        ? result.translationText
        : result.bilingualMarkdown);
      message = action === 'copy-translation'
        ? `已复制 ${result.blockCount} 段译文${pageLabel}`
        : `已复制双语 Markdown · ${result.blockCount} 段${pageLabel}`;
    } else {
      const download = documentTranslationDownload(result, action, 'pdf');
      triggerDocumentTranslationDownload(download);
      message = action === 'translation-markdown'
        ? '已下载纯译文 Markdown'
        : action === 'bilingual-markdown'
          ? `已下载图文双语 Markdown${result.embeddedImageCount
            ? ` · ${result.embeddedImageCount} 张图表截图`
            : ' · 未检测到可嵌入图表'}`
          : '已下载带原页图的可打印 HTML';
      message += pageLabel;
    }
    documentTranslationCopyMenu.open = false;
    setPdfDocumentTranslationCopyFeedback(`${message}${partialLabel}`);
  } catch (error) {
    if (layoutPreview) {
      showPdfLayoutTranslationPreviewError(
        layoutPreview,
        error instanceof Error ? error.message : '未知错误。',
      );
    }
    setPdfDocumentTranslationCopyFeedback(
      error instanceof Error ? error.message : '导出失败，请重试。',
      true,
    );
  } finally {
    pdfDocumentTranslationCopyPending = false;
    syncPdfDocumentTranslationUi();
  }
}

function ensurePdfDocumentTranslationPage(pageNumber: number): HTMLElement {
  const existing = documentTranslationPages.querySelector<HTMLElement>(
    `.pdf-document-translation-page[data-page-number="${pageNumber}"]`,
  );
  if (existing) return existing;
  const section = document.createElement('section');
  section.className = 'pdf-document-translation-page';
  section.dataset.pageNumber = String(pageNumber);
  const header = document.createElement('header');
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.textContent = `第 ${pageNumber} 页`;
  jump.title = `回到 PDF 第 ${pageNumber} 页`;
  jump.addEventListener('click', () => {
    scrollToPageAnchor({ pageNumber, ratio: 0 });
    updatePageControl({ pageNumber, ratio: 0 });
  });
  const progress = document.createElement('small');
  progress.dataset.pageProgress = '';
  header.append(jump, progress);
  section.append(header);
  const next = [...documentTranslationPages.querySelectorAll<HTMLElement>(
    '.pdf-document-translation-page[data-page-number]',
  )].find((candidate) => Number(candidate.dataset.pageNumber) > pageNumber);
  documentTranslationPages.insertBefore(section, next ?? null);
  syncPdfDocumentTranslationCurrentPage();
  return section;
}

function updatePdfDocumentTranslationPageProgress(pageNumber: number): void {
  const section = documentTranslationPages.querySelector<HTMLElement>(
    `.pdf-document-translation-page[data-page-number="${pageNumber}"]`,
  );
  if (!section) return;
  const pageBlocks = pdfDocumentTranslationBlocksState.filter(
    (block) => block.included && block.pageNumber === pageNumber,
  );
  if (!pageBlocks.length) {
    section.remove();
    return;
  }
  const done = pageBlocks.filter((block) => block.status === 'done').length;
  const failed = pageBlocks.filter((block) => block.status === 'error').length;
  const progress = section.querySelector<HTMLElement>('[data-page-progress]');
  if (progress) progress.textContent = `${done}/${pageBlocks.length}${failed ? ` · ${failed} 待重试` : ''}`;
}

function pdfDocumentTranslationSourceLocation(
  block: PdfDocumentTranslationRuntimeBlock,
): PdfSourceLocation | undefined {
  return pdfDocumentTranslationSourceLocations(block)[0];
}

function pdfDocumentTranslationSourceLocations(
  block: PdfDocumentTranslationRuntimeBlock,
): PdfSourceLocation[] {
  return pdfDocumentTranslationSourceRegions(block).map((region) => ({
    documentId: currentDocumentSessionId,
    pageNumber: region.pageNumber,
    ...region.sourceAnchor,
  }));
}

function activatePdfDocumentTranslationSource(
  block: PdfDocumentTranslationRuntimeBlock,
): void {
  const references = pdfDocumentTranslationSourceLocations(block);
  const reference = references[0];
  if (!reference) return;
  if (pdfDocumentTranslationViewMode === 'reading') {
    setPdfDocumentTranslationViewMode('compare');
  }
  void navigateToPdfRegions(references).then(() => {
    updatePageControl({ pageNumber: block.pageNumber, ratio: reference.topRatio });
    syncPdfDocumentTranslationCurrentPage(block.pageNumber);
  });
}

interface PdfDocumentMarkdownTable {
  caption: string;
  headers: string[];
  rows: string[][];
  trailing: string;
}

function pdfDocumentMarkdownTable(value: string): PdfDocumentMarkdownTable | undefined {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n');
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex += 1) {
    const separator = lines[separatorIndex]!.trim();
    if (!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/u.test(separator)) continue;
    const splitRow = (line: string): string[] => {
      return splitMarkdownTableRow(line);
    };
    const headers = splitRow(lines[separatorIndex - 1]!);
    const separators = splitRow(separator);
    if (headers.length < 1 || separators.length !== headers.length) continue;
    const rows: string[][] = [];
    let cursor = separatorIndex + 1;
    while (cursor < lines.length) {
      const line = lines[cursor]!.trim();
      if (!line.includes('|')) break;
      const cells = splitRow(line);
      if (cells.length !== headers.length) break;
      rows.push(cells);
      cursor += 1;
    }
    if (!rows.length) continue;
    return {
      caption: lines.slice(0, separatorIndex - 1).join('\n').trim(),
      headers,
      rows,
      trailing: lines.slice(cursor).join('\n').trim(),
    };
  }
  return undefined;
}

async function renderPdfDocumentTranslationTable(
  container: HTMLElement,
  text: string,
  renderLatex = pdfDocumentTranslationSettings.autoRenderLatex,
): Promise<boolean> {
  const parsed = pdfDocumentMarkdownTable(text);
  if (!parsed) return false;
  container.replaceChildren();
  const renderTargets: Array<{ container: HTMLElement; text: string; renderLatex: boolean }> = [];
  if (parsed.caption) {
    const caption = document.createElement('div');
    caption.className = 'pdf-document-table-caption';
    container.append(caption);
    renderTargets.push({
      container: caption,
      text: parsed.caption,
      renderLatex,
    });
  }
  const scroll = document.createElement('div');
  scroll.className = 'pdf-document-table-scroll';
  const table = document.createElement('table');
  table.className = 'pdf-document-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const text of parsed.headers) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    headRow.append(cell);
    renderTargets.push({
      container: cell,
      text,
      renderLatex,
    });
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const row of parsed.rows) {
    const rowElement = document.createElement('tr');
    for (const text of row) {
      const cell = document.createElement('td');
      rowElement.append(cell);
      renderTargets.push({
        container: cell,
        text,
        renderLatex,
      });
    }
    body.append(rowElement);
  }
  table.append(head, body);
  scroll.append(table);
  container.append(scroll);
  if (parsed.trailing) {
    const trailing = document.createElement('div');
    trailing.className = 'pdf-document-table-trailing';
    container.append(trailing);
    renderTargets.push({
      container: trailing,
      text: parsed.trailing,
      renderLatex,
    });
  }
  await renderTranslationContents(renderTargets);
  return true;
}

async function retryPdfFormulaReview(block: PdfDocumentTranslationRuntimeBlock): Promise<void> {
  if (['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning ||
      !pdfDocumentTranslationMultimodalEnabled) return;
  // The explicit per-block retry authorizes this image request, not the queue.
  pdfDocumentTranslationMultimodalAuthorized = true;
  const revision = pdfDocumentTranslationRevision;
  const previous = { ...block };
  const previousPhase = pdfDocumentTranslationPhase;
  const previousTask = pdfDocumentTranslationTask;
  // Keep the old foreground queue stopped while awaiting its in-flight work.
  pdfDocumentTranslationPhase = 'preparing';
  pdfDocumentTranslationMessage = '正在重试本段；其他段落不会重新请求。';
  syncPdfDocumentTranslationUi();
  await sendPdfDocumentBackgroundControl('dispose');
  await previousTask?.catch(() => undefined);
  if (revision !== pdfDocumentTranslationRevision) return;
  for (const pending of pdfDocumentTranslationBlocksState) {
    if (pending !== block && pending.status === 'translating') {
      pending.status = 'idle';
      renderPdfDocumentTranslationBlock(pending);
    }
  }
  pdfDocumentTranslationPhase = 'running';
  // Retry only this visual block; do not resume a paused document queue.
  if(previous.translatedText)block.retranslation=true;
  const task = (async () => {
    const completed = await processPdfDocumentTranslationVisualBlock(block, revision, true, true);
    if (revision !== pdfDocumentTranslationRevision) return;
    if (!completed) {
      const failure = pdfDocumentTranslationMessage;
      Object.assign(block, previous);
      if(!previous.retranslation)delete block.retranslation;
      pdfDocumentTranslationMessage = `本段重试未完成，已保留先前结果。${failure ?? ''}`;
    }
    const scoped=scopedPdfDocumentTranslationBlocks();
    pdfDocumentTranslationPhase = previousPhase === 'complete' || scoped.length>0 &&
      scoped.every(entry=>entry.status==='done'&&!entry.retranslation) && !pdfDocumentTranslationUnreadablePageNumbers.length ? 'complete' : 'paused';
    renderPdfDocumentTranslationBlock(block);
    syncPdfDocumentTranslationUi();
    await persistPdfDocumentTranslationSession([block]);
  })();
  pdfDocumentTranslationTask = task;
  try { await task; } finally {
    if (pdfDocumentTranslationTask === task) pdfDocumentTranslationTask = undefined;
  }
}

function renderPdfFormulaReview(
  container: HTMLElement,
  block: PdfDocumentTranslationRuntimeBlock,
): void {
  if(cachedReadingContext){
    container.replaceChildren();const note=document.createElement('small');note.className='pdf-retranslation-note';
    note.textContent=`${pdfReviewConfirmed(block)?'已人工核对（原警告保留）':'待核对'}：${block.formulaReviewMessage??block.visualFallbackMessage}；可在更多菜单选择原 PDF 对照。`;
    const text=document.createElement('div');container.append(note,text);
    if(block.formulaReviewDraft)text.textContent=block.translatedText??'';
    else if(block.formulaDocument)void renderFormulaDocument(text,block.formulaDocument,true);else void renderTranslationContent(text,block.translatedText??'',true);
    return;
  }
  container.replaceChildren();
  const notice = document.createElement('div');
  notice.className = 'pdf-formula-review-notice';
  notice.textContent = block.formulaReviewMessage
    ? block.formulaReviewDraft ? '待核对译文 · 请对照原文' : '正文译文已保留 · 公式待核对'
    : block.visualFallbackMessage === '纯文本模式下公式保持原样'
      ? '当前仅文字模式 · 本段保留原文'
      : '未取得可靠译文 · 暂保留原文';
  const content = document.createElement('div');
  content.className = 'pdf-formula-review-content';
  container.append(notice, content);
  const details = document.createElement('details');
  details.className = 'pdf-formula-review-details';
  if (block.formulaReviewMessage) details.open = true;
  if (block.formulaDocument) {
    notice.textContent = /正文|漏译|目标语言/u.test(block.formulaReviewMessage ?? '')
      ? '译文完整性待核对 · 已保留译文与公式'
      : '部分公式待核对 · 其余公式与正文已保留';
    void renderFormulaDocument(content, block.formulaDocument, pdfDocumentTranslationSettings.autoRenderLatex,
      () => { details.open = true; details.scrollIntoView({ block: 'nearest' }); });
  } else void renderTranslationContent(content, block.translatedText ?? block.text,
    Boolean(block.formulaReviewMessage) && !block.formulaReviewDraft && pdfDocumentTranslationSettings.autoRenderLatex);
  const summary = document.createElement('summary');
  summary.textContent = '查看原因与原文截图';
  const reason = document.createElement('p');
  reason.textContent = block.formulaReviewMessage ?? block.visualFallbackMessage ?? '';
  const imageHost = document.createElement('div');
  details.append(summary, reason, imageHost);
  let loading = false;
  details.addEventListener('toggle', () => {
    const pdf = pdfDocument;
    if (!details.open || loading || !pdf) return;
    loading = true;
    imageHost.textContent = '正在本地生成原文截图…';
    void capturePdfDocumentTranslationVisualBlock(pdf, block).then((capture) => {
      if (!details.isConnected || pdfDocument !== pdf) return;
      const img = document.createElement('img');
      img.src = capture.imageDataUrl;
      img.alt = `第 ${block.pageNumber} 页完整原文区域（含公式），以原 PDF 为准`;
      imageHost.replaceChildren(img);
    }).catch(() => {
      if (!details.isConnected) return;
      imageHost.textContent = '无法生成本地截图，请点击本段返回原 PDF 核对。';
      loading = false;
    });
  });
  container.append(details);
  if (pdfDocumentTranslationMultimodalEnabled) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'pdf-formula-review-retry';
    retry.dataset.reviewRetry = '';
    retry.textContent = '重试本段';
    retry.title = `重新发送本段图像，预计 ${block.visualUnits?.length ?? 1} 次视觉请求；必要时补一次公式锁定的正文修复，也计入任务上限。批量翻译期间请先暂停`;
    retry.disabled = ['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning;
    retry.addEventListener('click', () => { void retryPdfFormulaReview(block); });
    container.append(retry);
  }
}

function renderPdfDocumentTranslationBlock(block: PdfDocumentTranslationRuntimeBlock): void {
  if (!block.included || block.status === 'idle' && !block.retranslation) {
    documentTranslationPages.querySelector(`[data-translation-block="${block.id}"]`)?.remove();
    updatePdfDocumentTranslationPageProgress(block.pageNumber);
    return;
  }
  const section = ensurePdfDocumentTranslationPage(block.pageNumber);
  let container = section.querySelector<HTMLElement>(
    `[data-translation-block="${block.id}"]`,
  );
  if (!container) {
    container = document.createElement('article');
    container.className = 'pdf-document-translation-block';
    container.dataset.translationBlock = block.id;
    if (pdfDocumentTranslationSourceRegions(block).length) {
      container.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest('button, details')) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && (
          container!.contains(selection.anchorNode) || container!.contains(selection.focusNode)
        )) return;
        activatePdfDocumentTranslationSource(block);
      });
      container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if ((event.target as Element | null)?.closest('button, details')) return;
        event.preventDefault();
        activatePdfDocumentTranslationSource(block);
      });
    }
    const next = [...section.querySelectorAll<HTMLElement>('[data-translation-block]')]
      .find((candidate) => {
        const other = pdfDocumentTranslationBlocksState.find(
          (item) => item.id === candidate.dataset.translationBlock,
        );
        return other ? other.blockIndex > block.blockIndex : false;
      });
    section.insertBefore(container, next ?? null);
  }
  container.dataset.status = block.status;
  const paperRole=!block.formulaReviewMessage&&!block.visualFallbackMessage?block.paperRole:undefined;
  if(paperRole)container.dataset.paperRole=paperRole;else delete container.dataset.paperRole;
  container.dataset.readingSignature=block.sessionSignature;
  container.toggleAttribute('data-retranslation',Boolean(block.retranslation));
  container.toggleAttribute('data-manual-correction',Boolean(block.manualCorrection));
  container.toggleAttribute('data-list-item', pdfDocumentTranslationStartsProseListItem(block.text));
  const headingLevel = block.status === 'done' || block.retranslation ? pdfDisplayHeadingLevel(block) : undefined;
  if (headingLevel) container.dataset.headingLevel = String(headingLevel);
  else delete container.dataset.headingLevel;
  container.toggleAttribute('data-review-draft', Boolean(block.formulaReviewDraft));
  container.toggleAttribute('data-formula-document', Boolean(block.formulaDocument));
  if (block.kind === 'figure' || block.kind === 'table') {
    container.dataset.objectRole = block.kind;
  } else {
    delete container.dataset.objectRole;
  }
  if (block.kind === 'footnote') container.dataset.noteRole = 'footnote';
  else delete container.dataset.noteRole;
  if (block.referencePreserved) container.dataset.referenceRole = 'source';
  else delete container.dataset.referenceRole;
  const sourceAvailable = Boolean(
    pdfDocumentTranslationSourceRegions(block).length && block.status === 'done',
  );
  container.toggleAttribute('data-source-anchor', sourceAvailable);
  if (sourceAvailable) {
    container.tabIndex = 0;
    container.setAttribute('role', 'link');
    container.setAttribute('aria-label', `返回第 ${block.pageNumber} 页对应原文`);
    container.title = '点击返回并高亮 PDF 原文；拖选译文不会跳转';
  } else {
    container.removeAttribute('tabindex');
    container.removeAttribute('role');
    container.removeAttribute('aria-label');
    container.removeAttribute('title');
  }
  if (block.formulaReviewMessage) {
    container.dataset.translationMode = 'review';
    container.dataset.visualRole = 'formula';
  } else if (block.visualProcessed) {
    container.dataset.translationMode = 'vision';
    container.dataset.visualRole = pdfDocumentTranslationVisualPurpose(block);
  } else if (block.visualFallbackMessage) {
    container.dataset.translationMode = 'preserved';
    container.dataset.visualRole = pdfDocumentTranslationVisualPurpose(block);
  } else {
    delete container.dataset.translationMode;
    delete container.dataset.visualRole;
  }
  if (sourceAvailable && block.referencePreserved) {
    container.title = '参考文献条目按原文保留，未发送翻译请求；点击返回并高亮原文';
  } else if (sourceAvailable && block.formulaReviewMessage) {
    container.title = block.formulaReviewDraft
      ? '待核对的模型译文，数学内容未确认；点击返回 PDF 原文'
      : '正文译文已保留，公式尚待核对；点击返回 PDF 原文';
  } else if (sourceAvailable && block.visualProcessed) {
    const purpose = pdfDocumentTranslationVisualPurpose(block);
    container.title = block.kind === 'footnote'
      ? '脚注已完整翻译；点击返回并高亮整条脚注'
      : purpose === 'figure'
        ? '图表已作为完整对象翻译；点击返回并高亮整张图表'
        : purpose === 'table'
          ? '表格已按完整行列结构翻译；点击返回并高亮整张表格'
          : purpose === 'formula'
            ? '含公式段落已通过视觉模型识别；点击返回并高亮 PDF 原文'
            : '本段已使用统一视觉模型翻译；点击返回并高亮 PDF 原文';
  } else if (sourceAvailable && block.visualFallbackMessage) {
    container.title = `${block.visualFallbackMessage}；已保留${
      pdfDocumentTranslationBlockContainsFormula(block) ? '原式' : '原文'
    }，点击可返回 PDF 原文`;
  }
  if ((block.status === 'done'||block.retranslation) && block.translatedText) {
    if (block.formulaReviewMessage || block.visualFallbackMessage) {
      renderPdfFormulaReview(container, block);
    } else if (paperRole==='publication') {
      const open=container.querySelector<HTMLDetailsElement>('.pdf-paper-publication')?.open??false;
      const details=document.createElement('details');details.className='pdf-paper-publication';details.open=open;
      const summary=document.createElement('summary');
      const label=document.createElement('span');label.textContent='出版信息';
      const excerpt=document.createElement('span');excerpt.className='pdf-paper-publication-excerpt';excerpt.textContent=block.translatedText.replace(/\s+/gu,' ').trim();
      summary.append(label,excerpt);const content=document.createElement('div');content.className='pdf-paper-publication-content';details.append(summary,content);container.replaceChildren(details);
      if(block.formulaDocument)void renderFormulaDocument(content,block.formulaDocument,pdfDocumentTranslationSettings.autoRenderLatex);
      else void renderTranslationContent(content,block.translatedText,pdfDocumentTranslationSettings.autoRenderLatex);
    } else if (paperRole==='title') {
      const title=document.createElement('h1');title.className='pdf-paper-title';container.replaceChildren(title);
      if(block.formulaDocument)void renderFormulaDocument(title,block.formulaDocument,pdfDocumentTranslationSettings.autoRenderLatex);
      else void renderTranslationContent(title,block.translatedText,pdfDocumentTranslationSettings.autoRenderLatex);
    } else if (headingLevel) {
      const title = document.createElement(`h${headingLevel + 1}`);
      title.className = 'pdf-section-title';
      container.replaceChildren(title);
      if (block.formulaDocument) void renderFormulaDocument(title, block.formulaDocument, pdfDocumentTranslationSettings.autoRenderLatex);
      else void renderTranslationContent(title, block.translatedText, pdfDocumentTranslationSettings.autoRenderLatex);
    } else if (block.formulaDocument) {
      void renderFormulaDocument(container, block.formulaDocument, pdfDocumentTranslationSettings.autoRenderLatex);
    } else if (block.kind === 'table') {
      void renderPdfDocumentTranslationTable(container, block.translatedText).then((rendered) => {
        if (rendered) return;
        return renderTranslationContent(
          container!,
          block.translatedText!,
          pdfDocumentTranslationSettings.autoRenderLatex,
        );
      });
    } else {
      void renderTranslationContent(
        container,
        block.translatedText,
        pdfDocumentTranslationSettings.autoRenderLatex,
      );
    }
  } else if (block.status === 'error') {
    container.replaceChildren(document.createTextNode(block.errorMessage ?? '本段翻译失败。'));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试本段';
    retry.addEventListener('click', () => {
      disposePdfDocumentBackgroundJob();
      block.status = 'idle';
      block.singleRetry = true;
      delete block.errorMessage;
      pdfDocumentTranslationPhase = 'running';
      pdfDocumentTranslationMessage = undefined;
      renderPdfDocumentTranslationBlock(block);
      syncPdfDocumentTranslationUi();
      void startPdfDocumentBackgroundTranslation().then((started) => {
        if (!started) void processPdfDocumentTranslationQueue();
      });
    });
    container.append(retry);
  } else {
    container.textContent = '正在翻译本页内容…';
  }
  if(block.retranslation){const note=document.createElement('small');note.className='pdf-retranslation-note';note.textContent=block.errorMessage??'重译中保留旧稿，新结果通过校验并保存后替换。';container.prepend(note)}
  updatePdfDocumentTranslationPageProgress(block.pageNumber);
  container.querySelector('.pdf-paragraph-edit-action')?.remove();
  if(block.status==='done'&&block.translatedText&&!block.referencePreserved&&!['figure','table','formula','code'].includes(block.kind??'paragraph')){
    const edit=document.createElement('button');edit.type='button';edit.className='pdf-paragraph-edit-action';edit.textContent='✎';edit.title='修正本段文字';edit.ariaLabel=`修正第 ${block.pageNumber} 页本段译文`;
    edit.disabled=['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning;
    edit.addEventListener('click',event=>{event.stopPropagation();void openPdfParagraphEditor(block)});container.append(edit);
  }
  if (!searchPanel.hidden && searchScope.value !== 'source' && !translationSearchFrame) {
    translationSearchFrame = requestAnimationFrame(() => {
      translationSearchFrame = 0;
      updatePdfSearchMatches(true);
    });
  }
}

interface PdfBackgroundCommandResponse {
  ok: boolean;
  snapshot?: PdfBackgroundTranslationSnapshot;
  error?: string;
}

function pdfParagraphValue(block:PdfDocumentTranslationRuntimeBlock):PdfCorrectionValue{
  return {translatedText:block.translatedText??'',...(block.formulaDocument?{formulaDocument:structuredClone(block.formulaDocument)}:{})};
}
function pdfParagraphHistoryValue(block:PdfDocumentTranslationRuntimeBlock):PdfParagraphHistory{
  return {...paragraphValue({...block,translatedText:block.translatedText??''}),...(block.revisions?{revisions:block.revisions}:{}),...(block.retranslation?{retranslation:true}: {})};
}
function applyPdfParagraphValue(block:PdfDocumentTranslationRuntimeBlock,value:PdfParagraphHistory):void{
  for(const key of ['formulaDocument','reviewConfirmation','formulaReviewMessage','formulaReviewDraft','visualFallbackMessage','manualCorrection','revisions','retranslation'] as const)delete block[key];
  Object.assign(block,value);
  block.translatedText=value.formulaDocument?formulaDocumentText(value.formulaDocument):value.translatedText;
}
function applyPdfTranslationOutcome(block:PdfDocumentTranslationRuntimeBlock,outcome:PdfBackgroundTranslationOutcome):void{
  if(block.manualCorrection&&!block.retranslation)return;
  if(!block.retranslation&&block.status==='done'&&block.translatedText===outcome.translatedText&&JSON.stringify(block.formulaDocument)===JSON.stringify(outcome.formulaDocument)&&block.formulaReviewMessage===outcome.formulaReviewMessage&&block.visualFallbackMessage===outcome.visualFallbackMessage&&block.formulaReviewDraft===outcome.formulaReviewDraft)return;
  const before=block.translatedText?pdfParagraphHistoryValue(block):undefined;
  if(before&&block.retranslation&&(outcome.formulaReviewMessage||outcome.visualFallbackMessage)){
    const candidate=paragraphRevision(outcome,'unaccepted');
    const previous=block.revisions??[];
    if(!previous.some(item=>item.reason==='unaccepted'&&JSON.stringify(paragraphValue(item))===JSON.stringify(paragraphValue(candidate))))block.revisions=[candidate,...previous].slice(0,MAX_PDF_PARAGRAPH_REVISIONS);
    block.status='error';block.errorMessage='新结果未通过校验，继续显示旧译文；返回内容在校订历史中待核对。';
    return;
  }
  if(before&&block.retranslation)stagedPdfReplacements.set(block,before);
  const next=withParagraphHistory(before,{...paragraphValue(outcome),...(block.revisions?{revisions:block.revisions}:{})});
  applyPdfParagraphValue(block,next);block.status='done';
  delete block.omitReadingMetadata;
  if(outcome.visualProcessed)block.visualProcessed=true;else delete block.visualProcessed;
  delete block.errorMessage;delete block.singleRetry;
}
function pdfParagraphStamp(block:PdfDocumentTranslationRuntimeBlock):string{
  return JSON.stringify([currentDocumentSessionId,currentPdfDocumentTranslationSessionContext(),block.sessionSignature,pdfParagraphValue(block),block.formulaReviewMessage,block.visualFallbackMessage]);
}
async function openPdfParagraphEditor(block:PdfDocumentTranslationRuntimeBlock):Promise<void>{
  if(['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning||block.status!=='done')return;
  await sendPdfDocumentBackgroundControl('dispose');
  await pdfDocumentBackgroundSnapshotQueue;
  if(!pdfDocumentTranslationBlocksState.includes(block)||block.status!=='done')return;
  activeParagraphEdit={block,stamp:pdfParagraphStamp(block),documentSessionId:currentDocumentSessionId};
  const parts=element<HTMLElement>('pdf-paragraph-editor-parts');parts.replaceChildren();
  for(const part of pdfCorrectionParts(pdfParagraphValue(block))){
    if(part.kind==='text'){
      const label=document.createElement('label');const caption=document.createElement('span');caption.textContent='译文';const input=document.createElement('textarea');input.value=part.text;input.dataset.partId=part.id;input.rows=Math.min(8,Math.max(2,Math.ceil(part.text.length/45)));input.ariaLabel='本段可编辑译文';label.append(caption,input);parts.append(label);
    }else{
      const label=document.createElement('small');label.textContent='公式 / 命令 · 只读';const source=document.createElement('pre');source.className='pdf-paragraph-locked';source.textContent=part.label??part.text;parts.append(label,source);
    }
  }
  element<HTMLElement>('pdf-paragraph-editor-context').textContent=`${block.omitReadingMetadata?'已保存段落':`第 ${block.pageNumber} 页`} · 只修改文字，不调用翻译接口。公式与命令保持锁定。`;
  element<HTMLElement>('pdf-paragraph-editor-status').textContent='';
  element<HTMLDialogElement>('pdf-paragraph-editor').showModal();
  parts.querySelector('textarea')?.focus();
}

const pdfHistoryDialog=element<HTMLDialogElement>('pdf-history-dialog');
const pdfTermsDialog=element<HTMLDialogElement>('pdf-terms-dialog');
let pdfConfirmedTerms:ConfirmedPdfTerm[]=[],pdfTermCandidates:PdfTermCandidate[]=[];
let pdfTermPreview:{block:PdfDocumentTranslationRuntimeBlock;stamp:string;value:PdfCorrectionValue}|undefined;
const termCandidateSelect=element<HTMLSelectElement>('pdf-terms-candidate');
const termFrom=element<HTMLInputElement>('pdf-terms-from'),termTo=element<HTMLInputElement>('pdf-terms-to');
const termApply=element<HTMLButtonElement>('pdf-terms-apply'),termStatus=element<HTMLElement>('pdf-terms-status');
const termLocator=()=>({pageUrl:currentSourceUrl??location.href,...(currentReadingIdentity?{documentId:currentReadingIdentity}:{}),...(currentSourceLabel?{sourceLabel:currentSourceLabel}:{})});
function termSourceContext(source?:string):TermSource{
  const identity=documentIdentity(termLocator()),matches=source?pdfDocumentTranslationBlocksState.filter(block=>containsPdfTerm(block.text,source)):[];
  const title=(pdfDocumentTranslationBlocksState.find(block=>block.paperRole==='title')?.text||currentSourceLabel||'当前 PDF 文档').trim().slice(0,160);
  const sourceUrl=termSourceUrl(currentSourceUrl);
  return {documentId:identity.documentId,title,...(sourceUrl?{sourceUrl}:{}),...(matches.length===1?{pageNumber:matches[0]!.pageNumber}:{})};
}
function termTargetLanguage(){const language=pdfDocumentTranslationSettings.targetLanguage;if(!isSupportedTargetLanguage(language))throw new Error('当前目标语言不支持术语复用。');return language}
const pdfTermReuse=bindPdfTermReuse({locator:termLocator,context:termSourceContext,language:termTargetLanguage,onMemory:memory=>{pdfConfirmedTerms=memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));refreshPdfTermCandidates()}});
function resetPdfTermPreview():void{pdfTermPreview=undefined;termApply.textContent='预览修改';element<HTMLElement>('pdf-terms-preview').hidden=true}
function renderPdfTermCandidate():void{
  resetPdfTermPreview();termStatus.textContent='';
  const candidate=pdfTermCandidates[Number(termCandidateSelect.value)],block=candidate&&pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);
  const current=element<HTMLElement>('pdf-terms-current');current.replaceChildren();
  termApply.disabled=!candidate||candidate.protected;element<HTMLElement>('pdf-terms-edit').hidden=!candidate||candidate.protected;
  element<HTMLElement>('pdf-terms-explanation').textContent=candidate?`约定译法：${candidate.source} → ${candidate.target}。本段未找到约定译法，请结合原文判断。${candidate.protected?'本段已人工校订，默认保留。':''}`:pdfConfirmedTerms.length?'未发现缺少约定译法的已完成段落。这不代表全篇语义已通过核验。':'尚无已确认术语，请先添加本文词条。';
  element<HTMLElement>('pdf-terms-context').textContent=candidate?.context??'';
  if(block?.translatedText){if(block.formulaDocument)void renderFormulaDocument(current,block.formulaDocument,true);else void renderTranslationContent(current,block.translatedText,true)}
  termFrom.value=candidate&&block?.translatedText?.toLocaleLowerCase().includes(candidate.source.toLocaleLowerCase())?candidate.source:'';termTo.value=candidate?.target??'';
}
function refreshPdfTermCandidates():void{
  pdfTermCandidates=checkPdfTermConsistency(pdfDocumentTranslationBlocksState.map(block=>({...block,translatedText:block.translatedText??''})),pdfConfirmedTerms);
  termCandidateSelect.replaceChildren(...pdfTermCandidates.map((candidate,index)=>{const option=document.createElement('option');option.value=String(index);const block=pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);option.textContent=`第 ${block?.pageNumber} 页 · ${candidate.source}${candidate.protected?' · 已校订':''}`;return option}));
  termCandidateSelect.disabled=!pdfTermCandidates.length;
  element<HTMLDetailsElement>('pdf-terms-manage').open=!pdfConfirmedTerms.length;
  renderPdfTermCandidate();
  termStatus.textContent=pdfTermCandidates.length?`${pdfTermCandidates.length===200?'前 ':''}${pdfTermCandidates.length} 处候选 · 仅检查已完成且有原文的段落`:'本地检查完成，未调用翻译接口。';
}
element<HTMLButtonElement>('pdf-document-terms').addEventListener('click',()=>{void(async()=>{
  documentTranslationCopyMenu.open=false;const epoch=documentEpoch;
  if(!pdfDocument||['running','preparing'].includes(pdfDocumentTranslationPhase))return;
  const response=await browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:termLocator()} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;
  if(!response.ok)throw new Error(response.error.message);if(epoch!==documentEpoch)return;
  pdfConfirmedTerms=response.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));pdfTermReuse.reset(response.data.memory);refreshPdfTermCandidates();pdfTermsDialog.showModal();
})().catch(error=>showNotice(error instanceof Error?error.message:'术语检查暂不可用。',{tone:'error'}))});
element<HTMLButtonElement>('pdf-terms-close').addEventListener('click',()=>pdfTermsDialog.close());
termCandidateSelect.addEventListener('change',renderPdfTermCandidate);
termFrom.addEventListener('input',resetPdfTermPreview);termTo.addEventListener('input',resetPdfTermPreview);
element<HTMLFormElement>('pdf-terms-add').addEventListener('submit',event=>{event.preventDefault();void(async()=>{
  const epoch=documentEpoch,form=element<HTMLFormElement>('pdf-terms-add'),button=form.querySelector('button')!;button.disabled=true;
  try{const source=element<HTMLInputElement>('pdf-term-source').value,context=termSourceContext(source);const response=await browser.runtime.sendMessage({type:'UPSERT_DOCUMENT_TERM',payload:{...termLocator(),term:{source,target:element<HTMLInputElement>('pdf-term-target').value,provenance:{origin:context,confirmed:{...context,targetLanguage:termTargetLanguage(),at:Date.now()}}}}} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;
    if(!response.ok)throw new Error(response.error.message);if(epoch!==documentEpoch)return;
    pdfConfirmedTerms=response.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));pdfTermReuse.update(response.data.memory);form.reset();refreshPdfTermCandidates();
  }finally{button.disabled=false}
})().catch(error=>termStatus.textContent=error instanceof Error?error.message:'词条保存失败。')});
termApply.addEventListener('click',()=>{void(async()=>{
  const candidate=pdfTermCandidates[Number(termCandidateSelect.value)],block=candidate&&pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);
  if(!block||candidate.protected||block.manualCorrection||block.status!=='done'||!pdfDocument)throw new Error('这段译文已变化，请重新检查。');
  if(!pdfTermPreview){
    const value=previewPdfTermCorrection(pdfParagraphValue(block),termFrom.value.trim(),termTo.value.trim());
    pdfTermPreview={block,stamp:pdfParagraphStamp(block),value};const preview=element<HTMLElement>('pdf-terms-preview');preview.hidden=false;
    const content=preview.querySelector<HTMLElement>('div')!;content.replaceChildren();if(value.formulaDocument)await renderFormulaDocument(content,value.formulaDocument,true);else await renderTranslationContent(content,value.translatedText,true);
    termApply.textContent='应用到本段';termStatus.textContent='仅替换本段可编辑文字；公式与命令保持不变。';return;
  }
  const edit=pdfTermPreview;if(edit.block!==block||edit.stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新预览。');
  termApply.disabled=true;
  try{
    await sendPdfDocumentBackgroundControl('dispose');await pdfDocumentBackgroundSnapshotQueue;
    if(edit.stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新预览。');
    const before=pdfParagraphHistoryValue(block);
    applyPdfParagraphValue(block,withParagraphHistory(before,{...paragraphValue({...before,...edit.value}),manualCorrection:true},'correction'));delete block.reviewConfirmation;
    if(!await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState.filter(block=>block.status==='done'),true)){applyPdfParagraphValue(block,before);throw new Error('修正保存失败，旧译文已保留。')}
    lastParagraphCorrection=undefined;renderPdfDocumentTranslationBlock(block);syncPdfDocumentTranslationUi();refreshPdfTermCandidates();termStatus.textContent='本段修正已保存，可在校订历史中恢复。';
  }finally{termApply.disabled=!pdfTermCandidates.length||Boolean(pdfTermCandidates[Number(termCandidateSelect.value)]?.protected)}
})().catch(error=>{termStatus.textContent=error instanceof Error?error.message:'术语修正失败。';resetPdfTermPreview()})});
const pdfHistoryParagraph=element<HTMLSelectElement>('pdf-history-paragraph');
const pdfHistoryVersion=element<HTMLSelectElement>('pdf-history-version');
function selectedPdfHistoryBlock(){return pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===pdfHistoryParagraph.value)}
function renderPdfHistoryVersion():void{
  const block=selectedPdfHistoryBlock(),version=block?.revisions?.find(item=>item.id===pdfHistoryVersion.value);
  const current=element<HTMLElement>('pdf-history-current'),previous=element<HTMLElement>('pdf-history-previous');
  current.replaceChildren();previous.replaceChildren();
  if(block?.translatedText){if(block.formulaDocument)void renderFormulaDocument(current,block.formulaDocument,true);else void renderTranslationContent(current,block.translatedText,true)}
  if(version){if(version.reason==='unaccepted')previous.textContent=version.formulaDocument?formulaDocumentText(version.formulaDocument):version.translatedText;else if(version.formulaDocument)void renderFormulaDocument(previous,version.formulaDocument,true);else void renderTranslationContent(previous,version.translatedText,true)}
  element<HTMLElement>('pdf-history-status').textContent=version?.reason==='unaccepted'?`未采用的新结果：${version.formulaReviewMessage??version.visualFallbackMessage??'尚未通过校验'}。旧稿仍保留。`:version?.formulaReviewMessage??version?.visualFallbackMessage??'恢复只影响本段；当前版本也会保留在历史中。';
  element<HTMLButtonElement>('pdf-history-restore').disabled=!version||version.reason==='unaccepted';
}
function renderPdfHistoryParagraph():void{
  const labels={correction:'修正前',translation:'重译前',restore:'恢复前',unaccepted:'未采用 · 待核对',import:'导入时保留的版本'};
  pdfHistoryVersion.replaceChildren(...(selectedPdfHistoryBlock()?.revisions??[]).map(version=>{const option=document.createElement('option');option.value=version.id;option.textContent=`${labels[version.reason]} · ${new Date(version.createdAt).toLocaleString()}`;return option}));
  renderPdfHistoryVersion();
}
element<HTMLButtonElement>('pdf-document-history').addEventListener('click',()=>{
  documentTranslationCopyMenu.open=false;
  pdfHistoryParagraph.replaceChildren(...pdfDocumentTranslationBlocksState.filter(block=>block.revisions?.length).map(block=>{const option=document.createElement('option');option.value=block.sessionSignature;option.textContent=`${block.omitReadingMetadata?'已保存段落':`第 ${block.pageNumber} 页`} · ${block.translatedText?.replace(/\s+/gu,' ').slice(0,48)}`;return option}));
  renderPdfHistoryParagraph();pdfHistoryDialog.showModal();
});
pdfHistoryParagraph.addEventListener('change',renderPdfHistoryParagraph);pdfHistoryVersion.addEventListener('change',renderPdfHistoryVersion);
element<HTMLButtonElement>('pdf-history-close').addEventListener('click',()=>pdfHistoryDialog.close());
element<HTMLButtonElement>('pdf-history-restore').addEventListener('click',()=>{void(async()=>{
  const block=selectedPdfHistoryBlock();if(!block||!block.revisions?.some(item=>item.id===pdfHistoryVersion.value&&item.reason!=='unaccepted'))return;
  const before=pdfParagraphHistoryValue(block),stamp=pdfParagraphStamp(block);
  await sendPdfDocumentBackgroundControl('dispose');await pdfDocumentBackgroundSnapshotQueue;
  if(stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新打开历史。');
  applyPdfParagraphValue(block,restoredParagraphRevision(before,pdfHistoryVersion.value));block.status='done';
  if(!await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState,true)){applyPdfParagraphValue(block,before);throw new Error('恢复未能保存，当前译文已保留。')}
  lastParagraphCorrection=undefined;renderPdfDocumentTranslationBlock(block);syncPdfDocumentTranslationUi();pdfHistoryDialog.close();showPdfParagraphSaveScope();
})().catch(error=>{element<HTMLElement>('pdf-history-status').textContent=error instanceof Error?error.message:'恢复失败，当前译文已保留。'})});
const paragraphEditor=element<HTMLDialogElement>('pdf-paragraph-editor');
for(const id of ['pdf-paragraph-editor-close','pdf-paragraph-editor-cancel'])element<HTMLButtonElement>(id).addEventListener('click',()=>paragraphEditor.close());
paragraphEditor.addEventListener('close',()=>{
  const block=activeParagraphEdit?.block;activeParagraphEdit=undefined;
  if(block)documentTranslationPages.querySelector<HTMLButtonElement>(`[data-translation-block="${block.id}"] .pdf-paragraph-edit-action`)?.focus({preventScroll:true});
});
element<HTMLFormElement>('pdf-paragraph-edit-form').addEventListener('submit',event=>{
  event.preventDefault();const edit=activeParagraphEdit;if(!edit)return;
  const save=element<HTMLButtonElement>('pdf-paragraph-editor-save');save.disabled=true;
  void(async()=>{
    if(edit.documentSessionId!==currentDocumentSessionId||!pdfDocumentTranslationBlocksState.includes(edit.block)||edit.stamp!==pdfParagraphStamp(edit.block))throw new Error('这段译文已变化，请关闭后重新打开修正。');
    const before=pdfParagraphValue(edit.block);const historyBefore=pdfParagraphHistoryValue(edit.block);const confirmation=edit.block.reviewConfirmation;
    const edits=new Map([...paragraphEditor.querySelectorAll<HTMLTextAreaElement>('textarea[data-part-id]')].map(input=>[input.dataset.partId!,input.value]));
    const after=applyPdfParagraphCorrection(before,edits);
    if(!cachedReadingContext)delete edit.block.omitReadingMetadata;
    applyPdfParagraphValue(edit.block,withParagraphHistory(historyBefore,{...paragraphValue({...historyBefore,...after}),manualCorrection:true},'correction'));delete edit.block.reviewConfirmation;
    const saved=await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState.filter(block=>block.status==='done'),true);
    if(!saved){applyPdfParagraphValue(edit.block,historyBefore);throw new Error('保存失败，原译文已保留，请重试。');}
    if(edit.documentSessionId!==currentDocumentSessionId||!pdfDocumentTranslationBlocksState.includes(edit.block))return;
    lastParagraphCorrection={block:edit.block,stamp:pdfParagraphStamp(edit.block),before,...(confirmation?{confirmation}:{}),documentSessionId:currentDocumentSessionId};
    renderPdfDocumentTranslationBlock(edit.block);syncPdfDocumentTranslationUi();paragraphEditor.close();
    setPdfDocumentTranslationCopyFeedback('本段修正已保存，可在更多菜单中撤销。');
    showPdfParagraphSaveScope();
  })().catch(error=>{
    const code=(error as {code?:string}).code;
    element<HTMLElement>('pdf-paragraph-editor-status').textContent=code==='NO_CHANGES'?'译文没有变化。':code==='LATEX_CHANGED'?'只能修改自然语言，公式和命令必须保持不变。':code==='EMPTY_TRANSLATION'?'译文不能为空。':error instanceof Error?error.message:'保存失败，请重试。';
  }).finally(()=>{save.disabled=false});
});
element<HTMLButtonElement>('pdf-document-undo-correction').addEventListener('click',()=>{
  const undo=lastParagraphCorrection;if(!undo||undo.documentSessionId!==currentDocumentSessionId||undo.stamp!==pdfParagraphStamp(undo.block))return;
  documentTranslationCopyMenu.open=false;
  void(async()=>{
    const current=pdfParagraphValue(undo.block);const currentConfirmation=undo.block.reviewConfirmation;Object.assign(undo.block,undo.before);
    if(undo.confirmation)undo.block.reviewConfirmation=undo.confirmation;else delete undo.block.reviewConfirmation;
    if(!await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState.filter(block=>block.status==='done'),true)){Object.assign(undo.block,current);if(currentConfirmation)undo.block.reviewConfirmation=currentConfirmation;else delete undo.block.reviewConfirmation;throw new Error('撤销保存失败，请重试。');}
    if(undo.documentSessionId!==currentDocumentSessionId||!pdfDocumentTranslationBlocksState.includes(undo.block))return;
    lastParagraphCorrection=undefined;renderPdfDocumentTranslationBlock(undo.block);syncPdfDocumentTranslationUi();
    setPdfDocumentTranslationCopyFeedback('已恢复修正前的译文。');
    showPdfParagraphSaveScope();
  })().catch(error=>showNotice(error instanceof Error?error.message:'撤销失败。',{tone:'error'}));
});

let pdfDocumentBackgroundSnapshotQueue: Promise<void> = Promise.resolve();
let pdfDocumentBackgroundControlQueue: Promise<void> = Promise.resolve();
let pdfDocumentBackgroundStartAttempt = 0;

async function applyPdfDocumentBackgroundSnapshot(
  snapshot: PdfBackgroundTranslationSnapshot,
): Promise<void> {
  if (
    snapshot.jobId !== pdfDocumentBackgroundJobId ||
    snapshot.documentSessionId !== currentDocumentSessionId
  ) return;
  if (snapshot.revision !== undefined) {
    if (snapshot.revision <= pdfDocumentBackgroundSnapshotRevision) return;
    pdfDocumentBackgroundSnapshotRevision = snapshot.revision;
  }
  const completedById = new Map(
    snapshot.completed.map((outcome) => [outcome.blockId, outcome]),
  );
  const changed: PdfDocumentTranslationRuntimeBlock[] = [];
  for (const block of pdfDocumentTranslationBlocksState) {
    const outcome = completedById.get(block.id);
    if (outcome) {
      if (
        block.status !== 'done' ||
        block.translatedText !== outcome.translatedText ||
        block.visualProcessed !== outcome.visualProcessed ||
        block.visualFallbackMessage !== outcome.visualFallbackMessage ||
        block.formulaReviewMessage !== outcome.formulaReviewMessage ||
        block.formulaReviewDraft !== outcome.formulaReviewDraft ||
        JSON.stringify(block.formulaDocument) !== JSON.stringify(outcome.formulaDocument)
      ) changed.push(block);
      applyPdfTranslationOutcome(block,outcome);
    } else if (block.included && block.status === 'translating') {
      block.status = block.id === snapshot.activeBlockId ? 'translating' : 'idle';
    } else if (
      block.included &&
      block.id === snapshot.activeBlockId &&
      block.status === 'idle'
    ) {
      block.status = 'translating';
    }
    if (block.included && (changed.includes(block) || block.id === snapshot.activeBlockId)) {
      renderPdfDocumentTranslationBlock(block);
    }
  }
  pdfDocumentTranslationPhase = snapshot.phase;
  if (snapshot.requestUsage) pdfRequestUsage = { ...snapshot.requestUsage };
  pdfDocumentTranslationMessage = snapshot.errorMessage;
  syncPdfDocumentTranslationUi();
  if (changed.length) await persistPdfDocumentTranslationSession(changed);
  if (snapshot.phase === 'complete') await persistPdfDocumentTranslationSession();
}

function queuePdfDocumentBackgroundSnapshot(snapshot: PdfBackgroundTranslationSnapshot): void {
  pdfDocumentBackgroundSnapshotQueue = pdfDocumentBackgroundSnapshotQueue
    .then(() => applyPdfDocumentBackgroundSnapshot(snapshot))
    .catch(() => undefined);
}

function sendPdfDocumentBackgroundControl(
  action: 'pause' | 'resume' | 'stop' | 'dispose',
): Promise<void> {
  const jobId = pdfDocumentBackgroundJobId;
  if (!jobId) return Promise.resolve();
  if (action === 'dispose') pdfDocumentBackgroundJobId = undefined;
  const operation = pdfDocumentBackgroundControlQueue.then(async () => {
    const response = await browser.runtime.sendMessage({
      type: 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
      target: 'pdf-background',
      payload: { jobId, action, ...(action === 'resume' ? { requestLimit: pdfRequestLimit() } : {}) },
    } satisfies PdfBackgroundDocumentMessage).catch(() => undefined) as
      | PdfBackgroundCommandResponse
      | undefined;
    if (
      action !== 'dispose' &&
      pdfDocumentBackgroundJobId === jobId &&
      response?.snapshot
    ) queuePdfDocumentBackgroundSnapshot(response.snapshot);
  });
  pdfDocumentBackgroundControlQueue = operation.catch(() => undefined);
  return operation;
}

async function disposePdfDocumentBackgroundJobById(jobId: string): Promise<void> {
  await browser.runtime.sendMessage({
    type: 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
    target: 'pdf-background',
    payload: { jobId, action: 'dispose' },
  } satisfies PdfBackgroundDocumentMessage).catch(() => undefined);
}

function disposePdfDocumentBackgroundJob(): void {
  void sendPdfDocumentBackgroundControl('dispose');
}

async function syncPdfDocumentBackgroundTranslation(): Promise<void> {
  const jobId = pdfDocumentBackgroundJobId;
  if (!jobId) return;
  const response = await browser.runtime.sendMessage({
    type: 'GET_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
    target: 'pdf-background',
    payload: { jobId },
  } satisfies PdfBackgroundDocumentMessage).catch(() => undefined) as
    | PdfBackgroundCommandResponse
    | undefined;
  if (response?.snapshot) queuePdfDocumentBackgroundSnapshot(response.snapshot);
}

async function startPdfDocumentBackgroundTranslation(): Promise<boolean> {
  const epoch = documentEpoch;
  const revision = pdfDocumentTranslationRevision;
  const documentSessionId = currentDocumentSessionId;
  const attempt = ++pdfDocumentBackgroundStartAttempt;
  const mayStart = () => epoch === documentEpoch && revision === pdfDocumentTranslationRevision &&
    attempt === pdfDocumentBackgroundStartAttempt && documentSessionId === currentDocumentSessionId &&
    pdfDocumentTranslationPhase === 'running';
  const backgroundData = currentPdfBackgroundData;
  const pending = pdfDocumentTranslationBlocksState.filter(
    (block) => block.included && block.status === 'idle',
  );
  if (!pending.length) return false;
  const mode: 'text' | 'vision' | 'hybrid' =
    pdfDocumentTranslationMultimodalEnabled && pdfDocumentTranslationMultimodalAuthorized
      ? pdfDocumentTranslationUsesUnifiedVision()
        ? 'vision'
        : pending.some((block) => pdfDocumentTranslationVisualPurpose(block) !== 'document')
          ? 'hybrid'
          : 'text'
      : 'text';
  if (mode !== 'text' && !backgroundData) return false;
  const ready = await browser.runtime.sendMessage({
    type: 'ENSURE_PDF_BACKGROUND_DOCUMENT',
  }).catch(() => undefined) as { ok?: boolean } | undefined;
  // A cancelled start is already handled; do not launch the local fallback queue.
  if (!mayStart()) return true;
  if (!ready?.ok) return false;
  const jobId = crypto.randomUUID();
  const pdfResourceUrl = mode !== 'text'
    ? `https://pi-translator.invalid/__pdf-background/${encodeURIComponent(jobId)}.pdf`
    : undefined;
  if (pdfResourceUrl) {
    try {
      const cache = await caches.open(PDF_BACKGROUND_CACHE_NAME);
      await cache.put(
        pdfResourceUrl,
        new Response(backgroundData!.slice().buffer as ArrayBuffer, {
          headers: { 'Content-Type': 'application/pdf' },
        }),
      );
    } catch {
      return !mayStart();
    }
    if (!mayStart()) {
      void caches.open(PDF_BACKGROUND_CACHE_NAME)
        .then((cache) => cache.delete(pdfResourceUrl))
        .catch(() => undefined);
      return true;
    }
  }
  pdfDocumentBackgroundJobId = jobId;
  pdfDocumentBackgroundSnapshotRevision = 0;
  const pendingIds = new Set(pending.map((block) => block.id));
  const response = await browser.runtime.sendMessage({
    type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION',
    target: 'pdf-background',
    payload: {
      jobId,
      documentSessionId,
      mode,
      ...(pdfResourceUrl ? { pdfResourceUrl } : {}),
      blocks: pending.map((block) => {
        const index = pdfDocumentTranslationBlocksState.indexOf(block);
        const continuity = pdfDocumentTranslationContinuity(
          pdfDocumentTranslationBlocksState,
          index,
        );
        const previous = continuity.previousIndex === undefined
          ? undefined
          : pdfDocumentTranslationBlocksState[continuity.previousIndex];
        const contextText = pdfDocumentTranslationContext(block);
        return {
          id: block.id,
          pageNumber: block.pageNumber,
          text: block.text,
          containsFormula: pdfDocumentTranslationBlockContainsFormula(block),
          ...(block.visualUnits ? { visualUnits: block.visualUnits } : {}),
          ...(block.equationNumbers ? { equationNumbers: block.equationNumbers } : {}),
          ...(block.sourceEquations ? { sourceEquations: block.sourceEquations } : {}),
          ...(block.sourceFontHints ? {sourceFontHints:block.sourceFontHints}:{}),
          preserveInTextMode: block.kind === 'formula',
          visualPurpose: pdfDocumentTranslationVisualPurpose(block),
          sourceRegions: pdfDocumentTranslationSourceRegions(block).map((region) => ({
            ...region,
            sourceAnchor: { ...region.sourceAnchor },
          })),
          ...(continuity.continuesPrevious && previous && pendingIds.has(previous.id)
            ? { previousBlockId: previous.id }
            : {}),
          ...(contextText ? { contextText } : {}),
        };
      }),
      settings: {
        requestLimit: pdfRequestLimit(),
        requestUsage: { ...pdfRequestUsage },
        ...(currentReadingIdentity || currentDocumentSessionId
          ? { documentId: currentReadingIdentity ?? currentDocumentSessionId }
          : {}),
        pageUrl: currentSourceUrl,
        ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}),
        targetLanguage: pdfDocumentTranslationSettings.targetLanguage,
        sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
        style: pdfDocumentTranslationSettings.style,
        contentMode: pdfDocumentTranslationSettings.contentMode,
      },
    },
  } satisfies PdfBackgroundDocumentMessage).catch(() => undefined) as
    | PdfBackgroundCommandResponse
    | undefined;
  if (
    pdfDocumentBackgroundJobId !== jobId || epoch !== documentEpoch ||
    documentSessionId !== currentDocumentSessionId
  ) {
    await disposePdfDocumentBackgroundJobById(jobId);
    return true;
  }
  if (!response?.ok) {
    pdfDocumentBackgroundJobId = undefined;
    if (pdfResourceUrl) {
      void caches.open(PDF_BACKGROUND_CACHE_NAME)
        .then((cache) => cache.delete(pdfResourceUrl))
        .catch(() => undefined);
    }
    return false;
  }
  if (response.snapshot) queuePdfDocumentBackgroundSnapshot(response.snapshot);
  return true;
}

function cancelPdfDocumentTranslationRequest(): void {
  if (!pdfDocumentTranslationRequestId) return;
  const requestId = pdfDocumentTranslationRequestId;
  pdfDocumentTranslationRequestId = undefined;
  void browser.runtime.sendMessage({
    type: 'CANCEL_TRANSLATION',
    payload: { requestId },
  } satisfies RuntimeMessage).catch(() => undefined);
}

function cancelPdfDocumentTranslationOcrRequest(): void {
  if (!pdfDocumentTranslationOcrRequestId) return;
  const requestId = pdfDocumentTranslationOcrRequestId;
  pdfDocumentTranslationOcrRequestId = undefined;
  void browser.runtime.sendMessage({
    type: 'CANCEL_TRANSLATION',
    payload: { requestId },
  } satisfies RuntimeMessage).catch(() => undefined);
}

function resetPdfDocumentTranslation(closePanel = false): void {
  pdfRequestUsage = emptyPdfRequestUsage();
  pdfTrialRunning = false;
  documentRequestLimit.value = '0';
  pdfDocumentTranslationRevision += 1;
  disposePdfDocumentBackgroundJob();
  cancelPdfDocumentTranslationRequest();
  pdfDocumentTranslationOcrRevision += 1;
  cancelPdfDocumentTranslationOcrRequest();
  pdfDocumentTranslationBlocksState = [];
  pdfDocumentTranslationArchivedBlocks = [];
  pdfDocumentTranslationUnreadablePages = 0;
  pdfDocumentTranslationUnreadablePageNumbers = [];
  pdfDocumentTranslationMultiColumnPages = 0;
  pdfDocumentTranslationRemovedMarginLines = 0;
  pdfDocumentTranslationPhase = 'idle';
  pdfDocumentTranslationMessage = undefined;
  pdfDocumentTranslationOcrRunning = false;
  pdfDocumentTranslationOcrProgress = { completed: 0, total: 0 };
  pdfDocumentTranslationOcrMessage = undefined;
  pdfDocumentTranslationOcrError = false;
  pdfDocumentTranslationMultimodalEnabled = true;
  pdfDocumentTranslationMultimodalAuthorized = false;
  documentTranslationMultimodalToggle.checked = true;
  pdfDocumentTranslationRetainedLocally = false;
  pdfDocumentTranslationSessionWriteDirty = false;
  pdfDocumentTranslationRetentionWriteDirty = false;
  pdfDocumentTranslationRetentionPending = false;
  pdfDocumentTranslationRetentionMessage = undefined;
  pdfDocumentTranslationRetentionError = false;
  pdfDocumentTranslationSavesInFlight = 0;
  pdfDocumentTranslationTask = undefined;
  pdfDocumentTranslationSessionContext = undefined;
  pdfDocumentTranslationViewMode = 'compare';
  pdfDocumentTranslationDisplayedPage = 0;
  pdfDocumentTranslationReadingScrollTop = 0;
  documentTranslationSettings.open = true;
  resetPdfDocumentTranslationScope();
  documentTranslationPages.replaceChildren();
  if (closePanel) documentTranslationPanel.hidden = true;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
}

function mergePdfFormulaReviewMessage(previous: string | undefined, doc: FormulaDocument | undefined): string {
  // Keep the saved warning byte-for-byte so unchanged results retain review confirmation.
  // Newly discovered issues still invalidate confirmation and remain visible.
  const existing = `；${previous ?? ''}；`;
  const added = doc ? formulaDocumentIssues(doc).filter((issue) => !existing.includes(`；${issue}；`)) : [];
  return [previous, ...added].filter(Boolean).join('；');
}

function reviewRestoredPdfTranslationProse(block: PdfDocumentTranslationRuntimeBlock): void {
  // A saved fallback contains the app's source copy, not necessarily a model
  // echo. Its original cause must not be invented during restoration.
  if (block.referencePreserved || block.visualFallbackMessage) return;
  const outcome = pdfBackgroundTextOutcome(block, block.translatedText ?? '', pdfDocumentTranslationSettings.targetLanguage);
  if (outcome.visualFallbackMessage && !block.visualFallbackMessage?.includes(outcome.visualFallbackMessage)) {
    block.visualFallbackMessage = [block.visualFallbackMessage, outcome.visualFallbackMessage].filter(Boolean).join('；');
  }
  if (outcome.formulaReviewMessage && !block.formulaReviewMessage?.includes(outcome.formulaReviewMessage)) {
    block.formulaReviewMessage = [block.formulaReviewMessage, outcome.formulaReviewMessage].filter(Boolean).join('；');
    if (!block.formulaDocument) block.formulaReviewDraft = true;
  }
}

async function preparePdfDocumentTranslation(): Promise<void> {
  const pdf = pdfDocument;
  if (!pdf || pdfDocumentTranslationPhase === 'preparing') return;
  const revision = ++pdfDocumentTranslationRevision;
  const epoch = documentEpoch;
  pdfDocumentTranslationPhase = 'preparing';
  pdfDocumentTranslationMessage = '正在本地读取文字层…';
  pdfDocumentTranslationBlocksState = [];
  pdfDocumentTranslationArchivedBlocks = [];
  pdfDocumentTranslationSessionContext = undefined;
  pdfDocumentTranslationUnreadablePages = 0;
  pdfDocumentTranslationUnreadablePageNumbers = [];
  pdfDocumentTranslationMultiColumnPages = 0;
  pdfDocumentTranslationRemovedMarginLines = 0;
  documentTranslationPages.replaceChildren();
  documentTranslationSettings.open = true;
  element<HTMLDetailsElement>('pdf-document-options-more').open = false;
  syncPdfDocumentTranslationUi();
  const pages: PdfDocumentTranslationPageInput[] = [];
  if(currentPdfContentFingerprint){
    try{
      const recovered=await readPdfOcrSession(currentPdfContentFingerprint,pdf.numPages);
      if(revision!==pdfDocumentTranslationRevision||epoch!==documentEpoch)return;
      for(const page of recovered)if(!temporaryOcrPages.has(page.pageNumber)){
        temporaryOcrPages.set(page.pageNumber,page);updatePdfSearchIndexFromTemporaryOcrPage(page.pageNumber,page);
        const element=viewer.querySelector<HTMLElement>(`.pdf-page[data-page-number="${page.pageNumber}"]`);
        if(element&&renderTemporaryOcrTextLayer(element,page))element.dataset.hasText='true';
      }
    }catch{showNotice('临时识别结果未能恢复；当前窗口已有内容不变，可稍后重试。',{tone:'error'})}
  }
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (
      revision !== pdfDocumentTranslationRevision ||
      epoch !== documentEpoch ||
      pdfDocument !== pdf
    ) return;
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const braceMetrics = viewport.rotation === 0
        ? await pdfLeftBraceGlyphMetrics(page, content, (await loadPdfRuntime()).OPS) : new Map();
      const mathFonts=viewport.rotation===0?await pdfNativeMathFontHints(page,content,(await loadPdfRuntime()).OPS):new Map();
      let items: PdfDocumentTranslationTextItem[] = content.items.flatMap((item) => {
        if (!('str' in item) || typeof item.str !== 'string') return [];
        const text = item.str.trim();
        if (!text) return [];
        if (viewport.rotation % 180 !== 0) {
          return [{ str: item.str, hasEOL: item.hasEOL }];
        }
        const baseline = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const height = Math.max(
          Math.abs(item.height),
          Math.hypot(item.transform[2], item.transform[3]) * viewport.scale,
        );
        const width = Math.abs(item.width) * viewport.scale;
        return [{
          str: item.str,
          hasEOL: item.hasEOL,
          ...(mathFonts.has(item)?{mathFont:mathFonts.get(item)!}:{}),
          ...(Number.isFinite(baseline[0]) && Number.isFinite(baseline[1]) &&
            Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
            ? {
                left: baseline[0],
                top: baseline[1] - height,
                width,
                height,
                descent: Math.max(0, -(content.styles[item.fontName]?.descent ?? 0)) * height,
                ...(braceMetrics.has(item) ? {leftBraceInkBounds: {
                  top: baseline[1] - braceMetrics.get(item)!.ascent * height,
                  bottom: baseline[1] + braceMetrics.get(item)!.descent * height,
                }} : {}),
              }
            : {}),
        }];
      });
      if (!items.length) {
        const temporaryOcrPage = temporaryOcrPages.get(pageNumber);
        if (temporaryOcrPage) {
          items = pdfDocumentTranslationItemsFromOcr(
            temporaryOcrPage,
            viewport.width,
            viewport.height,
          );
        }
      }
      pages.push({
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        items,
      });
    } catch {
      // Missing pages are identified after the local preparation pass.
    }
    if (pageNumber % 4 === 0 || pageNumber === pdf.numPages) {
      pdfDocumentTranslationMessage = `正在本地读取文字层 · ${pageNumber}/${pdf.numPages} 页`;
      syncPdfDocumentTranslationUi();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  if (revision !== pdfDocumentTranslationRevision || epoch !== documentEpoch) return;
  const prepared = preparePdfDocumentTranslationPages(pages);
  pdfDocumentTranslationPageInputs=pages;
  const sections = classifyPdfDocumentTranslationSections(prepared.blocks);
  const signatureOccurrences = new Map<string, number>();
  const discovered: PdfDocumentTranslationRuntimeBlock[] = prepared.blocks.map((block, index) => {
    const occurrenceKey = `${block.pageNumber}\u0000${block.text}`;
    const occurrence = signatureOccurrences.get(occurrenceKey) ?? 0;
    signatureOccurrences.set(occurrenceKey, occurrence + 1);
    return {
      ...block,
      sessionSignature: pdfDocumentTranslationSessionBlockSignature(
        block.pageNumber,
        block.text,
        occurrence,
      ),
      section: sections[index] ?? 'body',
      ...(pdfDocumentTranslationReferenceEntryStaysOriginal(
        block.text,
        sections[index] ?? 'body',
      ) ? { referencePreserved: true } : {}),
      included: true,
      status: 'idle' as const,
    };
  });
  const readablePageNumbers = new Set(prepared.blocks.flatMap((block) => [block.pageNumber,
    ...pdfDocumentTranslationSourceRegions(block).map((region) => region.pageNumber)]));
  pdfDocumentTranslationUnreadablePageNumbers = Array.from(
    { length: pdf.numPages },
    (_, index) => index + 1,
  ).filter((pageNumber) => !readablePageNumbers.has(pageNumber));
  pdfDocumentTranslationUnreadablePages = pdfDocumentTranslationUnreadablePageNumbers.length;
  pdfDocumentTranslationMultiColumnPages = prepared.multiColumnPages;
  pdfDocumentTranslationRemovedMarginLines = prepared.removedRepeatedMarginLines;
  pdfDocumentTranslationBlocksState = discovered;
  documentTranslationCustomPages.value = pdf.numPages > 1 ? `1-${pdf.numPages}` : '1';
  const initialContext = currentPdfDocumentTranslationSessionContext();
  if (initialContext) {
    try {
      const plan = await getPdfDocumentTranslationPlan(initialContext.descriptor);
      if (revision !== pdfDocumentTranslationRevision || epoch !== documentEpoch) return;
      if (plan && plan.pages.every(page => page <= pdf.numPages)) {
        pdfDocumentTranslationRangeMode = plan.mode;
        pdfDocumentTranslationRangePages = [...plan.pages];
        const parsed = plan.pages.length ? parsePdfDocumentPageRange(plan.pages.join(','), pdf.numPages) : undefined;
        pdfDocumentTranslationRangeSummary = parsed?.ok ? parsed.summary : '';
        documentTranslationRange.value = plan.mode;
        documentTranslationCustomRange.hidden = plan.mode !== 'custom';
        if (plan.pages.length) documentTranslationCustomPages.value = plan.pages.join(',');
        pdfDocumentTranslationSkipReferencesEnabled = plan.skipReferences;
        pdfDocumentTranslationSkipAppendixEnabled = plan.skipAppendix;
        documentTranslationSkipReferences.checked = plan.skipReferences;
        documentTranslationSkipAppendix.checked = plan.skipAppendix;
        pdfDocumentTranslationMultimodalEnabled = plan.multimodal;
        documentTranslationMultimodalToggle.checked = plan.multimodal;
        documentRequestLimit.value = String(plan.requestLimit);
        discovered.forEach(block => {block.included = pdfDocumentTranslationBlockInScope(block)});
      }
    } catch {
      // Local task choices do not authorize requests or prevent fresh preview.
    }
  }
  const sessionContext = currentPdfDocumentTranslationSessionContext();
  pdfDocumentTranslationSessionContext = sessionContext;
  let restoredCount = 0;
  let restoredFromLocalCount = 0;
  if (sessionContext) {
    try {
      const [restored, retained] = await Promise.all([
        getPdfDocumentTranslationSession(
          sessionContext.descriptor,
          sessionContext.behaviorKey,
        ),
        getRetainedPdfDocumentTranslationSession(
          sessionContext.descriptor,
          sessionContext.behaviorKey,
        ),
      ]);
      if (
        revision !== pdfDocumentTranslationRevision ||
        epoch !== documentEpoch ||
        !samePdfDocumentTranslationSessionContext(
          sessionContext,
          currentPdfDocumentTranslationSessionContext(),
        )
      ) return;
      const signatures = discovered.map(block => block.sessionSignature);
      pdfDocumentTranslationRetainedLocally = Boolean(retained && (pdfTranslationSourceCompatible(retained, signatures, currentPdfContentFingerprint) || reusablePdfTranslationBlocks(retained, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).length));
      const retainedBySignature = new Map(reusablePdfTranslationBlocks(retained, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).map(block => [block.signature, block]));
      const sessionBySignature = new Map(reusablePdfTranslationBlocks(restored, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).map(block => [block.signature, block]));
      pdfDocumentTranslationArchivedBlocks = [...new Map([restored, retained].filter(record => record !== undefined)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .flatMap(record => archivedPdfTranslationBlocks(record, signatures, currentPdfContentFingerprint))
        .map(block => [block.signature, block])).values()];
      for (const block of discovered) {
        const fromSession = sessionBySignature.get(block.sessionSignature);
        const fromLocal = retainedBySignature.get(block.sessionSignature);
        const saved = (retained?.updatedAt ?? 0) > (restored?.updatedAt ?? 0)
          ? fromLocal ?? fromSession : fromSession ?? fromLocal;
        const translatedText = saved?.translatedText.trim();
        if (!translatedText) continue;
        const formulaDocument = saved?.formulaDocument && bindPdfEquationNumbers(saved.formulaDocument, block.sourceEquations);
        const review = mergePdfFormulaReviewMessage(saved?.formulaReviewMessage, formulaDocument);
        block.status = saved?.retranslation?'idle':'done';
        if(saved?.retranslation)block.retranslation=true;
        if(saved?.manualCorrection)block.manualCorrection=true;
        if(saved?.revisions)block.revisions=saved.revisions;
        if(!saved?.pageNumber)block.omitReadingMetadata=true;
        block.translatedText = formulaDocument ? formulaDocumentText(formulaDocument) : translatedText;
        if (review) block.formulaReviewMessage = review;
        if (saved?.reviewConfirmation) block.reviewConfirmation = saved.reviewConfirmation;
        if (saved?.formulaReviewDraft) block.formulaReviewDraft = true;
        if (formulaDocument) block.formulaDocument = formulaDocument;
        if (saved?.visualFallbackMessage) block.visualFallbackMessage = saved.visualFallbackMessage;
        reviewRestoredPdfTranslationProse(block);
        if (pdfDocumentTranslationUsesUnifiedVision() &&
            !block.formulaReviewMessage && !block.visualFallbackMessage) block.visualProcessed = true;
        restoredCount += 1;
        if (!fromSession && fromLocal) restoredFromLocalCount += 1;
        renderPdfDocumentTranslationBlock(block);
      }
    } catch {
      // A storage failure must not prevent a fresh full-document translation.
    }
  }
  if (restoredCount) preservePdfDocumentTranslationReferenceEntries();
  const scoped = scopedPdfDocumentTranslationBlocks();
  const restoredInScope = scoped.filter(block => block.status === 'done').length;
  pdfDocumentTranslationMessage = restoredInScope
    ? restoredInScope === scoped.length
      ? `${restoredFromLocalCount ? '已从本机恢复' : '已恢复'} ${restoredInScope}/${scoped.length} 段，无需重复翻译`
      : `${restoredFromLocalCount ? '已从本机恢复' : '已恢复'} ${restoredInScope}/${scoped.length} 段，可继续翻译`
    : undefined;
  pdfDocumentTranslationPhase = scoped.length
    ? restoredInScope === scoped.length
      ? 'complete'
      : restoredInScope > 0
        ? 'paused'
        : 'ready'
    : 'error';
  if (restoredCount) documentTranslationSettings.open = false;
  if (!discovered.length) {
    pdfDocumentTranslationMessage = pdfDocumentTranslationUnreadablePages
      ? '没有读取到文字层；可在下方确认识别扫描页。'
      : '没有读取到可翻译正文。';
  }
  syncPdfDocumentTranslationUi();
  restorePdfTranslationReadingAnchor();
  if (pdfDocumentTranslationRetainedLocally && !libraryRestoreId) {
    void persistPdfDocumentTranslationSession(
      pdfDocumentTranslationBlocksState.filter((block) => block.status === 'done'),
      true,
    );
  }
}

async function capturePdfDocumentTranslationOcrPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<{
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
  captureMs: number;
}> {
  const startedAt = performance.now();
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.25, Math.max(
    0.5,
    1_800 / Math.max(baseViewport.width, baseViewport.height, 1),
  ));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('当前浏览器无法生成 OCR 页面图像。');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return {
    imageDataUrl: canvas.toDataURL('image/jpeg', .84),
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    pageWidth: baseViewport.width,
    pageHeight: baseViewport.height,
    captureMs: Math.max(0, performance.now() - startedAt),
  };
}

async function capturePdfDocumentTranslationVisualBlock(
  pdf: PDFDocumentProxy, block: PdfDocumentTranslationRuntimeBlock,
  options: { maxEdge?: number; maxBytes?: number } = {},
) {
  return capturePdfVisualRegions(pdf, pdfDocumentTranslationSourceRegions(block), options);
}

function addPdfDocumentTranslationOcrPage(
  page: CoordinateOcrPage,
  pageWidth: number,
  pageHeight: number,
): number {
  const items = pdfDocumentTranslationItemsFromOcr(page, pageWidth, pageHeight);
  const input={
    pageNumber: page.pageNumber,
    pageWidth,
    pageHeight,
    items,
  };
  if(!preparePdfDocumentTranslationPages([input]).blocks.length)return 0;
  const oldContext=pdfDocumentTranslationSessionContext;
  const oldSaved=(oldContext?pdfDocumentTranslationSessionUpdate(oldContext,pdfDocumentTranslationBlocksState).blocks:[])??[];
  const previous=new Map(pdfDocumentTranslationBlocksState.map(block=>[block.sessionSignature,block]));
  pdfDocumentTranslationPageInputs=[...pdfDocumentTranslationPageInputs.filter(value=>value.pageNumber!==page.pageNumber),input].sort((a,b)=>a.pageNumber-b.pageNumber);
  const prepared=preparePdfDocumentTranslationPages(pdfDocumentTranslationPageInputs);
  const signatureOccurrences = new Map<string, number>();
  const added: PdfDocumentTranslationRuntimeBlock[] = prepared.blocks.map((block) => {
    const occurrenceKey = `${block.pageNumber}\u0000${block.text}`;
    const occurrence = signatureOccurrences.get(occurrenceKey) ?? 0;
    signatureOccurrences.set(occurrenceKey, occurrence + 1);
    const signature=pdfDocumentTranslationSessionBlockSignature(block.pageNumber,block.text,occurrence);
    return {
      ...(previous.get(signature)??{}),
      ...block,
      sessionSignature: signature,
      section: 'body',
      included: true,
      status: previous.get(signature)?.status??'idle',
    };
  });
  const signatures=new Set(added.map(block=>block.sessionSignature));
  const archived=new Map(pdfDocumentTranslationArchivedBlocks.map(block=>[block.signature,block]));
  for(const block of oldSaved)if(!signatures.has(block.signature))archived.set(block.signature,block);
  pdfDocumentTranslationArchivedBlocks=[...archived.values()].filter(block=>!signatures.has(block.signature));
  pdfDocumentTranslationBlocksState=added;
  const sections = classifyPdfDocumentTranslationSections(pdfDocumentTranslationBlocksState);
  pdfDocumentTranslationBlocksState.forEach((block, index) => {
    block.section = sections[index] ?? 'body';
    if (pdfDocumentTranslationReferenceEntryStaysOriginal(block.text, block.section)) {
      block.referencePreserved = true;
    } else {
      delete block.referencePreserved;
    }
    block.included = pdfDocumentTranslationBlockInScope(block);
  });
  rebuildPdfDocumentTranslationResults();
  return added.length;
}

async function restorePdfDocumentTranslationIdleBlocks(): Promise<{
  restored: number;
  fromLocal: number;
}> {
  const context = pdfDocumentTranslationSessionContext;
  if (!context) return { restored: 0, fromLocal: 0 };
  try {
    const [session, retained] = await Promise.all([
      getPdfDocumentTranslationSession(context.descriptor, context.behaviorKey),
      getRetainedPdfDocumentTranslationSession(context.descriptor, context.behaviorKey),
    ]);
    if (!samePdfDocumentTranslationSessionContext(
      context,
      currentPdfDocumentTranslationSessionContext(),
    )) return { restored: 0, fromLocal: 0 };
    const signatures = pdfDocumentTranslationBlocksState.map(block => block.sessionSignature);
    if (retained && (pdfTranslationSourceCompatible(retained, signatures, currentPdfContentFingerprint) || reusablePdfTranslationBlocks(retained, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).length)) pdfDocumentTranslationRetainedLocally = true;
    const sessionBySignature = new Map(reusablePdfTranslationBlocks(session, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).map(block => [block.signature, block]));
    const retainedBySignature = new Map(reusablePdfTranslationBlocks(retained, signatures, currentPdfContentFingerprint, {allowUpdatedDocument:!libraryRestoreId}).map(block => [block.signature, block]));
    let restored = 0;
    let fromLocal = 0;
    for (const block of pdfDocumentTranslationBlocksState) {
      if (block.status !== 'idle'||block.retranslation) continue;
      const currentSessionText = sessionBySignature.get(block.sessionSignature);
      const localText = retainedBySignature.get(block.sessionSignature);
      const saved = (retained?.updatedAt ?? 0) > (session?.updatedAt ?? 0)
        ? localText ?? currentSessionText : currentSessionText ?? localText;
      const translatedText = saved?.translatedText.trim();
      if (!translatedText) continue;
      const formulaDocument = saved?.formulaDocument && bindPdfEquationNumbers(saved.formulaDocument, block.sourceEquations);
      const review = mergePdfFormulaReviewMessage(saved?.formulaReviewMessage, formulaDocument);
      block.status = saved?.retranslation?'idle':'done';
      if(saved?.retranslation)block.retranslation=true;
      if(saved?.manualCorrection)block.manualCorrection=true;
      if(saved?.revisions)block.revisions=saved.revisions;
        if(!saved?.pageNumber)block.omitReadingMetadata=true;
      block.translatedText = formulaDocument ? formulaDocumentText(formulaDocument) : translatedText;
      if (review) block.formulaReviewMessage = review;
      else delete block.formulaReviewMessage;
      if (saved?.reviewConfirmation) block.reviewConfirmation = saved.reviewConfirmation;
      else delete block.reviewConfirmation;
      if (saved?.formulaReviewDraft) block.formulaReviewDraft = true;
      else delete block.formulaReviewDraft;
      if (formulaDocument) block.formulaDocument = formulaDocument;
      else delete block.formulaDocument;
      if (saved?.visualFallbackMessage) block.visualFallbackMessage = saved.visualFallbackMessage;
      else delete block.visualFallbackMessage;
      reviewRestoredPdfTranslationProse(block);
      if (pdfDocumentTranslationUsesUnifiedVision() &&
          !block.formulaReviewMessage && !block.visualFallbackMessage) block.visualProcessed = true;
      restored += 1;
      if (!currentSessionText && localText) fromLocal += 1;
      renderPdfDocumentTranslationBlock(block);
    }
    return { restored, fromLocal };
  } catch {
    return { restored: 0, fromLocal: 0 };
  }
}

function settlePdfDocumentTranslationAfterOcr(previousPhase: PdfDocumentTranslationPhase): void {
  const scoped = scopedPdfDocumentTranslationBlocks();
  const hasPending = scoped.some((block) => block.status === 'idle');
  const hasTranslated = scoped.some((block) => block.status === 'done');
  if (!scoped.length) {
    pdfDocumentTranslationPhase = 'error';
  } else if (!hasPending && scoped.every((block) => block.status === 'done')) {
    pdfDocumentTranslationPhase = 'complete';
  } else if (previousPhase === 'stopped') {
    pdfDocumentTranslationPhase = 'stopped';
  } else if (hasTranslated || ['paused', 'complete'].includes(previousPhase)) {
    pdfDocumentTranslationPhase = 'paused';
  } else {
    pdfDocumentTranslationPhase = 'ready';
  }
}

function stopPdfDocumentTranslationOcr(): void {
  if (!pdfDocumentTranslationOcrRunning) return;
  pdfDocumentTranslationOcrRevision += 1;
  cancelPdfDocumentTranslationOcrRequest();
  pdfDocumentTranslationOcrRunning = false;
  pdfDocumentTranslationMultimodalAuthorized = false;
  pdfDocumentTranslationOcrMessage = '识别已停止；成功页面已保留，可继续识别剩余页面。';
  pdfDocumentTranslationMessage = pdfDocumentTranslationOcrMessage;
  pdfDocumentTranslationOcrError = false;
  syncPdfDocumentTranslationUi();
}

async function recognizePdfDocumentTranslationPages(): Promise<void> {
  if (pdfDocumentTranslationOcrRunning) {
    stopPdfDocumentTranslationOcr();
    return;
  }
  const pdf = pdfDocument;
  const targets = pdfDocumentTranslationUnreadablePagesInScope();
  if (!pdf || !targets.length || pdfDocumentTranslationPhase === 'preparing') return;
  const revision = ++pdfDocumentTranslationOcrRevision;
  const epoch = documentEpoch;
  const previousPhase = pdfDocumentTranslationPhase;
  pdfDocumentTranslationOcrRunning = true;
  pdfDocumentTranslationOcrProgress = { completed: 0, total: targets.length };
  pdfDocumentTranslationOcrMessage = undefined;
  pdfDocumentTranslationOcrError = false;
  syncPdfDocumentTranslationUi();
  let recognizedPages = 0;
  let failedPages = 0;
  let latestError: string | undefined;
  let budgetError: string | undefined;
  for (const [index, pageNumber] of targets.entries()) {
    if (
      revision !== pdfDocumentTranslationOcrRevision ||
      epoch !== documentEpoch ||
      pdfDocument !== pdf
    ) return;
    pdfDocumentTranslationOcrProgress = { completed: index, total: targets.length };
    syncPdfDocumentTranslationUi();
    try {
      const capture = await capturePdfDocumentTranslationOcrPage(pdf, pageNumber);
      if (revision !== pdfDocumentTranslationOcrRevision || epoch !== documentEpoch) return;
      const requestId = crypto.randomUUID();
      pdfDocumentTranslationOcrRequestId = requestId;
      takePdfTaskRequest('ocr');
      const response = await browser.runtime.sendMessage({
        type: 'RECOGNIZE_PDF_PAGE',
        payload: {
          requestId,
          imageDataUrl: capture.imageDataUrl,
          imageWidth: capture.imageWidth,
          imageHeight: capture.imageHeight,
          pageNumber,
          clientPerformance: { captureMs: capture.captureMs },
        },
      } satisfies RuntimeMessage) as RecognizePdfPageResponse;
      if (
        revision !== pdfDocumentTranslationOcrRevision ||
        epoch !== documentEpoch ||
        pdfDocument !== pdf
      ) return;
      pdfDocumentTranslationOcrRequestId = undefined;
      if (!response.ok) {
        latestError = translationErrorMessage(response.error.code, response.error.message);
        failedPages += 1;
        const recovery = translationErrorRecovery(
          response.error.code,
          response.error.retryable,
          'vision',
        );
        if (recovery.settingsFocus) {
          showNotice(latestError, {
            tone: 'error',
            action: {
              label: recovery.settingsLabel ?? '检查图像 API',
              onClick: () => { void openPdfSettings(recovery.settingsFocus); },
            },
          });
          break;
        }
        continue;
      }
      const page = response.data.page;
      const added = addPdfDocumentTranslationOcrPage(
        page,
        capture.pageWidth,
        capture.pageHeight,
      );
      if (!added) throw new Error('OCR 没有返回足够可靠的正文，请调整后重试。');
      temporaryOcrPages.set(pageNumber, page);
      if(currentPdfContentFingerprint){
        try{await savePdfOcrSessionPage(currentPdfContentFingerprint,pdf.numPages,page)}
        catch{showNotice('识别结果在当前窗口可用，但临时保存失败；关闭后可能需要重新识别。',{tone:'error'})}
        if(revision!==pdfDocumentTranslationOcrRevision||epoch!==documentEpoch)return;
      }
      updatePdfSearchIndexFromTemporaryOcrPage(pageNumber, page);
      const pageElement = viewer.querySelector<HTMLElement>(
        `.pdf-page[data-page-number="${pageNumber}"]`,
      );
      if (pageElement) {
        const lineCount = renderTemporaryOcrTextLayer(pageElement, page);
        if (lineCount) pageElement.dataset.hasText = 'true';
      }
      pdfDocumentTranslationUnreadablePageNumbers =
        pdfDocumentTranslationUnreadablePageNumbers.filter((value) => value !== pageNumber);
      pdfDocumentTranslationUnreadablePages = pdfDocumentTranslationUnreadablePageNumbers.length;
      recognizedPages += 1;
    } catch (error) {
      latestError = error instanceof Error ? error.message : '页面识别失败。';
      if (error && typeof error === 'object' && 'code' in error && error.code === 'REQUEST_BUDGET_REACHED') {
        budgetError = latestError;
        break;
      }
      failedPages += 1;
    } finally {
      pdfDocumentTranslationOcrRequestId = undefined;
      pdfDocumentTranslationOcrProgress = { completed: index + 1, total: targets.length };
      syncPdfDocumentTranslationUi();
    }
  }
  if (revision !== pdfDocumentTranslationOcrRevision || epoch !== documentEpoch) return;
  pdfDocumentTranslationOcrRunning = false;
  const nextSessionContext = currentPdfDocumentTranslationSessionContext();
  if (!samePdfDocumentTranslationSessionContext(
    pdfDocumentTranslationSessionContext,
    nextSessionContext,
  )) {
    for (const block of pdfDocumentTranslationBlocksState) {
      if (block.status !== 'done') continue;
      block.status = 'idle';
      delete block.translatedText;
      delete block.visualProcessed;
      delete block.visualFallbackMessage;
      delete block.formulaReviewMessage;
      delete block.formulaReviewDraft;
      delete block.formulaDocument;
    }
    pdfDocumentTranslationSessionContext = nextSessionContext;
    // OCR changes the block signatures, not the user's choice to retain this document.
    rebuildPdfDocumentTranslationResults();
  }
  const restoredAfterOcr = await restorePdfDocumentTranslationIdleBlocks();
  if (revision !== pdfDocumentTranslationOcrRevision || epoch !== documentEpoch) return;
  settlePdfDocumentTranslationAfterOcr(previousPhase);
  if (budgetError) {
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMultimodalAuthorized = false;
  }
  pdfDocumentTranslationOcrError = failedPages > 0;
  pdfDocumentTranslationOcrMessage = failedPages
    ? `${recognizedPages ? `已识别 ${recognizedPages} 页；` : ''}${failedPages} 页未识别${latestError ? `：${latestError}` : ''}`
    : undefined;
  pdfDocumentTranslationMessage = restoredAfterOcr.restored
    ? `${restoredAfterOcr.fromLocal ? '已从本机恢复' : '已恢复'} ${restoredAfterOcr.restored} 段扫描页译文`
    : recognizedPages
      ? `扫描页已加入正文 · 新增 ${recognizedPages} 页`
    : pdfDocumentTranslationMessage;
  if (budgetError) pdfDocumentTranslationMessage = budgetError;
  syncPdfDocumentTranslationUi();
  void persistPdfDocumentTranslationSession(
    pdfDocumentTranslationBlocksState.filter((block) => block.status === 'done'),
  );
}

const foregroundVisualUnits = new WeakMap<PdfDocumentTranslationRuntimeBlock, PdfBackgroundTranslationOutcome[]>();

async function processPdfDocumentTranslationVisualBlock(
  block: PdfDocumentTranslationRuntimeBlock,
  revision: number,
  includeContext = true,
  bypassCache = false,
): Promise<boolean> {
  const pdf = pdfDocument;
  const containsFormula = pdfDocumentTranslationBlockContainsFormula(block);
  if (!pdf || !pdfDocumentTranslationSourceRegions(block).length) {
    delete block.formulaReviewMessage;
    delete block.formulaReviewDraft;
    delete block.formulaDocument;
    if (containsFormula) {
      block.status = 'done';
      block.translatedText = block.text;
      block.visualFallbackMessage = '含公式段落缺少可靠的原文位置';
    } else {
      block.status = 'error';
      block.errorMessage = '本段缺少可靠的视觉定位，未改用文字接口。';
    }
    delete block.visualProcessed;
    renderPdfDocumentTranslationBlock(block);
    syncPdfDocumentTranslationUi();
    if (block.status === 'done') await persistPdfDocumentTranslationSession([block]);
    return true;
  }
  const requestId = crypto.randomUUID();
  pdfDocumentTranslationRequestId = requestId;
  block.status = 'translating';
  if(!block.translatedText){
    delete block.formulaReviewMessage;
    delete block.formulaReviewDraft;
    delete block.formulaDocument;
    delete block.visualFallbackMessage;
    delete block.visualProcessed;
  }
  renderPdfDocumentTranslationBlock(block);
  syncPdfDocumentTranslationUi();
  let response: TranslateRuntimeResponse | undefined;
  const units = block.visualUnits ?? [{ text: block.text, sourceRegions: pdfDocumentTranslationSourceRegions(block),
    ...(block.sourceFontHints ? {sourceFontHints:block.sourceFontHints}:{}),
    ...(block.sourceEquations ? { sourceEquations: block.sourceEquations } : {}),
    equationNumbers: [...(block.equationNumbers ?? [])] }];
  const completed = foregroundVisualUnits.get(block) ?? [];
  foregroundVisualUnits.set(block, completed);
  try {
    while (completed.length < units.length) {
    const unit = units[completed.length]!;
    const capture = await capturePdfVisualRegions(pdf, unit.sourceRegions);
    if (
      revision !== pdfDocumentTranslationRevision ||
      pdfDocumentTranslationRequestId !== requestId
    ) return false;
    const first = unit.sourceRegions[0];
    const sourceLocation = first ? { documentId: currentDocumentSessionId, pageNumber: first.pageNumber, ...first.sourceAnchor } : undefined;
    const contextText = units.length > 1 ? pdfVisualUnitContext(units, completed.length, includeContext ? pdfDocumentTranslationContext(block) : undefined)
      : includeContext ? pdfDocumentTranslationContext(block) : undefined;
    takePdfTaskRequest('vision');
    response = await browser.runtime.sendMessage({
      type: 'TRANSLATE_PDF_DOCUMENT_VISUAL_BLOCK',
      payload: {
        requestId,
        documentId: currentReadingIdentity ?? currentDocumentSessionId,
        ...(bypassCache ? { bypassCache: true } : {}),
        imageDataUrl: capture.imageDataUrl,
        imageWidth: capture.imageWidth,
        imageHeight: capture.imageHeight,
        visualPurpose: pdfDocumentTranslationVisualPurpose(block),
        recognizedTextHint: pdfFontHintText(unit.text,unit.sourceFontHints),
        ...(unit.sourceEquations ? { sourceEquations: unit.sourceEquations } : {}),
        ...(contextText ? { contextText } : {}),
        pageUrl: currentSourceUrl,
        ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}),
        targetLanguage: pdfDocumentTranslationSettings.targetLanguage,
        sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
        style: pdfDocumentTranslationSettings.style,
        ...(sourceLocation ? { sourceLocation } : {}),
        clientPerformance: { captureMs: capture.captureMs },
      },
    } satisfies RuntimeMessage) as TranslateRuntimeResponse;
    if(revision!==pdfDocumentTranslationRevision||pdfDocumentTranslationRequestId!==requestId)return false;
    if (!response.ok) break;
    if (!response.data.result.cached) addPdfReportedTokens(pdfRequestUsage, response.data.result.usage, response.data.result.usageSource);
    let repairNote:string|undefined;
    if(pdfDocumentTranslationPhase==='running'&&preparePdfFormulaProseRepair(response.data.result.formulaDocument,pdfDocumentTranslationSettings.targetLanguage)){
      let repairAuthorized=true;
      try{takePdfTaskRequest('text')}catch{repairAuthorized=false;repairNote='任务请求上限不足，未发送正文修复。'}
      if(repairAuthorized){
        const repaired=await browser.runtime.sendMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{requestId,document:response.data.result.formulaDocument!,targetLanguage:pdfDocumentTranslationSettings.targetLanguage,sourceLanguage:pdfDocumentTranslationSettings.sourceLanguage,style:pdfDocumentTranslationSettings.style}} satisfies RuntimeMessage) as TranslateRuntimeResponse;
        if(revision!==pdfDocumentTranslationRevision||pdfDocumentTranslationRequestId!==requestId)return false;
        if(repaired.ok){response=repaired;addPdfReportedTokens(pdfRequestUsage,repaired.data.result.usage,repaired.data.result.usageSource)}else repairNote=`正文修复未完成：${translationErrorMessage(repaired.error.code,repaired.error.message)}`;
      }
    }
    const equationNumbers = block.visualUnits ? unit.equationNumbers : block.equationNumbers;
    const outcome=pdfBackgroundVisualOutcome({ id: block.id, text: unit.text, ...(equationNumbers ? { equationNumbers } : {}),
      ...(unit.sourceFontHints?{sourceFontHints:unit.sourceFontHints}:{}),
      ...(unit.sourceEquations ? { sourceEquations: unit.sourceEquations } : {}),
      containsFormula, visualPurpose: pdfDocumentTranslationVisualPurpose(block) }, response.data.result,
    pdfDocumentTranslationSettings.targetLanguage);
    if(repairNote)outcome.formulaReviewMessage=[outcome.formulaReviewMessage,repairNote].filter(Boolean).join('；').slice(0,1800);
    completed.push(outcome);
    if (revision !== pdfDocumentTranslationRevision || pdfDocumentTranslationRequestId !== requestId) return false;
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'REQUEST_BUDGET_REACHED') {
      block.status = 'idle';
      pdfDocumentTranslationRequestId = undefined;
      renderPdfDocumentTranslationBlock(block);
      return false;
    }
    response = {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'PDF 多模态翻译请求失败。',
        retryable: true,
      },
    };
  }
  if (
    revision !== pdfDocumentTranslationRevision ||
    pdfDocumentTranslationRequestId !== requestId
  ) return false;
  pdfDocumentTranslationRequestId = undefined;
  if (response && !response.ok && response.error.code === 'REQUEST_ABORTED') {
    block.status = 'idle';
    renderPdfDocumentTranslationBlock(block);
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = '其他划词或框选翻译已优先处理，全文翻译可继续。';
    syncPdfDocumentTranslationUi();
    return false;
  }
  if (response && !response.ok) {
    block.status = 'idle';
    renderPdfDocumentTranslationBlock(block);
    pdfDocumentTranslationPhase = 'error';
    pdfDocumentTranslationMessage = translationErrorMessage(
      response.error.code,
      response.error.message,
    );
    syncPdfDocumentTranslationUi();
    return false;
  }
  const outcome = combinePdfVisualOutcomes(block.id, completed);
  foregroundVisualUnits.delete(block);
  applyPdfTranslationOutcome(block,outcome);
  renderPdfDocumentTranslationBlock(block);
  await persistPdfDocumentTranslationSession([block]);
  pdfDocumentTranslationMessage = block.visualFallbackMessage
    ? '部分多模态结果未通过校验，已保留原文并继续翻译。'
    : undefined;
  syncPdfDocumentTranslationUi();
  return true;
}

function pdfDocumentTranslationContext(block: PdfDocumentTranslationRuntimeBlock): string | undefined {
  const index = pdfDocumentTranslationBlocksState.indexOf(block);
  const continuity = pdfDocumentTranslationContinuity(pdfDocumentTranslationBlocksState, index);
  const previous = continuity.previousIndex === undefined
    ? undefined
    : pdfDocumentTranslationBlocksState[continuity.previousIndex];
  const next = continuity.nextIndex === undefined
    ? undefined
    : pdfDocumentTranslationBlocksState[continuity.nextIndex];
  const relationship = [
    continuity.continuesPrevious
      ? '本块承接上一连续块中尚未结束的句子；只翻译当前块，不得重复上一块。'
      : '',
    continuity.continuesNext
      ? '当前句在下一连续块中继续；不得提前补写下一块。'
      : '',
    continuity.skippedBefore || continuity.skippedAfter
      ? '连续正文之间夹有图注、表格或代码等版式结构；这些结构不代表句子自动结束。'
      : '',
  ].filter(Boolean).join(' ');
  const parts = [
    documentName.textContent ? `文档：${documentName.textContent.slice(0, 120)}` : '',
    relationship ? `阅读衔接：${relationship}` : '',
    previous?.text ? `上一连续块原文：${previous.text.slice(-280)}` : '',
    previous?.translatedText && !previous.formulaReviewMessage && !previous.visualFallbackMessage
      ? `上一连续块译文：${previous.translatedText.slice(-340)}` : '',
    next?.text ? `下一连续块原文：${next.text.slice(0, 280)}` : '',
  ].filter(Boolean);
  const context = parts.join('\n').slice(-1_200).trim();
  return context || undefined;
}

function pdfDocumentTranslationContinuityPrerequisite(
  preferred: PdfDocumentTranslationRuntimeBlock,
): PdfDocumentTranslationRuntimeBlock {
  let target = preferred;
  const visited = new Set<PdfDocumentTranslationRuntimeBlock>();
  while (!visited.has(target)) {
    visited.add(target);
    const index = pdfDocumentTranslationBlocksState.indexOf(target);
    const continuity = pdfDocumentTranslationContinuity(pdfDocumentTranslationBlocksState, index);
    if (!continuity.continuesPrevious || continuity.previousIndex === undefined) break;
    const previous = pdfDocumentTranslationBlocksState[continuity.previousIndex];
    if (
      !previous ||
      !previous.included ||
      previous.status !== 'idle' ||
      !pdfDocumentTranslationSourceRegions(previous).length
    ) break;
    target = previous;
  }
  return target;
}

async function processPdfDocumentTranslationQueue(): Promise<void> {
  if (pdfDocumentTranslationTask || pdfDocumentTranslationPhase !== 'running') return;
  const revision = pdfDocumentTranslationRevision;
  pdfDocumentTranslationTask = (async () => {
    while (
      pdfDocumentTranslationPhase === 'running' &&
      revision === pdfDocumentTranslationRevision
    ) {
      const currentPage = visiblePageAnchor().pageNumber;
      const pending = pdfDocumentTranslationBlocksState
        .filter((block) => block.included && block.status === 'idle')
        .sort((left, right) => comparePdfDocumentTranslationPriority(left, right, currentPage));
      const first = pending[0];
      if (!first) break;
      if (pdfDocumentTranslationBlockUsesVision(first)) {
        const visualTarget = pdfDocumentTranslationContinuityPrerequisite(first);
        if (!await processPdfDocumentTranslationVisualBlock(visualTarget, revision)) return;
        continue;
      }
      if (first.kind === 'formula') {
        if (
          pdfDocumentTranslationMultimodalEnabled &&
          pdfDocumentTranslationMultimodalAuthorized
        ) {
          if (!await processPdfDocumentTranslationVisualBlock(first, revision)) return;
        } else {
          first.status = 'done';
          first.translatedText = first.text;
          first.visualFallbackMessage = '纯文本模式下公式保持原样';
          delete first.visualProcessed;
          renderPdfDocumentTranslationBlock(first);
          await persistPdfDocumentTranslationSession([first]);
          syncPdfDocumentTranslationUi();
        }
        continue;
      }
      const textPending = pending.filter((block) => !pdfDocumentTranslationBlockUsesVision(block));
      const selected = takeDocumentTranslationBatch(
        textPending.map((block) => ({
          value: block,
          text: block.text,
          urgent: Boolean(block.singleRetry),
        })),
        { maximumItems: first.pageNumber === currentPage ? 3 : 6 },
      ).map((candidate) => candidate.value);
      const requestId = crypto.randomUUID();
      pdfDocumentTranslationRequestId = requestId;
      for (const block of selected) {
        block.status = 'translating';
        renderPdfDocumentTranslationBlock(block);
      }
      syncPdfDocumentTranslationUi();
      const contextText = pdfDocumentTranslationContext(first);
      let response: TranslationBatchRuntimeResponse;
      try {
        takePdfTaskRequest('text');
        response = await browser.runtime.sendMessage({
          type: 'TRANSLATE_DOCUMENT_BATCH',
          payload: {
            requestId,
            items: selected.map((block) => ({ id: block.id, text: block.text })),
            documentId: currentReadingIdentity ?? currentDocumentSessionId,
            pageUrl: currentSourceUrl,
            ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}),
            targetLanguage: pdfDocumentTranslationSettings.targetLanguage,
            sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
            style: pdfDocumentTranslationSettings.style,
            contentMode: pdfDocumentTranslationSettings.contentMode,
            ...(contextText ? { contextText } : {}),
          },
        } satisfies RuntimeMessage) as TranslationBatchRuntimeResponse;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'REQUEST_BUDGET_REACHED') {
          selected.forEach((block) => { block.status = 'idle'; renderPdfDocumentTranslationBlock(block); });
          pdfDocumentTranslationRequestId = undefined;
          return;
        }
        response = {
          ok: false,
          error: {
            code: 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'PDF 全文翻译请求失败。',
            retryable: true,
          },
        };
      }
      if (
        revision !== pdfDocumentTranslationRevision ||
        pdfDocumentTranslationRequestId !== requestId
      ) return;
      pdfDocumentTranslationRequestId = undefined;
      if (!response.ok) {
        if (response.error.code === 'REQUEST_ABORTED') {
          selected.forEach((block) => {
            block.status = 'idle';
            renderPdfDocumentTranslationBlock(block);
          });
          pdfDocumentTranslationPhase = 'paused';
          pdfDocumentTranslationMessage = '其他划词或框选翻译已优先处理，全文翻译可继续。';
          syncPdfDocumentTranslationUi();
          return;
        }
        if (isIsolatedBilingualBlockError(response.error.code)) {
          if (selected.length > 1) {
            selected.forEach((block) => {
              block.status = 'idle';
              block.singleRetry = true;
              renderPdfDocumentTranslationBlock(block);
            });
            continue;
          }
          first.status = 'error';
          first.errorMessage = translationErrorMessage(response.error.code, response.error.message);
          renderPdfDocumentTranslationBlock(first);
          continue;
        }
        selected.forEach((block) => {
          block.status = 'idle';
          renderPdfDocumentTranslationBlock(block);
        });
        pdfDocumentTranslationPhase = 'error';
        pdfDocumentTranslationMessage = translationErrorMessage(
          response.error.code,
          response.error.message,
        );
        syncPdfDocumentTranslationUi();
        return;
      }
      addPdfReportedTokens(pdfRequestUsage, response.data.usage, response.data.usageSource);
      const translated = new Map(response.data.items.map((item) => [item.id, item.translatedText]));
      for (const block of selected) {
        const translatedText = translated.get(block.id)?.trim();
        if (translatedText) {
          const outcome = pdfBackgroundTextOutcome(block, translatedText, pdfDocumentTranslationSettings.targetLanguage);
          applyPdfTranslationOutcome(block,outcome);
        } else if (block.singleRetry) {
          block.status = 'error';
          block.errorMessage = '模型没有返回这一段的译文。';
        } else {
          block.status = 'idle';
          block.singleRetry = true;
        }
        renderPdfDocumentTranslationBlock(block);
      }
      await persistPdfDocumentTranslationSession(selected);
      if (revision !== pdfDocumentTranslationRevision) return;
      pdfDocumentTranslationMessage = undefined;
      syncPdfDocumentTranslationUi();
    }
    if (
      revision === pdfDocumentTranslationRevision &&
      pdfDocumentTranslationPhase === 'running'
    ) {
      pdfDocumentTranslationPhase = 'complete';
      syncPdfDocumentTranslationUi();
      await persistPdfDocumentTranslationSession();
    }
  })().finally(() => {
    pdfDocumentTranslationTask = undefined;
    if (
      pdfDocumentTranslationPhase === 'running' &&
      pdfDocumentTranslationBlocksState.some(
        (block) => block.included && block.status === 'idle',
      )
    ) void processPdfDocumentTranslationQueue();
  });
  await pdfDocumentTranslationTask;
}

async function openPdfDocumentTranslation(): Promise<void> {
  if (!pdfDocument) return;
  const controller = await selectionTranslator;
  // A delayed selection refresh must not resurrect the previous trigger after
  // switching to document translation. Keep result history, clear only selection.
  window.getSelection()?.removeAllRanges();
  controller.deactivateSidebar();
  documentTranslationPanel.hidden = false;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
  if (pdfDocumentTranslationPhase === 'idle') await preparePdfDocumentTranslation();
}

function closePdfDocumentTranslation(
  options: { restoreFocus?: boolean } = {},
): void {
  documentTranslationPanel.hidden = true;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
  if (options.restoreFocus !== false) translateDocument.focus({ preventScroll: true });
}

function preservePdfDocumentTranslationReferenceEntries(): void {
  for (const block of pdfDocumentTranslationBlocksState) {
    if (!block.included || !block.referencePreserved || block.status !== 'idle') continue;
    block.status = 'done';
    block.translatedText = block.text;
    delete block.errorMessage;
    delete block.singleRetry;
    delete block.visualFallbackMessage;
    delete block.formulaReviewMessage;
    delete block.formulaReviewDraft;
    delete block.formulaDocument;
    delete block.visualProcessed;
    renderPdfDocumentTranslationBlock(block);
  }
}

async function startOrTogglePdfDocumentTranslation(): Promise<void> {
  if (pdfTrialRunning) return;
  if (!documentRequestLimit.checkValidity()) { documentRequestLimit.reportValidity(); return; }
  if (pdfDocumentTranslationOcrRunning) return;
  if (pdfDocumentTranslationPhase === 'running') {
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = undefined;
    syncPdfDocumentTranslationUi();
    void sendPdfDocumentBackgroundControl('pause');
    void persistPdfDocumentTranslationSession();
    return;
  }
  if (pdfDocumentTranslationPhase === 'complete') {
    for (const block of pdfDocumentTranslationBlocksState) {
      if (!block.included || block.status !== 'error') continue;
      block.status = 'idle';
      block.singleRetry = true;
      delete block.errorMessage;
      renderPdfDocumentTranslationBlock(block);
    }
  }
  documentTranslationSettings.open = false;
  documentTrial.open = false;
  if (
    pdfDocumentTranslationMultimodalEnabled &&
    !pdfDocumentTranslationMultimodalAuthorized
  ) {
    pdfDocumentTranslationMultimodalAuthorized = true;
    const unreadablePages = pdfDocumentTranslationUnreadablePagesInScope();
    if (unreadablePages.length) {
      pdfDocumentTranslationMessage = `已确认智能多模态 · 正在识别 ${unreadablePages.length} 个扫描页…`;
      syncPdfDocumentTranslationUi();
      const ocrRevisionBefore = pdfDocumentTranslationOcrRevision;
      await recognizePdfDocumentTranslationPages();
      if (pdfDocumentTranslationOcrRevision !== ocrRevisionBefore + 1) return;
      if (!scopedPdfDocumentTranslationBlocks().length) {
        documentTranslationSettings.open = true;
        return;
      }
      const limit = pdfRequestLimit();
      if (limit > 0 && pdfRequestUsage.text + pdfRequestUsage.vision + pdfRequestUsage.ocr >= limit) {
        pdfDocumentTranslationPhase = 'paused';
        pdfDocumentTranslationMessage = `已达到 ${limit} 次任务请求上限；识别结果已保留，可提高上限后继续。`;
        syncPdfDocumentTranslationUi();
        return;
      }
    }
  }
  preservePdfDocumentTranslationReferenceEntries();
  pdfDocumentTranslationPhase = 'running';
  pdfDocumentTranslationMessage = undefined;
  syncPdfDocumentTranslationUi();
  void persistPdfDocumentTranslationSession();
  if (pdfDocumentBackgroundJobId) {
    void sendPdfDocumentBackgroundControl('resume');
    return;
  }
  if (!await startPdfDocumentBackgroundTranslation()) {
    void processPdfDocumentTranslationQueue();
  }
}

function stopPdfDocumentTranslation(): void {
  if (pdfDocumentTranslationOcrRunning) {
    stopPdfDocumentTranslationOcr();
    return;
  }
  pdfDocumentTranslationRevision += 1;
  void sendPdfDocumentBackgroundControl('stop');
  cancelPdfDocumentTranslationRequest();
  for (const block of pdfDocumentTranslationBlocksState) {
    if(block.retranslation){delete block.retranslation;delete block.errorMessage;block.status='done';renderPdfDocumentTranslationBlock(block);continue}
    if (block.status !== 'translating') continue;
    block.status = 'idle';
    renderPdfDocumentTranslationBlock(block);
  }
  pdfDocumentTranslationPhase = 'stopped';
  pdfDocumentTranslationMessage = undefined;
  pdfDocumentTranslationTask = undefined;
  syncPdfDocumentTranslationUi();
  void persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState.filter(block=>block.status==='done'));
}

async function restartPdfDocumentTranslation(): Promise<void> {
  pdfDocumentTranslationRevision += 1;
  const revision = pdfDocumentTranslationRevision;
  const previousTask = pdfDocumentTranslationTask;
  disposePdfDocumentBackgroundJob();
  cancelPdfDocumentTranslationRequest();
  for (const block of pdfDocumentTranslationBlocksState) {
    if (!block.included || block.manualCorrection || block.referencePreserved) continue;
    if(block.translatedText?.trim())block.retranslation=true;
    block.status='idle';delete block.errorMessage;delete block.singleRetry;
  }
  pdfDocumentTranslationPhase = 'preparing';
  pdfDocumentTranslationMessage = '保留旧稿与人工修正，准备重新翻译…';
  for(const block of pdfDocumentTranslationBlocksState)renderPdfDocumentTranslationBlock(block);
  syncPdfDocumentTranslationUi();
  await previousTask?.catch(() => undefined);
  if (revision !== pdfDocumentTranslationRevision) return;
  pdfDocumentTranslationTask = undefined;
  const saved=await persistPdfDocumentTranslationSession(
    pdfDocumentTranslationBlocksState.filter(
      (block) => block.status === 'done' || Boolean(block.retranslation),
    ),
    true,
  );
  if(!saved){pdfDocumentTranslationPhase='error';pdfDocumentTranslationMessage='重译准备未能保存，旧译文仍保留。请检查存储后重试。';syncPdfDocumentTranslationUi();return}
  if (revision !== pdfDocumentTranslationRevision) return;
  pdfDocumentTranslationPhase = scopedPdfDocumentTranslationBlocks().length ||
    pdfDocumentTranslationUnreadablePagesInScope().length
    ? 'ready'
    : 'idle';
  pdfDocumentTranslationMultimodalAuthorized = false;
  pdfDocumentTranslationMessage = undefined;
  syncPdfDocumentTranslationUi();
  await startOrTogglePdfDocumentTranslation();
}

function isRegionModeActive(): boolean {
  return regionMode !== 'off';
}

function pendingRegionTranslationCount(): number {
  const active = activeRegionTranslation &&
    activeRegionTranslation.documentEpoch === documentEpoch &&
    !activeRegionTranslation.cancelled
    ? 1
    : 0;
  return regionTranslationQueue.filter(
    (task) => task.documentEpoch === documentEpoch && !task.cancelled,
  ).length + active;
}

function currentRegionTranslationTasks(): QueuedRegionTranslation[] {
  return [
    ...(activeRegionTranslation &&
      activeRegionTranslation.documentEpoch === documentEpoch &&
      !activeRegionTranslation.cancelled
      ? [activeRegionTranslation]
      : []),
    ...regionTranslationQueue.filter(
      (task) => task.documentEpoch === documentEpoch && !task.cancelled,
    ),
  ];
}

function closeRegionQueuePanel(): void {
  regionQueuePanel.hidden = true;
  regionQueueButton.setAttribute('aria-expanded', 'false');
}

function cancelRegionTranslation(taskId: string): void {
  const queuedIndex = regionTranslationQueue.findIndex((task) => task.id === taskId);
  let feedback: { message: string; tone: PdfNoticeTone } | undefined;
  if (queuedIndex >= 0) {
    regionTranslationQueue.splice(queuedIndex, 1);
    feedback = { message: '已从翻译队列移除。', tone: 'success' };
  } else if (activeRegionTranslation?.id === taskId) {
    activeRegionTranslation.cancelled = true;
    void selectionTranslator.then((controller) => controller.cancelActiveTranslation());
    feedback = { message: '正在取消当前框选翻译…', tone: 'info' };
  }
  updateRegionAction();
  if (feedback && regionQueuePanel.hidden) {
    showNotice(feedback.message, { transient: true, tone: feedback.tone });
  }
}

function renderRegionQueue(): void {
  const tasks = currentRegionTranslationTasks();
  regionQueueButton.hidden = tasks.length === 0;
  regionQueueCount.textContent = String(tasks.length);
  if (!tasks.length) {
    closeRegionQueuePanel();
    regionQueueList.replaceChildren();
    return;
  }
  regionQueueList.replaceChildren(...tasks.map((task) => {
    const item = document.createElement('div');
    item.className = 'queue-item';
    const description = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = task.pageLabel;
    const status = document.createElement('small');
    status.textContent = task === activeRegionTranslation ? '翻译中' : '等待中';
    description.append(label, status);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => cancelRegionTranslation(task.id));
    item.append(description, cancel);
    return item;
  }));
}

function updateRegionAction(): void {
  const pending = pendingRegionTranslationCount();
  const shortcut = pdfRegionShortcutKey.toUpperCase();
  const shortcutHint = pdfKeyboardShortcutsEnabled
    ? `；${shortcut} 框选一次，Shift+${shortcut} 连续框选`
    : '';
  regionTranslate.dataset.regionMode = regionMode;
  regionTranslate.setAttribute('aria-pressed', String(regionMode === 'continuous'));
  regionTranslate.setAttribute(
    'aria-label',
    `${regionMode === 'continuous' ? '关闭' : '开启'}连续框选翻译${pending ? `，队列中 ${pending} 项` : ''}`,
  );
  regionTranslate.title = regionMode === 'continuous'
    ? `连续框选已开启；点击关闭${pdfKeyboardShortcutsEnabled ? `，或按 Shift+${shortcut}` : ''}`
    : `点击开启连续框选${shortcutHint}`;
  renderRegionQueue();
}

function closestTextLayer(node: Node | null): HTMLElement | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>('.textLayer') ?? undefined;
}

function boundaryTextNode(
  container: Node,
  offset: number,
  edge: 'start' | 'end',
): { node: Text; offset: number } | undefined {
  if (container instanceof Text) {
    return { node: container, offset: clamp(offset, 0, container.data.length) };
  }
  const children = [...container.childNodes];
  const candidate = edge === 'start'
    ? children[Math.min(offset, children.length - 1)]
    : children[Math.max(0, Math.min(offset - 1, children.length - 1))];
  if (!candidate) return undefined;
  if (candidate instanceof Text) {
    return { node: candidate, offset: edge === 'start' ? 0 : candidate.data.length };
  }
  const walker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  const node = edge === 'start' ? textNodes[0] : textNodes.at(-1);
  if (!node) return undefined;
  return { node, offset: edge === 'start' ? 0 : node.data.length };
}

function snapPdfSelectionSmartly(
  gesture?: TextSelectionGesture,
  gestureEndX?: number,
  gestureEndY?: number,
): PdfTextSelectionSnap | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  const start = boundaryTextNode(range.startContainer, range.startOffset, 'start');
  const end = boundaryTextNode(range.endContainer, range.endOffset, 'end');
  if (!start || !end) return;
  const startLayer = closestTextLayer(start.node);
  if (!startLayer || startLayer !== closestTextLayer(end.node)) return;
  const layerBounds = startLayer.getBoundingClientRect();
  const nodes: Text[] = [];
  const items = [...startLayer.querySelectorAll<HTMLElement>('span')]
    .flatMap((span) => {
      const bounds = span.getBoundingClientRect();
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const text = current as Text;
        if (text.data) textNodes.push(text);
        current = walker.nextNode();
      }
      return textNodes.map((node) => {
        nodes.push(node);
        return {
          text: node.data,
          left: bounds.left - layerBounds.left,
          top: bounds.top - layerBounds.top,
          right: bounds.right - layerBounds.left,
          bottom: bounds.bottom - layerBounds.top,
        };
      });
    });
  const startIndex = nodes.indexOf(start.node);
  const endIndex = nodes.indexOf(end.node);
  if (startIndex < 0 || endIndex < 0) return;
  const resolved = resolvePdfTextSelectionSnap(items, {
    startIndex,
    startOffset: start.offset,
    endIndex,
    endOffset: end.offset,
    pageWidth: layerBounds.width,
    pageHeight: layerBounds.height,
    ...(gesture ? { gestureStartX: gesture.startX - layerBounds.left } : {}),
    ...(gesture ? { gestureStartY: gesture.startY - layerBounds.top } : {}),
    ...(gestureEndX !== undefined ? { gestureEndX: gestureEndX - layerBounds.left } : {}),
    ...(gestureEndY !== undefined ? { gestureEndY: gestureEndY - layerBounds.top } : {}),
    allowExplicitCrossColumn: !continuousSidebarActive,
  });
  if (!resolved) return;
  const startNode = nodes[resolved.startIndex];
  const endNode = nodes[resolved.endIndex];
  if (!startNode || !endNode) return;
  const snapped = document.createRange();
  try {
    snapped.setStart(startNode, resolved.startOffset);
    snapped.setEnd(endNode, resolved.endOffset);
  } catch {
    return;
  }
  if (!snapped.toString().trim()) return;
  selection.removeAllRanges();
  selection.addRange(snapped);
  requestAnimationFrame(() => {
    const endOfContent = startLayer.querySelector<HTMLElement>('.endOfContent');
    if (endOfContent) {
      startLayer.append(endOfContent);
      endOfContent.style.removeProperty('width');
      endOfContent.style.removeProperty('height');
    }
    startLayer.classList.remove('selecting');
  });
  return resolved;
}

function compactSelectionGestureText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function rememberCompletedTextSelectionGesture(
  gesture: TextSelectionGesture,
  endX: number,
  endY: number,
  snap?: PdfTextSelectionSnap,
): void {
  const pageBounds = gesture.pageElement.getBoundingClientRect();
  const selectedText = compactSelectionGestureText(window.getSelection()?.toString() ?? '');
  if (!selectedText || pageBounds.width <= 0 || pageBounds.height <= 0) {
    completedTextSelectionGesture = undefined;
    return;
  }
  completedTextSelectionGesture = {
    documentEpoch,
    pageElement: gesture.pageElement,
    region: normalizeRegion(
      { x: gesture.startX - pageBounds.left, y: gesture.startY - pageBounds.top },
      { x: endX - pageBounds.left, y: endY - pageBounds.top },
      { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
    ),
    selectedText,
    capturedAt: Date.now(),
    ...(snap?.startColumn ? { startColumn: snap.startColumn } : {}),
    ...(snap?.crossColumn ? { crossColumn: snap.crossColumn } : {}),
    ...(snap?.retainedSpanningContent ? { retainedSpanningContent: true } : {}),
    ...(snap?.tableLike ? { tableLike: true } : {}),
  };
}

function pdfSelectionPreview(snapshot: SelectionSnapshot) {
  const text = compactSelectionGestureText(snapshot.sourceText);
  if (!text) return undefined;
  const gesture = completedTextSelectionGesture;
  const matchesGesture = Boolean(
    gesture &&
    gesture.documentEpoch === documentEpoch &&
    Date.now() - gesture.capturedAt <= 30_000 &&
    gesture.selectedText === text,
  );
  if (matchesGesture && gesture?.tableLike) {
    return {
      text,
      warning: '检测到表格或多列内容，划词顺序可能不可靠',
      actionLabel: '改用框选',
      onAction: useCompletedTextSelectionAsRegion,
      suppressAutoTranslate: true,
    };
  }
  const warning = matchesGesture
    ? gesture?.crossColumn === 'constrained'
      ? `已保留${gesture.startColumn === 'right' ? '右' : '左'}栏${gesture.retainedSpanningContent ? '及横跨两栏的内容' : ''}，可重新划选调整`
      : gesture?.crossColumn === 'explicit'
        ? '跨栏选区 · 将按 PDF 原始顺序发送'
        : gesture?.retainedSpanningContent
          ? '横跨两栏的内容已保留 · 按 PDF 原始顺序发送'
        : undefined
    : undefined;
  return { text, ...(warning ? { warning } : {}) };
}

function useCompletedTextSelectionAsRegion(): void {
  const gesture = completedTextSelectionGesture;
  if (
    !gesture ||
    gesture.documentEpoch !== documentEpoch ||
    Date.now() - gesture.capturedAt > 30_000 ||
    gesture.pageElement.dataset.rendered !== 'ready'
  ) {
    setRegionMode('single');
    showNotice('请在表格或多列内容外沿重新拖动框选。', {
      transient: true,
      tone: 'info',
    });
    return;
  }
  const canvas = gesture.pageElement.querySelector<HTMLCanvasElement>('canvas');
  const pageBounds = gesture.pageElement.getBoundingClientRect();
  if (!canvas || pageBounds.width <= 0 || pageBounds.height <= 0) {
    setRegionMode('single');
    return;
  }
  const padding = Math.max(6, Math.min(pageBounds.width, pageBounds.height) * 0.008);
  const region = normalizeRegion(
    {
      x: gesture.region.left - padding,
      y: gesture.region.top - padding,
    },
    {
      x: gesture.region.right + padding,
      y: gesture.region.bottom + padding,
    },
    { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
  );
  setRegionMode('single');
  if (!isUsableRegion(region, 11)) return;
  const selection = createActiveRegion(gesture.pageElement, canvas, region);
  createRegionConfirmation(
    selection,
    '检测到表格或多列内容；请核对框选范围后再发送',
  );
  showNotice(undefined);
}

function explicitFormulaGestureRegion(
  snapshot: SelectionSnapshot,
  pageElement: HTMLElement,
  selectionRegion: RegionRect,
): RegionRect | undefined {
  const gesture = completedTextSelectionGesture;
  if (
    !gesture ||
    gesture.documentEpoch !== documentEpoch ||
    gesture.pageElement !== pageElement ||
    Date.now() - gesture.capturedAt > 30_000 ||
    compactSelectionGestureText(snapshot.sourceText) !== gesture.selectedText
  ) return undefined;
  const horizontalGap = Math.max(
    0,
    Math.max(selectionRegion.left, gesture.region.left) -
      Math.min(selectionRegion.right, gesture.region.right),
  );
  const verticalGap = Math.max(
    0,
    Math.max(selectionRegion.top, gesture.region.top) -
      Math.min(selectionRegion.bottom, gesture.region.bottom),
  );
  if (horizontalGap > 4 || verticalGap > 4) return undefined;
  return gesture.region;
}

function beginSmartTextSelection(event: PointerEvent): void {
  if (
    isRegionModeActive() ||
    event.button !== 0 ||
    !event.isPrimary ||
    !['mouse', 'pen'].includes(event.pointerType) ||
    !(event.target instanceof Element) ||
    !event.target.closest('.textLayer')
  ) return;
  const pageElement = event.target.closest<HTMLElement>('.pdf-page[data-rendered="ready"]');
  if (!pageElement) return;
  completedTextSelectionGesture = undefined;
  textSelectionGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    precise: event.altKey,
    pageElement,
  };
}

function finishSmartTextSelection(event: PointerEvent): void {
  const gesture = textSelectionGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  textSelectionGesture = undefined;
  const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 3;
  if (!moved) return;
  rememberCompletedTextSelectionGesture(gesture, event.clientX, event.clientY);
  if (gesture.precise || event.altKey) return;
  if (textSelectionSnapFrame !== undefined) cancelAnimationFrame(textSelectionSnapFrame);
  textSelectionSnapFrame = requestAnimationFrame(() => {
    textSelectionSnapFrame = undefined;
    const snap = snapPdfSelectionSmartly(gesture, event.clientX, event.clientY);
    rememberCompletedTextSelectionGesture(gesture, event.clientX, event.clientY, snap);
    if (snap?.tableLike) {
      showNotice(
        continuousSidebarActive
          ? '检测到表格或多列内容，本次没有自动发送；请使用“框选翻译”核对范围。'
          : '检测到表格或多列内容，划词顺序可能不可靠；可在选区预览中改用框选。',
        { transient: true, tone: 'warning' },
      );
    } else if (snap?.crossColumn === 'constrained') {
      showNotice(`检测到选区带入另一栏，已保留起始栏${snap.retainedSpanningContent ? '和选中的通栏' : ''}内容。可重新划选调整。`, {
        transient: true,
        tone: 'info',
      });
    } else if (snap?.crossColumn === 'explicit') {
      showNotice('已选择左右两栏；将按 PDF 原始文字顺序发送，请先核对选区预览。', {
        transient: true,
        tone: 'warning',
      });
    } else if (snap?.retainedSpanningContent) {
      showNotice('已保留选中的通栏内容，并按 PDF 原始文字顺序发送。', {
        transient: true,
        tone: 'info',
      });
    }
  });
}

function cancelSmartTextSelection(event: PointerEvent): void {
  if (textSelectionGesture?.pointerId !== event.pointerId) return;
  textSelectionGesture = undefined;
  completedTextSelectionGesture = undefined;
}

function sidebarLayoutInset(layout: PdfSidebarLayout): number {
  if (!layout.expanded || matchMedia('(max-width: 620px)').matches) return 0;
  return Math.min(
    Math.max(0, layout.width + 20),
    Math.max(0, innerWidth - 280),
  );
}

function applyPdfSidebarLayout(layout: PdfSidebarLayout): void {
  pdfSidebarLayout = layout;
  const inset = sidebarLayoutInset(layout);
  stage.style.setProperty('--pdf-sidebar-left', `${layout.side === 'left' ? inset : 0}px`);
  stage.style.setProperty('--pdf-sidebar-right', `${layout.side === 'right' ? inset : 0}px`);
  stage.classList.toggle('translation-sidebar-expanded', inset > 0);
  scheduleFitWidthRefresh();
  scheduleReadingStateSave();
}

function isCurrentOpen(operation: DocumentOpenOperation): boolean {
  return (
    operation.id === openOperationId &&
    operation.epoch === documentEpoch &&
    !operation.controller.signal.aborted
  );
}

function beginDocumentOpen(
  message: string,
  loadingStage: Extract<PdfLoadingStage, 'reading-local' | 'reading-online'>,
): DocumentOpenOperation {
  element<HTMLDialogElement>('pdf-paragraph-editor').close();
  element<HTMLDialogElement>('pdf-terms-dialog').close();
  pdfHistoryDialog.close();
  activeParagraphEdit=undefined;lastParagraphCorrection=undefined;
  void persistReadingState();
  cachedReadingContext=undefined;delete document.documentElement.dataset.libraryReading;
  searchScope.disabled=false;
  documentTranslationViewCompare.hidden=false;documentTranslationClose.textContent='返回原页';
  documentTranslationPanel.querySelector('.pdf-document-translation-title strong')!.textContent='PDF 全文翻译';
  element<HTMLButtonElement>('pdf-library-source').hidden=true;element<HTMLButtonElement>('pdf-library-back').hidden=true;
  pdfTranslationReadingAnchor=undefined;
  currentPdfContentFingerprint=undefined;libraryRestoreDocumentKey=undefined;
  resetPdfDocumentTranslation(true);
  currentPdfBackgroundData = undefined;
  currentReadingIdentity = undefined;
  restoringReadingState = false;
  completedTextSelectionGesture = undefined;
  resetPdfOutline();
  resetPdfSearch();
  resetPdfLinkHistory();
  openOperationId += 1;
  documentEpoch += 1;
  currentDocumentSessionId = crypto.randomUUID();
  openAbortController?.abort();
  openAbortController = new AbortController();
  if (openLoadingTask) {
    void openLoadingTask.destroy().catch(() => undefined);
    openLoadingTask = undefined;
  }
  const previousDocument = pdfDocument;
  pdfDocument = undefined;
  if (previousDocument) void previousDocument.destroy().catch(() => undefined);
  regionTranslationQueue.length = 0;
  temporaryOcrPages.clear();
  pdfDocumentTranslationPageInputs=[];
  if (activeRegionTranslation) activeRegionTranslation.cancelled = true;
  updateRegionAction();
  clearDocument();
  void selectionTranslator.then((controller) => controller.reset());
  setDocumentControls(false);
  pageJump.hidden = true;
  setLoading(message, loadingStage);
  showNotice(undefined);
  emptyState.hidden = true;
  viewer.hidden = true;
  return {
    id: openOperationId,
    epoch: documentEpoch,
    controller: openAbortController,
  };
}

function completeDocumentOpen(operation: DocumentOpenOperation): void {
  if (!isCurrentOpen(operation)) return;
  openAbortController = undefined;
  openLoadingTask = undefined;
  setLoading(undefined);
}

function clearRegionSelection(): void {
  if (activePageRecognitionRequestId) {
    const requestId = activePageRecognitionRequestId;
    activePageRecognitionRequestId = undefined;
    void browser.runtime.sendMessage({
      type: 'CANCEL_TRANSLATION',
      payload: { requestId },
    } satisfies RuntimeMessage).catch(() => undefined);
  }
  activeRegion?.box.remove();
  activeRegion?.confirm?.remove();
  activeRegion = undefined;
}

function setRegionMode(mode: RegionSelectionMode): void {
  regionMode = pdfDocument ? mode : 'off';
  clearRegionSelection();
  viewer.classList.toggle('region-mode', isRegionModeActive());
  updateRegionAction();
  if (isRegionModeActive()) {
    window.getSelection()?.removeAllRanges();
    showNotice(
      regionMode === 'continuous'
        ? '连续框选已开启 · 可逐个发送 · Esc 退出'
        : '拖动框选一次 · Esc 取消',
      { transient: true, tone: 'info' },
    );
  } else {
    showNotice(undefined);
  }
}

function clearDocument(): void {
  clearPendingWheelZoom();
  setRegionMode('off');
  clearSourceRegionHighlight();
  renderGeneration += 1;
  if (retentionFrame !== undefined) cancelAnimationFrame(retentionFrame);
  retentionFrame = undefined;
  pageObserver?.disconnect();
  pageObserver = undefined;
  for (const task of activeRenderTasks.values()) task.cancel();
  activeRenderTasks.clear();
  for (const builder of activeTextLayerBuilders.values()) builder.cancel();
  activeTextLayerBuilders.clear();
  viewer.replaceChildren();
  window.getSelection()?.removeAllRanges();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function visiblePageAnchor(): PageAnchor {
  const pages = [...viewer.querySelectorAll<HTMLElement>('.pdf-page')];
  if (pages.length === 0) return { pageNumber: 1, ratio: 0 };
  const stageRect = stage.getBoundingClientRect();
  const anchorY = stageRect.top + 12;
  let closestPage = pages[0]!;
  let closestDistance = Number.POSITIVE_INFINITY;
  let anchorPage: HTMLElement | undefined;
  let anchorPageVisibleHeight = 0;
  let dominantPage = pages[0]!;
  let dominantVisibleHeight = 0;
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, stageRect.bottom) - Math.max(rect.top, stageRect.top),
    );
    if (visibleHeight > dominantVisibleHeight) {
      dominantPage = page;
      dominantVisibleHeight = visibleHeight;
    }
    if (rect.top <= anchorY && rect.bottom >= anchorY) {
      anchorPage = page;
      anchorPageVisibleHeight = visibleHeight;
    }
    const distance = Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
    if (distance >= closestDistance) continue;
    closestPage = page;
    closestDistance = distance;
  }
  const selectedPage = anchorPage && (
    dominantPage === anchorPage || dominantVisibleHeight < anchorPageVisibleHeight * 1.5
  )
    ? anchorPage
    : dominantVisibleHeight > 0
      ? dominantPage
      : closestPage;
  const rect = selectedPage.getBoundingClientRect();
  return {
    pageNumber: Number(selectedPage.dataset.pageNumber) || 1,
    ratio: rect.height > 0 ? clamp((anchorY - rect.top) / rect.height, 0, 1) : 0,
  };
}

function currentPdfReadingState(): PdfReadingState | undefined {
  if (!(pdfDocument||cachedReadingContext) || !(currentReadingIdentity || currentPdfContentFingerprint) || restoringReadingState) return undefined;
  const anchor = visiblePageAnchor();
  const translation=currentPdfTranslationReadingAnchor();
  return {
    pageNumber: anchor.pageNumber,
    pageRatio: anchor.ratio,
    zoomLevel: currentZoom(),
    fitWidth: fitWidthActive,
    sidebarExpanded: pdfSidebarLayout.expanded,
    updatedAt: Date.now(),
    ...(translation ? {translation} : {}),
  };
}

function currentPdfTranslationReadingAnchor(): PdfTranslationReadingAnchor | undefined {
  if (documentTranslationPanel.hidden || !pdfDocumentTranslationBlocksState.length) return pdfTranslationReadingAnchor;
  if (pdfDocumentTranslationViewMode === 'compare') return {...pdfTranslationReadingAnchor,
    mode: 'compare', pageNumber: visiblePageAnchor().pageNumber, offsetRatio: pdfTranslationReadingAnchor?.offsetRatio ?? 0};
  const bounds = documentTranslationPages.getBoundingClientRect();
  const element = [...documentTranslationPages.querySelectorAll<HTMLElement>('[data-translation-block]')].find(node => {
    const rect=node.getBoundingClientRect();return rect.height>0 && rect.bottom>bounds.top+4 && rect.top<bounds.bottom;
  });
  const block = pdfDocumentTranslationBlocksState.find(block=>block.id===element?.dataset.translationBlock);
  if (!element || !block) return pdfTranslationReadingAnchor;
  const rect=element.getBoundingClientRect();
  return {mode:'reading',signature:block.sessionSignature,pageNumber:block.pageNumber,
    offsetRatio:clamp((bounds.top-rect.top)/Math.max(1,rect.height),0,1)};
}

function restorePdfTranslationReadingAnchor(): void {
  const anchor=pdfTranslationReadingAnchor;
  if (!anchor || documentTranslationPanel.hidden) return;
  setPdfDocumentTranslationViewMode(anchor.mode);
  if (anchor.mode !== 'reading') return;
  requestAnimationFrame(()=>{
    if (pdfTranslationReadingAnchor!==anchor || documentTranslationPanel.hidden) return;
    const visible=pdfDocumentTranslationBlocksState.filter(block=>block.included&&block.status!=='idle');
    const block=visible.find(block=>block.sessionSignature===anchor.signature) ??
      [...visible].sort((a,b)=>Math.abs(a.pageNumber-anchor.pageNumber)-Math.abs(b.pageNumber-anchor.pageNumber))[0];
    const element=block&&documentTranslationPages.querySelector<HTMLElement>(`[data-translation-block="${block.id}"]`);
    if (!element) return;
    const bounds=documentTranslationPages.getBoundingClientRect(),rect=element.getBoundingClientRect();
    documentTranslationPages.scrollTop+=rect.top-bounds.top+rect.height*anchor.offsetRatio;
    pdfDocumentTranslationReadingScrollTop=documentTranslationPages.scrollTop;
    scheduleReadingStateSave();
  });
}

async function persistReadingState(): Promise<void> {
  if (readingStateSaveTimer) clearTimeout(readingStateSaveTimer);
  readingStateSaveTimer = undefined;
  const identity = currentPdfContentFingerprint ? `pdf-content:${currentPdfContentFingerprint}` : currentReadingIdentity;
  const state = currentPdfReadingState();
  if (!identity || !state) return;
  await savePdfReadingState(identity, state).catch(() => undefined);
}

function scheduleReadingStateSave(): void {
  if (!(currentReadingIdentity || currentPdfContentFingerprint) || restoringReadingState) return;
  if (readingStateSaveTimer) clearTimeout(readingStateSaveTimer);
  readingStateSaveTimer = setTimeout(() => {
    readingStateSaveTimer = undefined;
    void persistReadingState();
  }, 320);
}

documentTranslationPages.addEventListener('scroll', () => {
  if (pdfDocumentTranslationViewMode === 'reading') scheduleReadingStateSave();
}, {passive:true});

function scrollToPageAnchor(anchor: PageAnchor): void {
  const page = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${anchor.pageNumber}"]`,
  );
  if (!page) return;
  stage.scrollTop = Math.max(0, page.offsetTop + page.offsetHeight * clamp(anchor.ratio, 0, 1) - 12);
}

function updatePdfLinkReturn(): void {
  const target = pdfLinkHistory.at(-1);
  pdfLinkReturn.hidden = !target;
  if (!target) {
    pdfLinkReturn.textContent = '← 返回';
    pdfLinkReturn.removeAttribute('title');
    return;
  }
  pdfLinkReturn.textContent = `← 返回第 ${target.pageNumber} 页`;
  pdfLinkReturn.title = `返回链接跳转前的第 ${target.pageNumber} 页`;
  pdfLinkReturn.setAttribute('aria-label', pdfLinkReturn.title);
}

function resetPdfLinkHistory(): void {
  pdfLinkHistory.length = 0;
  updatePdfLinkReturn();
}

function pushPdfLinkHistory(anchor: PageAnchor): void {
  const previous = pdfLinkHistory.at(-1);
  if (
    previous?.pageNumber === anchor.pageNumber &&
    Math.abs(previous.ratio - anchor.ratio) < 0.01
  ) return;
  pdfLinkHistory.push(anchor);
  if (pdfLinkHistory.length > PDF_LINK_HISTORY_LIMIT) pdfLinkHistory.shift();
  updatePdfLinkReturn();
}

async function resolvePdfLinkDestination(
  pdf: PDFDocumentProxy,
  destination: string | unknown[],
): Promise<ResolvedPdfLinkDestination | undefined> {
  const explicit = typeof destination === 'string'
    ? await pdf.getDestination(destination)
    : destination;
  if (!Array.isArray(explicit) || !explicit.length) return undefined;
  const reference = explicit[0];
  let pageNumber: number | undefined;
  if (typeof reference === 'number' && Number.isInteger(reference)) {
    pageNumber = reference + 1;
  } else if (reference && typeof reference === 'object' && 'num' in reference) {
    const ref = reference as Parameters<PDFDocumentProxy['getPageIndex']>[0];
    pageNumber = pdf.cachedPageNumber(ref) ?? undefined;
    pageNumber ??= await pdf.getPageIndex(ref).then((pageIndex) => pageIndex + 1);
  }
  if (!pageNumber || pageNumber < 1 || pageNumber > pdf.numPages) return undefined;
  const top = pdfDestinationTopCoordinate(explicit);
  let ratio = 0;
  if (top !== undefined) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const point = viewport.convertToViewportPoint(0, top);
    const viewportY = Number(point[1]);
    if (Number.isFinite(viewportY) && viewport.height > 0) {
      ratio = clamp(viewportY / viewport.height, 0, 1);
    }
  }
  return { pageNumber, ratio, destinationLabel: `第 ${pageNumber} 页` };
}

function namedPdfLinkDestination(
  action: SafePdfNamedAction,
  sourcePageNumber: number,
): ResolvedPdfLinkDestination | undefined {
  const total = pdfDocument?.numPages ?? 0;
  if (!total) return undefined;
  const pageNumber = action === 'FirstPage'
    ? 1
    : action === 'LastPage'
      ? total
      : action === 'NextPage'
        ? Math.min(total, sourcePageNumber + 1)
        : Math.max(1, sourcePageNumber - 1);
  return { pageNumber, ratio: 0, destinationLabel: `第 ${pageNumber} 页` };
}

function jumpToPdfLinkDestination(
  target: ResolvedPdfLinkDestination,
  rememberOrigin = true,
  focusReturn = false,
): void {
  const pdf = pdfDocument;
  if (!pdf) return;
  if (rememberOrigin) pushPdfLinkHistory(visiblePageAnchor());
  scrollToPageAnchor(target);
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${target.pageNumber}"]`,
  );
  if (pageElement) requestPageRender(pdf, pageElement, renderGeneration);
  updatePageControl(target);
  schedulePageRetention();
  scheduleReadingStateSave();
  updatePdfLinkReturn();
  if (focusReturn) pdfLinkReturn.focus({ preventScroll: true });
}

pdfLinkReturn.addEventListener('click', () => {
  const target = pdfLinkHistory.pop();
  if (!target) return;
  jumpToPdfLinkDestination(
    { ...target, destinationLabel: `第 ${target.pageNumber} 页` },
    false,
  );
  updatePdfLinkReturn();
  if (!pdfLinkReturn.hidden) pdfLinkReturn.focus({ preventScroll: true });
  else stage.focus({ preventScroll: true });
});

function updatePageControl(anchor = visiblePageAnchor()): void {
  if (document.activeElement !== pageNumberInput) {
    pageNumberInput.value = String(anchor.pageNumber);
  }
  syncPdfOutlineCurrent(anchor.pageNumber);
  syncPdfBookmarkCurrent(anchor.pageNumber);
  syncPdfDocumentTranslationCurrentPage(anchor.pageNumber);
}

function currentPdfBookmark(pageNumber = visiblePageAnchor().pageNumber): PdfReadingBookmark | undefined {
  return pdfReadingBookmarks.find((bookmark) => bookmark.pageNumber === pageNumber);
}

function updatePdfNavigationStatus(): void {
  outlineStatus.textContent = activePdfNavigationView === 'outline'
    ? `${pdfOutlineEntryMap.size} 项`
    : `${pdfReadingBookmarks.length} 个书签`;
}

function syncPdfBookmarkCurrent(pageNumber: number): void {
  const current = currentPdfBookmark(pageNumber);
  for (const item of bookmarkList.querySelectorAll<HTMLElement>('.pdf-bookmark-item')) {
    const isCurrent = Number(item.dataset.bookmarkPage) === pageNumber;
    item.classList.toggle('is-current', isCurrent);
    const jump = item.querySelector<HTMLElement>('.pdf-bookmark-jump');
    if (isCurrent) jump?.setAttribute('aria-current', 'location');
    else jump?.removeAttribute('aria-current');
  }
  bookmarkAdd.disabled = !currentReadingIdentity || Boolean(current) ||
    pdfReadingBookmarks.length >= MAX_PDF_BOOKMARKS_PER_DOCUMENT;
  bookmarkAdd.textContent = current ? '✓ 当前页已添加' : '＋ 添加当前页';
  bookmarkAdd.title = !currentReadingIdentity
    ? '当前文档无法建立本地匿名标识'
    : current
      ? '当前页已有书签'
      : pdfReadingBookmarks.length >= MAX_PDF_BOOKMARKS_PER_DOCUMENT
        ? `每份 PDF 最多 ${MAX_PDF_BOOKMARKS_PER_DOCUMENT} 个书签`
        : '将当前阅读页加入书签';
  bookmarkStatus.textContent = `${pdfReadingBookmarks.length} / ${MAX_PDF_BOOKMARKS_PER_DOCUMENT}`;
}

function persistPdfBookmarks(): void {
  const identity = currentPdfContentFingerprint?`pdf-content:${currentPdfContentFingerprint}`:currentReadingIdentity;
  if (!identity) return;
  const epoch = documentEpoch;
  const revision = ++bookmarkSaveRevision;
  const snapshot = pdfReadingBookmarks.map((bookmark) => ({ ...bookmark }));
  bookmarkSaveQueue = bookmarkSaveQueue.catch(() => undefined).then(async () => {
    try {
      const saved = await savePdfReadingBookmarks(identity, snapshot);
      if (
        (currentPdfContentFingerprint?`pdf-content:${currentPdfContentFingerprint}`:currentReadingIdentity) !== identity ||
        documentEpoch !== epoch ||
        bookmarkSaveRevision !== revision
      ) return;
      pdfReadingBookmarks = saved.bookmarks;
      renderPdfBookmarks();
    } catch {
      if ((currentPdfContentFingerprint?`pdf-content:${currentPdfContentFingerprint}`:currentReadingIdentity) === identity && documentEpoch === epoch) {
        showNotice('书签暂时无法保存，请稍后重试。', { tone: 'warning', transient: true });
      }
    }
  });
}

function navigateToPdfBookmark(bookmark: PdfReadingBookmark): void {
  const pdf = pdfDocument;
  if (!pdf) return;
  scrollToPageAnchor({ pageNumber: bookmark.pageNumber, ratio: 0 });
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${bookmark.pageNumber}"]`,
  );
  if (pageElement) requestPageRender(pdf, pageElement, renderGeneration);
  updatePageControl({ pageNumber: bookmark.pageNumber, ratio: 0 });
  schedulePageRetention();
  scheduleReadingStateSave();
  if (matchMedia('(max-width: 560px)').matches) {
    closePdfOutline(false);
    stage.focus({ preventScroll: true });
  }
}

function renderPdfBookmarkEditor(
  item: HTMLElement,
  bookmark: PdfReadingBookmark,
): void {
  const editor = document.createElement('form');
  editor.className = 'pdf-bookmark-editor';
  const label = document.createElement('input');
  label.type = 'text';
  label.maxLength = MAX_PDF_BOOKMARK_LABEL_LENGTH;
  label.value = bookmark.label;
  label.placeholder = `第 ${bookmark.pageNumber} 页`;
  label.setAttribute('aria-label', '书签名称');
  const note = document.createElement('textarea');
  note.maxLength = MAX_PDF_BOOKMARK_NOTE_LENGTH;
  note.value = bookmark.note;
  note.placeholder = '备注（可选）';
  note.setAttribute('aria-label', '书签备注');
  const actions = document.createElement('div');
  actions.className = 'pdf-bookmark-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'save';
  save.textContent = '保存';
  actions.append(cancel, save);
  editor.append(label, note, actions);
  cancel.addEventListener('click', () => {
    editingPdfBookmarkId = undefined;
    renderPdfBookmarks();
  });
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    const updated = normalizePdfReadingBookmark({
      ...bookmark,
      label: label.value,
      note: note.value,
      updatedAt: Date.now(),
    });
    if (!updated) return;
    pdfReadingBookmarks = pdfReadingBookmarks.map((candidate) => (
      candidate.id === bookmark.id ? updated : candidate
    ));
    editingPdfBookmarkId = undefined;
    renderPdfBookmarks();
    persistPdfBookmarks();
  });
  editor.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    editingPdfBookmarkId = undefined;
    renderPdfBookmarks();
  });
  item.append(editor);
  queueMicrotask(() => label.focus({ preventScroll: true }));
}

function renderPdfBookmarks(focusId?: string): void {
  const fragment = document.createDocumentFragment();
  for (const bookmark of pdfReadingBookmarks) {
    const item = document.createElement('article');
    item.className = 'pdf-bookmark-item';
    item.dataset.bookmarkId = bookmark.id;
    item.dataset.bookmarkPage = String(bookmark.pageNumber);
    item.setAttribute('role', 'listitem');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'pdf-bookmark-jump';
    jump.title = `跳转到第 ${bookmark.pageNumber} 页`;
    const copy = document.createElement('span');
    copy.className = 'pdf-bookmark-copy';
    const label = document.createElement('strong');
    label.textContent = bookmark.label;
    copy.append(label);
    if (bookmark.note) {
      const note = document.createElement('small');
      note.textContent = bookmark.note.replace(/\s*\n\s*/gu, ' ');
      copy.append(note);
    }
    const page = document.createElement('span');
    page.className = 'pdf-bookmark-page';
    page.textContent = `第 ${bookmark.pageNumber} 页`;
    jump.append(copy, page);
    jump.addEventListener('click', () => navigateToPdfBookmark(bookmark));
    const actions = document.createElement('span');
    actions.className = 'pdf-bookmark-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'pdf-bookmark-edit';
    edit.textContent = '✎';
    edit.title = `编辑“${bookmark.label}”`;
    edit.setAttribute('aria-label', `编辑书签 ${bookmark.label}`);
    edit.addEventListener('click', () => {
      editingPdfBookmarkId = bookmark.id;
      renderPdfBookmarks();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pdf-bookmark-delete';
    remove.textContent = '×';
    remove.title = `删除“${bookmark.label}”`;
    remove.setAttribute('aria-label', `删除书签 ${bookmark.label}`);
    remove.addEventListener('click', () => {
      pdfReadingBookmarks = pdfReadingBookmarks.filter((candidate) => candidate.id !== bookmark.id);
      if (editingPdfBookmarkId === bookmark.id) editingPdfBookmarkId = undefined;
      renderPdfBookmarks();
      persistPdfBookmarks();
    });
    actions.append(edit, remove);
    item.append(jump, actions);
    if (editingPdfBookmarkId === bookmark.id) renderPdfBookmarkEditor(item, bookmark);
    fragment.append(item);
  }
  bookmarkList.replaceChildren(fragment);
  bookmarkEmpty.hidden = pdfReadingBookmarks.length > 0;
  updatePdfNavigationStatus();
  syncPdfBookmarkCurrent(visiblePageAnchor().pageNumber);
  if (!focusId) return;
  const focusTarget = [...bookmarkList.querySelectorAll<HTMLButtonElement>('.pdf-bookmark-jump')]
    .find((button) => button.closest<HTMLElement>('.pdf-bookmark-item')?.dataset.bookmarkId === focusId);
  focusTarget?.focus({ preventScroll: true });
}

function addCurrentPdfBookmark(): void {
  if (!currentReadingIdentity || !pdfDocument) return;
  const pageNumber = visiblePageAnchor().pageNumber;
  if (currentPdfBookmark(pageNumber) || pdfReadingBookmarks.length >= MAX_PDF_BOOKMARKS_PER_DOCUMENT) {
    syncPdfBookmarkCurrent(pageNumber);
    return;
  }
  const now = Date.now();
  const bookmark = normalizePdfReadingBookmark({
    id: crypto.randomUUID(),
    pageNumber,
    label: `第 ${pageNumber} 页`,
    note: '',
    createdAt: now,
    updatedAt: now,
  });
  if (!bookmark) return;
  pdfReadingBookmarks = [...pdfReadingBookmarks, bookmark]
    .sort((left, right) => left.pageNumber - right.pageNumber);
  renderPdfBookmarks(bookmark.id);
  persistPdfBookmarks();
}

function setPdfNavigationView(view: PdfNavigationView, focusTab = false): void {
  activePdfNavigationView = view === 'outline' && !pdfOutlineEntries.length
    ? 'bookmarks'
    : view;
  const showingOutline = activePdfNavigationView === 'outline';
  outlineTab.hidden = !pdfOutlineEntries.length;
  outlineTab.setAttribute('aria-selected', String(showingOutline));
  outlineTab.tabIndex = showingOutline ? 0 : -1;
  bookmarksTab.setAttribute('aria-selected', String(!showingOutline));
  bookmarksTab.tabIndex = showingOutline ? -1 : 0;
  outlineTree.hidden = !showingOutline;
  bookmarksPanel.hidden = showingOutline;
  updatePdfNavigationStatus();
  if (!showingOutline) renderPdfBookmarks();
  if (focusTab) (showingOutline ? outlineTab : bookmarksTab).focus({ preventScroll: true });
}

function visiblePdfOutlineEntryId(): string | undefined {
  let entry = currentPdfOutlineEntryId
    ? pdfOutlineEntryMap.get(currentPdfOutlineEntryId)
    : undefined;
  while (entry?.parentId && !pdfOutlineExpandedIds.has(entry.parentId)) {
    entry = pdfOutlineEntryMap.get(entry.parentId);
  }
  return entry?.id;
}

function applyPdfOutlineCurrentState(): void {
  for (const action of outlineTree.querySelectorAll<HTMLElement>('.pdf-outline-action')) {
    action.classList.remove('is-current');
    action.removeAttribute('aria-current');
  }
  const visibleId = visiblePdfOutlineEntryId();
  if (!visibleId) return;
  const action = outlineTree.querySelector<HTMLElement>(
    `.pdf-outline-action[data-outline-id="${visibleId}"]`,
  );
  action?.classList.add('is-current');
  action?.setAttribute('aria-current', 'location');
}

function syncPdfOutlineCurrent(pageNumber: number): void {
  const nextId = pdfOutlineEntryForPage(pdfOutlineEntries, pageNumber)?.id;
  if (nextId === currentPdfOutlineEntryId) return;
  currentPdfOutlineEntryId = nextId;
  applyPdfOutlineCurrentState();
}

function renderPdfOutline(focusId?: string): void {
  const fragment = document.createDocumentFragment();
  const appendEntries = (
    container: DocumentFragment | HTMLElement,
    entries: readonly PdfOutlineEntry[],
  ): void => {
    for (const entry of entries) {
      const node = document.createElement('div');
      node.className = 'pdf-outline-node';
      node.dataset.outlineNodeId = entry.id;
      const row = document.createElement('div');
      row.className = 'pdf-outline-row';
      row.style.setProperty('--outline-depth', String(entry.depth));
      if (entry.children.length) {
        const toggle = document.createElement('button');
        const expanded = pdfOutlineExpandedIds.has(entry.id);
        toggle.type = 'button';
        toggle.className = 'pdf-outline-toggle';
        toggle.dataset.outlineToggleId = entry.id;
        toggle.tabIndex = -1;
        toggle.textContent = '›';
        toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'} ${entry.title}`);
        toggle.setAttribute('aria-expanded', String(expanded));
        row.append(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'pdf-outline-toggle-spacer';
        spacer.ariaHidden = 'true';
        row.append(spacer);
      }
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'pdf-outline-action';
      action.dataset.outlineId = entry.id;
      action.setAttribute('role', 'treeitem');
      action.setAttribute('aria-level', String(entry.depth));
      if (entry.children.length) {
        action.setAttribute('aria-expanded', String(pdfOutlineExpandedIds.has(entry.id)));
      }
      if (entry.pageNumber === undefined) action.classList.add('is-group');
      const title = document.createElement('span');
      title.className = 'pdf-outline-title';
      title.textContent = entry.title;
      action.append(title);
      if (entry.pageNumber !== undefined) {
        const page = document.createElement('span');
        page.className = 'pdf-outline-page';
        page.textContent = String(entry.pageNumber);
        action.append(page);
        action.title = `${entry.title} · 第 ${entry.pageNumber} 页`;
      } else {
        action.title = `${entry.title} · 章节组`;
      }
      row.append(action);
      node.append(row);
      if (entry.children.length && pdfOutlineExpandedIds.has(entry.id)) {
        const children = document.createElement('div');
        children.className = 'pdf-outline-group';
        children.setAttribute('role', 'group');
        appendEntries(children, entry.children);
        node.append(children);
      }
      container.append(node);
    }
  };
  appendEntries(fragment, pdfOutlineEntries);
  outlineTree.replaceChildren(fragment);
  applyPdfOutlineCurrentState();
  if (!focusId) return;
  outlineTree.querySelector<HTMLButtonElement>(
    `.pdf-outline-action[data-outline-id="${focusId}"]`,
  )?.focus({ preventScroll: true });
}

function togglePdfOutlineEntry(entryId: string, focusAfter = true): void {
  const entry = pdfOutlineEntryMap.get(entryId);
  if (!entry?.children.length) return;
  if (pdfOutlineExpandedIds.has(entryId)) pdfOutlineExpandedIds.delete(entryId);
  else pdfOutlineExpandedIds.add(entryId);
  renderPdfOutline(focusAfter ? entryId : undefined);
}

function revealCurrentPdfOutlineEntry(): void {
  let entry = currentPdfOutlineEntryId
    ? pdfOutlineEntryMap.get(currentPdfOutlineEntryId)
    : undefined;
  while (entry?.parentId) {
    pdfOutlineExpandedIds.add(entry.parentId);
    entry = pdfOutlineEntryMap.get(entry.parentId);
  }
}

function closePdfOutline(restoreFocus = true): void {
  if (outlinePanel.hidden) return;
  outlinePanel.hidden = true;
  openOutline.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    const target = outlineReturnFocus?.isConnected ? outlineReturnFocus : openOutline;
    const menu = target.closest<HTMLDetailsElement>('details:not([open])');
    (menu?.querySelector<HTMLElement>(':scope > summary') ?? target).focus({ preventScroll: true });
  }
  outlineReturnFocus = undefined;
}

function openPdfOutline(): void {
  if (!pdfDocument) return;
  closePdfSearch(false);
  outlineReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : openOutline;
  outlinePanel.hidden = false;
  openOutline.setAttribute('aria-expanded', 'true');
  setPdfNavigationView(activePdfNavigationView);
  if (activePdfNavigationView === 'outline') {
    revealCurrentPdfOutlineEntry();
    renderPdfOutline();
    const focusId = visiblePdfOutlineEntryId();
    const target = focusId
      ? outlineTree.querySelector<HTMLButtonElement>(
          `.pdf-outline-action[data-outline-id="${focusId}"]`,
        )
      : outlineTree.querySelector<HTMLButtonElement>('.pdf-outline-action');
    target?.focus({ preventScroll: true });
  } else {
    renderPdfBookmarks();
    const current = currentPdfBookmark();
    const target = current
      ? [...bookmarkList.querySelectorAll<HTMLButtonElement>('.pdf-bookmark-jump')]
        .find((button) => (
          button.closest<HTMLElement>('.pdf-bookmark-item')?.dataset.bookmarkId === current.id
        ))
      : undefined;
    (target ?? bookmarkAdd).focus({ preventScroll: true });
  }
}

function resetPdfOutline(): void {
  closePdfOutline(false);
  pdfOutlineEntries = [];
  pdfOutlineEntryMap = new Map();
  pdfOutlineExpandedIds = new Set();
  currentPdfOutlineEntryId = undefined;
  outlineReturnFocus = undefined;
  activePdfNavigationView = 'bookmarks';
  pdfReadingBookmarks = [];
  editingPdfBookmarkId = undefined;
  bookmarkSaveRevision += 1;
  outlineTree.replaceChildren();
  bookmarkList.replaceChildren();
  bookmarkEmpty.hidden = false;
  outlineTab.hidden = true;
  setPdfNavigationView('bookmarks');
  outlineStatus.textContent = '';
  openOutline.hidden = true;
  openOutline.disabled = true;
  openOutline.setAttribute('aria-expanded', 'false');
}

async function resolvePdfOutlineDestination(
  pdf: PDFDocumentProxy,
  destination: string | unknown[],
  namedDestinations: Map<string, Promise<unknown[] | null>>,
  pageReferences: Map<string, Promise<number | undefined>>,
): Promise<number | undefined> {
  let explicitDestination: unknown[] | null;
  if (typeof destination === 'string') {
    let pending = namedDestinations.get(destination);
    if (!pending) {
      pending = pdf.getDestination(destination) as Promise<unknown[] | null>;
      namedDestinations.set(destination, pending);
    }
    explicitDestination = await pending;
  } else {
    explicitDestination = destination;
  }
  if (!explicitDestination?.length) return undefined;
  const reference = explicitDestination[0];
  if (typeof reference === 'number' && Number.isInteger(reference)) {
    const pageNumber = reference + 1;
    return pageNumber >= 1 && pageNumber <= pdf.numPages ? pageNumber : undefined;
  }
  if (!reference || typeof reference !== 'object' || !('num' in reference)) return undefined;
  const candidate = reference as { num: unknown; gen?: unknown };
  if (!Number.isInteger(candidate.num)) return undefined;
  const key = `${String(candidate.num)}:${String(candidate.gen ?? 0)}`;
  let pendingPage = pageReferences.get(key);
  if (!pendingPage) {
    pendingPage = pdf.getPageIndex(
      reference as Parameters<PDFDocumentProxy['getPageIndex']>[0],
    ).then((pageIndex) => {
      const pageNumber = pageIndex + 1;
      return pageNumber >= 1 && pageNumber <= pdf.numPages ? pageNumber : undefined;
    }).catch(() => undefined);
    pageReferences.set(key, pendingPage);
  }
  return pendingPage;
}

async function loadPdfOutline(pdf: PDFDocumentProxy, epoch: number): Promise<void> {
  try {
    const source = await pdf.getOutline();
    if (pdfDocument !== pdf || documentEpoch !== epoch || !Array.isArray(source)) return;
    const namedDestinations = new Map<string, Promise<unknown[] | null>>();
    const pageReferences = new Map<string, Promise<number | undefined>>();
    const result = await buildPdfOutlineEntries(
      source as unknown as PdfOutlineSourceItem[],
      (destination) => resolvePdfOutlineDestination(
        pdf,
        destination,
        namedDestinations,
        pageReferences,
      ),
    );
    if (pdfDocument !== pdf || documentEpoch !== epoch) return;
    pdfOutlineEntries = result.entries;
    const flattened = flattenPdfOutlineEntries(result.entries);
    pdfOutlineEntryMap = new Map(flattened.map((entry) => [entry.id, entry]));
    pdfOutlineExpandedIds = new Set(
      flattened.filter((entry) => entry.initiallyExpanded).map((entry) => entry.id),
    );
    currentPdfOutlineEntryId = pdfOutlineEntryForPage(
      pdfOutlineEntries,
      visiblePageAnchor().pageNumber,
    )?.id;
    outlineTab.title = result.truncated ? `显示前 ${flattened.length} 项` : '';
    if (flattened.length && outlinePanel.hidden) activePdfNavigationView = 'outline';
    setPdfNavigationView(activePdfNavigationView);
  } catch {
    if (pdfDocument !== pdf || documentEpoch !== epoch) return;
    pdfOutlineEntries = [];
    pdfOutlineEntryMap = new Map();
    pdfOutlineExpandedIds = new Set();
    currentPdfOutlineEntryId = undefined;
    outlineTree.replaceChildren();
    setPdfNavigationView('bookmarks');
  }
}

function navigateToPdfOutlineEntry(entry: PdfOutlineEntry): void {
  const pdf = pdfDocument;
  if (!pdf || entry.pageNumber === undefined) {
    togglePdfOutlineEntry(entry.id);
    return;
  }
  scrollToPageAnchor({ pageNumber: entry.pageNumber, ratio: 0 });
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${entry.pageNumber}"]`,
  );
  if (pageElement) requestPageRender(pdf, pageElement, renderGeneration);
  updatePageControl({ pageNumber: entry.pageNumber, ratio: 0 });
  schedulePageRetention();
  scheduleReadingStateSave();
  if (matchMedia('(max-width: 560px)').matches) {
    closePdfOutline(false);
    stage.focus({ preventScroll: true });
  }
}

function searchMatchIdentity(match: ReaderSearchMatch | undefined): string | undefined {
  return match ? `${match.translationBlockId ?? 'source'}:${match.pageNumber}:${match.start}:${match.end}` : undefined;
}

function setSearchStatus(message: string): void {
  searchStatus.value = message;
  searchStatus.textContent = message;
}

function stopSearchIndexing(): void {
  searchIndexRunId += 1;
  searchIndexing = false;
}

function renderedSearchSpans(pageElement: HTMLElement): HTMLElement[] {
  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer');
  if (!textLayer) return [];
  return [...textLayer.querySelectorAll<HTMLElement>('span')].filter((span) => (
    !span.classList.contains('markedContent') &&
    span.getAttribute('role') !== 'img' &&
    Boolean(normalizePdfSearchText(span.textContent ?? ''))
  ));
}

function originalOffsetForNormalizedOffset(value: string, normalizedOffset: number): number {
  const leadingWhitespace = value.length - value.trimStart().length;
  const trimmed = value.trim();
  if (normalizedOffset <= 0) return leadingWhitespace;
  for (let offset = 1; offset <= trimmed.length; offset += 1) {
    if (normalizePdfSearchText(trimmed.slice(0, offset)).length >= normalizedOffset) {
      return leadingWhitespace + offset;
    }
  }
  return leadingWhitespace + trimmed.length;
}

function textPositionAtOffset(
  element: HTMLElement,
  requestedOffset: number,
): { node: Text; offset: number } | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, requestedOffset);
  let last: Text | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    last = text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
  }
  return last ? { node: last, offset: last.data.length } : undefined;
}

function rangeForSearchPart(
  span: HTMLElement | undefined,
  startOffset: number,
  endOffset: number,
): Range | undefined {
  if (!span) return undefined;
  const value = span.textContent ?? '';
  const start = textPositionAtOffset(
    span,
    originalOffsetForNormalizedOffset(value, startOffset),
  );
  const end = textPositionAtOffset(
    span,
    originalOffsetForNormalizedOffset(value, endOffset),
  );
  if (!start || !end) return undefined;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.collapsed ? undefined : range;
}

function refreshPdfSearchHighlightsForPage(pageElement: HTMLElement): void {
  const spans = renderedSearchSpans(pageElement);
  for (const span of spans) {
    span.classList.remove('pi-pdf-search-match', 'pi-pdf-search-current');
  }
  if (searchPanel.hidden || !activeSearchQuery || !searchMatches.length) return;
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const pageMatches = searchMatches.filter((match) => !match.translationBlockId && match.pageNumber === pageNumber);
  for (const match of pageMatches) {
    for (const itemIndex of match.itemIndexes) {
      spans[itemIndex]?.classList.add('pi-pdf-search-match');
    }
  }
  const current = searchMatches[searchResultIndex];
  if (current?.translationBlockId || current?.pageNumber !== pageNumber) return;
  for (const itemIndex of current.itemIndexes) {
    spans[itemIndex]?.classList.add('pi-pdf-search-current');
  }
}

function refreshPdfSearchHighlights(): void {
  for (const block of documentTranslationPages.querySelectorAll<HTMLElement>('[data-translation-block]')) {
    const id = block.dataset.translationBlock;
    block.classList.toggle('pdf-search-translation-match', !searchPanel.hidden && searchMatches.some(match => match.translationBlockId === id));
    block.classList.toggle('pdf-search-translation-current', !searchPanel.hidden && searchMatches[searchResultIndex]?.translationBlockId === id);
  }
  const renderedPages = [
    ...viewer.querySelectorAll<HTMLElement>('.pdf-page[data-rendered="ready"]'),
  ];
  for (const page of renderedPages) {
    refreshPdfSearchHighlightsForPage(page);
  }
  const highlightRegistry = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
  if (!highlightRegistry || typeof Highlight === 'undefined') return;
  highlightRegistry.delete(PDF_SEARCH_HIGHLIGHT_NAME);
  highlightRegistry.delete(PDF_SEARCH_CURRENT_HIGHLIGHT_NAME);
  if (searchPanel.hidden || !activeSearchQuery || !searchMatches.length) return;
  const current = searchMatches[searchResultIndex];
  const matchRanges: Range[] = [];
  const currentRanges: Range[] = [];
  for (const page of renderedPages) {
    const pageNumber = Number(page.dataset.pageNumber);
    const spans = renderedSearchSpans(page);
    for (const match of searchMatches) {
      if (match.translationBlockId || match.pageNumber !== pageNumber) continue;
      const target = match === current ? currentRanges : matchRanges;
      for (const part of match.itemParts) {
        const range = rangeForSearchPart(
          spans[part.itemIndex],
          part.startOffset,
          part.endOffset,
        );
        if (range) target.push(range);
      }
    }
  }
  if (matchRanges.length) {
    highlightRegistry.set(PDF_SEARCH_HIGHLIGHT_NAME, new Highlight(...matchRanges));
  }
  if (currentRanges.length) {
    highlightRegistry.set(
      PDF_SEARCH_CURRENT_HIGHLIGHT_NAME,
      new Highlight(...currentRanges),
    );
  }
}

function visiblePdfSearchResultWindow(): { start: number; end: number } {
  if (searchMatches.length <= PDF_SEARCH_PREVIEW_LIMIT) {
    return { start: 0, end: searchMatches.length };
  }
  const halfWindow = Math.floor(PDF_SEARCH_PREVIEW_LIMIT / 2);
  const start = Math.min(
    searchMatches.length - PDF_SEARCH_PREVIEW_LIMIT,
    Math.max(0, searchResultIndex - halfWindow),
  );
  return { start, end: start + PDF_SEARCH_PREVIEW_LIMIT };
}

function keepPdfSearchResultVisible(button: HTMLElement): void {
  const top = button.offsetTop;
  const bottom = top + button.offsetHeight;
  if (top < searchResults.scrollTop) {
    searchResults.scrollTop = top;
  } else if (bottom > searchResults.scrollTop + searchResults.clientHeight) {
    searchResults.scrollTop = bottom - searchResults.clientHeight;
  }
}

function renderPdfSearchResults(): void {
  const restoreResultFocus = document.activeElement instanceof HTMLElement &&
    searchResults.contains(document.activeElement);
  const hasMatches = Boolean(activeSearchQuery && searchMatches.length);
  searchResultsToggle.hidden = !hasMatches;
  searchResultsToggle.setAttribute('aria-expanded', String(searchResultsExpanded));
  const toggleLabel = searchResultsExpanded ? '收起搜索结果' : '展开搜索结果';
  searchResultsToggle.title = toggleLabel;
  searchResultsToggle.setAttribute('aria-label', toggleLabel);
  searchResults.hidden = searchPanel.hidden || !hasMatches || !searchResultsExpanded;
  if (!hasMatches) {
    searchResults.replaceChildren();
    return;
  }

  const { start, end } = visiblePdfSearchResultWindow();
  const fragment = document.createDocumentFragment();
  if (searchMatches.length > PDF_SEARCH_PREVIEW_LIMIT) {
    const range = document.createElement('div');
    range.className = 'pdf-search-results-range';
    range.textContent = `显示第 ${start + 1}–${end} 项 · 共 ${searchMatches.length} 项`;
    fragment.append(range);
  }
  searchMatches.slice(start, end).forEach((match, offset) => {
    const resultIndex = start + offset;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-search-result';
    button.dataset.searchResultIndex = String(resultIndex);
    button.setAttribute('aria-label', `第 ${match.pageNumber} 页，搜索结果 ${resultIndex + 1}`);
    button.setAttribute('aria-posinset', String(resultIndex + 1));
    button.setAttribute('aria-setsize', String(searchMatches.length));
    if (resultIndex === searchResultIndex) {
      button.classList.add('is-current');
      button.setAttribute('aria-current', 'true');
    }
    const page = document.createElement('span');
    page.className = 'pdf-search-result-page';
    page.textContent = `第 ${match.pageNumber} 页${searchScope.value === 'all' ? match.translationBlockId ? ' · 译文' : ' · 原文' : ''}`;
    const excerpt = document.createElement('span');
    excerpt.className = 'pdf-search-result-excerpt';
    const indexedPage = match.translationBlockId ? translationSearchIndexes.get(match.translationBlockId) : searchPageIndexes.get(match.pageNumber);
    const snippet = indexedPage
      ? buildPdfSearchSnippet(indexedPage, match)
      : { before: '', match: activeSearchQuery, after: '' };
    excerpt.append(document.createTextNode(snippet.before));
    const mark = document.createElement('mark');
    mark.textContent = snippet.match || activeSearchQuery;
    excerpt.append(mark, document.createTextNode(snippet.after));
    button.append(page, excerpt);
    fragment.append(button);
  });
  searchResults.replaceChildren(fragment);
  const current = searchResults.querySelector<HTMLElement>('.pdf-search-result.is-current');
  if (current && !searchResults.hidden) {
    if (restoreResultFocus) current.focus({ preventScroll: true });
    keepPdfSearchResultVisible(current);
  }
}

function focusPdfSearchResult(index: number): void {
  const button = searchResults.querySelector<HTMLButtonElement>(
    `.pdf-search-result[data-search-result-index="${index}"]`,
  );
  if (!button) return;
  button.focus({ preventScroll: true });
  keepPdfSearchResultVisible(button);
}

function syncPdfSearchStatus(): void {
  const hasMatches = searchMatches.length > 0;
  searchPrevious.disabled = !hasMatches;
  searchNext.disabled = !hasMatches;
  renderPdfSearchResults();
  if (!activeSearchQuery) {
    setSearchStatus('输入关键词');
    return;
  }
  const totalPages = pdfDocument?.numPages ?? 0;
  const indexedPages = searchPageIndexes.size;
  if (hasMatches) {
    const capped = searchMatches.length >= PDF_SEARCH_RESULT_LIMIT;
    const total = `${searchMatches.length}${capped ? '+' : ''}`;
    const progress = searchIndexing && indexedPages < totalPages
      ? ` · ${indexedPages}/${totalPages} 页`
      : '';
    setSearchStatus(`${searchResultIndex + 1} / ${total}${progress}`);
    return;
  }
  if (searchIndexing && indexedPages < totalPages) {
    setSearchStatus(`正在搜索 ${indexedPages}/${totalPages} 页`);
    return;
  }
  const hasSearchableText = searchScope.value === 'translation'
    ? translationSearchIndexes.size > 0
    : [...searchPageIndexes.values()].some((page) => page.text);
  setSearchStatus(hasSearchableText ? '未找到' : '当前文档没有可搜索文字');
}

function updatePdfSearchMatches(preserveCurrent: boolean): void {
  const currentIdentity = preserveCurrent
    ? searchMatchIdentity(searchMatches[searchResultIndex])
    : undefined;
  searchMatches = searchScope.value === 'translation' ? [] : findPdfSearchMatches(searchPageIndexes.values(), activeSearchQuery, PDF_SEARCH_RESULT_LIMIT);
  translationSearchIndexes.clear();
  if (searchScope.value !== 'source') {
    for (const block of pdfDocumentTranslationBlocksState) {
      if (!block.included || block.status !== 'done' || !block.translatedText) continue;
      const index = buildPdfSearchPageIndex(block.pageNumber, [{str: block.formulaDocument ? formulaDocumentText(block.formulaDocument) : block.translatedText}]);
      translationSearchIndexes.set(block.id, index);
      const matches = findPdfSearchMatches([index], activeSearchQuery, Math.max(0, PDF_SEARCH_RESULT_LIMIT - searchMatches.length));
      searchMatches.push(...matches.map(match => ({...match, translationBlockId: block.id})));
    }
    searchMatches.sort((left, right) => left.pageNumber - right.pageNumber);
  }
  const preservedIndex = currentIdentity
    ? searchMatches.findIndex((match) => searchMatchIdentity(match) === currentIdentity)
    : -1;
  searchResultIndex = preservedIndex >= 0 ? preservedIndex : searchMatches.length ? 0 : -1;
  syncPdfSearchStatus();
  refreshPdfSearchHighlights();
}

function navigateToPdfSearchResult(index: number): void {
  const pdf = pdfDocument;
  if ((!pdf&&!cachedReadingContext) || !searchMatches.length) return;
  searchResultIndex = (index + searchMatches.length) % searchMatches.length;
  const match = searchMatches[searchResultIndex]!;
  if (match.translationBlockId) {
    if (documentTranslationPanel.hidden) documentTranslationPanel.hidden = false;
    scrollToPageAnchor({pageNumber: match.pageNumber, ratio: 0});
    updatePageControl({pageNumber: match.pageNumber, ratio: 0});
    syncPdfDocumentTranslationCurrentPage();
    const block = documentTranslationPages.querySelector<HTMLElement>(`[data-translation-block="${match.translationBlockId}"]`);
    if (block) documentTranslationPages.scrollTop += block.getBoundingClientRect().top - documentTranslationPages.getBoundingClientRect().top - 16;
    refreshPdfSearchHighlights();
    syncPdfSearchStatus();
    return;
  }
  if(!pdf)return;
  if (!documentTranslationPanel.hidden && pdfDocumentTranslationViewMode === 'reading') setPdfDocumentTranslationViewMode('compare');
  scrollToPageAnchor({
    pageNumber: match.pageNumber,
    ratio: Math.max(0, match.topRatio - 0.06),
  });
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${match.pageNumber}"]`,
  );
  if (pageElement) {
    requestPageRender(pdf, pageElement, renderGeneration);
    refreshPdfSearchHighlights();
  }
  updatePageControl({ pageNumber: match.pageNumber, ratio: match.topRatio });
  schedulePageRetention();
  syncPdfSearchStatus();
}

function searchTextItemsForTemporaryOcrPage(
  page: CoordinateOcrPage | undefined,
): PdfSearchTextItem[] {
  if (!page) return [];
  return selectableOcrBlocks(page).map((block) => ({
    str: block.text,
    hasEOL: true,
    topRatio: clamp(block.box.top, 0, 1),
  }));
}

async function searchTextItemsForPage(page: PDFPageProxy): Promise<PdfSearchTextItem[]> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const items: PdfSearchTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !normalizePdfSearchText(item.str)) continue;
    const baseline = item.transform[5];
    const topRatio = typeof baseline === 'number' && viewport.height > 0
      ? clamp(1 - baseline / viewport.height, 0, 1)
      : undefined;
    items.push({
      str: item.str,
      ...(item.hasEOL ? { hasEOL: true } : {}),
      ...(topRatio === undefined ? {} : { topRatio }),
    });
  }
  return items.length
    ? items
    : searchTextItemsForTemporaryOcrPage(temporaryOcrPages.get(page.pageNumber));
}

function updatePdfSearchIndexFromTemporaryOcrPage(
  pageNumber: number,
  page: CoordinateOcrPage,
): void {
  const hadMatches = searchMatches.length > 0;
  searchPageIndexes.set(
    pageNumber,
    buildPdfSearchPageIndex(pageNumber, searchTextItemsForTemporaryOcrPage(page)),
  );
  if (!activeSearchQuery) return;
  updatePdfSearchMatches(true);
  if (!searchPanel.hidden && !hadMatches && searchMatches.length) {
    navigateToPdfSearchResult(searchResultIndex);
  }
}

function yieldSearchIndexing(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function startPdfSearchIndexing(): void {
  const pdf = pdfDocument;
  if (!pdf || !activeSearchQuery || searchPanel.hidden || searchIndexing || searchScope.value === 'translation') return;
  const epoch = documentEpoch;
  const runId = ++searchIndexRunId;
  searchIndexing = true;
  syncPdfSearchStatus();
  void (async () => {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (
        runId !== searchIndexRunId ||
        pdfDocument !== pdf ||
        documentEpoch !== epoch ||
        searchPanel.hidden ||
        !activeSearchQuery
      ) return;
      if (!searchPageIndexes.has(pageNumber)) {
        let index: PdfSearchPageIndex;
        try {
          const page = await pdf.getPage(pageNumber);
          if (runId !== searchIndexRunId || pdfDocument !== pdf || documentEpoch !== epoch) return;
          index = buildPdfSearchPageIndex(pageNumber, await searchTextItemsForPage(page));
        } catch {
          index = buildPdfSearchPageIndex(pageNumber, []);
        }
        if (runId !== searchIndexRunId || pdfDocument !== pdf || documentEpoch !== epoch) return;
        const hadMatches = searchMatches.length > 0;
        searchPageIndexes.set(pageNumber, index);
        updatePdfSearchMatches(true);
        if (!hadMatches && searchMatches.length) navigateToPdfSearchResult(searchResultIndex);
      }
      await yieldSearchIndexing();
    }
    if (runId !== searchIndexRunId) return;
    searchIndexing = false;
    syncPdfSearchStatus();
  })().catch(() => {
    if (runId !== searchIndexRunId) return;
    searchIndexing = false;
    syncPdfSearchStatus();
  });
}

function applyPdfSearchQuery(): void {
  const nextQuery = normalizePdfSearchText(searchQuery.value);
  if (nextQuery === activeSearchQuery) {
    if (nextQuery) startPdfSearchIndexing();
    return;
  }
  activeSearchQuery = nextQuery;
  stopSearchIndexing();
  updatePdfSearchMatches(false);
  if (searchMatches.length) navigateToPdfSearchResult(0);
  if (activeSearchQuery) startPdfSearchIndexing();
}

function openPdfSearch(): void {
  if (!pdfDocument&&!cachedReadingContext) return;
  const returnFocus = !outlinePanel.hidden
    ? openOutline
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  closePdfOutline(false);
  const view = documentTranslationPanel.hidden ? 'source' : pdfDocumentTranslationViewMode;
  if (view !== searchViewContext) {
    searchViewContext = view;
    searchScope.value = view === 'reading' ? 'translation' : view === 'compare' ? 'all' : 'source';
    stopSearchIndexing();
    updatePdfSearchMatches(false);
  }
  if (searchPanel.hidden) {
    searchReturnFocus = returnFocus;
    searchPanel.hidden = false;
  }
  searchQuery.focus({ preventScroll: true });
  searchQuery.select();
  applyPdfSearchQuery();
  syncPdfSearchStatus();
}

function closePdfSearch(restoreFocus = true): void {
  if (searchPanel.hidden) return;
  searchPanel.hidden = true;
  stopSearchIndexing();
  refreshPdfSearchHighlights();
  renderPdfSearchResults();
  if (restoreFocus) {
    const target = searchReturnFocus?.isConnected ? searchReturnFocus : stage;
    const menu = target.closest<HTMLDetailsElement>('details:not([open])');
    (menu?.querySelector<HTMLElement>(':scope > summary') ?? target).focus({ preventScroll: true });
  }
  searchReturnFocus = undefined;
}

function resetPdfSearch(): void {
  closePdfSearch(false);
  stopSearchIndexing();
  searchPageIndexes.clear();
  searchMatches = [];
  searchResultIndex = -1;
  activeSearchQuery = '';
  searchQuery.value = '';
  searchReturnFocus = undefined;
  searchResultsExpanded = true;
  searchViewContext = '';
  searchScope.value = 'source';
  syncPdfSearchStatus();
}

openSearch.addEventListener('click', openPdfSearch);
searchClose.addEventListener('click', () => closePdfSearch());
searchPrevious.addEventListener('click', () => navigateToPdfSearchResult(searchResultIndex - 1));
searchNext.addEventListener('click', () => navigateToPdfSearchResult(searchResultIndex + 1));
searchResultsToggle.addEventListener('click', () => {
  searchResultsExpanded = !searchResultsExpanded;
  renderPdfSearchResults();
});
searchResults.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('.pdf-search-result[data-search-result-index]')
    : null;
  const index = Number(button?.dataset.searchResultIndex);
  if (!button || !Number.isInteger(index)) return;
  navigateToPdfSearchResult(index);
  focusPdfSearchResult(index);
});
searchResults.addEventListener('keydown', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('.pdf-search-result[data-search-result-index]')
    : null;
  const currentIndex = Number(button?.dataset.searchResultIndex);
  if (!button || !Number.isInteger(currentIndex) || !searchMatches.length) return;
  let nextIndex: number | undefined;
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % searchMatches.length;
  else if (event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + searchMatches.length) % searchMatches.length;
  } else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = searchMatches.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  navigateToPdfSearchResult(nextIndex);
  focusPdfSearchResult(nextIndex);
});
searchQuery.addEventListener('input', applyPdfSearchQuery);
searchScope.addEventListener('change', () => {
  stopSearchIndexing();
  updatePdfSearchMatches(false);
  if (searchMatches.length) navigateToPdfSearchResult(0);
  startPdfSearchIndexing();
});
searchQuery.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' || !searchMatches.length || !searchResultsExpanded) return;
  event.preventDefault();
  focusPdfSearchResult(Math.max(0, searchResultIndex));
});
// Register before the selection overlay's window capture handler so Escape in
// the active PDF search closes search rather than collapsing the idle sidebar.
window.addEventListener('keydown', (event) => {
  if(paragraphEditor.open||pdfHistoryDialog.open||pdfTermsDialog.open)return;
  const searchShortcut = (event.ctrlKey || event.metaKey) &&
    !event.altKey && event.key.toLocaleLowerCase() === 'f';
  if (searchShortcut && (pdfDocument||cachedReadingContext)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPdfSearch();
    return;
  }
  if (searchPanel.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePdfSearch();
    return;
  }
  if (event.key === 'Enter' && event.target === searchQuery) {
    event.preventDefault();
    event.stopImmediatePropagation();
    navigateToPdfSearchResult(searchResultIndex + (event.shiftKey ? -1 : 1));
  }
}, true);

openOutline.addEventListener('click', () => {
  if (outlinePanel.hidden) openPdfOutline();
  else closePdfOutline();
});
outlineClose.addEventListener('click', () => closePdfOutline());
outlineTab.addEventListener('click', () => setPdfNavigationView('outline'));
bookmarksTab.addEventListener('click', () => setPdfNavigationView('bookmarks'));
for (const tab of [outlineTab, bookmarksTab]) {
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (outlineTab.hidden) {
      setPdfNavigationView('bookmarks', true);
      return;
    }
    setPdfNavigationView(
      event.key === 'ArrowLeft' || event.key === 'Home' ? 'outline' : 'bookmarks',
      true,
    );
  });
}
bookmarkAdd.addEventListener('click', addCurrentPdfBookmark);
bookmarkList.addEventListener('keydown', (event) => {
  const jump = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('.pdf-bookmark-jump')
    : null;
  if (!jump) return;
  const actions = [...bookmarkList.querySelectorAll<HTMLButtonElement>('.pdf-bookmark-jump')];
  const currentIndex = actions.indexOf(jump);
  let nextIndex: number | undefined;
  if (event.key === 'ArrowDown') nextIndex = Math.min(actions.length - 1, currentIndex + 1);
  else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = actions.length - 1;
  if (nextIndex === undefined || nextIndex === currentIndex) return;
  event.preventDefault();
  actions[nextIndex]?.focus({ preventScroll: true });
});
outlineTree.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const toggle = target?.closest<HTMLButtonElement>('.pdf-outline-toggle[data-outline-toggle-id]');
  if (toggle?.dataset.outlineToggleId) {
    togglePdfOutlineEntry(toggle.dataset.outlineToggleId);
    return;
  }
  const action = target?.closest<HTMLButtonElement>('.pdf-outline-action[data-outline-id]');
  const entry = action?.dataset.outlineId
    ? pdfOutlineEntryMap.get(action.dataset.outlineId)
    : undefined;
  if (entry) navigateToPdfOutlineEntry(entry);
});
outlineTree.addEventListener('keydown', (event) => {
  const action = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('.pdf-outline-action[data-outline-id]')
    : null;
  const entry = action?.dataset.outlineId
    ? pdfOutlineEntryMap.get(action.dataset.outlineId)
    : undefined;
  if (!action || !entry) return;
  const actions = [...outlineTree.querySelectorAll<HTMLButtonElement>('.pdf-outline-action')];
  const actionIndex = actions.indexOf(action);
  let focusTarget: HTMLButtonElement | undefined;
  if (event.key === 'ArrowDown') {
    focusTarget = actions[Math.min(actions.length - 1, actionIndex + 1)];
  } else if (event.key === 'ArrowUp') {
    focusTarget = actions[Math.max(0, actionIndex - 1)];
  } else if (event.key === 'Home') {
    focusTarget = actions[0];
  } else if (event.key === 'End') {
    focusTarget = actions.at(-1);
  } else if (event.key === 'ArrowRight' && entry.children.length) {
    if (!pdfOutlineExpandedIds.has(entry.id)) {
      event.preventDefault();
      togglePdfOutlineEntry(entry.id);
      return;
    }
    focusTarget = actions.find((candidate) => (
      pdfOutlineEntryMap.get(candidate.dataset.outlineId ?? '')?.parentId === entry.id
    ));
  } else if (event.key === 'ArrowLeft') {
    if (entry.children.length && pdfOutlineExpandedIds.has(entry.id)) {
      event.preventDefault();
      togglePdfOutlineEntry(entry.id);
      return;
    }
    focusTarget = entry.parentId
      ? outlineTree.querySelector<HTMLButtonElement>(
          `.pdf-outline-action[data-outline-id="${entry.parentId}"]`,
        ) ?? undefined
      : undefined;
  }
  if (!focusTarget) return;
  event.preventDefault();
  focusTarget.focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (outlinePanel.hidden || event.key !== 'Escape') return;
  if (editingPdfBookmarkId) {
    event.preventDefault();
    event.stopImmediatePropagation();
    editingPdfBookmarkId = undefined;
    renderPdfBookmarks();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  closePdfOutline();
}, true);

function evictPage(pageElement: HTMLElement): void {
  if (activeRegion?.pageElement === pageElement) return;
  pageRenderRevisions.set(pageElement, (pageRenderRevisions.get(pageElement) ?? 0) + 1);
  activeRenderTasks.get(pageElement)?.cancel();
  activeRenderTasks.delete(pageElement);
  activeTextLayerBuilders.get(pageElement)?.cancel();
  activeTextLayerBuilders.delete(pageElement);
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  pageElement.querySelector<HTMLElement>('.textLayer')?.replaceChildren();
  pageElement.querySelector<HTMLElement>('.pdf-link-layer')?.replaceChildren();
  delete pageElement.dataset.rendered;
  delete pageElement.dataset.hasText;
  delete pageElement.dataset.linkCount;
  pageElement.removeAttribute('title');
}

function retainNearbyPages(): void {
  retentionFrame = undefined;
  if (!pdfDocument) return;
  const anchor = visiblePageAnchor();
  updatePageControl(anchor);
  const pdf = pdfDocument;
  const generation = renderGeneration;
  for (const page of viewer.querySelectorAll<HTMLElement>('.pdf-page')) {
    const pageNumber = Number(page.dataset.pageNumber);
    if (Math.abs(pageNumber - anchor.pageNumber) <= RETAINED_PAGE_RADIUS) {
      requestPageRender(pdf, page, generation);
    } else if (page.dataset.rendered) {
      evictPage(page);
    }
  }
}

function schedulePageRetention(): void {
  if (retentionFrame !== undefined) return;
  retentionFrame = requestAnimationFrame(retainNearbyPages);
}

function updatePageDimensions(
  pageElement: HTMLElement,
  width: number,
  height: number,
): void {
  const widthChanged = Math.abs(pageElement.offsetWidth - width) > 0.5;
  const heightChanged = Math.abs(pageElement.offsetHeight - height) > 0.5;
  if (!widthChanged && !heightChanged) return;
  const anchor = visiblePageAnchor();
  pageElement.style.width = `${width}px`;
  pageElement.style.height = `${height}px`;
  scrollToPageAnchor(anchor);
}

function requestPageRender(
  pdf: PDFDocumentProxy,
  pageElement: HTMLElement,
  generation: number,
): void {
  if (pageElement.dataset.rendered === 'error') {
    delete pageElement.dataset.rendered;
    pageElement.removeAttribute('title');
  }
  if (pageElement.dataset.rendered) return;
  const pageRevision = (pageRenderRevisions.get(pageElement) ?? 0) + 1;
  pageRenderRevisions.set(pageElement, pageRevision);
  pageElement.dataset.rendered = 'queued';
  const pageNumber = Number(pageElement.dataset.pageNumber);
  void pdf.getPage(pageNumber)
    .then((page) => renderPage(pdf, page, pageElement, generation, pageRevision))
    .catch((error: unknown) => {
      if (
        generation !== renderGeneration ||
        !['queued', 'loading'].includes(pageElement.dataset.rendered ?? '')
      ) return;
      pageElement.dataset.rendered = 'error';
      pageElement.title = error instanceof Error ? error.message : String(error);
    });
}

function positionedPdfLinkRect(
  rect: [number, number, number, number],
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): { left: number; top: number; width: number; height: number } | undefined {
  const converted = viewport.convertToViewportRectangle(rect).map(Number);
  if (converted.length !== 4 || converted.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  const left = clamp(Math.min(converted[0]!, converted[2]!), 0, viewport.width);
  const right = clamp(Math.max(converted[0]!, converted[2]!), 0, viewport.width);
  const top = clamp(Math.min(converted[1]!, converted[3]!), 0, viewport.height);
  const bottom = clamp(Math.max(converted[1]!, converted[3]!), 0, viewport.height);
  if (right - left < 1 || bottom - top < 1) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

async function resolvedPdfLinkAction(
  pdf: PDFDocumentProxy,
  action: SafePdfLinkAction,
  sourcePageNumber: number,
): Promise<
  | { kind: 'external'; url: string }
  | { kind: 'internal'; target: ResolvedPdfLinkDestination }
  | undefined
> {
  if (action.kind === 'external') return action;
  if (action.kind === 'named') {
    const target = namedPdfLinkDestination(action.action, sourcePageNumber);
    return target ? { kind: 'internal', target } : undefined;
  }
  const target = await resolvePdfLinkDestination(pdf, action.destination).catch(() => undefined);
  return target ? { kind: 'internal', target } : undefined;
}

async function renderPdfLinkLayer(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  pageElement: HTMLElement,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  annotations: readonly unknown[],
  generation: number,
  pageRevision: number,
): Promise<void> {
  const isCurrent = (): boolean => (
    pdfDocument === pdf &&
    generation === renderGeneration &&
    pageRenderRevisions.get(pageElement) === pageRevision &&
    pageElement.dataset.rendered === 'ready'
  );
  if (!isCurrent()) return;
  const runtime = pdfRuntime;
  const layer = pageElement.querySelector<HTMLElement>('.pdf-link-layer');
  if (!runtime || !layer) return;
  const links = safePdfLinkAnnotations(
    annotations,
    runtime.AnnotationType.LINK,
    currentSourceUrl,
  );
  const prepared = await Promise.all(links.map(async (link) => ({
    link,
    action: await resolvedPdfLinkAction(pdf, link.action, page.pageNumber),
  })));
  if (!isCurrent()) return;
  const fragment = document.createDocumentFragment();
  let renderedCount = 0;
  for (const { link, action } of prepared) {
    if (!action) continue;
    const bounds = positionedPdfLinkRect(link.rect, viewport);
    if (!bounds) continue;
    const anchor = document.createElement('a');
    anchor.dataset.pdfLinkId = link.id;
    anchor.dataset.pdfLinkKind = action.kind;
    anchor.style.left = `${bounds.left}px`;
    anchor.style.top = `${bounds.top}px`;
    anchor.style.width = `${bounds.width}px`;
    anchor.style.height = `${bounds.height}px`;
    if (action.kind === 'external') {
      const hostname = new URL(action.url).hostname;
      anchor.href = action.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer nofollow';
      anchor.referrerPolicy = 'no-referrer';
      anchor.title = `打开外部链接：${hostname}`;
      anchor.setAttribute('aria-label', anchor.title);
    } else {
      anchor.href = `#page=${action.target.pageNumber}`;
      anchor.title = `跳转到${action.target.destinationLabel}`;
      anchor.setAttribute('aria-label', anchor.title);
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        jumpToPdfLinkDestination(action.target, true, event.detail === 0);
      });
      anchor.addEventListener('auxclick', (event) => event.preventDefault());
    }
    fragment.append(anchor);
    renderedCount += 1;
  }
  layer.replaceChildren(fragment);
  pageElement.dataset.linkCount = String(renderedCount);
}

async function renderPage(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  pageElement: HTMLElement,
  generation: number,
  pageRevision: number,
): Promise<void> {
  if (
    (pageElement.dataset.rendered && pageElement.dataset.rendered !== 'queued') ||
    generation !== renderGeneration ||
    pageRenderRevisions.get(pageElement) !== pageRevision
  ) return;
  const isCurrentPageRender = (): boolean => (
    generation === renderGeneration &&
    pageRenderRevisions.get(pageElement) === pageRevision
  );
  pageElement.dataset.rendered = 'loading';
  const scale = currentZoom();
  const viewport = page.getViewport({ scale });
  updatePageDimensions(pageElement, viewport.width, viewport.height);
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  const textContainer = pageElement.querySelector<HTMLElement>('.textLayer');
  if (!canvas || !textContainer) return;

  // Render above the CSS pixel density so thin paper fonts stay crisp at the
  // default zoom. Pages are lazy-rendered, and the dimension cap prevents an
  // unusually large page or zoom level from exhausting canvas memory.
  const desiredOutputScale = Math.min(
    Math.max((window.devicePixelRatio || 1) * 1.35, 2),
    3,
  );
  const outputScale = Math.min(
    desiredOutputScale,
    8192 / Math.max(viewport.width, 1),
    8192 / Math.max(viewport.height, 1),
    Math.sqrt(
      MAX_PAGE_CANVAS_PIXELS /
      Math.max(viewport.width * viewport.height, 1),
    ),
  );
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas rendering is unavailable.');

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    ...(outputScale === 1
      ? {}
      : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
  });
  activeRenderTasks.set(pageElement, renderTask);
  const TextLayerBuilder = pdfRuntime?.TextLayerBuilder;
  if (!TextLayerBuilder) throw new Error('PDF 阅读组件尚未加载。');
  const textLayerBuilder = new TextLayerBuilder({ pdfPage: page });
  activeTextLayerBuilders.get(pageElement)?.cancel();
  activeTextLayerBuilders.set(pageElement, textLayerBuilder);
  textContainer.replaceWith(textLayerBuilder.div);
  const annotationsPromise = page.getAnnotations({ intent: 'display' }).catch(() => []);
  try {
    await Promise.all([
      renderTask.promise,
      textLayerBuilder.render({ viewport }),
    ]);
    if (!isCurrentPageRender()) return;
    pageElement.dataset.rendered = 'ready';
    const hasNativeText = Boolean(textLayerBuilder.div.textContent?.trim());
    const temporaryOcrCount = hasNativeText
      ? 0
      : renderTemporaryOcrTextLayer(
          pageElement,
          temporaryOcrPages.get(page.pageNumber),
        );
    const hasText = hasNativeText || temporaryOcrCount > 0;
    pageElement.dataset.hasText = String(hasText);
    void annotationsPromise.then((annotations) => renderPdfLinkLayer(
      pdf,
      page,
      pageElement,
      viewport,
      annotations,
      generation,
      pageRevision,
    )).catch(() => {
      if (isCurrentPageRender()) pageElement.dataset.linkCount = '0';
    });
    if (!hasText && !scanHintShownForDocument && !isRegionModeActive()) {
      scanHintShownForDocument = true;
      showNotice('可能是扫描版 PDF', {
        transient: true,
        tone: 'warning',
        sourceOnly: true,
        action: {
          label: '识别本页',
          ariaLabel: `识别第 ${pageElement.dataset.pageNumber ?? '当前'} 页并生成临时文字层`,
          onClick: () => createPageRecognitionRegion(pageElement),
        },
      });
    }
    refreshPdfSearchHighlights();
    schedulePageRetention();
  } finally {
    if (activeRenderTasks.get(pageElement) === renderTask) {
      activeRenderTasks.delete(pageElement);
    }
    if (!isCurrentPageRender() && activeTextLayerBuilders.get(pageElement) === textLayerBuilder) {
      textLayerBuilder.cancel();
      activeTextLayerBuilders.delete(pageElement);
    }
  }
}

async function buildPages(
  pdf: PDFDocumentProxy,
  targetAnchor: PageAnchor = { pageNumber: 1, ratio: 0 },
): Promise<void> {
  clearDocument();
  const generation = renderGeneration;
  const scale = currentZoom();
  viewer.style.setProperty('--scale-factor', String(scale));
  viewer.hidden = false;
  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pageElement = entry.target as HTMLElement;
        requestPageRender(pdf, pageElement, generation);
      }
    },
    { root: stage, rootMargin: '900px 0px' },
  );

  const firstPage = await pdf.getPage(1);
  if (generation !== renderGeneration) return;
  const defaultViewport = firstPage.getViewport({ scale });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageElement = document.createElement('article');
    pageElement.className = 'pdf-page';
    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.ariaLabel = `第 ${pageNumber} 页`;
    pageElement.style.width = `${defaultViewport.width}px`;
    pageElement.style.height = `${defaultViewport.height}px`;
    const canvas = document.createElement('canvas');
    canvas.ariaHidden = 'true';
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    const linkLayer = document.createElement('div');
    linkLayer.className = 'pdf-link-layer';
    pageElement.append(canvas, textLayer, linkLayer);
    viewer.append(pageElement);
    pageObserver.observe(pageElement);
  }
  const safeTargetPage = Math.min(
    pdf.numPages,
    Math.max(1, Math.round(targetAnchor.pageNumber)),
  );
  scrollToPageAnchor({ pageNumber: safeTargetPage, ratio: targetAnchor.ratio });
  updatePageControl({ pageNumber: safeTargetPage, ratio: targetAnchor.ratio });
  schedulePageRetention();
}

async function openPdfData(
  data: Uint8Array,
  name: string,
  operation: DocumentOpenOperation,
  sourceUrl?: string,
  initialPage?: number,
  readingIdentity?: string,
): Promise<void> {
  if (!isCurrentOpen(operation)) return;
  setLoading('正在加载阅读组件…', 'runtime');
  let nextDocument: PDFDocumentProxy | undefined;
  const nextPdfBackgroundData = data.slice();
  try {
    const readingStatePromise = readingIdentity
      ? getPdfReadingState(readingIdentity).catch(() => undefined)
      : Promise.resolve(undefined);
    const bookmarkStatePromise = readingIdentity
      ? getPdfReadingBookmarkState(readingIdentity).catch(() => ({ bookmarks: [], updatedAt: 0 }))
      : Promise.resolve({ bookmarks: [], updatedAt: 0 });
    const runtime = await loadPdfRuntime();
    if (!isCurrentOpen(operation)) return;
    setLoading('正在解析 PDF…', 'parsing');
    const task = runtime.getDocument({ data, isEvalSupported: false });
    openLoadingTask = task;
    nextDocument = await task.promise;
    if (!isCurrentOpen(operation)) {
      await nextDocument.destroy();
      return;
    }
    openLoadingTask = undefined;
    let [restoredState, restoredBookmarks] = await Promise.all([
      readingStatePromise,
      bookmarkStatePromise,
    ]);
    if (!isCurrentOpen(operation)) {
      await nextDocument.destroy();
      return;
    }
    pdfDocument = nextDocument;
    currentPdfBackgroundData = nextPdfBackgroundData;
    const digest=await crypto.subtle.digest('SHA-256',nextPdfBackgroundData);
    if(!isCurrentOpen(operation))return;
    currentPdfContentFingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    restoredState = await getPdfReadingState(`pdf-content:${currentPdfContentFingerprint}`).catch(()=>undefined) ?? restoredState;
    const contentBookmarks=await getPdfReadingBookmarkState(`pdf-content:${currentPdfContentFingerprint}`).catch(()=>undefined);
    if(contentBookmarks&&contentBookmarks.updatedAt>=restoredBookmarks.updatedAt)restoredBookmarks=contentBookmarks;
    if(!isCurrentOpen(operation))return;
    pdfTranslationReadingAnchor=restoredState?.translation;
    libraryRestoreDocumentKey=undefined;
    currentReadingIdentity = readingIdentity;
    pdfReadingBookmarks = restoredBookmarks.bookmarks;
    renderPdfBookmarks();
    restoringReadingState = Boolean(restoredState);
    zoomLevel = restoredState?.zoomLevel ?? 1.25;
    fitWidthActive = restoredState?.fitWidth ?? false;
    scanHintShownForDocument = false;
    currentSourceUrl = sourceUrl ?? location.href;
    currentSourceLabel = sourceUrl ? undefined : name;
    documentName.textContent = name;
    documentName.title = name;
    documentName.closest<HTMLElement>('.brand')?.setAttribute('title', name);
    document.title = `${name} - Pi PDF`;
    pageJump.hidden = false;
    pageCount.value = String(nextDocument.numPages);
    pageNumberInput.max = String(nextDocument.numPages);
    const targetPage = clamp(
      Math.round(initialPage ?? restoredState?.pageNumber ?? 1),
      1,
      nextDocument.numPages,
    );
    const targetRatio = initialPage === undefined ? restoredState?.pageRatio ?? 0 : 0;
    pageNumberInput.value = String(targetPage);
    setDocumentControls(true);
    setLoading('正在准备页面…', 'pages');
    await buildPages(nextDocument, { pageNumber: targetPage, ratio: targetRatio });
    if (!isCurrentOpen(operation)) return;
    void loadPdfOutline(nextDocument, operation.epoch);
    restoringReadingState = false;
    const controller = await selectionTranslator;
    if (!isCurrentOpen(operation)) return;
    await controller.refreshPersistentMarkers();
    if (!isCurrentOpen(operation)) return;
    if (restoredState?.sidebarExpanded) {
      if (isCurrentOpen(operation)) controller.openSidebar();
    }
    if (fitWidthActive) scheduleFitWidthRefresh();
    scheduleReadingStateSave();
    if(libraryRestoreId)await restorePdfLibraryReading();
  } catch (error) {
    if (!isCurrentOpen(operation)) return;
    if (pdfDocument === nextDocument) {
      pdfDocument = undefined;
      currentPdfBackgroundData = undefined;
    }
    if (nextDocument) void nextDocument.destroy().catch(() => undefined);
    emptyState.hidden = false;
    viewer.hidden = true;
    pageJump.hidden = true;
    setDocumentControls(false);
    showNotice(pdfOpenErrorMessage(error), {
      tone: 'error',
    });
  } finally {
    if (openLoadingTask && isCurrentOpen(operation)) openLoadingTask = undefined;
    completeDocumentOpen(operation);
  }
}

async function restorePdfLibraryReading():Promise<void>{
  try{
    const saved=(await listRetainedPdfDocumentTranslations()).find(record=>retainedDocumentId('pdf',record)===libraryRestoreId);
    if(!saved)throw new Error('这份译文已被移除，请返回文档库刷新。');
    if(saved.sourceFingerprint?saved.sourceFingerprint!==currentPdfContentFingerprint:saved.documentKey!==pdfDocumentTranslationSessionDocumentKey(currentReadingIdentity??''))throw new Error('这不是保留译文对应的原 PDF。请选择原文件；尚未改动保留记录。');
    libraryRestoreDocumentKey=saved.documentKey;
    pdfDocumentTranslationSettings={...pdfDocumentTranslationSettings,targetLanguage:saved.targetLanguage,sourceLanguage:saved.sourceLanguage,style:saved.style,contentMode:saved.contentMode};
    await openPdfDocumentTranslation();
    const signatures=pdfDocumentTranslationBlocksState.map(block=>block.sessionSignature);
    if(!pdfTranslationSourceCompatible(saved,signatures,currentPdfContentFingerprint))throw new Error('文件内容或段落结构与保留记录不一致，未套用旧译文。');
    pdfDocumentTranslationArchivedBlocks=archivedPdfTranslationBlocks(saved,signatures,currentPdfContentFingerprint);
    const bySignature=new Map(reusablePdfTranslationBlocks(saved,signatures,currentPdfContentFingerprint).map(block=>[block.signature,block]));
    for(const block of pdfDocumentTranslationBlocksState){
      const result=bySignature.get(block.sessionSignature);if(!result||block.status==='done')continue;
      const formulaDocument=result.formulaDocument&&bindPdfEquationNumbers(result.formulaDocument,block.sourceEquations);
      block.status=result.retranslation?'idle':'done';
      if(result.retranslation)block.retranslation=true;
      if(result.manualCorrection)block.manualCorrection=true;
      if(result.revisions)block.revisions=result.revisions;
      if(!result.pageNumber)block.omitReadingMetadata=true;
      block.translatedText=formulaDocument?formulaDocumentText(formulaDocument):result.translatedText;
      if(formulaDocument)block.formulaDocument=formulaDocument;
      const review=mergePdfFormulaReviewMessage(result.formulaReviewMessage,formulaDocument);
      if(review)block.formulaReviewMessage=review;
      if(result.formulaReviewDraft)block.formulaReviewDraft=true;
      if(result.visualFallbackMessage)block.visualFallbackMessage=result.visualFallbackMessage;
      if(result.reviewConfirmation)block.reviewConfirmation=result.reviewConfirmation;
      reviewRestoredPdfTranslationProse(block);
      if(pdfDocumentTranslationUsesUnifiedVision()&&!block.formulaReviewMessage&&!block.visualFallbackMessage)block.visualProcessed=true;
      renderPdfDocumentTranslationBlock(block);
    }
    pdfDocumentTranslationSessionContext=currentPdfDocumentTranslationSessionContext();
    pdfDocumentTranslationRetainedLocally=true;
    preservePdfDocumentTranslationReferenceEntries();
    const scoped=pdfDocumentTranslationBlocksState.filter(block=>block.included);
    pdfDocumentTranslationPhase=scoped.every(block=>block.status==='done')?'complete':'paused';
    pdfDocumentTranslationMessage=`已从文档库恢复 ${scoped.filter(block=>block.status==='done').length}/${scoped.length} 段`;
    if(scoped.some(block=>block.status==='done'))documentTranslationSettings.open=false;
    const requestedSignature=new URL(location.href).searchParams.get('block');
    const requestedBlock=pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===requestedSignature);
    if(requestedBlock)pdfTranslationReadingAnchor={mode:'reading',signature:requestedBlock.sessionSignature,pageNumber:requestedBlock.pageNumber,offsetRatio:0};
    syncPdfDocumentTranslationUi();setPdfDocumentTranslationViewMode(pdfTranslationReadingAnchor?.mode??'reading');
    restorePdfTranslationReadingAnchor();
    libraryRestoreId=undefined;
    const url=new URL(location.href);url.searchParams.delete('restore');url.searchParams.delete('block');history.replaceState(null,'',url);
    await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState,true);
  }catch(error){
    libraryRestoreDocumentKey=undefined;
    pdfDocumentTranslationSessionContext=currentPdfDocumentTranslationSessionContext();
    pdfDocumentTranslationRetainedLocally=false;
    showNotice(error instanceof Error?error.message:'恢复失败，请重新选择原文件。',{tone:'error'});
  }
}

async function openLocalFile(file: File): Promise<void> {
  const validation = validateLocalPdfFiles([file]);
  if (!validation.ok) {
    showNotice(validation.message, { transient: true, tone: 'warning' });
    return;
  }
  try {
    const prefix = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (!hasPdfFileSignature(prefix)) {
      showNotice('无法打开 PDF：文件可能已损坏，或并不是有效的 PDF。', {
        tone: 'error',
      });
      return;
    }
  } catch (error) {
    showNotice(error instanceof Error ? `无法读取 PDF：${error.message}` : '无法读取这个 PDF。', {
      tone: 'error',
    });
    return;
  }
  const operation = beginDocumentOpen('正在读取本地 PDF…', 'reading-local');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isCurrentOpen(operation)) return;
    await openPdfData(
      data,
      file.name,
      operation,
      undefined,
      undefined,
      `local:${file.name}:${file.size}:${file.lastModified}`,
    );
  } catch (error) {
    if (!isCurrentOpen(operation)) return;
    emptyState.hidden = false;
    showNotice(error instanceof Error ? `无法读取 PDF：${error.message}` : '无法读取这个 PDF。', {
      tone: 'error',
    });
    completeDocumentOpen(operation);
  }
}

function pageRegionBounds(selection: ActiveRegionSelection): RegionRect {
  const pageBounds = selection.pageElement.getBoundingClientRect();
  return normalizeRegion({ x: 0, y: 0 }, { x: pageBounds.width, y: pageBounds.height }, {
    left: 0,
    top: 0,
    width: pageBounds.width,
    height: pageBounds.height,
  });
}

function positionRegionConfirmation(selection: ActiveRegionSelection): void {
  const confirmation = selection.confirm;
  if (!confirmation) return;
  const pageBounds = selection.pageElement.getBoundingClientRect();
  const popupWidth = confirmation.offsetWidth;
  const popupHeight = confirmation.offsetHeight;
  const left = Math.min(
    Math.max(4, selection.region.right - popupWidth),
    Math.max(4, pageBounds.width - popupWidth - 4),
  );
  const top = selection.region.bottom + popupHeight + 5 <= pageBounds.height
    ? selection.region.bottom + 5
    : Math.max(4, selection.region.top - popupHeight - 5);
  confirmation.style.left = `${left}px`;
  confirmation.style.top = `${top}px`;
}

function renderRegionBox(selection: ActiveRegionSelection): void {
  const bounds = pageRegionBounds(selection);
  const handleRadius = 16;
  selection.box.style.left = `${selection.region.left}px`;
  selection.box.style.top = `${selection.region.top}px`;
  selection.box.style.width = `${selection.region.width}px`;
  selection.box.style.height = `${selection.region.height}px`;
  selection.box.classList.toggle('edge-left', selection.region.left <= handleRadius);
  selection.box.classList.toggle('edge-top', selection.region.top <= handleRadius);
  selection.box.classList.toggle(
    'edge-right',
    selection.region.right >= bounds.width - handleRadius,
  );
  selection.box.classList.toggle(
    'edge-bottom',
    selection.region.bottom >= bounds.height - handleRadius,
  );
  positionRegionConfirmation(selection);
}

function updateRegionFromPointer(selection: ActiveRegionSelection, point: Point): void {
  const interaction = selection.interaction;
  if (!interaction) return;
  const bounds = pageRegionBounds(selection);
  if (interaction.kind === 'draw') {
    selection.region = normalizeRegion(interaction.start, point, bounds);
  } else if (interaction.kind === 'move') {
    selection.region = moveRegion(
      interaction.initialRegion,
      { x: point.x - interaction.start.x, y: point.y - interaction.start.y },
      bounds,
    );
  } else {
    const resizePoint = {
      x: (interaction.handle.includes('w')
        ? interaction.initialRegion.left
        : interaction.initialRegion.right) + point.x - interaction.start.x,
      y: (interaction.handle.includes('n')
        ? interaction.initialRegion.top
        : interaction.initialRegion.bottom) + point.y - interaction.start.y,
    };
    selection.region = resizeRegion(
      interaction.initialRegion,
      interaction.handle,
      resizePoint,
      bounds,
    );
  }
  renderRegionBox(selection);
}

function pointWithinPage(event: PointerEvent, pageElement: HTMLElement): Point {
  const bounds = pageElement.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function createActiveRegion(
  pageElement: HTMLElement,
  canvas: HTMLCanvasElement,
  region: RegionRect,
  interaction?: RegionInteraction,
  purpose: ActiveRegionSelection['purpose'] = 'translate',
): ActiveRegionSelection {
  clearRegionSelection();
  const box = document.createElement('div');
  box.className = 'region-selection-box';
  pageElement.append(box);
  const selection: ActiveRegionSelection = {
    documentEpoch,
    pageElement,
    canvas,
    region,
    purpose,
    box,
    interaction,
  };
  activeRegion = selection;
  renderRegionBox(selection);
  return selection;
}

function createKeyboardRegion(): void {
  const anchor = visiblePageAnchor();
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${anchor.pageNumber}"][data-rendered="ready"]`,
  ) ?? viewer.querySelector<HTMLElement>('.pdf-page[data-rendered="ready"]');
  const canvas = pageElement?.querySelector<HTMLCanvasElement>('canvas');
  if (!pageElement || !canvas) {
    showNotice('页面仍在渲染，请稍后再试。', { transient: true, tone: 'warning' });
    return;
  }
  const bounds = pageElement.getBoundingClientRect();
  const width = Math.max(18, Math.min(bounds.width * 0.62, bounds.width - 24));
  const height = Math.max(18, Math.min(bounds.height * 0.38, bounds.height - 24));
  const left = Math.max(0, (bounds.width - width) / 2);
  const top = Math.max(0, bounds.height * clamp(anchor.ratio, 0, 1) - height / 2);
  const region = normalizeRegion(
    { x: left, y: top },
    { x: left + width, y: top + height },
    { left: 0, top: 0, width: bounds.width, height: bounds.height },
  );
  const selection = createActiveRegion(pageElement, canvas, region);
  createRegionConfirmation(selection);
}

function createPageRecognitionRegion(pageElement: HTMLElement): void {
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  if (pageElement.dataset.rendered !== 'ready' || !canvas) {
    showNotice('页面仍在渲染，请稍后再试。', { transient: true, tone: 'warning' });
    return;
  }
  const bounds = pageElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    showNotice('当前页面不可见，请滚动到页面后重试。', {
      transient: true,
      tone: 'warning',
    });
    return;
  }
  setRegionMode('single');
  const selection = createActiveRegion(
    pageElement,
    canvas,
    suggestedPageRecognitionRegion({ width: bounds.width, height: bounds.height }),
    undefined,
    'page-recognition',
  );
  createRegionConfirmation(
    selection,
    '仅发送本页选定区域；使用同一 Qwen Key 调用 qwen3.5-ocr，可先排除页眉与页脚',
  );
  showNotice(undefined);
}

function sourceLocationForRegion(
  pageNumber: number,
  region: RegionRect,
  pageBounds: Pick<DOMRect, 'width' | 'height'>,
): PdfSourceLocation {
  return {
    documentId: currentDocumentSessionId,
    pageNumber,
    leftRatio: region.left / pageBounds.width,
    topRatio: region.top / pageBounds.height,
    widthRatio: region.width / pageBounds.width,
    heightRatio: region.height / pageBounds.height,
  };
}

function regionViewportRect(selection: ActiveRegionSelection): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const pageBounds = selection.pageElement.getBoundingClientRect();
  return {
    left: pageBounds.left + selection.region.left,
    top: pageBounds.top + selection.region.top,
    right: pageBounds.left + selection.region.right,
    bottom: pageBounds.top + selection.region.bottom,
  };
}

function extractReliableTextFromRegion(
  selection: ActiveRegionSelection,
): string | undefined {
  const pageBounds = selection.pageElement.getBoundingClientRect();
  const items: PositionedPdfText[] = [...selection.pageElement.querySelectorAll<HTMLElement>(
    '.textLayer span',
  )].map((span) => {
    const bounds = span.getBoundingClientRect();
    return {
      text: span.textContent ?? '',
      rect: {
        left: bounds.left - pageBounds.left,
        top: bounds.top - pageBounds.top,
        right: bounds.right - pageBounds.left,
        bottom: bounds.bottom - pageBounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    };
  });
  const extraction = extractPdfRegionText(items, selection.region);
  return extraction.reliable ? extraction.text : undefined;
}

function renderTemporaryOcrTextLayer(
  pageElement: HTMLElement,
  page: CoordinateOcrPage | undefined,
): number {
  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer');
  if (!textLayer) return 0;
  for (const previous of textLayer.querySelectorAll('[data-pi-ocr-block]')) previous.remove();
  if (!page) {
    textLayer.classList.remove('pi-ocr-text-layer');
    return 0;
  }
  const blocks = selectableOcrBlocks(page);
  const pageBounds = pageElement.getBoundingClientRect();
  for (const block of blocks) {
    const span = document.createElement('span');
    span.dataset.piOcrBlock = block.id;
    span.textContent = block.text;
    span.style.left = `${block.box.left * 100}%`;
    span.style.top = `${block.box.top * 100}%`;
    span.style.fontSize = `${Math.max(6, block.box.height * pageBounds.height * 0.88)}px`;
    textLayer.append(span);
    const naturalWidth = span.getBoundingClientRect().width;
    const targetWidth = block.box.width * pageBounds.width;
    if (naturalWidth > 0 && targetWidth > 0) {
      span.style.transform = `scaleX(${Math.min(4, Math.max(0.25, targetWidth / naturalWidth))})`;
    }
  }
  textLayer.classList.toggle('pi-ocr-text-layer', blocks.length > 0);
  return blocks.length;
}

async function capturePdfFormulaSelection(
  snapshot: SelectionSnapshot,
  padding = 8,
): Promise<ImageRegionTranslationCapture | undefined> {
  if (
    !snapshot.rect ||
    !shouldUseVisionForPdfFormula(snapshot.normalizedText)
  ) return undefined;

  const selection = window.getSelection();
  const pageElement = closestTextLayer(selection?.anchorNode ?? null)
    ?.closest<HTMLElement>('.pdf-page[data-rendered="ready"]');
  const canvas = pageElement?.querySelector<HTMLCanvasElement>('canvas');
  if (!pageElement || !canvas) return undefined;

  const pageBounds = pageElement.getBoundingClientRect();
  const selectionRegion = normalizeRegion(
    {
      x: snapshot.rect.left - pageBounds.left,
      y: snapshot.rect.top - pageBounds.top,
    },
    {
      x: snapshot.rect.right - pageBounds.left,
      y: snapshot.rect.bottom - pageBounds.top,
    },
    { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
  );
  const explicitGesture = explicitFormulaGestureRegion(snapshot, pageElement, selectionRegion);
  const captureRegion = resolvePdfFormulaCaptureRegion(
    selectionRegion,
    explicitGesture,
    { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
  );
  const region = normalizeRegion(
    { x: captureRegion.left - padding, y: captureRegion.top - padding },
    { x: captureRegion.right + padding, y: captureRegion.bottom + padding },
    { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
  );
  if (!isUsableRegion(region, 11)) return undefined;

  const pageNumber = Math.max(1, Number(pageElement.dataset.pageNumber) || 1);
  const capture = await captureCanvasRegion(
    canvas,
    { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
    region,
  );
  return {
    imageDataUrl: capture.dataUrl,
    imageWidth: capture.width,
    imageHeight: capture.height,
    recognizedTextHint: snapshot.normalizedText,
    rect: snapshot.rect,
    pageUrl: currentSourceUrl,
    ...(currentSourceLabel ? { sourceLabel: currentSourceLabel } : {}),
    selectionReference: sourceLocationForRegion(pageNumber, region, pageBounds),
    sourceSelection: snapshot,
  };
}

function waitForPageReady(
  pageElement: HTMLElement,
  expectedDocumentEpoch: number,
): Promise<boolean> {
  if (pageElement.dataset.rendered === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(ready);
    };
    const observer = new MutationObserver(() => {
      if (documentEpoch !== expectedDocumentEpoch || !pageElement.isConnected) finish(false);
      else if (pageElement.dataset.rendered === 'ready') finish(true);
      else if (pageElement.dataset.rendered === 'error') finish(false);
    });
    const timeout = setTimeout(() => finish(false), 3000);
    observer.observe(pageElement, { attributes: true, attributeFilter: ['data-rendered'] });
    observer.observe(viewer, { childList: true });
  });
}

async function pageForSourceLocation(
  reference: PdfSourceLocation,
): Promise<HTMLElement | undefined> {
  if (reference.documentId !== currentDocumentSessionId || !pdfDocument) {
    showNotice('原 PDF 已发生变化，无法恢复这个选区。', {
      transient: true,
      tone: 'warning',
    });
    return undefined;
  }
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${reference.pageNumber}"]`,
  );
  if (!pageElement) {
    showNotice('找不到原选区所在页面。', { transient: true, tone: 'warning' });
    return undefined;
  }
  scrollToPageAnchor({ pageNumber: reference.pageNumber, ratio: reference.topRatio });
  requestPageRender(pdfDocument, pageElement, renderGeneration);
  if (!await waitForPageReady(pageElement, documentEpoch)) {
    if (!pageElement.isConnected) return undefined;
    showNotice('页面尚未渲染完成，请稍后再试。', {
      transient: true,
      tone: 'warning',
    });
    return undefined;
  }
  return pageElement;
}

function regionFromSourceLocation(
  reference: PdfSourceLocation,
  pageElement: HTMLElement,
): RegionRect {
  const width = pageElement.clientWidth;
  const height = pageElement.clientHeight;
  return normalizeRegion(
    { x: reference.leftRatio * width, y: reference.topRatio * height },
    {
      x: (reference.leftRatio + reference.widthRatio) * width,
      y: (reference.topRatio + reference.heightRatio) * height,
    },
    { left: 0, top: 0, width, height },
  );
}

function scrollPdfSourceLocationsIntoView(
  references: readonly PdfSourceLocation[],
  pageElement: HTMLElement,
): void {
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const samePage = references.filter((reference) => reference.pageNumber === pageNumber);
  if (!samePage.length) return;
  const pageHeight = pageElement.offsetHeight;
  const top = Math.min(...samePage.map((reference) => reference.topRatio)) * pageHeight;
  const bottom = Math.max(...samePage.map((reference) => (
    reference.topRatio + reference.heightRatio
  ))) * pageHeight;
  const envelopeHeight = Math.max(0, bottom - top);
  const viewportHeight = stage.clientHeight;
  const padding = 12;
  const targetOffset = envelopeHeight <= Math.max(0, viewportHeight - padding * 2)
    ? top - (viewportHeight - envelopeHeight) / 2
    : top - padding;
  stage.scrollTop = Math.max(0, pageElement.offsetTop + targetOffset);
}

function pdfMarkerRects(reference: PdfSourceLocation): Array<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}> {
  if (reference.documentId !== currentDocumentSessionId) return [];
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${reference.pageNumber}"]`,
  );
  if (!pageElement) return [];
  const pageBounds = pageElement.getBoundingClientRect();
  const region = regionFromSourceLocation(reference, pageElement);
  return [{
    top: pageBounds.top + region.top,
    right: pageBounds.left + region.right,
    bottom: pageBounds.top + region.bottom,
    left: pageBounds.left + region.left,
  }];
}

async function restorePdfRegionSelection(reference: PdfSourceLocation): Promise<void> {
  const pageElement = await pageForSourceLocation(reference);
  if (!pageElement) return;
  clearSourceRegionHighlight();
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas) {
    showNotice('无法恢复原选区，请重新框选。', { transient: true, tone: 'warning' });
    return;
  }
  if (regionMode === 'off') setRegionMode('single');
  const region = regionFromSourceLocation(reference, pageElement);
  const selection = createActiveRegion(pageElement, canvas, region);
  createRegionConfirmation(selection);
  showNotice('已恢复原选区，可拖动或调整角点后重新发送。', {
    transient: true,
    tone: 'success',
  });
}

async function navigateToPdfRegion(reference: PdfSourceLocation): Promise<void> {
  await navigateToPdfRegions([reference]);
}

async function navigateToPdfRegions(references: readonly PdfSourceLocation[], remainingLayoutRetries = 2): Promise<void> {
  const first = references[0];
  if (!first) return;
  const navigationEpoch = documentEpoch;
  // Reading -> compare changes available width. Finish the pending local
  // rebuild before finding page nodes or its clearDocument() erases the boxes.
  if (fitWidthTimer) {
    clearTimeout(fitWidthTimer);
    fitWidthTimer = undefined;
    await fitWidthTask;
    await fitDocumentToAvailableWidth({ pageNumber: first.pageNumber, ratio: first.topRatio });
  } else {
    await fitWidthTask;
  }
  if (documentEpoch !== navigationEpoch) return;
  const navigationGeneration = renderGeneration;
  const retryLayout = () => remainingLayoutRetries > 0 && documentEpoch === navigationEpoch
    ? navigateToPdfRegions(references, remainingLayoutRetries - 1) : Promise.resolve();
  const pageElement = await pageForSourceLocation({
    ...first,
    documentId: currentDocumentSessionId,
  });
  if (!pageElement) {
    if (navigationGeneration !== renderGeneration) await retryLayout();
    return;
  }
  clearSourceRegionHighlight();
  const epoch = documentEpoch;
  const pages = new Map<number, HTMLElement>([[first.pageNumber, pageElement]]);
  for (const reference of references) {
    if (pages.has(reference.pageNumber)) continue;
    const other = viewer.querySelector<HTMLElement>(`.pdf-page[data-page-number="${reference.pageNumber}"]`);
    if (!other || !pdfDocument) continue;
    requestPageRender(pdfDocument, other, renderGeneration);
    await waitForPageReady(other, epoch);
    if (epoch !== documentEpoch) return;
    pages.set(reference.pageNumber, other);
  }
  if (navigationGeneration !== renderGeneration || fitWidthTimer || fitWidthTask ||
      [...pages.values()].some((page) => !page.isConnected)) {
    await retryLayout();
    return;
  }
  const highlights = references.flatMap((reference) => {
      const target = pages.get(reference.pageNumber);
      if (!target) return [];
      const region = regionFromSourceLocation(reference, target);
      const highlight = document.createElement('div');
      highlight.className = 'region-source-highlight';
      highlight.style.left = `${region.left}px`;
      highlight.style.top = `${region.top}px`;
      highlight.style.width = `${region.width}px`;
      highlight.style.height = `${region.height}px`;
      highlight.setAttribute('aria-hidden', 'true');
      target.append(highlight);
      return [highlight];
    });
  sourceRegionHighlights = highlights;
  scrollPdfSourceLocationsIntoView(references, pageElement);
  sourceRegionHighlightTimer = setTimeout(() => {
    for (const highlight of highlights) highlight.remove();
    if (sourceRegionHighlights === highlights) {
      sourceRegionHighlights = [];
      sourceRegionHighlightTimer = undefined;
    }
  }, pages.size > 1 ? 8000 : 1800);
}

async function navigateToPdfMarkerPage(pageNumber: number): Promise<void> {
  if (!pdfDocument) return;
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${pageNumber}"]`,
  );
  if (!pageElement) return;
  scrollToPageAnchor({ pageNumber, ratio: 0 });
  requestPageRender(pdfDocument, pageElement, renderGeneration);
  await waitForPageReady(pageElement, documentEpoch);
}

function enqueueRegionTranslation(
  task: Omit<QueuedRegionTranslation, 'id' | 'cancelled' | 'enqueuedAt'>,
): boolean {
  if (pendingRegionTranslationCount() >= MAX_REGION_TRANSLATION_QUEUE) {
    showNotice('翻译队列已满（最多 3 项），请等待当前任务完成。', {
      transient: true,
      tone: 'warning',
    });
    return false;
  }
  regionTranslationQueue.push({
    ...task,
    id: crypto.randomUUID(),
    cancelled: false,
    enqueuedAt: performance.now(),
  });
  updateRegionAction();
  showNotice(`已加入翻译队列 · ${pendingRegionTranslationCount()}/3`, {
    transient: true,
    tone: 'success',
  });
  void drainRegionTranslationQueue();
  return true;
}

async function drainRegionTranslationQueue(): Promise<void> {
  if (regionTranslationRunning) return;
  regionTranslationRunning = true;
  updateRegionAction();
  try {
    while (regionTranslationQueue.length) {
      const task = regionTranslationQueue.shift();
      if (!task || task.cancelled || task.documentEpoch !== documentEpoch) continue;
      activeRegionTranslation = task;
      updateRegionAction();
      try {
        const controller = await selectionTranslator;
        if (task.cancelled || task.documentEpoch !== documentEpoch) continue;
        const queueMs = Math.max(0, performance.now() - task.enqueuedAt);
        if (task.payload.kind === 'text') {
          task.payload.capture.clientPerformance = {
            ...task.payload.capture.clientPerformance,
            queueMs,
          };
          await controller.translatePdfRegionText(task.payload.capture);
        } else {
          task.payload.capture.clientPerformance = {
            ...task.payload.capture.clientPerformance,
            queueMs,
          };
          await controller.translateImageRegion(task.payload.capture);
        }
      } catch (error) {
        if (task.cancelled || task.documentEpoch !== documentEpoch) continue;
        showNotice(
          error instanceof Error ? error.message : '框选翻译失败，请稍后重试。',
          { transient: true, tone: 'error' },
        );
      } finally {
        if (activeRegionTranslation === task) activeRegionTranslation = undefined;
        updateRegionAction();
      }
    }
  } finally {
    regionTranslationRunning = false;
    activeRegionTranslation = undefined;
    updateRegionAction();
  }
}

function createRegionConfirmation(
  selection: ActiveRegionSelection,
  noteText = '优先本地提取文字，必要时仅发送此区域',
): void {
  if (notice.classList.contains('transient')) showNotice(undefined);
  selection.confirm?.remove();
  const confirmation = document.createElement('div');
  confirmation.className = 'region-confirm';
  confirmation.setAttribute('role', 'group');
  confirmation.setAttribute(
    'aria-label',
    selection.purpose === 'page-recognition' ? '扫描页文字识别确认' : '框选翻译确认',
  );
  const note = document.createElement('span');
  note.className = 'region-confirm-note';
  note.textContent = noteText;
  const actions = document.createElement('div');
  actions.className = 'region-confirm-actions';
  const confirm = document.createElement('button');
  confirm.className = 'confirm';
  confirm.type = 'button';
  confirm.textContent = selection.purpose === 'page-recognition' ? '识别文字' : '发送并翻译';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  actions.append(confirm, cancel);
  confirmation.append(note, actions);
  selection.pageElement.append(confirmation);
  selection.confirm = confirmation;
  selection.box.classList.add('adjustable');
  selection.box.title = '拖动选框可移动，拖动角点可调整大小';
  selection.box.tabIndex = 0;
  selection.box.setAttribute('role', 'group');
  selection.box.setAttribute(
    'aria-label',
    '翻译选区。方向键移动，Shift 加方向键调整宽度或高度。按 Tab 进入确认按钮。',
  );
  for (const handle of ['nw', 'ne', 'se', 'sw'] satisfies RegionResizeHandle[]) {
    const grip = document.createElement('span');
    grip.className = `region-resize-handle ${handle}`;
    grip.dataset.regionHandle = handle;
    grip.ariaHidden = 'true';
    selection.box.append(grip);
  }
  selection.box.addEventListener('keydown', (event) => {
    if (activeRegion !== selection || selection.documentEpoch !== documentEpoch) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const step = event.ctrlKey ? 1 : 6;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const bounds = pageRegionBounds(selection);
    selection.region = event.shiftKey
      ? resizeRegion(
        selection.region,
        'se',
        {
          x: selection.region.right + dx,
          y: selection.region.bottom + dy,
        },
        bounds,
      )
      : moveRegion(selection.region, { x: dx, y: dy }, bounds);
    renderRegionBox(selection);
    event.preventDefault();
    event.stopPropagation();
  });
  positionRegionConfirmation(selection);
  queueMicrotask(() => selection.box.focus({ preventScroll: true }));
  cancel.addEventListener('click', () => {
    if (activePageRecognitionRequestId) {
      clearRegionSelection();
      if (regionMode === 'single') setRegionMode('off');
      showNotice('已取消本页识别。', { transient: true, tone: 'success' });
      return;
    }
    if (regionMode === 'continuous') {
      clearRegionSelection();
      showNotice('连续框选已开启 · 可继续拖动框选 · Esc 退出', {
        transient: true,
        tone: 'info',
      });
    } else {
      setRegionMode('off');
    }
  });
  confirm.addEventListener('click', () => {
    if (pendingRegionTranslationCount() >= MAX_REGION_TRANSLATION_QUEUE) {
      showNotice('翻译队列已满（最多 3 项），请等待当前任务完成。', {
        transient: true,
        tone: 'warning',
      });
      return;
    }
    confirm.disabled = true;
    cancel.disabled = true;
    showNotice(
      selection.purpose === 'page-recognition'
        ? '正在识别本页文字…'
        : '正在检查框选内容…',
      { tone: 'info' },
    );
    const captureEpoch = selection.documentEpoch;
    const requestPageUrl = currentSourceUrl;
    const requestSourceLabel = currentSourceLabel ?? documentName.textContent ?? 'PDF';
    const requestRegion = { ...selection.region };
    const currentBounds = selection.pageElement.getBoundingClientRect();
    const pageNumber = selection.pageElement.dataset.pageNumber ?? '';
    const numericPageNumber = Math.max(1, Number(pageNumber) || 1);
    const rect = regionViewportRect(selection);
    const sourceLocation = sourceLocationForRegion(
      numericPageNumber,
      requestRegion,
      currentBounds,
    );
    const sourceLabel = requestSourceLabel;
    const extractedText = extractReliableTextFromRegion(selection);
    const finishSelection = (): void => {
      clearRegionSelection();
      if (regionMode === 'single') setRegionMode('off');
      else if (regionMode === 'continuous') {
        showNotice('连续框选已开启 · 可继续拖动框选 · Esc 退出', {
          transient: true,
          tone: 'info',
        });
      }
    };
    if (selection.purpose === 'page-recognition') {
      const recognitionRequestId = crypto.randomUUID();
      activePageRecognitionRequestId = recognitionRequestId;
      cancel.disabled = false;
      cancel.textContent = '取消识别';
      void (async () => {
        const captureStartedAt = performance.now();
        const captured = await captureCanvasRegion(
          selection.canvas,
          { left: 0, top: 0, width: currentBounds.width, height: currentBounds.height },
          requestRegion,
        );
        if (documentEpoch !== captureEpoch || activeRegion !== selection) return;
        const response = await browser.runtime.sendMessage({
          type: 'RECOGNIZE_PDF_PAGE',
          payload: {
            requestId: recognitionRequestId,
            imageDataUrl: captured.dataUrl,
            imageWidth: captured.width,
            imageHeight: captured.height,
            pageNumber: numericPageNumber,
            clientPerformance: {
              captureMs: Math.max(0, performance.now() - captureStartedAt),
            },
          },
        } satisfies RuntimeMessage) as RecognizePdfPageResponse;
        if (
          activePageRecognitionRequestId !== recognitionRequestId ||
          documentEpoch !== captureEpoch ||
          activeRegion !== selection
        ) return;
        if (!response.ok) {
          activePageRecognitionRequestId = undefined;
          confirm.disabled = false;
          cancel.disabled = false;
          cancel.textContent = '取消';
          const recovery=translationErrorRecovery(response.error.code,response.error.retryable,'vision');
          showNotice(
            translationErrorMessage(response.error.code,response.error.message),
            {
              tone: 'error',
              ...(recovery.settingsFocus?{action:{label:recovery.settingsLabel??'检查图像 API',onClick:()=>{void openPdfSettings(recovery.settingsFocus)}}}:{}),
            },
          );
          return;
        }
        const mapped = mapCoordinateOcrPageToRegion(response.data.page, {
          left: requestRegion.left / currentBounds.width,
          top: requestRegion.top / currentBounds.height,
          width: requestRegion.width / currentBounds.width,
          height: requestRegion.height / currentBounds.height,
        });
        if (!mapped.ok) throw new Error(mapped.reason);
        temporaryOcrPages.set(numericPageNumber, mapped.page);
        const lineCount = renderTemporaryOcrTextLayer(selection.pageElement, mapped.page);
        if (!lineCount) throw new Error('OCR 没有返回可安全选择的文字行。');
        updatePdfSearchIndexFromTemporaryOcrPage(numericPageNumber, mapped.page);
        selection.pageElement.dataset.hasText = 'true';
        activePageRecognitionRequestId = undefined;
        finishSelection();
        showNotice(`已生成临时文字层 · ${lineCount} 行 · 现在可以直接划选翻译`, {
          transient: true,
          tone: 'success',
        });
      })().catch((error: unknown) => {
        if (
          activePageRecognitionRequestId !== recognitionRequestId ||
          documentEpoch !== captureEpoch ||
          activeRegion !== selection
        ) return;
        activePageRecognitionRequestId = undefined;
        confirm.disabled = false;
        cancel.disabled = false;
        cancel.textContent = '取消';
        showNotice(error instanceof Error ? error.message : '本页文字识别失败，请继续使用框选翻译。', {
          tone: 'error',
        });
      });
      return;
    }
    if (extractedText && !shouldUseVisionForPdfFormula(extractedText)) {
      const captureRequest: PdfRegionTextTranslationCapture = {
        text: extractedText,
        rect,
        pageUrl: requestPageUrl,
        sourceLabel,
        sourceLocation,
      };
      finishSelection();
      enqueueRegionTranslation({
        documentEpoch: captureEpoch,
        payload: { kind: 'text', capture: captureRequest },
        pageLabel: pageNumber ? `第 ${pageNumber} 页框选` : 'PDF 框选区域',
      });
      return;
    }
    void (async () => {
      const createImageCapture = async (
        region: RegionRect,
      ): Promise<ImageRegionTranslationCapture | undefined> => {
        if (documentEpoch !== captureEpoch || !selection.canvas.isConnected) return undefined;
        const pageBounds = selection.pageElement.getBoundingClientRect();
        const captureStartedAt = performance.now();
        const capture = await captureCanvasRegion(
          selection.canvas,
          { left: 0, top: 0, width: pageBounds.width, height: pageBounds.height },
          region,
        );
        const captureRequest: ImageRegionTranslationCapture = {
          imageDataUrl: capture.dataUrl,
          imageWidth: capture.width,
          imageHeight: capture.height,
          ...(extractedText ? { recognizedTextHint: extractedText } : {}),
          rect,
          pageUrl: requestPageUrl,
          sourceLabel,
          selectionReference: sourceLocation,
          clientPerformance: {
            captureMs: Math.max(0, performance.now() - captureStartedAt),
          },
        };
        return captureRequest;
      };
      const captureRequest = await createImageCapture(requestRegion);
      if (!captureRequest) return;
      if (documentEpoch !== captureEpoch || activeRegion !== selection) return;
      finishSelection();
      enqueueRegionTranslation({
        documentEpoch: captureEpoch,
        payload: { kind: 'image', capture: captureRequest },
        pageLabel: pageNumber ? `第 ${pageNumber} 页框选` : 'PDF 框选区域',
      });
    })().catch((error: unknown) => {
      if (documentEpoch !== captureEpoch || activeRegion !== selection) return;
      confirm.disabled = false;
      cancel.disabled = false;
      showNotice(error instanceof Error ? error.message : '无法处理框选区域，请重新框选。', {
        tone: 'error',
      });
    });
  });
}

viewer.addEventListener('pointerdown', (event) => {
  if (!isRegionModeActive() || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.region-confirm')) return;
  const existing = activeRegion;
  if (
    existing?.documentEpoch === documentEpoch &&
    target.closest('.region-selection-box') === existing.box
  ) {
    const handleElement = target.closest<HTMLElement>('[data-region-handle]');
    const handle = handleElement?.dataset.regionHandle as RegionResizeHandle | undefined;
    const point = pointWithinPage(event, existing.pageElement);
    existing.interaction = handle
      ? {
        kind: 'resize',
        pointerId: event.pointerId,
        handle,
        start: point,
        initialRegion: existing.region,
      }
      : {
        kind: 'move',
        pointerId: event.pointerId,
        start: point,
        initialRegion: existing.region,
      };
    existing.pageElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const pageElement = target.closest<HTMLElement>('.pdf-page[data-rendered="ready"]');
  const canvas = pageElement?.querySelector<HTMLCanvasElement>('canvas');
  if (!pageElement || !canvas) return;
  const start = pointWithinPage(event, pageElement);
  const region = normalizeRegion(start, start, {
    left: 0,
    top: 0,
    width: pageElement.clientWidth,
    height: pageElement.clientHeight,
  });
  createActiveRegion(
    pageElement,
    canvas,
    region,
    { kind: 'draw', pointerId: event.pointerId, start },
  );
  pageElement.setPointerCapture(event.pointerId);
  event.preventDefault();
});

viewer.addEventListener('pointermove', (event) => {
  const selection = activeRegion;
  if (!selection || selection.interaction?.pointerId !== event.pointerId) return;
  updateRegionFromPointer(selection, pointWithinPage(event, selection.pageElement));
  event.preventDefault();
});

viewer.addEventListener('pointerup', (event) => {
  const selection = activeRegion;
  const interaction = selection?.interaction;
  if (!selection || !interaction || interaction.pointerId !== event.pointerId) return;
  updateRegionFromPointer(selection, pointWithinPage(event, selection.pageElement));
  if (selection.pageElement.hasPointerCapture(event.pointerId)) {
    selection.pageElement.releasePointerCapture(event.pointerId);
  }
  selection.interaction = undefined;
  if (interaction.kind === 'draw' && !isUsableRegion(selection.region)) {
    clearRegionSelection();
    showNotice('框选范围太小，请拖动选择更大的文字或图片区域。', {
      transient: true,
      tone: 'warning',
    });
    return;
  }
  if (interaction.kind === 'draw') createRegionConfirmation(selection);
  else positionRegionConfirmation(selection);
  event.preventDefault();
});

viewer.addEventListener('pointercancel', (event) => {
  const selection = activeRegion;
  const interaction = selection?.interaction;
  if (!selection || !interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.kind === 'draw') {
    clearRegionSelection();
    showNotice(undefined);
    return;
  }
  selection.region = interaction.initialRegion;
  selection.interaction = undefined;
  renderRegionBox(selection);
});

regionTranslate.addEventListener('click', (event) => {
  const enable = regionMode !== 'continuous';
  setRegionMode(enable ? 'continuous' : 'off');
  if (enable && event.detail === 0) requestAnimationFrame(createKeyboardRegion);
});

recognizePage.addEventListener('click', () => {
  if (!pdfDocument || recognizePage.disabled) return;
  const pageNumber = visiblePageAnchor().pageNumber;
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${pageNumber}"]`,
  );
  if (!pageElement) {
    showNotice('找不到当前页，请稍后重试。', { transient: true, tone: 'warning' });
    return;
  }
  createPageRecognitionRegion(pageElement);
});
regionQueueButton.addEventListener('click', () => {
  const open = regionQueuePanel.hidden;
  if (open && notice.classList.contains('transient')) showNotice(undefined);
  regionQueuePanel.hidden = !open;
  regionQueueButton.setAttribute('aria-expanded', String(open));
});
document.addEventListener('pointerdown', (event) => {
  if (regionQueuePanel.hidden || !(event.target instanceof Node)) return;
  if (!regionQueuePanel.contains(event.target) && !regionQueueButton.contains(event.target)) {
    closeRegionQueuePanel();
  }
});

function ownsTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"]'),
  );
}

function isPdfReadingShortcutContext(event: KeyboardEvent): boolean {
  if (
    !pdfDocument ||
    activeRegion?.confirm ||
    event.composedPath().some((target) => ownsTextInput(target))
  ) return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  if (ownsTextInput(active)) return false;
  return active === stage || active === viewer || Boolean(active.closest('.pdf-page'));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !regionQueuePanel.hidden) {
    closeRegionQueuePanel();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.key === 'Escape' && isRegionModeActive()) {
    if (activeRegion && regionMode === 'continuous') {
      clearRegionSelection();
      showNotice('连续框选已开启 · 可继续拖动框选 · Esc 再次退出', {
        transient: true,
        tone: 'info',
      });
    } else {
      setRegionMode('off');
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (!isPdfReadingShortcutContext(event)) return;
  const shortcut = resolvePdfRegionShortcut(
    event,
    pdfKeyboardShortcutsEnabled,
    pdfRegionShortcutKey,
  );
  if (!shortcut) return;
  if (shortcut === 'single') {
    setRegionMode(regionMode === 'single' ? 'off' : 'single');
  } else {
    setRegionMode(regionMode === 'continuous' ? 'off' : 'continuous');
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

async function openPdfSource(source: URL, initialPage?: number): Promise<void> {
  const operation = beginDocumentOpen(
    source.protocol === 'file:' ? '正在读取本地 PDF…' : '正在读取在线 PDF…',
    source.protocol === 'file:' ? 'reading-local' : 'reading-online',
  );
  try {
    if (
      source.protocol === 'file:' &&
      !(await browser.extension.isAllowedFileSchemeAccess())
    ) {
      emptyState.hidden = false;
      showNotice(
        'Edge 尚未允许 Pi Translator 读取本地 PDF。请在扩展详情中开启“允许访问文件 URL”，再返回重试。',
        {
          tone: 'warning',
          action: {
            label: '打开扩展管理页',
            onClick: () => {
              void browser.tabs.create({
                url: `edge://extensions/?id=${browser.runtime.id}`,
                active: true,
              }).catch(() => showNotice('请手动打开 edge://extensions，并进入 Pi Translator 详情。', {
                tone: 'error',
              }));
            },
          },
        },
      );
      completeDocumentOpen(operation);
      return;
    }
    const permission = pdfPermissionPattern(source.href);
    if (permission && !await browser.permissions.contains({ origins: [permission] })) {
      emptyState.hidden = false;
      showNotice(
        'Pi PDF 还没有当前 PDF 地址的读取权限。授权只针对当前文件来源。',
        {
          tone: 'warning',
          action: {
            label: '授权并重试',
            onClick: () => {
              void browser.permissions.request({ origins: [permission] }).then((granted) => {
                if (granted) void openPdfSource(source, initialPage);
              }).catch(() => showNotice('未能发起 PDF 地址授权，请返回快捷面板后重试。', {
                tone: 'error',
              }));
            },
          },
        },
      );
      completeDocumentOpen(operation);
      return;
    }
    const response = await fetch(
      source.href,
      source.protocol === 'file:'
        ? { signal: operation.controller.signal }
        : { credentials: 'include', signal: operation.controller.signal },
    );
    if (!isCurrentOpen(operation)) return;
    const isOverleafSource = /(^|\.)overleaf\.com$/iu.test(source.hostname);
    if (!response.ok) {
      if (isOverleafSource && [401, 403].includes(response.status)) {
        throw new Error('Overleaf 登录态或编译下载链接已失效。请在 Overleaf 下载当前编译 PDF，再用 Pi PDF 打开下载文件');
      }
      throw new Error(`下载失败（HTTP ${response.status}）`);
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      throw new Error(isOverleafSource
        ? 'Overleaf 返回了登录页或项目页面，而不是 PDF。请在 Overleaf 下载当前编译 PDF，再用 Pi PDF 打开下载文件'
        : '这个地址返回的不是 PDF 文件');
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const responseStart = new TextDecoder().decode(data.subarray(0, 256)).trimStart();
    if (/^(?:<!doctype\s+html|<html\b|\{\s*["'])/iu.test(responseStart)) {
      throw new Error(isOverleafSource
        ? 'Overleaf 返回了登录页或项目页面，而不是 PDF。请在 Overleaf 下载当前编译 PDF，再用 Pi PDF 打开下载文件'
        : '这个地址返回的不是 PDF 文件');
    }
    if (!isCurrentOpen(operation)) return;
    await openPdfData(
      data,
      pdfFilename(source.href),
      operation,
      source.href,
      initialPage,
      pdfDocumentIdentity(source.href) ?? source.href,
    );
  } catch (error) {
    if (!isCurrentOpen(operation)) return;
    emptyState.hidden = false;
    showNotice(
      `${error instanceof Error ? error.message : '在线 PDF 读取失败'}。你仍可点击“打开 PDF”选择已下载的本地文件。`,
      { tone: 'error' },
    );
    completeDocumentOpen(operation);
  } finally {
    if (isCurrentOpen(operation) && !pdfDocument) completeDocumentOpen(operation);
  }
}

function chooseLocalPdf(): void {
  fileInput.click();
}

function isFileDrag(transfer: DataTransfer | null): transfer is DataTransfer {
  return Boolean(transfer && [...transfer.types].includes('Files'));
}

function dropPresentation(transfer: DataTransfer): {
  invalid: boolean;
  title: string;
  description: string;
} {
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  if (items.length > 1) {
    return {
      invalid: true,
      title: '一次只能打开一份 PDF',
      description: '请只保留一个文件后重试',
    };
  }
  const knownType = items[0]?.type.toLowerCase();
  if (
    knownType &&
    !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(knownType)
  ) {
    return {
      invalid: true,
      title: '这里只能打开 PDF',
      description: '当前拖入的文件类型不受支持',
    };
  }
  return {
    invalid: false,
    title: pdfDocument ? '松开以更换当前 PDF' : '松开以打开 PDF',
    description: pdfDocument
      ? '新文档将在当前阅读器中打开'
      : '文件只在当前标签页中读取',
  };
}

function showDropOverlay(transfer: DataTransfer): void {
  const presentation = dropPresentation(transfer);
  dropTitle.textContent = presentation.title;
  dropDescription.textContent = presentation.description;
  dropOverlay.dataset.tone = presentation.invalid ? 'invalid' : 'ready';
  dropOverlay.hidden = false;
}

function hideDropOverlay(): void {
  fileDragDepth = 0;
  dropOverlay.hidden = true;
  dropOverlay.removeAttribute('data-tone');
}

window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  fileDragDepth += 1;
  showDropOverlay(event.dataTransfer);
});
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  const presentation = dropPresentation(event.dataTransfer);
  event.dataTransfer.dropEffect = presentation.invalid ? 'none' : 'copy';
  showDropOverlay(event.dataTransfer);
});
window.addEventListener('dragleave', (event) => {
  if (dropOverlay.hidden || !isFileDrag(event.dataTransfer)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) hideDropOverlay();
});
window.addEventListener('dragend', hideDropOverlay);
window.addEventListener('blur', hideDropOverlay);
window.addEventListener('drop', (event) => {
  if (!isFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  const files = [...event.dataTransfer.files];
  hideDropOverlay();
  const validation = validateLocalPdfFiles(files);
  if (!validation.ok) {
    showNotice(validation.message, { transient: true, tone: 'warning' });
    return;
  }
  void openLocalFile(validation.file);
});

chooseFile.addEventListener('click', chooseLocalPdf);
emptyOpen.addEventListener('click', chooseLocalPdf);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openLocalFile(file);
  fileInput.value = '';
});

function steppedZoom(direction: -1 | 1, fromZoom = currentZoom()): number {
  if (direction < 0) {
    return [...ZOOM_LEVELS].reverse().find((level) => level < fromZoom - 0.001)
      ?? ZOOM_LEVELS[0];
  }
  return ZOOM_LEVELS.find((level) => level > fromZoom + 0.001)
    ?? ZOOM_LEVELS.at(-1)!;
}

function clearPendingWheelZoom(): void {
  if (wheelZoomTimer) clearTimeout(wheelZoomTimer);
  wheelZoomTimer = undefined;
  wheelZoomAccumulatedDelta = 0;
  wheelZoomAnchor = undefined;
}

function commitWheelZoom(): void {
  wheelZoomTimer = undefined;
  const delta = wheelZoomAccumulatedDelta;
  const anchor = wheelZoomAnchor ?? visiblePageAnchor();
  wheelZoomAccumulatedDelta = 0;
  wheelZoomAnchor = undefined;
  if (!pdfDocument || delta === 0) return;

  const direction: -1 | 1 = delta > 0 ? -1 : 1;
  let nextZoom = currentZoom();
  for (let index = 0; index < pdfWheelZoomStepCount(delta); index += 1) {
    nextZoom = steppedZoom(direction, nextZoom);
  }
  if (Math.abs(nextZoom - currentZoom()) < 0.001) return;
  fitWidthActive = false;
  rebuildAtZoom(nextZoom, anchor);
}

viewer.addEventListener('wheel', (event) => {
  const delta = pdfWheelZoomDelta(event);
  if (!pdfDocument || delta === undefined) return;

  // Prevent Chromium from zooming the complete extension page. Plain wheel
  // scrolling and Ctrl + wheel outside the PDF document remain untouched.
  event.preventDefault();
  wheelZoomAccumulatedDelta += delta;
  wheelZoomAnchor ??= visiblePageAnchor();
  if (wheelZoomTimer) clearTimeout(wheelZoomTimer);
  wheelZoomTimer = setTimeout(commitWheelZoom, 80);
}, { passive: false });

function fitDocumentToAvailableWidth(anchor = visiblePageAnchor()): Promise<void> {
  const pdf = pdfDocument;
  if (!pdf) return Promise.resolve();
  const epoch = documentEpoch;
  const task = pdf.getPage(anchor.pageNumber).then((page) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch || !fitWidthActive) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const horizontalPadding = matchMedia('(max-width: 720px)').matches ? 28 : 68;
    const availableWidth = Math.max(100, stage.clientWidth - horizontalPadding - 2);
    const nextZoom = clamp(availableWidth / Math.max(1, baseViewport.width), 0.1, ZOOM_LEVELS.at(-1)!);
    if (Math.abs(nextZoom - currentZoom()) < .001) { setDocumentControls(true); return; }
    return rebuildAtZoom(nextZoom, anchor);
  }).catch((error: unknown) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch) return;
    showNotice(error instanceof Error ? error.message : '无法计算适合宽度。', {
      tone: 'error',
    });
  });
  fitWidthTask = task;
  void task.finally(() => { if (fitWidthTask === task) fitWidthTask = undefined; });
  return task;
}

function scheduleFitWidthRefresh(): void {
  if (fitWidthTimer) clearTimeout(fitWidthTimer);
  fitWidthTimer = undefined;
  if (!fitWidthActive || !pdfDocument) return;
  fitWidthTimer = setTimeout(() => {
    fitWidthTimer = undefined;
    fitDocumentToAvailableWidth();
  }, 120);
}

function rebuildAtZoom(nextZoom: number, anchor = visiblePageAnchor()): Promise<void> {
  if (!pdfDocument) return Promise.resolve();
  completedTextSelectionGesture = undefined;
  zoomLevel = clamp(nextZoom, fitWidthActive ? 0.1 : ZOOM_LEVELS[0], ZOOM_LEVELS.at(-1)!);
  setDocumentControls(true);
  const task = buildPages(pdfDocument, anchor);
  scheduleReadingStateSave();
  return task;
}

zoomOut.addEventListener('click', () => {
  if (!pdfDocument || zoomOut.disabled) return;
  fitWidthActive = false;
  rebuildAtZoom(steppedZoom(-1));
});
zoomIn.addEventListener('click', () => {
  if (!pdfDocument || zoomIn.disabled) return;
  fitWidthActive = false;
  rebuildAtZoom(steppedZoom(1));
});
fitWidth.addEventListener('click', () => {
  if (!pdfDocument) return;
  fitWidthActive = true;
  fitDocumentToAvailableWidth();
  scheduleReadingStateSave();
});

function commitPageJump(): void {
  const total = pdfDocument?.numPages ?? 0;
  if (!total) return;
  const requested = Number(pageNumberInput.value);
  const pageNumber = clamp(Number.isFinite(requested) ? Math.round(requested) : 1, 1, total);
  pageNumberInput.value = String(pageNumber);
  scrollToPageAnchor({ pageNumber, ratio: 0 });
  schedulePageRetention();
}

pageNumberInput.addEventListener('change', commitPageJump);
pageNumberInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitPageJump();
    pageNumberInput.select();
  } else if (event.key === 'Escape') {
    updatePageControl();
    pageNumberInput.blur();
  }
});
stage.addEventListener('scroll', () => {
  schedulePageRetention();
  scheduleReadingStateSave();
  if (
    !documentTranslationPanel.hidden &&
    pdfDocumentTranslationRangeMode !== 'current'
  ) {
    documentTranslationRangeCurrent.textContent =
      `当前页（第 ${visiblePageAnchor().pageNumber} 页）`;
  }
}, { passive: true });
stage.addEventListener('pointerdown', () => closePdfOutline(false), { passive: true });
document.addEventListener('pointerdown', beginSmartTextSelection, true);
document.addEventListener('pointerup', finishSmartTextSelection, true);
document.addEventListener('pointercancel', cancelSmartTextSelection, true);
openSettings.addEventListener('click', () => {
  void openPdfSettings();
});
translateDocument.addEventListener('click', () => {
  if (documentTranslationPanel.hidden) void openPdfDocumentTranslation();
  else closePdfDocumentTranslation();
});
documentTranslationClose.addEventListener('click', () => {if(cachedReadingContext){void persistReadingState().finally(()=>{location.href=browser.runtime.getURL('/options.html#storage')});return}closePdfDocumentTranslation()});
element<HTMLButtonElement>('pdf-library-back').addEventListener('click',()=>documentTranslationClose.click());
element<HTMLButtonElement>('pdf-library-search').addEventListener('click',()=>{documentTranslationCopyMenu.open=false;openPdfSearch()});
element<HTMLButtonElement>('pdf-library-source').addEventListener('click',()=>{
  if(cachedReadingContext?.kind!=='pdf')return;
  libraryRestoreId=cachedReadingContext.id;
  const url=new URL(location.href);url.searchParams.delete('library');url.searchParams.set('restore',libraryRestoreId);history.replaceState(null,'',url);
  documentTranslationCopyMenu.open=false;fileInput.click();
});
documentReview.addEventListener('toggle', syncPdfReviewQueue);
documentReviewFilter.addEventListener('change', syncPdfReviewQueue);
documentTrialBlock.addEventListener('change', syncPdfTrialUi);
documentTrialStart.addEventListener('click', () => { void trialPdfDocumentBlock(); });
documentRequestLimit.addEventListener('change', syncPdfDocumentTranslationUi);
documentTranslationViewReading.addEventListener('click', () => {
  setPdfDocumentTranslationViewMode('reading');
});
documentTranslationViewCompare.addEventListener('click', () => {
  setPdfDocumentTranslationViewMode('compare');
});
documentTranslationPagePrevious.addEventListener('click', () => {
  movePdfDocumentTranslationReadingPage(-1);
});
documentTranslationPageNext.addEventListener('click', () => {
  movePdfDocumentTranslationReadingPage(1);
});
documentTranslationPrimary.addEventListener('click', () => {
  void startOrTogglePdfDocumentTranslation();
});
documentTranslationStop.addEventListener('click', stopPdfDocumentTranslation);
documentTranslationClear.addEventListener('click', () => {
  documentTranslationCopyMenu.open = false;
  void restartPdfDocumentTranslation();
});
documentTranslationSettings.addEventListener('toggle', syncPdfDocumentTranslationSetupUi);
documentTranslationShowSettings.addEventListener('click', () => {
  documentTranslationCopyMenu.open = false;
  documentTranslationSettings.open = true;
  syncPdfDocumentTranslationSetupUi();
  documentTranslationSettings.querySelector('summary')?.focus();
});
documentTranslationCopyMenu.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !documentTranslationCopyMenu.open) return;
  event.preventDefault();
  event.stopPropagation();
  documentTranslationCopyMenu.open = false;
  documentTranslationCopyMenu.querySelector('summary')?.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!documentTranslationCopyMenu.contains(event.target as Node)) documentTranslationCopyMenu.open = false;
});
documentTranslationCopyTranslation.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('copy-translation');
});
documentTranslationCopyBilingual.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('copy-bilingual');
});
documentTranslationDownloadArchive.addEventListener('click', () => {
  const text = '# 旧分段译文备查\n\n这些结果来自同一 PDF 的旧分段，未套用到当前段落。公式、人工修正和核对提示按原记录保留。\n\n' +
    pdfDocumentTranslationArchivedBlocks.map(block => `## ${block.signature}\n\n${block.formulaDocument ? formulaDocumentText(block.formulaDocument) : block.translatedText}\n\n${[block.formulaReviewDraft ? '未确认草稿' : '', block.formulaReviewMessage, block.visualFallbackMessage, block.reviewConfirmation ? '已人工核对' : ''].filter(Boolean).join('；')}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'}));
  const anchor = document.createElement('a');anchor.href = url;anchor.download = '旧分段译文.md';anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);documentTranslationCopyMenu.open = false;
});
documentTranslationDownloadTranslation.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('translation-markdown');
});
documentTranslationDownloadBilingual.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('bilingual-markdown');
});
documentTranslationDownloadHtml.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('printable-html');
});
documentTranslationPrintLayout.addEventListener('click', () => {
  void handlePdfDocumentTranslationExport('layout-pdf');
});
documentTranslationRetentionToggle.addEventListener('change', () => {
  void setPdfDocumentTranslationRetention(documentTranslationRetentionToggle.checked);
});
documentTranslationRetentionManage.addEventListener('click', () => {
  void openPdfSettings('storage');
});
documentTranslationOcrAction.addEventListener('click', () => {
  void recognizePdfDocumentTranslationPages();
});
documentTranslationMultimodalToggle.addEventListener('change', () => {
  if (documentTranslationMultimodalToggle.disabled) return;
  pdfDocumentTranslationMultimodalEnabled = documentTranslationMultimodalToggle.checked;
  pdfDocumentTranslationMultimodalAuthorized = false;
  pdfDocumentTranslationSessionContext = currentPdfDocumentTranslationSessionContext();
  pdfDocumentTranslationRetainedLocally = false;
  pdfDocumentTranslationMessage = undefined;
  syncPdfDocumentTranslationUi();
});
documentTranslationRange.addEventListener('change', () => {
  pdfDocumentTranslationRangeError = undefined;
  if (documentTranslationRange.value === 'all') {
    updatePdfDocumentTranslationRange('all', []);
    return;
  }
  if (documentTranslationRange.value === 'current') {
    const pageNumber = visiblePageAnchor().pageNumber;
    updatePdfDocumentTranslationRange('current', [pageNumber], String(pageNumber));
    return;
  }
  documentTranslationCustomRange.hidden = false;
  const parsed = parsePdfDocumentPageRange(
    documentTranslationCustomPages.value,
    pdfDocument?.numPages ?? 0,
  );
  if (parsed.ok) {
    updatePdfDocumentTranslationRange('custom', parsed.pages, parsed.summary);
  } else {
    pdfDocumentTranslationRangeError = parsed.message;
    syncPdfDocumentTranslationUi();
  }
  if (!documentTranslationCustomRange.hidden) {
    documentTranslationCustomPages.focus();
    documentTranslationCustomPages.select();
  }
});
documentTranslationCustomRange.addEventListener('submit', (event) => {
  event.preventDefault();
  const parsed = parsePdfDocumentPageRange(
    documentTranslationCustomPages.value,
    pdfDocument?.numPages ?? 0,
  );
  if (!parsed.ok) {
    pdfDocumentTranslationRangeError = parsed.message;
    syncPdfDocumentTranslationUi();
    documentTranslationCustomPages.focus();
    return;
  }
  pdfDocumentTranslationRangeError = undefined;
  updatePdfDocumentTranslationRange('custom', parsed.pages, parsed.summary);
});
documentTranslationSkipReferences.addEventListener('change', () => {
  const previous = pdfDocumentTranslationSkipReferencesEnabled;
  pdfDocumentTranslationSkipReferencesEnabled = documentTranslationSkipReferences.checked;
  if (applyPdfDocumentTranslationScope()) return;
  pdfDocumentTranslationSkipReferencesEnabled = previous;
  documentTranslationSkipReferences.checked = previous;
  syncPdfDocumentTranslationUi();
});
documentTranslationSkipAppendix.addEventListener('change', () => {
  const previous = pdfDocumentTranslationSkipAppendixEnabled;
  pdfDocumentTranslationSkipAppendixEnabled = documentTranslationSkipAppendix.checked;
  if (applyPdfDocumentTranslationScope()) return;
  pdfDocumentTranslationSkipAppendixEnabled = previous;
  documentTranslationSkipAppendix.checked = previous;
  syncPdfDocumentTranslationUi();
});

let pdfMarkerSnapshot:{identity:string;markers:Awaited<ReturnType<typeof getPdfTranslationMarkerState>>['markers']}|undefined;
const selectionTranslator = startSelectionTranslator(
  { onInvalidated: (callback) => invalidationCallbacks.push(callback) },
  'pdf',
  {
    pageUrl: () => currentSourceUrl,
    sourceLabel: () => currentSourceLabel,
    documentId: () => currentReadingIdentity,
    allowSitePause: false,
    viewportInsets: () => ({ top: toolbar.getBoundingClientRect().bottom }),
    shouldIgnoreSelection: (selection) => Boolean(
      (selection.anchorNode && documentTranslationPanel.contains(selection.anchorNode)) ||
      (selection.focusNode && documentTranslationPanel.contains(selection.focusNode)),
    ),
    onSidebarLayoutChange: applyPdfSidebarLayout,
    onSidebarActiveChange: (active) => {
      continuousSidebarActive = active;
      if (active && !documentTranslationPanel.hidden) {
        closePdfDocumentTranslation({ restoreFocus: false });
      }
    },
    selectionPreview: pdfSelectionPreview,
    onAdjustPdfRegion: restorePdfRegionSelection,
    onNavigateToPdfRegion: navigateToPdfRegion,
    onNavigateToPdfMarker: navigateToPdfMarkerPage,
    resolvePdfRegionRects: pdfMarkerRects,
    captureVisualSelection: capturePdfFormulaSelection,
    pdfMarkerPersistence: {
      isAvailable: () => Boolean(currentReadingIdentity && pdfDocument),
      currentDocumentId: () => currentDocumentSessionId,
      load: async () => {
        const identity = currentReadingIdentity;
        if(!identity)return {enabled:false,markers:[],updatedAt:0};
        const state=await getPdfTranslationMarkerState(identity);
        if(currentReadingIdentity===identity)pdfMarkerSnapshot={identity,markers:state.markers};
        return state;
      },
      setEnabled: async (enabled) => {
        const identity = currentReadingIdentity;
        if (identity) await setPdfTranslationMarkerPersistence(identity, enabled);
      },
      save: async (markers) => {
        const identity = currentReadingIdentity;
        if(!identity)return;
        if(pdfMarkerSnapshot?.identity!==identity)throw new Error('PDF 摘录尚未读取完成，请稍后再试。');
        const saved=await savePdfTranslationMarkers(identity,markers,pdfMarkerSnapshot.markers);
        if(currentReadingIdentity===identity)pdfMarkerSnapshot={identity,markers:saved.markers};
      },
      clear: async () => {
        const identity = currentReadingIdentity;
        if (identity){await clearPdfTranslationMarkers(identity);if(currentReadingIdentity===identity)pdfMarkerSnapshot={identity,markers:[]}}
      },
    },
    onPublicSettingsChange: (settings) => {
      const previousSessionContext = pdfDocumentTranslationSessionContext;
      pdfDocumentTranslationSettings = {
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        style: settings.style,
        contentMode: settings.contentMode,
        autoRenderLatex: settings.autoRenderLatex,
        activeApiProfileId: settings.activeApiProfileId,
        visionApiProfileId: settings.visionApiProfileId ?? '',
        visionModel: settings.visionModel ?? '',
        apiProfiles: settings.apiProfiles,
        modelPrices: settings.modelPrices ?? [],
        ...(settings.costTextSource ? {costTextSource: settings.costTextSource} : {}),
      };
      if (
        previousSessionContext &&
        !samePdfDocumentTranslationSessionContext(
          previousSessionContext,
          currentPdfDocumentTranslationSessionContext(),
        )
      ) {
        const reopen = !documentTranslationPanel.hidden;
        resetPdfDocumentTranslation(false);
        if (reopen) void preparePdfDocumentTranslation();
      }
      pdfKeyboardShortcutsEnabled = settings.pdfKeyboardShortcutsEnabled;
      pdfRegionShortcutKey = settings.pdfRegionShortcutKey;
      updateRegionAction();
      syncPdfDocumentTranslationUi();
    },
  },
);

const onPdfViewportResize = (): void => {
  applyPdfSidebarLayout(pdfSidebarLayout);
  updatePdfDocumentTranslationInset();
};
window.addEventListener('resize', onPdfViewportResize, { passive: true });

browser.runtime.onMessage.addListener((value: unknown): undefined => {
  if (
    !isPdfBackgroundDocumentMessage(value) ||
    value.type !== 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED'
  ) return undefined;
  queuePdfDocumentBackgroundSnapshot(value.payload);
  return undefined;
});

const syncBackgroundTranslationWhenForegrounded = (): void => {
  if (document.visibilityState === 'visible') void syncPdfDocumentBackgroundTranslation();
};
document.addEventListener('visibilitychange', syncBackgroundTranslationWhenForegrounded);
document.addEventListener('resume', syncBackgroundTranslationWhenForegrounded);
window.addEventListener('focus', syncBackgroundTranslationWhenForegrounded);

window.addEventListener('beforeunload', () => {
  hideDropOverlay();
  stopSearchIndexing();
  if (fitWidthTimer) clearTimeout(fitWidthTimer);
  if (textSelectionSnapFrame !== undefined) cancelAnimationFrame(textSelectionSnapFrame);
  void persistReadingState();
  window.removeEventListener('resize', onPdfViewportResize);
  window.removeEventListener('focus', syncBackgroundTranslationWhenForegrounded);
  document.removeEventListener('visibilitychange', syncBackgroundTranslationWhenForegrounded);
  document.removeEventListener('resume', syncBackgroundTranslationWhenForegrounded);
  document.removeEventListener('pointerdown', beginSmartTextSelection, true);
  document.removeEventListener('pointerup', finishSmartTextSelection, true);
  document.removeEventListener('pointercancel', cancelSmartTextSelection, true);
  openAbortController?.abort();
  resetPdfDocumentTranslation(true);
  currentPdfBackgroundData = undefined;
  if (openLoadingTask) void openLoadingTask.destroy().catch(() => undefined);
  clearDocument();
  void pdfDocument?.destroy();
  for (const callback of invalidationCallbacks) callback();
});

setDocumentControls(false);
syncPdfDocumentTranslationUi();
bindPdfResearchReferences(documentTranslationPages,element<HTMLButtonElement>('pdf-research-return'),{
  documentKey:()=>currentReadingIdentity??currentDocumentSessionId,
  blocks:()=>pdfDocumentTranslationBlocksState.map(block=>({...block,headingLevel:pdfDisplayHeadingLevel(block)})),
  capture:()=>({mode:pdfDocumentTranslationViewMode,scrollTop:documentTranslationPages.scrollTop,source:visiblePageAnchor()}),
  restore:state=>{setPdfDocumentTranslationViewMode(state.mode);documentTranslationPages.scrollTop=state.scrollTop;if(state.mode==='compare')scrollToPageAnchor(state.source);scheduleReadingStateSave()},
  navigate:target=>{
    const block=pdfDocumentTranslationBlocksState.find(block=>block.id===target.blockId);
    if(!block)return;
    if(block.status!=='done'){activatePdfDocumentTranslationSource(block);return}
    setPdfDocumentTranslationViewMode('reading');
    const host=documentTranslationPages.querySelector<HTMLElement>(`[data-translation-block="${block.id}"]`);
    const destination=target.equationId?host?.querySelector<HTMLElement>(`[data-source-equation-id="${target.equationId}"]`)??host:host;
    if(!destination)return;
    documentTranslationPages.scrollTop+=destination.getBoundingClientRect().top-documentTranslationPages.getBoundingClientRect().top-16;
    destination.classList.add('pdf-research-destination');setTimeout(()=>destination.classList.remove('pdf-research-destination'),1800);
    if(!destination.hasAttribute('tabindex'))destination.tabIndex=-1;destination.focus({preventScroll:true});syncPdfDocumentTranslationCurrentPage(block.pageNumber);scheduleReadingStateSave();
  },
});
if(libraryRestoreId){
  emptyState.querySelector('h1')!.textContent='选择原 PDF 恢复阅读';
  emptyState.querySelector('p')!.textContent='在本机核验文件后恢复保留译文，不发送新的翻译请求。';
}
const initialSource = parsePdfSourceUrl(
  new URLSearchParams(location.search).get('url') ?? undefined,
);
const initialPage = pdfInitialPage(location.href) ?? pdfInitialPage(initialSource?.href);
if (initialSource) void openPdfSource(initialSource, initialPage);
const initialLibraryId=new URL(location.href).searchParams.get('library');
if(initialLibraryId)void openCachedLibraryReading(initialLibraryId);
