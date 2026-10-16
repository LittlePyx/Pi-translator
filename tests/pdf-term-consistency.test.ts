import {describe,it,expect} from 'vitest';
import {checkPdfTermConsistency,containsPdfTerm,previewPdfTermCorrection} from '../core/pdf/term-consistency';
import {parseFormulaDocument} from '../core/translation/formula-document';
const term={source:'kernel',target:'核函数'};
describe('local PDF terminology review',()=>{
  it('matches complete source terms, respects confirmed wording and labels manual edits as protected',()=>{
    expect(containsPdfTerm('The kernels and unkernelled object','kernel')).toBe(false);expect(containsPdfTerm('A KERNEL maps data','kernel')).toBe(true);
    const block={id:'P1B1',pageNumber:1,text:'The kernel maps data.',translatedText:'内核映射数据。',included:true,status:'done'};
    expect(checkPdfTermConsistency([block,{...block,id:'manual',manualCorrection:true},{...block,id:'ok',translatedText:'核函数映射数据。'},{...block,id:'ref',referencePreserved:true},{...block,id:'draft',formulaReviewDraft:true},{...block,id:'missing',status:'idle'}],[term])).toMatchObject([{blockId:'P1B1',protected:false},{blockId:'manual',protected:true}]);
  });
  it('does not accept a fixed term found only inside a formula as translated prose',()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'计算 {{m1}}',formulas:[{id:'m1',latex:'\\text{核函数}',display:false}]});
    expect(checkPdfTermConsistency([{id:'a',pageNumber:1,text:'The kernel',translatedText:formulaDocument.translationTemplate,formulaDocument,included:true,status:'done'}],[term])).toHaveLength(1);
  });
  it('previews a targeted prose change while preserving formula identities, numbers and font commands',()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'内核与 {{m1}} 中的内核',formulas:[{id:'m1',latex:'\\mathcal{K}+\\text{内核}',display:true,equationNumber:'3'}]});
    const corrected=previewPdfTermCorrection({translatedText:formulaDocument.translationTemplate,formulaDocument},'内核','核函数');
    expect(corrected.formulaDocument?.formulas).toEqual(formulaDocument.formulas);expect(corrected.formulaDocument?.translationTemplate).toBe('核函数与 {{m1}} 中的核函数');
    expect(()=>previewPdfTermCorrection(corrected,'核函数','$x$')).toThrow();expect(()=>previewPdfTermCorrection(corrected,'\\mathcal{K}','K')).toThrow('未在本段');
  });
});
