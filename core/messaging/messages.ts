import type { SelectionSnapshot } from '../selection/types';
import type { GeneralPageMode } from '../settings/schema';
import type {
  TranslationContentMode,
  TranslationStyle,
} from '../translation/types';
import type { TranslateRequest, TranslateResult } from '../translation/types';
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
}

export type RuntimeMessage =
  | { type: 'TRANSLATE_SELECTION'; payload: TranslateRequest }
  | { type: 'CANCEL_TRANSLATION'; payload: { requestId: string } }
  | { type: 'TRIGGER_TRANSLATE' }
  | { type: 'CONTEXT_MENU_TRANSLATE'; payload: SelectionSnapshot }
  | { type: 'GET_PUBLIC_SETTINGS' }
  | { type: 'PUBLIC_SETTINGS_UPDATED'; payload: PublicSettings }
  | {
      type: 'TEST_DEEPSEEK_CONNECTION';
      payload: { apiKey?: string; model: string };
    }
  | {
      type: 'LIST_DEEPSEEK_MODELS';
      payload: { apiKey?: string };
    };

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

export type TranslateRuntimeResponse = RuntimeResponse<TranslateResult>;
export type ConnectionTestResponse = RuntimeResponse<{ connected: true }>;
export type ModelListResponse = RuntimeResponse<{ models: string[] }>;
export type PublicSettingsResponse = RuntimeResponse<PublicSettings>;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const type = (value as { type: unknown }).type;
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'CANCEL_TRANSLATION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'CONTEXT_MENU_TRANSLATE' ||
    type === 'GET_PUBLIC_SETTINGS' ||
    type === 'PUBLIC_SETTINGS_UPDATED' ||
    type === 'TEST_DEEPSEEK_CONNECTION' ||
    type === 'LIST_DEEPSEEK_MODELS'
  );
}
