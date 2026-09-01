import { toTranslationError } from '../messaging/errors';
import type { RuntimeResponse } from '../messaging/messages';

export function errorResponse<T = never>(error: unknown): RuntimeResponse<T> {
  const normalized = toTranslationError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    },
  };
}
