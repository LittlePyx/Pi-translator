import { MAX_SELECTION_LENGTH, type SelectionSnapshot } from '../selection/types';
import type {
  ContextMode,
  GeneralPageMode,
  HistoryLimit,
  SidebarMode,
  SidebarSide,
} from '../settings/schema';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import type {
  GlossaryEntry,
  TranslateBatchRequest,
  TranslateRequest,
  TranslateImageRegionRequest,
  TranslateResult,
  TranslationCorrectionReceipt,
  TranslationCorrectionTermInput,
  TranslationHistoryEntry,
  TranslationBatchItemResult,
  TranslationMemoryScope,
  TranslationRevisionScope,
} from '../translation/types';
import type { TranslationErrorCode } from './errors';
import { validTranslationBatchItems } from '../translation/document-batch';
import type { SettingsFocus, TranslationProviderRole } from './user-facing-error';
import type { DocumentMemorySnapshot } from '../document/document-memory-repository';
import type { PdfSourceLocation } from '../translation/types';
import type {
  CoordinateOcrPage,
  RecognizePdfPageRequest,
} from '../pdf/ocr-text-layer';
import {
  isSupportedTargetLanguage,
  type SupportedTargetLanguage,
} from '../language/supported-target-languages';
import {
  isBilingualPageState,
  type BilingualPageAction,
  type BilingualPageState,
} from '../translation/bilingual-page';
import {
  isBilingualPageSessionDescriptor,
  isBilingualPageSessionUpdate,
  type BilingualPageSessionDescriptor,
  type BilingualPageSessionSnapshot,
  type BilingualPageSessionUpdate,
} from '../translation/bilingual-page-session';
import type { DocumentTranslationExport } from '../translation/document-export';

export interface DocumentMemoryLocator {
  pageUrl: string;
  documentId?: string;
  sourceLabel?: string;
  sourceLocation?: PdfSourceLocation;
}

export interface SettingsRecoveryRequest {
  role: TranslationProviderRole;
  errorCode: TranslationErrorCode;
  failedRequestId: string;
  hadPartialOutput: boolean;
  autoResume: boolean;
  clientId?: string;
  nativePdfTabId?: number;
}

export interface SettingsRecoveryDescriptor {
  token: string;
  role: TranslationProviderRole;
  focus: SettingsFocus;
  errorCode: TranslationErrorCode;
  hadPartialOutput: boolean;
  autoResume: boolean;
  expiresAt: number;
}

export interface SettingsRecoveryReadyPayload {
  token: string;
  role: TranslationProviderRole;
  failedRequestId: string;
  hadPartialOutput: boolean;
  autoResume: boolean;
  targetKind: 'content-script' | 'extension-page' | 'native-pdf';
  sourceTabId: number;
  clientId?: string;
}

export interface PublicSettings {
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
  showFloatingButtonOnOverleaf: boolean;
  hideFloatingButtonForTargetLanguage: boolean;
  generalPageMode: GeneralPageMode;
  siteAllowlist: string[];
  pausedSiteHosts: string[];
  sentenceAlignmentDefault: boolean;
  autoRenderLatex: boolean;
  historyLimit: HistoryLimit;
  sidebarMode: SidebarMode;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
  contextMode: ContextMode;
  enableStreaming: boolean;
  protectSensitiveFields: boolean;
  pdfKeyboardShortcutsEnabled: boolean;
  pdfRegionShortcutKey: string;
  activeApiProfileId: string;
  apiProfiles: Array<{ id: string; name: string; model: string }>;
}

export interface ApiDiagnosticReport {
  origin: string;
  permissionGranted: boolean;
  authenticated: boolean;
  modelCount: number;
  configuredModelAvailable: boolean;
  chatCompletion: boolean;
  structuredOutput: boolean;
  sentenceAlignment: boolean;
  latencyMs?: number;
  notes: string[];
}

export interface LocalRenderPerformancePayload {
  operation: 'render-result';
  timings: {
    totalMs: number;
    textRenderMs: number;
    mathRenderMs: number;
  };
  errorCode?: 'INVALID_RESPONSE';
}

export type TranslationProgressStage =
  | 'provider'
  | 'validating-latex'
  | 'committing';

export interface PdfSidePanelSession {
  tabId: number;
  sourceKind?: 'pdf' | 'web';
  /** Current-tab override used by the browser side panel; it is not a global setting. */
  targetLanguage?: string;
  requestId: string;
  sourceText: string;
  pageUrl: string;
  pageNumber?: number;
  sourceLabel: string;
  status: 'translating' | 'complete' | 'error';
  startedAt: number;
  partialText?: string;
  completedChunks?: number;
  totalChunks?: number;
  /** Transient translation stage; contains no user or provider content. */
  progressStage?: TranslationProgressStage;
  providerContext?: {
    role: 'text' | 'vision';
    profileName: string;
    model: string;
  };
  result?: TranslateResult;
  error?: {
    code: TranslationErrorCode;
    message: string;
    retryable: boolean;
  };
  settingsRecoveryConfirmation?: {
    failedRequestId: string;
    hadPartialOutput: boolean;
  };
  correctionReceipt?: TranslationCorrectionReceipt;
}

export type RuntimeMessage =
  | { type: 'TRANSLATE_SELECTION'; payload: TranslateRequest }
  | { type: 'TRANSLATE_SELECTION_IN_BROWSER_SIDEBAR'; payload: TranslateRequest }
  | { type: 'TRANSLATE_BILINGUAL_PAGE_SEGMENT'; payload: TranslateRequest }
  | { type: 'TRANSLATE_DOCUMENT_BATCH'; payload: TranslateBatchRequest }
  | { type: 'TRANSLATE_IMAGE_REGION'; payload: TranslateImageRegionRequest }
  | { type: 'RECOGNIZE_PDF_PAGE'; payload: RecognizePdfPageRequest }
  | { type: 'CAPTURE_VISIBLE_TAB' }
  | { type: 'CANCEL_TRANSLATION'; payload: { requestId: string } }
  | { type: 'TRIGGER_TRANSLATE' }
  | {
      type: 'START_BILINGUAL_PAGE';
      payload: { tabId: number; targetLanguage: SupportedTargetLanguage };
    }
  | { type: 'GET_BILINGUAL_PAGE_STATE'; payload: { tabId: number } }
  | { type: 'GET_BILINGUAL_PAGE_EXPORT'; payload: { tabId: number } }
  | {
      type: 'CONTROL_BILINGUAL_PAGE';
      payload: { tabId: number; action: BilingualPageAction };
    }
  | {
      type: 'START_BILINGUAL_PAGE_IN_TAB';
      payload: { targetLanguage: SupportedTargetLanguage };
    }
  | { type: 'GET_BILINGUAL_PAGE_STATE_IN_TAB' }
  | { type: 'GET_BILINGUAL_PAGE_EXPORT_IN_TAB' }
  | {
      type: 'CONTROL_BILINGUAL_PAGE_IN_TAB';
      payload: { action: BilingualPageAction };
    }
  | { type: 'BILINGUAL_PAGE_STATE_UPDATED'; payload: { state: BilingualPageState } }
  | {
      type: 'BILINGUAL_PAGE_TAB_STATE_UPDATED';
      payload: { tabId: number; state: BilingualPageState };
    }
  | {
      type: 'GET_BILINGUAL_PAGE_SESSION';
      payload: { descriptor: BilingualPageSessionDescriptor };
    }
  | {
      type: 'SAVE_BILINGUAL_PAGE_SESSION';
      payload: BilingualPageSessionUpdate;
    }
  | {
      type: 'CLEAR_BILINGUAL_PAGE_SESSION';
      payload: { descriptor: BilingualPageSessionDescriptor };
    }
  | {
      type: 'GET_RETAINED_BILINGUAL_PAGE_SESSION';
      payload: { descriptor: BilingualPageSessionDescriptor };
    }
  | {
      type: 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION';
      payload: BilingualPageSessionUpdate;
    }
  | {
      type: 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION';
      payload: { descriptor: BilingualPageSessionDescriptor };
    }
  | {
      type: 'START_WEB_REGION_SELECTION';
      payload?: { restorePreviousRegion?: boolean };
    }
  | {
      type: 'PREPARE_WEB_CAPTURE_PERMISSION';
      payload?: { intent?: 'start' | 'restore' };
    }
  | { type: 'GET_CURRENT_WEB_CAPTURE_PERMISSION_PROMPT' }
  | { type: 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT' }
  | { type: 'OPEN_WEB_CAPTURE_PERMISSION_PANEL' }
  | { type: 'GET_WEB_CAPTURE_PERMISSION_PROMPT'; payload: { tabId: number } }
  | { type: 'WEB_CAPTURE_PERMISSION_PANEL_OPENED'; payload: { tabId: number } }
  | {
      type: 'OPEN_OPTIONS_PAGE';
      payload?: { focus?: SettingsFocus; recovery?: SettingsRecoveryRequest };
    }
  | { type: 'GET_SETTINGS_RECOVERY'; payload: { token: string } }
  | {
      type: 'COMPLETE_SETTINGS_RECOVERY';
      payload: { token: string; configurationRevision: string };
    }
  | { type: 'SETTINGS_RECOVERY_READY'; payload: SettingsRecoveryReadyPayload }
  | { type: 'GET_ACTIVE_PDF_SOURCE' }
  | { type: 'OPEN_PDF_VIEWER'; payload?: { url?: string; page?: number } }
  | { type: 'GET_PDF_SIDE_PANEL_SESSION'; payload: { tabId: number } }
  | {
      type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION';
      payload: { tabId: number; expectedRequestId: string };
    }
  | {
      type: 'RETRANSLATE_SIDE_PANEL_TRANSLATION';
      payload: {
        tabId: number;
        expectedRequestId: string;
        targetLanguage: SupportedTargetLanguage;
      };
    }
  | {
      type: 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION';
      payload: {
        expectedRequestId: string;
        targetLanguage: SupportedTargetLanguage;
        result?: TranslateResult;
      };
    }
  | {
      type: 'CANCEL_PDF_SIDE_PANEL_TRANSLATION';
      payload: { tabId: number; expectedRequestId: string };
    }
  | { type: 'PDF_SIDE_PANEL_SESSION_UPDATED'; payload: PdfSidePanelSession }
  | { type: 'OPEN_SIDEBAR' }
  | {
      type: 'OPEN_BROWSER_SIDEBAR';
      payload?: {
        result?: TranslateResult;
        pageUrl?: string;
        sourceLabel?: string;
        persistPreference?: boolean;
      };
    }
  | { type: 'USE_FLOATING_SIDEBAR'; payload?: { tabId: number } }
  | { type: 'BROWSER_SIDEBAR_ACTIVE' }
  | { type: 'BROWSER_SIDEBAR_CLOSED' }
  | { type: 'GET_CONTINUOUS_TRANSLATION_STATE'; payload?: { tabId: number } }
  | {
      type: 'SET_CONTINUOUS_TRANSLATION_PAUSED';
      payload: { paused: boolean; tabId?: number };
    }
  | {
      type: 'CONTINUOUS_TRANSLATION_STATE_UPDATED';
      payload: { tabId: number; paused: boolean };
    }
  | { type: 'GET_SIDEBAR_OBSTRUCTION_HINT' }
  | { type: 'DISMISS_SIDEBAR_OBSTRUCTION_HINT' }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: { width: number } }
  | { type: 'PAUSE_CURRENT_SITE'; payload: { pageUrl: string } }
  | { type: 'GET_DOCUMENT_MEMORY'; payload: DocumentMemoryLocator }
  | { type: 'CONFIRM_DOCUMENT_TERM'; payload: DocumentMemoryLocator & { candidateId: string } }
  | {
      type: 'UPSERT_DOCUMENT_TERM';
      payload: DocumentMemoryLocator & { term: { id?: string; source: string; target: string } };
    }
  | { type: 'REMOVE_DOCUMENT_TERM'; payload: DocumentMemoryLocator & { termId: string } }
  | { type: 'DISMISS_DOCUMENT_TERM_CANDIDATE'; payload: DocumentMemoryLocator & { candidateId: string } }
  | { type: 'RESOLVE_DOCUMENT_REVIEW'; payload: DocumentMemoryLocator & { reviewId: string } }
  | { type: 'CLEAR_DOCUMENT_MEMORY'; payload: DocumentMemoryLocator }
  | {
      type: 'UPDATE_TRANSLATION_RESULT';
      payload: DocumentMemoryLocator & {
        result: TranslateResult;
        rememberForDocument?: boolean;
        scope?: TranslationMemoryScope;
        previousTranslatedText: string;
        baseRequestId: string;
        term?: TranslationCorrectionTermInput;
      };
    }
  | {
      type: 'UNDO_TRANSLATION_RESULT';
      payload: DocumentMemoryLocator & {
        result: TranslateResult;
        receipt: TranslationCorrectionReceipt;
      };
    }
  | {
      type: 'UPDATE_TRANSLATION_SEGMENT';
      payload: DocumentMemoryLocator & {
        result: TranslateResult;
        segmentId: string;
        expectedTranslatedText: string;
        correctedTranslatedText: string;
      };
    }
  | {
      type: 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT';
      payload: {
        tabId: number;
        expectedRequestId: string;
        expectedResultRequestId: string;
        translatedText: string;
        scope: TranslationMemoryScope;
        term?: TranslationCorrectionTermInput;
      };
    }
  | {
      type: 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT';
      payload: {
        tabId: number;
        expectedRequestId: string;
        expectedResultRequestId: string;
        expectedCorrectedRequestId: string;
      };
    }
  | { type: 'RENDER_LATEX_MATHML'; payload: { tex: string; displayMode: boolean } }
  | {
      type: 'RENDER_LATEX_MATHML_BATCH';
      payload: { items: Array<{ tex: string; displayMode: boolean }> };
    }
  | {
      type: 'TRANSLATION_PROGRESS';
      payload: {
        requestId: string;
        partialText?: string;
        completedChunks: number;
        totalChunks: number;
        progressStage?: TranslationProgressStage;
        result?: TranslateResult;
      };
    }
  | { type: 'CONTEXT_MENU_TRANSLATE'; payload: SelectionSnapshot }
  | { type: 'GET_PUBLIC_SETTINGS' }
  | { type: 'PUBLIC_SETTINGS_UPDATED'; payload: PublicSettings }
  | {
      type: 'TEST_API_CONNECTION';
      payload: { apiKey?: string; apiBaseUrl: string; model: string; profileId?: string };
    }
  | {
      type: 'TEST_VISION_CAPABILITY';
      payload: { apiKey?: string; apiBaseUrl: string; model: string; profileId?: string };
    }
  | {
      type: 'LIST_API_MODELS';
      payload: { apiKey?: string; apiBaseUrl: string; profileId?: string };
    }
  | {
      type: 'DIAGNOSE_API';
      payload: { apiKey?: string; apiBaseUrl: string; model: string; profileId?: string };
    }
  | { type: 'RECORD_LOCAL_PERFORMANCE'; payload: LocalRenderPerformancePayload }
  | { type: 'GET_LOCAL_DIAGNOSTIC_REPORT' };

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: TranslationErrorCode;
        message: string;
        retryable: boolean;
      };
    };

export interface TranslationSessionResult {
  result: TranslateResult;
  history: TranslationHistoryEntry[];
  correctionReceipt?: TranslationCorrectionReceipt;
  termRollbackSkipped?: boolean;
}

export type TranslateRuntimeResponse = RuntimeResponse<TranslationSessionResult>;
export type TranslationBatchRuntimeResponse = RuntimeResponse<{
  items: TranslationBatchItemResult[];
  missingItemIds: string[];
}>;
export type BilingualPageStateResponse = RuntimeResponse<{ state: BilingualPageState }>;
export type BilingualPageExportResponse = RuntimeResponse<{ export: DocumentTranslationExport }>;
export type BilingualPageSessionResponse = RuntimeResponse<{
  session?: BilingualPageSessionSnapshot;
}>;
export type RecognizePdfPageResponse = RuntimeResponse<{ page: CoordinateOcrPage }>;
export type ConnectionTestResponse = RuntimeResponse<{
  connected: true;
  sampleSource: string;
  sampleTranslation: string;
}>;
export type VisionCapabilityTestResponse = RuntimeResponse<{
  supported: true;
  latencyMs: number;
}>;
export type ModelListResponse = RuntimeResponse<{ models: string[] }>;
export type ApiDiagnosticResponse = RuntimeResponse<ApiDiagnosticReport>;
export type PublicSettingsResponse = RuntimeResponse<PublicSettings>;
export type LocalDiagnosticReportResponse = RuntimeResponse<{ report: string }>;
export type DocumentMemoryResponse = RuntimeResponse<{ memory: DocumentMemorySnapshot }>;
export type UpdateTranslationResultResponse = RuntimeResponse<TranslationSessionResult>;
export type ActivePdfSourceResponse = RuntimeResponse<{
  detected: boolean;
  sourceUrl?: string;
}>;
export type OpenOptionsPageResponse = RuntimeResponse<{
  opened: true;
  recoveryToken?: string;
}>;
export type SettingsRecoveryResponse = RuntimeResponse<{
  recovery: SettingsRecoveryDescriptor;
}>;
export type CompleteSettingsRecoveryResponse = RuntimeResponse<{
  returned: boolean;
  resumed: boolean;
  requiresConfirmation: boolean;
}>;
export type LatexMathMlResponse = RuntimeResponse<{ html?: string }>;
export type LatexMathMlBatchResponse = RuntimeResponse<{ html: Array<string | null> }>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined;
}

function nonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength;
}

function validTranslationScope(value: unknown): value is TranslationRevisionScope {
  return value === 'current' || value === 'document' || value === 'global';
}

function validTranslationMemoryScope(value: unknown): value is TranslationMemoryScope {
  return value === 'current' || value === 'document';
}

function validTranslationTermScope(value: unknown): value is TranslationCorrectionTermInput['scope'] {
  return value === 'document' || value === 'global';
}

function validTerm(value: unknown): value is GlossaryEntry {
  const term = record(value);
  return Boolean(
    term &&
    nonEmptyString(term.source, 120) &&
    nonEmptyString(term.target, 120),
  );
}

function validCorrectionTermInput(value: unknown): value is TranslationCorrectionTermInput {
  const term = record(value);
  return Boolean(term && validTerm(term) && validTranslationTermScope(term.scope));
}

function validCorrectionTermReceipt(value: unknown): boolean {
  const term = record(value);
  return Boolean(
    term &&
    (term.scope === 'document' || term.scope === 'global') &&
    nonEmptyString(term.source, 120) &&
    nonEmptyString(term.appliedTarget, 120) &&
    (term.previousTarget === undefined || nonEmptyString(term.previousTarget, 120)) &&
    (term.documentTermId === undefined || nonEmptyString(term.documentTermId, 256)),
  );
}

function validDocumentConfirmedTerm(value: unknown): boolean {
  const term = record(value);
  return Boolean(
    term &&
    validTerm(term) &&
    nonEmptyString(term.id, 256) &&
    typeof term.createdAt === 'number' && Number.isFinite(term.createdAt) &&
    typeof term.updatedAt === 'number' && Number.isFinite(term.updatedAt),
  );
}

function validDocumentTermCandidate(value: unknown): boolean {
  const term = record(value);
  return Boolean(
    term &&
    validTerm(term) &&
    nonEmptyString(term.id, 256) &&
    typeof term.createdAt === 'number' && Number.isFinite(term.createdAt),
  );
}

function validDocumentTermChangeReceipt(value: unknown): boolean {
  const change = record(value);
  return Boolean(
    change &&
    nonEmptyString(change.sourceKey, 120) &&
    (change.applied === undefined || validDocumentConfirmedTerm(change.applied)) &&
    (change.previous === undefined || validDocumentConfirmedTerm(change.previous)) &&
    Array.isArray(change.removedCandidates) &&
    change.removedCandidates.length <= 20 &&
    change.removedCandidates.every(validDocumentTermCandidate) &&
    Array.isArray(change.introducedCandidates) &&
    change.introducedCandidates.length <= 20 &&
    change.introducedCandidates.every(validDocumentTermCandidate),
  );
}

function validSegmentCorrectionReceipt(value: unknown): boolean {
  const change = record(value);
  return Boolean(
    change &&
    nonEmptyString(change.segmentId, 256) &&
    nonEmptyString(change.previousTranslatedText, MAX_SELECTION_LENGTH * 4) &&
    nonEmptyString(change.correctedTranslatedText, MAX_SELECTION_LENGTH * 4) &&
    change.previousTranslatedText !== change.correctedTranslatedText,
  );
}

/** Runtime/storage guard for the short-lived manual-correction undo receipt. */
export function isTranslationCorrectionReceipt(
  value: unknown,
): value is TranslationCorrectionReceipt {
  const receipt = record(value);
  const termChange = receipt?.termChange;
  return Boolean(
    receipt &&
    nonEmptyString(receipt.baseRequestId, 256) &&
    nonEmptyString(receipt.correctedRequestId, 256) &&
    receipt.baseRequestId !== receipt.correctedRequestId &&
    validTranslationMemoryScope(receipt.scope) &&
    nonEmptyString(receipt.previousTranslation, MAX_SELECTION_LENGTH * 4) &&
    nonEmptyString(receipt.correctedTranslation, MAX_SELECTION_LENGTH * 4) &&
    receipt.previousTranslation !== receipt.correctedTranslation &&
    (termChange === undefined || validCorrectionTermReceipt(termChange)) &&
    (receipt.documentTermChange === undefined || (
      receipt.scope === 'document' &&
      termChange !== undefined &&
      record(termChange)?.scope === 'document' &&
      validDocumentTermChangeReceipt(receipt.documentTermChange)
    )) &&
    (receipt.segmentChange === undefined || validSegmentCorrectionReceipt(receipt.segmentChange)),
  );
}

function validCorrectionResult(value: unknown): value is TranslateResult {
  const result = record(value);
  return Boolean(
    result &&
    nonEmptyString(result.requestId, 256) &&
    nonEmptyString(result.originalText, MAX_SELECTION_LENGTH) &&
    nonEmptyString(result.translatedText, MAX_SELECTION_LENGTH * 4) &&
    Array.isArray(result.warnings),
  );
}

function validUpdateTranslationPayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    nonEmptyString(payload.pageUrl, 16_384) &&
    validCorrectionResult(payload.result) &&
    (payload.rememberForDocument === undefined || typeof payload.rememberForDocument === 'boolean') &&
    (payload.scope === undefined || validTranslationMemoryScope(payload.scope)) &&
    nonEmptyString(payload.previousTranslatedText, MAX_SELECTION_LENGTH * 4) &&
    nonEmptyString(payload.baseRequestId, 256) &&
    (payload.term === undefined || validCorrectionTermInput(payload.term)),
  );
}

function validUndoTranslationPayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    nonEmptyString(payload.pageUrl, 16_384) &&
    validCorrectionResult(payload.result) &&
    isTranslationCorrectionReceipt(payload.receipt),
  );
}

function validUpdateTranslationSegmentPayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    nonEmptyString(payload.pageUrl, 16_384) &&
    validCorrectionResult(payload.result) &&
    nonEmptyString(payload.segmentId, 256) &&
    nonEmptyString(payload.expectedTranslatedText, MAX_SELECTION_LENGTH * 4) &&
    nonEmptyString(payload.correctedTranslatedText, MAX_SELECTION_LENGTH * 4),
  );
}

function validPdfCorrectionUpdatePayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    Number.isSafeInteger(payload.tabId) &&
    (payload.tabId as number) >= 0 &&
    nonEmptyString(payload.expectedRequestId, 256) &&
    nonEmptyString(payload.expectedResultRequestId, 256) &&
    nonEmptyString(payload.translatedText, MAX_SELECTION_LENGTH * 4) &&
    validTranslationMemoryScope(payload.scope) &&
    (payload.term === undefined || validCorrectionTermInput(payload.term)),
  );
}

function validPdfCorrectionUndoPayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    Number.isSafeInteger(payload.tabId) &&
    (payload.tabId as number) >= 0 &&
    nonEmptyString(payload.expectedRequestId, 256) &&
    nonEmptyString(payload.expectedResultRequestId, 256) &&
    nonEmptyString(payload.expectedCorrectedRequestId, 256),
  );
}

function validPdfSidePanelRequestPayload(value: unknown): boolean {
  const payload = record(value);
  return Boolean(
    payload &&
    Number.isSafeInteger(payload.tabId) &&
    (payload.tabId as number) >= 0 &&
    nonEmptyString(payload.expectedRequestId, 256),
  );
}

function validTabId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validBilingualPageAction(value: unknown): value is BilingualPageAction {
  return value === 'confirm-start' ||
    value === 'adjust-scope' ||
    value === 'pause' ||
    value === 'resume' ||
    value === 'stop' ||
    value === 'clear' ||
    value === 'enable-retention' ||
    value === 'disable-retention' ||
    value === 'toggle-translations' ||
    value === 'display-bilingual' ||
    value === 'display-translation' ||
    value === 'display-source';
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(value).every((key) => allowlist.has(key));
}

function validPerformanceDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_800_000;
}

function validLocalRenderPerformancePayload(value: unknown): boolean {
  const payload = record(value);
  const timings = record(payload?.timings);
  return Boolean(
    payload &&
    timings &&
    hasOnlyKeys(payload, ['operation', 'timings', 'errorCode']) &&
    hasOnlyKeys(timings, ['totalMs', 'textRenderMs', 'mathRenderMs']) &&
    payload.operation === 'render-result' &&
    validPerformanceDuration(timings.totalMs) &&
    validPerformanceDuration(timings.textRenderMs) &&
    validPerformanceDuration(timings.mathRenderMs) &&
    (payload.errorCode === undefined || payload.errorCode === 'INVALID_RESPONSE')
  );
}

function validTranslationProgressStage(value: unknown): value is TranslationProgressStage {
  return value === 'provider' || value === 'validating-latex' || value === 'committing';
}

function validTranslationProgressPayload(value: unknown): boolean {
  const payload = record(value);
  if (!payload || !hasOnlyKeys(payload, [
    'requestId',
    'partialText',
    'completedChunks',
    'totalChunks',
    'progressStage',
    'result',
  ])) return false;
  return Boolean(
    nonEmptyString(payload.requestId, 256) &&
    (payload.partialText === undefined || (
      typeof payload.partialText === 'string' &&
      payload.partialText.length <= MAX_SELECTION_LENGTH * 4
    )) &&
    Number.isSafeInteger(payload.completedChunks) &&
    (payload.completedChunks as number) >= 0 &&
    Number.isSafeInteger(payload.totalChunks) &&
    (payload.totalChunks as number) >= 1 &&
    (payload.completedChunks as number) <= (payload.totalChunks as number) &&
    (payload.progressStage === undefined || validTranslationProgressStage(payload.progressStage)) &&
    (payload.result === undefined || validCorrectionResult(payload.result))
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const message = value as { type: unknown; payload?: unknown };
  const type = message.type;
  if (type === 'START_BILINGUAL_PAGE') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId', 'targetLanguage']) &&
      validTabId(payload.tabId) &&
      isSupportedTargetLanguage(payload.targetLanguage),
    );
  }
  if (type === 'GET_BILINGUAL_PAGE_STATE') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId']) &&
      validTabId(payload.tabId),
    );
  }
  if (type === 'GET_BILINGUAL_PAGE_EXPORT') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId']) &&
      validTabId(payload.tabId),
    );
  }
  if (type === 'CONTROL_BILINGUAL_PAGE') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId', 'action']) &&
      validTabId(payload.tabId) &&
      validBilingualPageAction(payload.action),
    );
  }
  if (type === 'START_BILINGUAL_PAGE_IN_TAB') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['targetLanguage']) &&
      isSupportedTargetLanguage(payload.targetLanguage),
    );
  }
  if (type === 'GET_BILINGUAL_PAGE_STATE_IN_TAB') {
    return message.payload === undefined;
  }
  if (type === 'GET_BILINGUAL_PAGE_EXPORT_IN_TAB') {
    return message.payload === undefined;
  }
  if (type === 'CONTROL_BILINGUAL_PAGE_IN_TAB') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['action']) &&
      validBilingualPageAction(payload.action),
    );
  }
  if (type === 'BILINGUAL_PAGE_STATE_UPDATED') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['state']) &&
      isBilingualPageState(payload.state),
    );
  }
  if (type === 'BILINGUAL_PAGE_TAB_STATE_UPDATED') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId', 'state']) &&
      validTabId(payload.tabId) &&
      isBilingualPageState(payload.state),
    );
  }
  if (
    type === 'GET_BILINGUAL_PAGE_SESSION' ||
    type === 'CLEAR_BILINGUAL_PAGE_SESSION' ||
    type === 'GET_RETAINED_BILINGUAL_PAGE_SESSION' ||
    type === 'CLEAR_RETAINED_BILINGUAL_PAGE_SESSION'
  ) {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['descriptor']) &&
      isBilingualPageSessionDescriptor(payload.descriptor)
    );
  }
  if (
    type === 'SAVE_BILINGUAL_PAGE_SESSION' ||
    type === 'SAVE_RETAINED_BILINGUAL_PAGE_SESSION'
  ) {
    return isBilingualPageSessionUpdate(message.payload);
  }
  if (type === 'GET_CONTINUOUS_TRANSLATION_STATE') {
    if (message.payload === undefined) return true;
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId']) &&
      Number.isSafeInteger(payload.tabId) &&
      (payload.tabId as number) >= 0,
    );
  }
  if (type === 'SET_CONTINUOUS_TRANSLATION_PAUSED') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['paused', 'tabId']) &&
      typeof payload.paused === 'boolean' &&
      (payload.tabId === undefined || (
        Number.isSafeInteger(payload.tabId) && (payload.tabId as number) >= 0
      )),
    );
  }
  if (type === 'CONTINUOUS_TRANSLATION_STATE_UPDATED') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId', 'paused']) &&
      Number.isSafeInteger(payload.tabId) &&
      (payload.tabId as number) >= 0 &&
      typeof payload.paused === 'boolean',
    );
  }
  if (type === 'UPDATE_TRANSLATION_RESULT') {
    return validUpdateTranslationPayload(message.payload);
  }
  if (type === 'UNDO_TRANSLATION_RESULT') {
    return validUndoTranslationPayload(message.payload);
  }
  if (type === 'UPDATE_TRANSLATION_SEGMENT') {
    return validUpdateTranslationSegmentPayload(message.payload);
  }
  if (type === 'UPDATE_PDF_SIDE_PANEL_TRANSLATION_RESULT') {
    return validPdfCorrectionUpdatePayload(message.payload);
  }
  if (type === 'UNDO_PDF_SIDE_PANEL_TRANSLATION_RESULT') {
    return validPdfCorrectionUndoPayload(message.payload);
  }
  if (type === 'CANCEL_PDF_SIDE_PANEL_TRANSLATION') {
    return validPdfSidePanelRequestPayload(message.payload);
  }
  if (type === 'RETRANSLATE_SIDE_PANEL_TRANSLATION') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['tabId', 'expectedRequestId', 'targetLanguage']) &&
      Number.isSafeInteger(payload.tabId) &&
      (payload.tabId as number) >= 0 &&
      nonEmptyString(payload.expectedRequestId, 256) &&
      isSupportedTargetLanguage(payload.targetLanguage),
    );
  }
  if (type === 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, ['expectedRequestId', 'targetLanguage', 'result']) &&
      nonEmptyString(payload.expectedRequestId, 256) &&
      isSupportedTargetLanguage(payload.targetLanguage) &&
      (payload.result === undefined || validCorrectionResult(payload.result)),
    );
  }
  if (type === 'RECORD_LOCAL_PERFORMANCE') {
    return validLocalRenderPerformancePayload(message.payload);
  }
  if (type === 'TRANSLATION_PROGRESS') {
    return validTranslationProgressPayload(message.payload);
  }
  if (type === 'TRANSLATE_DOCUMENT_BATCH') {
    const payload = record(message.payload);
    return Boolean(
      payload &&
      hasOnlyKeys(payload, [
        'requestId',
        'items',
        'documentId',
        'pageUrl',
        'sourceLabel',
        'targetLanguage',
        'sourceLanguage',
        'style',
        'contentMode',
        'contextText',
        'bypassCache',
      ]) &&
      nonEmptyString(payload.requestId, 256) &&
      validTranslationBatchItems(payload.items) &&
      nonEmptyString(payload.pageUrl, 8_192) &&
      nonEmptyString(payload.targetLanguage, 64) &&
      nonEmptyString(payload.sourceLanguage, 64) &&
      ['academic', 'general', 'literal'].includes(String(payload.style)) &&
      ['auto', 'plain', 'latex'].includes(String(payload.contentMode)) &&
      (payload.documentId === undefined || nonEmptyString(payload.documentId, 512)) &&
      (payload.sourceLabel === undefined || nonEmptyString(payload.sourceLabel, 512)) &&
      (payload.contextText === undefined || (
        typeof payload.contextText === 'string' && payload.contextText.length <= 4_000
      )) &&
      (payload.bypassCache === undefined || typeof payload.bypassCache === 'boolean')
    );
  }
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'TRANSLATE_SELECTION_IN_BROWSER_SIDEBAR' ||
    type === 'TRANSLATE_BILINGUAL_PAGE_SEGMENT' ||
    type === 'TRANSLATE_IMAGE_REGION' ||
    type === 'RECOGNIZE_PDF_PAGE' ||
    type === 'CAPTURE_VISIBLE_TAB' ||
    type === 'CANCEL_TRANSLATION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'START_WEB_REGION_SELECTION' ||
    type === 'PREPARE_WEB_CAPTURE_PERMISSION' ||
    type === 'GET_CURRENT_WEB_CAPTURE_PERMISSION_PROMPT' ||
    type === 'CLEAR_WEB_CAPTURE_PERMISSION_PROMPT' ||
    type === 'OPEN_WEB_CAPTURE_PERMISSION_PANEL' ||
    type === 'GET_WEB_CAPTURE_PERMISSION_PROMPT' ||
    type === 'WEB_CAPTURE_PERMISSION_PANEL_OPENED' ||
    type === 'OPEN_OPTIONS_PAGE' ||
    type === 'GET_SETTINGS_RECOVERY' ||
    type === 'COMPLETE_SETTINGS_RECOVERY' ||
    type === 'SETTINGS_RECOVERY_READY' ||
    type === 'GET_ACTIVE_PDF_SOURCE' ||
    type === 'OPEN_PDF_VIEWER' ||
    type === 'GET_PDF_SIDE_PANEL_SESSION' ||
    type === 'RETRY_PDF_SIDE_PANEL_TRANSLATION' ||
    type === 'RETRANSLATE_SIDE_PANEL_TRANSLATION' ||
    type === 'RETRANSLATE_WEB_SIDE_PANEL_TRANSLATION' ||
    type === 'PDF_SIDE_PANEL_SESSION_UPDATED' ||
    type === 'OPEN_SIDEBAR' ||
    type === 'OPEN_BROWSER_SIDEBAR' ||
    type === 'USE_FLOATING_SIDEBAR' ||
    type === 'BROWSER_SIDEBAR_ACTIVE' ||
    type === 'BROWSER_SIDEBAR_CLOSED' ||
    type === 'GET_CONTINUOUS_TRANSLATION_STATE' ||
    type === 'SET_CONTINUOUS_TRANSLATION_PAUSED' ||
    type === 'CONTINUOUS_TRANSLATION_STATE_UPDATED' ||
    type === 'GET_SIDEBAR_OBSTRUCTION_HINT' ||
    type === 'DISMISS_SIDEBAR_OBSTRUCTION_HINT' ||
    type === 'SET_SIDEBAR_WIDTH' ||
    type === 'PAUSE_CURRENT_SITE' ||
    type === 'GET_DOCUMENT_MEMORY' ||
    type === 'CONFIRM_DOCUMENT_TERM' ||
    type === 'UPSERT_DOCUMENT_TERM' ||
    type === 'REMOVE_DOCUMENT_TERM' ||
    type === 'DISMISS_DOCUMENT_TERM_CANDIDATE' ||
    type === 'RESOLVE_DOCUMENT_REVIEW' ||
    type === 'CLEAR_DOCUMENT_MEMORY' ||
    type === 'RENDER_LATEX_MATHML' ||
    type === 'RENDER_LATEX_MATHML_BATCH' ||
    type === 'CONTEXT_MENU_TRANSLATE' ||
    type === 'GET_PUBLIC_SETTINGS' ||
    type === 'PUBLIC_SETTINGS_UPDATED' ||
    type === 'TEST_API_CONNECTION' ||
    type === 'TEST_VISION_CAPABILITY' ||
    type === 'LIST_API_MODELS' ||
    type === 'DIAGNOSE_API' ||
    type === 'RECORD_LOCAL_PERFORMANCE' ||
    type === 'GET_LOCAL_DIAGNOSTIC_REPORT'
  );
}
