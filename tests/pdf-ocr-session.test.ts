import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {PDF_OCR_SESSION_KEY,readPdfOcrSession,savePdfOcrSessionPage} from '../core/pdf/ocr-session-repository';
import type {CoordinateOcrPage} from '../core/pdf/ocr-text-layer';
const stored:Record<string,unknown>={};
const page=(pageNumber=1):CoordinateOcrPage=>({pageNumber,coordinateSystem:'normalized-page',source:'qwen-advanced-recognition',blocks:[{id:'text',order:0,kind:'text',text:'Original scanned text $n-1$.',confidence:.9,box:{left:.1,top:.1,width:.8,height:.1}}]});
beforeEach(()=>{for(const key of Object.keys(stored))delete stored[key];vi.stubGlobal('browser',{storage:{session:{get:vi.fn(async(key:string)=>({[key]:structuredClone(stored[key])})),set:vi.fn(async(value:Record<string,unknown>)=>{Object.assign(stored,structuredClone(value))})},local:{set:vi.fn()}}})});
afterEach(()=>vi.unstubAllGlobals());
describe('browser-session OCR source recovery',()=>{
  it('merges concurrent page saves and restores only an identical fingerprint and page count',async()=>{
    const fingerprint='a'.repeat(64);await Promise.all([savePdfOcrSessionPage(fingerprint,2,page(1)),savePdfOcrSessionPage(fingerprint,2,page(2))]);
    expect(await readPdfOcrSession(fingerprint,2)).toEqual([page(1),page(2)]);expect(await readPdfOcrSession('b'.repeat(64),2)).toEqual([]);expect(await readPdfOcrSession(fingerprint,3)).toEqual([]);expect(browser.storage.local.set).not.toHaveBeenCalled();
    const edited=page(1);edited.blocks[0]!.text='Changed source';await savePdfOcrSessionPage(fingerprint,2,edited);expect((await readPdfOcrSession(fingerprint,2))[0]).toEqual(edited);
  });
  it('rejects malformed geometry and retains the old source on storage failure',async()=>{
    const fingerprint='a'.repeat(64);await savePdfOcrSessionPage(fingerprint,2,page());const before=structuredClone(stored);
    const bad=page(2);bad.blocks[0]!.box.width=2;await expect(savePdfOcrSessionPage(fingerprint,2,bad)).rejects.toThrow('匹配');expect(stored).toEqual(before);
    vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('quota'));await expect(savePdfOcrSessionPage(fingerprint,2,page(2))).rejects.toThrow('quota');expect(stored).toEqual(before);
    stored[PDF_OCR_SESSION_KEY]=[{fingerprint,pageCount:2,pages:[bad],updatedAt:1}];expect(await readPdfOcrSession(fingerprint,2)).toEqual([]);
  });
  it('bounds cached source by document count without discarding pages from the current document',async()=>{
    for(let index=1;index<=8;index++)await savePdfOcrSessionPage(index.toString(16).repeat(64),2,page());
    expect((stored[PDF_OCR_SESSION_KEY] as unknown[]).length).toBe(6);await savePdfOcrSessionPage('8'.repeat(64),2,page(2));expect(await readPdfOcrSession('8'.repeat(64),2)).toHaveLength(2);
    await browser.storage.session.set({[PDF_OCR_SESSION_KEY]:undefined});expect(await readPdfOcrSession('8'.repeat(64),2)).toEqual([]);
  });
});
