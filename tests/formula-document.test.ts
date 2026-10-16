import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactFormulaDocument, formulaDocumentIssues, formulaDocumentParts, formulaDocumentText,
  formulaReviewLabel, isFormulaDocument, parseFormulaDocument, recoverLegacyFormulaDocument } from '../core/translation/formula-document';
import { normalizeFormula, reconcileImageFormulaResult } from '../core/translation/formula-output-validation';
import { OpenAiCompatibleTranslator, parseImageTranslation } from '../core/translation/openai-compatible-translator';
import { pdfBackgroundVisualOutcome } from '../core/pdf/background-document-translation';
import { assertSafeImageTranslationResult } from '../core/translation/image-output-safety';

const wire = () => ({ formulaFormat: 'refs-v1', formulas: [
  { id: 'm1', latex: 'E^h', display: false, uncertain: false },
  { id: 'm2', latex: 'E^l', display: false, uncertain: false },
  { id: 'm3', latex: String.raw`\mathrm{S-SA}(F)=\mathrm{Concat}(E^h W_h,E^l W_l)\tag{16}`, display: true, uncertain: false },
], recognizedText: 'High {{m1}} and low {{m2}} are fused: {{m3}}.',
translation: '将高频特征 {{m1}} 和低频特征 {{m2}} 融合，得到最终输出：{{m3}}。', uncertainSpans: [] });
afterEach(() => vi.unstubAllGlobals());

describe('single-copy formula registry', () => {
  it('flags bare Greek commands and single-letter subscripts in current and compact saved prose',()=>{
    for(const text of [String.raw`网络 h_\lambda 的参数为 \lambda。`,'初始 z_0 与当前 z_k。']){
      const doc=parseFormulaDocument({recognizedText:'A network {{m1}} has parameters.',translation:text+' {{m1}}',formulas:[{id:'m1',latex:'x=y',display:false}]});
      expect(formulaDocumentIssues(doc).join()).toContain('未登记');
      const saved=compactFormulaDocument(doc);saved.issues=[];expect(formulaDocumentIssues(saved).join()).toContain('未登记');
    }
    expect(formulaDocumentIssues(parseFormulaDocument({recognizedText:'The file_name identifies a sample.',translation:'file_name 表示一个样本。',formulas:[]}))).toEqual([]);
  });
  it('requires mathematical context and exact counts for newly delimited lowercase variables', () => {
    const doc=parseFormulaDocument({recognizedText:'Use n inputs for {{m1}}, with a loss between f and g.',
      translation:'使用 $n$ 个输入计算 {{m1}}，并计算 $f$ 与 $g$ 之间的损失。',
      formulas:[{id:'m1',latex:'y=f(x)+g(x)',display:false}]});
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(formulaDocumentIssues(parseFormulaDocument({recognizedText:'Choice b or c.',translation:'选择 $b$ 或 $c$。',formulas:[]})).length).toBeGreaterThan(0);
    expect(formulaDocumentIssues(parseFormulaDocument({recognizedText:'Use n inputs.',translation:'使用 $n$ 个输入，再使用 $n$。',formulas:[]})).length).toBeGreaterThan(0);
    expect(formulaDocumentIssues(parseFormulaDocument({recognizedText:'Use n inputs.',translation:'使用 $\\mathbf{n}$ 个输入。',formulas:[]})).length).toBeGreaterThan(0);
  });
  it('recovers exact legacy math and repeated bare identifiers when the PDF classifier missed them', () => {
    const source=String.raw`Crop $32\times32$ to $28\times28$ for an N-way task with N classes and labels $0,\dots,N-1$.`;
    const target=String.raw`将 $32\times32$ 裁剪为 $28\times28$，用于含有 $N$ 个类别的 $N$ 路任务，标签为 $0,\dots,N-1$。`;
    const doc=recoverLegacyFormulaDocument(source,target)!;
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(doc.formulas.filter(entry=>entry.latex==='N')).toHaveLength(1);
    const outcome=pdfBackgroundVisualOutcome({id:'P8B3',text:'Finally we apply the model to one-shot classification using a public dataset.',containsFormula:false,visualPurpose:'document'},
      {recognizedText:source,translatedText:target,formulaNeedsReview:true},'zh-CN');
    expect(outcome.visualProcessed).toBe(true);
    expect(outcome.visualFallbackMessage).toBeUndefined();
    expect(recoverLegacyFormulaDocument(source,target.replaceAll('$N$','$M$'))?.formulas.some(entry=>entry.review)).toBe(true);
  });
  it('unwraps only an exactly registered reference with matching display mode and keeps uncertainty', () => {
    const record={formulas:[{id:'m1',latex:String.raw`M\ll N`,display:false}],recognizedText:'Condition {{m1}}.',translation:'条件为 ${{m1}}$。'};
    const doc=parseFormulaDocument(record);
    expect(doc.formulas).toHaveLength(1);
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(formulaDocumentText(doc)).toBe('条件为 $M\\ll N$。');
    const uncertain=parseFormulaDocument({...record,formulas:[{...record.formulas[0],uncertain:true}]});
    expect(formulaDocumentIssues(uncertain).join()).toContain('无法确认');
  });
  it.each(['${{m1}}+1$','${{m9}}$',String.raw`\[{{m1}}\]`])('does not unwrap unknown, changed or differently displayed reference math: %s',translation=>{
    const doc=parseFormulaDocument({formulas:[{id:'m1',latex:'N',display:false}],recognizedText:'Window {{m1}}.',translation});
    expect(formulaDocumentIssues(doc).length).toBeGreaterThan(0);
  });
  it('recovers exact bounded N, pN and beta source occurrences without a second model request', () => {
    const doc = parseFormulaDocument({formulaFormat: 'refs-v1', formulas: [],
      recognizedText: 'Attention uses an N-pixel window and a pN-pixel window; the factor is β.',
      translation: '注意力使用 $N$ 像素与 $pN$ 像素窗口，参数为 $\\beta$。'});
    expect(formulaDocumentText(doc)).toBe('注意力使用 $N$ 像素与 $pN$ 像素窗口，参数为 $\\beta$。');
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(doc.formulas.every(entry => !entry.review)).toBe(true);
    expect(formulaDocumentText(compactFormulaDocument(doc))).toBe(formulaDocumentText(doc));
  });
  it.each(['x=y', String.raw`\\mathbf{N}`, '<img src=x>', 'N^{broken'])('does not present a complex or damaged %s formula as accepted candidate math', (latex) => {
    const entry = {id: 'm5', latex, display: false, review: '需核对'};
    expect(formulaReviewLabel(entry)).toBe('〔公式 5·待核对〕');
  });
  it('registers plain quantities in both templates and reuses a declared source identifier in a plain translation', () => {
    const plain = parseFormulaDocument({formulas: [], recognizedText: 'Use N-pixel and pN-pixel windows; β is a factor.', translation: '使用 N 像素与 pN 像素窗口，β 为系数。'});
    expect(formulaDocumentIssues(plain)).toEqual([]);
    expect(formulaDocumentText(plain)).toBe('使用 $N$ 像素与 $pN$ 像素窗口，$β$ 为系数。');
    const declared = parseFormulaDocument({formulas:[{id:'m1',latex:'N',display:false}], recognizedText:'Window {{m1}}.', translation:'窗口 N。'});
    expect(formulaDocumentIssues(declared)).toEqual([]);
    expect(declared.formulas).toHaveLength(1);
    expect(formulaDocumentText(declared)).toBe('窗口 $N$。');
  });
  it.each([
    ['Attention uses N-pixel windows.', '窗口为 $N$，另一个为 $N$。'],
    ['Attention uses N-pixel windows.', '窗口为 $n$。'],
    ['Attention uses N-pixel windows.', '窗口为 $\\mathbf{N}$。'],
    ['A method is described.', '方法为 $A$。'],
    ['Source https://example.com/N/file.', '内容 $N$。'],
    ['Source `N` is code.', '内容 $N$。'],
    ['The variable is ϑ.', '变量为 $\\theta$。'],
  ])('keeps mismatched or ambiguous identifiers unresolved: %s', (recognizedText, translation) => {
    expect(formulaDocumentIssues(parseFormulaDocument({formulas:[],recognizedText,translation})).length).toBeGreaterThan(0);
  });
  it('does not clear an explicit uncertainty flag while recovering a bare identifier', () => {
    const doc = parseFormulaDocument({formulas:[{id:'m1',latex:'N',display:false,uncertain:true}], recognizedText:'N-pixel windows.', translation:'窗口 {{m1}}。'});
    expect(formulaDocumentIssues(doc).join()).toContain('模型标记为无法确认');
  });
  it('does not turn a Greek letter in a plain biological name into an inferred mathematical font', () => {
    const doc=parseFormulaDocument({formulas:[],recognizedText:'The β-actin protein is measured.',translation:'测量 β-actin 蛋白。'});
    expect(doc.formulas).toEqual([]);expect(formulaDocumentText(doc)).toBe('测量 β-actin 蛋白。');
  });
  it('materializes inline/display math from one numbered registry', () => {
    const doc = parseFormulaDocument(wire());
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(formulaDocumentText(doc)).toContain('$E^h$');
    expect(formulaDocumentText(doc)).toContain(String.raw`\tag{16}\]`);
    expect(formulaDocumentText(doc).match(/\\tag\{16\}/gu)).toHaveLength(1);
    expect(doc.translationTemplate).not.toContain('Concat');
  });
  it('supports changed sentence order without moving the wrong formula by index', () => {
    const input = wire(); input.translation = '低频 {{m2}} 与高频 {{m1}} 经下式融合：{{m3}}';
    const doc = parseFormulaDocument(input);
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(formulaDocumentText(doc)).toMatch(/低频 \$E\^l\$ 与高频 \$E\^h\$/u);
  });
  it.each(['damaged', 'uncertain', 'duplicate', 'missing', 'repeated-reference'])(
    'isolates one %s formula while retaining all other math', (mode) => {
      const input = wire();
      if (mode === 'damaged') input.formulas[1]!.latex = 'E^{l';
      if (mode === 'uncertain') input.formulas[1]!.uncertain = true;
      if (mode === 'duplicate') input.formulas.push({ ...input.formulas[1]! });
      if (mode === 'missing') input.formulas.splice(1, 1);
      if (mode === 'repeated-reference') input.translation += '{{m2}}';
      const doc = parseFormulaDocument(input);
      const parts = formulaDocumentParts(doc).filter((part) => 'formula' in part).map((part) => part.formula);
      expect(parts.find((entry) => entry.id === 'm1')?.review).toBeUndefined();
      expect(parts.find((entry) => entry.id === 'm2')?.review).toBeTruthy();
      expect(parts.find((entry) => entry.id === 'm3')?.review).toBeUndefined();
      expect(formulaDocumentText(doc)).toContain('$E^h$');
      expect(formulaDocumentText(doc)).toContain('Concat');
      expect(formulaDocumentText(doc)).not.toContain('$E^l$');
    },
  );
  it('reports an omitted source formula without appending it in an invented position', () => {
    const input = wire(); input.translation = input.translation.replace('{{m2}}', '');
    const doc = parseFormulaDocument(input);
    expect(formulaDocumentIssues(doc).join()).toContain('m2');
    expect(formulaDocumentText(doc)).not.toContain('E^l$');
    expect(formulaDocumentText(doc)).toContain('Concat');
  });
  it('does not silently accept unregistered LaTeX in a prose template', () => {
    const input = wire(); input.translation += '$z=w$';
    const doc = parseFormulaDocument(input);
    expect(formulaDocumentIssues(doc).join()).toContain('无法与识别原文可靠对应');
    expect(formulaDocumentText(doc)).not.toContain('z=w');
    expect(formulaDocumentParts(doc).at(-1)).toMatchObject({ formula: { latex: 'z=w', review: expect.any(String) } });
  });
  it('allows repeated identical content IDs while giving each occurrence a distinct identity', () => {
    const input = wire(); input.recognizedText += 'Window {{m4}}, window {{m4}}.';
    input.translation += '窗口 {{m4}}，窗口 {{m4}}。';
    input.formulas.push({ id: 'm4', latex: 'N', display: false, uncertain: false });
    const doc = compactFormulaDocument(parseFormulaDocument(input));
    // Upgrade the old count-only warning locally, without another API call.
    doc.formulas.find((entry) => entry.id === 'm4')!.review = '原文或译文中的编号缺失或重复';
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(formulaDocumentText(doc).match(/\$N\$/gu)).toHaveLength(2);
    expect(formulaDocumentParts(doc).filter((p) => 'formula' in p && p.formula.id === 'm4')
      .map((p) => 'occurrenceId' in p ? p.occurrenceId : '')).toEqual(['m4:1', 'm4:2']);
  });
  it.each([String.raw`R^{H \times W \times C}`, String.raw`\mathbb{R}^{H \times W}`])('registers exact balanced bare math %s in both templates', (latex) => {
    const input = wire(); input.recognizedText = `${latex}, ${input.recognizedText}`;
    input.translation = `${latex}，${input.translation}`;
    const doc = parseFormulaDocument(input);
    expect(formulaDocumentIssues(doc)).toEqual([]);
    expect(doc.translationTemplate).not.toContain(latex);
    expect(formulaDocumentParts(doc)[0]).toMatchObject({ formula: { latex } });
  });
  it('warns about broken bare math and does not guess its missing braces', () => {
    const input = wire(); input.translation += String.raw` R^{H \times W`;
    expect(formulaDocumentIssues(parseFormulaDocument(input)).join()).toContain('破损');
  });
  it('revalidates source references even if a stored review flag is removed', () => {
    const input = wire(); input.translation += '{{m2}}';
    const doc = parseFormulaDocument(input);
    delete doc.formulas[1]!.review;
    expect(formulaDocumentIssues(doc).join()).toContain('m2');
    expect(formulaDocumentText(doc)).not.toContain('$E^l$');
  });
  it('retains only source reference order in PDF storage', () => {
    const doc = compactFormulaDocument(parseFormulaDocument(wire()));
    expect(doc.sourceTemplate).toBe('{{m1}} {{m2}} {{m3}}');
    expect(JSON.stringify(doc)).not.toContain('are fused');
    expect(formulaDocumentIssues(doc)).toEqual([]);
  });
  it.each(['image', 'url', 'apiKey'])('rejects an unexpected stored %s field', (field) => {
    const doc = parseFormulaDocument(wire());
    expect(isFormulaDocument({ ...doc, [field]: 'unexpected' })).toBe(false);
    expect(isFormulaDocument({ ...doc, formulas: [{ ...doc.formulas[0], [field]: 'unexpected' }] })).toBe(false);
  });
  it('rejects oversized or malformed registries', () => {
    expect(() => parseFormulaDocument({ ...wire(), formulas: new Array(100).fill(wire().formulas[0]) })).toThrow();
    expect(() => parseFormulaDocument({ ...wire(), translation: 'x'.repeat(16001) })).toThrow();
    expect(isFormulaDocument({ ...parseFormulaDocument(wire()), version: 2 })).toBe(false);
  });
  it('does not permit image data hidden in an unused formula', () => {
    const input = wire(); input.formulas[0]!.latex = 'data:image/png;base64,AAAA';
    const parsed = parseImageTranslation(JSON.stringify(input));
    expect(() => assertSafeImageTranslationResult(parsed)).toThrow();
  });
  it('returns the registry through the PDF background outcome with no wholesale fallback', () => {
    const input = wire(); input.formulas[1]!.uncertain = true;
    const result = parseImageTranslation(JSON.stringify(input));
    const outcome = pdfBackgroundVisualOutcome({ id: 'p', text: 'High and low features', containsFormula: true,
      visualPurpose: 'formula' }, result, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('m2');
    expect(outcome.translatedText).toContain('Concat');
    expect(outcome.formulaReviewDraft).toBeUndefined();
    expect(outcome.formulaDocument?.sourceTemplate).not.toContain('features');
  });
  it('keeps exact legacy matches when another formula differs', () => {
    const doc = recoverLegacyFormulaDocument('High $E^h$, low $E^l$.', '高频 $E^h$，低频 $E^x$。')!;
    expect(formulaDocumentText(doc)).toContain('$E^h$');
    expect(doc.formulas[1]!.review).toBeTruthy();
  });
  it.each(['unchanged', 'omitted'])('does not call %s body prose successful just because IDs match', (mode) => {
    const input = wire();
    input.translation = mode === 'unchanged' ? input.recognizedText : '{{m1}} {{m2}} {{m3}}';
    const block = { id: 'p', text: 'As a result, high and low frequency features are reshaped and fused.',
      containsFormula: true, visualPurpose: 'formula' as const };
    const result = pdfBackgroundVisualOutcome(block, parseImageTranslation(JSON.stringify(input)), 'zh-CN');
    expect(result.visualProcessed).toBe(false);
    expect(result.translatedText).toBe(block.text);
    expect(result.visualFallbackMessage).toContain(mode === 'unchanged' ? '模型返回内容与原文相同' : '遗漏正文译文');
  });
  it('does not recover an ambiguous legacy block by position', () => {
    expect(recoverLegacyFormulaDocument('Source $x=y$.', '中文 $x=z$。')).toBeUndefined();
    const result = reconcileImageFormulaResult({ recognizedText: 'Source $x$ then $y$.',
      translatedText: '译文 $y$ 然后 $x$。', formulaLatex: ['x', 'y'], uncertainSpans: [] });
    expect(result.translatedText).toBe('译文 $y$ 然后 $x$。');
  });
  it('normalizes harmless whitespace without equating command names or mathematical fonts', () => {
    expect(normalizeFormula(String.raw`\lambda \mathcal{R}(x)`)).toBe(normalizeFormula(String.raw`\lambda\mathcal{R}(x)`));
    expect(normalizeFormula(String.raw`\alpha b`)).not.toBe(normalizeFormula(String.raw`\alphab`));
    expect(normalizeFormula(String.raw`\mathbf{E}`)).not.toBe(normalizeFormula('E'));
  });
  it.each([false, true])('requests one registry (stream=%s), without exposing incomplete references', async (stream) => {
    const values: Record<string, unknown> = {};
    vi.stubGlobal('browser', { storage: { session: {
      get: async (key: string) => ({ [key]: values[key] }), set: async (next: object) => Object.assign(values, next),
    } } });
    const content = JSON.stringify(wire());
    const split = content.indexOf('得到最终');
    const streamBody = [content.slice(0, split), content.slice(split)].map((chunk) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    const fetchMock = vi.fn().mockImplementation(async () => new Response(stream ? streamBody : JSON.stringify({
      choices: [{ message: { content } }],
    }), { headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onPartialText = vi.fn();
    const result = await new OpenAiCompatibleTranslator().translateImageRegion({ visualPurpose: 'formula',
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', imageWidth: 200, imageHeight: 120 },
    { model: 'local-fixture', sourceLanguage: 'auto', targetLanguage: 'zh-CN', style: 'academic' },
    { apiBaseUrl: 'https://fixture.invalid/v1', apiKey: 'test' }, new AbortController().signal,
    stream ? { onPartialText } : undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.formulaNeedsReview).toBeUndefined();
    expect(result.formulaDocument?.formulas).toHaveLength(3);
    const prompt = JSON.parse(fetchMock.mock.calls[0]![1].body).messages[0].content[1].text;
    expect(prompt).toContain('refs-v1');
    expect(prompt).not.toContain('recognizedText 和 translation 中必须嵌入完全相同');
    if (stream) {
      expect(onPartialText).toHaveBeenCalledTimes(1);
      expect(onPartialText).toHaveBeenCalledWith(result.translatedText);
      expect(onPartialText.mock.calls[0]![0]).not.toContain('{{m');
    }
  });
});
