import {describe,it,expect} from 'vitest';
import {consumePdfRequest,emptyPdfRequestUsage,validPdfRequestLimit,validPdfRequestUsage} from '../core/pdf/request-budget';
describe('PDF request budget',()=>{
  it('counts text, image and OCR task requests together and blocks before sending',()=>{
    const usage=emptyPdfRequestUsage();
    consumePdfRequest(usage,'text',2);consumePdfRequest(usage,'vision',2);
    expect(()=>consumePdfRequest(usage,'ocr',2)).toThrow('任务请求上限');
    expect(usage).toEqual({text:1,vision:1,ocr:0});
    consumePdfRequest(usage,'ocr',3);
    expect(usage.ocr).toBe(1);
  });
  it('accepts unlimited mode and rejects malformed limits or counts',()=>{
    const usage=emptyPdfRequestUsage();consumePdfRequest(usage,'text',0);
    expect(validPdfRequestLimit(0)).toBe(true);
    for(const value of [-1,1.2,'2',Infinity,100001])expect(validPdfRequestLimit(value)).toBe(false);
    expect(validPdfRequestUsage({text:0,vision:-1,ocr:0})).toBe(false);
  });
});
