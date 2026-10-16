import { describe, expect, it } from 'vitest';
import {
  mergePdfDocumentTranslationContinuationBlocks, pdfDocumentTranslationBlockKind,
  pdfDocumentTranslationBlocks, preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationTextItem,
} from '../core/pdf/document-translation';

const item = (str: string, left: number, top: number, width: number, height = 10): PdfDocumentTranslationTextItem =>
  ({ str, left, top, width, height, hasEOL: false });
const prepare = (items: PdfDocumentTranslationTextItem[]) => preparePdfDocumentTranslationPages([
  { pageNumber: 1, pageWidth: 612, pageHeight: 792, items },
]).blocks;

describe('academic PDF math ownership regressions', () => {
  it('never removes the only sentence on each page as a repeated running header',()=>{
    const prepared=preparePdfDocumentTranslationPages(Array.from({length:14},(_,index)=>({pageNumber:index+1,pageWidth:612,pageHeight:792,
      items:[item(`Text-only background translation page ${index+1} remains continuous.`,50,60,400)]})));
    expect(prepared.blocks).toHaveLength(14);expect(prepared.unreadablePages).toBe(0);
  });
  it('keeps stochastic-process prose out of the code path', () => {
    for (const text of ['function f ∼ P defined on the real line.', 'let f ∼ P be a random function.', 'function regression (with the exception of making the last', 'Y := R). O would constitute observations of the function.']) {
      expect(pdfDocumentTranslationBlockKind(text)).not.toBe('code');
    }
    expect(pdfDocumentTranslationBlockKind('function sample(x) { return x; }')).toBe('code');
  });
  it('owns a detached lower equation label without swallowing the following prose', () => {
    const blocks = prepare([item('L(θ) = −E log Q(y|x)',310,100,212),item('(4)',530,116,12),
      item('Thus the targets include observed and unobserved values.',308,132,234)]);
    const equation = blocks.find(block => block.text.includes('L(θ)'))!;
    expect(equation.equationNumbers).toEqual(['4']);
    expect(equation.sourceEquations?.[0]?.number).toBe('4');
    expect(equation.text).not.toContain('Thus');
  });
  it.each([
    'S−SA(F) = Concat(EhWh, ElWl),\t(16)',
    'C−SA(F) = F ∗ Sigmoid(ReLU(GAP(F)W1)W2), (17)',
    'X ˆ = arg minX',
  ])('classifies numbered/function math as a formula: %s', (text) => {
    expect(pdfDocumentTranslationBlockKind(text)).toBe('formula');
  });

  it('keeps the p=4 prose in its original paragraph, once', () => {
    const text = 'p= 4. Toward C-SA, the channel shrinking factor is β = 16.';
    expect(pdfDocumentTranslationBlockKind(text)).toBe('text');
    const blocks = prepare([
      item('The kernel size is 2 by 2, namely N = 64 and', 50, 100, 238),
      item(text, 50, 112, 238),
      item('Following previous works, we train the model.', 50, 124, 238),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text.match(/p= 4/gu)).toHaveLength(1);
    expect(blocks[0]!.text).toContain('and p= 4. Toward');
  });

  it('attaches nested roots to each radicand on the correct prose baseline', () => {
    const blocks = prepare([
      item('Assume X belongs to R', 308, 110.3654, 127),
      item('√', 435.324, 103.8262, 6.5449, 6.9738),
      item('N', 441.869, 109.7382, 6.3106, 6.9738),
      item('is a 2D image, and', 471.752, 110.3654, 73.36),
      item('its measurements Y belong to R', 308, 123.7234, 170.524),
      item('√', 478.524, 117.1842, 6.5449, 6.9738),
      item('M', 485.069, 123.0962, 7.5973, 6.9738),
      item('can be', 518.222, 123.7234, 26.89),
      item('obtained by a linear system.', 308, 135.6784, 167.4),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toMatch(/R√N is a 2D image, and its measurements Y belong to R√M can be obtained/u);
  });

  it('keeps a below-argmin variable out of the following prose highlight', () => {
    const blocks = prepare([
      item('X = arg min', 344, 443.9554, 59.58),
      item('X', 384.074, 455.3272, 6.7499, 6.9738),
      item('|| Z - X || + R(X),', 424, 443.9554, 90),
      item('(9)', 534, 443.9554, 12),
      item('Eq. (8) is a tensor gradient descent with a step size.', 308, 468.3904, 238),
      item('It is followed by a proximal mapping.', 308, 480.3454, 238),
    ]);
    const body = blocks.find((block) => block.text.includes('tensor gradient'))!;
    expect(body.text).toMatch(/^Eq\. \(8\)/u);
    expect(body.sourceAnchor!.topRatio * 792).toBeGreaterThan(462.3);
  });

  it('keeps vertically centered equation numbers with both formula rows', () => {
    const blocks = prepare([
      item('Eh = softmax(Qh Kh / d) Vh,', 109, 478.9284, 118),
      item('d', 190, 486.65, 4.2, 6.97),
      item('(15)', 270.432, 488.8314, 16.6),
      item('El = softmax(Ql Kl / d) Vl.', 109, 499.8804, 118),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('formula');
    expect(blocks[0]!.text).toContain('(15)');
    expect(blocks[0]!.text).toContain('El = softmax');
  });

  it.each(['table', 'code', 'figure'] as const)('never absorbs a skipped %s into the surrounding crop', (kind) => {
    const anchor = (topRatio: number, heightRatio: number) => ({ leftRatio: .1, topRatio, widthRatio: .3, heightRatio });
    const blocks = mergePdfDocumentTranslationContinuationBlocks([
      { id: 'a', pageNumber: 1, blockIndex: 0, text: 'The method works with', sourceAnchor: anchor(.1, .05) },
      { id: 'b', pageNumber: 1, blockIndex: 1, text: 'Independent object', kind, sourceAnchor: anchor(.15, .012) },
      { id: 'c', pageNumber: 1, blockIndex: 2, text: 'both inputs together.', sourceAnchor: anchor(.162, .05) },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.sourceRegions).toHaveLength(2);
    expect(blocks[0]!.sourceRegions![0]!.sourceAnchor.heightRatio).toBe(.05);
  });

  it('includes font descenders without extending into the next text line', () => {
    const blocks = pdfDocumentTranslationBlocks(1, [
      { ...item('First paragraph ends with typography.', 50, 100, 220), descent: 2.2 },
      { ...item('Another paragraph follows.', 65, 112, 205), descent: 2.2 },
    ], { width: 612, height: 792 });
    expect(blocks).toHaveLength(2);
    const first = blocks[0]!.sourceAnchor!;
    expect((first.topRatio + first.heightRatio) * 792).toBeCloseTo(112);
    expect(blocks[1]!.sourceAnchor!.topRatio * 792).toBeGreaterThanOrEqual(112);
  });
});
