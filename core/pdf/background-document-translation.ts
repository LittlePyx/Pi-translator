import type { PdfDocumentTranslationSourceRegion } from './document-translation';
import { validPdfRequestLimit, validPdfRequestUsage, type PdfRequestUsage } from './request-budget';
import type { PdfDocumentVisualUnit } from './document-translation';
import { pdfEquationCoverageIssues } from './visual-unit-translation';
import { bindPdfEquationNumbers } from './equation-binding';
import { pdfHasTargetProse, pdfTranslationProseIssues } from './translation-completeness';
import {pdfCitationIssues,pdfFormulaProseIssues} from './prose-bindings';
import {pdfMathFontIssues,validPdfMathFontHints,type PdfMathFontHint} from './math-font-evidence';
import { validSourceEquations, type SourceEquation } from '../translation/source-equations';
import { extractFormulaReviewProse, hasFormulaTranslationProse, validateImageFigureResult } from '../translation/formula-output-validation';
import { compactFormulaDocument, formulaDocumentIssues, formulaDocumentParts, formulaDocumentText, isFormulaDocument, recoverLegacyFormulaDocument,
  type FormulaDocument } from '../translation/formula-document';
import type {
  ImageTranslationPurpose,
  TranslateBatchRequest,
  TranslateImageRegionRequest,
} from '../translation/types';

export const PDF_BACKGROUND_DOCUMENT_PATH = '/pdf-background.html';
export const PDF_BACKGROUND_CACHE_NAME = 'pi-pdf-background-v1';

export interface PdfBackgroundTranslationBlock {
  sourceFontHints?:readonly PdfMathFontHint[];
  id: string;
  pageNumber: number;
  text: string;
  containsFormula: boolean;
  preserveInTextMode: boolean;
  visualPurpose: ImageTranslationPurpose;
  sourceRegions: PdfDocumentTranslationSourceRegion[];
  visualUnits?: readonly PdfDocumentVisualUnit[];
  equationNumbers?: readonly string[];
  sourceEquations?: readonly SourceEquation[];
  previousBlockId?: string;
  contextText?: string;
}

export interface PdfBackgroundTranslationSettings {
  requestLimit?: number;
  requestUsage?: PdfRequestUsage;
  documentId?: string;
  pageUrl: string;
  sourceLabel?: string;
  targetLanguage: string;
  sourceLanguage: string;
  style: 'academic' | 'general' | 'literal';
  contentMode: 'auto' | 'plain' | 'latex';
}

export interface PdfBackgroundTranslationOutcome {
  formulaDocument?: FormulaDocument;
  blockId: string;
  translatedText: string;
  visualProcessed: boolean;
  visualFallbackMessage?: string;
  formulaReviewMessage?: string;
  /** Opaque model text, not safe to render as validated math. */
  formulaReviewDraft?: true;
}

export interface PdfBackgroundTranslationSnapshot {
  revision?: number;
  requestUsage?: PdfRequestUsage;
  /** Aggregate local timings only; no document text, images or credentials. */
  performance?: { captures: number; prefetched: number; pageRenderMs: number; cropEncodeMs: number;
    captureWaitMs: number; requestMs: number; validationMs: number };
  jobId: string;
  documentSessionId: string;
  phase: 'running' | 'paused' | 'stopped' | 'complete' | 'error';
  completed: PdfBackgroundTranslationOutcome[];
  activeBlockId?: string;
  errorMessage?: string;
}

interface PdfVisualStructureBlock {
  sourceFontHints?:readonly PdfMathFontHint[];
  equationNumbers?: readonly string[];
  sourceEquations?: readonly SourceEquation[];
  containsFormula: boolean;
  visualPurpose: ImageTranslationPurpose;
  text?: string;
}

interface PdfVisualStructureResult {
  formulaDocument?: FormulaDocument;
  originalText?: string;
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
  if (block.visualPurpose === 'figure' && result.formulaNeedsReview && result.recognizedText && result.translatedText &&
      result.uncertainSpans?.every(issue => issue.startsWith('公式 LaTeX 未通过自动校验：'))) {
    return validateImageFigureResult({ recognizedText: result.recognizedText, translatedText: result.translatedText,
      formulaLatex: [...(result.formulaLatex ?? [])], uncertainSpans: [] }).valid;
  }
  if (block.visualPurpose === 'figure' || block.visualPurpose === 'table') return !result.formulaNeedsReview;
  return !result.formulaNeedsReview && (
    !block.containsFormula || Boolean(result.formulaLatex?.length) ||
    preservesEverySimplePlainFormula(block, result)
  );
}

export function pdfBackgroundVisualFallbackMessage(
  block: PdfVisualStructureBlock,
  result: PdfVisualStructureResult,
): string {
  const validationIssue = result.uncertainSpans?.find((issue) => (
    issue.startsWith('公式 LaTeX 未通过自动校验：')
  ));
  if (validationIssue) return validationIssue.replace('公式 LaTeX 未通过自动校验：', '公式结构未通过校验：');
  if (result.uncertainSpans?.some(issue => issue.trim())) return `模型报告局部内容不确定：${result.uncertainSpans.filter(Boolean).join('；')}`;
  if (!block.containsFormula && !result.formulaNeedsReview) return '视觉结果未通过正文校验';
  if (!result.formulaLatex?.length) return '模型未返回可核对的公式结构';
  return '含公式段落的视觉结果未通过结构校验';
}

/** Text batches, legacy restores and visual prose share the same evidence.
 * A returned candidate is retained for review; a source echo is never success. */
export function pdfBackgroundTextOutcome(block: { id: string; text: string }, translatedText: string,
  targetLanguage: string): PdfBackgroundTranslationOutcome {
  const issues = pdfTranslationProseIssues(block.text, translatedText, targetLanguage);
  if (!issues.length) return { blockId: block.id, translatedText: translatedText.trim(), visualProcessed: false };
  if (pdfHasTargetProse(translatedText, targetLanguage) &&
      !issues.some(issue => issue.includes('与原文相同'))) {
    return { blockId: block.id, translatedText: translatedText.trim(), visualProcessed: false,
      formulaReviewMessage: issues.join('；'), formulaReviewDraft: true };
  }
  return { blockId: block.id, translatedText: block.text, visualProcessed: false, visualFallbackMessage: issues.join('；') };
}

/** One outcome policy shared by the offscreen worker and foreground fallback. */
export function pdfBackgroundVisualOutcome(
  block: PdfVisualStructureBlock & { id: string; text: string },
  result: PdfVisualStructureResult,
  targetLanguage: string,
): PdfBackgroundTranslationOutcome {
  // Provider replies use recognizedText; persisted/runtime TranslateResult
  // carries the same recognition as originalText.
  if (!result.recognizedText && result.originalText) result = { ...result, recognizedText: result.originalText };
  const translatedText = result.translatedText?.trim();
  let formulaDocument = result.formulaDocument && isFormulaDocument(result.formulaDocument)
    ? result.formulaDocument : undefined;
  // A text-layer classifier can miss inline mathematics that the image reveals.
  // Recovery still requires exact source/translation formula matches.
  if (!formulaDocument && translatedText && result.formulaNeedsReview) {
    formulaDocument = recoverLegacyFormulaDocument(result.recognizedText ?? result.originalText ?? '', translatedText);
  }
  if (formulaDocument) {
    formulaDocument = bindPdfEquationNumbers(formulaDocument, block.sourceEquations);
    const prose = formulaDocumentParts(formulaDocument).flatMap((part) => 'text' in part ? [part.text] : []).join(' ');
    const sourceProse = formulaDocumentParts(formulaDocument, true)
      .flatMap((part) => 'text' in part ? [part.text] : []).join(' ');
    const proseIssues = pdfTranslationProseIssues(block.text, formulaDocumentText(formulaDocument), targetLanguage,
      result.recognizedText ?? sourceProse);
    if (proseIssues.length && !pdfHasTargetProse(prose, targetLanguage)) {
      const mathIssues = formulaDocumentIssues(formulaDocument);
      return { blockId: block.id, translatedText: block.text, visualProcessed: false,
        visualFallbackMessage: [...proseIssues, `公式登记 ${formulaDocument.formulas.length} 项`, ...mathIssues]
          .join('；').slice(0, 1800) };
    }
    const issues = [...formulaDocumentIssues(formulaDocument), ...proseIssues,...pdfFormulaProseIssues(formulaDocument,targetLanguage),...(block.containsFormula?pdfMathFontIssues(block.sourceFontHints,formulaDocument):[])];
    issues.push(...(result.uncertainSpans ?? []).filter(issue => !issue.startsWith('公式 LaTeX 未通过自动校验：'))
      .map(issue => `模型报告局部内容不确定：${issue}`));
    // A correctly bound number remains known even when its mathematical body
    // is a review placeholder. Do not misreport a symbol issue as a missing tag.
    const reviewedNumbers = formulaDocumentParts(formulaDocument).flatMap((part) => 'formula' in part &&
      part.formula.review && part.formula.equationNumber ? [`\\tag{${part.formula.equationNumber}}`] : []);
    issues.push(...pdfEquationCoverageIssues(block.equationNumbers, formulaDocumentText(formulaDocument) + reviewedNumbers.join('')));
    if (block.containsFormula && !formulaDocument.formulas.length) issues.push('模型未登记本段公式');
    return { blockId: block.id, translatedText: formulaDocumentText(formulaDocument), formulaDocument: compactFormulaDocument(formulaDocument),
      visualProcessed: issues.length === 0,
      ...(issues.length ? { formulaReviewMessage: issues.join('；').slice(0, 1800) } : {}) };
  }
  const proseIssues = pdfTranslationProseIssues(block.text, translatedText ?? '', targetLanguage, result.recognizedText);
  const modelUncertainty = (result.uncertainSpans ?? []).filter(issue => !issue.startsWith('公式 LaTeX 未通过自动校验：'));
  if (translatedText && !proseIssues.length && pdfBackgroundVisualResultIsStructurallySafe(block, result)) {
    const issues = [...pdfEquationCoverageIssues(block.equationNumbers, translatedText),...pdfCitationIssues(result.recognizedText??'',translatedText),
      ...modelUncertainty.map(issue => `模型报告局部内容不确定：${issue}`)];
    return { blockId: block.id, translatedText, visualProcessed: !issues.length,
      ...(issues.length ? { formulaReviewMessage: issues.join('；') } : {}) };
  }
  const structuralIssues = pdfBackgroundVisualResultIsStructurallySafe(block, result) ? []
    : [pdfBackgroundVisualFallbackMessage(block, result)];
  const reason = [...new Set([...proseIssues, ...structuralIssues,
    ...modelUncertainty.map(issue => `模型报告局部内容不确定：${issue}`)])].join('；');
  const prose = block.containsFormula && translatedText
    ? extractFormulaReviewProse(translatedText, targetLanguage)
    : undefined;
  if (prose && prose === translatedText && prose !== block.text.trim()) {
    return { blockId: block.id, translatedText: prose, visualProcessed: false,
      formulaReviewMessage: reason };
  }
  // Never erase readable translated prose merely because math could not be
  // isolated. Keep the exact candidate as an explicitly unverified draft.
  const sourceEcho = translatedText?.replace(/\s+/gu, '') === block.text.replace(/\s+/gu, '');
  if (translatedText && !sourceEcho && (pdfHasTargetProse(translatedText, targetLanguage) ||
      hasFormulaTranslationProse(translatedText, targetLanguage))) {
    return { blockId: block.id, translatedText, visualProcessed: false,
      formulaReviewMessage: `${structuralIssues.length ? '数学内容无法安全分离，请对照原文核对。' : ''}${reason}`,
      formulaReviewDraft: true };
  }
  const proseReason = !translatedText || proseIssues.length ? '' : sourceEcho
    ? '模型返回内容与原文相同，未取得新的正文译文。'
    : !hasFormulaTranslationProse(translatedText, targetLanguage)
      ? '模型结果中未检测到足够的目标语言正文。' : '';
  return { blockId: block.id, translatedText: block.text, visualProcessed: false,
    visualFallbackMessage: `${proseReason}${reason}` };
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
        requestLimit?: number;
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
    Array.isArray(block.sourceRegions) && validVisualPlan(block),
  );
}

function validVisualPlan(block: Record<string, unknown>): boolean {
  const validNumbers = (value: unknown) => value === undefined || (Array.isArray(value) && value.length <= 64 &&
    value.every((number) => typeof number === 'string' && /^\d{1,4}[a-z]?$/iu.test(number)));
  if (!validNumbers(block.equationNumbers) || !validSourceEquations(block.sourceEquations)||!validPdfMathFontHints(block.sourceFontHints)) return false;
  if (block.visualUnits === undefined) return true;
  if (!Array.isArray(block.visualUnits) || !block.visualUnits.length || block.visualUnits.length > 32) return false;
  const units = block.visualUnits.map(record);
  const owners = (block.sourceRegions as unknown[]).map(record);
  if (!units.every((unit) => unit && nonEmptyString(unit.text, 12_000) && validNumbers(unit.equationNumbers) && validSourceEquations(unit.sourceEquations) &&validPdfMathFontHints(unit.sourceFontHints)&&
    Array.isArray(unit.sourceRegions) && unit.sourceRegions.length > 0 && unit.sourceRegions.length <= 32 &&
    unit.sourceRegions.every((value) => {
      const region = record(value), a = record(region?.sourceAnchor);
      if (!a || !['leftRatio', 'topRatio', 'widthRatio', 'heightRatio'].every((key) =>
        typeof a[key] === 'number' && Number.isFinite(a[key])) || Number(a.widthRatio) <= 0 || Number(a.heightRatio) <= 0) return false;
      return owners.some((owner) => {
        const b = record(owner?.sourceAnchor);
        return b && owner?.pageNumber === region?.pageNumber && Number(a.leftRatio) >= Number(b.leftRatio) - .001 &&
          Number(a.topRatio) >= Number(b.topRatio) - .001 &&
          Number(a.leftRatio) + Number(a.widthRatio) <= Number(b.leftRatio) + Number(b.widthRatio) + .001 &&
          Number(a.topRatio) + Number(a.heightRatio) <= Number(b.topRatio) + Number(b.heightRatio) + .001;
      });
    }))) return false;
  return units.map((unit) => unit!.text).join('').replace(/\s+/gu, '') === String(block.text).replace(/\s+/gu, '');
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
    return ['pause', 'resume', 'stop', 'dispose'].includes(String(payload.action)) &&
      (payload.requestLimit === undefined || validPdfRequestLimit(payload.requestLimit));
  }
  return message.type === 'START_PDF_BACKGROUND_DOCUMENT_TRANSLATION' && Boolean(
    nonEmptyString(payload.documentSessionId, 256) &&
    ['text', 'vision', 'hybrid'].includes(String(payload.mode)) &&
    (payload.mode === 'text' || nonEmptyString(payload.pdfResourceUrl, 8_192)) &&
    Array.isArray(payload.blocks) && payload.blocks.length > 0 &&
    payload.blocks.every(validBackgroundTranslationBlock) &&
    record(payload.settings) &&
    (record(payload.settings)!.requestLimit === undefined || validPdfRequestLimit(record(payload.settings)!.requestLimit)) &&
    (record(payload.settings)!.requestUsage === undefined || validPdfRequestUsage(record(payload.settings)!.requestUsage)),
  );
}
