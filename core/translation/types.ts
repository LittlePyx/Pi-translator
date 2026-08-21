export type TranslationStyle = 'academic' | 'general' | 'literal';
export type TranslationContentMode = 'auto' | 'plain' | 'latex';

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface ScopedGlossaryTerm extends GlossaryEntry {
  scope: 'document' | 'global';
}

export type AppliedGlossaryTerm = ScopedGlossaryTerm;

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
  /** Numeric client-side timings only; never forwarded to the translation provider. */
  clientPerformance?: TranslationClientPerformance;
  revision?: TranslationRevisionRequest;
}

export interface TranslationClientPerformance {
  captureMs?: number;
  queueMs?: number;
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

/**
 * Exact document-term transition needed to undo a correction without losing
 * candidates that were displaced when the term was confirmed. This remains
 * session-local as part of the correction receipt.
 */
export interface TranslationDocumentTermChangeReceipt {
  sourceKey: string;
  applied?: GlossaryEntry & { id: string; createdAt: number; updatedAt: number };
  previous?: GlossaryEntry & { id: string; createdAt: number; updatedAt: number };
  removedCandidates: Array<GlossaryEntry & { id: string; createdAt: number }>;
  introducedCandidates: Array<GlossaryEntry & { id: string; createdAt: number }>;
}

/** Kept only in the current browser session so a manual correction can be undone safely. */
export interface TranslationCorrectionReceipt {
  baseRequestId: string;
  correctedRequestId: string;
  scope: TranslationMemoryScope;
  previousTranslation: string;
  correctedTranslation: string;
  termChange?: TranslationCorrectionTermReceipt;
  documentTermChange?: TranslationDocumentTermChangeReceipt;
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
  /** Numeric client-side timings only; never forwarded to the translation provider. */
  clientPerformance?: TranslationClientPerformance;
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
  /** Optional compact dictionary data for a word or short phrase. */
  lexicalLookup?: LexicalLookup;
  /** Glossary mappings verified in both the source and the completed translation. */
  appliedGlossaryTerms?: AppliedGlossaryTerm[];
  /** Source-matched glossary mappings whose configured target is absent from the result. */
  glossaryTermsNeedingReview?: ScopedGlossaryTerm[];
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

export interface LexicalLookupSense {
  meaning: string;
  partOfSpeech?: string;
}

export interface LexicalLookup {
  pronunciation?: string;
  partOfSpeech?: string;
  senses: LexicalLookupSense[];
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
  lexicalLookup?: LexicalLookup;
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
  lexicalLookup?: boolean;
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
  ): Promise<string>;

  listModels(
    credentials: ProviderCredentials,
    signal: AbortSignal,
  ): Promise<string[]>;
}
