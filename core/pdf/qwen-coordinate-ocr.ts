import { TranslationError } from '../messaging/errors';
import { fetchJson } from '../translation/openai-compatible-translator';
import type { ProviderCredentials } from '../translation/types';
import {
  validateCoordinateOcrPage,
  type CoordinateOcrPage,
  type RecognizePdfPageRequest,
} from './ocr-text-layer';

const QWEN_OCR_MODEL = 'qwen3.5-ocr';
// The native advanced-recognition response has no numeric probability. This
// value is a selection-policy marker for a trusted, geometry-bearing OCR
// endpoint, not a probability invented by the model.
const TRUSTED_ADAPTER_CONFIDENCE = 0.9;

function qwenHost(hostname: string): boolean {
  return /^(?:dashscope(?:-intl)?\.aliyuncs\.com|[^.]+\.[^.]+\.maas\.aliyuncs\.com)$/i
    .test(hostname);
}

export function qwenCoordinateOcrEndpoint(apiBaseUrl: string): string | undefined {
  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || !qwenHost(url.hostname)) return undefined;
    const basePath = url.pathname.replace(/\/+$/, '');
    if (!basePath.endsWith('/compatible-mode/v1')) return undefined;
    url.pathname = `${basePath.slice(0, -'/compatible-mode/v1'.length)}/api/v1/services/aigc/multimodal-generation/generation`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function qwenCoordinateOcrModel(configuredModel: string): string {
  return /(?:^|[-_.])qwen(?:3\.5|-vl)?-ocr(?:$|[-_.])/i.test(configuredModel)
    ? configuredModel.trim()
    : QWEN_OCR_MODEL;
}

function qwenWordsInfo(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const output = (value as { output?: unknown }).output;
  if (!output || typeof output !== 'object') return undefined;
  const choices = (output as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== 'object') continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const result = (item as { ocr_result?: unknown }).ocr_result;
      if (!result || typeof result !== 'object') continue;
      const words = (result as { words_info?: unknown }).words_info;
      if (Array.isArray(words)) return words;
    }
  }
  return undefined;
}

export function parseQwenCoordinateOcr(
  value: unknown,
  pageNumber: number,
  imageWidth: number,
  imageHeight: number,
): CoordinateOcrPage {
  const words = qwenWordsInfo(value);
  if (!words?.length) {
    throw new TranslationError(
      'OCR_INVALID_RESPONSE',
      'Qwen OCR did not return the native ocr_result.words_info layout data.',
      true,
    );
  }
  const blocks = words.slice(0, 601).map((item, order) => {
    if (!item || typeof item !== 'object') return undefined;
    const word = item as { text?: unknown; location?: unknown };
    const text = typeof word.text === 'string' ? word.text.trim() : '';
    const location = Array.isArray(word.location) ? word.location : [];
    if (!text || location.length !== 8 || !location.every(
      (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
    )) return undefined;
    const x = [location[0], location[2], location[4], location[6]] as number[];
    const y = [location[1], location[3], location[5], location[7]] as number[];
    const left = Math.min(...x) / imageWidth;
    const top = Math.min(...y) / imageHeight;
    const right = Math.max(...x) / imageWidth;
    const bottom = Math.max(...y) / imageHeight;
    return {
      id: `qwen-line-${order}`,
      order,
      text,
      confidence: TRUSTED_ADAPTER_CONFIDENCE,
      confidenceSource: 'trusted-adapter' as const,
      kind: 'text' as const,
      box: { left, top, width: right - left, height: bottom - top },
    };
  }).filter((block) => block !== undefined);
  const validation = validateCoordinateOcrPage({
    pageNumber,
    coordinateSystem: 'normalized-page',
    source: 'qwen-advanced-recognition',
    blocks,
  });
  if (!validation.ok) {
    throw new TranslationError('OCR_INVALID_RESPONSE', validation.reason, true);
  }
  return validation.page;
}

export async function recognizeQwenPdfPage(
  request: RecognizePdfPageRequest,
  configuredModel: string,
  credentials: ProviderCredentials,
  signal: AbortSignal,
): Promise<CoordinateOcrPage> {
  const endpoint = qwenCoordinateOcrEndpoint(credentials.apiBaseUrl);
  if (!endpoint) {
    throw new TranslationError(
      'OCR_NOT_SUPPORTED',
      'Reliable coordinate OCR currently requires an official Qwen / Model Studio API endpoint.',
    );
  }
  const response = await fetchJson(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: qwenCoordinateOcrModel(configuredModel),
        input: {
          messages: [{
            role: 'user',
            content: [{
              image: request.imageDataUrl,
              min_pixels: 32 * 32 * 3,
              max_pixels: 32 * 32 * 8192,
              enable_rotate: false,
            }],
          }],
        },
        parameters: { ocr_options: { task: 'advanced_recognition' } },
      }),
    },
    signal,
    // OCR generation may be billable. Never replay an ambiguous timeout or
    // connection failure automatically; the user can explicitly retry.
    { maxAttempts: 1, shouldRetry: () => false },
    60_000,
  );
  return parseQwenCoordinateOcr(
    response,
    request.pageNumber,
    request.imageWidth,
    request.imageHeight,
  );
}
