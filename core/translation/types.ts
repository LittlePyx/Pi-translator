export type TranslationStyle = 'academic' | 'general' | 'literal';
export type TranslationContentMode = 'auto' | 'plain' | 'latex';

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslateRequest {
  requestId: string;
  text: string;
  pageUrl: string;
  targetLanguage: string;
  sourceLanguage: 'auto' | string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
  contextText?: string;
  bypassCache?: boolean;
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
  alignedSegments?: TranslationSegment[];
  sourceHost?: string;
  targetLanguage?: string;
  style?: TranslationStyle;
  completedAt?: number;
  cached?: boolean;
  latencyMs?: number;
  contextUsed?: boolean;
  chunkCount?: number;
}

export interface TranslationSegment {
  id: string;
  originalText: string;
  translatedText: string;
}

export interface TranslationHistoryEntry extends TranslateResult {
  historyId: string;
  createdAt: number;
  pinned?: boolean;
}

export interface TranslationFavorite extends TranslateResult {
  favoriteId: string;
  createdAt: number;
}

export interface ProviderTranslationResult {
  translatedText: string;
  detectedLanguage?: string;
  warnings: string[];
  alignedSegments?: ProviderTranslationSegment[];
  structuredResponse?: boolean;
}

export interface ProviderTranslationSegment {
  id: string;
  translatedText: string;
}

export interface TranslationOptions {
  model: string;
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  glossary?: GlossaryEntry[];
}

export interface PreparedTranslationInput {
  text: string;
  placeholderTokens: string[];
  segments?: Array<{ id: string; text: string }>;
  contextText?: string;
  strictPlaceholderPreservation?: boolean;
}

export interface TranslationCallbacks {
  onPartialText?: (text: string) => void;
}

export interface ProviderCredentials {
  apiKey: string;
  apiBaseUrl: string;
}

export interface Translator {
  translate(
    input: PreparedTranslationInput,
    options: TranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
    callbacks?: TranslationCallbacks,
  ): Promise<ProviderTranslationResult>;

  testConnection(
    options: Pick<TranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void>;

  listModels(
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<string[]>;
}
