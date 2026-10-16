import type { FormulaDocument } from '../translation/formula-document';

export type PdfReviewKind = 'untranslated' | 'failed' | 'formula' | 'original';

export interface PdfReviewBlock {
  id: string;
  pageNumber: number;
  included: boolean;
  status: 'idle' | 'translating' | 'done' | 'error';
  translatedText?: string;
  errorMessage?: string;
  formulaReviewMessage?: string;
  visualFallbackMessage?: string;
  referencePreserved?: boolean;
  reviewConfirmation?: string;
  formulaDocument?: FormulaDocument;
}

export function pdfReviewKind(block: PdfReviewBlock): PdfReviewKind | undefined {
  if (!block.included || block.referencePreserved) return undefined;
  if (block.status === 'error') return 'failed';
  if (block.status !== 'done') return 'untranslated';
  if (block.formulaReviewMessage) return 'formula';
  if (block.visualFallbackMessage) return 'original';
  return undefined;
}

/** Confirmation is tied to this result; a retry changing it requires review again. */
export function pdfReviewConfirmation(block: PdfReviewBlock): string {
  const value = JSON.stringify([block.formulaDocument?.translationTemplate ?? block.translatedText?.trim(), block.formulaReviewMessage, block.visualFallbackMessage,
    block.formulaDocument?.formulas.map((formula) => [formula.id, formula.latex, formula.display, formula.review,
      formula.sourceEquationId, formula.equationNumber, formula.equationGroupId]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  let hash = 0x811c9dc5;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return `review-${(hash >>> 0).toString(16)}`;
}

export function pdfReviewConfirmed(block: PdfReviewBlock): boolean {
  return block.status === 'done' && block.reviewConfirmation === pdfReviewConfirmation(block);
}

export function pdfReviewQueue(blocks: readonly PdfReviewBlock[], filter: 'all' | PdfReviewKind = 'all') {
  return blocks.flatMap((block) => {
    const kind = pdfReviewKind(block);
    return kind && (filter === 'all' || filter === kind) ? [{ block, kind, confirmed: pdfReviewConfirmed(block) }] : [];
  });
}
