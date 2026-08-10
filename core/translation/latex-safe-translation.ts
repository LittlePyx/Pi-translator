import { restoreLatex } from '../latex/protector';
import type { ProtectedLatex, RestoredLatex } from '../latex/types';
import { toTranslationError } from '../messaging/errors';
import type {
  PreparedTranslationInput,
  ProviderCredentials,
  ProviderTranslationResult,
  TranslationCallbacks,
  TranslationOptions,
  Translator,
} from './types';

export interface LatexSafeTranslationDiagnostics {
  /** Local placeholder restoration and validation only; never includes source or formula data. */
  latexValidationMs: number;
}

export type LatexSafeTranslationPhase = 'provider' | 'validating-latex';

export interface LatexSafeTranslationResult {
  providerResult: ProviderTranslationResult;
  restored: RestoredLatex;
  diagnostics: LatexSafeTranslationDiagnostics;
}

interface LatexFallbackPart {
  literal?: string;
  segmentId?: string;
  leading?: string;
  trailing?: string;
}

function notifyDiagnostics(
  callback: ((diagnostics: LatexSafeTranslationDiagnostics) => void) | undefined,
  latexValidationMs: number,
): void {
  try {
    callback?.({ latexValidationMs });
  } catch {
    // Local performance diagnostics must never affect translation.
  }
}

function notifyPhase(
  callback: ((phase: LatexSafeTranslationPhase) => void) | undefined,
  phase: LatexSafeTranslationPhase,
): void {
  try {
    callback?.(phase);
  } catch {
    // Presentation-only phase feedback must never affect translation.
  }
}

function buildLatexFallbackParts(protectedLatex: ProtectedLatex): {
  parts: LatexFallbackPart[];
  segments: Array<{ id: string; text: string }>;
} {
  const fragments = protectedLatex.fragments
    .map((fragment) => ({ ...fragment, index: protectedLatex.protectedText.indexOf(fragment.token) }))
    .filter((fragment) => fragment.index >= 0)
    .sort((left, right) => left.index - right.index);
  const parts: LatexFallbackPart[] = [];
  const segments: Array<{ id: string; text: string }> = [];
  let cursor = 0;

  const appendProse = (value: string) => {
    if (!value) return;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    const leading = match?.[1] ?? '';
    const text = match?.[2] ?? value;
    const trailing = match?.[3] ?? '';
    if (!text.trim()) {
      parts.push({ literal: value });
      return;
    }
    const segmentId = `LATEX_PROSE_${segments.length + 1}`;
    segments.push({ id: segmentId, text });
    parts.push({ segmentId, leading, trailing });
  };

  for (const fragment of fragments) {
    appendProse(protectedLatex.protectedText.slice(cursor, fragment.index));
    parts.push({ literal: fragment.raw });
    cursor = fragment.index + fragment.token.length;
  }
  appendProse(protectedLatex.protectedText.slice(cursor));
  return { parts, segments };
}

async function translateLatexProseFallback(
  translator: Pick<Translator, 'translate'>,
  input: PreparedTranslationInput,
  options: TranslationOptions,
  credentials: ProviderCredentials,
  signal: AbortSignal,
  protectedLatex: ProtectedLatex,
  onPhase?: (phase: LatexSafeTranslationPhase) => void,
): Promise<LatexSafeTranslationResult | undefined> {
  const { parts, segments } = buildLatexFallbackParts(protectedLatex);
  if (!segments.length) return undefined;
  notifyPhase(onPhase, 'provider');
  const fallbackResult = await translator.translate(
    {
      text: segments.map((segment) => segment.text).join('\n'),
      placeholderTokens: [],
      segments,
      ...(input.contextText ? { contextText: input.contextText } : {}),
    },
    options,
    credentials,
    signal,
  );
  if (fallbackResult.alignedSegments?.length !== segments.length) return undefined;
  const translations = new Map(
    fallbackResult.alignedSegments.map((segment) => [segment.id, segment.translatedText]),
  );
  if (segments.some((segment) => !translations.get(segment.id)?.trim())) return undefined;
  const translatedText = parts.map((part) => {
    if (part.literal !== undefined) return part.literal;
    return `${part.leading ?? ''}${translations.get(part.segmentId!)!}${part.trailing ?? ''}`;
  }).join('');
  const { alignedSegments: _fallbackSegments, ...fallbackWithoutSegments } = fallbackResult;
  return {
    providerResult: {
      ...fallbackWithoutSegments,
      translatedText,
    },
    restored: {
      text: translatedText,
      warnings: [
        ...protectedLatex.warnings,
        {
          code: 'PLAIN_TEXT_FALLBACK',
          message: 'LaTeX was reconstructed locally after translating prose-only segments.',
        },
      ],
    },
    diagnostics: { latexValidationMs: 0 },
  };
}

/**
 * Keeps strict LaTeX validation while giving an occasionally non-compliant
 * provider one corrective retry. Invalid TeX is never returned to the caller.
 */
export async function translateWithLatexRetry(
  translator: Pick<Translator, 'translate'>,
  input: PreparedTranslationInput,
  options: TranslationOptions,
  credentials: ProviderCredentials,
  signal: AbortSignal,
  protectedLatex: ProtectedLatex | undefined,
  callbacks: TranslationCallbacks | undefined,
  onDiagnostics?: (diagnostics: LatexSafeTranslationDiagnostics) => void,
  onPhase?: (phase: LatexSafeTranslationPhase) => void,
): Promise<LatexSafeTranslationResult> {
  const attempts = protectedLatex ? 2 : 1;
  let lastValidationError: ReturnType<typeof toTranslationError> | undefined;
  let latexValidationMs = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    notifyPhase(onPhase, 'provider');
    const providerResult = await translator.translate(
      attempt === 0 ? input : { ...input, strictPlaceholderPreservation: true },
      options,
      credentials,
      signal,
      callbacks,
    );

    if (!protectedLatex) {
      return {
        providerResult,
        restored: { text: providerResult.translatedText, warnings: [] },
        diagnostics: { latexValidationMs },
      };
    }

    notifyPhase(onPhase, 'validating-latex');
    const validationStartedAt = performance.now();
    try {
      const restored = restoreLatex(providerResult.translatedText, protectedLatex);
      latexValidationMs += Math.max(0, performance.now() - validationStartedAt);
      notifyDiagnostics(onDiagnostics, latexValidationMs);
      return {
        providerResult,
        restored,
        diagnostics: { latexValidationMs },
      };
    } catch (error) {
      latexValidationMs += Math.max(0, performance.now() - validationStartedAt);
      notifyDiagnostics(onDiagnostics, latexValidationMs);
      const normalized = toTranslationError(error);
      if (normalized.code !== 'LATEX_VALIDATION_FAILED') throw normalized;
      lastValidationError = normalized;
    }
  }

  if (lastValidationError && protectedLatex) {
    const fallback = await translateLatexProseFallback(
      translator,
      input,
      options,
      credentials,
      signal,
      protectedLatex,
      onPhase,
    );
    if (fallback) {
      return {
        ...fallback,
        diagnostics: { latexValidationMs },
      };
    }
  }
  if (lastValidationError) throw lastValidationError;
  throw new Error('LaTeX validation retry ended without a result.');
}
