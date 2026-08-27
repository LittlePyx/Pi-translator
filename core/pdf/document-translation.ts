import { buildPdfSearchPageIndex, type PdfSearchTextItem } from './search';
import { splitLongTranslationText } from '../translation/text-chunker';

export interface PdfDocumentTranslationBlock {
  id: string;
  pageNumber: number;
  blockIndex: number;
  text: string;
}

export const PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH = 1_100;

export function pdfDocumentTranslationBlocks(
  pageNumber: number,
  items: readonly PdfSearchTextItem[],
): PdfDocumentTranslationBlock[] {
  const safePageNumber = Math.max(1, Math.round(pageNumber));
  const text = buildPdfSearchPageIndex(safePageNumber, items).displayText.trim();
  if (!text) return [];
  return splitLongTranslationText(text, PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH)
    .map((block, blockIndex) => ({
      id: `P${safePageNumber}B${blockIndex + 1}`,
      pageNumber: safePageNumber,
      blockIndex,
      text: block,
    }));
}

export function pdfDocumentTranslationPriority(
  block: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  currentPage: number,
): [number, number, number] {
  const distance = Math.abs(block.pageNumber - currentPage);
  const direction = block.pageNumber >= currentPage ? 0 : 1;
  return [distance, direction, block.blockIndex];
}

export function comparePdfDocumentTranslationPriority(
  left: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  right: Pick<PdfDocumentTranslationBlock, 'pageNumber' | 'blockIndex'>,
  currentPage: number,
): number {
  const leftPriority = pdfDocumentTranslationPriority(left, currentPage);
  const rightPriority = pdfDocumentTranslationPriority(right, currentPage);
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = leftPriority[index]! - rightPriority[index]!;
    if (difference) return difference;
  }
  return 0;
}
