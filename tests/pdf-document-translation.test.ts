import { describe, expect, it } from 'vitest';
import {
  comparePdfDocumentTranslationPriority,
  pdfDocumentTranslationItemsFromOcr,
  pdfDocumentTranslationBlocks,
  preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationPageInput,
  type PdfDocumentTranslationTextItem,
} from '../core/pdf/document-translation';

describe('PDF document translation OCR input', () => {
  it('keeps trusted upright text and formulas in provider reading order', () => {
    const items = pdfDocumentTranslationItemsFromOcr({
      pageNumber: 3,
      coordinateSystem: 'normalized-page',
      blocks: [
        {
          id: 'text', order: 0, text: 'Scanned paragraph.', confidence: 0.91,
          kind: 'text', box: { left: .1, top: .2, width: .7, height: .05 },
        },
        {
          id: 'formula', order: 1, text: String.raw`E=mc^2`, confidence: 0.9,
          kind: 'formula', box: { left: .2, top: .3, width: .3, height: .04 },
        },
        {
          id: 'low', order: 2, text: 'Uncertain.', confidence: 0.5,
          kind: 'text', box: { left: .1, top: .4, width: .4, height: .04 },
        },
        {
          id: 'rotated', order: 3, text: 'Margin.', confidence: 0.95,
          kind: 'text', rotationDegrees: 90,
          box: { left: .02, top: .2, width: .04, height: .5 },
        },
      ],
    }, 600, 800);

    expect(items).toEqual([
      {
        str: 'Scanned paragraph.', hasEOL: true,
        left: 60, top: 160, width: 420, height: 40,
      },
      {
        str: String.raw`E=mc^2`, hasEOL: true,
        left: 120, top: 240, width: 180, height: 32,
      },
    ]);
  });
});

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
    const text = prepared.blocks.map((block) => block.text).join('\n');
    expect(prepared.multiColumnPages).toBe(1);
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'A Layout-Aware Translation Study',
      'Left body 1. Left body 2. Left body 3.',
      'Right body 1. Right body 2. Right body 3.',
    ]);
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
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'Model\tScore\tTime',
      'Pi\t98\t1.2 s',
    ]);
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
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'The objective is defined below.',
      'E = mc² + λ\t(12)',
      'const score = model(x);',
      'The evaluation then continues.',
    ]);
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

  it('merges visual line wraps but starts a new block at a first-line indent', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('The first paragraph wraps across', 54, 100, 250),
      positioned('two visual lines and ends here.', 54, 115, 230),
      positioned('A newly indented paragraph starts here', 66, 130, 260),
      positioned('and its continuation returns to the margin.', 54, 145, 290),
    ])]);
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'The first paragraph wraps across two visual lines and ends here.',
      'A newly indented paragraph starts here and its continuation returns to the margin.',
    ]);
  });

  it('uses a larger vertical gap and section heading as paragraph boundaries', () => {
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned('Opening body line one', 54, 90, 200),
      positioned('continues on line two.', 54, 105, 190),
      positioned('A second paragraph begins after spacing', 54, 135, 270),
      positioned('and keeps its wrapped continuation.', 54, 150, 240),
      positioned('2 Methods:', 54, 180, 90),
      positioned('The method description follows the heading.', 54, 205, 290),
    ])]);
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'Opening body line one continues on line two.',
      'A second paragraph begins after spacing and keeps its wrapped continuation.',
      '2 Methods:',
      'The method description follows the heading.',
    ]);
  });
});
