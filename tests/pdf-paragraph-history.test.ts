import {describe,it,expect} from 'vitest';
import {parseFormulaDocument} from '../core/translation/formula-document';
import {withParagraphHistory,restoredParagraphRevision,paragraphRevision,validParagraphRevision,MAX_PDF_PARAGRAPH_REVISIONS} from '../core/pdf/paragraph-history';
describe('durable PDF paragraph revisions',()=>{
  it('keeps original formula registry and warnings through correction and restore',()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'旧译文 {{m1}}',formulas:[{id:'m1',latex:'\\mathcal{P}',display:false}]});
    const old={translatedText:formulaDocument.translationTemplate,formulaDocument,formulaReviewMessage:'仍需核对',reviewConfirmation:'review-ab12'};
    const next=withParagraphHistory(old,{...old,manualCorrection:true as const,formulaDocument:{...formulaDocument,translationTemplate:'人工修正 {{m1}}'}},'correction');
    expect(next.revisions).toHaveLength(1);expect(validParagraphRevision(next.revisions![0])).toBe(true);
    const restored=restoredParagraphRevision(next,next.revisions![0]!.id);
    expect(restored.formulaDocument?.formulas).toEqual(formulaDocument.formulas);expect(restored.formulaDocument?.translationTemplate).toBe('旧译文 {{m1}}');expect(restored.formulaReviewMessage).toBe('仍需核对');expect(restored.manualCorrection).toBe(true);expect(restored.revisions).toHaveLength(2);
  });
  it('bounds history, avoids duplicate checkpoint versions and refuses unaccepted candidates',()=>{
    let value=withParagraphHistory(undefined,{translatedText:'第一版'});
    for(let i=0;i<MAX_PDF_PARAGRAPH_REVISIONS;i++)value=withParagraphHistory(value,{translatedText:`版本${i}`});
    expect(value.revisions).toHaveLength(MAX_PDF_PARAGRAPH_REVISIONS);
    const before=structuredClone(value);expect(()=>withParagraphHistory(value,{translatedText:'新版本'})).toThrow('修订历史已满');expect(value).toEqual(before);
    expect(withParagraphHistory(value,{...value,revisions:value.revisions!.slice(0,-1)}).revisions).toEqual(value.revisions);expect(value).toEqual(before);
    expect(()=>withParagraphHistory(value,{...value,revisions:value.revisions!.map((revision,index)=>index?revision:{...revision,translatedText:'冲突'})})).toThrow('修订历史已变化');
    expect(withParagraphHistory(value,{...value,reviewConfirmation:'review-aa'}).revisions).toHaveLength(MAX_PDF_PARAGRAPH_REVISIONS);
    const candidate=paragraphRevision({translatedText:'未验证的返回文字',formulaReviewMessage:'公式未对应'},'unaccepted');
    expect(()=>restoredParagraphRevision({...value,revisions:[candidate]},candidate.id)).toThrow('未通过校验');
    expect(validParagraphRevision({...candidate,apiKey:'not-allowed'})).toBe(false);
  });
  it('does not turn display-reference indentation into a revision but keeps formula font changes',()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'损失函数\n {{m1}}',formulas:[{id:'m1',latex:'\\mathcal{L}',display:true}]});
    const before={translatedText:formulaDocument.translationTemplate,formulaDocument};
    const indented={translatedText:'损失函数\n    {{m1}}',formulaDocument:{...formulaDocument,translationTemplate:'损失函数\n    {{m1}}'}};
    expect(withParagraphHistory(before,indented).revisions).toBeUndefined();
    const reordered={...indented,formulaDocument:{issues:formulaDocument.issues,formulas:formulaDocument.formulas,translationTemplate:indented.formulaDocument.translationTemplate,sourceTemplate:formulaDocument.sourceTemplate,version:formulaDocument.version}};
    expect(withParagraphHistory(before,reordered).revisions).toBeUndefined();
    const changed={...indented,formulaDocument:{...indented.formulaDocument,formulas:indented.formulaDocument.formulas.map(formula=>({...formula,latex:'L'}))}};
    expect(withParagraphHistory(indented,changed).revisions).toHaveLength(1);
    expect(withParagraphHistory(indented,changed).revisions![0]!.formulaDocument?.formulas[0]?.latex).toBe('\\mathcal{L}');
  });
});
