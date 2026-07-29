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
  TranslationFavorite,
  TranslationHistoryEntry,
} from '../translation/types';
import type { TranslationErrorCode } from './errors';

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
  historyLimit: HistoryLimit;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
  contextMode: ContextMode;
  enableStreaming: boolean;
  protectSensitiveFields: boolean;
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
  | { type: 'CANCEL_TRANSLATION'; payload: { requestId: string } }
  | { type: 'TRIGGER_TRANSLATE' }
  | { type: 'OPEN_OPTIONS_PAGE' }
  | { type: 'OPEN_PDF_VIEWER'; payload?: { url?: string; page?: number } }
  | { type: 'GET_PDF_SIDE_PANEL_SESSION'; payload: { tabId: number } }
  | { type: 'RETRY_PDF_SIDE_PANEL_TRANSLATION'; payload: { tabId: number } }
  | { type: 'PDF_SIDE_PANEL_SESSION_UPDATED'; payload: PdfSidePanelSession }
  | { type: 'OPEN_SIDEBAR' }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: { width: number } }
  | { type: 'PAUSE_CURRENT_SITE'; payload: { pageUrl: string } }
  | {
      type: 'TRANSLATION_PROGRESS';
      payload: {
        requestId: string;
        partialText?: string;
        completedChunks: number;
        totalChunks: number;
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
  | { type: 'GET_TRANSLATION_HISTORY' }
  | { type: 'CLEAR_TRANSLATION_HISTORY' }
  | { type: 'DELETE_TRANSLATION_HISTORY'; payload: { historyId: string } }
  | {
      type: 'PIN_TRANSLATION_HISTORY';
      payload: { historyId: string; pinned: boolean };
    }
  | { type: 'GET_TRANSLATION_FAVORITES'; payload?: { query?: string } }
  | { type: 'ADD_TRANSLATION_FAVORITE'; payload: { result: TranslateResult } }
  | { type: 'DELETE_TRANSLATION_FAVORITE'; payload: { favoriteId: string } }
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
export type ConnectionTestResponse = RuntimeResponse<{ connected: true }>;
export type VisionCapabilityTestResponse = RuntimeResponse<{
  supported: true;
  latencyMs: number;
}>;
export type ModelListResponse = RuntimeResponse<{ models: string[] }>;
export type ApiDiagnosticResponse = RuntimeResponse<ApiDiagnosticReport>;
export type PublicSettingsResponse = RuntimeResponse<PublicSettings>;
export type TranslationHistoryResponse = RuntimeResponse<{
  history: TranslationHistoryEntry[];
}>;
export type TranslationFavoritesResponse = RuntimeResponse<{
  favorites: TranslationFavorite[];
}>;
export type LocalDiagnosticReportResponse = RuntimeResponse<{ report: string }>;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const type = (value as { type: unknown }).type;
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'TRANSLATE_IMAGE_REGION' ||
    type === 'CANCEL_TRANSLATION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'OPEN_OPTIONS_PAGE' ||
    type === 'OPEN_PDF_VIEWER' ||
    type === 'GET_PDF_SIDE_PANEL_SESSION' ||
    type === 'RETRY_PDF_SIDE_PANEL_TRANSLATION' ||
    type === 'PDF_SIDE_PANEL_SESSION_UPDATED' ||
    type === 'OPEN_SIDEBAR' ||
    type === 'SET_SIDEBAR_WIDTH' ||
    type === 'PAUSE_CURRENT_SITE' ||
    type === 'TRANSLATION_PROGRESS' ||
    type === 'CONTEXT_MENU_TRANSLATE' ||
    type === 'GET_PUBLIC_SETTINGS' ||
    type === 'PUBLIC_SETTINGS_UPDATED' ||
    type === 'TEST_API_CONNECTION' ||
    type === 'TEST_VISION_CAPABILITY' ||
    type === 'LIST_API_MODELS' ||
    type === 'DIAGNOSE_API' ||
    type === 'GET_TRANSLATION_HISTORY' ||
    type === 'CLEAR_TRANSLATION_HISTORY' ||
    type === 'DELETE_TRANSLATION_HISTORY' ||
    type === 'PIN_TRANSLATION_HISTORY' ||
    type === 'GET_TRANSLATION_FAVORITES' ||
    type === 'ADD_TRANSLATION_FAVORITE' ||
    type === 'DELETE_TRANSLATION_FAVORITE' ||
    type === 'GET_LOCAL_DIAGNOSTIC_REPORT'
  );
}
