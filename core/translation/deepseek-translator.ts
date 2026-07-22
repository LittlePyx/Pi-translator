import { TranslationError, toTranslationError } from '../messaging/errors';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder';
import { parseDeepSeekEnvelope, parseStructuredTranslation } from './response-parser';
import type {
  PreparedTranslationInput,
  ProviderCredentials,
  ProviderTranslationResult,
  TranslationOptions,
  Translator,
} from './types';

const API_BASE_URL = 'https://api.deepseek.com';
const REQUEST_TIMEOUT_MS = 30_000;

interface ModelListResponse {
  data?: Array<{ id?: string }>;
}

function createTimedSignal(parent: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) {
    controller.abort(parent.reason);
  } else {
    parent.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request timed out.', 'TimeoutError'));
  }, REQUEST_TIMEOUT_MS);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abortFromParent);
    },
  };
}

function mapHttpError(status: number, retryAfter: string | null): TranslationError {
  if (status === 401 || status === 403) {
    return new TranslationError('AUTH_FAILED', 'DeepSeek rejected the API Key.');
  }
  if (status === 429) {
    const suffix = retryAfter ? ` Retry after ${retryAfter}.` : '';
    return new TranslationError('RATE_LIMITED', `DeepSeek rate limit reached.${suffix}`, true);
  }
  return new TranslationError(
    'PROVIDER_ERROR',
    `DeepSeek returned HTTP ${status}.`,
    status >= 500,
  );
}

async function fetchJson(
  path: string,
  init: RequestInit,
  parentSignal: AbortSignal,
): Promise<unknown> {
  const timed = createTimedSignal(parentSignal);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: timed.signal,
    });
    if (!response.ok) {
      throw mapHttpError(response.status, response.headers.get('Retry-After'));
    }
    return await response.json();
  } catch (error) {
    if (
      timed.signal.aborted &&
      !parentSignal.aborted &&
      timed.signal.reason instanceof DOMException &&
      timed.signal.reason.name === 'TimeoutError'
    ) {
      throw new TranslationError('REQUEST_TIMEOUT', 'DeepSeek request timed out.', true);
    }
    throw toTranslationError(error);
  } finally {
    timed.dispose();
  }
}

export class DeepSeekTranslator implements Translator {
  async translate(
    input: PreparedTranslationInput,
    options: TranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<ProviderTranslationResult> {
    const body = {
      model: options.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(options) },
        { role: 'user', content: buildUserPrompt(input.text) },
      ],
      thinking: { type: 'disabled' },
      temperature: 0.2,
      max_tokens: 4096,
      stream: false,
      response_format: { type: 'json_object' },
    };

    const envelope = await fetchJson(
      '/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      signal,
    );

    return parseStructuredTranslation(parseDeepSeekEnvelope(envelope));
  }

  async testConnection(
    options: Pick<TranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void> {
    const value = (await fetchJson(
      '/models',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      },
      signal,
    )) as ModelListResponse;

    const ids = value.data
      ?.map((model) => model.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids?.length && !ids.includes(options.model)) {
      throw new TranslationError(
        'PROVIDER_ERROR',
        `The configured model ${options.model} is not available for this API Key.`,
      );
    }
  }
}
