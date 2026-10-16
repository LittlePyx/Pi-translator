import { describe, expect, it } from 'vitest';
import { mergePdfCrossPageContinuations, pdfBlockTouchesScope, pdfSupplementarySourcePages, type PdfDocumentTranslationBlock } from '../core/pdf/document-translation';
import { combinePdfVisualOutcomes, pdfEquationCoverageIssues } from '../core/pdf/visual-unit-translation';
import { compactFormulaDocument, formulaDocumentIssues, parseFormulaDocument } from '../core/translation/formula-document';
import { pdfBackgroundVisualOutcome } from '../core/pdf/background-document-translation';
import { readLocalPdfLayout } from './support/local-pdf-layout';

describe('PDF visual request ownership', () => {
  const block = (pageNumber: number, text: string, topRatio: number): PdfDocumentTranslationBlock => ({
    id: `p${pageNumber}`, pageNumber, blockIndex: 0, text, kind: 'formula',
    sourceAnchor: { leftRatio: .5, topRatio, widthRatio: .4, heightRatio: .08 } });
  it('completes a torn mathematical expression from either selected page', () => {
    const merged = mergePdfCrossPageContinuations([block(4, 'Given feature F ∈', .85), block(5, 'RH×W×C, we compute the output.', .08)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sourceRegions?.map((r) => r.pageNumber)).toEqual([4, 5]);
    expect(pdfSupplementarySourcePages(merged, page => page === 5)).toEqual([4]);
    expect(pdfSupplementarySourcePages(merged, page => page === 4)).toEqual([5]);
    expect(pdfBlockTouchesScope(merged[0]!, page => page === 5)).toBe(true);
  });
  it('does not expand into unrelated neighbouring paragraphs or recursively translate additional pages', () => {
    const chosen = mergePdfCrossPageContinuations([block(4, 'Feature F ∈', .85), block(5, 'RH×W×C, the output follows.', .08)])[0]!;
    const {kind: _kind, ...unrelated} = block(4, 'An unrelated paragraph from the previous page.', .4);
    const elsewhere = mergePdfCrossPageContinuations([block(3, 'Another value x ∈', .85), block(4, 'RN.', .08)])[0]!;
    expect(pdfSupplementarySourcePages([chosen, unrelated, elsewhere], page => page === 5)).toEqual([4]);
    expect(pdfBlockTouchesScope(unrelated, page => page === 5)).toBe(false);
    expect(pdfBlockTouchesScope(elsewhere, page => page === 5)).toBe(false);
  });
  it('also includes a locally resolved prose continuation above or below the selected page', () => {
    const first = block(6, 'A continuous', .85), second = block(7, 'paragraph.', .08);
    delete first.kind; delete second.kind;
    const resolved = mergePdfCrossPageContinuations([first, second]);
    expect(resolved).toHaveLength(1);
    const prose = resolved[0]!;
    expect(prose.text).toBe('A continuous paragraph.');
    expect(pdfSupplementarySourcePages([prose], page => page === 7)).toEqual([6]);
    expect(pdfSupplementarySourcePages([prose], page => page === 6)).toEqual([7]);
    expect(pdfBlockTouchesScope(prose, page => page === 7)).toBe(true);
  });
  it('keeps headings, finished sentences and distant regions separate', () => {
    const first = block(4, 'The method is complete.', .85), next = block(5, 'A new paragraph starts.', .08);
    delete first.kind; delete next.kind;
    expect(mergePdfCrossPageContinuations([first, next])).toHaveLength(2);
    first.text = 'The method is'; next.text = '4. Experiments';
    expect(mergePdfCrossPageContinuations([first, next])).toHaveLength(2);
    expect(mergePdfCrossPageContinuations([block(4, 'Feature F ∈', .4), block(5, 'RH×W×C', .08)])).toHaveLength(2);
  });
  it('retains page ownership for ordinary text without positional metadata', () => {
    const text: PdfDocumentTranslationBlock = {id: 'legacy', pageNumber: 3, blockIndex: 0, text: 'An ordinary text block.'};
    expect(pdfBlockTouchesScope(text, page => page === 3)).toBe(true);
    expect(pdfBlockTouchesScope(text, page => page === 4)).toBe(false);
    expect(pdfSupplementarySourcePages([text], page => page === 3)).toEqual([]);
  });
  it('completes prose with an inline formula instead of splitting the sentence at the page boundary', () => {
    const next = block(5, 'preserving its physical meaning.', .08); delete next.kind;
    const merged = mergePdfCrossPageContinuations([block(4, 'Energy E = mc² is defined while', .85), next]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe('formula');
    expect(merged[0]!.text).toBe('Energy E = mc² is defined while preserving its physical meaning.');
    expect(pdfSupplementarySourcePages(merged, page => page === 5)).toEqual([4]);
  });
  it('checks every visible row number without erasing the good formulas', () => {
    const doc = parseFormulaDocument({ formulas: [{ id: 'm1', latex: String.raw`Q=FW\tag{12}`, display: true }],
      recognizedText: '{{m1}}', translation: '本地模拟译文：计算查询矩阵。{{m1}}' });
    const outcome = pdfBackgroundVisualOutcome({ id: 'p', text: 'Q=FW (12) K=FW (13) V=FW (14)',
      containsFormula: true, visualPurpose: 'formula', equationNumbers: ['12', '13', '14'] }, { formulaDocument: doc }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('13、14');
    expect(outcome.translatedText).toContain(String.raw`Q=FW\tag{12}`);
    expect(pdfEquationCoverageIssues(['12'], String.raw`\[Q=FW\tag{12}\]\[Q=FW\tag{12}\]`).join()).toContain('重复');
    expect(pdfEquationCoverageIssues([], String.raw`\[Q=FW\tag{12}\]`).join()).toContain('区域之外');
    expect(pdfEquationCoverageIssues(undefined, String.raw`\[Q=FW\tag{12}\]`)).toEqual([]);
  });
  it('remaps request-local IDs and keeps a single continuous block with independent references', () => {
    const doc = compactFormulaDocument(parseFormulaDocument({ formulas: [{ id: 'm1', latex: 'N', display: false }],
      recognizedText: 'Window {{m1}} and {{m1}}.', translation: '窗口为 {{m1}}，另一窗口为 {{m1}}。' }));
    const result = combinePdfVisualOutcomes('block', [1, 2].map(() => ({ blockId: 'block', translatedText: '', formulaDocument: doc, visualProcessed: true })));
    expect(result.visualProcessed).toBe(true);
    expect(result.formulaDocument?.formulas.map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(result.translatedText.match(/\$N\$/gu)).toHaveLength(4);
    expect(formulaDocumentIssues(result.formulaDocument!)).toEqual([]);
  });
  it('does not bind an opaque draft reference to a different unit’s registered formula', () => {
    const doc = parseFormulaDocument({ formulas: [{ id: 'm1', latex: 'N', display: false }],
      recognizedText: '{{m1}}', translation: '{{m1}}' });
    const result = combinePdfVisualOutcomes('p', [
      { blockId: 'p', translatedText: '{{m1}} 未校对草稿', visualProcessed: false, formulaReviewDraft: true },
      { blockId: 'p', translatedText: '$N$', formulaDocument: doc, visualProcessed: true },
    ]);
    expect(result.formulaDocument).toBeUndefined();
    expect(result.formulaReviewDraft).toBe(true);
    expect(result.translatedText).toContain('未校对草稿');
  });
  it.runIf(Boolean(process.env.PI_PDF_REGRESSION_SOURCE))('owns every HATNet equation 12–15 once with untorn cross-page input', async () => {
    const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
    const dense = prepared.blocks.find((block) => block.text.startsWith('Spatial-wise Self-Attention'))!;
    expect(dense.sourceRegions?.map((r) => r.pageNumber)).toEqual([4, 5]);
    expect(dense.equationNumbers).toEqual(['12', '13', '14', '15']);
    expect(dense.visualUnits!.length).toBeGreaterThan(1);
    const normalized = (text: string) => text.replace(/\s+/gu, '');
    expect(normalized(dense.visualUnits!.map((u) => u.text).join(''))).toBe(normalized(dense.text));
    expect(dense.visualUnits![0]!.text).toMatch(/F ∈ RH/u);
    for (const unit of dense.visualUnits!) expect(unit.text).not.toMatch(/[∈=]\s*$/u);
    for (const number of ['12', '13', '14', '15']) {
      expect(dense.visualUnits!.flatMap((u) => u.equationNumbers).filter((n) => n === number)).toHaveLength(1);
    }
    const regions = dense.visualUnits!.flatMap((u) => u.sourceRegions);
    for (const [i, a] of regions.entries()) for (const b of regions.slice(i + 1)) {
      if (a.pageNumber !== b.pageNumber) continue;
      const x = a.sourceAnchor, y = b.sourceAnchor;
      const width = Math.max(0, Math.min(x.leftRatio + x.widthRatio, y.leftRatio + y.widthRatio) - Math.max(x.leftRatio, y.leftRatio));
      const height = Math.max(0, Math.min(x.topRatio + x.heightRatio, y.topRatio + y.heightRatio) - Math.max(x.topRatio, y.topRatio));
      expect(width * height).toBeLessThan(.00001);
    }
  });
});
