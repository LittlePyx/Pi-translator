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
import type { PdfSourceLocation } from '../../core/translation/types';
import { shouldUseVisionForPdfFormula } from '../../core/translation/formula-detection';
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
  comparePdfDocumentTranslationPriority,
  preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationBlock,
  type PdfDocumentTranslationPageInput,
  type PdfDocumentTranslationTextItem,
} from '../../core/pdf/document-translation';
import { renderTranslationContent } from '../../ui/translation-content';
import {
  mapCoordinateOcrPageToRegion,
  selectableOcrBlocks,
  type CoordinateOcrPage,
} from '../../core/pdf/ocr-text-layer';
import {
  DEFAULT_PDF_REGION_SHORTCUT_KEY,
  resolvePdfRegionShortcut,
} from '../../core/pdf/region-shortcuts';
import {
  getPdfReadingState,
  savePdfReadingState,
  type PdfReadingState,
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
const documentTranslationClose = element<HTMLButtonElement>('pdf-document-translation-close');
const documentTranslationPrimary = element<HTMLButtonElement>('pdf-document-translation-primary');
const documentTranslationStop = element<HTMLButtonElement>('pdf-document-translation-stop');
const documentTranslationClear = element<HTMLButtonElement>('pdf-document-translation-clear');
const documentTranslationNote = element<HTMLElement>('pdf-document-translation-note');
const documentTranslationPages = element<HTMLElement>('pdf-document-translation-pages');
const searchPanel = element<HTMLElement>('pdf-search');
const searchQuery = element<HTMLInputElement>('pdf-search-query');
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
let wheelZoomTimer: ReturnType<typeof setTimeout> | undefined;
let wheelZoomAccumulatedDelta = 0;
let wheelZoomAnchor: PageAnchor | undefined;
let textSelectionSnapFrame: number | undefined;
let continuousSidebarActive = false;
let readingStateSaveTimer: ReturnType<typeof setTimeout> | undefined;
let currentReadingIdentity: string | undefined;
let restoringReadingState = false;
let fileDragDepth = 0;
const PDF_SEARCH_RESULT_LIMIT = 5_000;
const PDF_SEARCH_PREVIEW_LIMIT = 80;
const PDF_SEARCH_HIGHLIGHT_NAME = 'pi-pdf-search-match';
const PDF_SEARCH_CURRENT_HIGHLIGHT_NAME = 'pi-pdf-search-current';
const searchPageIndexes = new Map<number, PdfSearchPageIndex>();
let searchMatches: PdfSearchMatch[] = [];
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
  status: 'idle' | 'translating' | 'done' | 'error';
  translatedText?: string;
  errorMessage?: string;
  singleRetry?: boolean;
}

let pdfDocumentTranslationPhase: PdfDocumentTranslationPhase = 'idle';
let pdfDocumentTranslationBlocksState: PdfDocumentTranslationRuntimeBlock[] = [];
let pdfDocumentTranslationUnreadablePages = 0;
let pdfDocumentTranslationMultiColumnPages = 0;
let pdfDocumentTranslationRemovedMarginLines = 0;
let pdfDocumentTranslationRequestId: string | undefined;
let pdfDocumentTranslationTask: Promise<void> | undefined;
let pdfDocumentTranslationRevision = 0;
let pdfDocumentTranslationMessage: string | undefined;
let pdfDocumentTranslationSettings: Pick<
  PublicSettings,
  | 'sourceLanguage'
  | 'targetLanguage'
  | 'style'
  | 'contentMode'
  | 'autoRenderLatex'
> = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  style: 'academic',
  contentMode: 'auto',
  autoRenderLatex: true,
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
let sourceRegionHighlight: HTMLElement | undefined;
let sourceRegionHighlightTimer: ReturnType<typeof setTimeout> | undefined;

function clearSourceRegionHighlight(): void {
  sourceRegionHighlight?.remove();
  sourceRegionHighlight = undefined;
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
    action?: { label: string; ariaLabel?: string; onClick: () => void };
  } = {},
): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = undefined;
  noticeRevision += 1;
  notice.hidden = !message;
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

function pdfDocumentTranslationCounts(): {
  translated: number;
  failed: number;
  total: number;
} {
  return {
    translated: pdfDocumentTranslationBlocksState.filter((block) => block.status === 'done').length,
    failed: pdfDocumentTranslationBlocksState.filter((block) => block.status === 'error').length,
    total: pdfDocumentTranslationBlocksState.length,
  };
}

function updatePdfDocumentTranslationInset(): void {
  const width = !documentTranslationPanel.hidden && !matchMedia('(max-width: 620px)').matches
    ? Math.min(390, innerWidth)
    : 0;
  stage.style.setProperty('--pdf-document-sidebar-right', `${width}px`);
  scheduleFitWidthRefresh();
}

function syncPdfDocumentTranslationCurrentPage(pageNumber = visiblePageAnchor().pageNumber): void {
  for (const section of documentTranslationPages.querySelectorAll<HTMLElement>(
    '.pdf-document-translation-page[data-page-number]',
  )) {
    section.toggleAttribute('data-current', Number(section.dataset.pageNumber) === pageNumber);
  }
}

function syncPdfDocumentTranslationUi(): void {
  const { translated, failed, total } = pdfDocumentTranslationCounts();
  const pending = Math.max(0, total - translated - failed);
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
  documentTranslationStatus.textContent = pdfDocumentTranslationMessage ?? defaultStatus;
  documentTranslationPrimary.disabled = pdfDocumentTranslationPhase === 'preparing' || total === 0;
  documentTranslationPrimary.hidden = pdfDocumentTranslationPhase === 'complete' && failed === 0;
  documentTranslationPrimary.textContent = pdfDocumentTranslationPhase === 'running'
    ? '暂停'
    : pdfDocumentTranslationPhase === 'paused'
      ? '继续'
      : pdfDocumentTranslationPhase === 'complete' && failed > 0
        ? `重试 ${failed} 段`
        : pdfDocumentTranslationPhase === 'error'
          ? '继续'
          : translated > 0 && pending > 0
            ? '继续翻译'
            : '开始翻译';
  documentTranslationStop.hidden = ![
    'running',
    'paused',
  ].includes(pdfDocumentTranslationPhase);
  documentTranslationClear.hidden = !total || (
    translated === 0 && failed === 0 && pdfDocumentTranslationPhase === 'ready'
  );
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
  documentTranslationNote.textContent = pdfDocumentTranslationUnreadablePages
    ? `正文只在确认后批量发送；${pdfDocumentTranslationUnreadablePages} 页没有可用文字层，已保留原页且不会自动截图。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''} 点击译文可返回原文。`
    : `正文只在确认后批量发送；原始 PDF、公式和图表始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''} 译文按页排列，点击可返回原文。`;
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
    (block) => block.pageNumber === pageNumber,
  );
  const done = pageBlocks.filter((block) => block.status === 'done').length;
  const failed = pageBlocks.filter((block) => block.status === 'error').length;
  const progress = section.querySelector<HTMLElement>('[data-page-progress]');
  if (progress) progress.textContent = `${done}/${pageBlocks.length}${failed ? ` · ${failed} 待重试` : ''}`;
}

function pdfDocumentTranslationSourceLocation(
  block: PdfDocumentTranslationRuntimeBlock,
): PdfSourceLocation | undefined {
  if (!block.sourceAnchor) return undefined;
  return {
    documentId: currentDocumentSessionId,
    pageNumber: block.pageNumber,
    ...block.sourceAnchor,
  };
}

function activatePdfDocumentTranslationSource(
  block: PdfDocumentTranslationRuntimeBlock,
): void {
  if (block.status !== 'done') return;
  const reference = pdfDocumentTranslationSourceLocation(block);
  if (!reference) return;
  void navigateToPdfRegion(reference).then(() => {
    updatePageControl({ pageNumber: block.pageNumber, ratio: reference.topRatio });
    syncPdfDocumentTranslationCurrentPage(block.pageNumber);
  });
}

function renderPdfDocumentTranslationBlock(block: PdfDocumentTranslationRuntimeBlock): void {
  if (block.status === 'idle') {
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
    if (block.sourceAnchor) {
      container.addEventListener('click', (event) => {
        if ((event.target as Element | null)?.closest('button')) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && (
          container!.contains(selection.anchorNode) || container!.contains(selection.focusNode)
        )) return;
        activatePdfDocumentTranslationSource(block);
      });
      container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if ((event.target as Element | null)?.closest('button')) return;
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
  const sourceAvailable = Boolean(block.sourceAnchor && block.status === 'done');
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
  if (block.status === 'done' && block.translatedText) {
    void renderTranslationContent(
      container,
      block.translatedText,
      pdfDocumentTranslationSettings.autoRenderLatex,
    );
  } else if (block.status === 'error') {
    container.replaceChildren(document.createTextNode(block.errorMessage ?? '本段翻译失败。'));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '重试本段';
    retry.addEventListener('click', () => {
      block.status = 'idle';
      block.singleRetry = true;
      delete block.errorMessage;
      pdfDocumentTranslationPhase = 'running';
      pdfDocumentTranslationMessage = undefined;
      renderPdfDocumentTranslationBlock(block);
      syncPdfDocumentTranslationUi();
      void processPdfDocumentTranslationQueue();
    });
    container.append(retry);
  } else {
    container.textContent = '正在翻译本页内容…';
  }
  updatePdfDocumentTranslationPageProgress(block.pageNumber);
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

function resetPdfDocumentTranslation(closePanel = false): void {
  pdfDocumentTranslationRevision += 1;
  cancelPdfDocumentTranslationRequest();
  pdfDocumentTranslationBlocksState = [];
  pdfDocumentTranslationUnreadablePages = 0;
  pdfDocumentTranslationMultiColumnPages = 0;
  pdfDocumentTranslationRemovedMarginLines = 0;
  pdfDocumentTranslationPhase = 'idle';
  pdfDocumentTranslationMessage = undefined;
  pdfDocumentTranslationTask = undefined;
  documentTranslationPages.replaceChildren();
  if (closePanel) documentTranslationPanel.hidden = true;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
}

async function preparePdfDocumentTranslation(): Promise<void> {
  const pdf = pdfDocument;
  if (!pdf || pdfDocumentTranslationPhase === 'preparing') return;
  const revision = ++pdfDocumentTranslationRevision;
  const epoch = documentEpoch;
  pdfDocumentTranslationPhase = 'preparing';
  pdfDocumentTranslationMessage = '正在本地读取文字层…';
  pdfDocumentTranslationBlocksState = [];
  pdfDocumentTranslationUnreadablePages = 0;
  pdfDocumentTranslationMultiColumnPages = 0;
  pdfDocumentTranslationRemovedMarginLines = 0;
  documentTranslationPages.replaceChildren();
  syncPdfDocumentTranslationUi();
  const pages: PdfDocumentTranslationPageInput[] = [];
  let unreadablePages = 0;
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
      const items: PdfDocumentTranslationTextItem[] = content.items.flatMap((item) => {
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
          ...(Number.isFinite(baseline[0]) && Number.isFinite(baseline[1]) &&
            Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
            ? {
                left: baseline[0],
                top: baseline[1] - height,
                width,
                height,
              }
            : {}),
        }];
      });
      pages.push({
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        items,
      });
    } catch {
      unreadablePages += 1;
    }
    if (pageNumber % 4 === 0 || pageNumber === pdf.numPages) {
      pdfDocumentTranslationMessage = `正在本地读取文字层 · ${pageNumber}/${pdf.numPages} 页`;
      syncPdfDocumentTranslationUi();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  if (revision !== pdfDocumentTranslationRevision || epoch !== documentEpoch) return;
  const prepared = preparePdfDocumentTranslationPages(pages);
  const discovered = prepared.blocks.map((block) => ({
    ...block,
    status: 'idle' as const,
  }));
  pdfDocumentTranslationUnreadablePages = unreadablePages + prepared.unreadablePages;
  pdfDocumentTranslationMultiColumnPages = prepared.multiColumnPages;
  pdfDocumentTranslationRemovedMarginLines = prepared.removedRepeatedMarginLines;
  pdfDocumentTranslationBlocksState = discovered;
  pdfDocumentTranslationMessage = undefined;
  pdfDocumentTranslationPhase = discovered.length ? 'ready' : 'error';
  if (!discovered.length) {
    pdfDocumentTranslationMessage = '没有读取到可翻译文字；扫描版请先使用“识别本页”。';
  }
  syncPdfDocumentTranslationUi();
}

function pdfDocumentTranslationContext(block: PdfDocumentTranslationRuntimeBlock): string | undefined {
  const index = pdfDocumentTranslationBlocksState.indexOf(block);
  const previous = index > 0 ? pdfDocumentTranslationBlocksState[index - 1] : undefined;
  const parts = [
    documentName.textContent ? `文档：${documentName.textContent}` : '',
    previous?.text ? `上一段：${previous.text}` : '',
    previous?.translatedText ? `上一段译文：${previous.translatedText}` : '',
  ].filter(Boolean);
  const context = parts.join('\n').slice(-800).trim();
  return context || undefined;
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
        .filter((block) => block.status === 'idle')
        .sort((left, right) => comparePdfDocumentTranslationPriority(left, right, currentPage));
      const first = pending[0];
      if (!first) break;
      const selected = takeDocumentTranslationBatch(
        pending.map((block) => ({
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
      const translated = new Map(response.data.items.map((item) => [item.id, item.translatedText]));
      for (const block of selected) {
        const translatedText = translated.get(block.id)?.trim();
        if (translatedText) {
          block.status = 'done';
          block.translatedText = translatedText;
          delete block.errorMessage;
          delete block.singleRetry;
        } else if (block.singleRetry) {
          block.status = 'error';
          block.errorMessage = '模型没有返回这一段的译文。';
        } else {
          block.status = 'idle';
          block.singleRetry = true;
        }
        renderPdfDocumentTranslationBlock(block);
      }
      pdfDocumentTranslationMessage = undefined;
      syncPdfDocumentTranslationUi();
    }
    if (
      revision === pdfDocumentTranslationRevision &&
      pdfDocumentTranslationPhase === 'running'
    ) {
      pdfDocumentTranslationPhase = 'complete';
      syncPdfDocumentTranslationUi();
    }
  })().finally(() => {
    pdfDocumentTranslationTask = undefined;
    if (
      pdfDocumentTranslationPhase === 'running' &&
      pdfDocumentTranslationBlocksState.some((block) => block.status === 'idle')
    ) void processPdfDocumentTranslationQueue();
  });
  await pdfDocumentTranslationTask;
}

async function openPdfDocumentTranslation(): Promise<void> {
  if (!pdfDocument) return;
  documentTranslationPanel.hidden = false;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
  if (pdfDocumentTranslationPhase === 'idle') await preparePdfDocumentTranslation();
}

function closePdfDocumentTranslation(): void {
  documentTranslationPanel.hidden = true;
  updatePdfDocumentTranslationInset();
  syncPdfDocumentTranslationUi();
  translateDocument.focus({ preventScroll: true });
}

function startOrTogglePdfDocumentTranslation(): void {
  if (pdfDocumentTranslationPhase === 'running') {
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = undefined;
    syncPdfDocumentTranslationUi();
    return;
  }
  if (pdfDocumentTranslationPhase === 'complete') {
    for (const block of pdfDocumentTranslationBlocksState) {
      if (block.status !== 'error') continue;
      block.status = 'idle';
      block.singleRetry = true;
      delete block.errorMessage;
      renderPdfDocumentTranslationBlock(block);
    }
  }
  pdfDocumentTranslationPhase = 'running';
  pdfDocumentTranslationMessage = undefined;
  syncPdfDocumentTranslationUi();
  void processPdfDocumentTranslationQueue();
}

function stopPdfDocumentTranslation(): void {
  pdfDocumentTranslationRevision += 1;
  cancelPdfDocumentTranslationRequest();
  for (const block of pdfDocumentTranslationBlocksState) {
    if (block.status !== 'translating') continue;
    block.status = 'idle';
    renderPdfDocumentTranslationBlock(block);
  }
  pdfDocumentTranslationPhase = 'stopped';
  pdfDocumentTranslationMessage = undefined;
  pdfDocumentTranslationTask = undefined;
  syncPdfDocumentTranslationUi();
}

function clearPdfDocumentTranslation(): void {
  pdfDocumentTranslationRevision += 1;
  cancelPdfDocumentTranslationRequest();
  for (const block of pdfDocumentTranslationBlocksState) {
    block.status = 'idle';
    delete block.translatedText;
    delete block.errorMessage;
    delete block.singleRetry;
  }
  pdfDocumentTranslationTask = undefined;
  pdfDocumentTranslationPhase = pdfDocumentTranslationBlocksState.length ? 'ready' : 'idle';
  pdfDocumentTranslationMessage = undefined;
  documentTranslationPages.replaceChildren();
  syncPdfDocumentTranslationUi();
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
  resetPdfDocumentTranslation(true);
  void persistReadingState();
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
  if (!pdfDocument || !currentReadingIdentity || restoringReadingState) return undefined;
  const anchor = visiblePageAnchor();
  return {
    pageNumber: anchor.pageNumber,
    pageRatio: anchor.ratio,
    zoomLevel: currentZoom(),
    fitWidth: fitWidthActive,
    sidebarExpanded: pdfSidebarLayout.expanded,
    updatedAt: Date.now(),
  };
}

async function persistReadingState(): Promise<void> {
  if (readingStateSaveTimer) clearTimeout(readingStateSaveTimer);
  readingStateSaveTimer = undefined;
  const identity = currentReadingIdentity;
  const state = currentPdfReadingState();
  if (!identity || !state) return;
  await savePdfReadingState(identity, state).catch(() => undefined);
}

function scheduleReadingStateSave(): void {
  if (!currentReadingIdentity || restoringReadingState) return;
  if (readingStateSaveTimer) clearTimeout(readingStateSaveTimer);
  readingStateSaveTimer = setTimeout(() => {
    readingStateSaveTimer = undefined;
    void persistReadingState();
  }, 320);
}

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
  const identity = currentReadingIdentity;
  if (!identity) return;
  const epoch = documentEpoch;
  const revision = ++bookmarkSaveRevision;
  const snapshot = pdfReadingBookmarks.map((bookmark) => ({ ...bookmark }));
  bookmarkSaveQueue = bookmarkSaveQueue.catch(() => undefined).then(async () => {
    try {
      const saved = await savePdfReadingBookmarks(identity, snapshot);
      if (
        currentReadingIdentity !== identity ||
        documentEpoch !== epoch ||
        bookmarkSaveRevision !== revision
      ) return;
      pdfReadingBookmarks = saved.bookmarks;
      renderPdfBookmarks();
    } catch {
      if (currentReadingIdentity === identity && documentEpoch === epoch) {
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
    target.focus({ preventScroll: true });
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

function searchMatchIdentity(match: PdfSearchMatch | undefined): string | undefined {
  return match ? `${match.pageNumber}:${match.start}:${match.end}` : undefined;
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
  const pageMatches = searchMatches.filter((match) => match.pageNumber === pageNumber);
  for (const match of pageMatches) {
    for (const itemIndex of match.itemIndexes) {
      spans[itemIndex]?.classList.add('pi-pdf-search-match');
    }
  }
  const current = searchMatches[searchResultIndex];
  if (current?.pageNumber !== pageNumber) return;
  for (const itemIndex of current.itemIndexes) {
    spans[itemIndex]?.classList.add('pi-pdf-search-current');
  }
}

function refreshPdfSearchHighlights(): void {
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
      if (match.pageNumber !== pageNumber) continue;
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
    page.textContent = `第 ${match.pageNumber} 页`;
    const excerpt = document.createElement('span');
    excerpt.className = 'pdf-search-result-excerpt';
    const indexedPage = searchPageIndexes.get(match.pageNumber);
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
  const hasSearchableText = [...searchPageIndexes.values()].some((page) => page.text);
  setSearchStatus(hasSearchableText ? '未找到' : '当前文档没有可搜索文字');
}

function updatePdfSearchMatches(preserveCurrent: boolean): void {
  const currentIdentity = preserveCurrent
    ? searchMatchIdentity(searchMatches[searchResultIndex])
    : undefined;
  searchMatches = findPdfSearchMatches(
    searchPageIndexes.values(),
    activeSearchQuery,
    PDF_SEARCH_RESULT_LIMIT,
  );
  const preservedIndex = currentIdentity
    ? searchMatches.findIndex((match) => searchMatchIdentity(match) === currentIdentity)
    : -1;
  searchResultIndex = preservedIndex >= 0 ? preservedIndex : searchMatches.length ? 0 : -1;
  syncPdfSearchStatus();
  refreshPdfSearchHighlights();
}

function navigateToPdfSearchResult(index: number): void {
  const pdf = pdfDocument;
  if (!pdf || !searchMatches.length) return;
  searchResultIndex = (index + searchMatches.length) % searchMatches.length;
  const match = searchMatches[searchResultIndex]!;
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
  if (!pdf || !activeSearchQuery || searchPanel.hidden || searchIndexing) return;
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
  if (!pdfDocument) return;
  const returnFocus = !outlinePanel.hidden
    ? openOutline
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  closePdfOutline(false);
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
    target.focus({ preventScroll: true });
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
searchQuery.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' || !searchMatches.length || !searchResultsExpanded) return;
  event.preventDefault();
  focusPdfSearchResult(Math.max(0, searchResultIndex));
});
document.addEventListener('keydown', (event) => {
  const searchShortcut = (event.ctrlKey || event.metaKey) &&
    !event.altKey && event.key.toLocaleLowerCase() === 'f';
  if (searchShortcut && pdfDocument) {
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
    const [restoredState, restoredBookmarks] = await Promise.all([
      readingStatePromise,
      bookmarkStatePromise,
    ]);
    if (!isCurrentOpen(operation)) {
      await nextDocument.destroy();
      return;
    }
    pdfDocument = nextDocument;
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
  } catch (error) {
    if (!isCurrentOpen(operation)) return;
    if (pdfDocument === nextDocument) pdfDocument = undefined;
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
      if (documentEpoch !== expectedDocumentEpoch) finish(false);
      else if (pageElement.dataset.rendered === 'ready') finish(true);
      else if (pageElement.dataset.rendered === 'error') finish(false);
    });
    const timeout = setTimeout(() => finish(false), 3000);
    observer.observe(pageElement, { attributes: true, attributeFilter: ['data-rendered'] });
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
  const pageElement = await pageForSourceLocation({
    ...reference,
    documentId: currentDocumentSessionId,
  });
  if (!pageElement) return;
  clearSourceRegionHighlight();
  const region = regionFromSourceLocation(reference, pageElement);
  const highlight = document.createElement('div');
  highlight.className = 'region-source-highlight';
  highlight.style.left = `${region.left}px`;
  highlight.style.top = `${region.top}px`;
  highlight.style.width = `${region.width}px`;
  highlight.style.height = `${region.height}px`;
  highlight.setAttribute('aria-hidden', 'true');
  pageElement.append(highlight);
  sourceRegionHighlight = highlight;
  sourceRegionHighlightTimer = setTimeout(() => {
    if (sourceRegionHighlight === highlight) sourceRegionHighlight = undefined;
    highlight.remove();
    sourceRegionHighlightTimer = undefined;
  }, 1800);
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

function fitDocumentToAvailableWidth(anchor = visiblePageAnchor()): void {
  const pdf = pdfDocument;
  if (!pdf) return;
  const epoch = documentEpoch;
  void pdf.getPage(anchor.pageNumber).then((page) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch || !fitWidthActive) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const horizontalPadding = matchMedia('(max-width: 720px)').matches ? 28 : 68;
    const availableWidth = Math.max(100, stage.clientWidth - horizontalPadding);
    rebuildAtZoom(availableWidth / Math.max(1, baseViewport.width), anchor);
  }).catch((error: unknown) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch) return;
    showNotice(error instanceof Error ? error.message : '无法计算适合宽度。', {
      tone: 'error',
    });
  });
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

function rebuildAtZoom(nextZoom: number, anchor = visiblePageAnchor()): void {
  if (!pdfDocument) return;
  completedTextSelectionGesture = undefined;
  zoomLevel = clamp(nextZoom, ZOOM_LEVELS[0], ZOOM_LEVELS.at(-1)!);
  setDocumentControls(true);
  void buildPages(pdfDocument, anchor);
  scheduleReadingStateSave();
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
documentTranslationClose.addEventListener('click', closePdfDocumentTranslation);
documentTranslationPrimary.addEventListener('click', startOrTogglePdfDocumentTranslation);
documentTranslationStop.addEventListener('click', stopPdfDocumentTranslation);
documentTranslationClear.addEventListener('click', clearPdfDocumentTranslation);

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
    onSidebarActiveChange: (active) => { continuousSidebarActive = active; },
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
        return identity
          ? getPdfTranslationMarkerState(identity)
          : { enabled: false, markers: [], updatedAt: 0 };
      },
      setEnabled: async (enabled) => {
        const identity = currentReadingIdentity;
        if (identity) await setPdfTranslationMarkerPersistence(identity, enabled);
      },
      save: async (markers) => {
        const identity = currentReadingIdentity;
        if (identity) await savePdfTranslationMarkers(identity, markers);
      },
      clear: async () => {
        const identity = currentReadingIdentity;
        if (identity) await clearPdfTranslationMarkers(identity);
      },
    },
    onPublicSettingsChange: (settings) => {
      pdfDocumentTranslationSettings = {
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        style: settings.style,
        contentMode: settings.contentMode,
        autoRenderLatex: settings.autoRenderLatex,
      };
      pdfKeyboardShortcutsEnabled = settings.pdfKeyboardShortcutsEnabled;
      pdfRegionShortcutKey = settings.pdfRegionShortcutKey;
      updateRegionAction();
    },
  },
);

const onPdfViewportResize = (): void => {
  applyPdfSidebarLayout(pdfSidebarLayout);
  updatePdfDocumentTranslationInset();
};
window.addEventListener('resize', onPdfViewportResize, { passive: true });

window.addEventListener('beforeunload', () => {
  hideDropOverlay();
  stopSearchIndexing();
  if (fitWidthTimer) clearTimeout(fitWidthTimer);
  if (textSelectionSnapFrame !== undefined) cancelAnimationFrame(textSelectionSnapFrame);
  void persistReadingState();
  window.removeEventListener('resize', onPdfViewportResize);
  document.removeEventListener('pointerdown', beginSmartTextSelection, true);
  document.removeEventListener('pointerup', finishSmartTextSelection, true);
  document.removeEventListener('pointercancel', cancelSmartTextSelection, true);
  openAbortController?.abort();
  resetPdfDocumentTranslation(true);
  if (openLoadingTask) void openLoadingTask.destroy().catch(() => undefined);
  clearDocument();
  void pdfDocument?.destroy();
  for (const callback of invalidationCallbacks) callback();
});

setDocumentControls(false);
syncPdfDocumentTranslationUi();
const initialSource = parsePdfSourceUrl(
  new URLSearchParams(location.search).get('url') ?? undefined,
);
const initialPage = pdfInitialPage(location.href) ?? pdfInitialPage(initialSource?.href);
if (initialSource) void openPdfSource(initialSource, initialPage);
