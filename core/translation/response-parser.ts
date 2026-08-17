import { TranslationError } from '../messaging/errors';
import type { ProviderTranslationResult } from './types';
import { sanitizeLexicalLookup } from './lexical-lookup';

interface CompatibleApiEnvelope {
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

export function parseCompatibleApiEnvelope(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new TranslationError('INVALID_RESPONSE', 'The API returned an invalid response.');
  }
  const envelope = value as CompatibleApiEnvelope;
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new TranslationError('EMPTY_RESPONSE', 'The API returned an empty response.', true);
  }
  return content;
}

export function parseStructuredTranslation(content: string): ProviderTranslationResult {
  let parsed: unknown;
  const normalized = stripCodeFence(content);
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
      } catch {
        parsed = undefined;
      }
    }
    if (!parsed && normalized.trim()) {
      return {
        translatedText: normalized.trim(),
        warnings: [],
        structuredResponse: false,
      };
    }
    throw new TranslationError(
      'INVALID_RESPONSE',
      'The API returned malformed translation content.',
      true,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TranslationError('INVALID_RESPONSE', 'The API returned an invalid translation.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.translation !== 'string' || !record.translation.trim()) {
    throw new TranslationError('EMPTY_RESPONSE', 'The API returned an empty translation.', true);
  }

  const detectedLanguage =
    typeof record.detectedLanguage === 'string' ? record.detectedLanguage : undefined;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((item): item is string => typeof item === 'string')
    : [];
  const alignedSegments = Array.isArray(record.segments)
    ? record.segments.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const segment = item as Record<string, unknown>;
        if (typeof segment.id !== 'string' || typeof segment.translation !== 'string') {
          return [];
        }
        return [{ id: segment.id, translatedText: segment.translation }];
      })
    : undefined;
  const termCandidates = Array.isArray(record.termCandidates)
    ? record.termCandidates.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const term = item as Record<string, unknown>;
        if (typeof term.source !== 'string' || typeof term.target !== 'string') return [];
        const source = term.source.trim().replace(/\s+/gu, ' ').slice(0, 120);
        const target = term.target.trim().replace(/\s+/gu, ' ').slice(0, 120);
        if (!source || !target || source.toLocaleLowerCase() === target.toLocaleLowerCase()) {
          return [];
        }
        return [{ source, target }];
      }).slice(0, 3)
    : undefined;
  const lexicalLookup = sanitizeLexicalLookup(record.lookup);

  return {
    translatedText: record.translation,
    ...(detectedLanguage ? { detectedLanguage } : {}),
    warnings,
    structuredResponse: true,
    ...(alignedSegments?.length ? { alignedSegments } : {}),
    ...(termCandidates?.length ? { termCandidates } : {}),
    ...(lexicalLookup ? { lexicalLookup } : {}),
  };
}

// Kept for source compatibility with v0.4 tests and downstream imports.
export const parseDeepSeekEnvelope = parseCompatibleApiEnvelope;
