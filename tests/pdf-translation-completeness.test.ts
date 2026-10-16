import { describe, expect, it } from 'vitest';
import { pdfBackgroundTextOutcome, pdfBackgroundVisualOutcome } from '../core/pdf/background-document-translation';
import { pdfTranslationProseIssues } from '../core/pdf/translation-completeness';
import { combinePdfVisualOutcomes } from '../core/pdf/visual-unit-translation';
import { compactFormulaDocument, parseFormulaDocument, recoverLegacyFormulaDocument } from '../core/translation/formula-document';
import { validateImageFigureResult,keepImageFigureMathInOriginal } from '../core/translation/formula-output-validation';

const source = 'The proposed model combines local observations with a global representation to predict outputs at unseen locations.';
const block = { id: 'P1B1', text: source, visualPurpose: 'document' as const, containsFormula: false };

describe('PDF translation prose completeness', () => {
  it.each(['document', 'figure', 'table'] as const)('rejects source echo in %s independently of math metadata', visualPurpose => {
    const outcome = pdfBackgroundVisualOutcome({ ...block, visualPurpose }, {
      recognizedText: source, translatedText: source, formulaLatex: [],
    }, 'zh-CN');
    expect(outcome.visualProcessed).toBe(false);
    expect(outcome.visualFallbackMessage).toContain('与原文相同');
  });

  it.each(['', 'The untranslated text remains in English.', '以下是译文：The proposed model combines local observations.'])('records the actual missing-prose cause: %s', translatedText => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText }, 'zh-CN');
    expect(outcome.visualFallbackMessage).toMatch(/未返回译文|目标语言/);
    expect(outcome.visualProcessed).toBe(false);
  });

  it.each([
    ['Abstract', '摘要'],
    ['1. Introduction', '1. 引言'],
    ['2.3. Training CNPs', '2.3. 训练 CNPs'],
    ['4.2.1. MNIST', '4.2.1. MNIST'],
    ['4.2.2. CelebA', '4.2.2. CelebA'],
    ['Marta Garnelo 1 Chris J. Maddison 1', 'Marta Garnelo$^1$ Chris J. Maddison$^1$'],
    ['garnelo@google.com', 'garnelo@google.com'],
    [String.raw`Gang Qu$^{1,*}$ Ping Wang$^{1,2,*}$ Xin Yuan$^{1,\dagger}$`, String.raw`Gang Qu$^{1,*}$ Ping Wang$^{1,2,*}$ Xin Yuan$^{1,\dagger}$`],
    [String.raw`\{\texttt{qugang,wangping,xyuan}\}@\texttt{westlake.edu.cn}`, '{qugang,wangping,xyuan}@westlake.edu.cn'],
    ['1-shot 5-shot 1-shot 5-shot', '1-shot 5-shot 1-shot 5-shot'],
    ['b Train Predict x1 x2 x3 r1 r2 h h g g', 'b 训练 预测 $x_1$ $x_2$ $x_3$ $r_1$ $r_2$ $h$ $h$ $g$ $g$'],
    ['C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (17)', String.raw`\[C-SA(F)=F*Sigmoid(ReLU(GAP(F)W_1)W_2)\tag{17}\]`],
    [String.raw`\[x=y\]`, String.raw`\[x=y\]`],
  ])('allows concise headings, identifiers and non-prose: %s', (text, translation) => {
    expect(pdfTranslationProseIssues(text, translation, 'zh-CN')).toEqual([]);
  });

  it('keeps a short partial translation visible without calling it complete', () => {
    const translatedText = '模型如下。';
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText }, 'zh-CN');
    expect(outcome.translatedText).toBe(translatedText);
    expect(outcome.formulaReviewMessage).toContain('正文译文较短');
    expect(outcome.formulaReviewDraft).toBe(true);
    expect(outcome.visualProcessed).toBe(false);
  });
  it('accepts retained author/institution names with a translated city, without exempting shortened prose or missing authors',()=>{
    const source='Alice Marie Example Bob Charles Sample Example Research, London';
    const recognition='Alice Marie Example\nBob Charles Sample\nExample Research, London';
    const target='Alice Marie Example\nBob Charles Sample\nExample Research，伦敦';
    expect(pdfTranslationProseIssues(source,target,'zh-CN',recognition)).toEqual([]);
    expect(pdfTranslationProseIssues(recognition,target,'zh-CN')).toEqual([]);
    expect(pdfTranslationProseIssues(source,'Bob Charles Sample\nExample Research，伦敦','zh-CN',recognition).length).toBeGreaterThan(0);
    expect(pdfTranslationProseIssues('The model uses observations to predict values and compares the resulting inference with other methods.',target,'zh-CN',recognition).length).toBeGreaterThan(0);
    expect(pdfTranslationProseIssues('General Neural Models For Reliable Scientific Research, London','模型。','zh-CN').length).toBeGreaterThan(0);
  });

  it('uses retained recognition to explain echo after source registry compaction', () => {
    const recognizedText = `${source} $x=y$`;
    const doc = compactFormulaDocument(parseFormulaDocument({ recognizedText, translation: recognizedText, formulas: [] }));
    const outcome = pdfBackgroundVisualOutcome(block, { originalText: recognizedText, formulaDocument: doc }, 'zh-CN');
    expect(outcome.visualFallbackMessage).toContain('与原文相同');
  });

  it('does not exempt prose surrounding a plain equation', () => {
    expect(pdfTranslationProseIssues('The energy is E=mc^2.', String.raw`\[E=mc^2\]`, 'zh-CN').join('；')).toContain('遗漏正文译文');
  });

  it('finds a copied English sentence after a translated introduction', () => {
    const translatedText = `模型利用局部观测来预测未知位置的输出。 ${source}`;
    const outcome = pdfBackgroundTextOutcome(block, translatedText, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('局部漏译');
    expect(outcome.translatedText).toBe(translatedText);
  });

  it('does not treat names or LaTeX commands as an untranslated sentence', () => {
    expect(pdfTranslationProseIssues(source,
      String.raw`该模型使用 Hybrid Attention Transformer 与 Channel-wise Self-Attention 结合局部和全局特征。$\operatorname{Concat}(\mathbf{F},\mathbb{R})$`, 'zh-CN')).toEqual([]);
  });

  it.each([
    ['en', 'Global neural attention network architecture'],
    ['de', 'Globale neuronale Netze adaptiver Architekturen'],
    ['fr', 'Architecture neuronale globale adaptative distribuée'],
    ['ja', '大域的な注意機構を用いたニューラルネットワーク'],
  ])('does not reject a technical heading in %s just for lacking function words', (language, translation) => {
    expect(pdfTranslationProseIssues('全局神经注意力网络结构', translation, language)).toEqual([]);
  });

  it('still identifies a clearly English paragraph requested in German', () => {
    expect(pdfTranslationProseIssues(source, source, 'de').join('；')).toContain('与原文相同');
  });

  it('does not conceal model uncertainty or math failures in a figure/table', () => {
    const outcome = pdfBackgroundVisualOutcome({ ...block, visualPurpose: 'table' }, {
      translatedText: '该模型根据局部观测和全局表示预测未知位置的输出。',
      formulaNeedsReview: true, formulaLatex: [],
      uncertainSpans: ['公式 LaTeX 未通过自动校验：识别原文与译文中的公式不一致'],
    }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('识别原文与译文中的公式不一致');
    expect(outcome.visualProcessed).toBe(false);
  });

  it('keeps diagram-only symbols in the original image without requiring a duplicate translation', () => {
    const result = { recognizedText: 'Figure 1. Model overview.\n\n[Diagram Labels]: $r_1,r_2$ Observe, Predict',
      translatedText: '图 1：模型结构。图内标签：观测、预测。', formulaLatex: ['r_1', 'r_2'], uncertainSpans: [] };
    expect(validateImageFigureResult(result)).toEqual({ valid: true, issues: [] });
    expect(validateImageFigureResult({...result,translatedText:result.translatedText+' $r_1,r_2$'}).issues.join('；')).toContain('图内数学标签应保留在原图');
    const normalized=keepImageFigureMathInOriginal({...result,translatedText:'图 1：模型结构。\n图内标签：观测 $r_1,r_2$；预测。'});
    expect(normalized.translatedText).toBe('图 1：模型结构。\n图内标签：观测 ；预测。');expect(normalized.recognizedText).toBe(result.recognizedText);expect(validateImageFigureResult(normalized).valid).toBe(true);
    const outOfOrder={recognizedText:'(a) Output $r_1$\n\nFigure 1. Model overview.\n\n[Diagram Labels]: Observe, Predict',translatedText:'图 1：模型结构。\n图内标签：输出 $r_1$；观测；预测。',formulaLatex:['r_1'],uncertainSpans:[]};
    const ordered=keepImageFigureMathInOriginal(outOfOrder,'Figure 1. Model overview.');expect(ordered.recognizedText).toContain('[Diagram Labels]: (a) Output $r_1$');expect(ordered.translatedText).not.toContain('$r_1$');expect(validateImageFigureResult(ordered).valid).toBe(true);
    expect(keepImageFigureMathInOriginal(outOfOrder,'Figure 2. Different caption.')).toEqual(outOfOrder);
    for(const math of ['$r_3$','$$r_1,r_2$$',String.raw`\(r_1,r_2\)`]){
      const candidate={...result,translatedText:'图 1：模型结构。\n图内标签：观测 '+math};
      expect(keepImageFigureMathInOriginal(candidate)).toEqual(candidate);
    }
    expect(validateImageFigureResult({recognizedText:'Figure 1. Output $x=y$.\n\n[Diagram Labels]: $r_1$',translatedText:'图 1. 输出 $x=y$。',formulaLatex:['x=y'],uncertainSpans:[]})).toEqual({valid:true,issues:[]});
  });

  it.each([
    ['Figure 1. Output $x=y$.\n\n[Diagram Labels]: $r_1$', '图 1：模型输出。', '图注中的公式'],
    ['Figure 1. Model overview.\n\n[Diagram Labels]: $r_1$', '图 1：模型结构。$r_2$', '无法与识别原文'],
    ['Figure 1. Model overview.\n\n[Diagram Labels]: $r_1$', '图 1：模型结构。$\\mathbf{r}_1$', '无法与识别原文'],
  ])('does not waive missing caption math or changed diagram expressions', (recognizedText, translatedText, reason) => {
    expect(validateImageFigureResult({ recognizedText, translatedText, formulaLatex: [], uncertainSpans: [] }).issues.join('；')).toContain(reason);
  });

  it('retains explicit OCR uncertainty even when exact formula recovery succeeds', () => {
    const outcome = pdfBackgroundVisualOutcome({ ...block, containsFormula: true }, {
      recognizedText: `${source} $x=y$`, translatedText: '该模型根据局部观测和全局表示预测未知位置的输出。$x=y$',
      formulaNeedsReview: true, uncertainSpans: ['末尾一个词无法确认'],
    }, 'zh-CN');
    expect(outcome.formulaDocument).toBeDefined();
    expect(outcome.formulaReviewMessage).toContain('末尾一个词无法确认');
    expect(outcome.visualProcessed).toBe(false);
  });

  it('keeps a neighboring draft opaque when joining dense visual units', () => {
    const safe = parseFormulaDocument({ recognizedText: '{{m1}}', translation: '{{m1}}', formulas: [{ id: 'm1', latex: 'x=y', display: true }] });
    const draft = String.raw`已返回的中文说明需要保留。\[a=b`;
    const combined = combinePdfVisualOutcomes('P2B1', [
      { blockId: 'a', translatedText: 'x=y', visualProcessed: true, formulaDocument: safe },
      { blockId: 'b', translatedText: draft, visualProcessed: false, formulaReviewMessage: '分隔符未闭合', formulaReviewDraft: true },
    ]);
    expect(combined.formulaReviewDraft).toBe(true);
    expect(combined.formulaDocument).toBeUndefined();
    expect(combined.translatedText).toContain(draft);
    expect(combined.visualProcessed).toBe(false);
  });

  it('does not turn all-source visual units into a translated formula document', () => {
    const combined = combinePdfVisualOutcomes('P2B1', ['a', 'b'].map(blockId => ({
      blockId, translatedText: source, visualProcessed: false, visualFallbackMessage: '模型回显原文',
    })));
    expect(combined.visualFallbackMessage).toContain('区域 1');
    expect(combined.formulaDocument).toBeUndefined();
  });

  it('does not throw away a legacy reply when optional registration exceeds its limits', () => {
    const formulae = Array.from({ length: 270 }, (_, index) => `$x_{${index}}=y$`).join(' ');
    expect(() => recoverLegacyFormulaDocument(formulae, formulae)).not.toThrow();
  });
});
