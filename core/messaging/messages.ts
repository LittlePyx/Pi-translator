import type { SelectionSnapshot } from '../selection/types';
import type { TranslationStyle } from '../translation/types';
import type { TranslateRequest, TranslateResult } from '../translation/types';
import type { TranslationErrorCode } from './errors';

export type RuntimeMessage =
  | { type: 'TRANSLATE_SELECTION'; payload: TranslateRequest }
  | { type: 'TRIGGER_TRANSLATE' }
  | { type: 'CONTEXT_MENU_TRANSLATE'; payload: SelectionSnapshot }
  | { type: 'GET_PUBLIC_SETTINGS' }
  | {
      type: 'TEST_DEEPSEEK_CONNECTION';
      payload: { apiKey?: string; model: string };
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
export type PublicSettingsResponse = RuntimeResponse<{
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  showFloatingButtonOnOverleaf: boolean;
}>;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const type = (value as { type: unknown }).type;
  return (
    type === 'TRANSLATE_SELECTION' ||
    type === 'TRIGGER_TRANSLATE' ||
    type === 'CONTEXT_MENU_TRANSLATE' ||
    type === 'GET_PUBLIC_SETTINGS' ||
    type === 'TEST_DEEPSEEK_CONNECTION'
  );
}
