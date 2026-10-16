import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {validateCoordinateOcrPage,type CoordinateOcrPage} from './ocr-text-layer';
export const PDF_OCR_SESSION_KEY='pdfCoordinateOcrSessionsV1';
interface OcrSession {fingerprint:string;pageCount:number;pages:CoordinateOcrPage[];updatedAt:number}
const validFingerprint=(value:string)=>/^[a-f0-9]{64}$/u.test(value);
function sessions(value:unknown):OcrSession[]{
  if(!Array.isArray(value))return [];
  return value.slice(0,6).flatMap(item=>{
    if(!item||!validFingerprint(item.fingerprint)||!Number.isSafeInteger(item.pageCount)||item.pageCount<1||!Array.isArray(item.pages)||!Number.isFinite(item.updatedAt))return [];
    const pages:CoordinateOcrPage[]=[];
    for(const raw of item.pages){const result=validateCoordinateOcrPage(raw);if(!result.ok||result.page.pageNumber>item.pageCount||pages.some(page=>page.pageNumber===result.page.pageNumber))return [];pages.push(result.page)}
    return [{fingerprint:item.fingerprint,pageCount:item.pageCount,pages,updatedAt:item.updatedAt}];
  });
}
/** Source text and coordinates stay in browser-session storage, never local backups or diagnostics. */
export async function readPdfOcrSession(fingerprint:string,pageCount:number):Promise<CoordinateOcrPage[]>{
  if(!validFingerprint(fingerprint))return [];
  const stored=await browser.storage.session.get(PDF_OCR_SESSION_KEY);
  return sessions(stored[PDF_OCR_SESSION_KEY]).find(item=>item.fingerprint===fingerprint&&item.pageCount===pageCount)?.pages??[];
}
export function savePdfOcrSessionPage(fingerprint:string,pageCount:number,page:CoordinateOcrPage):Promise<void>{return withDocumentStorageLock(async()=>{
  const result=validateCoordinateOcrPage(page);
  if(!validFingerprint(fingerprint)||!Number.isSafeInteger(pageCount)||pageCount<1||!result.ok||result.page.pageNumber>pageCount)throw new Error('临时 OCR 页面与文件信息不匹配。');
  const all=sessions((await browser.storage.session.get(PDF_OCR_SESSION_KEY))[PDF_OCR_SESSION_KEY]);
  const previous=all.find(item=>item.fingerprint===fingerprint&&item.pageCount===pageCount);
  const current={fingerprint,pageCount,pages:[...(previous?.pages??[]).filter(item=>item.pageNumber!==page.pageNumber),result.page].sort((a,b)=>a.pageNumber-b.pageNumber),updatedAt:Date.now()};
  const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if(size([current])>2_000_000)throw new Error('临时 OCR 结果超过 2 MB；本页仍在当前窗口可用。');
  const next=[current,...all.filter(item=>item.fingerprint!==fingerprint).sort((a,b)=>b.updatedAt-a.updatedAt)].slice(0,6);
  while(size(next)>2_000_000&&next.length>1)next.pop();
  await browser.storage.session.set({[PDF_OCR_SESSION_KEY]:next});
})}
