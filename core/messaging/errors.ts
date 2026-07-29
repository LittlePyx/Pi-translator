export type TranslationErrorCode =
  | 'EMPTY_SELECTION'
  | 'SELECTION_TOO_LONG'
  | 'NO_API_KEY'
  | 'API_PERMISSION_REQUIRED'
  | 'AUTH_FAILED'
  | 'PAYMENT_REQUIRED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'INVALID_RESPONSE'
  | 'LATEX_VALIDATION_FAILED'
  | 'VISION_NOT_CONFIGURED'
  | 'VISION_MODEL_UNSUPPORTED'
  | 'IMAGE_REGION_INVALID'
  | 'UNSUPPORTED_PAGE'
  | 'REQUEST_ABORTED'
  | 'UNKNOWN_ERROR';

export class TranslationError extends Error {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
    public readonly retryAfterMs?: number,
    public readonly httpStatus?: number,
  ) {
    super(message, options);
    this.name = 'TranslationError';
  }
}

export function toTranslationError(error: unknown): TranslationError {
  if (error instanceof TranslationError) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TranslationError('REQUEST_ABORTED', 'The request was cancelled.');
  }

  if (error instanceof TypeError) {
    return new TranslationError(
      'NETWORK_ERROR',
      'Unable to connect to the configured API. Check the endpoint and network connection.',
      true,
      { cause: error },
    );
  }

  return new TranslationError(
    'UNKNOWN_ERROR',
    'An unexpected translation error occurred.',
    false,
    { cause: error },
  );
}
