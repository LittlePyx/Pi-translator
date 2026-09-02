import { describe, expect, it } from 'vitest';
import {
  PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH,
  comparePdfDocumentTranslationPriority,
  mergePdfDocumentTranslationContinuationBlocks,
  pdfDocumentTranslationBlockContainsFormula,
  pdfDocumentTranslationBlockKind,
  pdfDocumentTranslationContinuity,
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
        kind: 'text',
      },
      {
        str: String.raw`E=mc^2`, hasEOL: true,
        left: 120, top: 240, width: 180, height: 32,
        kind: 'formula',
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
  it('translates one sentence split across layout regions as one visual unit', () => {
    const sourceAnchor = (topRatio: number) => ({
      leftRatio: .08,
      topRatio,
      widthRatio: .72,
      heightRatio: .05,
    });
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      {
        id: 'P1B1', pageNumber: 1, blockIndex: 0,
        text: 'Furthermore, by drawing more insights', sourceAnchor: sourceAnchor(.1),
      },
      {
        id: 'P1B2', pageNumber: 1, blockIndex: 1,
        text: 'from the compression domain, an enhanced version, dubbed',
        sourceAnchor: sourceAnchor(.28),
      },
      {
        id: 'P1B3', pageNumber: 1, blockIndex: 2,
        text: 'ISTA-Net+, is derived from ISTA-Net by sparsifying natural images to',
        sourceAnchor: sourceAnchor(.48),
      },
      {
        id: 'P1B4', pageNumber: 1, blockIndex: 3,
        text: 'improve compression sensing performance. Therefore, ISTA-Nets are fast.',
        sourceAnchor: sourceAnchor(.66),
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'P1B1',
      pageNumber: 1,
      blockIndex: 0,
      text: 'Furthermore, by drawing more insights from the compression domain, ' +
        'an enhanced version, dubbed ISTA-Net+, is derived from ISTA-Net by ' +
        'sparsifying natural images to improve compression sensing performance. ' +
        'Therefore, ISTA-Nets are fast.',
    });
    expect(merged[0]!.sourceAnchor).toBeUndefined();
    expect(merged[0]!.sourceRegions).toHaveLength(4);
  });

  it('coalesces adjacent formula fragments without merging separate columns', () => {
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      {
        id: 'P1B1', pageNumber: 1, blockIndex: 0, text: 'The objective is',
        sourceAnchor: { leftRatio: .08, topRatio: .1, widthRatio: .38, heightRatio: .05 },
      },
      {
        id: 'P1B2', pageNumber: 1, blockIndex: 1, text: 'x = y', kind: 'formula',
        sourceAnchor: { leftRatio: .12, topRatio: .151, widthRatio: .3, heightRatio: .04 },
      },
      {
        id: 'P1B3', pageNumber: 1, blockIndex: 2, text: 'where x is reconstructed',
        sourceAnchor: { leftRatio: .08, topRatio: .192, widthRatio: .38, heightRatio: .05 },
      },
      {
        id: 'P1B4', pageNumber: 1, blockIndex: 3, text: 'from the measurements.',
        sourceAnchor: { leftRatio: .52, topRatio: .1, widthRatio: .38, heightRatio: .05 },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.sourceRegions).toHaveLength(2);
    expect(merged[0]!.sourceRegions?.[0]?.sourceAnchor).toMatchObject({
      leftRatio: .08,
      topRatio: .1,
    });
    expect(merged[0]!.sourceRegions?.[0]?.sourceAnchor.heightRatio).toBeCloseTo(.142);
    expect(merged[0]!.sourceRegions?.[1]?.sourceAnchor.leftRatio).toBe(.52);
  });

  it('does not merge an unpunctuated paper title into the following body', () => {
    const anchor = {
      leftRatio: .1, topRatio: .1, widthRatio: .8, heightRatio: .06,
    };
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      {
        id: 'P1B1', pageNumber: 1, blockIndex: 0,
        text: 'ISTA-Net: Interpretable Optimization-Inspired Deep Network',
        sourceAnchor: anchor,
      },
      {
        id: 'P1B2', pageNumber: 1, blockIndex: 1,
        text: 'Compressed sensing reconstructs natural images.',
        sourceAnchor: { ...anchor, topRatio: .2 },
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((block) => block.text)).toEqual([
      'ISTA-Net: Interpretable Optimization-Inspired Deep Network',
      'Compressed sensing reconstructs natural images.',
    ]);
  });

  it('keeps citation-led prose and natural-language from clauses in their paragraphs', () => {
    expect(pdfDocumentTranslationBlockKind(
      '[48, 46, 10, 52]. Metzler et al. propose to integrate the well-defined denoiser.',
    )).toBe('text');
    expect(pdfDocumentTranslationBlockKind(
      'from the compression realm, an enhanced version is derived.',
    )).toBe('text');
    expect(pdfDocumentTranslationBlockKind('from torch import nn')).toBe('code');

    const prepared = preparePdfDocumentTranslationPages([page(3, [
      positioned('Earlier methods improve CS reconstruction', 54, 100),
      positioned('[48, 46, 10, 52]. Metzler et al. propose to integrate the well-', 54, 115),
      positioned('defined BM3D denoiser into the AMP framework.', 54, 130),
      positioned('Moreover, borrowing more insights', 54, 160),
      positioned('from the compression realm, an enhanced version, dubbed', 54, 175),
      positioned('ISTA-Net+, is derived from ISTA-Net.', 54, 190),
    ])]);

    expect(prepared.blocks.map((block) => ({ text: block.text, kind: block.kind }))).toEqual([
      {
        text: 'Earlier methods improve CS reconstruction [48, 46, 10, 52]. ' +
          'Metzler et al. propose to integrate the well- defined BM3D denoiser into the AMP framework.',
        kind: undefined,
      },
      {
        text: 'Moreover, borrowing more insights from the compression realm, an enhanced version, ' +
          'dubbed ISTA-Net+, is derived from ISTA-Net.',
        kind: undefined,
      },
    ]);
  });

  it('keeps a prose line containing an inline equation out of table mode', () => {
    const prepared = preparePdfDocumentTranslationPages([page(5, [
      positioned('will enforce the symmetry constraint F ◦ F˜', 54, 100, 200),
      positioned('= I', 280, 100, 25),
      positioned('by incorporating it in training.', 330, 100, 180),
    ])]);

    expect(prepared.blocks).toHaveLength(1);
    expect(prepared.blocks[0]).toMatchObject({
      kind: 'formula',
      text: 'will enforce the symmetry constraint F ◦ F˜\t= I\tby incorporating it in training.',
    });
  });

  it('starts a generic colon-led paper subsection on a new paragraph', () => {
    const prepared = preparePdfDocumentTranslationPages([page(2, [
      positioned('The preceding discussion continues without terminal punctuation', 54, 100),
      positioned('Ablation protocol: We compare every setting.', 54, 115),
    ])]);

    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'The preceding discussion continues without terminal punctuation',
      'Ablation protocol: We compare every setting.',
    ]);
  });

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

  it('keeps consecutive full-width lines as one block on a two-column page', () => {
    const leftLines = Array.from({ length: 7 }, (_, index) => `Left column line ${index + 1}`);
    const rightLines = Array.from({ length: 7 }, (_, index) => `Right column line ${index + 1}`);
    const fullWidthLines = [
      'The full-width abstract begins with a broad statement',
      'and continues across the entire page width',
      'before ending with one coherent final line.',
    ];
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      ...leftLines.flatMap((text, index) => [
        positioned(text, 54, 60 + index * 18, 210),
        positioned(rightLines[index]!, 330, 60 + index * 18, 210),
      ]),
      ...fullWidthLines.map((text, index) => positioned(text, 54, 210 + index * 18, 500)),
    ])]);

    expect(prepared.multiColumnPages).toBe(1);
    expect(prepared.blocks.map((block) => block.text)).toEqual([
      leftLines.join(' '),
      rightLines.join(' '),
      fullWidthLines.join(' '),
    ]);
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
    expect(prepared.blocks.map((block) => block.kind ?? 'text')).toEqual([
      'text',
      'formula',
      'code',
      'text',
    ]);
  });

  it('reserves visual handling for standalone formulas while keeping mixed prose translatable', () => {
    expect(pdfDocumentTranslationBlockKind('E = mc² + λ')).toBe('formula');
    expect(pdfDocumentTranslationBlockKind('const score = model(x);')).toBe('code');
    expect(pdfDocumentTranslationBlockKind(
      'The loss L = reconstruction + regularization is minimized during training.',
    )).toBe('text');
    expect(pdfDocumentTranslationBlockContainsFormula({
      text: 'The loss $L = D + R$ is minimized during training.',
    })).toBe(true);
    expect(pdfDocumentTranslationBlockContainsFormula({
      text: 'The evaluation remains stable during training.',
    })).toBe(false);
  });

  it('tracks unfinished sentences across captions, formulas, and full-width prose', () => {
    const blocks = [
      { text: 'The reconstruction remains stable while' },
      { text: 'Figure 2. Network overview.' },
      { text: 'the full-width discussion defines the loss as' },
      { text: 'L = ||Ax-b||²', kind: 'formula' as const },
      { text: 'where b denotes the measured signal.' },
      { text: '2 Methods' },
      { text: 'A new section starts independently.' },
    ];
    expect(pdfDocumentTranslationContinuity(blocks, 2)).toMatchObject({
      previousIndex: 0,
      nextIndex: 3,
      continuesPrevious: true,
      continuesNext: true,
      skippedBefore: 1,
    });
    expect(pdfDocumentTranslationContinuity(blocks, 3)).toMatchObject({
      previousIndex: 2,
      nextIndex: 4,
      continuesPrevious: true,
      continuesNext: true,
    });
    expect(pdfDocumentTranslationContinuity(blocks, 6)).toMatchObject({
      continuesPrevious: false,
      continuesNext: false,
    });
  });

  it('keeps a prose sentence beginning with a figure reference out of the preceding formula', () => {
    const anchor = (topRatio: number, widthRatio = .38) => ({
      leftRatio: .08,
      topRatio,
      widthRatio,
      heightRatio: .02,
    });
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      {
        id: 'P5B1', pageNumber: 5, blockIndex: 0,
        text: 'The output in this module should be updated as:',
        sourceAnchor: anchor(.60),
      },
      {
        id: 'P5B2', pageNumber: 5, blockIndex: 1,
        text: 'x = F(r).\t(12)', kind: 'formula',
        sourceAnchor: anchor(.622, .30),
      },
      {
        id: 'P5B3', pageNumber: 5, blockIndex: 2,
        text: 'Figure 2 clearly illustrates how Eq. (6) with the closed-',
        sourceAnchor: anchor(.646),
      },
      {
        id: 'P5B4', pageNumber: 5, blockIndex: 3,
        text: 'form solution in Eq. (12) is mapped into a deep network in',
        sourceAnchor: anchor(.666),
      },
      {
        id: 'P5B5', pageNumber: 5, blockIndex: 4,
        text: 'the k-th phase of ISTA-Net.',
        sourceAnchor: anchor(.686, .22),
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).toBe(
      'The output in this module should be updated as: x = F(r).\t(12)',
    );
    expect(merged[0]!.text).not.toContain('form solution');
    expect(merged[1]!.text).toBe(
      'Figure 2 clearly illustrates how Eq. (6) with the closed- ' +
      'form solution in Eq. (12) is mapped into a deep network in ' +
      'the k-th phase of ISTA-Net.',
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

  it('keeps a typical academic abstract in one visual translation block', () => {
    const abstractLines = Array.from({ length: 20 }, (_, index) => (
      index === 19
        ? 'and the final abstract line completes the result.'
        : `academic abstract line ${index + 1} continues the same coherent discussion`
    ));
    const prepared = preparePdfDocumentTranslationPages([page(1,
      abstractLines.map((text, index) => positioned(text, 54, 70 + index * 13, 460, 10)),
    )]);
    expect(abstractLines.join(' ').length).toBeGreaterThan(1_100);
    expect(prepared.blocks).toHaveLength(1);
    expect(prepared.blocks[0]!.text).toBe(abstractLines.join(' '));
  });

  it('anchors every visual line in long blocks instead of cropping after four lines', () => {
    const sourceLines = Array.from({ length: 48 }, (_, index) => (
      `Source line ${index + 1} contains enough prose to exercise stable chunk mapping.`
    ));
    const prepared = preparePdfDocumentTranslationPages([page(1,
      sourceLines.map((text, index) => positioned(
        text,
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
    expect(firstAnchor.heightRatio).toBeGreaterThan(0.18);
    expect(secondAnchor.heightRatio).toBeGreaterThan(0.18);
    expect(firstAnchor.topRatio + firstAnchor.heightRatio)
      .toBeGreaterThanOrEqual(secondAnchor.topRatio - 0.03);
    for (const sourceLine of sourceLines) {
      expect(prepared.blocks.filter((block) => block.text.includes(sourceLine))).toHaveLength(1);
    }
    const anchorMemberships = sourceLines.map((_, index) => {
      const lineCenter = 70 + index * 13 + 5;
      return prepared.blocks.filter((block) => {
        const anchor = block.sourceAnchor!;
        const top = anchor.topRatio * 792;
        const bottom = top + anchor.heightRatio * 792;
        return lineCenter >= top && lineCenter <= bottom;
      }).length;
    });
    expect(anchorMemberships).toEqual(Array.from({ length: sourceLines.length }, () => 1));
  });

  it('does not split one indivisible visual line into overlapping image blocks', () => {
    const longVisualLine = Array.from({ length: 400 }, (_, index) => `token${index + 1}`).join(' ');
    expect(longVisualLine.length).toBeGreaterThan(PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH);
    const prepared = preparePdfDocumentTranslationPages([page(1, [
      positioned(longVisualLine, 54, 100, 500),
    ])]);
    expect(prepared.blocks).toHaveLength(1);
    expect(prepared.blocks[0]!.text).toBe(longVisualLine);
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
