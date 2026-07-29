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

export interface LatexSafeTranslationResult {
  providerResult: ProviderTranslationResult;
  restored: RestoredLatex;
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
): Promise<LatexSafeTranslationResult> {
  const attempts = protectedLatex ? 2 : 1;
  let lastValidationError: ReturnType<typeof toTranslationError> | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
      };
    }

    try {
      return {
        providerResult,
        restored: restoreLatex(providerResult.translatedText, protectedLatex),
      };
    } catch (error) {
      const normalized = toTranslationError(error);
      if (normalized.code !== 'LATEX_VALIDATION_FAILED') throw normalized;
      lastValidationError = normalized;
    }
  }

  if (lastValidationError) throw lastValidationError;
  throw new Error('LaTeX validation retry ended without a result.');
}
