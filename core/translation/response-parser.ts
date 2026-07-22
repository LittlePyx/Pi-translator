import { TranslationError } from '../messaging/errors';
import type { ProviderTranslationResult } from './types';

interface DeepSeekEnvelope {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseDeepSeekEnvelope(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new TranslationError('INVALID_RESPONSE', 'DeepSeek returned an invalid response.');
  }
  const envelope = value as DeepSeekEnvelope;
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new TranslationError('EMPTY_RESPONSE', 'DeepSeek returned an empty response.', true);
  }
  return content;
}

export function parseStructuredTranslation(content: string): ProviderTranslationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch (error) {
    throw new TranslationError(
      'INVALID_RESPONSE',
      'DeepSeek returned malformed translation JSON.',
      true,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TranslationError('INVALID_RESPONSE', 'DeepSeek returned an invalid translation.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.translation !== 'string' || !record.translation.trim()) {
    throw new TranslationError('EMPTY_RESPONSE', 'DeepSeek returned an empty translation.', true);
  }

  const detectedLanguage =
    typeof record.detectedLanguage === 'string' ? record.detectedLanguage : undefined;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    translatedText: record.translation,
    ...(detectedLanguage ? { detectedLanguage } : {}),
    warnings,
  };
}
