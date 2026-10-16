import { describe, expect, it } from 'vitest';
import { extractFormulaReviewProse, hasFormulaTranslationProse } from '../core/translation/formula-output-validation';
import { isLikelyTargetLanguage } from '../core/language/target-language';
import { pdfBackgroundVisualOutcome } from '../core/pdf/background-document-translation';
import { parseFormulaDocument } from '../core/translation/formula-document';

const block = { id: 'P5B9', text: 'As a result, the final output is S-SA(F) = Concat(EhWh, ElWl), (16).',
  containsFormula: true, visualPurpose: 'formula' as const };

describe('PDF mixed formula/prose recovery', () => {
  const equation15Input = (translation: string) => parseFormulaDocument({
    formulas: [{ id: 'm1', display: true, latex: String.raw`E_i^h=\mathrm{softmax}(Q_i^hK_i^{h\top}/\sqrt{d})V_i^h\tag{15}` }],
    recognizedText: 'For each head, the high-frequency output is calculated by {{m1}}.',
    translation,
  });
  const equation15Block = { ...block, id: 'equation15', equationNumbers: ['15'],
    text: 'For each head, the high-frequency output is calculated by E=softmax(QK/d)V (15).' };

  it('retains short translated equation introductions for completeness review', () => {
    const outcome = pdfBackgroundVisualOutcome(equation15Block,
      { formulaDocument: equation15Input('计算如下：{{m1}}') }, 'zh-CN');
    expect(outcome.translatedText).toContain('计算如下');
    expect(outcome.translatedText).toContain(String.raw`\tag{15}`);
    expect(outcome.visualProcessed).toBe(false);
    expect(outcome.visualFallbackMessage).toBeUndefined();
    expect(outcome.formulaReviewMessage).toContain('正文译文较短');
  });

  it.each([
    ['{{m1}}', '模型仅返回公式或符号，遗漏正文译文'],
    ['For each head, the high-frequency output is calculated by {{m1}}.', '模型返回内容与原文相同'],
    ['The model provides no translated explanation here. {{m1}}', '模型正文未通过目标语言校验'],
  ])('records a specific reason for source-only output: %s', (translation, reason) => {
    const outcome = pdfBackgroundVisualOutcome(equation15Block,
      { formulaDocument: equation15Input(translation) }, 'zh-CN');
    expect(outcome.translatedText).toBe(equation15Block.text);
    expect(outcome.visualProcessed).toBe(false);
    expect(outcome.visualFallbackMessage).toContain(reason);
    expect(outcome.visualFallbackMessage).toContain('公式登记 1 项');
  });

  it('retains formula mismatch evidence even when the whole block falls back to source', () => {
    const doc = equation15Input('For each head, the high-frequency output is calculated by {{m1}}.');
    doc.formulas[0]!.review = '模型标记为无法确认';
    const outcome = pdfBackgroundVisualOutcome(equation15Block, { formulaDocument: doc }, 'zh-CN');
    expect(outcome.visualFallbackMessage).toContain('模型返回内容与原文相同');
    expect(outcome.visualFallbackMessage).toContain('m1: 模型标记为无法确认');
  });
  it.each([
    ['equation 16', String.raw`最终输出由高频与低频特征融合得到。\[S-SA(F)=Concat(E_hW_h,E_lW_l)\tag{16}\]其中两个矩阵是可学习的投影矩阵。`],
    ['equation 17', String.raw`通道注意力首先把空间信息压缩到通道中，然后计算注意力。\[C-SA(F)=F*Sigmoid(ReLU(GAP(F)W_1)W_2)\tag{17}\]该过程实现全局信息聚合与通道重校准。`],
  ])('retains prose for %s without passing through unchecked math', (_, translatedText) => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText, recognizedText: String.raw`\[x=y\]`,
      formulaNeedsReview: true, formulaLatex: ['x=y'] }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('未通过结构校验');
    expect(outcome.visualProcessed).toBe(false);
    expect(outcome.visualFallbackMessage).toBeUndefined();
    expect(outcome.translatedText).toBe(translatedText);
    expect(outcome.formulaReviewDraft).toBe(true);
    expect(outcome.translatedText).not.toContain('〔公式见原文〕');
  });

  it('preserves prose around inline and display formulas in source order', () => {
    expect(extractFormulaReviewProse(String.raw`高频特征为 $E^h$，低频特征为 \(E^l\)。融合结果如下：$$F=E^h+E^l$$其中两组特征分别对应不同尺度。`, 'zh-CN'))
      .toBe('高频特征为 〔公式见原文〕，低频特征为 〔公式见原文〕。融合结果如下：〔公式见原文〕其中两组特征分别对应不同尺度。');
  });

  it('retains translated prose even when the model omitted all formula metadata', () => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText: '最终输出由高频与低频特征融合得到，其中投影矩阵是可学习的。', formulaLatex: [] }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toBe('模型未返回可核对的公式结构');
    expect(outcome.translatedText).toContain('最终输出');
  });

  it.each([
    String.raw`正常中文说明需要保留，但公式的分隔符未闭合 \[x=y`,
    String.raw`中文正文足够长，但是残留未标记的公式 y = Ax。`,
    String.raw`中文正文足够长，但是仍然存在未标记的公式变量 E_h。`,
    String.raw`\[这不是公式，而是被错误包入公式中的中文正文。\]`,
    '高频特征 Eh ∈ RH×W×C1 和低频特征 El ∈ RH×W×C2 分别重塑后拼接，最终通过投影矩阵融合得到输出。',
    String.raw`通过对高频和低频输出分别重塑，得到合并后的特征。\[F=Concat(E_hW_h,E_lW_l)\]其中参数 β 控制通道收缩。`,
  ])('retains exact translated draft when math cannot be safely isolated: %s', (translatedText) => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText, formulaNeedsReview: true, formulaLatex: [] }, 'zh-CN');
    expect(outcome.formulaReviewDraft).toBe(true);
    expect(outcome.formulaReviewMessage).toContain('数学内容无法安全分离');
    expect(outcome.visualProcessed).toBe(false);
    expect(outcome.visualFallbackMessage).toBeUndefined();
    expect(outcome.translatedText).toBe(translatedText);
  });

  it('does not apply the passive-selection 80% language threshold to technical translations', () => {
    const translatedText = 'Hybrid Attention Transformer 和 Channel-wise Self-Attention 分别处理空间信息与通道信息，两者用于特征融合。';
    expect(isLikelyTargetLanguage(translatedText, 'zh-CN')).toBe(false);
    expect(hasFormulaTranslationProse(translatedText, 'zh-CN')).toBe(true);
    expect(extractFormulaReviewProse(translatedText, 'zh-CN')).toBe(translatedText);
  });

  it('does not count long LaTeX command names as untranslated English prose', () => {
    const translatedText = `高频特征与低频特征通过下式融合，投影矩阵可学习。\\[${String.raw`\operatorname{Concat}(\mathbf{E}\mathbf{W},\boldsymbol{F})`.repeat(12)}\\]参数为 β。`;
    expect(pdfBackgroundVisualOutcome(block, { translatedText, formulaNeedsReview: true }, 'zh-CN').formulaReviewDraft).toBe(true);
  });

  it.each([
    String.raw`\[x=y\]`,
    'As illustrated in the figure, the channel attention is computed from the input feature.',
    '以下是译文：As a result, the high-frequency output and the low-frequency output are concatenated.',
    '〔公式见原文〕〔公式见原文〕〔公式见原文〕',
    '',
  ])('keeps explicit source fallback for ambiguous or untranslated output: %s', (translatedText) => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText, formulaNeedsReview: true, formulaLatex: [] }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toBeUndefined();
    expect(outcome.formulaReviewDraft).toBeUndefined();
    expect(outcome.visualFallbackMessage).toBeTruthy();
    expect(outcome.translatedText).toBe(block.text);
  });

  it('distinguishes source echo from formula-only validation failures', () => {
    const outcome = pdfBackgroundVisualOutcome(block, { translatedText: block.text, formulaNeedsReview: true, formulaLatex: [] }, 'zh-CN');
    expect(outcome.visualFallbackMessage).toContain('模型返回内容与原文相同');
  });

  it('leaves structurally accepted results unchanged', () => {
    const translatedText = String.raw`这是完整的公式译文。\[x=y\]`;
    expect(pdfBackgroundVisualOutcome(block, { translatedText, formulaLatex: ['x=y'] }, 'zh-CN'))
      .toEqual({ blockId: block.id, translatedText, visualProcessed: true });
  });

  it('does not manufacture a translated result from unchanged source prose', () => {
    const text = '这是原来的中文正文，并没有经过任何翻译处理。';
    expect(pdfBackgroundVisualOutcome({ ...block, text }, { translatedText: text, formulaLatex: [] }, 'zh-CN').formulaReviewMessage)
      .toBeUndefined();
  });
});
