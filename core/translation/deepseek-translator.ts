import { DEFAULT_API_BASE_URL } from '../settings/schema';
import { OpenAiCompatibleTranslator } from './openai-compatible-translator';
import type {
  PreparedTranslationInput,
  ProviderCredentials,
  ProviderTranslationResult,
  TranslationCallbacks,
  TranslationOptions,
} from './types';

/** @deprecated Use OpenAiCompatibleTranslator. Kept for v0.4 source compatibility. */
export class DeepSeekTranslator extends OpenAiCompatibleTranslator {
  override translate(
    input: PreparedTranslationInput,
    options: TranslationOptions,
    credentials: Omit<ProviderCredentials, 'apiBaseUrl'> & { apiBaseUrl?: string },
    signal: AbortSignal,
    callbacks?: TranslationCallbacks,
  ): Promise<ProviderTranslationResult> {
    return super.translate(
      input,
      options,
      { ...credentials, apiBaseUrl: credentials.apiBaseUrl ?? DEFAULT_API_BASE_URL },
      signal,
      callbacks,
    );
  }

  override testConnection(
    options: Pick<TranslationOptions, 'model'>,
    credentials: Omit<ProviderCredentials, 'apiBaseUrl'> & { apiBaseUrl?: string },
    signal: AbortSignal,
  ): Promise<string> {
    return super.testConnection(
      options,
      { ...credentials, apiBaseUrl: credentials.apiBaseUrl ?? DEFAULT_API_BASE_URL },
      signal,
    );
  }

  override listModels(
    credentials: Omit<ProviderCredentials, 'apiBaseUrl'> & { apiBaseUrl?: string },
    signal: AbortSignal,
  ): Promise<string[]> {
    return super.listModels(
      { ...credentials, apiBaseUrl: credentials.apiBaseUrl ?? DEFAULT_API_BASE_URL },
      signal,
    );
  }
}
