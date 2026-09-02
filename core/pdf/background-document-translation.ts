import type { PdfDocumentTranslationSourceRegion } from './document-translation';
import type {
  ImageTranslationPurpose,
  TranslateBatchRequest,
  TranslateImageRegionRequest,
} from '../translation/types';

export const PDF_BACKGROUND_DOCUMENT_PATH = '/pdf-background.html';
export const PDF_BACKGROUND_CACHE_NAME = 'pi-pdf-background-v1';

export interface PdfBackgroundTranslationBlock {
  id: string;
  pageNumber: number;
  text: string;
  containsFormula: boolean;
  preserveInTextMode: boolean;
  visualPurpose: ImageTranslationPurpose;
  sourceRegions: PdfDocumentTranslationSourceRegion[];
  previousBlockId?: string;
  contextText?: string;
}

export interface PdfBackgroundTranslationSettings {
  documentId?: string;
  pageUrl: string;
  sourceLabel?: string;
  targetLanguage: string;
  sourceLanguage: string;
  style: 'academic' | 'general' | 'literal';
  contentMode: 'auto' | 'plain' | 'latex';
}

export interface PdfBackgroundTranslationOutcome {
  blockId: string;
  translatedText: string;
  visualProcessed: boolean;
  visualFallbackMessage?: string;
}

export interface PdfBackgroundTranslationSnapshot {
  jobId: string;
  documentSessionId: string;
  phase: 'running' | 'paused' | 'stopped' | 'complete' | 'error';
  completed: PdfBackgroundTranslationOutcome[];
  activeBlockId?: string;
  errorMessage?: string;
}

interface PdfVisualStructureBlock {
  containsFormula: boolean;
  visualPurpose: ImageTranslationPurpose;
  text?: string;
}

interface PdfVisualStructureResult {
  formulaNeedsReview?: boolean;
  formulaLatex?: readonly string[];
  recognizedText?: string;
  translatedText?: string;
  uncertainSpans?: readonly string[];
}

const URL_LIKE = /(?:\b(?:https?|ftp):\/\/|\/\/(?:www\.)?|www\.)[^\s<>"']+/giu;
const SIMPLE_PLAIN_EQUATION = /(?:^|[^\p{L}\p{N}])([\p{L}][\p{L}\p{N}]*(?:\s*\([^\n)]{1,24}\))?\s*(?:=|≈|≠|≤|≥|<|>)\s*[\p{L}\p{N}]+(?:\s*[+\-−*/×÷^]\s*[\p{L}\p{N}]+)*)(?=$|[^\p{L}\p{N}])/gu;

function compactPlainFormula(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').replaceAll('−', '-');
}

function simplePlainFormulae(value: string): string[] {
  const withoutUrls = value.replace(URL_LIKE, ' ');
  return [...new Set([...withoutUrls.matchAll(SIMPLE_PLAIN_EQUATION)].flatMap((match) => {
    const formula = compactPlainFormula(match[1] ?? '');
    return formula.length >= 3 ? [formula] : [];
  }))];
}

function preservesEverySimplePlainFormula(
  block: PdfVisualStructureBlock,
  result: PdfVisualStructureResult,
): boolean {
  if (!block.text || !result.recognizedText || !result.translatedText) return false;
  const formulae = simplePlainFormulae(block.text);
  if (!formulae.length) return false;
  const recognized = compactPlainFormula(result.recognizedText);
  const translated = compactPlainFormula(result.translatedText);
  return formulae.every((formula) => (
    recognized.includes(formula) && translated.includes(formula)
  ));
}

/**
 * Figure and table results are object translations, not standalone formula
 * transcriptions. Their captions may contain symbols such as F(k), but a
 * provider is not required to duplicate every such token in formulaLatex.
 */
export function pdfBackgroundVisualResultIsStructurallySafe(
  block: PdfVisualStructureBlock,
  result: PdfVisualStructureResult,
): boolean {
  if (block.visualPurpose === 'figure' || block.visualPurpose === 'table') return true;
  return !result.formulaNeedsReview && (
    !block.containsFormula || Boolean(result.formulaLatex?.length) ||
    preservesEverySimplePlainFormula(block, result)
  );
}

export function pdfBackgroundVisualFallbackMessage(
  block: PdfVisualStructureBlock,
  result: PdfVisualStructureResult,
): string {
  if (!block.containsFormula) return '视觉模型没有返回可靠译文';
  if (!result.formulaLatex?.length) return '模型未返回可核对的公式结构';
  const validationIssue = result.uncertainSpans?.find((issue) => (
    issue.startsWith('公式 LaTeX 未通过自动校验：')
  ));
  return validationIssue
    ? validationIssue.replace('公式 LaTeX 未通过自动校验：', '公式结构未通过校验：')
    : '含公式段落的视觉结果未通过结构校验';
}

export type PdfBackgroundDocumentMessage =
  | {
      type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION';
      target: 'pdf-background';
      payload: {
        jobId: string;
        documentSessionId: string;
        mode: 'text' | 'vision' | 'hybrid';
        pdfResourceUrl?: string;
        blocks: PdfBackgroundTranslationBlock[];
        settings: PdfBackgroundTranslationSettings;
      };
    }
  | {
      type: 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION';
      target: 'pdf-background';
      payload: {
        jobId: string;
        action: 'pause' | 'resume' | 'stop' | 'dispose';
      };
    }
  | {
      type: 'GET_PDF_BACKGROUND_DOCUMENT_TRANSLATION';
      target: 'pdf-background';
      payload: { jobId: string };
    }
  | {
      type: 'DISPOSE_PDF_BACKGROUND_TRANSLATIONS_FOR_TAB';
      target: 'pdf-background';
      payload: { sourceTabId: number };
    }
  | {
      type: 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED';
      payload: PdfBackgroundTranslationSnapshot;
    };

export type PdfBackgroundProxyMessage =
  | { type: 'ENSURE_PDF_BACKGROUND_DOCUMENT' }
  | {
      type: 'TRANSLATE_PDF_BACKGROUND_VISUAL_BLOCK';
      payload: {
        sourceTabId: number;
        request: TranslateImageRegionRequest;
      };
    }
  | {
      type: 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK';
      payload: {
        sourceTabId: number;
        request: TranslateBatchRequest;
      };
    }
  | {
      type: 'CANCEL_PDF_BACKGROUND_VISUAL_BLOCK';
      payload: { sourceTabId: number; requestId: string };
    };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown, maximum = 4_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function validBackgroundTranslationBlock(value: unknown): boolean {
  const block = record(value);
  return Boolean(
    block && nonEmptyString(block.id, 256) &&
    Number.isSafeInteger(block.pageNumber) && (block.pageNumber as number) > 0 &&
    nonEmptyString(block.text, 12_000) &&
    typeof block.containsFormula === 'boolean' &&
    typeof block.preserveInTextMode === 'boolean' &&
    ['document', 'formula', 'figure', 'table'].includes(String(block.visualPurpose)) &&
    Array.isArray(block.sourceRegions),
  );
}

export function isPdfBackgroundProxyMessage(
  value: unknown,
): value is PdfBackgroundProxyMessage {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'ENSURE_PDF_BACKGROUND_DOCUMENT') return true;
  const payload = record(message.payload);
  if (
    !payload || !Number.isSafeInteger(payload.sourceTabId) ||
    (payload.sourceTabId as number) < 0
  ) return false;
  if (message.type === 'CANCEL_PDF_BACKGROUND_VISUAL_BLOCK') {
    return nonEmptyString(payload.requestId, 256);
  }
  if (
    message.type !== 'TRANSLATE_PDF_BACKGROUND_VISUAL_BLOCK' &&
    message.type !== 'TRANSLATE_PDF_BACKGROUND_TEXT_BLOCK'
  ) return false;
  const request = record(payload.request);
  return Boolean(request && nonEmptyString(request.requestId, 256));
}

export function isPdfBackgroundDocumentMessage(
  value: unknown,
): value is PdfBackgroundDocumentMessage {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED') {
    const payload = record(message.payload);
    return Boolean(
      payload && nonEmptyString(payload.jobId, 256) &&
      nonEmptyString(payload.documentSessionId, 256) && Array.isArray(payload.completed),
    );
  }
  if (message.target !== 'pdf-background') return false;
  const payload = record(message.payload);
  if (message.type === 'DISPOSE_PDF_BACKGROUND_TRANSLATIONS_FOR_TAB') {
    return Boolean(
      payload && Number.isSafeInteger(payload.sourceTabId) &&
      (payload.sourceTabId as number) >= 0,
    );
  }
  if (!payload || !nonEmptyString(payload.jobId, 256)) return false;
  if (message.type === 'GET_PDF_BACKGROUND_DOCUMENT_TRANSLATION') return true;
  if (message.type === 'CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION') {
    return ['pause', 'resume', 'stop', 'dispose'].includes(String(payload.action));
  }
  return message.type === 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION' && Boolean(
    nonEmptyString(payload.documentSessionId, 256) &&
    ['text', 'vision', 'hybrid'].includes(String(payload.mode)) &&
    (payload.mode === 'text' || nonEmptyString(payload.pdfResourceUrl, 8_192)) &&
    Array.isArray(payload.blocks) && payload.blocks.length > 0 &&
    payload.blocks.every(validBackgroundTranslationBlock) &&
    record(payload.settings),
  );
}
