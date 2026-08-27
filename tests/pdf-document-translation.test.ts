import { describe, expect, it } from 'vitest';
import {
  comparePdfDocumentTranslationPriority,
  pdfDocumentTranslationBlocks,
  preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationPageInput,
  type PdfDocumentTranslationTextItem,
} from '../core/pdf/document-translation';

function positioned(
  str: string,
  left: number,
  top: number,
  width = 180,
  height = 11,
): PdfDocumentTranslationTextItem {
  return { str, hasEOL: true, left, top, width, height };
}

function page(
  pageNumber: number,
  items: PdfDocumentTranslationTextItem[],
): PdfDocumentTranslationPageInput {
  return { pageNumber, pageWidth: 612, pageHeight: 792, items };
}

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

  it('reads a confident two-column paper down the left column before the right', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('Right paragraph one.', 330, 100),
      positioned('Left paragraph three.', 54, 144),
      positioned('Left paragraph one.', 54, 100),
      positioned('Right paragraph three.', 330, 144),
      positioned('Right paragraph two.', 330, 122),
      positioned('Left paragraph two.', 54, 122),
    ])]);
    const text = prepared.blocks.map((block) => block.text).join('\n');
    expect(prepared.multiColumnPages).toBe(1);
    expect(text.indexOf('Left paragraph one.')).toBeLessThan(text.indexOf('Left paragraph three.'));
    expect(text.indexOf('Left paragraph three.')).toBeLessThan(text.indexOf('Right paragraph one.'));
    expect(text.indexOf('Right paragraph one.')).toBeLessThan(text.indexOf('Right paragraph three.'));
  });

  it('keeps a spanning title before both body columns', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('A Layout-Aware Translation Study', 54, 38, 500, 16),
      ...[0, 1, 2].flatMap((index) => [
        positioned(`Left body ${index + 1}.`, 54, 100 + index * 22),
        positioned(`Right body ${index + 1}.`, 330, 100 + index * 22),
      ]),
    ])]);
    const text = prepared.blocks[0]!.text;
    expect(prepared.multiColumnPages).toBe(1);
    expect(text.startsWith('A Layout-Aware Translation Study')).toBe(true);
    expect(text.indexOf('Left body 3.')).toBeLessThan(text.indexOf('Right body 1.'));
    expect(prepared.blocks[0]!.sourceAnchor).toMatchObject({
      topRatio: expect.any(Number),
      leftRatio: expect.any(Number),
      widthRatio: expect.any(Number),
      heightRatio: expect.any(Number),
    });
    expect(prepared.blocks[0]!.sourceAnchor!.topRatio).toBeLessThan(0.08);
  });

  it('preserves table cells by row instead of reading down inferred columns', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('Model', 64, 100, 60),
      positioned('Score', 224, 100, 50),
      positioned('Time', 384, 100, 45),
      positioned('Pi', 64, 138, 30),
      positioned('98', 224, 138, 20),
      positioned('1.2 s', 384, 138, 40),
    ])]);
    expect(prepared.multiColumnPages).toBe(0);
    expect(prepared.blocks[0]!.text).toContain('Model\tScore\tTime\nPi\t98\t1.2 s');
  });

  it('removes only repeated headers and page-number footers across pages', () => {
    const prepared = preparePdfDocumentTranslationPages([
      page(1, [
        positioned('Pi Translator Research Report', 120, 15, 280),
        positioned('First page body remains.', 54, 100, 220),
        positioned('Page 1', 280, 770, 45),
      ]),
      page(2, [
        positioned('Pi Translator Research Report', 120, 15, 280),
        positioned('Second page body remains.', 54, 100, 230),
        positioned('Page 2', 280, 770, 45),
      ]),
    ]);
    const text = prepared.blocks.map((block) => block.text).join('\n');
    expect(prepared.removedRepeatedMarginLines).toBe(4);
    expect(text).toContain('First page body remains.');
    expect(text).toContain('Second page body remains.');
    expect(text).not.toContain('Research Report');
    expect(text).not.toContain('Page 1');
    expect(text).not.toContain('Page 2');
  });

  it('keeps formulas with equation numbers and code on explicit structure lines', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('The objective is defined below.', 54, 90, 220),
      positioned('E = mc² + λ', 120, 120, 180),
      positioned('(12)', 520, 120, 28),
      positioned('const score = model(x);', 54, 150, 190),
      positioned('The evaluation then continues.', 54, 180, 220),
    ])]);
    expect(prepared.blocks[0]!.text).toContain(
      'The objective is defined below.\nE = mc² + λ\t(12)\nconst score = model(x);\nThe evaluation then continues.',
    );
  });

  it('does not mistake ordinary Korean prose for mathematical alphanumeric symbols', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('한국어 문장은 일반 본문입니다.', 54, 100, 210),
      positioned('다음 줄은 같은 문단으로 이어집니다.', 54, 122, 240),
    ])]);
    expect(prepared.blocks[0]!.text).toBe(
      '한국어 문장은 일반 본문입니다. 다음 줄은 같은 문단으로 이어집니다.',
    );
  });

  it('anchors later long-page blocks near their own source instead of the page top', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1,
      Array.from({ length: 48 }, (_, index) => positioned(
        `Source line ${index + 1} contains enough prose to exercise stable chunk mapping.`,
        54,
        70 + index * 13,
        360,
        10,
      )),
    )]);
    expect(prepared.blocks.length).toBeGreaterThan(1);
    const firstAnchor = prepared.blocks[0]!.sourceAnchor!;
    const secondAnchor = prepared.blocks[1]!.sourceAnchor!;
    expect(firstAnchor.topRatio).toBeLessThan(secondAnchor.topRatio);
    expect(firstAnchor.heightRatio).toBeLessThan(0.1);
    expect(secondAnchor.heightRatio).toBeLessThan(0.1);
  });
});
