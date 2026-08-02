import { TranslationError } from '../messaging/errors';
import type { ProviderImageTranslationResult } from './types';

export const MAX_IMAGE_TRANSLATION_TEXT_LENGTH = 32_000;
const MAX_UNCERTAIN_SPAN_LENGTH = 512;
const MAX_FORMULA_LATEX_LENGTH = 2_048;
const DATA_IMAGE_MARKER = /data:image\/(?:png|jpe?g|webp);base64,/i;
const BASE64_RUN = /[A-Za-z0-9+/=]{128,}/g;

export interface ImageOutputSafetyContext {
  readonly imagePayload?: string;
}

const checkedNonMatchingBase64Prefixes = new WeakMap<
  ImageOutputSafetyContext,
  Set<string>
>();

function imagePayload(imageDataUrl: string | undefined): string | undefined {
  if (!imageDataUrl) return undefined;
  const comma = imageDataUrl.indexOf(',');
  if (comma < 0) return undefined;
  const payload = imageDataUrl.slice(comma + 1).replace(/\s+/g, '');
  return payload || undefined;
}

export function createImageOutputSafetyContext(
  imageDataUrl?: string,
): ImageOutputSafetyContext {
  const payload = imagePayload(imageDataUrl);
  const context: ImageOutputSafetyContext = payload ? { imagePayload: payload } : {};
  checkedNonMatchingBase64Prefixes.set(context, new Set());
  return context;
}

type ImageOutputSafetyInput = string | ImageOutputSafetyContext | undefined;

function safetyPayload(input: ImageOutputSafetyInput): string | undefined {
  return typeof input === 'string' ? imagePayload(input) : input?.imagePayload;
}

export function assertSafeImageTranslationText(
  text: string,
  imageInput?: ImageOutputSafetyInput,
  maxLength = MAX_IMAGE_TRANSLATION_TEXT_LENGTH,
): void {
  if (text.length > maxLength) {
    throw new TranslationError(
      'INVALID_RESPONSE',
      'The vision API returned an unexpectedly large text field.',
    );
  }
  if (DATA_IMAGE_MARKER.test(text)) {
    throw new TranslationError(
      'INVALID_RESPONSE',
      'The vision API echoed image data instead of translation text.',
    );
  }

  const payload = safetyPayload(imageInput);
  if (!payload) return;
  if (payload.length < 128) {
    if (payload.length >= 8 && text.includes(payload)) {
      throw new TranslationError(
        'INVALID_RESPONSE',
        'The vision API echoed bytes from the selected image.',
      );
    }
    return;
  }
  for (const match of text.matchAll(BASE64_RUN)) {
    const candidate = match[0].replace(/=+$/, '');
    if (candidate.length < 128) continue;
    // Streaming callbacks receive the entire accumulated field on every
    // delta. Once the first 128 characters of a run are known not to occur in
    // this immutable image payload, no extension of that run can occur there
    // either. Cache that negative lookup to avoid rescanning a multi-megabyte
    // payload for every following token.
    const prefix = candidate.slice(0, 128);
    const checkedPrefixes = typeof imageInput === 'object' && imageInput
      ? checkedNonMatchingBase64Prefixes.get(imageInput)
      : undefined;
    if (checkedPrefixes?.has(prefix)) continue;
    if (payload.includes(prefix)) {
      throw new TranslationError(
        'INVALID_RESPONSE',
        'The vision API echoed bytes from the selected image.',
      );
    }
    checkedPrefixes?.add(prefix);
  }
}

export function assertSafeImageTranslationResult(
  result: ProviderImageTranslationResult,
  imageInput?: ImageOutputSafetyInput,
): void {
  assertSafeImageTranslationText(result.recognizedText, imageInput);
  assertSafeImageTranslationText(result.translatedText, imageInput);
  for (const span of result.uncertainSpans) {
    assertSafeImageTranslationText(span, imageInput, MAX_UNCERTAIN_SPAN_LENGTH);
  }
  for (const formula of result.formulaLatex) {
    assertSafeImageTranslationText(formula, imageInput, MAX_FORMULA_LATEX_LENGTH);
  }
}

export function assertSafeFavoriteText(result: {
  originalText: string;
  translatedText: string;
}): void {
  assertSafeImageTranslationText(result.originalText);
  assertSafeImageTranslationText(result.translatedText);
}
