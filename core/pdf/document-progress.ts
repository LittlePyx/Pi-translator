import {pdfReviewConfirmed, type PdfReviewBlock} from './review-queue';
import type {PdfDocumentTranslationSessionSnapshot} from './document-translation-session';

export function pdfDocumentProgress(blocks: readonly PdfReviewBlock[]) {
  const scoped = blocks.filter(block => block.included);
  const done = scoped.filter(block => block.status === 'done');
  const warnings = done.filter(block => !block.referencePreserved && (block.formulaReviewMessage || block.visualFallbackMessage));
  const confirmed = warnings.filter(pdfReviewConfirmed).length;
  const preserved = done.filter(block => block.referencePreserved).length;
  return {total: scoped.length, processed: done.length, translated: done.length - preserved, preserved,
    pending: scoped.filter(block => block.status === 'idle' || block.status === 'translating').length,
    failed: scoped.filter(block => block.status === 'error').length,
    review: warnings.length - confirmed, confirmed,
    complete: scoped.length > 0 && done.length === scoped.length};
}

export function pdfSavedDocumentProgress(session: PdfDocumentTranslationSessionSnapshot) {
  const targets = new Map(session.blocks.map(block => [block.signature, block]));
  const preserved = new Set(session.preservedSignatures ?? []);
  const progress = pdfDocumentProgress((session.scopeSignatures ?? session.documentSignatures).map(signature => ({
    ...targets.get(signature), id: signature, pageNumber: 1, included: true,
    status: targets.get(signature)?.retranslation?'idle':targets.has(signature) || preserved.has(signature) ? 'done' : 'idle',
    referencePreserved: preserved.has(signature),
  })));
  // Legacy checkpoints did not record intentionally preserved references/ranges.
  return {...progress, coverageKnown: progress.complete || (session.scopeSignatures !== undefined && session.preservedSignatures !== undefined)};
}
