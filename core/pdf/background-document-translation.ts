import type { PdfDocumentTranslationSourceRegion } from './document-translation';
import type {
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

export type PdfBackgroundDocumentMessage =
  | {
      type: 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION';
      target: 'pdf-background';
      payload: {
        jobId: string;
        documentSessionId: string;
        mode: 'text' | 'vision';
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
    ['text', 'vision'].includes(String(payload.mode)) &&
    (payload.mode === 'text' || nonEmptyString(payload.pdfResourceUrl, 8_192)) &&
    Array.isArray(payload.blocks) && payload.blocks.length > 0 &&
    record(payload.settings),
  );
}
