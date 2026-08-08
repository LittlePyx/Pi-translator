export type TranslationStyle = 'academic' | 'general' | 'literal';
export type TranslationContentMode = 'auto' | 'plain' | 'latex';

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface PdfSourceLocation {
  documentId: string;
  pageNumber: number;
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface TranslateRequest {
  requestId: string;
  /** Stable local identity for document-scoped memory; never sent to the provider. */
  documentId?: string;
  text: string;
  pageUrl: string;
  sourceLabel?: string;
  targetLanguage: string;
  sourceLanguage: 'auto' | string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
  contextText?: string;
  bypassCache?: boolean;
  sourceLocation?: PdfSourceLocation;
  revision?: TranslationRevisionRequest;
}

export type TranslationRevisionKind =
  | 'faithful'
  | 'natural'
  | 'terminology-formula'
  | 'custom'
  | 'manual';

export interface TranslationRevisionRequest {
  rootRequestId: string;
  kind: Exclude<TranslationRevisionKind, 'manual'>;
  label: string;
  instruction: string;
  previousTranslation?: string;
  scope?: TranslationRevisionScope;
  sourceKind?: 'text' | 'pdf-region-text' | 'image-region';
  formulaLatex?: string[];
  uncertainSpans?: string[];
  formulaNeedsReview?: boolean;
}

export type TranslationRevisionScope = 'current' | 'document' | 'global';
/** Where a locally corrected translation itself is remembered. */
export type TranslationMemoryScope = 'current' | 'document';
/** Optional destination for a user-confirmed terminology pair. */
export type TranslationTermScope = 'document' | 'global';

export interface TranslationCorrectionTermInput extends GlossaryEntry {
  scope: TranslationTermScope;
}

export interface TranslationCorrectionTermReceipt {
  scope: 'document' | 'global';
  source: string;
  appliedTarget: string;
  previousTarget?: string;
  documentTermId?: string;
}

/** Kept only in the current browser session so a manual correction can be undone safely. */
export interface TranslationCorrectionReceipt {
  baseRequestId: string;
  correctedRequestId: string;
  scope: TranslationMemoryScope;
  previousTranslation: string;
  correctedTranslation: string;
  termChange?: TranslationCorrectionTermReceipt;
  segmentChange?: {
    segmentId: string;
    previousTranslatedText: string;
    correctedTranslatedText: string;
  };
}

export interface TranslationRevision {
  rootRequestId: string;
  kind: TranslationRevisionKind;
  label: string;
  scope?: TranslationRevisionScope;
}

export interface TranslateImageRegionRequest {
  requestId: string;
  /** Stable local identity for document-scoped memory; never sent to the provider. */
  documentId?: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  recognizedTextHint?: string;
  pageUrl: string;
  sourceLabel?: string;
  targetLanguage: string;
  sourceLanguage: 'auto' | string;
  style: TranslationStyle;
  bypassCache?: boolean;
  sourceLocation?: PdfSourceLocation;
  revision?: TranslationRevisionRequest;
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
  /** Stable local-only identity used to keep later revisions attached to the source document. */
  documentId?: string;
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
  sourceKind?: 'text' | 'pdf-region-text' | 'image-region';
  sourceLocation?: PdfSourceLocation;
  uncertainSpans?: string[];
  formulaLatex?: string[];
  formulaNeedsReview?: boolean;
  termCandidates?: GlossaryEntry[];
  revision?: TranslationRevision;
}

export interface ProviderImageTranslationResult {
  recognizedText: string;
  translatedText: string;
  uncertainSpans: string[];
  formulaLatex: string[];
  formulaNeedsReview?: boolean;
}

export interface ImageTranslationInput {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  recognizedTextHint?: string;
}

export interface ImageTranslationOptions {
  model: string;
  sourceLanguage: 'auto' | string;
  targetLanguage: string;
  style: TranslationStyle;
  glossary?: GlossaryEntry[];
}

export interface TranslationSegment {
  id: string;
  originalText: string;
  translatedText: string;
}

export interface TranslationHistoryEntry extends TranslateResult {
  historyId: string;
  createdAt: number;
}

export interface ProviderTranslationResult {
  translatedText: string;
  detectedLanguage?: string;
  warnings: string[];
  alignedSegments?: ProviderTranslationSegment[];
  structuredResponse?: boolean;
  termCandidates?: GlossaryEntry[];
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
  adjustmentInstruction?: string;
  previousTranslation?: string;
}

export interface TranslationCallbacks {
  onPartialText?: (text: string) => void;
}

export interface ProviderCredentials {
  apiKey: string;
  apiBaseUrl: string;
}

export interface Translator {
  translateImageRegion(
    input: ImageTranslationInput,
    options: ImageTranslationOptions,
    credentials: ProviderCredentials,
    signal: AbortSignal,
    callbacks?: TranslationCallbacks,
  ): Promise<ProviderImageTranslationResult>;

  testVisionCapability(
    options: Pick<ImageTranslationOptions, 'model'>,
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<void>;

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
