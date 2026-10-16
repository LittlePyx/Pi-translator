import {describe,it,expect} from 'vitest';
import {preparePdfFormulaProseRepair,finishPdfFormulaProseRepair} from '../core/pdf/formula-prose-repair';
import {formulaDocumentIssues,compactFormulaDocument,type FormulaDocument} from '../core/translation/formula-document';
import {isRuntimeMessage} from '../core/messaging/messages';
import {buildSystemPrompt} from '../core/translation/prompt-builder';
import {translationErrorMessage} from '../core/messaging/user-facing-error';
const document=():FormulaDocument=>({version:1,formulas:[{id:'m1',latex:'\\mathbb{R}',display:false},{id:'m2',latex:'\\mathcal{N}',display:false}],sourceTemplate:'The domain {{m1}} supports a distribution {{m2}} and another {{m2}}.',translationTemplate:'定义域 {{m1}} 上的 {{m2}} 和另一个 {{m2}} 位于 {{m1}}。',issues:[]});
const valid='分布 ⟦PDF_MATH_0002⟧ 与 ⟦PDF_MATH_0003⟧ 定义于 ⟦PDF_MATH_0001⟧。';
describe('formula-locked complete-sentence repair',()=>{
  it('translates complete sentences, allows meaning-preserving local reordering, and retains exact fonts',()=>{
    const original=document(),snapshot=structuredClone(original),prepared=preparePdfFormulaProseRepair(original)!;
    expect(prepared.input.segments).toEqual([{id:'PDF_SENTENCE_1',text:'The domain ⟦PDF_MATH_0001⟧ supports a distribution ⟦PDF_MATH_0002⟧ and another ⟦PDF_MATH_0003⟧.'}]);
    expect(prepared.input.placeholderTokens).toHaveLength(3);expect(prepared.input.contextText).toContain('mathbb');expect(prepared.input.allowPlaceholderReordering).toBe(true);
    const repaired=finishPdfFormulaProseRepair(prepared.document,[{id:'PDF_SENTENCE_1',translatedText:valid}]);expect(formulaDocumentIssues(repaired)).toEqual([]);expect(original).toEqual(snapshot);
    expect(repaired.formulas.map(entry=>entry.latex)).toEqual(['\\mathbb{R}','\\mathcal{N}','\\mathcal{N}']);
    expect(repaired.translationTemplate).toBe('分布 {{m2}} 与 {{m3}} 定义于 {{m1}}。');
    const options={model:'test',sourceLanguage:'en',targetLanguage:'zh-CN',style:'academic' as const};
    expect(buildSystemPrompt(options)).toContain('in the same order');expect(buildSystemPrompt(options,prepared.input)).toContain('never to another segment');
    expect(isRuntimeMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{requestId:'repair',document:original,targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic'}})).toBe(true);
  });
  it('rejects missing, duplicated, unknown units, unregistered math and model uncertainty',()=>{
    const prepared=preparePdfFormulaProseRepair(document())!,one={id:'PDF_SENTENCE_1',translatedText:valid};
    for(const segments of [undefined,[],[one,one],[{...one,id:'UNKNOWN'}]])expect(()=>finishPdfFormulaProseRepair(prepared.document,segments)).toThrow('校验');
    for(const text of [valid+' {{m99}}',valid+' ⟦UNKNOWN⟧',valid+' $R$'])expect(()=>finishPdfFormulaProseRepair(prepared.document,[{...one,translatedText:text}])).toThrow('新增了数学内容');
    for(const text of [valid.replace('⟦PDF_MATH_0001⟧',''),valid+' ⟦PDF_MATH_0001⟧'])expect(()=>finishPdfFormulaProseRepair(prepared.document,[{...one,translatedText:text}])).toThrow('所属句子');
    expect(()=>finishPdfFormulaProseRepair(prepared.document,[one],['需要核对'])).toThrow('模型返回了待核对提示');
  });
  it('keeps formulas in their original sentence even when global formula counts are unchanged',()=>{
    const source=document();source.sourceTemplate+=' A sample {{m2}} remains available.';
    const prepared=preparePdfFormulaProseRepair(source)!;
    const segments=[{id:'PDF_SENTENCE_1',translatedText:valid.replace('⟦PDF_MATH_0003⟧','⟦PDF_MATH_0004⟧')},{id:'PDF_SENTENCE_2',translatedText:'样本 ⟦PDF_MATH_0003⟧ 仍然可用。'}];
    expect(()=>finishPdfFormulaProseRepair(prepared.document,segments)).toThrow('所属句子');
  });
  it('binds complete condition and conclusion propositions and locally protects the another-tuple anaphor',()=>{
    const source:FormulaDocument={version:1,formulas:[{id:'m1',latex:'n',display:false},{id:'m2',latex:'n-1',display:false},{id:'m3',latex:'n',display:false}],sourceTemplate:'One such {{m1}}-tuple counters another if the strategies of {{m2}} players in the countered {{m3}}-tuple are fixed.',translationTemplate:'{{m1}} {{m1}} {{m2}} {{m3}}',issues:[]};
    const prepared=preparePdfFormulaProseRepair(source)!;expect(prepared.input.segments?.map(unit=>unit.id)).toEqual(['PDF_SENTENCE_1_IF','PDF_SENTENCE_1_THEN']);
    expect(prepared.input.segments![0]!.text).not.toContain('⟦PDF_MATH_0001⟧');expect(prepared.input.segments![1]!.text).toContain('⟦PDF_ANAPHORA_0001⟧');
    const segments=[{id:'PDF_SENTENCE_1_IF',translatedText:'被反制的 ⟦PDF_MATH_0003⟧ 元组中 ⟦PDF_MATH_0002⟧ 位参与者的策略已固定。'},{id:'PDF_SENTENCE_1_THEN',translatedText:'该 ⟦PDF_MATH_0001⟧ 元组反制 ⟦PDF_ANAPHORA_0001⟧。'}];
    const result=finishPdfFormulaProseRepair(prepared.document,segments);expect(result.translationTemplate).toBe('如果被反制的 {{m3}} 元组中 {{m2}} 位参与者的策略已固定，则该 {{m1}} 元组反制 另一组。');expect(formulaDocumentIssues(result)).toEqual([]);
    expect(()=>finishPdfFormulaProseRepair(prepared.document,[{...segments[0]!,translatedText:segments[0]!.translatedText+' ⟦PDF_MATH_0001⟧'},segments[1]!])).toThrow('新增了数学内容');
  });
  it('preserves concluding sentences, exceptions, paragraph boundaries and footnotes',()=>{
    const source=document();source.sourceTemplate+='\nThe theorem¹ implies existence. This need not hold in general².';
    const prepared=preparePdfFormulaProseRepair(source)!,segments=[{id:'PDF_SENTENCE_1',translatedText:valid},{id:'PDF_SENTENCE_2',translatedText:'该定理⟦PDF_CITE_0001⟧保证存在性。'},{id:'PDF_SENTENCE_3',translatedText:'一般情况下未必成立⟦PDF_CITE_0002⟧。'}];
    expect(finishPdfFormulaProseRepair(prepared.document,segments).translationTemplate).toContain('。\n该定理¹保证存在性。 一般情况下未必成立²。');
    expect(()=>finishPdfFormulaProseRepair(prepared.document,segments.slice(0,2))).toThrow('缺失或重复');
    expect(()=>finishPdfFormulaProseRepair(prepared.document,segments.map((part,index)=>index===2?{...part,translatedText:'一般情况下成立⟦PDF_CITE_0002⟧。'}:part))).toThrow('否定');
    expect(()=>finishPdfFormulaProseRepair(prepared.document,segments.map((part,index)=>index===2?{...part,translatedText:'一般情况下未必成立。'}:part))).toThrow('所属句子');
  });
  it('rejects a complete formula registry when a long concluding unit is reduced to two characters',()=>{
    const original=document();original.sourceTemplate+=' Since the graph is closed, the theorem implies that this mapping has a fixed point and therefore an equilibrium point exists.';
    const prepared=preparePdfFormulaProseRepair(original)!;
    expect(()=>finishPdfFormulaProseRepair(prepared.document,[{id:'PDF_SENTENCE_1',translatedText:valid},{id:'PDF_SENTENCE_2',translatedText:'对抗'}])).toThrow('语义单元校验');
  });
  it('never repairs uncertain, damaged, source-less or already valid registries',()=>{
    const source=document();expect(preparePdfFormulaProseRepair({...source,issues:['模型报告局部不确定']})).toBeUndefined();
    expect(preparePdfFormulaProseRepair({...source,formulas:[{...source.formulas[0]!,review:'无法确认'},source.formulas[1]!]})).toBeUndefined();
    expect(preparePdfFormulaProseRepair(compactFormulaDocument(source))).toBeUndefined();expect(preparePdfFormulaProseRepair({...source,translationTemplate:source.sourceTemplate},'en')).toBeUndefined();
    expect(preparePdfFormulaProseRepair({...source,sourceTemplate:source.sourceTemplate+' {{m99}}'})).toBeUndefined();expect(preparePdfFormulaProseRepair({...source,sourceTemplate:source.sourceTemplate+' $x$'})).toBeUndefined();
    expect(isRuntimeMessage({type:'REPAIR_PDF_FORMULA_PROSE',payload:{requestId:'bad',document:source,targetLanguage:'unknown',sourceLanguage:'auto',style:'academic'}})).toBe(false);
    const message='正文修复未通过语义单元校验（PDF_SENTENCE_2）：变量关系的主语与对象可能颠倒';expect(translationErrorMessage('LATEX_VALIDATION_FAILED',message)).toBe(message);expect(translationErrorMessage('LATEX_VALIDATION_FAILED','internal provider secret')).not.toContain('internal provider secret');
  });
});
