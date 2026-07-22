export type TranslationStyle = 'academic' | 'general' | 'literal';

export interface TranslateRequest {
  requestId: string;
  text: string;
  pageUrl: string;
  targetLanguage: string;
  sourceLanguage: 'auto' | string;
  style: TranslationStyle;
}

export type TranslationWarningCode =
  | 'UNKNOWN_MACRO_PROTECTED'
  | 'INCOMPLETE_LATEX_PROTECTED'
  | 'PLAIN_TEXT_FALLBACK';

export interface TranslationWarning {
  code: TranslationWarningCode;
  message: string;
}

export interface TranslateResult {
  requestId: string;
  originalText: string;
  translatedText: string;
  detectedLanguage?: string;
  warnings: TranslationWarning[];
}

export interface ProviderTranslationResult {
  translatedText: string;
  detectedLanguage?: string;
  warnings: string[];
}

export interface TranslationOptions {
  model: string;
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
}

export interface PreparedTranslationInput {
  text: string;
  placeholderTokens: string[];
}

export interface ProviderCredentials {
  apiKey: string;
}

export interface Translator {
  translate(
    input: PreparedTranslationInput,
    options: TranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<ProviderTranslationResult>;

  testConnection(
    options: Pick<TranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void>;
}
