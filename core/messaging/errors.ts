export type TranslationErrorCode =
  | 'EMPTY_SELECTION'
  | 'SELECTION_TOO_LONG'
  | 'NO_API_KEY'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'INVALID_RESPONSE'
  | 'LATEX_VALIDATION_FAILED'
  | 'UNSUPPORTED_PAGE'
  | 'REQUEST_ABORTED'
  | 'UNKNOWN_ERROR';

export class TranslationError extends Error {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
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
      'Unable to connect to DeepSeek. Check your network connection.',
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
