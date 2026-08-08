import { MAX_SELECTION_LENGTH, type SelectionSnapshot } from '../selection/types';
import type { ContextMode, GeneralPageMode, HistoryLimit, SidebarSide } from '../settings/schema';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import type {
  GlossaryEntry,
  TranslateRequest,
  TranslateImageRegionRequest,
  TranslateResult,
  TranslationCorrectionReceipt,
  TranslationCorrectionTermInput,
  TranslationHistoryEntry,
  TranslationMemoryScope,
  TranslationRevisionScope,
} from '../translation/types';
import type { TranslationErrorCode } from './errors';
import type { SettingsFocus, TranslationProviderRole } from './user-facing-error';
import type { DocumentMemorySnapshot } from '../document/document-memory-repository';
import type { PdfSourceLocation } from '../translation/types';
import type {
  CoordinateOcrPage,
  RecognizePdfPageRequest,
} from '../pdf/ocr-text-layer';

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

export interface PdfSidePanelSession {
  tabId: number;
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
  | { type: 'TRANSLATE_IMAGE_REGION'; payload: TranslateImageRegionRequest }
  | { type: 'RECOGNIZE_PDF_PAGE'; payload: RecognizePdfPageRequest }
  | { type: 'CAPTURE_VISIBLE_TAB' }
  | { type: 'CANCEL_TRANSLATION'; payload: { requestId: string } }
  | { type: 'TRIGGER_TRANSLATE' }
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
  | { type: 'PDF_SIDE_PANEL_SESSION_UPDATED'; payload: PdfSidePanelSession }
  | { type: 'OPEN_SIDEBAR' }
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
        previousTranslatedText?: string;
        baseRequestId?: string;
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
export type RecognizePdfPageResponse = RuntimeResponse<{ page: CoordinateOcrPage }>;
export type ConnectionTestResponse = RuntimeResponse<{ connected: true }>;
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
    (payload.previousTranslatedText === undefined ||
      nonEmptyString(payload.previousTranslatedText, MAX_SELECTION_LENGTH * 4)) &&
    (payload.baseRequestId === undefined || nonEmptyString(payload.baseRequestId, 256)) &&
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

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const message = value as { type: unknown; payload?: unknown };
  const type = message.type;
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
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'TRANSLATE_IMAGE_REGION' ||
    type === 'RECOGNIZE_PDF_PAGE' ||
    type === 'CAPTURE_VISIBLE_TAB' ||
    type === 'CANCEL_TRANSLATION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'OPEN_OPTIONS_PAGE' ||
    type === 'GET_SETTINGS_RECOVERY' ||
    type === 'COMPLETE_SETTINGS_RECOVERY' ||
    type === 'SETTINGS_RECOVERY_READY' ||
    type === 'GET_ACTIVE_PDF_SOURCE' ||
    type === 'OPEN_PDF_VIEWER' ||
    type === 'GET_PDF_SIDE_PANEL_SESSION' ||
    type === 'RETRY_PDF_SIDE_PANEL_TRANSLATION' ||
    type === 'PDF_SIDE_PANEL_SESSION_UPDATED' ||
    type === 'OPEN_SIDEBAR' ||
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
    type === 'TRANSLATION_PROGRESS' ||
    type === 'CONTEXT_MENU_TRANSLATE' ||
    type === 'GET_PUBLIC_SETTINGS' ||
    type === 'PUBLIC_SETTINGS_UPDATED' ||
    type === 'TEST_API_CONNECTION' ||
    type === 'TEST_VISION_CAPABILITY' ||
    type === 'LIST_API_MODELS' ||
    type === 'DIAGNOSE_API' ||
    type === 'GET_LOCAL_DIAGNOSTIC_REPORT'
  );
}
