import {describe,expect,it} from 'vitest';
import {pdfReviewQueue,pdfReviewConfirmation,pdfReviewConfirmed,type PdfReviewBlock} from '../core/pdf/review-queue';
const base: PdfReviewBlock={id:'B1',pageNumber:1,included:true,status:'done',translatedText:'正文译文'};
describe('PDF review queue',()=>{
  it('keeps intentional references and excluded blocks out of the queue',()=>{
    expect(pdfReviewQueue([{...base,referencePreserved:true,visualFallbackMessage:'保留'}, {...base,included:false,status:'idle'},base])).toEqual([]);
  });
  it('filters unfinished, failed, formula review and preserved original blocks',()=>{
    const items=[{...base,status:'idle' as const},{...base,status:'error' as const},
      {...base,formulaReviewMessage:'编号缺失'},{...base,visualFallbackMessage:'未翻译'}];
    expect(pdfReviewQueue(items).map(item=>item.kind)).toEqual(['untranslated','failed','formula','original']);
    expect(pdfReviewQueue(items,'formula')).toHaveLength(1);
  });
  it('records user confirmation without removing warnings and invalidates it on changed results',()=>{
    const item={...base,formulaReviewMessage:'公式待核对'};
    const confirmed={...item,reviewConfirmation:pdfReviewConfirmation(item)};
    expect(pdfReviewConfirmed(confirmed)).toBe(true);
    expect(pdfReviewQueue([confirmed])[0]?.block.formulaReviewMessage).toBe('公式待核对');
    expect(pdfReviewConfirmed({...confirmed,translatedText:'另一版译文'})).toBe(false);
    expect(pdfReviewConfirmed({...confirmed,status:'error'})).toBe(false);
  });
  it('invalidates confirmation when the formula changes even if its reference ID stays the same',()=>{
    const item={...base,translatedText:'说明 {{m1}}',formulaReviewMessage:'待核对',formulaDocument:{version:1 as const,
      sourceTemplate:'{{m1}}',translationTemplate:'说明 {{m1}}',formulas:[{id:'m1',latex:'x=y',display:true}],issues:[]}};
    const confirmed={...item,reviewConfirmation:pdfReviewConfirmation(item)};
    expect(pdfReviewConfirmed({...confirmed,translatedText:'说明 \\[x=y\\]'})).toBe(true);
    expect(pdfReviewConfirmed({...confirmed,formulaDocument:{...item.formulaDocument,formulas:[{display:true,latex:'x=y',id:'m1'}]}})).toBe(true);
    expect(pdfReviewConfirmed({...confirmed,formulaDocument:{...item.formulaDocument,formulas:[{id:'m1',latex:'x=z',display:true}]}})).toBe(false);
  });
});
