import { describe, expect, it } from 'vitest';
import {
  PDF_DOCUMENT_TRANSLATION_BLOCK_LENGTH,
  comparePdfDocumentTranslationPriority,
  groupPdfDocumentTranslationVisualObjects,
  mergePdfDocumentTranslationContinuationBlocks,
  mergePdfCrossPageContinuations,
  pdfDocumentTranslationBlockContainsFormula,
  pdfDocumentTranslationBlockKind,
  pdfDocumentTranslationContinuity,
  pdfDocumentTranslationHeadingLevel,
  pdfDocumentTranslationItemsFromOcr,
  pdfDocumentTranslationBlocks,
  preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationPageInput,
  type PdfDocumentTranslationTextItem,
} from '../core/pdf/document-translation';

describe('PDF document translation OCR input', () => {
  it('keeps Qwen mixed prose as prose while preserving actual standalone equations',()=>{
    const base={confidence:.9,confidenceSource:'trusted-adapter' as const,kind:'formula' as const};
    const items=pdfDocumentTranslationItemsFromOcr({pageNumber:1,source:'qwen-advanced-recognition',coordinateSystem:'normalized-page',blocks:[
      {...base,id:'prose',order:0,text:'Any $n$-tuple of strategies can be regarded as a point.',box:{left:.1,top:.1,width:.8,height:.04}},
      {...base,id:'eq',order:1,text:'$Q_n \\to Q, P_n \\to P$',box:{left:.2,top:.2,width:.6,height:.04}},
    ]},600,800);
    expect(items.map(item=>item.kind)).toEqual(['text','formula']);expect(items[0]!.str).toContain('$n$');
  });
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

describe('PDF source section hierarchy', () => {
  it('keeps chapter and subsection depths, including familiar unnumbered sections', () => {
    for (const [text, level] of [
      ['3. Related research', 1], ['3.1. Gaussian Processes', 2],
      ['4.2.1. MNIST', 3], ['4.2.1.1. Detailed results', 3],
      ['Abstract', 1], ['Acknowledgements', 1], ['References', 1], ['II. Proposed Method', 1],
    ] as const) expect(pdfDocumentTranslationHeadingLevel({text})).toBe(level);
  });

  it('leaves numbered prose, math, footnotes, citations and uncertain body text alone', () => {
    for (const text of [
      '1. A CNP is a conditional distribution over functions',
      '2. A CNP is permutation invariant in O and T.',
      '3. The algorithm requires linear storage', 'A normal paragraph.',
      '2021. 3', '1 School of Engineering', 'D. Author', '(4)', '[12] Related work',
    ]) expect(pdfDocumentTranslationHeadingLevel({text})).toBeUndefined();
    for (const kind of ['footnote', 'code', 'formula', 'figure', 'table'] as const)
      expect(pdfDocumentTranslationHeadingLevel({text: '1. Introduction', kind})).toBeUndefined();
  });
});

describe('PDF numbered prose list paragraphs', () => {
  it('keeps a hyphenated word with a formula-bearing continuation across pages',()=>{
    const result=mergePdfCrossPageContinuations([
      {id:'a',pageNumber:2,blockIndex:0,text:'A known transformation func-',sourceAnchor:{leftRatio:.1,topRatio:.9,widthRatio:.4,heightRatio:.04}},
      {id:'b',pageNumber:3,blockIndex:0,kind:'formula',text:'tion). For example z = mu + sigma e.',sourceAnchor:{leftRatio:.1,topRatio:.08,widthRatio:.4,heightRatio:.08}},
    ]);
    expect(result).toHaveLength(1);expect(result[0]!.text).toContain('function). For example');expect(result[0]!.kind).toBe('formula');expect(result[0]!.sourceRegions?.map(r=>r.pageNumber)).toEqual([2,3]);
    expect(mergePdfCrossPageContinuations([
      {id:'a',pageNumber:2,blockIndex:0,text:'A known transformation.',sourceAnchor:{leftRatio:.1,topRatio:.9,widthRatio:.4,heightRatio:.04}},
      {id:'b',pageNumber:3,blockIndex:0,kind:'formula',text:'x = y + z',sourceAnchor:{leftRatio:.1,topRatio:.08,widthRatio:.4,heightRatio:.08}},
    ])).toHaveLength(2);
  });
  it('keeps a wrapped scientific claim in one item without swallowing the next item or heading', () => {
    const result = preparePdfDocumentTranslationPages([{
      pageNumber: 1, pageWidth: 600, pageHeight: 800, items: [
        positioned('In summary,', 54, 80, 150),
        positioned('1. A CNP is a conditional distribution over functions', 64, 105, 290),
        positioned('trained to model the empirical conditional distributions', 78, 120, 290),
        positioned('of functions f ~ P.', 78, 135, 180),
        positioned('2. A CNP is permutation invariant in O and T.', 64, 160, 290),
        positioned('3. A CNP has linear prediction complexity.', 64, 185, 290),
        positioned('3. Related research', 54, 220, 170, 14),
        positioned('The next section starts a separate paragraph.', 54, 245, 300),
      ],
    }]);
    expect(result.blocks.map(block => block.text)).toEqual([
      'In summary,',
      '1. A CNP is a conditional distribution over functions trained to model the empirical conditional distributions of functions f ~ P.',
      '2. A CNP is permutation invariant in O and T.',
      '3. A CNP has linear prediction complexity.',
      '3. Related research',
      'The next section starts a separate paragraph.',
    ]);
    const claim = result.blocks[1]!;
    const regions = claim.sourceRegions ?? [{ pageNumber: 1, sourceAnchor: claim.sourceAnchor! }];
    expect(Math.min(...regions.map(region => region.sourceAnchor.topRatio))).toBeLessThan(105 / 800);
    expect(Math.max(...regions.map(region => region.sourceAnchor.topRatio + region.sourceAnchor.heightRatio))).toBeLessThan(160 / 800);
  });

  it('does not join different list items even when the previous item ends with a connector', () => {
    const blocks = mergePdfDocumentTranslationContinuationBlocks([
      { id: 'a', pageNumber: 1, blockIndex: 0, text: '1. A model has observations and', sourceAnchor: { leftRatio: .1, topRatio: .2, widthRatio: .4, heightRatio: .04 } },
      { id: 'b', pageNumber: 1, blockIndex: 1, text: '2. A model has targets.', sourceAnchor: { leftRatio: .1, topRatio: .25, widthRatio: .4, heightRatio: .04 } },
    ]);
    expect(blocks).toHaveLength(2);
  });

  it('joins a wrapped pair of equation references without treating it as a numbered list', () => {
    const merged=mergePdfDocumentTranslationContinuationBlocks([
      {id:'a',pageNumber:1,blockIndex:0,kind:'formula',text:'We illustrate the transformations defined by',sourceAnchor:{leftRatio:.1,topRatio:.2,widthRatio:.4,heightRatio:.05}},
      {id:'b',pageNumber:1,blockIndex:1,text:'(10) and (14) in figure 1. Both maps are invertible.',sourceAnchor:{leftRatio:.1,topRatio:.26,widthRatio:.4,heightRatio:.05}},
    ]);
    expect(merged).toHaveLength(1);expect(merged[0]!.text).toContain('defined by (10) and (14) in figure 1.');
    expect(mergePdfDocumentTranslationContinuationBlocks([
      {id:'a',pageNumber:1,blockIndex:0,text:'The first item is',sourceAnchor:{leftRatio:.1,topRatio:.2,widthRatio:.4,heightRatio:.05}},
      {id:'b',pageNumber:1,blockIndex:1,text:'(2) a separate claim.',sourceAnchor:{leftRatio:.1,topRatio:.26,widthRatio:.4,heightRatio:.05}},
    ])).toHaveLength(2);
  });

  it('does not mistake a wrapped author initial for the next body list item', () => {
    const result = preparePdfDocumentTranslationPages([{
      pageNumber: 9, pageWidth: 600, pageHeight: 800, items: [
        positioned('Blundell, C., Cornebise, J., and Wierstra,', 54, 100, 300),
        positioned('D. Weight uncertainty in neural networks.', 54, 115, 300),
        positioned('arXiv preprint, 2015.', 54, 130, 180),
      ],
    }]);
    expect(result.blocks.map(block => block.text)).toEqual([
      'Blundell, C., Cornebise, J., and Wierstra, D. Weight uncertainty in neural networks. arXiv preprint, 2015.',
    ]);
  });
});

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

  it('keeps an equation constraint together when its numeric range wraps into the next block', () => {
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      {
        id: 'P5B1', pageNumber: 5, blockIndex: 0,
        text: 'satisfying the symmetry constraint F-tilde(k) o F(k) = I for every k =',
        kind: 'formula',
        sourceAnchor: { leftRatio: .5, topRatio: .46, widthRatio: .39, heightRatio: .09 },
      },
      {
        id: 'P5B2', pageNumber: 5, blockIndex: 1,
        text: '1, ..., Np. Therefore, we design the end-to-end loss function as follows:',
        sourceAnchor: { leftRatio: .5, topRatio: .55, widthRatio: .39, heightRatio: .05 },
      },
      {
        id: 'P5B3', pageNumber: 5, blockIndex: 2,
        text: 'Ltotal = Ldiscrepancy + gamma Lconstraint. (13)',
        kind: 'formula',
        sourceAnchor: { leftRatio: .56, topRatio: .60, widthRatio: .31, heightRatio: .04 },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'P5B1',
      kind: 'formula',
      text: 'satisfying the symmetry constraint F-tilde(k) o F(k) = I for every k = ' +
        '1, ..., Np. Therefore, we design the end-to-end loss function as follows: ' +
        'Ltotal = Ldiscrepancy + gamma Lconstraint. (13)',
    });
    expect(merged[0]!.sourceRegions).toHaveLength(1);
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

  it('keeps a wrapped inline citation with the preceding prose line', () => {
    const prepared = preparePdfDocumentTranslationPages([page(2, [
      positioned('operators (LASSO) [47]. TVAL3', 54, 100, 500),
      positioned('[23] using total variation regularization, and D-AMP [32]', 54, 115, 500),
      positioned('uses a denoising prior to reconstruct visual information.', 54, 130, 500),
    ])]);

    expect(prepared.blocks.map((block) => block.text)).toEqual([
      'operators (LASSO) [47]. TVAL3 [23] using total variation regularization, ' +
        'and D-AMP [32] uses a denoising prior to reconstruct visual information.',
    ]);
  });

  it('keeps genuine numbered reference entries as separate paragraphs', () => {
    const prepared = preparePdfDocumentTranslationPages([page(9, [
      positioned('[22] J. Smith. A reconstruction method.', 54, 100, 500),
      positioned('[23] A. Jones. A learned reconstruction method.', 54, 115, 500),
    ])]);

    expect(prepared.blocks.map((block) => block.text)).toEqual([
      '[22] J. Smith. A reconstruction method.',
      '[23] A. Jones. A learned reconstruction method.',
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

  it('keeps inline superscripts and subscripts on their surrounding prose line', () => {
    const prepared = preparePdfDocumentTranslationPages([page(4, [
      positioned('denoiser with learnable parameters θ. The initialization in-', 50, 100, 240, 10),
      positioned('put is', 50, 115, 24, 10),
      positioned('X', 78, 115, 8, 10),
      positioned('0', 86, 119.5, 4, 7),
      positioned('=', 96, 115, 8, 10),
      positioned('Φ', 108, 115, 8, 10),
      positioned('⊤', 116, 113.5, 6, 7),
      positioned('YΨ. Regarding the design of', 123, 115, 118, 10),
      positioned('D', 244, 115, 8, 10),
      positioned('(θ,k)', 252, 119.5, 18, 7),
      positioned(', we', 270, 115, 18, 10),
      positioned('propose a hybrid-attention Transformer as a building block,', 50, 130, 238, 10),
      positioned('which will be introduced in detail in Sec. 3.2.', 50, 145, 210, 10),
    ])]);

    expect(prepared.blocks).toHaveLength(1);
    expect(prepared.blocks[0]!.text).toContain(
      'The initialization in- put is X0 = Φ⊤YΨ. Regarding the design of D(θ,k), we propose',
    );
    expect(prepared.blocks[0]!.sourceAnchor!.topRatio).toBeLessThan(.13);
    expect(prepared.blocks[0]!.sourceAnchor!.heightRatio).toBeGreaterThan(.06);
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

  it('does not bridge staggered columns through inline script atoms', () => {
    const leftTops = Array.from({ length: 6 }, (_, index) => 100 + index * 11.95);
    const rightTops = leftTops.map((top) => top + 5.3);
    const prepared = preparePdfDocumentTranslationPages([page(4, [
      positioned('The denoiser D', 54, leftTops[0]!, 64, 10),
      positioned('(θ,k)', 118, leftTops[0]! + 4.5, 18, 7),
      positioned('uses trainable parameters', 139, leftTops[0]!, 110, 10),
      ...leftTops.slice(1).map((top, index) => positioned(
        index === 4 ? 'Left column ends here.' : `Left continuation ${index + 2}`,
        54,
        top,
        220,
        10,
      )),
      ...rightTops.map((top, index) => positioned(
        index === 5 ? 'Right column ends here.' : `Right continuation ${index + 1}`,
        330,
        top,
        220,
        10,
      )),
    ])]);

    expect(prepared.multiColumnPages).toBe(1);
    expect(prepared.blocks[0]!.text).toBe(
      'The denoiser D(θ,k) uses trainable parameters Left continuation 2 ' +
      'Left continuation 3 Left continuation 4 Left continuation 5 Left column ends here.',
    );
    expect(prepared.blocks[1]!.text).toBe(
      'Right continuation 1 Right continuation 2 Right continuation 3 ' +
      'Right continuation 4 Right continuation 5 Right column ends here.',
    );
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

  it('keeps a full-width formula-bearing caption separate from both body columns', () => {
    const leftLines = [
      'The design is illustrated in Figure 2.',
      'Rather than fixed transforms, learnable mappings are adopted.',
      'Every stage follows the optimization process.',
      'The parameters are learned end to end.',
      'Residual information improves reconstruction.',
      'The resulting network remains interpretable.',
      'Training uses paired measurements and images.',
      'This paragraph ends before the next section.',
    ];
    const rightLines = Array.from(
      { length: 8 },
      (_, index) => `Right column contribution ${index + 1} remains ordinary prose.`,
    );
    const captionLines = [
      'Figure 2. Illustration of our proposed ISTA-Net framework.',
      'Specifically, ISTA-Net is composed of Np phases, and each phase is one iteration.',
      'The forward transform F(k) and backward transform F-tilde(k) are learnable.',
    ];
    const prepared = preparePdfDocumentTranslationPages([page(2, [
      ...captionLines.map((text, index) => positioned(text, 54, 60 + index * 15, 500)),
      ...leftLines.flatMap((text, index) => [
        positioned(text, 54, 190 + index * 18, 220),
        positioned(rightLines[index]!, 330, 190 + index * 18, 220),
      ]),
    ])]);

    expect(prepared.multiColumnPages).toBe(1);
    const figures = prepared.blocks.filter((block) => block.kind === 'figure');
    expect(figures).toHaveLength(1);
    expect(figures[0]!.text).toBe(captionLines.join(' '));
    expect(figures[0]!.sourceAnchor!.widthRatio).toBeGreaterThan(.8);
    const referencedProse = prepared.blocks.find((block) => (
      block.text.includes('illustrated in Figure 2.')
    ));
    expect(referencedProse?.kind).toBeUndefined();
    expect(referencedProse?.text).toContain('Rather than fixed transforms');
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
      'Model\tScore\tTime\nPi\t98\t1.2 s',
    ]);
    expect(prepared.blocks[0]!.kind).toBe('table');
  });

  it('collapses a vector chart and its caption into one whole-figure block', () => {
    const anchor = (
      leftRatio: number,
      topRatio: number,
      widthRatio: number,
      heightRatio = .018,
    ) => ({ leftRatio, topRatio, widthRatio, heightRatio });
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P6B1', pageNumber: 6, blockIndex: 0, text: '32.5 32 31.5',
        sourceAnchor: anchor(.075, .103, .06),
      },
      {
        id: 'P6B2', pageNumber: 6, blockIndex: 1, text: 'PSNR (dB)\t31\tISTA-Net+',
        kind: 'table', sourceAnchor: anchor(.08, .125, .33),
      },
      {
        id: 'P6B3', pageNumber: 6, blockIndex: 2, text: '30.5\tISTA-Net',
        kind: 'table', sourceAnchor: anchor(.08, .15, .31),
      },
      {
        id: 'P6B4', pageNumber: 6, blockIndex: 3, text: '5\t10\t15',
        kind: 'formula', sourceAnchor: anchor(.13, .19, .24),
      },
      {
        id: 'P6B5', pageNumber: 6, blockIndex: 4, text: 'Phase Number Np',
        sourceAnchor: anchor(.18, .215, .18),
      },
      {
        id: 'P6B6', pageNumber: 6, blockIndex: 5, text: '0\t50\t100\t150\t200',
        kind: 'formula', sourceAnchor: anchor(.13, .255, .28),
      },
      {
        id: 'P6B7', pageNumber: 6, blockIndex: 6,
        text: 'Epoch Number in Training Figure 4. PSNR comparison between ISTA-Net and ISTA-Net+.',
        sourceAnchor: anchor(.075, .285, .398, .026),
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      id: 'P6B1',
      pageNumber: 6,
      blockIndex: 0,
      kind: 'figure',
      text: 'Figure 4. PSNR comparison between ISTA-Net and ISTA-Net+.',
    });
    expect(grouped[0]!.sourceAnchor!.topRatio).toBeLessThan(.1);
    expect(grouped[0]!.sourceAnchor!.heightRatio).toBeGreaterThan(.2);
  });

  it('captures a tall vector diagram with more than 28 text fragments', () => {
    const fragments = Array.from({ length: 44 }, (_, index) => ({
      id: `P4B${index + 1}`,
      pageNumber: 4,
      blockIndex: index,
      text: `Stage ${index + 1}`,
      kind: 'table' as const,
      sourceAnchor: {
        leftRatio: index % 2 ? .48 : .08,
        topRatio: .085 + index * .01,
        widthRatio: .28,
        heightRatio: .009,
      },
    }));
    const grouped = groupPdfDocumentTranslationVisualObjects([
      ...fragments,
      {
        id: 'P4B45', pageNumber: 4, blockIndex: 44,
        text: 'Figure 2. Illustration of the proposed reconstruction network.',
        sourceAnchor: { leftRatio: .07, topRatio: .535, widthRatio: .84, heightRatio: .035 },
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.kind).toBe('figure');
    expect(grouped[0]!.sourceAnchor!.topRatio).toBeLessThan(.08);
    expect(grouped[0]!.sourceAnchor!.heightRatio).toBeGreaterThan(.49);
  });

  it('suppresses text-layer chart fragments contained by an inferred figure crop', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P8B1', pageNumber: 8, blockIndex: 0,
        text: '32.4 32.2 32 31.8 31.6 PSNR (dB) 31.4 31.2 31 30.8 30.6',
        sourceAnchor: { leftRatio: .118, topRatio: .096, widthRatio: .056, heightRatio: .164 },
      },
      {
        id: 'P8B2', pageNumber: 8, blockIndex: 1,
        text: '20 40 60 80 100 120 140 160 180 200',
        sourceAnchor: { leftRatio: .157, topRatio: .258, widthRatio: .263, heightRatio: .012 },
      },
      {
        id: 'P8B3', pageNumber: 8, blockIndex: 2,
        text: 'Figure 6. PSNR comparison between two ISTA-Net+ variants.',
        sourceAnchor: { leftRatio: .076, topRatio: .282, widthRatio: .398, heightRatio: .029 },
      },
      {
        id: 'P8B4', pageNumber: 8, blockIndex: 3, text: 'f\tf', kind: 'formula',
        sourceAnchor: { leftRatio: .31, topRatio: .297, widthRatio: .082, heightRatio: .015 },
      },
      {
        id: 'P8B5', pageNumber: 8, blockIndex: 4,
        text: 'Table 3. Average PSNR comparison.',
        sourceAnchor: { leftRatio: .068, topRatio: .308, widthRatio: .414, heightRatio: .118 },
      },
      {
        id: 'P8B6', pageNumber: 8, blockIndex: 5,
        text: 'The discussion below the figure remains ordinary prose.',
        sourceAnchor: { leftRatio: .076, topRatio: .45, widthRatio: .398, heightRatio: .04 },
      },
    ]);

    expect(grouped.map((block) => ({ kind: block.kind, text: block.text }))).toEqual([
      {
        kind: 'figure',
        text: 'Figure 6. PSNR comparison between two ISTA-Net+ variants.',
      },
      { kind: undefined, text: 'Table 3. Average PSNR comparison.' },
      { kind: undefined, text: 'The discussion below the figure remains ordinary prose.' },
    ]);
    expect(grouped[0]!.sourceAnchor!.topRatio).toBeLessThan(.12);
    expect(grouped[0]!.sourceAnchor!.heightRatio).toBeGreaterThan(.2);
  });

  it('keeps a table caption and all adjacent rows in one table object', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P7B1', pageNumber: 7, blockIndex: 0,
        text: 'Table 1. Average PSNR performance.',
        sourceAnchor: { leftRatio: .075, topRatio: .30, widthRatio: .82, heightRatio: .05 },
      },
      {
        id: 'P7B2', pageNumber: 7, blockIndex: 1,
        text: 'Algorithm\tCS Ratio', kind: 'table',
        sourceAnchor: { leftRatio: .15, topRatio: .35, widthRatio: .33, heightRatio: .026 },
      },
      {
        id: 'P7B3', pageNumber: 7, blockIndex: 2,
        text: '50%\t40%\t30%\tTime\tFPS', kind: 'table',
        sourceAnchor: { leftRatio: .14, topRatio: .345, widthRatio: .68, heightRatio: .085 },
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      kind: 'table',
      text: 'Table 1. Average PSNR performance.\n' +
        'Algorithm\tCS Ratio\n50%\t40%\t30%\tTime\tFPS',
    });
  });

  it('keeps a raster figure caption wrap together and expands to the image above', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P7B1', pageNumber: 7, blockIndex: 0,
        text: 'Figure 5. Comparison of seven reconstruction methods applied to the image',
        sourceAnchor: { leftRatio: .075, topRatio: .269, widthRatio: .82, heightRatio: .02 },
      },
      {
        id: 'P7B2', pageNumber: 7, blockIndex: 1,
        text: 'in Set11 (CS ratio is 25%).',
        sourceAnchor: { leftRatio: .075, topRatio: .284, widthRatio: .17, heightRatio: .019 },
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      kind: 'figure',
      text: 'Figure 5. Comparison of seven reconstruction methods applied to the image ' +
        'in Set11 (CS ratio is 25%).',
    });
    expect(grouped[0]!.sourceAnchor!.topRatio).toBe(0);
    expect(grouped[0]!.sourceAnchor!.heightRatio).toBeGreaterThan(.3);
  });

  it('uses preceding prose as the upper boundary for a tall raster figure', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P4B1', pageNumber: 4, blockIndex: 0,
        text: 'The preceding paragraph ends before the full-page figure.',
        sourceAnchor: { leftRatio: .07, topRatio: .07, widthRatio: .84, heightRatio: .05 },
      },
      {
        id: 'P4B2', pageNumber: 4, blockIndex: 1,
        text: 'Figure 3. A tall qualitative comparison across all reconstruction stages.',
        sourceAnchor: { leftRatio: .07, topRatio: .72, widthRatio: .84, heightRatio: .04 },
      },
    ]);

    const figure = grouped.find((block) => block.kind === 'figure');
    expect(figure?.sourceAnchor?.topRatio).toBeCloseTo(.128);
    expect(figure?.sourceAnchor?.heightRatio).toBeGreaterThan(.63);
    expect(grouped[0]!.text).toContain('preceding paragraph');
  });

  it('keeps a short structured continuation in its figure caption', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P7B1', pageNumber: 7, blockIndex: 0,
        text: 'Figure 4. Experimental results under different illumination at',
        sourceAnchor: { leftRatio: .08, topRatio: .28, widthRatio: .4, heightRatio: .025 },
      },
      {
        id: 'P7B2', pageNumber: 7, blockIndex: 1,
        text: 'SR = 25%.', kind: 'code',
        sourceAnchor: { leftRatio: .08, topRatio: .305, widthRatio: .09, heightRatio: .02 },
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      kind: 'figure',
      text: 'Figure 4. Experimental results under different illumination at SR = 25%.',
    });
  });

  it('does not extend a figure crop into a captioned table above it', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P6B1', pageNumber: 6, blockIndex: 0,
        text: 'Table 1. Average reconstruction performance.',
        sourceAnchor: { leftRatio: .07, topRatio: .08, widthRatio: .84, heightRatio: .035 },
      },
      {
        id: 'P6B2', pageNumber: 6, blockIndex: 1,
        text: 'Method\t10%\t25%\t50%', kind: 'table',
        sourceAnchor: { leftRatio: .15, topRatio: .12, widthRatio: .68, heightRatio: .05 },
      },
      {
        id: 'P6B3', pageNumber: 6, blockIndex: 2,
        text: 'HATNet\t32.26\t37.24\t42.05', kind: 'table',
        sourceAnchor: { leftRatio: .15, topRatio: .17, widthRatio: .68, heightRatio: .11 },
      },
      {
        id: 'P6B4', pageNumber: 6, blockIndex: 3,
        text: 'Figure 3. Visualization of different reconstruction methods.',
        sourceAnchor: { leftRatio: .2, topRatio: .62, widthRatio: .58, heightRatio: .035 },
      },
    ]);

    const table = grouped.find((block) => block.kind === 'table');
    const figure = grouped.find((block) => block.kind === 'figure');
    expect(table).toBeDefined();
    expect(figure?.sourceAnchor?.topRatio).toBeGreaterThan(.28);
    expect(figure?.sourceAnchor?.topRatio).toBeLessThan(.32);
    expect(figure?.sourceAnchor?.topRatio).toBeGreaterThan(
      table!.sourceAnchor!.topRatio + table!.sourceAnchor!.heightRatio,
    );
  });

  it('stops a table object before following prose and a numbered section', () => {
    const grouped = groupPdfDocumentTranslationVisualObjects([
      {
        id: 'P7B1', pageNumber: 7, blockIndex: 0,
        text: 'Table 2. Average performance.',
        sourceAnchor: { leftRatio: .5, topRatio: .49, widthRatio: .4, heightRatio: .03 },
      },
      {
        id: 'P7B2', pageNumber: 7, blockIndex: 1,
        text: 'Algorithm\tCS Ratio', kind: 'table',
        sourceAnchor: { leftRatio: .51, topRatio: .52, widthRatio: .32, heightRatio: .02 },
      },
      {
        id: 'P7B3', pageNumber: 7, blockIndex: 2,
        text: 'ISTA-Net+\t34.01\t32.21', kind: 'table',
        sourceAnchor: { leftRatio: .51, topRatio: .56, widthRatio: .36, heightRatio: .02 },
      },
      {
        id: 'P7B4', pageNumber: 7, blockIndex: 3,
        text: 'The measurement matrix usually takes less than 1 second.',
        sourceAnchor: { leftRatio: .5, topRatio: .60, widthRatio: .4, heightRatio: .03 },
      },
      {
        id: 'P7B5', pageNumber: 7, blockIndex: 4,
        text: '5.3. Comparison with ADMM-Net',
        sourceAnchor: { leftRatio: .5, topRatio: .65, widthRatio: .37, heightRatio: .02 },
      },
    ]);

    expect(grouped.map((block) => block.kind ?? 'text')).toEqual(['table', 'text', 'text']);
    expect(grouped[0]!.text).not.toContain('measurement matrix');
    expect(grouped[0]!.text).not.toContain('5.3.');
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

  it('groups a small numbered page-bottom footnote without treating it as a section heading', () => {
    const prepared = preparePdfDocumentTranslationPages([page(6, [
      ...Array.from({ length: 7 }, (_, index) => positioned(
        index === 6
          ? 'From Table 1, we observe that the comparison continues on the next page'
          : `Main body line ${index + 1} remains in the right column`,
        309,
        570 + index * 12,
        236,
        10,
      )),
      positioned('1', 320, 683, 3, 6),
      positioned('We use the source code made publicly available by the authors of T-', 323, 684, 222, 8),
      positioned('VAL3 [22], D-AMP [28], IRCNN [49], and ReconNet [21] and implement', 309, 694, 236, 8),
      positioned('SDA [30] ourselves, since its source code is not available.', 309, 704, 185, 8),
      positioned('1833', 297, 748, 18, 9),
    ])]);

    const footnote = prepared.blocks.find((block) => block.kind === 'footnote');
    expect(footnote).toMatchObject({
      text: '1 We use the source code made publicly available by the authors of T- ' +
        'VAL3 [22], D-AMP [28], IRCNN [49], and ReconNet [21] and implement ' +
        'SDA [30] ourselves, since its source code is not available.',
      kind: 'footnote',
    });
    expect(footnote?.sourceAnchor?.topRatio).toBeLessThan(.87);
    expect(footnote?.sourceAnchor?.heightRatio).toBeGreaterThan(.04);
    expect(prepared.blocks.some((block) => (
      block !== footnote && block.text.includes('VAL3 [22]')
    ))).toBe(false);
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
  it('keeps a numbered logarithmic continuation in the formula instead of creating a table row',()=>{
    const prepared=preparePdfDocumentTranslationPages([page(1,[
      positioned('The bound is:',54,80,90),
      positioned('F(x)=E[log q(z)]',75,105,170),
      positioned('− E',85,131,25),positioned('ln |1 + u ψ(z)|',150,131,120),positioned('(20)',450,131,25),
      positioned('where the parameter is fixed.',54,165,200),
    ])]);
    const block=prepared.blocks.find(block=>block.text.includes('(20)'))!;
    expect(block.kind).toBe('formula');
    expect(block.text).toContain('F(x)');
    expect(block.sourceEquations?.map(row=>row.number)).toEqual(['20']);
  });
  it('keeps panel settings, compact legend codes and subpanel labels inside the figure, with surrounding prose intact',()=>{
    const block=(id:string,text:string,top:number,kind?:'formula'|'table')=>({id,pageNumber:1,blockIndex:0,text,...(kind?{kind}:{}),sourceAnchor:{leftRatio:.1,topRatio:top,widthRatio:.35,heightRatio:.018}});
    const grouped=groupPdfDocumentTranslationVisualObjects([
      block('body','The preceding paragraph remains complete.',.1),
      block('settings','K = 2 K = 8 K = 32',.2,'formula'),
      block('legend','PF PF PF PF 0.0',.225),
      block('grid','Architecture\t0.5\t0.0',.25,'table'),
      block('panels','(a) Bound F(x)',.275),
      block('caption','Figure 1. Comparison of the distributions.',.3),
      block('after','The following paragraph remains complete.',.36),
    ]);
    expect(grouped.map(b=>b.text)).toEqual(['The preceding paragraph remains complete.','Figure 1. Comparison of the distributions.','The following paragraph remains complete.']);
    expect(grouped[1]!.kind).toBe('figure');
    expect(grouped[1]!.sourceAnchor!.topRatio).toBeLessThanOrEqual(.2);
    expect(groupPdfDocumentTranslationVisualObjects(grouped)).toEqual(grouped);
  });
});
