import { describe, expect, it } from 'vitest';
import {
  comparePdfDocumentTranslationPriority,
  pdfDocumentTranslationBlocks,
} from '../core/pdf/document-translation';

describe('PDF document translation', () => {
  it('creates stable page-scoped blocks from PDF text items', () => {
    const blocks = pdfDocumentTranslationBlocks(3, [
      { str: 'A reliable', hasEOL: false },
      { str: 'PDF translator.', hasEOL: true },
      { str: '第二段中文。', hasEOL: true },
    ]);
    expect(blocks).toEqual([{
      id: 'P3B1',
      pageNumber: 3,
      blockIndex: 0,
      text: 'A reliable PDF translator. 第二段中文。',
    }]);
  });

  it('keeps the current page first, then later pages before earlier pages', () => {
    const blocks = [
      { pageNumber: 1, blockIndex: 0 },
      { pageNumber: 5, blockIndex: 0 },
      { pageNumber: 4, blockIndex: 1 },
      { pageNumber: 4, blockIndex: 0 },
      { pageNumber: 3, blockIndex: 0 },
    ];
    expect([...blocks].sort((left, right) => (
      comparePdfDocumentTranslationPriority(left, right, 4)
    ))).toEqual([
      { pageNumber: 4, blockIndex: 0 },
      { pageNumber: 4, blockIndex: 1 },
      { pageNumber: 5, blockIndex: 0 },
      { pageNumber: 3, blockIndex: 0 },
      { pageNumber: 1, blockIndex: 0 },
    ]);
  });
});
