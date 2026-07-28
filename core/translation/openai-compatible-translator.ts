import { TranslationError, toTranslationError } from '../messaging/errors';
import { apiEndpoint } from '../settings/api-access';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder';
import { parseCompatibleApiEnvelope, parseStructuredTranslation } from './response-parser';
import type {
  PreparedTranslationInput,
  ProviderCredentials,
  ProviderTranslationResult,
  TranslationCallbacks,
  TranslationOptions,
  Translator,
} from './types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 650;

interface ModelListResponse {
  data?: Array<{ id?: string }>;
}

function createTimedSignal(parent: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out.', 'TimeoutError')),
    REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abortFromParent);
    },
  };
}

function mapHttpError(
  status: number,
  retryAfter: string | null,
  providerMessage?: string,
): TranslationError {
  if (status === 401 || status === 403) {
    return new TranslationError(
      'AUTH_FAILED',
      providerMessage ? `The API rejected the credentials: ${providerMessage}` : 'The API rejected the credentials.',
      false,
      undefined,
      undefined,
      status,
    );
  }
  if (status === 402) {
    return new TranslationError(
      'PAYMENT_REQUIRED',
      providerMessage
        ? `The API account has insufficient credit: ${providerMessage}`
        : 'The API account has insufficient credit.',
      false,
      undefined,
      undefined,
      status,
    );
  }
  if (
    (status === 400 || status === 404 || status === 422) &&
    /model|deployment|模型/i.test(providerMessage ?? '')
  ) {
    return new TranslationError(
      'MODEL_NOT_FOUND',
      providerMessage ?? 'The configured model is not available.',
      false,
      undefined,
      undefined,
      status,
    );
  }
  if (status === 429) {
    const suffix = retryAfter ? ` Retry after ${retryAfter}.` : '';
    return new TranslationError(
      'RATE_LIMITED',
      `The API rate limit was reached.${suffix}`,
      true,
      undefined,
      parseRetryAfter(retryAfter),
      status,
    );
  }
  return new TranslationError(
    'PROVIDER_ERROR',
    `The API returned HTTP ${status}${providerMessage ? `: ${providerMessage}` : '.'}`,
    status >= 500,
    undefined,
    undefined,
    status,
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(10_000, Math.max(0, date - Date.now())) : undefined;
}

async function providerErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
      const message = parsed.error?.message ?? parsed.message;
      return typeof message === 'string' ? message.slice(0, 240) : text.slice(0, 240);
    } catch {
      return text.replace(/\s+/g, ' ').slice(0, 240);
    }
  } catch {
    return undefined;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('The request was cancelled.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The request was cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  let lastError: TranslationError | undefined;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const timed = createTimedSignal(parentSignal);
    try {
      const response = await fetch(url, { ...init, signal: timed.signal });
      if (!response.ok) {
        throw mapHttpError(
          response.status,
          response.headers.get('Retry-After'),
          await providerErrorMessage(response),
        );
      }
      return await consume(response);
    } catch (error) {
      let normalized: TranslationError;
      if (
        timed.signal.aborted &&
        !parentSignal.aborted &&
        timed.signal.reason instanceof DOMException &&
        timed.signal.reason.name === 'TimeoutError'
      ) {
        normalized = new TranslationError('REQUEST_TIMEOUT', 'The API request timed out.', true);
      } else {
        normalized = toTranslationError(error);
      }
      lastError = normalized;
      if (!normalized.retryable || attempt === MAX_REQUEST_ATTEMPTS - 1) throw normalized;
      const delay = normalized.retryAfterMs ?? RETRY_BASE_DELAY_MS * (2 ** attempt);
      await abortableDelay(delay, parentSignal);
    } finally {
      timed.dispose();
    }
  }
  throw lastError ?? new TranslationError('UNKNOWN_ERROR', 'The API request failed.');
}

async function fetchJson(
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal,
): Promise<unknown> {
  return requestWithRetry(url, init, parentSignal, async (response) => {
    try {
      return await response.json();
    } catch (error) {
      throw new TranslationError('INVALID_RESPONSE', 'The API returned invalid JSON.', true, {
        cause: error,
      });
    }
  });
}

export function extractPartialTranslation(content: string): string | undefined {
  const match = /"translation"\s*:\s*"/.exec(content);
  if (!match) {
    const normalized = content.replace(/^```(?:json)?\s*/i, '').trimStart();
    return normalized && !normalized.startsWith('{') ? normalized : undefined;
  }
  let output = '';
  for (let index = match.index + match[0].length; index < content.length; index += 1) {
    const character = content[index]!;
    if (character === '"') return output;
    if (character !== '\\') {
      output += character;
      continue;
    }
    const escaped = content[index + 1];
    if (escaped === undefined) return output;
    index += 1;
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '/': '/' };
    if (escaped === 'u') {
      const code = content.slice(index + 1, index + 5);
      if (!/^[\da-f]{4}$/i.test(code)) return output;
      output += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else output += simple[escaped] ?? escaped;
  }
  return output || undefined;
}

async function streamedChatContent(
  response: Response,
  onPartialText: (text: string) => void,
): Promise<string> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    return parseCompatibleApiEnvelope(await response.json());
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const event = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
        };
        const delta = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content;
        if (typeof delta === 'string') {
          content += delta;
          const partial = extractPartialTranslation(content);
          if (partial) onPartialText(partial);
        }
      } catch {
        // Ignore provider-specific keep-alive events while retaining valid deltas.
      }
    }
    if (done) break;
  }
  if (!content.trim()) throw new TranslationError('EMPTY_RESPONSE', 'The API returned an empty stream.', true);
  return content;
}

export class OpenAiCompatibleTranslator implements Translator {
  async translate(
    input: PreparedTranslationInput,
    options: TranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
    callbacks?: TranslationCallbacks,
  ): Promise<ProviderTranslationResult> {
    const url = apiEndpoint(credentials.apiBaseUrl, 'chat/completions');
    const body = (stream: boolean) => JSON.stringify({
      model: options.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(options) },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      stream,
    });
    const request = (stream: boolean): RequestInit => ({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
          ...(stream ? { Accept: 'text/event-stream' } : {}),
        },
        body: body(stream),
      });
    if (callbacks?.onPartialText) {
      try {
        return parseStructuredTranslation(
          await requestWithRetry(
            url,
            request(true),
            signal,
            (response) => streamedChatContent(response, callbacks.onPartialText!),
          ),
        );
      } catch (error) {
        const normalized = toTranslationError(error);
        if (signal.aborted || ![400, 404, 405, 415, 422].includes(normalized.httpStatus ?? 0)) {
          throw normalized;
        }
      }
    }
    const envelope = await fetchJson(url, request(false), signal);
    return parseStructuredTranslation(parseCompatibleApiEnvelope(envelope));
  }

  async testConnection(
    options: Pick<TranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void> {
    const ids = await this.listModels(credentials, signal);
    if (ids.length && !ids.includes(options.model)) {
      throw new TranslationError(
        'PROVIDER_ERROR',
        `The configured model ${options.model} is not available for this API Key.`,
      );
    }
  }

  async listModels(credentials: ProviderCredentials, signal: AbortSignal): Promise<string[]> {
    const value = (await fetchJson(
      apiEndpoint(credentials.apiBaseUrl, 'models'),
      { method: 'GET', headers: { Authorization: `Bearer ${credentials.apiKey}` } },
      signal,
    )) as ModelListResponse;
    return [...new Set(
      value.data
        ?.map((model) => model.id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim())) ?? [],
    )].sort();
  }
}
