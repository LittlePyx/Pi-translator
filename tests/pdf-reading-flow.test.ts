import { describe, expect, it } from 'vitest';
import { preparePdfDocumentTranslationPages, mergePdfDocumentTranslationContinuationBlocks, mergePdfCrossPageContinuations,
  pdfDocumentTranslationSourceRegions } from '../core/pdf/document-translation';
import { readLocalPdfLayout } from './support/local-pdf-layout';

describe('PDF figure references and cross-column prose ownership', () => {
  it('finds next-page prose below a leading figure without including or absorbing the figure', () => {
    const anchor={leftRatio:.1,topRatio:.8,widthRatio:.4,heightRatio:.1};
    const previous={id:'a',pageNumber:1,blockIndex:0,text:'The network is a stage-specific deep',sourceAnchor:anchor};
    const figure={id:'fig',pageNumber:2,blockIndex:0,kind:'figure' as const,text:'Figure 2. Architecture.',sourceAnchor:{...anchor,topRatio:.08,heightRatio:.45}};
    const next={id:'b',pageNumber:2,blockIndex:1,text:'denoiser with learnable parameters.',sourceAnchor:{...anchor,topRatio:.54}};
    const merged=mergePdfCrossPageContinuations([previous,figure,next]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).toContain('deep denoiser');
    expect(merged[1]).toEqual(figure);
    expect(pdfDocumentTranslationSourceRegions(merged[0]!)).toHaveLength(2);
    expect(pdfDocumentTranslationSourceRegions(merged[0]!).every(region=>region.sourceAnchor.topRatio!==figure.sourceAnchor.topRatio)).toBe(true);
    for(const invalid of [
      {...figure,sourceAnchor:{...figure.sourceAnchor,topRatio:.3,heightRatio:.23}},
      {...figure,sourceAnchor:{...figure.sourceAnchor,leftRatio:.65}},
      {...figure,sourceAnchor:{...figure.sourceAnchor,heightRatio:.2}},
      {...figure,kind:'code' as const},
    ])expect(mergePdfCrossPageContinuations([previous,invalid,next])).toHaveLength(3);
    expect(mergePdfCrossPageContinuations([{...previous,text:'The network is complete.'},figure,next])).toHaveLength(3);
    expect(mergePdfCrossPageContinuations([previous,figure,{...next,text:'3.2. Another Section'}])).toHaveLength(3);
  });
  it.runIf(Boolean(process.env.PI_PDF_REGRESSION_SOURCE))('connects HATNet pages 3/4 and 7/8 around their leading figures with separate object ownership', async () => {
    const {blocks}=await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
    const denoiser=blocks.find(block=>block.id==='P3B20')!;
    const results=blocks.find(block=>block.id==='P7B11')!;
    expect(denoiser.text).toContain('deep denoiser with learnable');
    expect(results.text).toContain('best re- sult of 32.26');
    expect(blocks.some(block=>block.id==='P4B2'||block.id==='P8B2')).toBe(false);
    expect(pdfDocumentTranslationSourceRegions(denoiser).map(region=>region.pageNumber)).toEqual([3,4]);
    expect(pdfDocumentTranslationSourceRegions(results).map(region=>region.pageNumber)).toEqual([7,8]);
    expect(blocks.find(block=>block.id==='P4B1')!.kind).toBe('figure');
    expect(blocks.find(block=>block.id==='P8B1')!.kind).toBe('figure');
  });
  it('keeps a wrapped Fig. 4. reference inside prose and separates run-in headings', () => {
    const lines = ['Our reconstructed results are visualized in Fig. 1 and',
      'Fig. 4. The reference images are captured without compression.',
      'The results are described below.',
      'Large-Scale Results. We evaluate the larger images.',
      'These images are reconstructed with the same method.'];
    const prepared = preparePdfDocumentTranslationPages([{ pageNumber: 1, pageWidth: 600, pageHeight: 800,
      items: lines.map((str, index) => ({ str, left: 50, top: 100 + index * 12, width: 240, height: 10 })) }]);
    expect(prepared.blocks).toHaveLength(2);
    expect(prepared.blocks[0]!.text).toContain('and Fig. 4. The reference');
    expect(prepared.blocks[0]!.kind).not.toBe('figure');
    expect(prepared.blocks[1]!.text).toMatch(/^Large-Scale Results\./u);
  });

  it('does not erase a real caption boundary after a finished sentence', () => {
    const prepared = preparePdfDocumentTranslationPages([{ pageNumber: 1, pageWidth: 600, pageHeight: 800,
      items: ['We compare the reconstructed images.', 'Figure 4. Experimental results.', 'The next paragraph starts here.']
        .map((str, index) => ({ str, left: index === 2 ? 65 : 50, top: 100 + index * 20, width: index === 2 ? 225 : 240, height: 10 })) }]);
    expect(prepared.blocks.some((block) => block.kind === 'figure' && block.text === 'Figure 4. Experimental results.')).toBe(true);
  });

  it('allows a run-in heading paragraph to continue, but not to absorb another heading', () => {
    const anchor = { leftRatio: .1, topRatio: .1, widthRatio: .35, heightRatio: .08 };
    const merged = mergePdfDocumentTranslationContinuationBlocks([
      { id: 'a', pageNumber: 1, blockIndex: 0, text: 'Previous paragraph ends with and', sourceAnchor: anchor },
      { id: 'b', pageNumber: 1, blockIndex: 1, text: 'Illumination-Varying Results. We report the reconstructed', sourceAnchor: { ...anchor, topRatio: .8 } },
      { id: 'c', pageNumber: 1, blockIndex: 2, text: 'results in different lighting conditions.', sourceAnchor: { ...anchor, leftRatio: .5 } },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).not.toContain('Illumination');
    expect(merged[1]!.text).toContain('reconstructed results');
    expect(merged[1]!.sourceRegions).toHaveLength(2);
  });

  it.runIf(Boolean(process.env.PI_PDF_REGRESSION_SOURCE))('owns the actual HATNet page 7 prose, caption tail and two-column continuation', async () => {
    const { blocks } = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
    const page = blocks.filter((block) => block.pageNumber === 7);
    const original = blocks.find((block) => block.text.includes('and Fig. 4. The reference'))!;
    const light = page.find((block) => block.text.startsWith('Illumination-Varying Results.'))!;
    expect(original.text).toContain('and Fig. 4. The reference');
    expect(original.text).toMatch(/best visual results\.$/u);
    expect(original.kind).not.toBe('figure');
    expect(original.text).not.toContain('Illumination-Varying');
    expect(light.text).toContain('reconstructed results of ISTA-TV');
    expect(light.text).toMatch(/light conditions\.$/u);
    expect(light.text).not.toContain('SR = 12.5%');
    expect(light.text).not.toContain('Optical Resolution');
    const regions = pdfDocumentTranslationSourceRegions(light);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.sourceAnchor.leftRatio).toBeLessThan(.2);
    expect(regions[1]!.sourceAnchor.leftRatio).toBeGreaterThan(.45);
    const figures = page.filter((block) => block.kind === 'figure');
    expect(figures).toHaveLength(3);
    expect(figures.find((block) => block.text.startsWith('Figure 5.'))!.text).toContain('pixels at SR = 12.5%.');
    expect(page.some((block) => block.text.startsWith('Large-Scale Results.'))).toBe(true);
    expect(page.some((block) => block.text.startsWith('Optical Resolution.'))).toBe(true);
  });
});
