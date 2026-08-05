import type { SelectionSnapshot } from '../selection/types';
import type { ContextMode, GeneralPageMode, HistoryLimit, SidebarSide } from '../settings/schema';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import type {
  TranslateRequest,
  TranslateImageRegionRequest,
  TranslateResult,
  TranslationHistoryEntry,
} from '../translation/types';
import type { TranslationErrorCode } from './errors';
import type { DocumentMemorySnapshot } from '../document/document-memory-repository';
import type { PdfSourceLocation } from '../translation/types';
import type {
  CoordinateOcrPage,
  RecognizePdfPageRequest,
} from '../pdf/ocr-text-layer';

export interface DocumentMemoryLocator {
  pageUrl: string;
  sourceLabel?: string;
  sourceLocation?: PdfSourceLocation;
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
  result?: TranslateResult;
  error?: {
    code: TranslationErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type RuntimeMessage =
  | { type: 'TRANSLATE_SELECTION'; payload: TranslateRequest }
  | { type: 'TRANSLATE_IMAGE_REGION'; payload: TranslateImageRegionRequest }
  | { type: 'RECOGNIZE_PDF_PAGE'; payload: RecognizePdfPageRequest }
  | { type: 'CAPTURE_VISIBLE_TAB' }
  | { type: 'CANCEL_TRANSLATION'; payload: { requestId: string } }
  | { type: 'TRIGGER_TRANSLATE' }
  | { type: 'OPEN_OPTIONS_PAGE' }
  | { type: 'GET_ACTIVE_PDF_SOURCE' }
  | { type: 'OPEN_PDF_VIEWER'; payload?: { url?: string; page?: number } }
  | { type: 'GET_PDF_SIDE_PANEL_SESSION'; payload: { tabId: number } }
  | { type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION'; payload: { tabId: number } }
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
  | { type: 'CLEAR_DOCUMENT_MEMORY'; payload: DocumentMemoryLocator }
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
export type ActivePdfSourceResponse = RuntimeResponse<{
  detected: boolean;
  sourceUrl?: string;
}>;
export type LatexMathMlResponse = RuntimeResponse<{ html?: string }>;
export type LatexMathMlBatchResponse = RuntimeResponse<{ html: Array<string | null> }>;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const type = (value as { type: unknown }).type;
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'TRANSLATE_IMAGE_REGION' ||
    type === 'RECOGNIZE_PDF_PAGE' ||
    type === 'CAPTURE_VISIBLE_TAB' ||
    type === 'CANCEL_TRANSLATION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'OPEN_OPTIONS_PAGE' ||
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
