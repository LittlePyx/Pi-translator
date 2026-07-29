import { TranslationError, toTranslationError } from '../messaging/errors';
import { apiEndpoint } from '../settings/api-access';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder';
import { parseCompatibleApiEnvelope, parseStructuredTranslation } from './response-parser';
import {
  assertSafeImageTranslationResult,
  assertSafeImageTranslationText,
} from './image-output-safety';
import type {
  PreparedTranslationInput,
  ImageTranslationInput,
  ImageTranslationOptions,
  ProviderImageTranslationResult,
  ProviderCredentials,
  ProviderTranslationResult,
  TranslationCallbacks,
  TranslationOptions,
  Translator,
} from './types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 650;
// A tiny 16 x 16 locally bundled PNG. It is sent only when the user presses
// “test vision capability” and contains no user or document data.
export const VISION_CAPABILITY_TEST_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJElEQVR42mP4jwMwMDCgYJzqRg2gggHoCsnAQ96A0XQwCAwAALi5rW+TlQcjAAAAAElFTkSuQmCC';

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

export function mapHttpError(
  status: number,
  retryAfter: string | null,
  providerMessage?: string,
): TranslationError {
  if (
    (status === 400 || status === 402 || status === 403) &&
    /arrear|insufficient.{0,24}(?:balance|credit)|billing.{0,24}(?:balance|credit|overdue|payment required)|account.{0,24}(?:overdue|in arrears)|余额|欠费/i.test(
      providerMessage ?? '',
    )
  ) {
    return new TranslationError(
      'PAYMENT_REQUIRED',
      providerMessage ?? 'The API account has insufficient credit.',
      false,
      undefined,
      undefined,
      status,
    );
  }
  if (
    (status === 400 || status === 422) &&
    /image.{0,20}(?:too large|max(?:imum)? bytes|length|width|height|ratio|decode|format)|data-uri|base64/i.test(providerMessage ?? '')
  ) {
    return new TranslationError(
      'IMAGE_REGION_INVALID',
      providerMessage ?? 'The selected image does not meet the provider requirements.',
      false,
      undefined,
      undefined,
      status,
    );
  }
  if (
    (status === 400 || status === 422) &&
    /does not support.{0,40}(?:image|vision|multimodal)|(?:image_url|vision|multimodal).{0,40}(?:unsupported|not support|invalid)|not an? (?:vision|multimodal) model/i.test(providerMessage ?? '')
  ) {
    return new TranslationError(
      'VISION_MODEL_UNSUPPORTED',
      providerMessage ?? 'The configured model does not support image input.',
      false,
      undefined,
      undefined,
      status,
    );
  }
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

export async function requestWithRetry<T>(
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

export async function fetchJson(
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

export async function streamedChatContent(
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
  async testVisionCapability(
    options: Pick<ImageTranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void> {
    const qwenEndpoint = /(?:dashscope|maas\.aliyuncs\.com)/i.test(credentials.apiBaseUrl);
    const envelope = await fetchJson(
      apiEndpoint(credentials.apiBaseUrl, 'chat/completions'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: VISION_CAPABILITY_TEST_IMAGE_DATA_URL },
              },
              {
                type: 'text',
                text: 'This is a low-cost image-input capability check. Reply only with OK.',
              },
            ],
          }],
          temperature: 0,
          max_tokens: 8,
          stream: false,
          ...(qwenEndpoint ? { enable_thinking: false } : {}),
        }),
      },
      signal,
    );
    if (!parseCompatibleApiEnvelope(envelope).trim()) {
      throw new TranslationError('EMPTY_RESPONSE', 'The vision API returned an empty response.', true);
    }
  }

  async translateImageRegion(
    input: ImageTranslationInput,
    options: ImageTranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
    callbacks?: TranslationCallbacks,
  ): Promise<ProviderImageTranslationResult> {
    const url = apiEndpoint(credentials.apiBaseUrl, 'chat/completions');
    const qwenEndpoint = /(?:dashscope|maas\.aliyuncs\.com)/i.test(credentials.apiBaseUrl);
    const prompt = [
      `识别框选图片中的原文，并翻译为${options.targetLanguage}。`,
      options.sourceLanguage === 'auto'
        ? '自动判断原文语言。'
        : `原文语言应为 ${options.sourceLanguage}。`,
      options.style === 'academic'
        ? '使用准确、简洁的学术表达，保持术语一致。'
        : options.style === 'literal'
          ? '尽量逐字忠实翻译，不擅自改写。'
          : '使用自然、清晰的通用表达。',
      '公式、变量、单位和 LaTeX 片段必须原样保留。',
      '模糊或无法确认的字符不得猜测，请在对应位置写成 [无法辨认]。',
      '只返回 JSON 对象，字段顺序固定为：{"translation":"译文","recognizedText":"识别出的原文","uncertainSpans":["无法确认的片段"]}。',
    ].join('\n');
    const body = (stream: boolean) => JSON.stringify({
      model: options.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: input.imageDataUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 4096,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(qwenEndpoint ? { enable_thinking: false } : {}),
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
    let content: string;
    if (callbacks?.onPartialText) {
      try {
        content = await requestWithRetry(
          url,
          request(true),
          signal,
          (response) => streamedChatContent(response, (partialText) => {
            assertSafeImageTranslationText(partialText, input.imageDataUrl);
            callbacks.onPartialText!(partialText);
          }),
        );
        const result = parseImageTranslation(content);
        assertSafeImageTranslationResult(result, input.imageDataUrl);
        return result;
      } catch (error) {
        const normalized = toTranslationError(error);
        if (signal.aborted || ![400, 404, 405, 415, 422].includes(normalized.httpStatus ?? 0)) {
          throw normalized;
        }
        if (
          normalized.code === 'VISION_MODEL_UNSUPPORTED' ||
          normalized.code === 'IMAGE_REGION_INVALID' ||
          normalized.code === 'MODEL_NOT_FOUND'
        ) {
          throw normalized;
        }
      }
    }
    const envelope = await fetchJson(url, request(false), signal);
    const result = parseImageTranslation(parseCompatibleApiEnvelope(envelope));
    assertSafeImageTranslationResult(result, input.imageDataUrl);
    return result;
  }

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
        { role: 'system', content: buildSystemPrompt(options, input) },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      temperature: input.placeholderTokens.length ? 0 : 0.2,
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

export function parseImageTranslation(content: string): ProviderImageTranslationResult {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch (error) {
    throw new TranslationError('INVALID_RESPONSE', 'The vision API returned invalid JSON.', true, {
      cause: error,
    });
  }
  if (!value || typeof value !== 'object') {
    throw new TranslationError('INVALID_RESPONSE', 'The vision API returned an invalid object.', true);
  }
  const record = value as Record<string, unknown>;
  const translatedText = typeof record.translation === 'string' ? record.translation.trim() : '';
  const recognizedText = typeof record.recognizedText === 'string' ? record.recognizedText.trim() : '';
  if (!translatedText || !recognizedText) {
    throw new TranslationError(
      'INVALID_RESPONSE',
      'The vision API response is missing translation or recognizedText.',
      true,
    );
  }
  const uncertainSpans = Array.isArray(record.uncertainSpans)
    ? record.uncertainSpans
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return { recognizedText, translatedText, uncertainSpans };
}
