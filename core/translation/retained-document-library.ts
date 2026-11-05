import {withDocumentStorageLock} from './document-storage-lock';
import { listRetainedPdfDocumentTranslations, clearRetainedPdfDocumentTranslationSession,setRetainedPdfDocumentPinned,retainedPdfRecordsForBackup } from '../pdf/document-translation-session';
import { formulaDocumentText } from './formula-document';
import { listRetainedBilingualPageTranslations, clearRetainedBilingualPageSession,setRetainedBilingualPagePinned,retainedWebRecordsForBackup } from './bilingual-page-session';
import {fixedDocumentKey,readFixedDocumentRecords,retainedDocumentId,retainedDocumentStorageCost} from './fixed-document-storage';
import {pdfSavedDocumentProgress} from '../pdf/document-progress';
import {pdfReviewConfirmed} from '../pdf/review-queue';
import type {FormulaDocument} from './formula-document';
import {pdfReadingStateId,PDF_READING_STATES_KEY,normalizePdfReadingState,type PdfReadingState} from '../pdf/reading-state';

export const RETAINED_DOCUMENT_NAMES_KEY = 'retainedDocumentNamesV1';
export interface RetainedLibraryEntry {
  readingId?:string;
  reading?:PdfReadingState;
  id: string; kind: 'pdf' | 'web'; name: string; targetLanguage: string;
  updatedAt: number; blockCount: number; characters: number; text: string; markdown: string;
  pinned:boolean; totalBlocks:number; processedCount:number; state:'complete'|'paused'|'active'|'stopped'|'incomplete'; reviewCount:number;
  coverageKnown:boolean; preservedCount:number; confirmedCount:number;
  estimatedBytes:number;
  blocks: {signature:string;text:string;formulaDocument?:FormulaDocument;warning?:string}[];
}
function documentId(kind: string, session: {targetLanguage: string; sourceLanguage: string; style: string; contentMode: string}, key: string): string {
  return JSON.stringify([kind, key, session.targetLanguage, session.sourceLanguage, session.style, session.contentMode]);
}
function validNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, name]) => key.length <= 500 &&
    typeof name === 'string' && name.trim().length > 0 && name.length <= 120)) as Record<string, string>;
}
export async function listRetainedDocuments(): Promise<RetainedLibraryEntry[]> {
  const [pdf, web, stored, fixedPdf, fixedWeb, positions] = await Promise.all([listRetainedPdfDocumentTranslations(), listRetainedBilingualPageTranslations(),
    browser.storage.local.get(RETAINED_DOCUMENT_NAMES_KEY),readFixedDocumentRecords('pdf'),readFixedDocumentRecords('web'),browser.storage.local.get(PDF_READING_STATES_KEY)]);
  const fixed={...fixedPdf,...fixedWeb};
  const names = validNames(stored[RETAINED_DOCUMENT_NAMES_KEY]);
  const rawPositions=positions[PDF_READING_STATES_KEY];
  const readingStates=rawPositions&&typeof rawPositions==='object'&&!Array.isArray(rawPositions)?rawPositions as Record<string,unknown>:{};
  const entries = [
    ...pdf.map((session) => ({kind: 'pdf' as const, session, key: session.documentKey})),
    ...web.map((session) => ({kind: 'web' as const, session, key: session.pageKey})),
  ];
  const result=await Promise.all(entries.map(async ({kind, session, key}) => {
    const id = documentId(kind, session, key);
    const blocks = [...session.blocks].sort((left, right) => session.documentSignatures.indexOf(left.signature) - session.documentSignatures.indexOf(right.signature));
    const readingBlocks = blocks.map((block) => {
      const pdfBlock = block as typeof pdf[number]['blocks'][number];
      const translation = pdfBlock.formulaDocument ? formulaDocumentText(pdfBlock.formulaDocument) : block.translatedText;
      const warning = pdfBlock.formulaReviewMessage || pdfBlock.visualFallbackMessage;
      const confirmed=pdfReviewConfirmed({...pdfBlock,id:block.signature,pageNumber:1,included:true,status:'done'});
      return {signature:block.signature,text:translation,...(pdfBlock.formulaDocument?{formulaDocument:pdfBlock.formulaDocument}:{}),
        ...(warning?{warning:`${confirmed?'已人工核对（保留原警告）':'待核对'}：${warning}`}:{})};
    });
    const text=readingBlocks.map(block=>block.text+(block.warning?`\n\n> ${block.warning.replace(/\r?\n/gu,'\n> ')}`:'')).join('\n\n---\n\n');
    const firstLine=readingBlocks[0]?.text.split(/\r?\n/u).find(line=>line.trim())?.replace(/^\s*[#*]+\s*/u,'').trim();
    const name=names[id] || (firstLine ? firstLine.slice(0,60)+(firstLine.length>60?'…':'') : `未命名 ${kind==='pdf'?'PDF':'网页'} · ${key.slice(-6)}`);
    const progress=kind==='pdf'?pdfSavedDocumentProgress(session as typeof pdf[number]):undefined;
    const scopedSignatures=session.documentSignatures.filter(signature=>!('excludedSignatures' in session&&(session.excludedSignatures as string[]).includes(signature)));
    const totalBlocks=progress?.total??scopedSignatures.length;
    const processedCount=progress?.processed??blocks.filter(block=>scopedSignatures.includes(block.signature)).length;
    const coverageKnown=progress?.coverageKnown??true;
    const complete=progress?.complete??(totalBlocks>0&&processedCount>=totalBlocks);
    const state:RetainedLibraryEntry['state']=complete?'complete':coverageKnown&&session.activity==='complete'?'incomplete':session.activity;
    const reviewCount=progress?.review??0;
    const fingerprint=kind==='pdf'?(session as typeof pdf[number]).sourceFingerprint:undefined;
    const readingId=fingerprint?await pdfReadingStateId(`pdf-content:${fingerprint}`):undefined;
    const legacyReading=normalizePdfReadingState(readingStates[await pdfReadingStateId(`library:${id}`)]);
    const contentReading=readingId?normalizePdfReadingState(readingStates[readingId]):undefined;
    const reading=contentReading&&(!legacyReading||contentReading.updatedAt>=legacyReading.updatedAt)?contentReading:legacyReading;
    return {id, kind, name, targetLanguage: session.targetLanguage, updatedAt: session.updatedAt,
      ...(readingId?{readingId}:{}),...(reading?{reading}:{}),
      pinned:Boolean(fixed[fixedDocumentKey(kind,session)]),totalBlocks,processedCount,reviewCount,
      coverageKnown,preservedCount:progress?.preserved??0,confirmedCount:progress?.confirmed??0,blocks:readingBlocks,
      state,
      estimatedBytes:retainedDocumentStorageCost(session).estimatedBytes,
      blockCount: blocks.length, characters: text.length, text,
      markdown: `# ${name.replace(/[\r\n]/gu, ' ').replace(/([\\`*_\[\]<>#])/gu, '\\$1')}\n\n目标语言：${session.targetLanguage}\n\n仅导出保留的译文；此记录不含原文、页码和来源。\n\n${text}\n`};
  }));
  return result.sort((left, right) => Number(right.pinned)-Number(left.pinned)||right.updatedAt-left.updatedAt);
}
export async function setRetainedDocumentPinned(id:string,pinned:boolean):Promise<void>{
  const [pdf,web]=await Promise.all([listRetainedPdfDocumentTranslations(),listRetainedBilingualPageTranslations()]);
  const pdfSession=pdf.find(session=>documentId('pdf',session,session.documentKey)===id);
  const webSession=web.find(session=>documentId('web',session,session.pageKey)===id);
  if(pdfSession)await setRetainedPdfDocumentPinned(pdfSession,pinned);
  else if(webSession)await setRetainedBilingualPagePinned(webSession,pinned);
  else throw new Error('这份译文已被移除，请刷新。');
}
let nameWriteTail: Promise<unknown> = Promise.resolve();
async function retainedIdsInsideStorageLock():Promise<string[]>{
  const [pdf,web]=await Promise.all([retainedPdfRecordsForBackup(),retainedWebRecordsForBackup()]);
  return [...pdf.map(record=>retainedDocumentId('pdf',record)),...web.map(record=>retainedDocumentId('web',record))];
}
export function renameRetainedDocument(id: string, name: string): Promise<void> {
  if (!name.trim() || name.trim().length > 120) return Promise.reject(new Error('名称需为 1–120 个字符。'));
  const run = nameWriteTail.catch(() => undefined).then(async () => {
    await withDocumentStorageLock(async()=>{
    const ids=await retainedIdsInsideStorageLock();
    if(!ids.includes(id))throw new Error('这份译文已被移除，请刷新。');
    const stored = await browser.storage.local.get(RETAINED_DOCUMENT_NAMES_KEY);
    const names = validNames(stored[RETAINED_DOCUMENT_NAMES_KEY]);
    const retained = Object.fromEntries(ids.flatMap(id=>names[id]?[[id,names[id]]]:[]));
    retained[id] = name.trim();
    await browser.storage.local.set({[RETAINED_DOCUMENT_NAMES_KEY]: retained});
    });
  });
  nameWriteTail = run;
  return run;
}
export async function deleteRetainedDocument(id: string): Promise<void> {
  const [pdf, web] = await Promise.all([listRetainedPdfDocumentTranslations(), listRetainedBilingualPageTranslations()]);
  const pdfSession = pdf.find((session) => documentId('pdf', session, session.documentKey) === id);
  const webSession = web.find((session) => documentId('web', session, session.pageKey) === id);
  if (pdfSession) {
    const {documentKey, targetLanguage, sourceLanguage, style, contentMode} = pdfSession;
    await clearRetainedPdfDocumentTranslationSession({documentKey, targetLanguage, sourceLanguage, style, contentMode});
  } else if (webSession) {
    const {pageKey, targetLanguage, sourceLanguage, style, contentMode} = webSession;
    await clearRetainedBilingualPageSession({pageKey, targetLanguage, sourceLanguage, style, contentMode});
  }
  await pruneRetainedDocumentNames();
}

export function pruneRetainedDocumentNames(): Promise<void> {
  const run = nameWriteTail.catch(() => undefined).then(async () => {
    await withDocumentStorageLock(async()=>{
    const ids=await retainedIdsInsideStorageLock();
    const stored = await browser.storage.local.get(RETAINED_DOCUMENT_NAMES_KEY);
    const names = validNames(stored[RETAINED_DOCUMENT_NAMES_KEY]);
    const retained = Object.fromEntries(ids.flatMap(id=>names[id]?[[id,names[id]]]:[]));
    if (Object.keys(retained).length) await browser.storage.local.set({[RETAINED_DOCUMENT_NAMES_KEY]: retained});
    else await browser.storage.local.remove(RETAINED_DOCUMENT_NAMES_KEY);
    });
  });
  nameWriteTail = run;
  return run;
}
