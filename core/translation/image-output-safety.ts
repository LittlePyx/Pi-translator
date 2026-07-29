import { TranslationError } from '../messaging/errors';
import type { ProviderImageTranslationResult } from './types';

export const MAX_IMAGE_TRANSLATION_TEXT_LENGTH = 32_000;
const MAX_UNCERTAIN_SPAN_LENGTH = 512;
const DATA_IMAGE_MARKER = /data:image\/(?:png|jpe?g|webp);base64,/i;
const BASE64_RUN = /[A-Za-z0-9+/=]{128,}/g;

function imagePayload(imageDataUrl: string | undefined): string | undefined {
  if (!imageDataUrl) return undefined;
  const comma = imageDataUrl.indexOf(',');
  if (comma < 0) return undefined;
  const payload = imageDataUrl.slice(comma + 1).replace(/\s+/g, '');
  return payload || undefined;
}

export function assertSafeImageTranslationText(
  text: string,
  imageDataUrl?: string,
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

  const payload = imagePayload(imageDataUrl);
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
    if (candidate.length >= 128 && payload.includes(candidate)) {
      throw new TranslationError(
        'INVALID_RESPONSE',
        'The vision API echoed bytes from the selected image.',
      );
    }
  }
}

export function assertSafeImageTranslationResult(
  result: ProviderImageTranslationResult,
  imageDataUrl?: string,
): void {
  assertSafeImageTranslationText(result.recognizedText, imageDataUrl);
  assertSafeImageTranslationText(result.translatedText, imageDataUrl);
  for (const span of result.uncertainSpans) {
    assertSafeImageTranslationText(span, imageDataUrl, MAX_UNCERTAIN_SPAN_LENGTH);
  }
}

export function assertSafeFavoriteText(result: {
  originalText: string;
  translatedText: string;
}): void {
  assertSafeImageTranslationText(result.originalText);
  assertSafeImageTranslationText(result.translatedText);
}
