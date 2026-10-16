import {describe,expect,it} from 'vitest';
import {readLocalPdfLayout} from './support/local-pdf-layout';
import {pdfDocumentTranslationSourceRegions} from '../core/pdf/document-translation';

// Public-paper layout regression, deliberately separate from the HATNet corpus.
describe.skipIf(!process.env.PI_CNP_REGRESSION_SOURCE)('Conditional Neural Processes local layout',()=>{
  it('preserves complete two-column prose, footnotes, figures, table and all four equation identities',async()=>{
    const {blocks}=await readLocalPdfLayout(process.env.PI_CNP_REGRESSION_SOURCE!);
    expect(new Set(blocks.map(block=>block.pageNumber)).size).toBe(10);
    expect(blocks.flatMap(block=>block.sourceEquations??[]).map(equation=>equation.number)).toEqual(['1','2','3','4']);
    const introduction=blocks.find(block=>block.text.startsWith('For example, consider supervised'))!;
    expect(introduction.text).toContain('Many of these can be framed');
    expect(introduction.text).not.toContain('Observations Targets');
    const footnote=blocks.find(block=>block.kind==='footnote'&&block.text.startsWith('1 P is a measure'))!;
    expect(footnote.text).toContain('We overload P for the marginal and conditional densities');
    const continuation=blocks.find(block=>block.text.startsWith('As an alternative we propose'))!;
    expect(continuation.text).toContain('re- spect to some prior process');
    expect(continuation.text).not.toContain('of consistent measures');
    expect(pdfDocumentTranslationSourceRegions(continuation).map(region=>region.pageNumber)).toEqual([2,3]);
    expect(blocks.find(block=>block.text.startsWith('As a motivating example'))!.kind).not.toBe('code');
    expect(blocks.filter(block=>block.kind==='code')).toHaveLength(0);
    expect(blocks.find(block=>block.text.startsWith('We consider image completion'))!.text).toContain('1D function regression (with the exception of making the last layer 3-dimensional for RGB)');
    const table=blocks.find(block=>block.text.startsWith('Table 1.'))!;
    expect(table.kind).toBe('table');expect(table.text).toContain('0.215');expect(table.text).toContain('0.021');
    const classification=blocks.find(block=>block.text.startsWith('Table 2.'))!;
    expect(classification.kind).toBe('table');expect(classification.text).toContain('Runtime');
    expect(classification.text).toContain('98.1% 98.9% 93.8% 98.5%');
    expect(classification.text).not.toContain('tions are then');
    expect(blocks.find(block=>block.text.startsWith('Given that the input points'))!.text).toContain('representa- tions are then concatenated');
    expect(blocks.filter(block=>block.kind==='table')).toHaveLength(2);
    expect(blocks.filter(block=>block.kind==='figure')).toHaveLength(7);
    const firstClaim=blocks.find(block=>block.text.startsWith('1. A CNP is'))!;
    expect(firstClaim.text).toBe('1. A CNP is a conditional distribution over functions trained to model the empirical conditional distributions of functions f ∼ P.');
    expect(blocks.some(block=>block.text.startsWith('trained to model'))).toBe(false);
    expect(blocks.filter(block=>/^\d\. A CNP/u.test(block.text))).toHaveLength(3);
    const figure=blocks.find(block=>block.text.startsWith('Figure 1.'))!;
    expect(figure.sourceAnchor!.topRatio).toBeLessThan(.23);
    expect(blocks.some(block=>block.kind==='formula'&&block.text.startsWith('Supervised Learning Train'))).toBe(false);
  });
});
