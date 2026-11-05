import {readingRecapPage} from '../../core/content/reading-hints';
import {searchWithConfirmedTerms} from '../../core/translation/search-assistance';
import {hasReadingDraft,pdfReadingTarget,readingSelectionText,selectedReadingQuery,type ReadingSummaryReturn} from '../../core/content/reading-navigation';
import {appendSearchAssistance} from '../../ui/search-assistance';
import {openNoteSummary} from '../../ui/note-summary';
import {bindReadingHints} from '../../ui/reading-hints';
import type {NoteSummaryTarget} from '../../core/content/note-summary';
import {isRuntimeMessage} from '../../core/messaging/messages';
import {keyEventDialog} from '../../ui/dialog-navigation';
import {pdfCitationMetadata} from '../../core/content/local-citation';
import type {CitationMetadata} from '../../core/content/citation-metadata';
import {paragraphCorrectionTerms,deduplicateCorrectionTerms,correctionTermSuggestions,type CorrectionTermSuggestion} from '../../core/translation/correction-term-suggestions';
import {openPassageExplanation} from '../../ui/passage-explanation';
import {documentTermVersion} from '../../core/document/document-memory-repository';
import {normalizeGlossaryTermKey} from '../../core/translation/glossary';
import type {PassageInput} from '../../core/content/passage-explanation';
import {renderCorrectionTermSuggestions,renderCorrectionTermReadFailure} from '../../ui/correction-term-suggestions';
import {bindPdfThumbnails} from '../../ui/pdf-thumbnails';
import {rotatePdfViewRect,type PdfViewRotation} from '../../core/pdf/reader-view';
import { t, msg, uiHtml, initializeUiLanguage, localizeUiDocument, localizeErrorMessage } from '../../core/i18n/ui-language';
import {bindCompactHelp} from '../../ui/compact-help';
import {bindActionHints} from '../../ui/action-feedback';
import {bindActionGuide} from '../../ui/action-guide';
import {bindPdfOriginalCopy} from '../../ui/pdf-original-copy';
import {pdfReadingStateId} from '../../core/pdf/reading-state';
import {pdfDocumentProgress} from '../../core/pdf/document-progress';
import {bindPdfTermReuse} from '../../ui/pdf-term-reuse';
import {documentIdentity} from '../../core/document/document-identity';
import {termSourceUrl,termAppliesToLanguage,type TermSource} from '../../core/document/term-provenance';
import {containsPdfTerm} from '../../core/pdf/term-consistency';
import {bindPdfResearchReferences} from '../../ui/pdf-research-references';
import { bindAnchoredMenus } from '../../ui/anchored-menu';
import {bindPdfReadingAnnotations} from '../../ui/pdf-reading-annotations';
import {bindPdfRecentReading} from '../../ui/pdf-recent-reading';
import {bindPdfExcerptSource} from '../../ui/pdf-excerpt-source';
import {retainedDocumentId} from '../../core/translation/fixed-document-storage';
import {addDocumentToProject} from '../../core/translation/library-projects';
import {layoutTaskDialog} from '../../ui/task-dialog';
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
import { renderFormulaDocument as renderFormulaDocumentBase } from '../../ui/formula-document-view';
import { pdfReviewQueue, pdfReviewConfirmation, pdfReviewConfirmed, type PdfReviewKind } from '../../core/pdf/review-queue';
import {paragraphValue,paragraphRevision,withParagraphHistory,restoredParagraphRevision,MAX_PDF_PARAGRAPH_REVISIONS,type PdfParagraphHistory,type PdfParagraphRevision} from '../../core/pdf/paragraph-history';
import { pdfLeftBraceGlyphMetrics } from '../../core/pdf/tex-font-glyphs';
import {pdfNativeMathFontHints,pdfFontHintText} from '../../core/pdf/math-font-evidence';
import {splitMarkdownTableRow} from '../../core/translation/table-output-validation';
import { bindPdfEquationNumbers } from '../../core/pdf/equation-binding';
import { addPdfReportedTokens, consumePdfRequest, releasePdfRequest, emptyPdfRequestUsage, validPdfRequestLimit, type PdfRequestUsage } from '../../core/pdf/request-budget';
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
  capturePdfRepairStorage,
  commitPdfRepairStorage,
  commitPdfTermCorrection,
  inspectPdfRepairStorage,
  resolvePdfRepairConflict,
  beginPdfArchivedRestore,
  listPdfRepairArchives,
  pdfRepairArchiveCapacity,
  MAX_PDF_REPAIR_ARCHIVES,
  MAX_PDF_REPAIR_ARCHIVE_BYTES,
  PDF_REPAIR_ARCHIVE_KEY,
  pdfRepairVersionDifferences,
  confirmPdfRepairStorage,
  getPdfRepairGuard,
  PDF_REPAIR_GUARD_KEY,
  samePdfRepairInputs,
  type PdfRepairStorageSnapshot,
  type PdfDocumentTranslationSessionActivity,
  type PdfDocumentTranslationSessionDescriptor,
} from '../../core/pdf/document-translation-session';
import {
  renderTranslationContent as renderTranslationContentBase,
  renderTranslationContents as renderTranslationContentsBase,
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

const pendingPdfTranslationRenders = new Set<Promise<unknown>>();
function trackPdfTranslationRender<T>(render: Promise<T>): Promise<T> {
  pendingPdfTranslationRenders.add(render);
  void render.then(() => pendingPdfTranslationRenders.delete(render), () => pendingPdfTranslationRenders.delete(render));
  return render;
}
function renderFormulaDocument(...args: Parameters<typeof renderFormulaDocumentBase>) {
  return trackPdfTranslationRender(renderFormulaDocumentBase(...args));
}
function renderTranslationContent(...args: Parameters<typeof renderTranslationContentBase>) {
  return trackPdfTranslationRender(renderTranslationContentBase(...args));
}
function renderTranslationContents(...args: Parameters<typeof renderTranslationContentsBase>) {
  return trackPdfTranslationRender(renderTranslationContentsBase(...args));
}

async function startUi(): Promise<void> {
  await initializeUiLanguage();
  localizeUiDocument();
  bindActionHints();
  bindCompactHelp();
  bindActionGuide(document,['.pdf-reader-menu-content','#pdf-document-translation-copy-menu > div'],[
    {label:t('打开 PDF'),selector:'#choose-file'},
    {label:t('搜索 PDF'),selector:'#open-search'},
    {label:t('目录'),selector:'#open-outline'},
    {label:t('批注'),selector:'#pdf-open-annotations'},
    {label:t('译全文'),selector:'#translate-document'},
    {label:t('检查术语'),selector:'#pdf-document-terms'},
    {label:t('校订历史'),selector:'#pdf-document-history'},
    {label:t('搜索译文'),selector:'#pdf-library-search'},
    {label:t('返回原页'),selector:'#pdf-document-translation-close'},
  ]);


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
// Reuse the same controls and listeners at both widths; never duplicate IDs or state.
const zoomControls = toolbar.querySelector<HTMLElement>('.zoom-controls')!;
const toolbarZoom = element<HTMLElement>('pdf-toolbar-zoom');
const menuViewTools = element<HTMLElement>('pdf-reader-view-tools');
const compactToolbar = matchMedia('(max-width: 720px)');
const placeZoomControls = () => {
  const focused = document.activeElement instanceof HTMLElement && zoomControls.contains(document.activeElement)
    ? document.activeElement : undefined;
  if (compactToolbar.matches) menuViewTools.insertBefore(zoomControls, element('fit-page'));
  else toolbarZoom.append(zoomControls);
  if (focused) {
    if (compactToolbar.matches && !readerMenu.open) readerMenu.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
    else focused.focus({preventScroll:true});
  }
};
compactToolbar.addEventListener('change', placeZoomControls);
placeZoomControls();
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
const thumbnailsTab = element<HTMLButtonElement>('pdf-navigation-thumbnails-tab');
const thumbnailsPanel = element<HTMLElement>('pdf-thumbnails');
const thumbnails = bindPdfThumbnails(thumbnailsPanel, pageNumber => {
  const epoch = documentEpoch;
  // Fitting a differently sized destination can scroll before the jump itself.
  pushPdfLinkHistory(visiblePageAnchor());
  if (!documentTranslationPanel.hidden && pdfDocumentTranslationViewMode === 'reading') setPdfDocumentTranslationViewMode('compare');
  void (async () => {
    if (fitWidthActive || fitPageActive) await fitDocumentToAvailableWidth({pageNumber,ratio:0});
    if (epoch !== documentEpoch) return;
    jumpToPdfLinkDestination({pageNumber,ratio:0,destinationLabel:msg`第 ${pageNumber} 页`},false);
  })();
});
const bookmarksPanel = element<HTMLElement>('pdf-bookmarks');
const bookmarkAdd = element<HTMLButtonElement>('pdf-bookmark-add');
const bookmarkStatus = element<HTMLElement>('pdf-bookmark-status');
const bookmarkList = element<HTMLElement>('pdf-bookmark-list');
const bookmarkEmpty = element<HTMLElement>('pdf-bookmark-empty');
const openSearch = element<HTMLButtonElement>('open-search');
const translateDocument = element<HTMLButtonElement>('translate-document');
const documentTranslationPanel = element<HTMLElement>('pdf-document-translation');
const documentTranslationStatus = element<HTMLElement>('pdf-document-translation-status');
const pdfCorrectionFollowup=document.createElement('div');pdfCorrectionFollowup.id='pdf-correction-followup';pdfCorrectionFollowup.className='pdf-correction-followup';pdfCorrectionFollowup.hidden=true;documentTranslationStatus.after(pdfCorrectionFollowup);
function showPdfCorrectionFollowup(message:string,action:()=>void,label=t('检查相关用法')):void{const text=document.createElement('span'),button=document.createElement('button'),dismiss=document.createElement('button');text.textContent=message;button.type=dismiss.type='button';button.textContent=label;button.addEventListener('click',action);dismiss.textContent=t('忽略');dismiss.addEventListener('click',()=>{pdfCorrectionFollowup.hidden=true});pdfCorrectionFollowup.replaceChildren(text,button,dismiss);pdfCorrectionFollowup.hidden=false}
const pdfRepairStorageCheck=document.createElement('button');pdfRepairStorageCheck.type='button';pdfRepairStorageCheck.className='pdf-repair-storage-check';pdfRepairStorageCheck.textContent=t('核对保存状态');pdfRepairStorageCheck.hidden=true;documentTranslationStatus.after(pdfRepairStorageCheck);
const pdfRepairVersions=document.createElement('details');pdfRepairVersions.className='pdf-repair-versions';pdfRepairVersions.hidden=true;pdfRepairStorageCheck.after(pdfRepairVersions);
const pdfRepairBackup=document.createElement('button');pdfRepairBackup.type='button';pdfRepairBackup.className='pdf-repair-backup';pdfRepairBackup.textContent=t('查看备份与恢复');pdfRepairBackup.title=t('在新标签打开备份与恢复，返回本页后重新核对。');pdfRepairBackup.hidden=true;pdfRepairVersions.after(pdfRepairBackup);pdfRepairBackup.addEventListener('click',()=>{void browser.tabs.create({url:browser.runtime.getURL('/options.html#storage')})});
const pdfRepairBackupNote=document.createElement('small');pdfRepairBackupNote.className='pdf-repair-backup-note';pdfRepairBackupNote.textContent=t('普通备份包含本机保留版本，不含当前会话版本。');pdfRepairBackupNote.hidden=true;pdfRepairBackup.after(pdfRepairBackupNote);
const pdfRepairArchiveView=document.createElement('button');pdfRepairArchiveView.type='button';pdfRepairArchiveView.className='pdf-repair-backup';pdfRepairArchiveView.textContent=t('查看保留的分歧版本');pdfRepairArchiveView.hidden=true;pdfRepairBackupNote.after(pdfRepairArchiveView);
const pdfArchiveCapacityNote=document.createElement('small');pdfArchiveCapacityNote.className='pdf-repair-backup-note';pdfArchiveCapacityNote.setAttribute('role','status');pdfArchiveCapacityNote.hidden=true;pdfRepairArchiveView.after(pdfArchiveCapacityNote);
const pdfArchiveCapacityBackup=document.createElement('button');pdfArchiveCapacityBackup.type='button';pdfArchiveCapacityBackup.className='pdf-repair-backup';pdfArchiveCapacityBackup.textContent=t('查看备份与恢复');pdfArchiveCapacityBackup.hidden=true;pdfArchiveCapacityNote.after(pdfArchiveCapacityBackup);
function openPdfBackupInNewTab():void{void browser.tabs.create({url:browser.runtime.getURL('/options.html#storage')})}
pdfArchiveCapacityBackup.addEventListener('click',openPdfBackupInNewTab);
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
const fitPage = element<HTMLButtonElement>('fit-page');
const rotatePage = element<HTMLButtonElement>('rotate-page');
const readerFullscreen = element<HTMLButtonElement>('reader-fullscreen');
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
let currentPdfCitation: CitationMetadata = {};
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
let fitPageActive = false;
let viewRotation: PdfViewRotation = 0;
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
let readingHintTarget:NoteSummaryTarget|undefined;
let readingHintResumePage:number|undefined;
const PDF_SEARCH_RESULT_LIMIT = 5_000;
const PDF_SEARCH_PREVIEW_LIMIT = 80;
const PDF_SEARCH_HIGHLIGHT_NAME = 'pi-pdf-search-match';
const PDF_SEARCH_CURRENT_HIGHLIGHT_NAME = 'pi-pdf-search-current';
const searchPageIndexes = new Map<number, PdfSearchPageIndex>();
type ReaderSearchMatch = PdfSearchMatch & { translationBlockId?: string; matchedQuery?:string };
let searchMatches: ReaderSearchMatch[] = [];
const translationSearchIndexes = new Map<string, PdfSearchPageIndex>();
let searchViewContext = '';
let assistedSearchOrigin:{query:string;scope:string}|undefined;
const searchAssistance=document.createElement('div');searchAssistance.id='pdf-search-assistance';searchAssistance.style.gridColumn='1 / -1';searchAssistance.hidden=true;searchPanel.append(searchAssistance);
let translationSearchFrame = 0;
let activeParagraphEdit:{block:PdfDocumentTranslationRuntimeBlock;stamp:string;documentSessionId:string}|undefined;
let lastParagraphCorrection:{block:PdfDocumentTranslationRuntimeBlock;stamp:string;before:PdfCorrectionValue;confirmation?:string;documentSessionId:string}|undefined;
let searchResultIndex = -1;
let activeSearchQuery = '';
let confirmedSearchAliases:string[]=[];
let searchIndexRunId = 0;
let searchIndexing = false;
let searchReturnFocus: HTMLElement | undefined;
let searchSourceReturnSaved = false;
let searchQueryEdited = false;
let searchResultsExpanded = true;
let pdfOutlineEntries: PdfOutlineEntry[] = [];
let pdfOutlineEntryMap = new Map<string, PdfOutlineEntry>();
let pdfOutlineExpandedIds = new Set<string>();
let currentPdfOutlineEntryId: string | undefined;
let outlineReturnFocus: HTMLElement | undefined;
type PdfNavigationView = 'outline' | 'bookmarks' | 'thumbnails';
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
let pdfRepairStorageUncertain = false;
let pdfRepairComparisonEpoch=0;
let pdfRepairContinuationActive = false;
const pdfUncertainRepairDocuments=new Map<string,string>();
let pdfGuardObservation=0;
let pdfRequestUsage: PdfRequestUsage = emptyPdfRequestUsage();
let pdfTrialRunning = false;
let pdfDocumentTranslationBlocksState: PdfDocumentTranslationRuntimeBlock[] = [];
let pdfDocumentTranslationArchivedBlocks: PdfDocumentTranslationSessionBlock[] = [];
let pdfDocumentTranslationPageInputs: PdfDocumentTranslationPageInput[] = [];
const stagedPdfReplacements=new WeakMap<PdfDocumentTranslationRuntimeBlock,PdfParagraphHistory>();
const pendingFormulaRepairs=new WeakMap<PdfDocumentTranslationRuntimeBlock,{document:FormulaDocument;stamp:string}>();
const pendingValidatedRepairs=new WeakMap<PdfDocumentTranslationRuntimeBlock,{replacement:PdfDocumentTranslationSessionBlock;snapshot:PdfRepairStorageSnapshot;stamp:string}>();
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
  rotation?: PdfViewRotation;
  reading?: {mode:PdfDocumentTranslationViewMode;hidden:boolean;top:number;left:number;sourceLeft:number;page:number};
}

interface ResolvedPdfLinkDestination extends PageAnchor {
  destinationLabel: string;
}

const PDF_LINK_HISTORY_LIMIT = 20;
const pdfLinkHistory: (PageAnchor & {summaryReturn?:ReadingSummaryReturn})[] = [];

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
  showNotice(t('无法打开完整设置，请从 Edge 扩展菜单进入 Pi Translator 设置。'), {
    tone: 'error',
  });
  return false;
}

function setDocumentControls(enabled: boolean): void {
  element<HTMLButtonElement>('pdf-original-copy').disabled=!enabled;
  toolbar.dataset.loaded = String(enabled);
  element<HTMLElement>('pdf-reader-view-tools').hidden = !enabled;
  element<HTMLElement>('pdf-reader-recognition-tools').hidden = !enabled;
  chooseFile.textContent = enabled ? t('更换 PDF') : t('打开 PDF');
  chooseFile.title = enabled ? t('选择另一份本地 PDF 替换当前文档') : t('选择一份本地 PDF');
  chooseFile.setAttribute(
    'aria-label',
    enabled ? t('更换当前 PDF 文档') : t('打开本地 PDF 文档'),
  );
  zoomOut.disabled = !enabled || currentZoom() <= ZOOM_LEVELS[0] + 0.001;
  zoomIn.disabled = !enabled || currentZoom() >= ZOOM_LEVELS.at(-1)! - 0.001;
  fitWidth.disabled = !enabled;
  fitWidth.setAttribute('aria-pressed',String(fitWidthActive));
  fitPage.disabled = !enabled;
  fitPage.setAttribute('aria-pressed',String(fitPageActive));
  rotatePage.disabled = !enabled;
  readerFullscreen.disabled = !enabled || !document.fullscreenEnabled;
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
    ? t('整篇文档')
    : pdfDocumentTranslationRangeMode === 'current'
      ? msg`第 ${pdfDocumentTranslationRangePages[0] ?? 1} 页`
      : msg`${pdfDocumentTranslationRangeSummary} 页`;
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
    skippedReferences ? msg`参考文献 ${skippedReferences} 段` : '',
    skippedAppendix ? msg`附录 ${skippedAppendix} 段` : '',
  ].filter(Boolean);
  return msg`${baseLabel}${supplements.length ? msg` · 已自动补齐第 ${supplements.join('、')} 页续段` : ''} · ${selectedPages} 页 / ${scoped.length} 段${
    skipped.length ? msg` · 已跳过${skipped.join('、')}` : ''
  }${preservedReferences ? msg` · 参考文献 ${preservedReferences} 段保留原文` : ''}`;
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
  if(pdfRepairStorageUncertain){pdfDocumentTranslationMessage=t('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。');syncPdfDocumentTranslationUi();return false}
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
  let sessionResult:Awaited<ReturnType<typeof savePdfDocumentTranslationSession>>|undefined;
  if(current()){pdfDocumentTranslationSavesInFlight++;syncPdfDocumentTranslationUi()}
  try {
  try {
    const saved=await savePdfDocumentTranslationSession(sessionNeedsFull ? fullUpdate : update, context.behaviorKey);
    sessionResult=saved;
    if(current())for(const result of saved.blocks){const block=pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===result.signature);if(block&&result.revisions)block.revisions=result.revisions}
    sessionSaved = true;
    if (current()) pdfDocumentTranslationSessionWriteDirty = false;
  } catch {
    if (current()) pdfDocumentTranslationSessionWriteDirty = true;
    // Session checkpoints are best effort and must never stop translation.
  }
  if (retainLocally) {
    try {
      const pending=retainedNeedsFull ? fullUpdate : update;
      const retainedUpdate=sessionResult&&pending.blocks?{...pending,blocks:pending.blocks.map(block=>{
        const submitted=(sessionNeedsFull?fullUpdate:update).blocks?.find(item=>item.signature===block.signature);
        const stored=sessionResult!.blocks.find(item=>item.signature===block.signature);
        return submitted&&JSON.stringify(submitted)===JSON.stringify(block)&&stored?.revisions?{...block,revisions:stored.revisions}:block;
      })}:pending;
      await saveRetainedPdfDocumentTranslationSession(retainedUpdate, context.behaviorKey);
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
        error instanceof Error ? error.message : t('本机保留暂时失败；当前 Edge 会话中的进度仍然安全。');
      syncPdfDocumentTranslationUi();
    }
  }
  for(const block of blocks){
    const before=stagedPdfReplacements.get(block);if(!before)continue;
    if(!sessionSaved&&!retainedSaved&&current()){
      applyPdfParagraphValue(block,before);block.retranslation=true;block.status='error';block.errorMessage=t('新译文尚未保存，继续保留旧稿。请检查存储后重试。');renderPdfDocumentTranslationBlock(block);
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
    showNotice(t('修正已保留在当前会话，本机保存暂未成功。'), {tone: 'warning'});
  } else if (pdfDocumentTranslationSessionWriteDirty && pdfDocumentTranslationRetainedLocally) {
    showNotice(t('修正已保留到本机，当前会话写入暂未成功。'), {tone: 'warning'});
  }
}

async function setPdfDocumentTranslationRetention(enabled: boolean): Promise<void> {
  if(pdfRepairStorageUncertain||pdfRepairContinuationActive){syncPdfDocumentTranslationUi();return}
  const context = pdfDocumentTranslationSessionContext;
  if (!context || pdfDocumentTranslationRetentionPending) return;
  pdfDocumentTranslationRetentionPending = true;
  pdfDocumentTranslationRetentionError = false;
  pdfDocumentTranslationRetentionMessage = enabled ? t('正在保存到本机…') : t('正在清除本机保存…');
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
        t('已保留到本机；再次打开同一 PDF 会自动恢复。');
      const projectId=new URL(location.href).searchParams.get('project');
      if(projectId){try{const name=await addDocumentToProject(retainedDocumentId('pdf',context.descriptor),projectId);pdfDocumentTranslationRetentionMessage=msg`已保留到本机 · 已加入项目 ${name}`}
      catch{pdfDocumentTranslationRetentionMessage=t('已保留到本机，但未加入项目；可在文档库重新选择。')}}
    } else {
      await clearRetainedPdfDocumentTranslationSession(context.descriptor);
      pdfDocumentTranslationRetentionMessage = t('本机保存已清除；当前会话中的译文不受影响。');
    }
  } catch {
    pdfDocumentTranslationRetainedLocally = !enabled;
    pdfDocumentTranslationRetentionError = true;
    pdfDocumentTranslationRetentionMessage = enabled
      ? t('无法保留到本机，请检查扩展存储空间后重试。')
      : t('无法清除本机保存，请稍后重试。');
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
    pdfDocumentTranslationRangeError = t('这个范围没有可翻译正文，请调整页码或跳过选项。');
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
    ? t('范围已更新，全文翻译已暂停。')
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
      ? pdfDocumentTranslationOcrRunning ? t('正在识别本页文字…') : t('本页需要先识别文字。')
      : pdfDocumentTranslationPhase === 'ready'
        ? t('选择翻译范围，开始后在这里阅读译文。')
      : !currentBlocks.length
      ? msg`第 ${safePageNumber} 页不在当前翻译范围内。`
      : currentBlocks.some((block) => block.status === 'idle')
        ? msg`第 ${safePageNumber} 页译文尚未完成，全文翻译会继续在后台处理。`
        : msg`第 ${safePageNumber} 页暂时没有可显示的译文。`;
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
    pdfDocumentTranslationMessage = error instanceof Error ? error.message : t('已达到任务请求上限。');
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
    documentTrialNote.textContent = t('正在试译所选段落…');
    return;
  }
  const selected = documentTrialBlock.value;
  const available = candidates.map((block) => block.id).join(',');
  if (documentTrialBlock.dataset.available !== available) {
    documentTrialBlock.replaceChildren(...candidates.map((block) => {
      const option = document.createElement('option');
      option.value = block.id;
      option.textContent = msg`第 ${block.pageNumber} 页 · ${block.text.replace(/\s+/gu, ' ').slice(0, 55)}`;
      return option;
    }));
    documentTrialBlock.dataset.available = available;
    if (candidates.some((block) => block.id === selected)) documentTrialBlock.value = selected;
  }
  const block = candidates.find((candidate) => candidate.id === documentTrialBlock.value);
  const busy = pdfDocumentTranslationPhase === 'running' || pdfDocumentTranslationOcrRunning;
  const preservedFormula = block?.kind === 'formula' && !pdfTrialUsesVision(block);
  documentTrialStart.disabled = pdfRepairStorageUncertain || !block || busy || preservedFormula;
  documentTrialBlock.disabled = busy || !candidates.length;
  documentTrialNote.textContent = preservedFormula
    ? t('本段包含公式，纯文本模式会保留原文。开启智能多模态后可试译，或选择其他文字段落。')
    : block && pdfTrialUsesVision(block)
    ? msg`只发送本段原文区域，预计 ${block.visualUnits?.length ?? 1} 次视觉请求；点击后开始发送。`
    : t('只发送本段文字；已完成结果可供后续全文任务复用。');
}

async function trialPdfDocumentBlock(blockId = documentTrialBlock.value): Promise<void> {
  if(pdfRepairStorageUncertain)return;
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
      if(previous.translatedText)block.retranslation=true;
      block.status = 'translating';
      renderPdfDocumentTranslationBlock(block);
      const response = await browser.runtime.sendMessage({ type: 'TRANSLATE_DOCUMENT_BATCH', payload: {
        requestId, items: [{ id: block.id, text: block.text }],
        ...(previous.translatedText?{bypassCache:true}:{}),
        ...pdfGlossaryLocator(),
        documentId: currentReadingIdentity ?? currentDocumentSessionId, pageUrl: currentSourceUrl ?? location.href,
        targetLanguage: pdfDocumentTranslationSettings.targetLanguage, sourceLanguage: pdfDocumentTranslationSettings.sourceLanguage,
        style: pdfDocumentTranslationSettings.style, contentMode: pdfDocumentTranslationSettings.contentMode,
      } } satisfies RuntimeMessage) as TranslationBatchRuntimeResponse;
      if (revision !== pdfDocumentTranslationRevision) return;
      pdfDocumentTranslationRequestId = undefined;
      if (!response.ok) throw new Error(translationErrorMessage(response.error.code, response.error.message));
      addPdfReportedTokens(pdfRequestUsage, response.data.usage, response.data.usageSource);
      const text = response.data.items.find((item) => item.id === block.id)?.translatedText.trim();
      if (!text) throw new Error('模型未返回所选段落的译文。');
      applyPdfTranslationOutcome(block,pdfBackgroundTextOutcome(block,text,pdfDocumentTranslationSettings.targetLanguage));
      renderPdfDocumentTranslationBlock(block);
      await persistPdfDocumentTranslationSession([block]);
    }
    if (revision === pdfDocumentTranslationRevision && pdfDocumentTranslationPhase === 'running') {
      pdfDocumentTranslationPhase = 'paused';
      const progress = pdfDocumentTranslationCounts();
      pdfDocumentTranslationMessage = block.status==='error'?block.errorMessage:msg`试译完成 · ${progress.translated}/${progress.total}`;
      documentTranslationSettings.open = false;
      documentTrial.open = false;
    }
  } catch (error) {
    if (revision !== pdfDocumentTranslationRevision) return;
    Object.assign(block, previous);
    if(!previous.retranslation)delete block.retranslation;
    pdfDocumentTranslationPhase = 'paused';
    pdfDocumentTranslationMessage = error instanceof Error ? error.message : t('试译失败。');
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
  documentReviewSummary.textContent = msg`核对清单 · ${all.length - confirmed} 段待处理${confirmed ? msg` · ${confirmed} 段已人工核对` : ''}`;
  if (!documentReview.open) return;
  const labels = { untranslated: t('尚未翻译'), failed: t('翻译失败'), formula: t('译文待核对'), original: t('保留原文') };
  const items = pdfReviewQueue(pdfDocumentTranslationBlocksState, documentReviewFilter.value as 'all' | PdfReviewKind);
  const fragment = document.createDocumentFragment();
  for (const { block, kind, confirmed: reviewed } of items.slice(0, 50)) {
    const source = pdfDocumentTranslationBlocksState.find((candidate) => candidate.id === block.id)!;
    const row = document.createElement('div');
    row.className = 'pdf-document-review-item';
    row.dataset.reviewBlock = block.id;
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.textContent = msg`第 ${block.pageNumber} 页 · ${block.id} · ${reviewed ? t('已人工核对') : labels[kind]}`;
    locate.title = block.formulaReviewMessage ?? block.visualFallbackMessage ?? block.errorMessage ?? t('返回本段原文');
    locate.addEventListener('click', () => activatePdfDocumentTranslationSource(source));
    row.append(locate);
    if (kind !== 'untranslated') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = t('重试本段');
      retry.title = pdfTrialUsesVision(source) ? t('重新发送本段原文区域进行视觉翻译') : t('重新发送本段文字');
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
      acknowledge.textContent = reviewed ? t('撤销确认') : t('标记已核对');
      acknowledge.title = t('只记录人工核对状态，保留模型警告与原文');
      acknowledge.disabled = ['running', 'preparing'].includes(pdfDocumentTranslationPhase);
      acknowledge.addEventListener('click', async () => {
        acknowledge.disabled = true;
        acknowledge.textContent = t('正在保存…');
        const previous = source.reviewConfirmation;
        if (reviewed) delete source.reviewConfirmation;
        else source.reviewConfirmation = pdfReviewConfirmation(source);
        const saved = await persistPdfDocumentTranslationSession([source]);
        if (!saved) {
          if (previous) source.reviewConfirmation = previous;
          else delete source.reviewConfirmation;
          showNotice(t('核对状态未能保存，请稍后再试。'), { tone: 'error' });
        }
        syncPdfReviewQueue();
      });
      row.append(acknowledge);
    }
    fragment.append(row);
  }
  if (!items.length) fragment.append(document.createTextNode(t('没有符合筛选条件的段落。')));
  if (items.length > 50) fragment.append(document.createTextNode(t('先显示前 50 段；可选择类别缩小范围。')));
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
  element<HTMLButtonElement>('pdf-note-summary').hidden=!currentPdfContentFingerprint;
  if((document.getElementById('pdf-terms-dialog') as HTMLDialogElement|null)?.open)renderPdfCorrectionSuggestions();
  const canEdit=!['running','preparing'].includes(pdfDocumentTranslationPhase)&&!pdfDocumentTranslationOcrRunning;
  for(const button of documentTranslationPages.querySelectorAll<HTMLButtonElement>('.pdf-paragraph-edit-action,.pdf-paragraph-explain-action'))button.disabled=!canEdit;
  element<HTMLButtonElement>('pdf-document-undo-correction').hidden=!canEdit||!lastParagraphCorrection||lastParagraphCorrection.documentSessionId!==currentDocumentSessionId||lastParagraphCorrection.stamp!==pdfParagraphStamp(lastParagraphCorrection.block);
  element<HTMLButtonElement>('pdf-document-history').hidden=!canEdit||!pdfDocumentTranslationBlocksState.some(block=>block.revisions?.length);
  element<HTMLButtonElement>('pdf-document-terms').hidden=!canEdit||!pdfDocument||!pdfDocumentTranslationBlocksState.some(block=>block.status==='done'&&!block.referencePreserved);
  if(cachedReadingContext){syncCachedReadingUi();return}
  syncPdfDocumentTranslationSetupUi();
  documentTranslationName.textContent = documentName.textContent;
  syncPdfReviewQueue();
  syncPdfTrialUi();
  documentRequestLimit.disabled = pdfDocumentTranslationPhase === 'running' || pdfTrialRunning;
  documentRequestUsage.textContent = msg`任务请求：文字 ${pdfRequestUsage.text} 次 · 视觉 ${pdfRequestUsage.vision} 次 · OCR ${pdfRequestUsage.ocr} 次` +
    (pdfRequestUsage.reportedTokens ? msg` · 接口已报告 ${pdfRequestUsage.reportedTokens.totalTokens} tokens（未报告部分不计）` : t(' · 接口用量未报告'));
  const prices = pdfDocumentTranslationSettings.modelPrices ?? [];
  const costs = reportedCost(pdfRequestUsage.byModel ?? [], prices);
  const amounts = Object.entries(costs.amounts).map(([currency, amount]) => formatCost(amount!, currency as 'CNY' | 'USD'));
  const textSource = pdfDocumentTranslationSettings.costTextSource;
  const price = textSource ? findModelPrice(prices, textSource) : undefined;
  const pendingCharacters = pdfDocumentTranslationBlocksState.filter((block) => block.included && block.status !== 'done' && !block.referencePreserved && !pdfTrialUsesVision(block) && block.kind !== 'formula' && block.kind !== 'code')
    .reduce((sum, block) => sum + block.text.length, 0);
  const forecast = price && pendingCharacters ? roughTextCost(pendingCharacters, price).map((amount) => formatCost(amount, price.currency)).join('–') : '';
  documentCostEstimate.textContent = msg`已报告用量费用：${amounts.join(' + ') || t('未知')}` +
    (costs.unpricedModels.length ? msg` · 未设单价：${costs.unpricedModels.join('、')}` : '') +
    (forecast ? msg`。剩余文字粗估 ${forecast}` : !price ? t('。可在设置中填写模型单价') : '');
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
    ? msg`；${preservedReferencesInScope} 段参考文献保留原文且不发送请求`
    : '';
  const referenceDetail = preservedReferencesInScope
    ? t('参考文献条目按原文保留且不发送翻译请求。')
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
    total ? msg`已翻译 ${translated}/${total} 段` : t('尚未识别正文'),
  );
  documentTranslationRangeCurrent.textContent = msg`当前页（第 ${currentRangePage} 页）`;
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
    ? t('整篇文档')
    : pdfDocumentTranslationRangeMode === 'current'
      ? msg`第 ${pdfDocumentTranslationRangePages[0] ?? currentRangePage} 页`
      : msg`${pdfDocumentTranslationRangeSummary || t('指定页码')} 页`;
  documentTranslationSettingsSummary.textContent = `${settingsScopeLabel} · ${
    pdfDocumentTranslationMultimodalEnabled
      ? usesUnifiedVision
        ? t('统一多模态')
        : t('按内容选择接口')
      : t('仅文字接口')
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
      ? msg`文档检测到 ${documentFormulaBlocks.length} 个含公式段落；点击开始后，当前范围 ${requestableBlocksInScope} 段统一使用视觉模型，预计 ${visualRequestsInScope} 次视觉请求${referencePreservationNote}`
      : unreadablePagesInScope.length
        ? msg`点击开始后识别 ${unreadablePagesInScope.length} 个扫描页；若发现公式，当前范围全部段落改用视觉模型`
        : visualObjectsInScope.length
          ? msg`普通正文使用文字接口；${figureObjectsInScope.length ? msg`${figureObjectsInScope.length} 个图表` : ''}${figureObjectsInScope.length && tableObjectsInScope.length ? '、' : ''}${tableObjectsInScope.length ? msg`${tableObjectsInScope.length} 个表格` : ''}将整块使用视觉模型，预计 ${visualObjectsInScope.length} 次视觉请求${referencePreservationNote}`
          : msg`文档未检测到公式、图表或表格对象；普通正文使用文字接口${referencePreservationNote}`
    : msg`${formulaBlocksInScope.length ? t('不会发送公式或正文图像；独立公式原样保留；') : ''}${visualObjectsInScope.length ? t('图表与表格不会发送图像，只保留合并后的文字结构；') : ''}${unreadablePagesInScope.length ? msg`${unreadablePagesInScope.length} 个扫描页不会发送；` : ''}其他正文只使用文字接口${referencePreservationNote}`;
  documentTranslationMultimodalStatus.title = documentTranslationMultimodalStatus.textContent;
  documentTranslationMultimodalStatus.textContent = pdfDocumentTranslationMultimodalEnabled
    ? usesUnifiedVision ? msg`当前范围使用视觉模型 · 预计 ${visualRequestsInScope} 次请求` : unreadablePagesInScope.length ? t('扫描页将先识别文字，再翻译') : visualObjectsInScope.length ? t('正文用文字接口，图表用视觉模型') : t('当前正文使用文字接口')
    : formulaBlocksInScope.length ? t('正文用文字接口；公式保留原文') : t('使用文字接口');
  const defaultStatus = pdfDocumentTranslationPhase === 'idle'
    ? t('尚未读取正文')
    : pdfDocumentTranslationPhase === 'preparing'
      ? t('正在本地读取文字层…')
      : pdfDocumentTranslationPhase === 'ready'
        ? msg`已识别 ${total} 段，等待确认`
        : pdfDocumentTranslationPhase === 'running'
          ? msg`全文翻译中 · ${translated}/${total}`
          : pdfDocumentTranslationPhase === 'paused'
            ? msg`已暂停 · ${translated}/${total}`
            : pdfDocumentTranslationPhase === 'stopped'
              ? msg`已停止 · ${translated}/${total}`
              : pdfDocumentTranslationPhase === 'complete'
                ? failed
                  ? msg`已完成 ${translated}/${total} · ${failed} 段待重试`
                  : msg`已完成 ${translated}/${total}`
                : msg`翻译中断 · ${translated}/${total}`;
  const saveState=pdfDocumentTranslationSavesInFlight||pdfDocumentTranslationRetentionPending?'saving'
    :pdfRepairStorageUncertain||pdfDocumentTranslationRetentionError||pdfDocumentTranslationRetentionWriteDirty||pdfDocumentTranslationSessionWriteDirty&&!pdfDocumentTranslationRetainedLocally?'error'
    :pdfDocumentTranslationRetainedLocally?'retained':'session';
  documentTranslationStatus.dataset.saveState=saveState;
  const saveLabel=saveState==='saving'?t('正在保存'):saveState==='error'
    ?pdfRepairStorageUncertain||pdfDocumentTranslationRetentionError||pdfDocumentTranslationRetentionWriteDirty?t('本机保存失败'):t('最新进度未保存')
    :saveState==='retained'?t('已保存到本机'):t('仅当前会话');
  documentTranslationStatus.textContent = (pdfDocumentTranslationOcrRunning
    ? msg`正在识别扫描页 · ${pdfDocumentTranslationOcrProgress.completed}/${pdfDocumentTranslationOcrProgress.total}`
    : pdfDocumentTranslationMessage ?? defaultStatus) +
    (formulaReviewCount ? msg` · ${formulaReviewCount} 段译文待核对` : '') +
    (visualFallbackCount ? msg` · ${visualFallbackCount} 段保留原文` : '') +
    (translated && pdfDocumentTranslationPhase!=='running' ? ` · ${saveLabel}` : '');
  pdfRepairStorageCheck.hidden=!pdfRepairStorageUncertain;
  pdfRepairBackup.hidden=!pdfRepairStorageUncertain;
  pdfRepairBackupNote.hidden=!pdfRepairStorageUncertain;
  const editorCheck=element<HTMLButtonElement>('pdf-paragraph-editor-check');editorCheck.hidden=!pdfRepairStorageUncertain;editorCheck.textContent=t('核对保存状态');
  pdfRepairStorageCheck.textContent=t('核对保存状态');
  pdfRepairStorageCheck.disabled=['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning;
  editorCheck.disabled=pdfRepairStorageCheck.disabled;
  const progress = pdfDocumentProgress(pdfDocumentTranslationBlocksState);
  documentTranslationStatus.title = msg`已处理 ${progress.processed}/${progress.total} 段，其中 ${progress.translated} 段译文、${progress.preserved} 段参考文献保留原文；${progress.review} 段待核对，${progress.confirmed} 段已人工核对。`;
  for (const button of documentTranslationPages.querySelectorAll<HTMLButtonElement>('[data-review-retry]')) {
    button.disabled = pdfRepairStorageUncertain || ['running', 'preparing'].includes(pdfDocumentTranslationPhase) || pdfDocumentTranslationOcrRunning;
  }
  const canStartVisionOnly = pdfDocumentTranslationMultimodalEnabled &&
    !pdfDocumentTranslationMultimodalAuthorized &&
    unreadablePagesInScope.length > 0;
  documentTranslationPrimary.disabled = pdfRepairStorageUncertain || pdfDocumentTranslationPhase === 'preparing' ||
    (Boolean(pdfDocumentTranslationRangeError) && pdfDocumentTranslationPhase !== 'running') ||
    pdfDocumentTranslationOcrRunning || (total === 0 && !canStartVisionOnly);
  documentTranslationPrimary.hidden = pdfDocumentTranslationOcrRunning || pdfDocumentTranslationPhase === 'preparing' ||
    (pdfDocumentTranslationPhase === 'complete' && failed === 0);
  documentTranslationPrimary.textContent = pdfDocumentTranslationOcrRunning ? t('正在识别…') : pdfDocumentTranslationPhase === 'running'
    ? t('暂停')
    : pdfDocumentTranslationPhase === 'paused'
      ? t('继续')
      : pdfDocumentTranslationPhase === 'complete' && failed > 0
        ? msg`重试 ${failed} 段`
        : pdfDocumentTranslationPhase === 'error'
          ? t('继续')
          : canStartVisionOnly && total === 0
            ? t('开始识别并翻译')
            : translated > 0 && pending > 0
            ? t('继续翻译')
            : usesUnifiedVision
              ? t('开始多模态全文翻译')
              : pdfDocumentTranslationMultimodalEnabled && (
                  unreadablePagesInScope.length || visualObjectsInScope.length
                )
                ? t('开始智能翻译')
              : t('开始翻译');
  documentTranslationStop.hidden = !pdfDocumentTranslationBlocksState.some(block=>block.retranslation)&&!pdfDocumentTranslationOcrRunning && ![
    'running',
    'paused',
  ].includes(pdfDocumentTranslationPhase);
  documentTranslationStop.textContent = pdfDocumentTranslationOcrRunning ? t('停止识别') : t('停止');
  documentTranslationClear.hidden = !total || (
    translated === 0 && failed === 0 && pdfDocumentTranslationPhase === 'ready'
  ) || pdfDocumentTranslationPhase === 'preparing';
  documentTranslationClear.textContent = t('重新翻译');
  documentTranslationClear.title = t('保留人工修正；其他段落的新结果通过校验并保存后替换旧稿');
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
  documentTranslationRetentionToggle.disabled = pdfRepairStorageUncertain || pdfRepairContinuationActive || pdfDocumentTranslationRetentionPending ||
    !pdfDocumentTranslationSessionContext;
  documentTranslationRetentionStatus.textContent = pdfDocumentTranslationRetentionMessage ?? (
    pdfDocumentTranslationRetainedLocally
      ? t('只保存译文和匿名段落标识；打开同一 PDF 自动恢复')
      : t('默认只保留在当前 Edge 会话')
  );
  documentTranslationOcr.hidden = !pdfDocumentTranslationOcrRunning &&
    unreadablePagesInScope.length === 0;
  documentTranslationOcr.dataset.tone = pdfDocumentTranslationOcrError ? 'error' : 'info';
  documentTranslationOcrAction.disabled = pdfDocumentTranslationPhase === 'preparing' ||
    (pdfDocumentTranslationPhase === 'running' && !pdfDocumentTranslationOcrRunning);
  documentTranslationOcrAction.textContent = pdfDocumentTranslationOcrRunning
    ? t('停止识别')
    : msg`识别 ${unreadablePagesInScope.length} 页`;
  documentTranslationOcrStatus.textContent = pdfDocumentTranslationOcrRunning
    ? msg`正在逐页识别 · ${pdfDocumentTranslationOcrProgress.completed}/${pdfDocumentTranslationOcrProgress.total}`
    : pdfDocumentTranslationOcrMessage ??
      msg`${unreadablePagesInScope.length} 页没有文字层；智能多模态开启时将在开始后自动识别`;
  translateDocument.setAttribute('aria-expanded', String(!documentTranslationPanel.hidden));
  translateDocument.title = total
    ? msg`PDF 全文翻译 · ${translated}/${total}${failed ? msg` · ${failed} 段待重试` : ''}`
    : t('翻译整篇 PDF');
  const localLayoutNotes = [
    pdfDocumentTranslationMultiColumnPages
      ? msg`已按阅读顺序整理 ${pdfDocumentTranslationMultiColumnPages} 页多栏正文`
      : '',
    pdfDocumentTranslationRemovedMarginLines
      ? msg`已跳过 ${pdfDocumentTranslationRemovedMarginLines} 行重复页眉页脚`
      : '',
  ].filter(Boolean).join('；');
  const retentionNote = pdfDocumentTranslationRetainedLocally
    ? t('已完成译文会保留在本机；不会保存原文、PDF 文件或页面图像。')
    : t('已完成译文默认只保留在当前 Edge 会话中。');
  const visualFallbackNote = (visualFallbackCount
    ? msg` ${visualFallbackCount} 段暂保留原文，具体原因见核对清单。`
    : '') + (formulaReviewCount
      ? msg` ${formulaReviewCount} 段有内容待核对，已保留返回译文，可展开原文截图对照。` : '');
  documentTranslationProcessingDetails.textContent = pdfDocumentTranslationUnreadablePages
    ? msg`预览与范围调整零请求；点击开始即确认当前任务的正文和多模态处理。检测到公式后，当前范围全部可翻译段落统一使用视觉模型。${referenceDetail}${retentionNote}仍有 ${pdfDocumentTranslationUnreadablePages} 页没有可用文字层。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 原始 PDF 始终保留。`
    : usesUnifiedVision
      ? msg`文档含公式，当前范围全部可翻译段落统一使用视觉模型，以保持术语、语气和公式处理一致。${referenceDetail}${retentionNote}原始 PDF、公式和图表始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 译文按页排列，点击可返回原文。`
      : visualObjectsInScope.length && pdfDocumentTranslationMultimodalEnabled
        ? msg`普通正文使用文字接口；图表与表格按完整对象各发送一次图像，避免把刻度、图例或单元格拆成零散译文。${referenceDetail}${retentionNote}原始 PDF 始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 点击对象译文可返回并高亮整块原文。`
        : msg`文档未检测到需要整块视觉处理的公式、图表或表格，普通正文使用文字接口。${referenceDetail}${retentionNote}原始 PDF、公式和图表始终保留。${localLayoutNotes ? ` ${localLayoutNotes}。` : ''}${visualFallbackNote} 译文按页排列，点击可返回原文。`;
  documentTranslationNote.textContent = t('预览在本地完成；开始后发送所选内容及必要的相邻页续段。');
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
    ? msg`${block.formulaReviewDraft ? t('待核对译文（非最终结果）') : proseReview ? t('译文待核对') : t('公式待核对')}：${block.formulaReviewMessage}。已保留返回内容，请对照原 PDF 第 ${block.pageNumber} 页核对。`
    : block.visualFallbackMessage ? msg`本段保留原文：${block.visualFallbackMessage}。` : '';
  const review=notice && pdfReviewConfirmed(block) ? msg`已人工核对。原警告：${block.formulaReviewMessage ?? block.visualFallbackMessage}。` : notice;
  return [block.retranslation?t('重译尚未完成，以下保留上次译文。'):'',review].filter(Boolean).join('\n\n');
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
  documentTranslationPanel.querySelector('.pdf-document-translation-title strong')!.textContent=t('译文阅读');
  documentTranslationViewReading.setAttribute('aria-pressed','true');documentTranslationViewCompare.hidden=true;
  documentTranslationClose.textContent=t('文档库');documentTranslationClose.title=t('返回文档库');documentTranslationClose.ariaLabel=t('返回文档库');
  documentTranslationStatus.textContent=pdfDocumentTranslationRetentionError?t('最新修改尚未保存到本机'):msg`已保存译文 · ${cached.record.blocks.length} 段${cached.record.blocks.some(block=>'retranslation' in block&&block.retranslation)?t(' · 部分段落保留旧稿，选择原 PDF 后可继续重译'):''}`;
  documentTranslationCopyMenu.hidden=false;
  const allowed=new Set(['pdf-library-search','pdf-library-back','pdf-document-translation-copy-translation','pdf-document-translation-download-translation']);
  if(cached.kind==='pdf'){allowed.add('pdf-library-source');if(currentPdfContentFingerprint)allowed.add('pdf-note-summary');if(pdfDocumentTranslationBlocksState.some(block=>block.revisions?.length))allowed.add('pdf-document-history')}
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
      cachedReadingContext={id,name:entry.name,kind:'pdf',record};currentPdfContentFingerprint=record.sourceFingerprint;void refreshPdfRepairArchiveView();
    }else{
      const record=(await retainedWebRecordsForBackup()).find(record=>retainedDocumentId('web',record)===id);if(!record)throw new Error('译文记录不可用。');
      cachedReadingContext={id,name:entry.name,kind:'web',record};
    }
    currentReadingIdentity=`library:${id}`;
    const identity=currentPdfContentFingerprint?`pdf-content:${currentPdfContentFingerprint}`:currentReadingIdentity;
    const [shared,legacy]=await Promise.all([getPdfReadingState(identity),getPdfReadingState(currentReadingIdentity)]);
    const latestReading=shared&&(!legacy||shared.updatedAt>=legacy.updatedAt)?shared:legacy;
    pdfTranslationReadingAnchor=latestReading?.translation??(latestReading?{mode:'reading',pageNumber:latestReading.pageNumber,offsetRatio:0}:undefined);
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
    syncCachedReadingUi();if(entry.kind==='pdf')void refreshPdfReadingHints();restorePdfTranslationReadingAnchor();scheduleReadingStateSave();
    const query=new URL(location.href).searchParams.get('query');
    if(query){openPdfSearch();searchQuery.value=query;searchQueryEdited=true;applyPdfSearchQuery()}
    const url=new URL(location.href);url.searchParams.delete('query');url.searchParams.delete('block');history.replaceState(null,'',url);
  }catch(error){showNotice(error instanceof Error?error.message:t('无法打开保留译文。'),{tone:'error'})}
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
        alt: msg`原 PDF 第 ${block.pageNumber} 页${block.formulaReviewMessage ? t('含公式原文') : block.kind === 'table' ? t('表格') : t('图表')}截图`,
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
  preview.document.write(uiHtml`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>正在生成原页对照翻译 PDF</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f4f5f8;color:#364152;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:420px;padding:28px;text-align:center}strong{display:block;margin-bottom:8px;color:#302d85;font-size:18px}</style></head><body><main><strong>正在本地生成原页对照翻译页…</strong><span>每张原页会完整保留；不会产生新的翻译或 OCR 请求。</span></main></body></html>`);
  preview.document.close();
  return preview;
}

function showPdfLayoutTranslationPreviewError(
  preview: Window,
  message: string,
): void {
  if (preview.closed) return;
  preview.document.open();
  preview.document.write(uiHtml`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>原页对照翻译 PDF 生成失败</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f8f5f5;color:#5f2730;font:14px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:520px;padding:30px}strong{display:block;margin-bottom:8px;font-size:18px}</style></head><body><main><strong>原页对照翻译 PDF 生成失败</strong><span>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span></main></body></html>`);
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
    else if(action==='translation-markdown')triggerDocumentTranslationDownload({content:msg`# ${cachedReadingContext.name.replace(/[\r\n]/gu,' ')}\n\n仅导出已保存译文，不含原文和来源。\n\n${text}`,filename:`${cachedReadingContext.name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').slice(0,80)}.md`,mimeType:'text/markdown;charset=utf-8'});
    setPdfDocumentTranslationCopyFeedback(action==='copy-translation'?t('译文已复制。'):t('译文已导出。'));return;
  }
  if (pdfDocumentTranslationCopyPending) return;
  const layoutPreview = action === 'layout-pdf'
    ? openPdfLayoutTranslationPreview()
    : undefined;
  if (action === 'layout-pdf' && !layoutPreview) {
    setPdfDocumentTranslationCopyFeedback(t('无法打开原页对照翻译页，请允许此页面打开新窗口。'), true);
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
      setPdfDocumentTranslationCopyFeedback(t('正在本地生成原页对照翻译页…'));
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
        msg`已打开原页对照打印页 · ${layout.pageCount} 个原页 · ${layout.blockCount} 段译文`,
      );
      return;
    }
    if (action === 'printable-html') {
      setPdfDocumentTranslationCopyFeedback(t('正在本地生成带原页图的双语 HTML…'));
      result = pdfDocumentTranslationExportResult(
        await capturePdfDocumentTranslationExportPageImages(),
      );
      result = {
        ...result,
        printableHtml: await renderPdfDocumentTranslationExportHtml(result.printableHtml),
      };
    }
    if (action === 'bilingual-markdown') {
      setPdfDocumentTranslationCopyFeedback(t('正在本地截取图表并生成双语 Markdown…'));
      result = pdfDocumentTranslationExportResult(
        [],
        await capturePdfDocumentTranslationMarkdownVisualImages(),
      );
    }
    const pageLabel = result.pageCount ? msg` · ${result.pageCount} 页` : '';
    const partialLabel = result.complete
      ? ''
      : msg` · 部分结果 ${result.blockCount}/${result.totalBlockCount} 段${result.unavailablePageCount ? msg`，${result.unavailablePageCount} 页未识别` : ''}`;
    let message: string;
    if (action === 'copy-translation' || action === 'copy-bilingual') {
      await navigator.clipboard.writeText(action === 'copy-translation'
        ? result.translationText
        : result.bilingualMarkdown);
      message = action === 'copy-translation'
        ? msg`已复制 ${result.blockCount} 段译文${pageLabel}`
        : msg`已复制双语 Markdown · ${result.blockCount} 段${pageLabel}`;
    } else {
      const download = documentTranslationDownload(result, action, 'pdf');
      triggerDocumentTranslationDownload(download);
      message = action === 'translation-markdown'
        ? t('已下载纯译文 Markdown')
        : action === 'bilingual-markdown'
          ? msg`已下载图文双语 Markdown${result.embeddedImageCount
            ? msg` · ${result.embeddedImageCount} 张图表截图`
            : t(' · 未检测到可嵌入图表')}`
          : t('已下载带原页图的可打印 HTML');
      message += pageLabel;
    }
    documentTranslationCopyMenu.open = false;
    setPdfDocumentTranslationCopyFeedback(`${message}${partialLabel}`);
  } catch (error) {
    if (layoutPreview) {
      showPdfLayoutTranslationPreviewError(
        layoutPreview,
        error instanceof Error ? error.message : t('未知错误。'),
      );
    }
    setPdfDocumentTranslationCopyFeedback(
      error instanceof Error ? error.message : t('导出失败，请重试。'),
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
  jump.textContent = msg`第 ${pageNumber} 页`;
  jump.title = msg`回到 PDF 第 ${pageNumber} 页`;
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
  if (progress) progress.textContent = `${done}/${pageBlocks.length}${failed ? msg` · ${failed} 待重试` : ''}`;
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
  if(pdfRepairStorageUncertain)return;
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
  pdfDocumentTranslationMessage = t('正在重试本段；其他段落不会重新请求。');
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
      pdfDocumentTranslationMessage = msg`本段重试未完成，已保留先前结果。${failure ?? ''}`;
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

async function continuePdfFormulaRepair(block:PdfDocumentTranslationRuntimeBlock):Promise<void>{
  if(pdfRepairStorageUncertain)return;
  const candidate=pendingFormulaRepairs.get(block),context=pdfDocumentTranslationSessionContext;
  if(!candidate||!context||!currentPdfContentFingerprint||cachedReadingContext||candidate.stamp!==pdfParagraphStamp(block)||block.manualCorrection||activeParagraphEdit||
    ['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning||!documentRequestLimit.checkValidity())return;
  const revision=pdfDocumentTranslationRevision,previousPhase=pdfDocumentTranslationPhase;
  const current=()=>revision===pdfDocumentTranslationRevision&&pdfDocumentTranslationBlocksState.includes(block)&&candidate.stamp===pdfParagraphStamp(block)&&!activeParagraphEdit&&samePdfDocumentTranslationSessionContext(context,pdfDocumentTranslationSessionContext);
  pdfRepairContinuationActive=true;pdfDocumentTranslationPhase='preparing';syncPdfDocumentTranslationUi();
  let budgetBlocked=false,requestId:string|undefined;
  try{
    await sendPdfDocumentBackgroundControl('dispose');await pdfDocumentBackgroundSnapshotQueue;
    if(!current())throw new Error(t('本段已变化，请重新打开核对。'));
    const expected=pdfDocumentTranslationSessionUpdate(context,[block]).blocks?.[0];
    if(!expected)throw new Error(t('本段保存状态已变化，请重新打开核对。'));
    const snapshot=await capturePdfRepairStorage(context.descriptor,context.behaviorKey,block.sessionSignature,expected,pdfDocumentTranslationRetainedLocally,currentPdfContentFingerprint);
    if(!current())throw new Error(t('本段已变化，请重新打开核对。'));
    takePdfTaskRequest('text');pdfDocumentTranslationPhase='running';requestId=crypto.randomUUID();pdfDocumentTranslationRequestId=requestId;syncPdfDocumentTranslationUi();
    const repaired=await browser.runtime.sendMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{requestId,...termLocator(),document:candidate.document,targetLanguage:pdfDocumentTranslationSettings.targetLanguage,sourceLanguage:pdfDocumentTranslationSettings.sourceLanguage,style:pdfDocumentTranslationSettings.style}} satisfies RuntimeMessage) as TranslateRuntimeResponse;
    if(!current()||pdfDocumentTranslationRequestId!==requestId)return;
    if(!repaired.ok){if(repaired.error.code==='DOCUMENT_TERMS_READ_FAILED')releasePdfRequest(pdfRequestUsage,'text');throw new Error(translationErrorMessage(repaired.error.code,repaired.error.message))}
    addPdfReportedTokens(pdfRequestUsage,repaired.data.result.usage,repaired.data.result.usageSource);
    const outcome=pdfBackgroundVisualOutcome({id:block.id,text:block.text,containsFormula:pdfDocumentTranslationBlockContainsFormula(block),visualPurpose:pdfDocumentTranslationVisualPurpose(block),...(block.equationNumbers?{equationNumbers:block.equationNumbers}:{}),...(block.sourceFontHints?{sourceFontHints:block.sourceFontHints}:{}),...(block.sourceEquations?{sourceEquations:block.sourceEquations}:{})},repaired.data.result,pdfDocumentTranslationSettings.targetLanguage);
    if(outcome.formulaReviewMessage||outcome.visualFallbackMessage||outcome.formulaReviewDraft)throw new Error(t('修复结果仍需核对，先前结果已保留。'));
    const replacement:PdfDocumentTranslationSessionBlock={signature:block.sessionSignature,...paragraphValue(outcome),...(expected.pageNumber?{pageNumber:expected.pageNumber}:{}),...(expected.headingLevel?{headingLevel:expected.headingLevel}:{}),...(expected.paperRole?{paperRole:expected.paperRole}:{})};
    const saved=await commitPdfRepairStorage(snapshot,replacement,()=>current()&&pdfDocumentTranslationRequestId===requestId);
    if(saved.status==='conflict'||saved.status==='failed'){pendingFormulaRepairs.delete(block);pendingValidatedRepairs.set(block,{replacement,snapshot,stamp:pdfParagraphStamp(block)});throw new Error(t('修复结果暂未保存，可重新核对后保存，不会再次请求。'))}
    if(saved.status==='uncertain'){pdfRepairStorageUncertain=true;if(currentPdfContentFingerprint)pdfUncertainRepairDocuments.set(currentPdfContentFingerprint,block.sessionSignature);pendingFormulaRepairs.delete(block);throw new Error(t('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。'))}
    if(saved.status!=='saved')return;
    if(!current())return;
    applyPdfParagraphValue(block,saved.block);block.status='done';if(outcome.visualProcessed)block.visualProcessed=true;else delete block.visualProcessed;delete block.errorMessage;delete block.singleRetry;pendingFormulaRepairs.delete(block);pendingValidatedRepairs.delete(block);
    pdfDocumentTranslationMessage=t('正文修复已保存。');
  }catch(error){budgetBlocked=Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='REQUEST_BUDGET_REACHED');if(revision===pdfDocumentTranslationRevision)pdfDocumentTranslationMessage=error instanceof Error?localizeErrorMessage(error.message):t('正文修复未完成，请稍后重试。')}
  finally{pdfRepairContinuationActive=false;if(revision===pdfDocumentTranslationRevision&&(!requestId||pdfDocumentTranslationRequestId===requestId)){pdfDocumentTranslationRequestId=undefined;pdfDocumentTranslationPhase=budgetBlocked?'paused':previousPhase;renderPdfDocumentTranslationBlock(block)}syncPdfDocumentTranslationUi()}
}

async function savePendingPdfRepair(block:PdfDocumentTranslationRuntimeBlock):Promise<void>{
  const pending=pendingValidatedRepairs.get(block),context=pdfDocumentTranslationSessionContext;
  if(!pending||!context||!currentPdfContentFingerprint||pdfRepairStorageUncertain||activeParagraphEdit||['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning)return;
  const revision=pdfDocumentTranslationRevision,previousPhase=pdfDocumentTranslationPhase;
  const current=()=>revision===pdfDocumentTranslationRevision&&pdfDocumentTranslationBlocksState.includes(block)&&pending.stamp===pdfParagraphStamp(block)&&!activeParagraphEdit&&samePdfDocumentTranslationSessionContext(context,pdfDocumentTranslationSessionContext);
  pdfRepairContinuationActive=true;pdfDocumentTranslationPhase='preparing';syncPdfDocumentTranslationUi();
  try{
    if(!current())throw new Error(t('本段已变化，请重新打开核对。'));
    const expected=pdfDocumentTranslationSessionUpdate(context,[block]).blocks?.[0];if(!expected)throw new Error(t('本段保存状态已变化，请重新打开核对。'));
    const snapshot=await capturePdfRepairStorage(context.descriptor,context.behaviorKey,block.sessionSignature,expected,pdfDocumentTranslationRetainedLocally,currentPdfContentFingerprint);
    if(!samePdfRepairInputs(snapshot,pending.snapshot))throw new Error(t('术语或设置已变化，暂不能保存这份修复结果。'));
    const saved=await commitPdfRepairStorage(snapshot,pending.replacement,current);
    if(saved.status==='conflict')throw new Error(t('资料再次变化，修复结果仍保留在本次阅读中。'));
    if(saved.status==='failed')throw new Error(t('修复未保存，先前资料已恢复。'));
    if(saved.status==='uncertain'){pdfRepairStorageUncertain=true;if(currentPdfContentFingerprint)pdfUncertainRepairDocuments.set(currentPdfContentFingerprint,block.sessionSignature);pendingValidatedRepairs.delete(block);throw new Error(t('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。'))}
    if(saved.status!=='saved'||!current())return;
    applyPdfParagraphValue(block,saved.block);block.status='done';block.visualProcessed=true;delete block.errorMessage;delete block.singleRetry;pendingValidatedRepairs.delete(block);pdfDocumentTranslationMessage=t('正文修复已保存。');
  }catch(error){if(revision===pdfDocumentTranslationRevision)pdfDocumentTranslationMessage=error instanceof Error?localizeErrorMessage(error.message):t('本机核对未完成，请稍后重试。')}
  finally{pdfRepairContinuationActive=false;if(revision===pdfDocumentTranslationRevision){pdfDocumentTranslationPhase=previousPhase;renderPdfDocumentTranslationBlock(block)}syncPdfDocumentTranslationUi()}
}

pdfRepairStorageCheck.addEventListener('click',()=>{
  if(!pdfRepairStorageUncertain||pdfRepairStorageCheck.disabled)return;
  const context=pdfDocumentTranslationSessionContext,fingerprint=currentPdfContentFingerprint,signature=fingerprint?pdfUncertainRepairDocuments.get(fingerprint):undefined;
  if(fingerprint&&!signature){
    const edit=activeParagraphEdit;pdfRepairStorageCheck.disabled=true;element<HTMLButtonElement>('pdf-paragraph-editor-check').disabled=true;
    void getPdfRepairGuard(fingerprint).then(guard=>{
      if(currentPdfContentFingerprint!==fingerprint)return;
      if(guard){pdfUncertainRepairDocuments.set(fingerprint,guard.signature);pdfDocumentTranslationMessage=t('已读取保存状态，请再次核对本段。');if(edit&&activeParagraphEdit===edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('已读取保存状态，请再次核对本段。')}
      else{pdfRepairStorageUncertain=false;pdfDocumentTranslationMessage=t('保存状态已核对，可以继续阅读。');if(edit&&activeParagraphEdit===edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('保存状态已核对，草稿仍在这里。')}
    }).catch(()=>{pdfDocumentTranslationMessage=t('暂时无法核对本段，请在资料库检查保存版本。');if(edit&&activeParagraphEdit===edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('暂时无法核对，草稿仍在这里。')}).finally(()=>{pdfRepairStorageCheck.disabled=false;syncPdfDocumentTranslationUi()});return;
  }
  const block=pdfDocumentTranslationBlocksState.find(item=>item.sessionSignature===signature);
  if(!context||!fingerprint||!block){pdfDocumentTranslationMessage=t('暂时无法核对本段，请在资料库检查保存版本。');if(activeParagraphEdit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('暂时无法核对，草稿仍在这里。');syncPdfDocumentTranslationUi();return}
  const expected=pdfDocumentTranslationSessionUpdate(context,[block]).blocks?.[0],stamp=pdfParagraphStamp(block),epoch=pdfRepairComparisonEpoch,edit=activeParagraphEdit;
  if(!expected)return;pdfRepairStorageCheck.disabled=true;element<HTMLButtonElement>('pdf-paragraph-editor-check').disabled=true;
  void inspectPdfRepairStorage(context.descriptor,context.behaviorKey,block.sessionSignature,expected,pdfDocumentTranslationRetainedLocally).then(async result=>{
    if(epoch!==pdfRepairComparisonEpoch||currentPdfContentFingerprint!==fingerprint||!pdfDocumentTranslationBlocksState.includes(block)||stamp!==pdfParagraphStamp(block)||activeParagraphEdit!==edit){pdfDocumentTranslationMessage=t('保存内容已变化，请重新核对。');return}
    if(result.consistent){
      const confirmed=await confirmPdfRepairStorage(context.descriptor,context.behaviorKey,block.sessionSignature,expected,pdfDocumentTranslationRetainedLocally,fingerprint,()=>epoch===pdfRepairComparisonEpoch&&currentPdfContentFingerprint===fingerprint&&pdfDocumentTranslationBlocksState.includes(block)&&stamp===pdfParagraphStamp(block)&&activeParagraphEdit===edit);
      if(!confirmed)throw new Error('保存版本已变化');pdfUncertainRepairDocuments.delete(fingerprint);pdfRepairStorageUncertain=false;pdfRepairVersions.hidden=true;pdfRepairVersions.replaceChildren();pdfDocumentTranslationMessage=t(result.session?'保存状态已核对一致，可以继续阅读。':'会话记录已结束，本机版本已核对，可以继续阅读。')
      if(edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('保存状态已核对，草稿仍在这里。');
    }
    else{
      pdfDocumentTranslationMessage=t('保存内容与当前阅读不一致，可展开对照。');
      if(edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('保存版本不一致，当前草稿仍在这里。');
      const summary=document.createElement('summary');summary.textContent=t('查看保存版本');const nodes:HTMLElement[]=[summary];
      const hint=document.createElement('p');hint.textContent=t('以下与当前阅读内容对照；资料不会自动覆盖。');nodes.push(hint);
      for(const [label,value] of [[t('当前会话'),result.session],[t('本机保留'),result.local]] as const){
        if(!value&&label===t('本机保留'))continue;const section=document.createElement('section'),heading=document.createElement('strong'),body=document.createElement('div');heading.textContent=label+(value?.manualCorrection?` · ${t('人工修正')}`:'')+(value?.revisions?.length?msg` · ${value.revisions.length} 条修订`:'');section.append(heading,body);nodes.push(section);
        if(!value){body.textContent=t('当前会话没有保存记录。');continue}
        const names={text:t('译文'),formula:t('公式'),manual:t('人工修正'),history:t('修订历史'),review:t('核对状态'),other:t('保存信息')};const differences=pdfRepairVersionDifferences(value,expected);const difference=document.createElement('p');difference.className='pdf-repair-difference';difference.textContent=differences.length?`${t('与当前阅读不同')}：${differences.map(item=>names[item]).join('、')}`:t('与当前阅读一致');section.insertBefore(difference,body);
        if(value.formulaDocument&&!value.formulaReviewDraft)void renderFormulaDocument(body,value.formulaDocument,pdfDocumentTranslationSettings.autoRenderLatex);else body.textContent=value.translatedText;
        if(result.session&&result.local){const choose=document.createElement('button');choose.type='button';choose.className='pdf-repair-backup';choose.textContent=t('使用此版本…');choose.addEventListener('click',()=>{
          if(activeParagraphEdit){pdfDocumentTranslationMessage=t('请先处理打开的修正草稿，再选择版本。');syncPdfDocumentTranslationUi();return}
          const dialog=document.createElement('dialog'),heading=document.createElement('h2'),description=document.createElement('p'),status=document.createElement('p'),actions=document.createElement('div'),cancel=document.createElement('button'),confirm=document.createElement('button');dialog.className='citation-export-dialog';dialog.ariaLabel=t('确认使用此版本');heading.textContent=t('确认使用此版本');description.textContent=t('先在本机保留两份版本及其修订，再使用所选版本。若资料变化或保存失败，将继续暂停。');status.role='status';actions.className='support-task-actions';cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('确认使用');confirm.className='primary';actions.append(cancel,confirm);layoutTaskDialog(dialog,heading,[description],actions,status);document.body.append(dialog);let busy=false;cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});dialog.addEventListener('close',()=>{dialog.remove();if(choose.isConnected)choose.focus({preventScroll:true})},{once:true});
          confirm.addEventListener('click',()=>{if(busy)return;busy=true;cancel.disabled=confirm.disabled=true;pdfRepairContinuationActive=true;const scroll=documentTranslationPages.scrollTop;
            const current=()=>epoch===pdfRepairComparisonEpoch&&currentPdfContentFingerprint===fingerprint&&pdfDocumentTranslationBlocksState.includes(block)&&stamp===pdfParagraphStamp(block)&&!activeParagraphEdit;
            void resolvePdfRepairConflict(context.descriptor,context.behaviorKey,block.sessionSignature,fingerprint,expected,{session:result.session!,local:result.local!},value===result.session?'session':'local',current).then(saved=>{
              if(saved.status!=='saved'){status.textContent=t(saved.status==='conflict'?'保存内容已变化，请重新核对。':saved.status==='uncertain'?'保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。':'暂时无法保存所选版本；原内容仍受保护。');return}
              if(!current())return;applyPdfParagraphValue(block,saved.block);block.status='done';renderPdfDocumentTranslationBlock(block);documentTranslationPages.scrollTop=scroll;pdfUncertainRepairDocuments.delete(fingerprint);pdfRepairStorageUncertain=false;pdfRepairVersions.hidden=true;pdfRepairVersions.replaceChildren();pdfDocumentTranslationMessage=t('已保存所选版本，另一份已保留。');dialog.close();
            }).catch(()=>{status.textContent=t('暂时无法保存所选版本；原内容仍受保护。')}).finally(()=>{busy=false;pdfRepairContinuationActive=false;cancel.disabled=confirm.disabled=false;syncPdfDocumentTranslationUi()});
          });dialog.showModal();cancel.focus();
        });section.append(choose)}
      }
      pdfRepairVersions.replaceChildren(...nodes);pdfRepairVersions.hidden=false;
    }
  }).catch(()=>{pdfDocumentTranslationMessage=t('暂时无法核对本段，请在资料库检查保存版本。');if(edit&&activeParagraphEdit===edit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('暂时无法核对，草稿仍在这里。')}).finally(()=>{pdfRepairStorageCheck.disabled=false;syncPdfDocumentTranslationUi()});
});
browser.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes[PDF_REPAIR_ARCHIVE_KEY])void refreshPdfRepairArchiveView();
  if(pdfRepairStorageUncertain&&!pdfRepairContinuationActive&&((area==='session'&&changes.pdfDocumentTranslationSessionsV1)||(area==='local'&&(changes.pdfDocumentTranslationRetainedV1||Object.keys(changes).some(key=>key.startsWith('fixedDocumentTranslationV1:')))))){
    pdfRepairComparisonEpoch++;if(!pdfRepairVersions.hidden){pdfRepairVersions.hidden=true;pdfRepairVersions.replaceChildren();pdfDocumentTranslationMessage=t('保存内容已变化，请重新核对。');syncPdfDocumentTranslationUi()}
  }
  if(area!=='local'||!changes[PDF_REPAIR_GUARD_KEY])return;const revision=++pdfGuardObservation;
  const fingerprint=currentPdfContentFingerprint;if(!fingerprint||pdfRepairContinuationActive)return;
  void getPdfRepairGuard(fingerprint).then(guard=>{
    if(!guard||revision!==pdfGuardObservation||pdfRepairContinuationActive||currentPdfContentFingerprint!==fingerprint)return;
    pdfUncertainRepairDocuments.set(fingerprint,guard.signature);pdfRepairStorageUncertain=true;pdfDocumentTranslationMessage=t('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。');if(activeParagraphEdit)element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('保存状态待核对，当前草稿仍在这里。');syncPdfDocumentTranslationUi();
  }).catch(()=>{if(revision===pdfGuardObservation&&!pdfRepairContinuationActive&&currentPdfContentFingerprint===fingerprint){pdfRepairStorageUncertain=true;syncPdfDocumentTranslationUi()}});
});

let pdfArchiveCapacityRevision=0;
async function refreshPdfRepairArchiveView():Promise<void>{
  const revision=++pdfArchiveCapacityRevision,fingerprint=currentPdfContentFingerprint;if(!fingerprint){pdfRepairArchiveView.hidden=pdfArchiveCapacityNote.hidden=pdfArchiveCapacityBackup.hidden=true;return}
  try{const capacity=await pdfRepairArchiveCapacity(fingerprint);if(currentPdfContentFingerprint===fingerprint&&revision===pdfArchiveCapacityRevision){pdfRepairArchiveView.hidden=!capacity.documentCount;pdfRepairArchiveView.textContent=t('查看保留的分歧版本');const near=capacity.count>=MAX_PDF_REPAIR_ARCHIVES*.8||capacity.bytes>=MAX_PDF_REPAIR_ARCHIVE_BYTES*.8;pdfArchiveCapacityNote.hidden=pdfArchiveCapacityBackup.hidden=!near;if(near)pdfArchiveCapacityNote.textContent=t('分歧版本存档空间接近上限；备份不会释放空间，包含本机保留内容，不含当前会话版本和未保存草稿。')}}catch{if(currentPdfContentFingerprint===fingerprint&&revision===pdfArchiveCapacityRevision){pdfRepairArchiveView.hidden=false;pdfRepairArchiveView.textContent=t('重试读取保留版本');pdfArchiveCapacityNote.hidden=pdfArchiveCapacityBackup.hidden=true}}
}
pdfRepairArchiveView.addEventListener('click',()=>{const fingerprint=currentPdfContentFingerprint;if(!fingerprint)return;void listPdfRepairArchives(fingerprint).then(archives=>{
  if(currentPdfContentFingerprint!==fingerprint)return;void refreshPdfRepairArchiveView();if(!archives.length){pdfRepairArchiveView.hidden=true;return}pdfRepairArchiveView.textContent=t('查看保留的分歧版本');
  const dialog=document.createElement('dialog'),heading=document.createElement('h2'),intro=document.createElement('p'),list=document.createElement('div'),status=document.createElement('p'),actions=document.createElement('div'),close=document.createElement('button');
  dialog.className='citation-export-dialog';dialog.ariaLabel=t('保留的分歧版本');heading.textContent=t('保留的分歧版本');intro.textContent=t('以下为本机存档，包含各版本修订；可查看、恢复或随文档库备份。');status.role='status';actions.className='support-task-actions';close.type='button';close.textContent=t('关闭');actions.append(close);
  for(const archive of [...archives].reverse()){
    const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${archive.visible.pageNumber?msg`第 ${archive.visible.pageNumber} 页`:t('已保存段落')} · ${new Date(archive.createdAt).toLocaleString()}`;group.append(summary);
    for(const [label,value,branch] of [[t('当前会话'),archive.session,'session'],[t('本机保留'),archive.local,'local'],[t('当时阅读'),archive.visible,'visible']] as const){
      const section=document.createElement('section'),title=document.createElement('strong'),body=document.createElement('div'),copy=document.createElement('button');title.textContent=label;section.append(title,body);if(value.formulaDocument&&!value.formulaReviewDraft)void renderFormulaDocument(body,value.formulaDocument,true);else body.textContent=value.translatedText;
      copy.type='button';copy.className='pdf-repair-backup';copy.textContent=t('复制译文');copy.addEventListener('click',()=>{void navigator.clipboard.writeText(value.formulaDocument?formulaDocumentText(value.formulaDocument):value.translatedText).then(()=>{status.textContent=t('已复制')}).catch(()=>{status.textContent=t('复制失败，请重试。')})});section.append(copy);
      const restore=document.createElement('button');restore.type='button';restore.className='pdf-repair-backup';restore.textContent=t('恢复此版本…');restore.addEventListener('click',()=>{
        const context=pdfDocumentTranslationSessionContext,block=pdfDocumentTranslationBlocksState.find(item=>item.sessionSignature===archive.signature);
        if(!context||!block||!pdfDocumentTranslationRetainedLocally||pdfRepairStorageUncertain||activeParagraphEdit||['running','preparing'].includes(pdfDocumentTranslationPhase)||context.behaviorKey!==archive.behaviorKey||(['documentKey','targetLanguage','sourceLanguage','style','contentMode'] as const).some(key=>context.descriptor[key]!==archive.descriptor[key])){status.textContent=t('请先打开并保留对应译文，完成当前编辑后再恢复。');return}
        const expected=pdfDocumentTranslationSessionUpdate(context,[block]).blocks?.[0],stamp=pdfParagraphStamp(block),epoch=pdfRepairComparisonEpoch;if(!expected)return;
        const confirmDialog=document.createElement('dialog'),title=document.createElement('h2'),description=document.createElement('p'),message=document.createElement('p'),buttons=document.createElement('div'),cancel=document.createElement('button'),confirm=document.createElement('button');confirmDialog.className='citation-export-dialog';confirmDialog.ariaLabel=t('确认恢复此版本');title.textContent=t('确认恢复此版本');description.textContent=t('先保留当前版本及修订，再恢复所选存档。');message.role='status';buttons.className='support-task-actions';cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('确认恢复');confirm.className='primary';buttons.append(cancel,confirm);layoutTaskDialog(confirmDialog,title,[description],buttons,message);document.body.append(confirmDialog);let busy=false;cancel.addEventListener('click',()=>confirmDialog.close());confirmDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});confirmDialog.addEventListener('close',()=>{confirmDialog.remove();if(restore.isConnected)restore.focus({preventScroll:true})},{once:true});
        confirm.addEventListener('click',()=>{if(busy)return;busy=true;cancel.disabled=confirm.disabled=true;pdfRepairContinuationActive=true;const scroll=documentTranslationPages.scrollTop,current=()=>epoch===pdfRepairComparisonEpoch&&currentPdfContentFingerprint===fingerprint&&pdfDocumentTranslationBlocksState.includes(block)&&stamp===pdfParagraphStamp(block)&&!activeParagraphEdit;
          void beginPdfArchivedRestore(context.descriptor,context.behaviorKey,block.sessionSignature,fingerprint,expected,current).then(async start=>{
            if(start.status==='conflict'){message.textContent=t('保存内容已变化，请重新核对。');return}
            pdfRepairStorageUncertain=true;pdfUncertainRepairDocuments.set(fingerprint,block.sessionSignature);
            if(start.status!=='ready'){message.textContent=t('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。');return}
            const saved=await resolvePdfRepairConflict(context.descriptor,context.behaviorKey,block.sessionSignature,fingerprint,expected,start.preview,'session',current,{archive,branch});
            if(saved.status!=='saved'){message.textContent=t(saved.status==='conflict'?'保存内容已变化，请重新核对。':saved.status==='uncertain'?'保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。':'暂时无法保存所选版本；原内容仍受保护。');return}
            if(!current())return;applyPdfParagraphValue(block,saved.block);block.status='done';renderPdfDocumentTranslationBlock(block);documentTranslationPages.scrollTop=scroll;pdfUncertainRepairDocuments.delete(fingerprint);pdfRepairStorageUncertain=false;pdfDocumentTranslationMessage=t('已恢复所选版本，先前版本已保留。');confirmDialog.close();dialog.close();
          }).catch(()=>{message.textContent=t('暂时无法保存所选版本；原内容仍受保护。')}).finally(()=>{busy=false;pdfRepairContinuationActive=false;cancel.disabled=confirm.disabled=false;syncPdfDocumentTranslationUi()});
        });confirmDialog.showModal();cancel.focus();
      });section.append(restore);
      if(value.revisions?.length){const history=document.createElement('details'),label=document.createElement('summary');label.textContent=msg`${value.revisions.length} 条修订`;history.append(label);for(const revision of value.revisions){const row=document.createElement('p');row.textContent=revision.formulaDocument?formulaDocumentText(revision.formulaDocument):revision.translatedText;history.append(row)}section.append(history)}group.append(section);
    }list.append(group);
  }
  layoutTaskDialog(dialog,heading,[intro,list],actions,status);document.body.append(dialog);close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{dialog.remove();if(pdfRepairArchiveView.isConnected)pdfRepairArchiveView.focus({preventScroll:true})},{once:true});dialog.showModal();close.focus();
}).catch(()=>showNotice(t('暂时无法读取保留的分歧版本。'),{tone:'error'}))});

function localizeFormulaRepairReadFailure(value:string):string{
  const reason='暂时无法读取本文术语，未发送正文修复；本段请对照原文核对。重试本段会重新发送图像。';
  return value.replace(reason,t(reason)).replace('正文修复未完成：',t('正文修复未完成：'));
}

function renderPdfFormulaReview(
  container: HTMLElement,
  block: PdfDocumentTranslationRuntimeBlock,
): void {
  if(cachedReadingContext){
    container.replaceChildren();const note=document.createElement('small');note.className='pdf-retranslation-note';
    note.textContent=msg`${pdfReviewConfirmed(block)?t('已人工核对（原警告保留）'):t('待核对')}：${localizeFormulaRepairReadFailure(block.formulaReviewMessage??block.visualFallbackMessage??'')}；可在更多菜单选择原 PDF 对照。`;
    const text=document.createElement('div');container.append(note,text);
    if(block.formulaReviewDraft)text.textContent=block.translatedText??'';
    else if(block.formulaDocument)void renderFormulaDocument(text,block.formulaDocument,true);else void renderTranslationContent(text,block.translatedText??'',true);
    return;
  }
  container.replaceChildren();
  const notice = document.createElement('div');
  notice.className = 'pdf-formula-review-notice';
  notice.textContent = block.formulaReviewMessage
    ? block.formulaReviewDraft ? t('待核对译文 · 请对照原文') : t('正文译文已保留 · 公式待核对')
    : block.visualFallbackMessage === '纯文本模式下公式保持原样'
      ? t('当前仅文字模式 · 本段保留原文')
      : t('未取得可靠译文 · 暂保留原文');
  const content = document.createElement('div');
  content.className = 'pdf-formula-review-content';
  container.append(notice, content);
  const details = document.createElement('details');
  details.className = 'pdf-formula-review-details';
  if (block.formulaReviewMessage) details.open = true;
  if (block.formulaDocument) {
    notice.textContent = /正文|漏译|目标语言/u.test(block.formulaReviewMessage ?? '')
      ? t('译文完整性待核对 · 已保留译文与公式')
      : t('部分公式待核对 · 其余公式与正文已保留');
    void renderFormulaDocument(content, block.formulaDocument, pdfDocumentTranslationSettings.autoRenderLatex,
      () => { details.open = true; details.scrollIntoView({ block: 'nearest' }); });
  } else void renderTranslationContent(content, block.translatedText ?? block.text,
    Boolean(block.formulaReviewMessage) && !block.formulaReviewDraft && pdfDocumentTranslationSettings.autoRenderLatex);
  const summary = document.createElement('summary');
  summary.textContent = t('查看原因与原文截图');
  const reason = document.createElement('p');
  reason.textContent = localizeFormulaRepairReadFailure(block.formulaReviewMessage ?? block.visualFallbackMessage ?? '');
  const imageHost = document.createElement('div');
  details.append(summary, reason, imageHost);
  let loading = false;
  details.addEventListener('toggle', () => {
    const pdf = pdfDocument;
    if (!details.open || loading || !pdf) return;
    loading = true;
    imageHost.textContent = t('正在本地生成原文截图…');
    void capturePdfDocumentTranslationVisualBlock(pdf, block).then((capture) => {
      if (!details.isConnected || pdfDocument !== pdf) return;
      const img = document.createElement('img');
      img.src = capture.imageDataUrl;
      img.alt = msg`第 ${block.pageNumber} 页完整原文区域（含公式），以原 PDF 为准`;
      imageHost.replaceChildren(img);
    }).catch(() => {
      if (!details.isConnected) return;
      imageHost.textContent = t('无法生成本地截图，请点击本段返回原 PDF 核对。');
      loading = false;
    });
  });
  container.append(details);
  const pending=pendingFormulaRepairs.get(block);
  if(pending&&currentPdfContentFingerprint&&pending.stamp===pdfParagraphStamp(block)&&!block.manualCorrection){
    const resume=document.createElement('button');resume.type='button';resume.dataset.reviewRetry='';resume.className='pdf-formula-continue';resume.textContent=t('继续正文修复（仅文字）');resume.title=t('仅发送本段文字修复请求，不重新发送图像。');resume.disabled=['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning;resume.addEventListener('click',()=>void continuePdfFormulaRepair(block));container.append(resume);
  }
  const validated=pendingValidatedRepairs.get(block);
  if(validated&&currentPdfContentFingerprint&&validated.stamp===pdfParagraphStamp(block)&&!block.manualCorrection){
    const preview=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');preview.className='pdf-formula-review-details pdf-pending-repair';summary.textContent=t('查看待保存修复');preview.append(summary,body);container.append(preview);
    if(validated.replacement.formulaDocument)void renderFormulaDocument(body,validated.replacement.formulaDocument,pdfDocumentTranslationSettings.autoRenderLatex);else body.textContent=validated.replacement.translatedText;
    const save=document.createElement('button');save.type='button';save.dataset.reviewRetry='';save.className='pdf-formula-continue';save.textContent=t('重新核对并保存');save.title=t('只核对本机资料并保存，不再次发送请求。');save.disabled=pdfRepairStorageUncertain||['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning;save.addEventListener('click',()=>void savePendingPdfRepair(block));container.append(save);
  }
  if (pdfDocumentTranslationMultimodalEnabled) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'pdf-formula-review-retry';
    retry.dataset.reviewRetry = '';
    retry.textContent = t('重试本段');
    retry.title = msg`重新发送本段图像，预计 ${block.visualUnits?.length ?? 1} 次视觉请求；必要时补一次公式锁定的正文修复，也计入任务上限。批量翻译期间请先暂停`;
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
    container.setAttribute('aria-label', msg`返回第 ${block.pageNumber} 页对应原文`);
    container.title = t('点击返回并高亮 PDF 原文；拖选译文不会跳转');
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
    container.title = t('参考文献条目按原文保留，未发送翻译请求；点击返回并高亮原文');
  } else if (sourceAvailable && block.formulaReviewMessage) {
    container.title = block.formulaReviewDraft
      ? t('待核对的模型译文，数学内容未确认；点击返回 PDF 原文')
      : t('正文译文已保留，公式尚待核对；点击返回 PDF 原文');
  } else if (sourceAvailable && block.visualProcessed) {
    const purpose = pdfDocumentTranslationVisualPurpose(block);
    container.title = block.kind === 'footnote'
      ? t('脚注已完整翻译；点击返回并高亮整条脚注')
      : purpose === 'figure'
        ? t('图表已作为完整对象翻译；点击返回并高亮整张图表')
        : purpose === 'table'
          ? t('表格已按完整行列结构翻译；点击返回并高亮整张表格')
          : purpose === 'formula'
            ? t('含公式段落已通过视觉模型识别；点击返回并高亮 PDF 原文')
            : t('本段已使用统一视觉模型翻译；点击返回并高亮 PDF 原文');
  } else if (sourceAvailable && block.visualFallbackMessage) {
    container.title = msg`${block.visualFallbackMessage}；已保留${
      pdfDocumentTranslationBlockContainsFormula(block) ? t('原式') : t('原文')
    }，点击可返回 PDF 原文`;
  }
  if ((block.status === 'done'||block.retranslation) && block.translatedText) {
    if (block.formulaReviewMessage || block.visualFallbackMessage) {
      renderPdfFormulaReview(container, block);
    } else if (paperRole==='publication') {
      const open=container.querySelector<HTMLDetailsElement>('.pdf-paper-publication')?.open??false;
      const details=document.createElement('details');details.className='pdf-paper-publication';details.open=open;
      const summary=document.createElement('summary');
      const label=document.createElement('span');label.textContent=t('出版信息');
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
    container.replaceChildren(document.createTextNode(block.errorMessage ?? t('本段翻译失败。')));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = t('重试本段');
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
    container.textContent = t('正在翻译本页内容…');
  }
  if(block.retranslation){const note=document.createElement('small');note.className='pdf-retranslation-note';note.textContent=block.errorMessage??t('重译中保留旧稿，新结果通过校验并保存后替换。');container.prepend(note)}
  updatePdfDocumentTranslationPageProgress(block.pageNumber);
  container.querySelector('.pdf-paragraph-edit-action')?.remove();
  container.querySelector('.pdf-paragraph-explain-action')?.remove();
  if(block.status==='done'&&block.translatedText&&!block.referencePreserved&&!['figure','table','formula','code'].includes(block.kind??'paragraph')){
    const edit=document.createElement('button');edit.type='button';edit.className='pdf-paragraph-edit-action';edit.textContent='✎';edit.title=t('修正本段文字');edit.ariaLabel=msg`修正第 ${block.pageNumber} 页本段译文`;
    edit.disabled=['running','preparing'].includes(pdfDocumentTranslationPhase)||pdfDocumentTranslationOcrRunning;
    edit.addEventListener('click',event=>{event.stopPropagation();void openPdfParagraphEditor(block)});container.append(edit);
    if(block.text.trim()){const explain=document.createElement('button');explain.type='button';explain.className='pdf-paragraph-explain-action';explain.textContent=t('解释本段');explain.disabled=edit.disabled;explain.addEventListener('click',event=>{event.stopPropagation();void explainPdfParagraph(block)});container.append(explain)}
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
    const duplicate=previous.some(item=>item.reason==='unaccepted'&&JSON.stringify(paragraphValue(item))===JSON.stringify(paragraphValue(candidate)));
    if(!duplicate&&previous.length<MAX_PDF_PARAGRAPH_REVISIONS)block.revisions=[candidate,...previous];
    block.status='error';block.errorMessage=t(!duplicate&&previous.length>=MAX_PDF_PARAGRAPH_REVISIONS?'本段修订历史已满，暂不能保存新版本；已有记录和草稿保留。':'新结果未通过校验，继续显示旧译文；返回内容在校订历史中待核对。');
    return;
  }
  let next:PdfParagraphHistory;
  try{next=withParagraphHistory(before,{...paragraphValue(outcome),...(block.revisions?{revisions:block.revisions}:{})})}catch(error){if(!(error instanceof Error)||error.message!=='本段修订历史已满，暂不能保存新版本；已有记录和草稿保留。')throw error;block.status='error';block.errorMessage=t('本段修订历史已满，暂不能保存新版本；已有记录和草稿保留。');return}
  if(before&&block.retranslation)stagedPdfReplacements.set(block,before);
  applyPdfParagraphValue(block,next);block.status='done';
  pendingFormulaRepairs.delete(block);
  if(outcome.pendingFormulaRepair&&!before&&!block.manualCorrection)pendingFormulaRepairs.set(block,{document:outcome.pendingFormulaRepair,stamp:pdfParagraphStamp(block)});
  delete block.omitReadingMetadata;
  if(outcome.visualProcessed)block.visualProcessed=true;else delete block.visualProcessed;
  delete block.errorMessage;delete block.singleRetry;
}
function pdfParagraphStamp(block:PdfDocumentTranslationRuntimeBlock):string{
  return JSON.stringify([currentDocumentSessionId,currentPdfDocumentTranslationSessionContext(),block.sessionSignature,pdfParagraphValue(block),block.formulaReviewMessage,block.visualFallbackMessage]);
}
async function pdfAssistTerms(){
  const [memory,glossary]=await Promise.all([
    browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:termLocator()} satisfies RuntimeMessage) as Promise<import('../../core/messaging/messages').DocumentMemoryResponse>,
    browser.runtime.sendMessage({type:'GET_DOCUMENT_GLOSSARY',payload:{...termLocator(),evidenceText:pdfDocumentTranslationBlocksState.map(b=>b.text).join('\n').slice(0,6000)}} satisfies RuntimeMessage) as Promise<import('../../core/messaging/messages').RuntimeResponse<import('../../core/settings/glossary-profiles').DocumentGlossarySelection>>
  ]);
  if(!memory.ok||!glossary.ok)throw new Error('暂时无法读取本文术语，请稍后重试；译文和草稿保留。');
  return [...memory.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage())),...(glossary.data.termHints??[])].map(({source,target})=>({source,target}));
}
async function explainPdfParagraph(block:PdfDocumentTranslationRuntimeBlock):Promise<void>{
  if(['running','preparing'].includes(pdfDocumentTranslationPhase)||!pdfDocumentTranslationBlocksState.includes(block))return;
  const epoch=documentEpoch,index=pdfDocumentTranslationBlocksState.indexOf(block),related=[block,...[pdfDocumentTranslationBlocksState[index-1],pdfDocumentTranslationBlocksState[index+1]].filter((b):b is PdfDocumentTranslationRuntimeBlock=>Boolean(b&&b.text.trim()&&!b.referencePreserved))];
  const explanationStamp=(b:PdfDocumentTranslationRuntimeBlock)=>JSON.stringify(pdfParagraphValue(b));
  const stamps=related.map(explanationStamp),sourceTexts=related.map(b=>b.text),current=()=>epoch===documentEpoch&&related.every((b,i)=>pdfDocumentTranslationBlocksState.includes(b)&&explanationStamp(b)===stamps[i]&&b.text===sourceTexts[i]);
  try{const terms=await pdfAssistTerms();if(!current())return;
    const input:PassageInput={title:(pdfDocumentTranslationBlocksState.find(b=>b.paperRole==='title')?.text??'').slice(0,200),sources:related.map(b=>({originalText:b.text,translatedText:b.translatedText??'',label:msg`第 ${b.pageNumber} 页 · ${b===block?t('当前段落'):t('相邻段落')}`})),terms:terms.filter(term=>related.some(b=>containsPdfTerm(b.text,term.source))).slice(0,20)};
    openPassageExplanation(input,{isCurrent:current,refreshInput:async()=>({...input,terms:(await pdfAssistTerms()).filter(term=>related.some(b=>containsPdfTerm(b.text,term.source))).slice(0,20)}),onLocate:i=>{const target=related[i];if(target)documentTranslationPages.querySelector<HTMLElement>(`[data-translation-block="${target.id}"]`)?.scrollIntoView({block:'center'})}});
  }catch(e){if(current())showPdfCorrectionFollowup(e instanceof Error?localizeErrorMessage(e.message):t('解释暂不可用。'),()=>void explainPdfParagraph(block),t('重试读取'))}
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
      const label=document.createElement('label');const caption=document.createElement('span');caption.textContent=t('译文');const input=document.createElement('textarea');input.value=part.text;input.dataset.partId=part.id;input.rows=Math.min(8,Math.max(2,Math.ceil(part.text.length/45)));input.ariaLabel=t('本段可编辑译文');label.append(caption,input);parts.append(label);
    }else{
      const label=document.createElement('small');label.textContent=t('公式 / 命令 · 只读');const source=document.createElement('pre');source.className='pdf-paragraph-locked';source.textContent=part.label??part.text;parts.append(label,source);
    }
  }
  element<HTMLElement>('pdf-paragraph-editor-context').textContent=`${block.omitReadingMetadata?t('已保存段落'):msg`第 ${block.pageNumber} 页`} · ${t('公式与命令保持锁定')}`;
  element<HTMLDetailsElement>('pdf-paragraph-editor-capacity').open=false;
  renderPdfRevisionCapacity(block,'pdf-paragraph-editor');
  element<HTMLElement>('pdf-paragraph-editor-status').textContent='';delete element<HTMLElement>('pdf-paragraph-editor-status').dataset.state;
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
const pdfGlossaryDocumentId=()=>currentPdfContentFingerprint?documentIdentity({pageUrl:'',documentId:`pdf-content:${currentPdfContentFingerprint}`}).documentId:undefined;
const pdfGlossaryLocator=()=>pdfGlossaryDocumentId()?{glossaryDocumentId:pdfGlossaryDocumentId()!}:{};
const termLocator=()=>({...pdfGlossaryLocator(),pageUrl:currentSourceUrl??location.href,...(currentReadingIdentity?{documentId:currentReadingIdentity}:{}),...(currentSourceLabel?{sourceLabel:currentSourceLabel}:{})});
function termSourceContext(source?:string):TermSource{
  const identity=documentIdentity(termLocator()),matches=source?pdfDocumentTranslationBlocksState.filter(block=>containsPdfTerm(block.text,source)):[];
  const title=(pdfDocumentTranslationBlocksState.find(block=>block.paperRole==='title')?.text||currentPdfCitation.title||currentSourceLabel||t('当前 PDF 文档')).trim().slice(0,160);
  const sourceUrl=termSourceUrl(currentSourceUrl);
  return {documentId:identity.documentId,title,...(sourceUrl?{sourceUrl}:{}),...(matches.length===1?{pageNumber:matches[0]!.pageNumber}:{})};
}
function termTargetLanguage(){const language=pdfDocumentTranslationSettings.targetLanguage;if(!isSupportedTargetLanguage(language))throw new Error('当前目标语言不支持术语复用。');return language}
const pdfCorrectionSuggestions=document.createElement('details');pdfCorrectionSuggestions.id='pdf-correction-term-suggestions';pdfCorrectionSuggestions.hidden=true;
const pdfCorrectionSummary=document.createElement('summary'),pdfCorrectionList=document.createElement('div');pdfCorrectionSuggestions.append(pdfCorrectionSummary,pdfCorrectionList);element<HTMLElement>('pdf-terms-manage').after(pdfCorrectionSuggestions);
const pdfTermReuse=bindPdfTermReuse({locator:termLocator,context:termSourceContext,language:termTargetLanguage,evidenceText:()=>pdfDocumentTranslationBlocksState.map(block=>block.text).join('\n').slice(0,6000),onGlossaryChange:renderPdfCorrectionSuggestions,onMemory:(memory,passive)=>{pdfConfirmedTerms=memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));if(activeSearchQuery)updatePdfSearchMatches(true);if(passive)renderPdfCorrectionSuggestions();else refreshPdfTermCandidates()}});
function renderPdfCorrectionSuggestions():void{
  if(pdfTermReuse.hintsPending()){pdfCorrectionSuggestions.hidden=true;pdfCorrectionList.replaceChildren();return}
  if(pdfTermReuse.hintsUnavailable()){if(pdfTermReuse.schemeUnavailable()){pdfCorrectionSuggestions.hidden=true;pdfCorrectionList.replaceChildren();return}pdfCorrectionSuggestions.hidden=false;pdfCorrectionSummary.textContent=t('术语建议暂不可用');renderCorrectionTermReadFailure(pdfCorrectionList,()=>pdfTermReuse.retryTerms());return}
  const suggestions=pdfDocumentTranslationBlocksState.flatMap(block=>{
    if(block.status!=='done'||block.referencePreserved)return [];
    return paragraphCorrectionTerms(block.text,{...block,translatedText:block.translatedText??''},[...pdfConfirmedTerms,...pdfTermReuse.termHints()]).map(item=>({...item,context:msg`第 ${block.pageNumber} 页 · ${block.text.slice(0,180)}`}));
  });
  const unique=deduplicateCorrectionTerms(suggestions,[...pdfConfirmedTerms,...pdfTermReuse.currentTerms()]).slice(0,20);
  pdfCorrectionSuggestions.hidden=!unique.length;pdfCorrectionSummary.textContent=msg`从人工修正整理（${unique.length}）`;
  renderCorrectionTermSuggestions(pdfCorrectionList,unique,item=>{
    const form=element<HTMLFormElement>('pdf-terms-add');if(form.querySelector<HTMLButtonElement>('button')!.disabled)return;
    const source=element<HTMLInputElement>('pdf-term-source'),target=element<HTMLInputElement>('pdf-term-target');
    element<HTMLDetailsElement>('pdf-terms-manage').open=true;
    if((source.value.trim()&&source.value!==item.source)||(target.value.trim()&&target.value!==item.target)){termStatus.textContent=t('已有词条草稿已保留，请先处理当前输入。');source.focus();return}
    source.value=item.source;target.value=item.target;source.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('input',{bubbles:true}));termStatus.textContent=t('词条已填入，点击“保存词条”后用于本文。');target.focus();
  });
}
function resetPdfTermPreview():void{pdfTermPreview=undefined;termApply.textContent=t('预览修改');element<HTMLElement>('pdf-terms-preview').hidden=true}
function renderPdfTermCandidate():void{
  resetPdfTermPreview();termStatus.textContent='';delete termStatus.dataset.state;
  const candidate=pdfTermCandidates[Number(termCandidateSelect.value)],block=candidate&&pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);
  const current=element<HTMLElement>('pdf-terms-current');current.replaceChildren();
  termApply.disabled=!candidate||candidate.protected;element<HTMLElement>('pdf-terms-edit').hidden=!candidate||candidate.protected;
  element<HTMLElement>('pdf-terms-explanation').textContent=candidate?msg`约定译法：${candidate.source} → ${candidate.target}。本段未找到约定译法，请结合原文判断。${candidate.protected?t('本段已人工校订，默认保留。'):''}`:pdfConfirmedTerms.length?t('未发现缺少约定译法的已完成段落。这不代表全篇语义已通过核验。'):t('尚无已确认术语，请先添加本文词条。');
  element<HTMLElement>('pdf-terms-context').textContent=candidate?.context??'';
  if(block?.translatedText){if(block.formulaDocument)void renderFormulaDocument(current,block.formulaDocument,true);else void renderTranslationContent(current,block.translatedText,true)}
  termFrom.value=candidate&&block?.translatedText?.toLocaleLowerCase().includes(candidate.source.toLocaleLowerCase())?candidate.source:'';termTo.value=candidate?.target??'';
  termFrom.dataset.initialValue=termFrom.value;termTo.dataset.initialValue=termTo.value;
}
function refreshPdfTermCandidates():void{
  const draft={from:termFrom.value,to:termTo.value,candidate:pdfTermCandidates[Number(termCandidateSelect.value)]},dirty=draft.from!==(termFrom.dataset.initialValue??'')||draft.to!==(termTo.dataset.initialValue??'');
  pdfTermCandidates=checkPdfTermConsistency(pdfDocumentTranslationBlocksState.map(block=>({...block,translatedText:block.translatedText??''})),pdfConfirmedTerms);
  termCandidateSelect.replaceChildren(...pdfTermCandidates.map((candidate,index)=>{const option=document.createElement('option');option.value=String(index);const block=pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);option.textContent=msg`第 ${block?.pageNumber} 页 · ${candidate.source}${candidate.protected?t(' · 已校订'):''}`;return option}));
  termCandidateSelect.disabled=!pdfTermCandidates.length;
  renderPdfTermCandidate();
  if(dirty){const index=pdfTermCandidates.findIndex(c=>c.blockId===draft.candidate?.blockId&&c.source===draft.candidate.source&&c.target===draft.candidate.target);if(index>=0){termCandidateSelect.value=String(index);renderPdfTermCandidate()}else termApply.disabled=true;termFrom.value=draft.from;termTo.value=draft.to}
  renderPdfCorrectionSuggestions();
  termStatus.textContent=dirty?t('已有段落替换草稿已保留，请重新预览后再应用。'):pdfTermCandidates.length?msg`${pdfTermCandidates.length===200?t('前 '):''}${pdfTermCandidates.length} 处候选 · 仅检查已完成且有原文的段落`:t('本地检查完成，未调用翻译接口。');
}
async function openPdfTermsDialog(throwReadFailure=false):Promise<boolean>{
  documentTranslationCopyMenu.open=false;const epoch=documentEpoch;
  if(!pdfDocument||['running','preparing'].includes(pdfDocumentTranslationPhase))return false;
  let response:import('../../core/messaging/messages').DocumentMemoryResponse;
  try{response=await browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:termLocator()} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;if(!response.ok)throw new Error('local term read failed')}catch{if(throwReadFailure)throw new Error('暂时无法读取本文术语，请稍后重试；译文和草稿保留。');if(epoch===documentEpoch)showPdfCorrectionFollowup(t('暂时无法读取本文术语，请稍后重试；译文和草稿保留。'),()=>void openPdfTermsDialog(),t('重试读取'));return false}if(epoch!==documentEpoch)return false;
  pdfConfirmedTerms=response.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));pdfTermReuse.reset(response.data.memory);element<HTMLDetailsElement>('pdf-terms-manage').open=!pdfConfirmedTerms.length;refreshPdfTermCandidates();
  if(!pdfTermsDialog.open)pdfTermsDialog.showModal();return true;
}
element<HTMLButtonElement>('pdf-document-terms').addEventListener('click',()=>{void openPdfTermsDialog().catch(error=>showNotice(error instanceof Error?error.message:t('术语检查暂不可用。'),{tone:'error'}))});
let pdfPreparedTermContext:{documentId:string;language:string;onSaved?:(source:string,target:string)=>void}|undefined;
for(const id of ['pdf-term-source','pdf-term-target'])element<HTMLInputElement>(id).addEventListener('input',()=>{if(!element<HTMLInputElement>('pdf-term-source').value&&!element<HTMLInputElement>('pdf-term-target').value)pdfPreparedTermContext=undefined});
async function preparePdfCorrectionTerm(item:CorrectionTermSuggestion,current:()=>boolean,onSaved?:(source:string,target:string)=>void):Promise<void>{
  if(!current()||activeParagraphEdit||element<HTMLFormElement>('pdf-terms-add').querySelector<HTMLButtonElement>('button')!.disabled)return;
  if(!await openPdfTermsDialog(true)||!current())return;
  const source=element<HTMLInputElement>('pdf-term-source'),target=element<HTMLInputElement>('pdf-term-target');element<HTMLDetailsElement>('pdf-terms-manage').open=true;
  if(source.value.trim()||target.value.trim()){
    if(source.value!==item.source||target.value!==item.target){termStatus.textContent=t('已有词条草稿已保留，请先处理当前输入，再返回填入修正词条。');source.focus();return}
  }
  source.value=item.source;target.value=item.target;pdfPreparedTermContext={documentId:documentIdentity(termLocator()).documentId,language:termTargetLanguage(),...(onSaved?{onSaved:(source,target)=>{if(normalizeGlossaryTermKey(source)===normalizeGlossaryTermKey(item.source))onSaved(source,target)}}:{})};source.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('input',{bubbles:true}));termStatus.textContent=t('词条已填入，点击“保存词条”后用于本文。');target.focus();
}
function confirmPdfTermReplacement(source:string,oldTarget:string,newTarget:string):Promise<boolean>{
  return new Promise(resolve=>{const dialog=document.createElement('dialog'),heading=document.createElement('h2'),intro=document.createElement('p'),previous=document.createElement('p'),next=document.createElement('p'),actions=document.createElement('div'),cancel=document.createElement('button'),confirm=document.createElement('button');dialog.className='citation-export-dialog';dialog.ariaLabel=t('更新本文词条');heading.textContent=t('更新本文词条');intro.textContent=t('本文已有同名词条。确认后用于后续翻译，旧译文和人工修正保留。');previous.textContent=`${t('当前词条')}：${source} → ${oldTarget}`;next.textContent=`${t('建议词条')}：${source} → ${newTarget}`;previous.ariaLabel=t('当前词条');next.ariaLabel=t('建议词条');actions.className='support-task-actions';cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('确认更新');confirm.className='primary';actions.append(cancel,confirm);layoutTaskDialog(dialog,heading,[intro,previous,next],actions);document.body.append(dialog);let accepted=false;cancel.addEventListener('click',()=>dialog.close());confirm.addEventListener('click',()=>{accepted=true;dialog.close()});dialog.addEventListener('close',()=>{dialog.remove();resolve(accepted)},{once:true});dialog.showModal();cancel.focus();});
}
element<HTMLButtonElement>('pdf-terms-close').addEventListener('click',()=>pdfTermsDialog.close());
termCandidateSelect.addEventListener('change',renderPdfTermCandidate);
termFrom.addEventListener('input',resetPdfTermPreview);termTo.addEventListener('input',resetPdfTermPreview);
element<HTMLFormElement>('pdf-terms-add').addEventListener('submit',event=>{event.preventDefault();void(async()=>{
  const epoch=documentEpoch,form=element<HTMLFormElement>('pdf-terms-add'),button=form.querySelector('button')!;if(button.disabled)return;button.disabled=true;
  try{const sourceInput=element<HTMLInputElement>('pdf-term-source'),targetInput=element<HTMLInputElement>('pdf-term-target'),source=sourceInput.value,target=targetInput.value,context=termSourceContext(source),locator=termLocator(),language=termTargetLanguage();
    if(pdfPreparedTermContext&&(pdfPreparedTermContext.documentId!==documentIdentity(locator).documentId||pdfPreparedTermContext.language!==language))throw new Error('修正词条的文档或语言已变化，草稿保留；请重新准备词条。');
    const latest=await browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:locator} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;
    if(!latest.ok)throw new Error('暂时无法读取本文术语，请稍后重试；译文和草稿保留。');if(epoch!==documentEpoch||language!==termTargetLanguage())throw new Error('本文术语上下文已变化，草稿保留，请重新核对。');
    const existing=latest.data.memory.confirmedTerms.find(term=>normalizeGlossaryTermKey(term.source)===normalizeGlossaryTermKey(source));
    if(existing?.target===target.trim()&&termAppliesToLanguage(existing,language)){pdfPreparedTermContext?.onSaved?.(existing.source,existing.target);termStatus.textContent=t('本文已有相同词条，未重复保存；草稿保留。');return}
    if(existing&&!await confirmPdfTermReplacement(source,existing.target,target))return;
    if(epoch!==documentEpoch||language!==termTargetLanguage())throw new Error('本文术语上下文已变化，草稿保留，请重新核对。');
    const response=await browser.runtime.sendMessage({type:'UPSERT_DOCUMENT_TERM',payload:{...locator,term:{source,target,expectedVersion:documentTermVersion(existing),provenance:{origin:context,confirmed:{...context,targetLanguage:language,at:Date.now()}}}}} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;
    if(!response.ok)throw new Error(response.error.message);if(epoch!==documentEpoch)return;
    const savedTerm=response.data.memory.confirmedTerms.find(term=>normalizeGlossaryTermKey(term.source)===normalizeGlossaryTermKey(source));if(savedTerm)pdfPreparedTermContext?.onSaved?.(savedTerm.source,savedTerm.target);
    const continued=sourceInput.value!==source||targetInput.value!==target;
    pdfConfirmedTerms=response.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));pdfTermReuse.update(response.data.memory);if(!continued){form.reset();pdfPreparedTermContext=undefined}refreshPdfTermCandidates();
    termStatus.dataset.state='saved';termStatus.textContent=t(continued?'已保存提交时的本文术语，后续输入仍在草稿中。':'本文术语已保存；旧译文和人工修正保留。');if(!continued&&pdfTermsDialog.open)sourceInput.focus({preventScroll:true});
  }finally{button.disabled=false}
})().catch(error=>{delete termStatus.dataset.state;termStatus.textContent=error instanceof Error?error.message:t('词条保存失败。')})});
termApply.addEventListener('click',()=>{void(async()=>{
  const candidate=pdfTermCandidates[Number(termCandidateSelect.value)],block=candidate&&pdfDocumentTranslationBlocksState.find(block=>block.id===candidate.blockId);
  if(!block||candidate.protected||block.manualCorrection||block.status!=='done'||!pdfDocument)throw new Error('这段译文已变化，请重新检查。');
  if(!pdfTermPreview){
    const value=previewPdfTermCorrection(pdfParagraphValue(block),termFrom.value.trim(),termTo.value.trim());
    pdfTermPreview={block,stamp:pdfParagraphStamp(block),value};const preview=element<HTMLElement>('pdf-terms-preview');preview.hidden=false;
    const content=preview.querySelector<HTMLElement>('div')!;content.replaceChildren();if(value.formulaDocument)await renderFormulaDocument(content,value.formulaDocument,true);else await renderTranslationContent(content,value.translatedText,true);
    termApply.textContent=t('应用到本段');termStatus.textContent=t('仅替换本段可编辑文字；公式与命令保持不变。');return;
  }
  const edit=pdfTermPreview;if(edit.block!==block||edit.stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新预览。');
  termApply.disabled=true;
  try{
    await sendPdfDocumentBackgroundControl('dispose');await pdfDocumentBackgroundSnapshotQueue;
    if(edit.stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新预览。');
    const before=pdfParagraphHistoryValue(block);
    applyPdfParagraphValue(block,withParagraphHistory(before,{...paragraphValue({...before,...edit.value}),manualCorrection:true},'correction'));delete block.reviewConfirmation;
    if(!await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState.filter(block=>block.status==='done'),true)){applyPdfParagraphValue(block,before);throw new Error('修正保存失败，旧译文已保留。')}
    lastParagraphCorrection=undefined;renderPdfDocumentTranslationBlock(block);syncPdfDocumentTranslationUi();refreshPdfTermCandidates();termStatus.textContent=t('本段修正已保存，可在校订历史中恢复。');
  }finally{termApply.disabled=!pdfTermCandidates.length||Boolean(pdfTermCandidates[Number(termCandidateSelect.value)]?.protected)}
})().catch(error=>{delete termStatus.dataset.state;termStatus.textContent=error instanceof Error?error.message:t('术语修正失败。');resetPdfTermPreview()})});
const pdfHistoryParagraph=element<HTMLSelectElement>('pdf-history-paragraph');
const pdfHistoryVersion=element<HTMLSelectElement>('pdf-history-version');
let pdfHistoryRestoreRequest:object|undefined;
let pdfHistoryViewRevision=0;
function selectedPdfHistoryBlock(){return pdfDocumentTranslationBlocksState.find(block=>block.sessionSignature===pdfHistoryParagraph.value)}
function renderPdfHistoryVersion():void{
  const block=selectedPdfHistoryBlock(),version=block?.revisions?.find(item=>item.id===pdfHistoryVersion.value);
  renderPdfRevisionCapacity(block,'pdf-history');
  const current=element<HTMLElement>('pdf-history-current'),previous=element<HTMLElement>('pdf-history-previous');
  current.replaceChildren();previous.replaceChildren();
  if(block?.translatedText){if(block.formulaDocument)void renderFormulaDocument(current,block.formulaDocument,true);else void renderTranslationContent(current,block.translatedText,true)}
  if(version){if(version.reason==='unaccepted')previous.textContent=version.formulaDocument?formulaDocumentText(version.formulaDocument):version.translatedText;else if(version.formulaDocument)void renderFormulaDocument(previous,version.formulaDocument,true);else void renderTranslationContent(previous,version.translatedText,true)}
  element<HTMLElement>('pdf-history-status').textContent=version?.reason==='unaccepted'?msg`未采用的新结果：${version.formulaReviewMessage??version.visualFallbackMessage??t('尚未通过校验')}。旧稿仍保留。`:version?.formulaReviewMessage??version?.visualFallbackMessage??t('恢复只影响本段；当前版本也会保留在历史中。');
  pdfHistoryParagraph.disabled=pdfHistoryVersion.disabled=Boolean(pdfHistoryRestoreRequest);
  element<HTMLButtonElement>('pdf-history-restore').disabled=Boolean(pdfHistoryRestoreRequest)||!version||version.reason==='unaccepted';
  if(pdfHistoryRestoreRequest)element<HTMLElement>('pdf-history-status').textContent=t('正在恢复，请稍候…');
}
function renderPdfHistoryParagraph(preferredVersion?:string):void{
  const labels={correction:t('修正前'),translation:t('重译前'),restore:t('恢复前'),unaccepted:t('未采用 · 待核对'),import:t('导入时保留的版本')};
  pdfHistoryVersion.replaceChildren(...(selectedPdfHistoryBlock()?.revisions??[]).map(version=>{const option=document.createElement('option');option.value=version.id;option.textContent=`${labels[version.reason]} · ${new Date(version.createdAt).toLocaleString()}`;return option}));
  if(preferredVersion&&[...pdfHistoryVersion.options].some(option=>option.value===preferredVersion))pdfHistoryVersion.value=preferredVersion;
  renderPdfHistoryVersion();
}
element<HTMLButtonElement>('pdf-document-history').addEventListener('click',()=>{
  pdfHistoryViewRevision++;
  documentTranslationCopyMenu.open=false;
  pdfHistoryParagraph.replaceChildren(...pdfDocumentTranslationBlocksState.filter(block=>block.revisions?.length).map(block=>{const option=document.createElement('option');option.value=block.sessionSignature;option.textContent=`${block.omitReadingMetadata?t('已保存段落'):msg`第 ${block.pageNumber} 页`} · ${block.translatedText?.replace(/\s+/gu,' ').slice(0,48)}`;return option}));
  renderPdfHistoryParagraph();pdfHistoryDialog.showModal();
});
pdfHistoryParagraph.addEventListener('change',()=>renderPdfHistoryParagraph());pdfHistoryVersion.addEventListener('change',renderPdfHistoryVersion);
element<HTMLButtonElement>('pdf-history-close').addEventListener('click',()=>pdfHistoryDialog.close());
element<HTMLButtonElement>('pdf-history-restore').addEventListener('click',()=>{void(async()=>{
  const block=selectedPdfHistoryBlock(),versionId=pdfHistoryVersion.value;
  if(pdfHistoryRestoreRequest||!block||!block.revisions?.some(item=>item.id===versionId&&item.reason!=='unaccepted'))return;
  const request={},epoch=documentEpoch,viewRevision=pdfHistoryViewRevision;
  const current=()=>epoch===documentEpoch&&pdfDocumentTranslationBlocksState.includes(block);
  const before=pdfParagraphHistoryValue(block),stamp=pdfParagraphStamp(block);
  pdfHistoryRestoreRequest=request;renderPdfHistoryVersion();
  let failure:string|undefined;
  try{
    await sendPdfDocumentBackgroundControl('dispose');await pdfDocumentBackgroundSnapshotQueue;
    if(!current())return;
    if(stamp!==pdfParagraphStamp(block))throw new Error('本段已变化，请重新打开历史。');
    applyPdfParagraphValue(block,restoredParagraphRevision(before,versionId));block.status='done';
    if(!await persistPdfDocumentTranslationSession(pdfDocumentTranslationBlocksState,true)){applyPdfParagraphValue(block,before);throw new Error('恢复未能保存，当前译文已保留。')}
    if(!current())return;
    lastParagraphCorrection=undefined;renderPdfDocumentTranslationBlock(block);syncPdfDocumentTranslationUi();
    if(viewRevision===pdfHistoryViewRevision)pdfHistoryDialog.close();
    showPdfParagraphSaveScope();
  }catch(error){failure=error instanceof Error?error.message:t('恢复失败，当前译文已保留。')}
  finally{
    if(pdfHistoryRestoreRequest===request){
      pdfHistoryRestoreRequest=undefined;
      if(current()){
        renderPdfHistoryParagraph(pdfHistoryVersion.value);
        if(failure)element<HTMLElement>('pdf-history-status').textContent=failure;
      }
    }
  }
})()});
const paragraphEditor=element<HTMLDialogElement>('pdf-paragraph-editor');
async function suggestPdfCorrectionFollowup(origin:PdfDocumentTranslationRuntimeBlock,before:PdfCorrectionValue):Promise<void>{
  const epoch=documentEpoch,stamp=pdfParagraphStamp(origin);
  const currentOrigin=()=>epoch===documentEpoch&&stamp===pdfParagraphStamp(origin);
  try{
    const terms=await pdfAssistTerms();if(!currentOrigin())return;
    const suggestions=deduplicateCorrectionTerms(correctionTermSuggestions(origin.text,before.formulaDocument?.translationTemplate??before.translatedText,origin.formulaDocument?.translationTemplate??origin.translatedText??'',terms),[]);
    const findRelated=(items:readonly CorrectionTermSuggestion[])=>items.flatMap(term=>pdfDocumentTranslationBlocksState.filter(b=>b!==origin&&b.included&&b.status==='done'&&!b.referencePreserved&&containsPdfTerm(b.text,term.source)&&!containsPdfTerm(b.translatedText??'',term.target)).map(block=>({term,block})));
    const related=findRelated(suggestions);if(!suggestions.length)return;
    showPdfCorrectionFollowup(related.length?msg`本篇另有 ${related.length} 处相关用法，可检查是否统一。`:t('修正可整理为本文术语，供后续翻译使用。'),()=>{
      if(!currentOrigin()){pdfCorrectionFollowup.hidden=true;return}
      if(!related.length&&suggestions.length===1){const prepare=()=>void preparePdfCorrectionTerm(suggestions[0]!,currentOrigin,()=>{pdfCorrectionFollowup.hidden=true}).catch(e=>showPdfCorrectionFollowup(localizeErrorMessage(e instanceof Error?e.message:String(e)),prepare,t('重试读取')));prepare();return}
      const dialog=document.createElement('dialog'),title=document.createElement('h2'),intro=document.createElement('p'),list=document.createElement('div'),status=document.createElement('p'),actions=document.createElement('div'),close=document.createElement('button'),recheck=document.createElement('button');
      dialog.className='citation-export-dialog';dialog.ariaLabel=title.textContent=t(related.length?'检查相关用法':'存为本文术语');intro.textContent=t('相关用法不一定需要统一。逐处预览后保存，已人工校订的段落保留。');status.role='status';actions.className='support-task-actions';close.type=recheck.type='button';close.textContent=t('关闭');recheck.textContent=t('重新检查');recheck.hidden=true;actions.append(recheck,close);
      let busy=false,checking=false,stale=false,observation=0,closed=false;
      const wordViews=new Map<string,{item:CorrectionTermSuggestion;pair:HTMLElement;button:HTMLButtonElement;saved:boolean}>();
      const rowViews=new Map<string,{block:PdfDocumentTranslationRuntimeBlock;source:string;update:(term:CorrectionTermSuggestion)=>void;invalidate:()=>void;sync:()=>void}>();
      const keyOf=(source:string)=>normalizeGlossaryTermKey(source);
      function sync(){close.disabled=busy;recheck.hidden=!stale;recheck.disabled=busy||checking;for(const row of rowViews.values())row.sync();for(const view of wordViews.values())view.button.disabled=busy||checking||view.saved}
      function markStale(){observation++;stale=true;for(const row of rowViews.values())row.invalidate();status.textContent=t('本文术语已变化，可在此重新检查相关用法。');sync()}
      for(const proposal of suggestions){
        const item={...proposal},row=document.createElement('div'),pair=document.createElement('span'),button=document.createElement('button');row.className='pdf-related-term';pair.textContent=`${item.source} → ${item.target}`;button.type='button';button.textContent=t('存为本文术语');row.append(pair,button);list.append(row);const view={item,pair,button,saved:false};wordViews.set(keyOf(item.source),view);
        button.addEventListener('click',()=>{if(busy||checking)return;if(!currentOrigin()){status.textContent=t('本段已变化，请重新检查相关用法。');return}button.disabled=true;
          void preparePdfCorrectionTerm(item,currentOrigin,(source,target)=>{if(closed||!currentOrigin())return;view.item.target=target;pair.textContent=`${source} → ${target}`;view.saved=true;button.textContent=t('已保存本文术语');pdfCorrectionFollowup.hidden=true;markStale()}).catch(e=>{status.textContent=localizeErrorMessage(e instanceof Error?e.message:String(e))}).finally(sync);
        });
      }
      function addRow(proposal:CorrectionTermSuggestion,block:PdfDocumentTranslationRuntimeBlock){
        const key=JSON.stringify([block.sessionSignature,keyOf(proposal.source)]),existing=rowViews.get(key);if(existing){existing.update(proposal);return}if(rowViews.size>=20)return;
        const section=document.createElement('details'),heading=document.createElement('summary'),source=document.createElement('p'),preview=document.createElement('p'),button=document.createElement('button');button.type='button';preview.style.whiteSpace='pre-wrap';section.append(heading,source,preview,button);list.append(section);
        let term={...proposal},blockStamp=pdfParagraphStamp(block),beforeValue=pdfParagraphValue(block),confirmation=block.reviewConfirmation,snapshot:PdfRepairStorageSnapshot|undefined;
        const satisfied=()=>containsPdfTerm(block.translatedText??'',term.target);
        const syncRow=()=>{button.disabled=busy||checking||stale||pdfRepairStorageUncertain||Boolean(block.manualCorrection||block.formulaReviewDraft)||satisfied()||button.dataset.saved==='true'};
        const update=(next:CorrectionTermSuggestion)=>{term={...next};snapshot=undefined;blockStamp=pdfParagraphStamp(block);beforeValue=pdfParagraphValue(block);confirmation=block.reviewConfirmation;heading.textContent=msg`第 ${block.pageNumber} 页 · ${term.source} → ${term.target}${block.manualCorrection?t(' · 已校订'):''}`;source.textContent=block.text;preview.textContent=block.formulaDocument?formulaDocumentText(block.formulaDocument):block.translatedText??'';button.textContent=t(button.dataset.saved==='true'?'已保存':satisfied()?'已符合本文术语':'预览修改');syncRow()};
        const invalidate=()=>{snapshot=undefined;if(button.dataset.saved!=='true')button.textContent=t('预览修改')};rowViews.set(key,{block,source:keyOf(term.source),update,invalidate,sync:syncRow});update(term);
        button.addEventListener('click',()=>{if(busy||checking||stale||pdfRepairStorageUncertain||activeParagraphEdit)return;const context=pdfDocumentTranslationSessionContext,fingerprint=currentPdfContentFingerprint;
          const current=()=>!closed&&!stale&&currentOrigin()&&blockStamp===pdfParagraphStamp(block)&&pdfDocumentTranslationBlocksState.includes(block)&&!activeParagraphEdit;
          if(!context||!fingerprint||!current()){status.textContent=t('本段已变化，请重新检查相关用法。');return}busy=true;sync();
          void(async()=>{
            if(!snapshot){const expected=pdfDocumentTranslationSessionUpdate(context,[block]).blocks?.[0];if(!expected)return;const next=await capturePdfRepairStorage(context.descriptor,context.behaviorKey,block.sessionSignature,expected,pdfDocumentTranslationRetainedLocally,fingerprint);if(!current())throw new Error('本段已变化，请重新检查相关用法。');
              const memories=next.termsRaw as Record<string,Pick<import('../../core/document/document-memory-repository').DocumentMemorySnapshot,'confirmedTerms'>>|undefined;
              const confirmed=memories?.[documentIdentity(termLocator()).documentId]?.confirmedTerms?.find(item=>keyOf(item.source)===keyOf(term.source));
              if(confirmed&&confirmed.target!==term.previousTarget&&confirmed.target!==term.target){markStale();throw new Error('本文词条已有其他译法，请在此重新检查相关用法。')}
              const value=previewPdfTermCorrection(pdfParagraphValue(block),term.previousTarget,term.target);preview.textContent=`${t('修改前')}：${block.formulaDocument?formulaDocumentText(block.formulaDocument):block.translatedText}\n\n${t('修改后')}：${value.formulaDocument?formulaDocumentText(value.formulaDocument):value.translatedText}`;snapshot=next;button.textContent=t('保存本段');status.textContent=t('仅替换本段可编辑文字；公式与命令保持不变。');return;
            }
            pdfRepairContinuationActive=true;const saved=await commitPdfTermCorrection(snapshot,term.previousTarget,term.target,current);
            if(saved.status==='uncertain'){pdfRepairStorageUncertain=true;pdfUncertainRepairDocuments.set(fingerprint,block.sessionSignature);throw new Error('保存中断，存储状态暂不确定；请核对保存状态，勿重复操作。')}
            if(saved.status!=='saved')throw new Error(saved.status==='conflict'?'本段已在其他窗口变化，请重新打开核对。':'修正保存失败，旧译文已保留。');
            applyPdfParagraphValue(block,saved.block);renderPdfDocumentTranslationBlock(block);button.textContent=t('已保存');button.dataset.saved='true';pdfCorrectionFollowup.hidden=true;lastParagraphCorrection={block,stamp:pdfParagraphStamp(block),before:beforeValue,...(confirmation?{confirmation}:{}),documentSessionId:currentDocumentSessionId};status.textContent=t('本段修正已保存，可在校订历史中恢复。');
          })().catch(e=>{snapshot=undefined;button.textContent=t('预览修改');status.textContent=localizeErrorMessage(e instanceof Error?e.message:String(e))}).finally(()=>{busy=false;pdfRepairContinuationActive=false;sync();syncPdfDocumentTranslationUi()});
        });
      }
      for(const {term,block} of related.slice(0,20))addRow(term,block);
      const limit=document.createElement('p');limit.textContent=t('仅列出前 20 处相关用法。');limit.hidden=related.length<=20;list.append(limit);
      recheck.addEventListener('click',()=>{if(busy||checking)return;if(!currentOrigin()){status.textContent=t('本段已变化，请重新打开核对。');return}const version=observation,scroll=dialog.querySelector<HTMLElement>('.pi-task-body')!.scrollTop;checking=true;sync();
        void(async()=>{const response=await browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:termLocator()} satisfies RuntimeMessage) as import('../../core/messaging/messages').DocumentMemoryResponse;
          if(closed)return;if(!response.ok)throw new Error('暂时无法读取本文术语，请稍后重试；译文和草稿保留。');if(!currentOrigin()||version!==observation)throw new Error('本文术语再次变化，请重新检查。');
          const confirmed=response.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,termTargetLanguage()));const latest=suggestions.map(base=>{const term=confirmed.find(t=>keyOf(t.source)===keyOf(base.source));const view=wordViews.get(keyOf(base.source))!;view.item.target=term&&(view.saved||term.target!==base.previousTarget||term.target===base.target)?term.target:base.target;view.saved=Boolean(term&&term.target===view.item.target);view.pair.textContent=`${base.source} → ${view.item.target}`;view.button.textContent=t(view.saved?'已保存本文术语':'存为本文术语');return {...base,target:view.item.target}});
          stale=false;for(const row of rowViews.values()){const term=latest.find(t=>keyOf(t.source)===row.source);if(term)row.update(term)}
          // Existing DOM nodes are reused so open previews and list position survive.
          const matches=findRelated(latest);for(const {term,block} of matches.slice(0,20))addRow(term,block);list.append(limit);limit.hidden=matches.length<=20;status.textContent=t('已按最新本文术语重新检查，逐处预览后再保存。');dialog.querySelector<HTMLElement>('.pi-task-body')!.scrollTop=scroll;
        })().catch(e=>{if(!closed)status.textContent=localizeErrorMessage(e instanceof Error?e.message:String(e))}).finally(()=>{checking=false;if(!closed)sync()});
      });
      const termsChanged=(changes:Record<string,unknown>,area:string)=>{if(area==='local'&&(changes.documentTranslationMemoryV1||changes.extensionSettings)&&!closed)markStale()};browser.storage.onChanged.addListener(termsChanged);
      layoutTaskDialog(dialog,title,[intro,list],actions,status);document.body.append(dialog);close.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});dialog.addEventListener('close',()=>{closed=true;observation++;browser.storage.onChanged.removeListener(termsChanged);dialog.remove()},{once:true});dialog.showModal();close.focus();sync();
    },related.length?t('检查相关用法'):t('存为本文术语'));
  }catch{if(currentOrigin()){showPdfCorrectionFollowup(t('修正已保存，暂时无法读取相关术语。'),()=>void suggestPdfCorrectionFollowup(origin,before));pdfCorrectionFollowup.querySelector('button')!.textContent=t('重试读取')}}
}
function renderPdfRevisionCapacity(block:PdfDocumentTranslationRuntimeBlock|undefined,prefix:'pdf-paragraph-editor'|'pdf-history'):void{
  const count=block?.revisions?.length??0,note=element<HTMLElement>(`${prefix}-capacity`),button=element<HTMLButtonElement>(`${prefix}-backup`);
  note.hidden=button.hidden=count<MAX_PDF_PARAGRAPH_REVISIONS*.8;
  if(!note.hidden){
    if(prefix==='pdf-paragraph-editor'){
      note.querySelector('summary')!.textContent=count>=MAX_PDF_PARAGRAPH_REVISIONS?msg`修订已满 · ${count}/50 条`:msg`修订接近上限 · ${count}/50 条`;
      note.querySelector('p')!.textContent=t('已有修订会保留，满额后暂停新写入。备份不释放空间，也不包含未归档的会话版本和未保存草稿。');
    }else note.textContent=msg`本段当前阅读版本有 ${count} 条修订，上限 50 条。备份不会释放空间，包含本机保留内容，不含当前会话版本和未保存草稿。`;
  }
  button.textContent=t('查看备份与恢复');
}
for(const id of ['pdf-paragraph-editor-backup','pdf-history-backup'])element<HTMLButtonElement>(id).addEventListener('click',openPdfBackupInNewTab);
element<HTMLButtonElement>('pdf-paragraph-editor-check').addEventListener('click',()=>pdfRepairStorageCheck.click());
for(const id of ['pdf-paragraph-editor-close','pdf-paragraph-editor-cancel'])element<HTMLButtonElement>(id).addEventListener('click',()=>paragraphEditor.close());
paragraphEditor.addEventListener('close',()=>{
  const block=activeParagraphEdit?.block;activeParagraphEdit=undefined;
  if(block)documentTranslationPages.querySelector<HTMLButtonElement>(`[data-translation-block="${block.id}"] .pdf-paragraph-edit-action`)?.focus({preventScroll:true});
});
element<HTMLFormElement>('pdf-paragraph-edit-form').addEventListener('submit',event=>{
  event.preventDefault();const edit=activeParagraphEdit;if(!edit)return;
  if(pdfRepairStorageUncertain){element<HTMLElement>('pdf-paragraph-editor-status').textContent=t('保存状态待核对，当前草稿仍在这里。');return}
  const save=element<HTMLButtonElement>('pdf-paragraph-editor-save');if(save.disabled)return;save.disabled=true;
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
    renderPdfDocumentTranslationBlock(edit.block);syncPdfDocumentTranslationUi();
    if(activeParagraphEdit!==edit)return;
    const currentEdits=[...paragraphEditor.querySelectorAll<HTMLTextAreaElement>('textarea[data-part-id]')].map(input=>[input.dataset.partId!,input.value]);
    if(JSON.stringify(currentEdits)!==JSON.stringify([...edits])){edit.stamp=pdfParagraphStamp(edit.block);renderPdfRevisionCapacity(edit.block,'pdf-paragraph-editor');const status=element<HTMLElement>('pdf-paragraph-editor-status');status.dataset.state='saved';status.textContent=t('已保存提交时的修正，后续输入仍在草稿中。');return}
    paragraphEditor.close();
    setPdfDocumentTranslationCopyFeedback(t('本段修正已保存，可在更多菜单中撤销。'));
    showPdfParagraphSaveScope();
    if(!cachedReadingContext)void suggestPdfCorrectionFollowup(edit.block,before);
  })().catch(error=>{
    const code=(error as {code?:string}).code;
    delete element<HTMLElement>('pdf-paragraph-editor-status').dataset.state;
    element<HTMLElement>('pdf-paragraph-editor-status').textContent=code==='NO_CHANGES'?t('译文没有变化。'):code==='LATEX_CHANGED'?t('只能修改自然语言，公式和命令必须保持不变。'):code==='EMPTY_TRANSLATION'?t('译文不能为空。'):error instanceof Error?error.message:t('保存失败，请重试。');
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
    setPdfDocumentTranslationCopyFeedback(t('已恢复修正前的译文。'));
    showPdfParagraphSaveScope();
  })().catch(error=>showNotice(error instanceof Error?error.message:t('撤销失败。'),{tone:'error'}));
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
        ...pdfGlossaryLocator(),
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
  pdfDocumentTranslationMessage = t('正在本地读取文字层…');
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
    }catch{showNotice(t('临时识别结果未能恢复；当前窗口已有内容不变，可稍后重试。'),{tone:'error'})}
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
      pdfDocumentTranslationMessage = msg`正在本地读取文字层 · ${pageNumber}/${pdf.numPages} 页`;
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
      ? msg`${restoredFromLocalCount ? t('已从本机恢复') : t('已恢复')} ${restoredInScope}/${scoped.length} 段，无需重复翻译`
      : msg`${restoredFromLocalCount ? t('已从本机恢复') : t('已恢复')} ${restoredInScope}/${scoped.length} 段，可继续翻译`
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
      ? t('没有读取到文字层；可在下方确认识别扫描页。')
      : t('没有读取到可翻译正文。');
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
  pdfDocumentTranslationOcrMessage = t('识别已停止；成功页面已保留，可继续识别剩余页面。');
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
              label: recovery.settingsLabel ?? t('检查图像 API'),
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
        catch{showNotice(t('识别结果在当前窗口可用，但临时保存失败；关闭后可能需要重新识别。'),{tone:'error'})}
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
      latestError = error instanceof Error ? error.message : t('页面识别失败。');
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
    ? msg`${recognizedPages ? msg`已识别 ${recognizedPages} 页；` : ''}${failedPages} 页未识别${latestError ? `：${latestError}` : ''}`
    : undefined;
  pdfDocumentTranslationMessage = restoredAfterOcr.restored
    ? msg`${restoredAfterOcr.fromLocal ? t('已从本机恢复') : t('已恢复')} ${restoredAfterOcr.restored} 段扫描页译文`
    : recognizedPages
      ? msg`扫描页已加入正文 · 新增 ${recognizedPages} 页`
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
      block.errorMessage = t('本段缺少可靠的视觉定位，未改用文字接口。');
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
        ...pdfGlossaryLocator(),
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
    let repairNote:string|undefined,pendingFormulaRepair:FormulaDocument|undefined;
    if(pdfDocumentTranslationPhase==='running'&&preparePdfFormulaProseRepair(response.data.result.formulaDocument,pdfDocumentTranslationSettings.targetLanguage)){
      let repairAuthorized=true;
      try{takePdfTaskRequest('text')}catch{repairAuthorized=false;repairNote=t('任务请求上限不足，未发送正文修复。')}
      if(repairAuthorized){
        const repaired=await browser.runtime.sendMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{requestId,...termLocator(),document:response.data.result.formulaDocument!,targetLanguage:pdfDocumentTranslationSettings.targetLanguage,sourceLanguage:pdfDocumentTranslationSettings.sourceLanguage,style:pdfDocumentTranslationSettings.style}} satisfies RuntimeMessage) as TranslateRuntimeResponse;
        if(revision!==pdfDocumentTranslationRevision||pdfDocumentTranslationRequestId!==requestId)return false;
        if(repaired.ok){response=repaired;addPdfReportedTokens(pdfRequestUsage,repaired.data.result.usage,repaired.data.result.usageSource)}else{if(repaired.error.code==='DOCUMENT_TERMS_READ_FAILED'){releasePdfRequest(pdfRequestUsage,'text');if(!response.data.result.uncertainSpans?.some(issue=>!issue.startsWith('公式 LaTeX 未通过自动校验：')))pendingFormulaRepair=response.data.result.formulaDocument}repairNote=msg`正文修复未完成：${translationErrorMessage(repaired.error.code,repaired.error.message)}`}
      }
    }
    const equationNumbers = block.visualUnits ? unit.equationNumbers : block.equationNumbers;
    const outcome=pdfBackgroundVisualOutcome({ id: block.id, text: unit.text, ...(equationNumbers ? { equationNumbers } : {}),
      ...(unit.sourceFontHints?{sourceFontHints:unit.sourceFontHints}:{}),
      ...(unit.sourceEquations ? { sourceEquations: unit.sourceEquations } : {}),
      containsFormula, visualPurpose: pdfDocumentTranslationVisualPurpose(block) }, response.data.result,
    pdfDocumentTranslationSettings.targetLanguage);
    if(pendingFormulaRepair&&outcome.formulaDocument&&!outcome.formulaReviewDraft&&!outcome.visualFallbackMessage)outcome.pendingFormulaRepair=pendingFormulaRepair;
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
        message: error instanceof Error ? error.message : t('PDF 多模态翻译请求失败。'),
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
    pdfDocumentTranslationMessage = t('其他划词或框选翻译已优先处理，全文翻译可继续。');
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
    ? t('部分多模态结果未通过校验，已保留原文并继续翻译。')
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
      ? t('本块承接上一连续块中尚未结束的句子；只翻译当前块，不得重复上一块。')
      : '',
    continuity.continuesNext
      ? t('当前句在下一连续块中继续；不得提前补写下一块。')
      : '',
    continuity.skippedBefore || continuity.skippedAfter
      ? t('连续正文之间夹有图注、表格或代码等版式结构；这些结构不代表句子自动结束。')
      : '',
  ].filter(Boolean).join(' ');
  const parts = [
    documentName.textContent ? msg`文档：${documentName.textContent.slice(0, 120)}` : '',
    relationship ? msg`阅读衔接：${relationship}` : '',
    previous?.text ? msg`上一连续块原文：${previous.text.slice(-280)}` : '',
    previous?.translatedText && !previous.formulaReviewMessage && !previous.visualFallbackMessage
      ? msg`上一连续块译文：${previous.translatedText.slice(-340)}` : '',
    next?.text ? msg`下一连续块原文：${next.text.slice(0, 280)}` : '',
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
            ...pdfGlossaryLocator(),
            documentId: currentReadingIdentity ?? currentDocumentSessionId,
            pageUrl: currentSourceUrl ?? location.href,
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
            message: error instanceof Error ? error.message : t('PDF 全文翻译请求失败。'),
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
          pdfDocumentTranslationMessage = t('其他划词或框选翻译已优先处理，全文翻译可继续。');
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
          block.errorMessage = t('模型没有返回这一段的译文。');
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
  if(pdfRepairStorageUncertain)return;
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
      pdfDocumentTranslationMessage = msg`已确认智能多模态 · 正在识别 ${unreadablePages.length} 个扫描页…`;
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
        pdfDocumentTranslationMessage = msg`已达到 ${limit} 次任务请求上限；识别结果已保留，可提高上限后继续。`;
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
  if(pdfRepairStorageUncertain)return;
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
  pdfDocumentTranslationMessage = t('保留旧稿与人工修正，准备重新翻译…');
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
  if(!saved){pdfDocumentTranslationPhase='error';pdfDocumentTranslationMessage=t('重译准备未能保存，旧译文仍保留。请检查存储后重试。');syncPdfDocumentTranslationUi();return}
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
    feedback = { message: t('已从翻译队列移除。'), tone: 'success' };
  } else if (activeRegionTranslation?.id === taskId) {
    activeRegionTranslation.cancelled = true;
    void selectionTranslator.then((controller) => controller.cancelActiveTranslation());
    feedback = { message: t('正在取消当前框选翻译…'), tone: 'info' };
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
    status.textContent = task === activeRegionTranslation ? t('翻译中') : t('等待中');
    description.append(label, status);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('取消');
    cancel.addEventListener('click', () => cancelRegionTranslation(task.id));
    item.append(description, cancel);
    return item;
  }));
}

function updateRegionAction(): void {
  const pending = pendingRegionTranslationCount();
  const shortcut = pdfRegionShortcutKey.toUpperCase();
  const shortcutHint = pdfKeyboardShortcutsEnabled
    ? msg`；${shortcut} 框选一次，Shift+${shortcut} 连续框选`
    : '';
  regionTranslate.dataset.regionMode = regionMode;
  regionTranslate.setAttribute('aria-pressed', String(regionMode === 'continuous'));
  regionTranslate.setAttribute(
    'aria-label',
    msg`${regionMode === 'continuous' ? t('关闭') : t('开启')}连续框选翻译${pending ? msg`，队列中 ${pending} 项` : ''}`,
  );
  regionTranslate.title = regionMode === 'continuous'
    ? msg`连续框选已开启；点击关闭${pdfKeyboardShortcutsEnabled ? msg`，或按 Shift+${shortcut}` : ''}`
    : msg`点击开启连续框选${shortcutHint}`;
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
      warning: t('检测到表格或多列内容，划词顺序可能不可靠'),
      actionLabel: t('改用框选'),
      onAction: useCompletedTextSelectionAsRegion,
      suppressAutoTranslate: true,
    };
  }
  const warning = matchesGesture
    ? gesture?.crossColumn === 'constrained'
      ? msg`已保留${gesture.startColumn === 'right' ? t('右') : t('左')}栏${gesture.retainedSpanningContent ? t('及横跨两栏的内容') : ''}，可重新划选调整`
      : gesture?.crossColumn === 'explicit'
        ? t('跨栏选区 · 将按 PDF 原始顺序发送')
        : gesture?.retainedSpanningContent
          ? t('横跨两栏的内容已保留 · 按 PDF 原始顺序发送')
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
    showNotice(t('请在表格或多列内容外沿重新拖动框选。'), {
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
    t('检测到表格或多列内容；请核对框选范围后再发送'),
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
          ? t('检测到表格或多列内容，本次没有自动发送；请使用“框选翻译”核对范围。')
          : t('检测到表格或多列内容，划词顺序可能不可靠；可在选区预览中改用框选。'),
        { transient: true, tone: 'warning' },
      );
    } else if (snap?.crossColumn === 'constrained') {
      showNotice(msg`检测到选区带入另一栏，已保留起始栏${snap.retainedSpanningContent ? t('和选中的通栏') : ''}内容。可重新划选调整。`, {
        transient: true,
        tone: 'info',
      });
    } else if (snap?.crossColumn === 'explicit') {
      showNotice(t('已选择左右两栏；将按 PDF 原始文字顺序发送，请先核对选区预览。'), {
        transient: true,
        tone: 'warning',
      });
    } else if (snap?.retainedSpanningContent) {
      showNotice(t('已保留选中的通栏内容，并按 PDF 原始文字顺序发送。'), {
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
  pdfHistoryRestoreRequest=undefined;
  activeParagraphEdit=undefined;lastParagraphCorrection=undefined;
  void persistReadingState();
  cachedReadingContext=undefined;delete document.documentElement.dataset.libraryReading;
  searchScope.disabled=false;
  documentTranslationViewCompare.hidden=false;documentTranslationClose.textContent=t('返回原页');
  documentTranslationPanel.querySelector('.pdf-document-translation-title strong')!.textContent=t('PDF 全文翻译');
  element<HTMLButtonElement>('pdf-library-source').hidden=true;element<HTMLButtonElement>('pdf-library-back').hidden=true;
  pdfTranslationReadingAnchor=undefined;
  currentPdfContentFingerprint=undefined;pdfArchiveCapacityRevision++;pdfCorrectionFollowup.hidden=true;pdfRepairArchiveView.hidden=pdfArchiveCapacityNote.hidden=pdfArchiveCapacityBackup.hidden=true;libraryRestoreDocumentKey=undefined;
  resetPdfDocumentTranslation(true);
  currentPdfBackgroundData = undefined;
  currentReadingIdentity = undefined;
  restoringReadingState = false;
  completedTextSelectionGesture = undefined;
  resetPdfOutline();
  viewRotation = 0; fitPageActive = false;
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
  currentPdfCitation = {};
  delete documentName.dataset.citationState;
  if (previousDocument) void previousDocument.destroy().catch(() => undefined);
  regionTranslationQueue.length = 0;
  temporaryOcrPages.clear();
  pdfDocumentTranslationPageInputs=[];
  if (activeRegionTranslation) activeRegionTranslation.cancelled = true;
  updateRegionAction();
  clearDocument();
  readingHintTarget=undefined;readingHintResumePage=undefined;pdfReadingHints.reset();
  readingAnnotations.reset();
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
        ? t('连续框选已开启 · 可逐个发送 · Esc 退出')
        : t('拖动框选一次 · Esc 取消'),
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

function visiblePageAnchor(preferReadingPoint = true): PageAnchor {
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
  // Preserve the point actually being read, including a short page above a
  // taller neighbour. A dominant-page heuristic loses that offset on restore.
  const selectedPage = anchorPage && (preferReadingPoint || dominantPage === anchorPage ||
    dominantVisibleHeight < anchorPageVisibleHeight * 1.5)
    ? anchorPage : dominantVisibleHeight > 0 ? dominantPage : closestPage;
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
    ...(fitPageActive ? {fitPage:true as const} : {}),
    ...(viewRotation ? {rotation:viewRotation as 90|180|270} : {}),
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
  // Local MathML rendering replaces formula placeholders asynchronously. Wait
  // for that one render and its fonts before measuring the saved paragraph.
  void Promise.allSettled([...pendingPdfTranslationRenders]).then(() => {
    void documentTranslationPages.offsetHeight;
    return document.fonts.ready;
  }).then(() => requestAnimationFrame(()=>{
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
  }));
}

async function persistReadingState(opened=false): Promise<void> {
  if (readingStateSaveTimer) clearTimeout(readingStateSaveTimer);
  readingStateSaveTimer = undefined;
  const identity = currentPdfContentFingerprint ? `pdf-content:${currentPdfContentFingerprint}` : currentReadingIdentity;
  const state = currentPdfReadingState();
  if (!identity || !state) return;
  if (currentPdfContentFingerprint) {
    // The worker finishes this write even when the reader closes immediately.
    await browser.runtime.sendMessage({
      type: 'SAVE_PDF_READING_STATE',
      payload: { fingerprint: currentPdfContentFingerprint, state,...(opened?{opened:true as const}:{}),
        document:{title:(documentName.textContent?.trim()||'PDF').slice(0,120),...(pdfDocument?{pageCount:pdfDocument.numPages}:{})} },
    } satisfies RuntimeMessage).catch(() => undefined);
  } else {
    await savePdfReadingState(identity, state).catch(() => undefined);
  }
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
    pdfLinkReturn.textContent = t('← 返回');
    pdfLinkReturn.removeAttribute('title');
    return;
  }
  if(target.summaryReturn){const recap=target.summaryReturn.kind==='recap';pdfLinkReturn.textContent=recap?t('← 返回回顾'):t('← 返回小结');pdfLinkReturn.title=pdfLinkReturn.ariaLabel=recap?t('返回刚才的阅读回顾'):t('返回刚才的小结');return}
  const page=target.reading?.page??target.pageNumber;
  pdfLinkReturn.textContent = msg`← 返回第 ${page} 页`;
  pdfLinkReturn.title = msg`返回查阅前的第 ${page} 页`;
  pdfLinkReturn.setAttribute('aria-label', pdfLinkReturn.title);
}

function resetPdfLinkHistory(): void {
  pdfLinkHistory.length = 0;
  updatePdfLinkReturn();
}

function pushPdfLinkHistory(anchor: PageAnchor, summaryReturn?:ReadingSummaryReturn): void {
  const reading={mode:pdfDocumentTranslationViewMode,hidden:documentTranslationPanel.hidden,top:documentTranslationPages.scrollTop,left:documentTranslationPages.scrollLeft,sourceLeft:stage.scrollLeft,page:!documentTranslationPanel.hidden&&pdfDocumentTranslationViewMode==='reading'?currentPdfTranslationReadingAnchor()?.pageNumber??anchor.pageNumber:anchor.pageNumber};
  const previous = pdfLinkHistory.at(-1);
  if (
    !summaryReturn && previous?.pageNumber === anchor.pageNumber &&
    Math.abs(previous.ratio - anchor.ratio) < 0.01 && previous.rotation === viewRotation && JSON.stringify(previous.reading)===JSON.stringify(reading)
  ) return;
  const entry={...anchor,rotation:viewRotation,reading,...(summaryReturn?{summaryReturn}:{})};
  pdfLinkHistory.push(entry);
  summaryReturn?.onCancel(()=>{delete entry.summaryReturn;updatePdfLinkReturn()});
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
    const viewport = page.getViewport({ scale: 1,rotation:(page.rotate+viewRotation)%360 });
    const point = viewport.convertToViewportPoint(0, top);
    const viewportY = Number(point[1]);
    if (Number.isFinite(viewportY) && viewport.height > 0) {
      ratio = clamp(viewportY / viewport.height, 0, 1);
    }
  }
  return { pageNumber, ratio, destinationLabel: msg`第 ${pageNumber} 页` };
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
  return { pageNumber, ratio: 0, destinationLabel: msg`第 ${pageNumber} 页` };
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

pdfLinkReturn.addEventListener('click', async () => {
  if(pdfLinkHistory.at(-1)?.summaryReturn&&hasReadingDraft()){showNotice(pdfLinkHistory.at(-1)?.summaryReturn?.kind==='recap'?t('请先保存或取消未完成的编辑，再返回阅读回顾。'):t('请先保存或取消未完成的编辑，再返回小结。'));return}
  searchSourceReturnSaved = false;
  const target = pdfLinkHistory.pop();
  if (!target) return;
  const epoch = documentEpoch;
  if(target.reading){
    documentTranslationPanel.hidden=target.reading.hidden;
    // Suppress the mode switch's old compare anchor; this snapshot owns return.
    pdfTranslationReadingAnchor=undefined;
    pdfDocumentTranslationReadingScrollTop=target.reading.top;
    setPdfDocumentTranslationViewMode(target.reading.mode);
    updatePdfDocumentTranslationInset();
  }
  if (target.rotation !== undefined && target.rotation !== viewRotation) await changeViewRotation(target.rotation);
  if (epoch !== documentEpoch) return;
  if (fitWidthActive || fitPageActive) await fitDocumentToAvailableWidth(target);
  if (epoch !== documentEpoch) return;
  jumpToPdfLinkDestination(
    { ...target, destinationLabel: msg`第 ${target.pageNumber} 页` },
    false,
  );
  if(target.reading){
    syncPdfDocumentTranslationCurrentPage();
    documentTranslationPages.scrollTop=target.reading.top;
    documentTranslationPages.scrollLeft=target.reading.left;
    stage.scrollLeft=target.reading.sourceLeft;
    scheduleReadingStateSave();
  }
  updatePdfLinkReturn();
  if (!pdfLinkReturn.hidden) pdfLinkReturn.focus({ preventScroll: true });
  else stage.focus({ preventScroll: true });
  target.summaryReturn?.resume();
});

function updatePageControl(anchor = visiblePageAnchor(false)): void {
  if (document.activeElement !== pageNumberInput) {
    pageNumberInput.value = String(anchor.pageNumber);
  }
  thumbnails.markCurrent(anchor.pageNumber);
  syncPdfOutlineCurrent(anchor.pageNumber);
  syncPdfBookmarkCurrent(anchor.pageNumber);
  syncPdfDocumentTranslationCurrentPage(anchor.pageNumber);
}

function currentPdfBookmark(pageNumber = visiblePageAnchor().pageNumber): PdfReadingBookmark | undefined {
  return pdfReadingBookmarks.find((bookmark) => bookmark.pageNumber === pageNumber);
}

function updatePdfNavigationStatus(): void {
  outlineStatus.textContent = activePdfNavigationView === 'outline'
    ? msg`${pdfOutlineEntryMap.size} 项`
    : activePdfNavigationView === 'thumbnails' ? msg`共 ${pdfDocument?.numPages ?? 0} 页`
    : msg`${pdfReadingBookmarks.length} 个书签`;
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
  bookmarkAdd.textContent = current ? t('✓ 当前页已添加') : t('＋ 添加当前页');
  bookmarkAdd.title = !currentReadingIdentity
    ? t('当前文档无法建立本地匿名标识')
    : current
      ? t('当前页已有书签')
      : pdfReadingBookmarks.length >= MAX_PDF_BOOKMARKS_PER_DOCUMENT
        ? msg`每份 PDF 最多 ${MAX_PDF_BOOKMARKS_PER_DOCUMENT} 个书签`
        : t('将当前阅读页加入书签');
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
        showNotice(t('书签暂时无法保存，请稍后重试。'), { tone: 'warning', transient: true });
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
  label.placeholder = msg`第 ${bookmark.pageNumber} 页`;
  label.setAttribute('aria-label', t('书签名称'));
  const note = document.createElement('textarea');
  note.maxLength = MAX_PDF_BOOKMARK_NOTE_LENGTH;
  note.value = bookmark.note;
  note.placeholder = t('备注（可选）');
  note.setAttribute('aria-label', t('书签备注'));
  const actions = document.createElement('div');
  actions.className = 'pdf-bookmark-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('取消');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'save';
  save.textContent = t('保存');
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
    jump.title = msg`跳转到第 ${bookmark.pageNumber} 页`;
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
    page.textContent = msg`第 ${bookmark.pageNumber} 页`;
    jump.append(copy, page);
    jump.addEventListener('click', () => navigateToPdfBookmark(bookmark));
    const actions = document.createElement('span');
    actions.className = 'pdf-bookmark-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'pdf-bookmark-edit';
    edit.textContent = '✎';
    edit.title = msg`编辑“${bookmark.label}”`;
    edit.setAttribute('aria-label', msg`编辑书签 ${bookmark.label}`);
    edit.addEventListener('click', () => {
      editingPdfBookmarkId = bookmark.id;
      renderPdfBookmarks();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pdf-bookmark-delete';
    remove.textContent = '×';
    remove.title = msg`删除“${bookmark.label}”`;
    remove.setAttribute('aria-label', msg`删除书签 ${bookmark.label}`);
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
    label: msg`第 ${pageNumber} 页`,
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
  activePdfNavigationView = view === 'outline' && !pdfOutlineEntries.length ? 'bookmarks' : view;
  outlineTab.hidden = !pdfOutlineEntries.length;
  for (const [tab,name] of [[outlineTab,'outline'],[thumbnailsTab,'thumbnails'],[bookmarksTab,'bookmarks']] as const) {
    const selected = activePdfNavigationView === name;
    tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus({preventScroll:true});
  }
  outlineTree.hidden = activePdfNavigationView !== 'outline';
  bookmarksPanel.hidden = activePdfNavigationView !== 'bookmarks';
  thumbnailsPanel.hidden = activePdfNavigationView !== 'thumbnails';
  thumbnails.show(!outlinePanel.hidden && !thumbnailsPanel.hidden,visiblePageAnchor(false).pageNumber);
  updatePdfNavigationStatus();
  if (!bookmarksPanel.hidden) renderPdfBookmarks();
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
        toggle.setAttribute('aria-label', `${expanded ? t('收起') : t('展开')} ${entry.title}`);
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
        action.title = msg`${entry.title} · 第 ${entry.pageNumber} 页`;
      } else {
        action.title = msg`${entry.title} · 章节组`;
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
  thumbnails.show(false);
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
  } else if (activePdfNavigationView === 'thumbnails') {
    thumbnailsPanel.querySelector<HTMLElement>('[aria-current="page"]')?.focus({preventScroll:true});
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
  thumbnails.reset();
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
    outlineTab.title = result.truncated ? msg`显示前 ${flattened.length} 项` : '';
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
  const toggleLabel = searchResultsExpanded ? t('收起搜索结果') : t('展开搜索结果');
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
    range.textContent = msg`显示第 ${start + 1}–${end} 项 · 共 ${searchMatches.length} 项`;
    fragment.append(range);
  }
  searchMatches.slice(start, end).forEach((match, offset) => {
    const resultIndex = start + offset;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-search-result';
    button.dataset.searchResultIndex = String(resultIndex);
    button.setAttribute('aria-label', msg`第 ${match.pageNumber} 页，搜索结果 ${resultIndex + 1}`);
    button.setAttribute('aria-posinset', String(resultIndex + 1));
    button.setAttribute('aria-setsize', String(searchMatches.length));
    if (resultIndex === searchResultIndex) {
      button.classList.add('is-current');
      button.setAttribute('aria-current', 'true');
    }
    const page = document.createElement('span');
    page.className = 'pdf-search-result-page';
    page.textContent = msg`第 ${match.pageNumber} 页${searchScope.value === 'all' ? match.translationBlockId ? t(' · 译文') : t(' · 原文') : ''}`;
    const excerpt = document.createElement('span');
    excerpt.className = 'pdf-search-result-excerpt';
    const indexedPage = match.translationBlockId ? translationSearchIndexes.get(match.translationBlockId) : searchPageIndexes.get(match.pageNumber);
    const snippet = indexedPage
      ? buildPdfSearchSnippet(indexedPage, match)
      : { before: '', match: match.matchedQuery??activeSearchQuery, after: '' };
    excerpt.append(document.createTextNode(snippet.before));
    const mark = document.createElement('mark');
    mark.textContent = snippet.match || match.matchedQuery || activeSearchQuery;
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
  renderPdfSearchAssistance();
  if (!activeSearchQuery) {
    setSearchStatus(t('输入关键词'));
    return;
  }
  const totalPages = pdfDocument?.numPages ?? 0;
  const indexedPages = searchPageIndexes.size;
  if (hasMatches) {
    const capped = searchMatches.length >= PDF_SEARCH_RESULT_LIMIT;
    const total = `${searchMatches.length}${capped ? '+' : ''}`;
    const progress = searchIndexing && indexedPages < totalPages
      ? msg` · ${indexedPages}/${totalPages} 页`
      : '';
    setSearchStatus(`${searchResultIndex + 1} / ${total}${progress}`);
    return;
  }
  if (searchIndexing && indexedPages < totalPages) {
    setSearchStatus(msg`正在搜索 ${indexedPages}/${totalPages} 页`);
    return;
  }
  const hasSearchableText = searchScope.value === 'translation'
    ? translationSearchIndexes.size > 0
    : [...searchPageIndexes.values()].some((page) => page.text);
  setSearchStatus(hasSearchableText ? t('未找到') : t('当前文档没有可搜索文字'));
}

function renderPdfSearchAssistance():void{
  searchAssistance.replaceChildren();searchAssistance.hidden=true;if(!activeSearchQuery)return;
  const epoch=documentEpoch,query=activeSearchQuery,scope=searchScope.value;
  const applyAssisted=()=>{stopSearchIndexing();activeSearchQuery=normalizePdfSearchText(searchQuery.value);updatePdfSearchMatches(false);if(searchMatches.length)navigateToPdfSearchResult(0);if(activeSearchQuery)startPdfSearchIndexing()};
  const change=(value:string,nextScope=scope)=>{if(epoch!==documentEpoch||query!==activeSearchQuery)return;assistedSearchOrigin??={query:searchQuery.value,scope:searchScope.value};searchQuery.value=value;searchScope.value=nextScope;searchQueryEdited=true;applyAssisted();searchQuery.focus({preventScroll:true})};
  const noResults=!searchMatches.length&&!searchIndexing;
  appendSearchAssistance(searchAssistance,{query:noResults?query:'',terms:pdfConfirmedTerms,onQuery:value=>change(value),matchedTerms:confirmedSearchAliases,
    ...(noResults&&scope!=='all'&&((scope==='translation'&&pdfDocument)||(scope==='source'&&pdfDocumentTranslationBlocksState.some(block=>block.included&&block.status==='done'&&block.translatedText)))?{broaden:{label:t('同时查原文与译文'),run:()=>change(query,'all')}}:{}),
    ...(assistedSearchOrigin?{restore:()=>{if(epoch!==documentEpoch)return;const saved=assistedSearchOrigin;if(!saved)return;assistedSearchOrigin=undefined;searchQuery.value=saved.query;searchScope.value=saved.scope;applyAssisted();searchQuery.focus({preventScroll:true})}}:{})});
  searchAssistance.hidden=!searchAssistance.childElementCount;
}

function updatePdfSearchMatches(preserveCurrent: boolean): void {
  const currentIdentity = preserveCurrent
    ? searchMatchIdentity(searchMatches[searchResultIndex])
    : undefined;
  translationSearchIndexes.clear();
  if(searchScope.value!=='source')for(const block of pdfDocumentTranslationBlocksState){
    if(block.included&&block.status==='done'&&block.translatedText)translationSearchIndexes.set(block.id,buildPdfSearchPageIndex(block.pageNumber,[{str:block.formulaDocument?formulaDocumentText(block.formulaDocument):block.translatedText}]));
  }
  const find=(query:string):ReaderSearchMatch[]=>{
    const matches:ReaderSearchMatch[]=searchScope.value==='translation'?[]:findPdfSearchMatches(searchPageIndexes.values(),query,PDF_SEARCH_RESULT_LIMIT);
    for(const [id,index] of translationSearchIndexes)matches.push(...findPdfSearchMatches([index],query,Math.max(0,PDF_SEARCH_RESULT_LIMIT-matches.length)).map(match=>({...match,translationBlockId:id})));
    return matches.sort((left,right)=>left.pageNumber-right.pageNumber);
  };
  const ready=!searchIndexing&&(searchScope.value==='translation'||!pdfDocument||searchPageIndexes.size>=pdfDocument.numPages);
  const found=searchWithConfirmedTerms(activeSearchQuery,ready?pdfConfirmedTerms:[],find,match=>searchMatchIdentity(match)!);
  confirmedSearchAliases=found.aliases;
  searchMatches=found.matches.slice(0,PDF_SEARCH_RESULT_LIMIT).map(({item,query})=>({...item,matchedQuery:query})).sort((left,right)=>left.pageNumber-right.pageNumber);
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
  if (!searchSourceReturnSaved) {
    pushPdfLinkHistory(visiblePageAnchor());
    searchSourceReturnSaved = true;
  }
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
    topRatio: clamp(rotatePdfViewRect({leftRatio:block.box.left,topRatio:block.box.top,widthRatio:block.box.width,heightRatio:block.box.height},viewRotation).topRatio,0,1),
  }));
}

async function searchTextItemsForPage(page: PDFPageProxy): Promise<PdfSearchTextItem[]> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1, rotation:(page.rotate+viewRotation)%360 });
  const items: PdfSearchTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !normalizePdfSearchText(item.str)) continue;
    const point = viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    const topRatio = viewport.height > 0
      ? clamp(point[1]! / viewport.height, 0, 1)
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
    const hadMatches=searchMatches.length>0;updatePdfSearchMatches(true);
    if(!hadMatches&&searchMatches.length)navigateToPdfSearchResult(searchResultIndex);
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
  const selected=selectedReadingQuery(readingSelectionText(getSelection(),[viewer,documentTranslationPages],document.activeElement),searchQueryEdited);
  if(selected!==undefined)searchQuery.value=selected;
  const returnFocus = !outlinePanel.hidden
    ? openOutline
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  closePdfOutline(false);
  const view = documentTranslationPanel.hidden ? 'source' : pdfDocumentTranslationViewMode;
  if (view !== searchViewContext) {
    assistedSearchOrigin=undefined;
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
  searchSourceReturnSaved = false;
}

function resetPdfSearch(): void {
  closePdfSearch(false);
  stopSearchIndexing();
  searchPageIndexes.clear();
  searchMatches = [];
  confirmedSearchAliases=[];
  searchResultIndex = -1;
  activeSearchQuery = '';
  searchQuery.value = '';
  searchQueryEdited = false;
  searchReturnFocus = undefined;
  searchResultsExpanded = true;
  searchViewContext = '';
  assistedSearchOrigin=undefined;
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
searchQuery.addEventListener('input', ()=>{assistedSearchOrigin=undefined;searchQueryEdited=true;applyPdfSearchQuery()});
searchScope.addEventListener('change', () => {
  assistedSearchOrigin=undefined;
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
function isEscapeInOpenPdfMenu(event:KeyboardEvent):boolean {
  return event.key==='Escape'&&event.target instanceof Element&&Boolean(event.target.closest('#pdf-reader-menu[open], #pdf-document-translation-copy-menu[open]'));
}
window.addEventListener('keydown', (event) => {
  if(keyEventDialog(event))return;
  if(isEscapeInOpenPdfMenu(event)){
    // The overlay also listens in window capture; close this focused menu before
    // it can consume Escape and collapse the restored reading sidebar instead.
    const menu=(event.target as Element).closest<HTMLDetailsElement>('#pdf-reader-menu[open], #pdf-document-translation-copy-menu[open]')!;
    event.preventDefault();event.stopImmediatePropagation();menu.open=false;
    menu.querySelector<HTMLElement>(':scope > summary')?.focus({preventScroll:true});
    return;
  }
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
thumbnailsTab.addEventListener('click', () => setPdfNavigationView('thumbnails'));
for (const tab of [outlineTab, thumbnailsTab, bookmarksTab]) {
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [outlineTab,thumbnailsTab,bookmarksTab].filter(tab => !tab.hidden);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 :
      (tabs.indexOf(tab)+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
    const next = tabs[index]!;
    setPdfNavigationView(next===outlineTab?'outline':next===thumbnailsTab?'thumbnails':'bookmarks',true);
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
  if (keyEventDialog(event)||outlinePanel.hidden || event.key !== 'Escape') return;
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
  updatePageControl();
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
      anchor.title = msg`打开外部链接：${hostname}`;
      anchor.setAttribute('aria-label', anchor.title);
    } else {
      anchor.href = `#page=${action.target.pageNumber}`;
      anchor.title = msg`跳转到${action.target.destinationLabel}`;
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
  const viewport = page.getViewport({ scale, rotation:(page.rotate+viewRotation)%360 });
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
    pageElement.dataset.hasNativeText = String(hasNativeText);
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
      showNotice(t('可能是扫描版 PDF'), {
        transient: true,
        tone: 'warning',
        sourceOnly: true,
        action: {
          label: t('识别本页'),
          ariaLabel: msg`识别第 ${pageElement.dataset.pageNumber ?? t('当前')} 页并生成临时文字层`,
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
  const defaultViewport = firstPage.getViewport({ scale, rotation:(firstPage.rotate+viewRotation)%360 });
  const safeTargetPage = Math.min(pdf.numPages, Math.max(1, Math.round(targetAnchor.pageNumber)));
  // Mixed-size documents can otherwise appear too short to scroll while every
  // placeholder still has page 1's height. Resolve only the nearby window's
  // dimensions before applying the saved anchor; rendering remains lazy.
  const nearbyViewports = new Map<number, typeof defaultViewport>();
  await Promise.all(Array.from(
    { length: Math.min(pdf.numPages, safeTargetPage + RETAINED_PAGE_RADIUS) - Math.max(1, safeTargetPage - RETAINED_PAGE_RADIUS) + 1 },
    async (_, offset) => {
      const pageNumber = Math.max(1, safeTargetPage - RETAINED_PAGE_RADIUS) + offset;
      const page = await pdf.getPage(pageNumber);
      nearbyViewports.set(pageNumber, page.getViewport({ scale, rotation:(page.rotate+viewRotation)%360 }));
    },
  ));
  if (generation !== renderGeneration) return;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageElement = document.createElement('article');
    pageElement.className = 'pdf-page';
    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.dataset.viewRotation = String(viewRotation);
    pageElement.ariaLabel = msg`第 ${pageNumber} 页`;
    const viewport = nearbyViewports.get(pageNumber) ?? defaultViewport;
    pageElement.style.width = `${viewport.width}px`;
    pageElement.style.height = `${viewport.height}px`;
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
  setLoading(t('正在加载阅读组件…'), 'runtime');
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
    setLoading(t('正在解析 PDF…'), 'parsing');
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
    const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    try{const guard=await getPdfRepairGuard(fingerprint);if(guard)pdfUncertainRepairDocuments.set(fingerprint,guard.signature);pdfRepairStorageUncertain=Boolean(guard)||pdfUncertainRepairDocuments.has(fingerprint)}catch{pdfRepairStorageUncertain=true}
    pdfRepairVersions.hidden=true;pdfRepairVersions.replaceChildren();
    await recentReading.verify(fingerprint);
    if(!isCurrentOpen(operation))return;
    currentPdfContentFingerprint=fingerprint;
    void refreshPdfRepairArchiveView();
    const contentReadingState=await getPdfReadingState(`pdf-content:${currentPdfContentFingerprint}`).catch(()=>undefined);
    if(!isCurrentOpen(operation))return;
    restoredState=contentReadingState??restoredState;
    readingHintResumePage=readingRecapPage(contentReadingState);
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
    fitPageActive = restoredState?.fitPage ?? false;
    viewRotation = restoredState?.rotation ?? 0;
    thumbnails.reset(nextDocument,viewRotation);
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
      Math.round(initialPage ?? restoredState?.pageNumber ?? recentReading.fallbackPage() ?? 1),
      1,
      nextDocument.numPages,
    );
    const targetRatio = initialPage === undefined ? restoredState?.pageRatio ?? 0 : 0;
    pageNumberInput.value = String(targetPage);
    setDocumentControls(true);
    setLoading(t('正在准备页面…'), 'pages');
    await buildPages(nextDocument, { pageNumber: targetPage, ratio: targetRatio });
    if (!isCurrentOpen(operation)) return;
    // Read local bibliographic data after the visible page is ready. Never
    // delay reading/OCR or let an older file's metadata attach to a new file.
    documentName.dataset.citationState='reading';
    void Promise.all([
      nextDocument.getMetadata().catch(()=>undefined),
      nextDocument.getPage(1).then(page=>page.getTextContent()).then(content=>content.items.map(item=>'str' in item?item.str:'').join(' ').slice(0,12_000)).catch(()=>''),
    ]).then(([metadata,firstPage])=>{
      if(!isCurrentOpen(operation)||pdfDocument!==nextDocument)return;
      const xmp=Object.fromEntries(['dc:title','dc:creator','prism:doi','prism:publicationdate','prism:url'].map(key=>[key,metadata?.metadata?.get(key)]));
      currentPdfCitation=pdfCitationMetadata((metadata?.info??{}) as Record<string,unknown>,xmp,firstPage);
      documentName.dataset.citationState='ready';
    });
    void loadPdfOutline(nextDocument, operation.epoch);
    restoringReadingState = false;
    const controller = await selectionTranslator;
    if (!isCurrentOpen(operation)) return;
    await controller.refreshPersistentMarkers();
    await readingAnnotations.reload().catch(error=>showNotice(error instanceof Error?error.message:String(error),{tone:'error'}));
    if (!isCurrentOpen(operation)) return;
    if (restoredState?.sidebarExpanded) {
      if (isCurrentOpen(operation)) controller.openSidebar();
    }
    if (fitWidthActive || fitPageActive) scheduleFitWidthRefresh();
    scheduleReadingStateSave();
    if(libraryRestoreId)await restorePdfLibraryReading();
    if(isCurrentOpen(operation))await excerptSource.restore();
    if(isCurrentOpen(operation)){
      void refreshPdfReadingHints();
      recentReading.complete();
      await persistReadingState(true);
      await originalCopy.refresh();
    }
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
    pdfDocumentTranslationMessage=msg`已从文档库恢复 ${scoped.filter(block=>block.status==='done').length}/${scoped.length} 段`;
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
    showNotice(error instanceof Error?error.message:t('恢复失败，请重新选择原文件。'),{tone:'error'});
  }
}

async function openLocalFile(file: File, canOpen:()=>boolean=()=>true): Promise<void> {
  const validation = validateLocalPdfFiles([file]);
  if (!validation.ok) {
    showNotice(validation.message, { transient: true, tone: 'warning' });
    return;
  }
  try {
    const prefix = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (!hasPdfFileSignature(prefix)) {
      showNotice(t('无法打开 PDF：文件可能已损坏，或并不是有效的 PDF。'), {
        tone: 'error',
      });
      return;
    }
  } catch (error) {
    showNotice(error instanceof Error ? msg`无法读取 PDF：${error.message}` : t('无法读取这个 PDF。'), {
      tone: 'error',
    });
    return;
  }
  if(!canOpen())return;
  const operation = beginDocumentOpen(t('正在读取本地 PDF…'), 'reading-local');
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
    showNotice(error instanceof Error ? msg`无法读取 PDF：${error.message}` : t('无法读取这个 PDF。'), {
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
    showNotice(t('页面仍在渲染，请稍后再试。'), { transient: true, tone: 'warning' });
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
  if (viewRotation) {
    const pageNumber = Number(pageElement.dataset.pageNumber), epoch = documentEpoch;
    void changeViewRotation(0).then(async () => {
      const original = viewer.querySelector<HTMLElement>(`.pdf-page[data-page-number="${pageNumber}"]`);
      if (!original || epoch !== documentEpoch || !await waitForPageReady(original,epoch)) return;
      createPageRecognitionRegion(original);
    });
    return;
  }
  const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas');
  if (pageElement.dataset.rendered !== 'ready' || !canvas) {
    showNotice(t('页面仍在渲染，请稍后再试。'), { transient: true, tone: 'warning' });
    return;
  }
  const bounds = pageElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    showNotice(t('当前页面不可见，请滚动到页面后重试。'), {
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
    t('仅发送本页选定区域；使用同一 Qwen Key 调用 qwen3.5-ocr，可先排除页眉与页脚'),
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
    ...rotatePdfViewRect({leftRatio:region.left/pageBounds.width,topRatio:region.top/pageBounds.height,
      widthRatio:region.width/pageBounds.width,heightRatio:region.height/pageBounds.height},-viewRotation),
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
  const quarterTurn = viewRotation % 180 !== 0;
  const originalWidth = quarterTurn ? pageBounds.height : pageBounds.width;
  const originalHeight = quarterTurn ? pageBounds.width : pageBounds.height;
  for (const block of blocks) {
    const span = document.createElement('span');
    span.dataset.piOcrBlock = block.id;
    span.textContent = block.text;
    const point = rotatePdfViewRect({leftRatio:block.box.left,topRatio:block.box.top,widthRatio:0,heightRatio:0},viewRotation);
    span.style.left = `${point.leftRatio * 100}%`;
    span.style.top = `${point.topRatio * 100}%`;
    span.style.fontSize = `${Math.max(6, block.box.height * originalHeight * 0.88)}px`;
    textLayer.append(span);
    const naturalWidth = span.getBoundingClientRect().width;
    const targetWidth = block.box.width * originalWidth;
    if (naturalWidth > 0 && targetWidth > 0) {
      span.style.transform = `rotate(${viewRotation}deg) scaleX(${Math.min(4, Math.max(0.25, targetWidth / naturalWidth))})`;
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
    showNotice(t('原 PDF 已发生变化，无法恢复这个选区。'), {
      transient: true,
      tone: 'warning',
    });
    return undefined;
  }
  const pageElement = viewer.querySelector<HTMLElement>(
    `.pdf-page[data-page-number="${reference.pageNumber}"]`,
  );
  if (!pageElement) {
    showNotice(t('找不到原选区所在页面。'), { transient: true, tone: 'warning' });
    return undefined;
  }
  scrollToPageAnchor({ pageNumber: reference.pageNumber, ratio:rotatePdfViewRect(reference,viewRotation).topRatio });
  requestPageRender(pdfDocument, pageElement, renderGeneration);
  if (!await waitForPageReady(pageElement, documentEpoch)) {
    if (!pageElement.isConnected) return undefined;
    showNotice(t('页面尚未渲染完成，请稍后再试。'), {
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
  const rotated = rotatePdfViewRect(reference,viewRotation);
  return normalizeRegion(
    { x: rotated.leftRatio * width, y: rotated.topRatio * height },
    {x:(rotated.leftRatio+rotated.widthRatio)*width,y:(rotated.topRatio+rotated.heightRatio)*height},
    { left: 0, top: 0, width, height },
  );
}

function scrollPdfSourceLocationsIntoView(
  references: readonly PdfSourceLocation[],
  pageElement: HTMLElement,
): void {
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const samePage = references.filter((reference) => reference.pageNumber === pageNumber)
    .map(reference => rotatePdfViewRect(reference,viewRotation));
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
    showNotice(t('无法恢复原选区，请重新框选。'), { transient: true, tone: 'warning' });
    return;
  }
  if (regionMode === 'off') setRegionMode('single');
  const region = regionFromSourceLocation(reference, pageElement);
  const selection = createActiveRegion(pageElement, canvas, region);
  createRegionConfirmation(selection);
  showNotice(t('已恢复原选区，可拖动或调整角点后重新发送。'), {
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

async function navigateToPdfReadingSource(pageNumber:number,remember=true,summaryReturn?:ReadingSummaryReturn):Promise<void>{
  if(!pdfDocument)return;
  if(remember)pushPdfLinkHistory(visiblePageAnchor(),summaryReturn);
  if(!documentTranslationPanel.hidden&&pdfDocumentTranslationViewMode==='reading')setPdfDocumentTranslationViewMode('compare');
  await navigateToPdfMarkerPage(pageNumber);
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
    showNotice(t('翻译队列已满（最多 3 项），请等待当前任务完成。'), {
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
  showNotice(msg`已加入翻译队列 · ${pendingRegionTranslationCount()}/3`, {
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
          error instanceof Error ? error.message : t('框选翻译失败，请稍后重试。'),
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
  noteText = t('优先本地提取文字，必要时仅发送此区域'),
): void {
  if (notice.classList.contains('transient')) showNotice(undefined);
  selection.confirm?.remove();
  const confirmation = document.createElement('div');
  confirmation.className = 'region-confirm';
  confirmation.setAttribute('role', 'group');
  confirmation.setAttribute(
    'aria-label',
    selection.purpose === 'page-recognition' ? t('扫描页文字识别确认') : t('框选翻译确认'),
  );
  const note = document.createElement('span');
  note.className = 'region-confirm-note';
  note.textContent = noteText;
  const actions = document.createElement('div');
  actions.className = 'region-confirm-actions';
  const confirm = document.createElement('button');
  confirm.className = 'confirm';
  confirm.type = 'button';
  confirm.textContent = selection.purpose === 'page-recognition' ? t('识别文字') : t('发送并翻译');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('取消');
  const saveAreaNote=document.createElement('button');saveAreaNote.type='button';saveAreaNote.textContent=t('区域笔记');
  saveAreaNote.addEventListener('click',()=>{if(activeRegion!==selection||selection.documentEpoch!==documentEpoch)return;const bounds=selection.pageElement.getBoundingClientRect(),anchor=sourceLocationForRegion(Number(selection.pageElement.dataset.pageNumber),selection.region,bounds);clearRegionSelection();setRegionMode('off');readingAnnotations.annotateArea({kind:'region',...anchor})});
  actions.append(confirm,saveAreaNote,cancel);
  confirmation.append(note, actions);
  selection.pageElement.append(confirmation);
  selection.confirm = confirmation;
  selection.box.classList.add('adjustable');
  selection.box.title = t('拖动选框可移动，拖动角点可调整大小');
  selection.box.tabIndex = 0;
  selection.box.setAttribute('role', 'group');
  selection.box.setAttribute(
    'aria-label',
    t('翻译选区。方向键移动，Shift 加方向键调整宽度或高度。按 Tab 进入确认按钮。'),
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
      showNotice(t('已取消本页识别。'), { transient: true, tone: 'success' });
      return;
    }
    if (regionMode === 'continuous') {
      clearRegionSelection();
      showNotice(t('连续框选已开启 · 可继续拖动框选 · Esc 退出'), {
        transient: true,
        tone: 'info',
      });
    } else {
      setRegionMode('off');
    }
  });
  confirm.addEventListener('click', () => {
    if (pendingRegionTranslationCount() >= MAX_REGION_TRANSLATION_QUEUE) {
      showNotice(t('翻译队列已满（最多 3 项），请等待当前任务完成。'), {
        transient: true,
        tone: 'warning',
      });
      return;
    }
    confirm.disabled = true;
    cancel.disabled = true;
    showNotice(
      selection.purpose === 'page-recognition'
        ? t('正在识别本页文字…')
        : t('正在检查框选内容…'),
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
        showNotice(t('连续框选已开启 · 可继续拖动框选 · Esc 退出'), {
          transient: true,
          tone: 'info',
        });
      }
    };
    if (selection.purpose === 'page-recognition') {
      const recognitionRequestId = crypto.randomUUID();
      activePageRecognitionRequestId = recognitionRequestId;
      cancel.disabled = false;
      cancel.textContent = t('取消识别');
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
          cancel.textContent = t('取消');
          const recovery=translationErrorRecovery(response.error.code,response.error.retryable,'vision');
          showNotice(
            translationErrorMessage(response.error.code,response.error.message),
            {
              tone: 'error',
              ...(recovery.settingsFocus?{action:{label:recovery.settingsLabel??t('检查图像 API'),onClick:()=>{void openPdfSettings(recovery.settingsFocus)}}}:{}),
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
        showNotice(msg`已生成临时文字层 · ${lineCount} 行 · 现在可以直接划选翻译`, {
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
        cancel.textContent = t('取消');
        showNotice(error instanceof Error ? error.message : t('本页文字识别失败，请继续使用框选翻译。'), {
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
        pageLabel: pageNumber ? msg`第 ${pageNumber} 页框选` : t('PDF 框选区域'),
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
        pageLabel: pageNumber ? msg`第 ${pageNumber} 页框选` : t('PDF 框选区域'),
      });
    })().catch((error: unknown) => {
      if (documentEpoch !== captureEpoch || activeRegion !== selection) return;
      confirm.disabled = false;
      cancel.disabled = false;
      showNotice(error instanceof Error ? error.message : t('无法处理框选区域，请重新框选。'), {
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
    showNotice(t('框选范围太小，请拖动选择更大的文字或图片区域。'), {
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
    showNotice(t('找不到当前页，请稍后重试。'), { transient: true, tone: 'warning' });
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
  // Focused dialogs and menus keep background search/selection intact.
  if(keyEventDialog(event)||isEscapeInOpenPdfMenu(event))return;
  if (event.key === 'Escape' && !regionQueuePanel.hidden) {
    closeRegionQueuePanel();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.key === 'Escape' && isRegionModeActive()) {
    if (activeRegion && regionMode === 'continuous') {
      clearRegionSelection();
      showNotice(t('连续框选已开启 · 可继续拖动框选 · Esc 再次退出'), {
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
    source.protocol === 'file:' ? t('正在读取本地 PDF…') : t('正在读取在线 PDF…'),
    source.protocol === 'file:' ? 'reading-local' : 'reading-online',
  );
  try {
    if (
      source.protocol === 'file:' &&
      !(await browser.extension.isAllowedFileSchemeAccess())
    ) {
      emptyState.hidden = false;
      showNotice(
        t('Edge 尚未允许 Pi Translator 读取本地 PDF。请在扩展详情中开启“允许访问文件 URL”，再返回重试。'),
        {
          tone: 'warning',
          action: {
            label: t('打开扩展管理页'),
            onClick: () => {
              void browser.tabs.create({
                url: `edge://extensions/?id=${browser.runtime.id}`,
                active: true,
              }).catch(() => showNotice(t('请手动打开 edge://extensions，并进入 Pi Translator 详情。'), {
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
        t('Pi PDF 还没有当前 PDF 地址的读取权限。授权只针对当前文件来源。'),
        {
          tone: 'warning',
          action: {
            label: t('授权并重试'),
            onClick: () => {
              void browser.permissions.request({ origins: [permission] }).then((granted) => {
                if (granted) void openPdfSource(source, initialPage);
              }).catch(() => showNotice(t('未能发起 PDF 地址授权，请返回快捷面板后重试。'), {
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
        ? t('Overleaf 返回了登录页或项目页面，而不是 PDF。请在 Overleaf 下载当前编译 PDF，再用 Pi PDF 打开下载文件')
        : t('这个地址返回的不是 PDF 文件'));
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const responseStart = new TextDecoder().decode(data.subarray(0, 256)).trimStart();
    if (/^(?:<!doctype\s+html|<html\b|\{\s*["'])/iu.test(responseStart)) {
      throw new Error(isOverleafSource
        ? t('Overleaf 返回了登录页或项目页面，而不是 PDF。请在 Overleaf 下载当前编译 PDF，再用 Pi PDF 打开下载文件')
        : t('这个地址返回的不是 PDF 文件'));
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
      msg`${error instanceof Error ? error.message : t('在线 PDF 读取失败')}。你仍可点击“打开 PDF”选择已下载的本地文件。`,
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
      title: t('一次只能打开一份 PDF'),
      description: t('请只保留一个文件后重试'),
    };
  }
  const knownType = items[0]?.type.toLowerCase();
  if (
    knownType &&
    !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(knownType)
  ) {
    return {
      invalid: true,
      title: t('这里只能打开 PDF'),
      description: t('当前拖入的文件类型不受支持'),
    };
  }
  return {
    invalid: false,
    title: pdfDocument ? t('松开以更换当前 PDF') : t('松开以打开 PDF'),
    description: pdfDocument
      ? t('新文档将在当前阅读器中打开')
      : t('文件只在当前标签页中读取'),
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
function openSelectedLocalPdf():void {
  const file = fileInput.files?.[0];
  if (file) void openLocalFile(file);
  fileInput.value = '';
}
fileInput.addEventListener('change', openSelectedLocalPdf);

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
  fitWidthActive = false; fitPageActive = false;
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
  const rotation = viewRotation;
  const task = pdf.getPage(anchor.pageNumber).then((page) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch || viewRotation !== rotation || !(fitWidthActive || fitPageActive)) return;
    const baseViewport = page.getViewport({ scale: 1, rotation:(page.rotate+viewRotation)%360 });
    const horizontalPadding = matchMedia('(max-width: 720px)').matches ? 28 : 68;
    const availableWidth = Math.max(100, stage.clientWidth - horizontalPadding - 2);
    const widthZoom = availableWidth / Math.max(1, baseViewport.width);
    const nextZoom = clamp(fitPageActive ? Math.min(widthZoom,Math.max(80,stage.clientHeight-44)/Math.max(1,baseViewport.height)) : widthZoom,0.1,ZOOM_LEVELS.at(-1)!);
    if (Math.abs(nextZoom - currentZoom()) < .001) { setDocumentControls(true); return; }
    return rebuildAtZoom(nextZoom, anchor);
  }).catch((error: unknown) => {
    if (pdfDocument !== pdf || documentEpoch !== epoch) return;
    showNotice(error instanceof Error ? error.message : t('无法计算适合宽度。'), {
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
  if (!(fitWidthActive || fitPageActive) || !pdfDocument) return;
  fitWidthTimer = setTimeout(() => {
    fitWidthTimer = undefined;
    fitDocumentToAvailableWidth();
  }, 120);
}

function rebuildAtZoom(nextZoom: number, anchor = visiblePageAnchor()): Promise<void> {
  if (!pdfDocument) return Promise.resolve();
  completedTextSelectionGesture = undefined;
  zoomLevel = clamp(nextZoom, fitWidthActive || fitPageActive ? 0.1 : ZOOM_LEVELS[0], ZOOM_LEVELS.at(-1)!);
  setDocumentControls(true);
  const task = buildPages(pdfDocument, anchor);
  scheduleReadingStateSave();
  return task;
}

zoomOut.addEventListener('click', () => {
  if (!pdfDocument || zoomOut.disabled) return;
  fitWidthActive = false; fitPageActive = false;
  rebuildAtZoom(steppedZoom(-1));
});
zoomIn.addEventListener('click', () => {
  if (!pdfDocument || zoomIn.disabled) return;
  fitWidthActive = false; fitPageActive = false;
  rebuildAtZoom(steppedZoom(1));
});
fitWidth.addEventListener('click', () => {
  if (!pdfDocument) return;
  fitWidthActive = true; fitPageActive = false;
  fitDocumentToAvailableWidth();
  scheduleReadingStateSave();
});

fitPage.addEventListener('click', () => {
  if (!pdfDocument) return;
  fitPageActive = true; fitWidthActive = false;
  fitDocumentToAvailableWidth({pageNumber:visiblePageAnchor(false).pageNumber,ratio:0});
  scheduleReadingStateSave();
});

async function changeViewRotation(rotation: PdfViewRotation): Promise<void> {
  if (!pdfDocument) return;
  const pdf = pdfDocument, epoch = documentEpoch;
  const anchor = visiblePageAnchor();
  viewRotation = rotation;
  thumbnails.reset(pdfDocument,rotation);
  stopSearchIndexing(); searchPageIndexes.clear();
  if (fitWidthActive || fitPageActive) await fitDocumentToAvailableWidth(anchor);
  if (pdfDocument !== pdf || documentEpoch !== epoch || viewRotation !== rotation) return;
  // Fit can yield the same zoom (e.g. a square page), but orientation still needs rebuilding.
  if (viewer.querySelector('.pdf-page')?.getAttribute('data-view-rotation') !== String(rotation)) {
    await rebuildAtZoom(currentZoom(),anchor);
  }
  if (pdfDocument !== pdf || documentEpoch !== epoch || viewRotation !== rotation) return;
  updatePdfSearchMatches(true); startPdfSearchIndexing();
  scheduleReadingStateSave();
}
rotatePage.addEventListener('click', () => { void changeViewRotation(((viewRotation+90)%360) as PdfViewRotation); });
readerFullscreen.addEventListener('click', () => {
  const task = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  void task.catch(() => showNotice(t('无法进入全屏，请使用浏览器的全屏功能。'),{tone:'warning',transient:true}));
});
document.addEventListener('fullscreenchange', () => {
  const active = Boolean(document.fullscreenElement);
  readerFullscreen.textContent = active ? t('退出全屏') : t('全屏阅读');
  readerFullscreen.setAttribute('aria-pressed',String(active));
  scheduleFitWidthRefresh();
});

let pageJumpCommittedByEnter: string | undefined;
function commitPageJump(): void {
  const total = pdfDocument?.numPages ?? 0;
  if (!total) return;
  const requested = Number(pageNumberInput.value);
  const pageNumber = clamp(Number.isFinite(requested) ? Math.round(requested) : 1, 1, total);
  pageNumberInput.value = String(pageNumber);
  scrollToPageAnchor({ pageNumber, ratio: 0 });
  schedulePageRetention();
}

pageNumberInput.addEventListener('input', () => { pageJumpCommittedByEnter = undefined; });
pageNumberInput.addEventListener('change', () => {
  const alreadyCommitted = pageJumpCommittedByEnter === pageNumberInput.value;
  pageJumpCommittedByEnter = undefined;
  if (!alreadyCommitted) commitPageJump();
});
pageNumberInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitPageJump();
    pageJumpCommittedByEnter = pageNumberInput.value;
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
      msg`当前页（第 ${visiblePageAnchor().pageNumber} 页）`;
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
async function locatePdfSummarySource(source:import('../../core/content/note-summary').NoteSummarySource,summaryReturn?:ReadingSummaryReturn):Promise<boolean>{
  const result=await excerptSource.tryReuse(source.id,summaryReturn);return result.matched&&!result.draft;
}
element<HTMLButtonElement>('pdf-note-summary').addEventListener('click',()=>{const fingerprint=currentPdfContentFingerprint;if(!fingerprint){showNotice(t('请先选择原 PDF 核验文档身份。'));return}documentTranslationCopyMenu.open=false;void pdfReadingStateId(`pdf-content:${fingerprint}`).then(documentId=>{if(currentPdfContentFingerprint===fingerprint)openNoteSummary({kind:'pdf',documentId},{isCurrent:()=>currentPdfContentFingerprint===fingerprint,onLocateSource:locatePdfSummarySource})}).catch(error=>showNotice(String(error)))});
element<HTMLButtonElement>('pdf-library-source').addEventListener('click',()=>{
  if(cachedReadingContext?.kind!=='pdf')return;
  libraryRestoreId=cachedReadingContext.id;
  const url=new URL(location.href);url.searchParams.delete('library');url.searchParams.set('restore',libraryRestoreId);history.replaceState(null,'',url);
  documentTranslationCopyMenu.open=false;
  const fingerprint=cachedReadingContext.record.sourceFingerprint;
  void(async()=>{if(!fingerprint||!await originalCopy.open(await pdfReadingStateId(`pdf-content:${fingerprint}`)))fileInput.click()})().catch(error=>showNotice(error instanceof Error?error.message:t('请重新选择原 PDF。'),{tone:'error'}));
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
  const text = t('# 旧分段译文备查\n\n这些结果来自同一 PDF 的旧分段，未套用到当前段落。公式、人工修正和核对提示按原记录保留。\n\n') +
    pdfDocumentTranslationArchivedBlocks.map(block => `## ${block.signature}\n\n${block.formulaDocument ? formulaDocumentText(block.formulaDocument) : block.translatedText}\n\n${[block.formulaReviewDraft ? t('未确认草稿') : '', block.formulaReviewMessage, block.visualFallbackMessage, block.reviewConfirmation ? t('已人工核对') : ''].filter(Boolean).join('；')}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'}));
  const anchor = document.createElement('a');anchor.href = url;anchor.download = t('旧分段译文.md');anchor.click();
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
const pdfReadingHints=bindReadingHints({host:document.body,target:()=>readingHintTarget,resumePage:()=>readingHintResumePage,locate:locatePdfSummarySource});
async function refreshPdfReadingHints():Promise<void>{
  const fingerprint=currentPdfContentFingerprint;if(!fingerprint)return;
  const documentId=await pdfReadingStateId(`pdf-content:${fingerprint}`);
  if(currentPdfContentFingerprint!==fingerprint)return;readingHintTarget={kind:'pdf',documentId};await pdfReadingHints.refresh();
}
const readingAnnotations=bindPdfReadingAnnotations({
  rotation:()=>viewRotation,
  viewer,
  modeHost:document.querySelector<HTMLElement>('.document-actions')!,
  currentDocument:()=>pdfDocument&&currentPdfContentFingerprint?{identity:`pdf-content:${currentPdfContentFingerprint}`,title:documentName.textContent?.trim()||'PDF',url:currentSourceUrl,citation:currentPdfCitation}:undefined,
  navigate:navigateToPdfReadingSource,
  notice:(text,transient)=>showNotice(text,{...(transient?{transient:true}:{})}),
  onNewProjectNote:async(kind,documentId,noteId)=>{const projectId=new URL(location.href).searchParams.get('project');return projectId?addDocumentToProject(JSON.stringify([kind,documentId,noteId]),projectId):undefined},
  onModeChange:async enabled=>{
    (await selectionTranslator).setReadingAnnotationMode(enabled);
  },
});
const originalCopy=bindPdfOriginalCopy({current:()=>pdfDocument&&currentPdfBackgroundData&&currentPdfContentFingerprint?{data:currentPdfBackgroundData,name:documentName.textContent?.trim()||'PDF',fingerprint:currentPdfContentFingerprint}:undefined,open:openLocalFile,notice:text=>showNotice(text,{transient:true})});
const recentReading=bindPdfRecentReading({empty:emptyState,notice:text=>showNotice(text),openCopy:originalCopy.open});
const excerptOpenOperation=openOperationId;
const excerptSource=bindPdfExcerptSource({
  empty:emptyState,viewer,
  openCopy:originalCopy.open,canAutoOpen:()=>openOperationId===excerptOpenOperation,
  current:()=>pdfDocument&&currentPdfContentFingerprint?{fingerprint:currentPdfContentFingerprint,identity:currentReadingIdentity,rotation:viewRotation}:undefined,
  navigate:navigateToPdfReadingSource,
  notice:text=>showNotice(text),
});
element<HTMLButtonElement>('pdf-open-annotations').addEventListener('click',()=>{
  element<HTMLDetailsElement>('pdf-reader-menu').open=false;readingAnnotations.open();
});
const selectionTranslator = startSelectionTranslator(
  { onInvalidated: (callback) => invalidationCallbacks.push(callback) },
  'pdf',
  {
    pageUrl: () => currentSourceUrl,
    citationMetadata: () => currentPdfCitation,
    sourceLabel: () => currentSourceLabel,
    documentId: () => currentReadingIdentity,
    glossaryDocumentId:pdfGlossaryDocumentId,
    allowSitePause: false,
    viewportInsets: () => ({ top: toolbar.getBoundingClientRect().bottom }),
    shouldIgnoreSelection: (selection) => Boolean(
      (selection.anchorNode && documentTranslationPanel.contains(selection.anchorNode)) ||
      (selection.focusNode && documentTranslationPanel.contains(selection.focusNode)) ||
      (selection.anchorNode && readingAnnotations.contains(selection.anchorNode)) ||
      (selection.focusNode && readingAnnotations.contains(selection.focusNode)) ||
      (document.activeElement && readingAnnotations.contains(document.activeElement)),
    ),
    onSidebarLayoutChange: applyPdfSidebarLayout,
    onSidebarActiveChange: (active) => {
      continuousSidebarActive = active;
      if (active && !documentTranslationPanel.hidden) {
        closePdfDocumentTranslation({ restoreFocus: false });
      }
    },
    selectionPreview: pdfSelectionPreview,
    onAnnotateSelection:readingAnnotations.annotateSelection,
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
        const oldIds=new Set(pdfMarkerSnapshot.markers.map(marker=>marker.markerId)),newIds=markers.filter(marker=>!oldIds.has(marker.markerId)).map(marker=>marker.markerId),projectId=new URL(location.href).searchParams.get('project');
        const saved=await savePdfTranslationMarkers(identity,markers,pdfMarkerSnapshot.markers);
        if(currentReadingIdentity===identity)pdfMarkerSnapshot={identity,markers:saved.markers};
        if(projectId&&newIds.length)try{const documentId=await pdfReadingStateId(identity);for(const noteId of newIds)await addDocumentToProject(JSON.stringify(['pdf',documentId,noteId]),projectId)}catch{showNotice(t('笔记已保存，但未加入项目；可在文档库重新选择。'),{tone:'warning'})}
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
  scheduleFitWidthRefresh();
  applyPdfSidebarLayout(pdfSidebarLayout);
  updatePdfDocumentTranslationInset();
};
window.addEventListener('resize', onPdfViewportResize, { passive: true });

let readingSourceTabId:number|undefined;
void browser.tabs.getCurrent().then(tab=>{readingSourceTabId=tab?.id});
browser.runtime.onMessage.addListener((value:unknown)=>{
  if(!isRuntimeMessage(value)||value.type!=='REUSE_READING_SOURCE'||value.payload.tabId!==readingSourceTabId)return;
  return (async()=>{
    const target=pdfReadingTarget(value.payload.url,browser.runtime.getURL('/pdf.html'));
    const fingerprint=currentPdfContentFingerprint;
    if(!target||!pdfDocument||!fingerprint)return {ok:true,data:{matched:false}};
    if(target.kind==='excerpt')return {ok:true,data:await excerptSource.tryReuse(target.id)};
    const matched=await recentReading.matches(fingerprint,target.id);
    return {ok:true,data:{matched:matched&&fingerprint===currentPdfContentFingerprint,...(hasReadingDraft()?{draft:true}:{})}};
  })().catch(()=>({ok:true,data:{matched:false}}));
});

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
  preview:async(target,host,signal)=>{
    const pdf=pdfDocument,epoch=documentEpoch,block=pdfDocumentTranslationBlocksState.find(item=>item.id===target.blockId);
    if(!pdf){const message=document.createElement('p');message.textContent=t('未加载原 PDF，可跳转到已保存译文；原始图表需选择原文件后查看。');host.append(message);return}
    const page=await pdf.getPage(target.pageNumber);signal.throwIfAborted();if(pdfDocument!==pdf||documentEpoch!==epoch)return;
    const base=page.getViewport({scale:1,rotation:(page.rotate+viewRotation)%360}),scale=Math.min(1,620/base.width,Math.sqrt(2_000_000/(base.width*base.height)));
    const viewport=page.getViewport({scale,rotation:base.rotation}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.maxWidth='100%';canvas.ariaLabel=t('原 PDF 页面预览');
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建来源预览。');host.append(canvas);
    const render=page.render({canvas,canvasContext:context,viewport}),cancel=()=>render.cancel();signal.addEventListener('abort',cancel,{once:true});
    try{await render.promise;signal.throwIfAborted();if(documentEpoch!==epoch){canvas.remove();return}if(block?.sourceAnchor){const rect=rotatePdfViewRect(block.sourceAnchor,viewRotation);host.scrollTop=Math.max(0,rect.topRatio*canvas.height-16)}}finally{signal.removeEventListener('abort',cancel)}
  },
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
  emptyState.querySelector('h1')!.textContent=t('选择原 PDF 恢复阅读');
  emptyState.querySelector('p')!.textContent=t('在本机核验文件后恢复保留译文，不发送新的翻译请求。');
}
const initialSource = parsePdfSourceUrl(
  new URLSearchParams(location.search).get('url') ?? undefined,
);
const initialPage = pdfInitialPage(location.href) ?? pdfInitialPage(initialSource?.href);
if (initialSource) void openPdfSource(initialSource, initialPage);
const initialLibraryId=new URL(location.href).searchParams.get('library');
if(initialLibraryId)void openCachedLibraryReading(initialLibraryId);
void excerptSource.prepare();
void recentReading.prepare();
// The user may have selected a file while UI language initialization was waiting.
// Start it only after the reader and its annotation controls are fully bound.
chooseFile.disabled=emptyOpen.disabled=false;
if(fileInput.files?.length)openSelectedLocalPdf();

}

void startUi();
