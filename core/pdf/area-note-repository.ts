import {normalizeExcerptCitation,type ExcerptCitation} from '../content/excerpt-citation';
import type {PersistedPdfTranslationMarkerAnchor} from '../content/session-translation-markers';
import {withDocumentStorageLock} from '../translation/document-storage-lock';
export const PDF_AREA_NOTES_KEY='piPdfAreaNotesV1';
export type PdfAreaAnchor=Extract<PersistedPdfTranslationMarkerAnchor,{kind:'region'}>;
export interface PdfAreaNote extends ExcerptCitation {id:string;anchor:PdfAreaAnchor;createdAt:number;updatedAt:number}
export type PdfAreaNotes=Record<string,{notes:PdfAreaNote[];updatedAt:number}>;
export function normalizePdfAreaNotes(value:unknown):PdfAreaNotes{
  if(value===undefined)return {};
  const invalid=()=>new Error('PDF 区域笔记无效或超过容量，原笔记未改变。');
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>30)throw invalid();
  const result:PdfAreaNotes={};
  for(const [id,raw] of Object.entries(value)){
    const state=raw as PdfAreaNotes[string];if(!/^[a-f0-9]{32}$/u.test(id)||!state||!Array.isArray(state.notes)||state.notes.length>100||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<0)throw invalid();
    const notes=state.notes.map(note=>{
      const a=note?.anchor;if(!note||typeof note.id!=='string'||!note.id||note.id.length>80||!Number.isSafeInteger(note.createdAt)||!Number.isSafeInteger(note.updatedAt)||note.createdAt<0||note.updatedAt<note.createdAt||!a||a.kind!=='region'||!Number.isSafeInteger(a.pageNumber)||a.pageNumber<1||![a.leftRatio,a.topRatio,a.widthRatio,a.heightRatio].every(Number.isFinite)||a.leftRatio<0||a.topRatio<0||a.widthRatio<=0||a.heightRatio<=0||a.leftRatio+a.widthRatio>1.000001||a.topRatio+a.heightRatio>1.000001)throw invalid();
      return {id:note.id,anchor:{kind:'region' as const,pageNumber:a.pageNumber,leftRatio:a.leftRatio,topRatio:a.topRatio,widthRatio:a.widthRatio,heightRatio:a.heightRatio},...normalizeExcerptCitation(note),createdAt:note.createdAt,updatedAt:note.updatedAt};
    });if(new Set(notes.map(note=>note.id)).size!==notes.length)throw invalid();result[id]={notes,updatedAt:state.updatedAt};
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length>4_000_000)throw invalid();return result;
}
export function mergePdfAreaNotes(local:unknown,incoming:unknown):PdfAreaNotes{
  const a=normalizePdfAreaNotes(local),b=normalizePdfAreaNotes(incoming);
  for(const [id,state] of Object.entries(b)){
    const previous=a[id],notes=new Map(previous?.notes.map(note=>[note.id,note]));
    for(const note of state.notes){const old=notes.get(note.id);if(old&&JSON.stringify(old.anchor)!==JSON.stringify(note.anchor))throw new Error('区域笔记来源冲突，未导入任何记录。');if(old&&JSON.stringify(old)!==JSON.stringify(note))throw new Error('备份与本机的同一区域笔记存在冲突，请先分别导出核对。原记录未改变。');notes.set(note.id,note)}
    a[id]={notes:[...notes.values()],updatedAt:Math.max(state.updatedAt,previous?.updatedAt??0)};
  }
  return normalizePdfAreaNotes(a);
}
export async function listPdfAreaNotes():Promise<PdfAreaNotes>{return normalizePdfAreaNotes((await browser.storage.local.get(PDF_AREA_NOTES_KEY))[PDF_AREA_NOTES_KEY])}
export function mutatePdfAreaNote(documentId:string,next:PdfAreaNote|undefined,expected?:PdfAreaNote):Promise<void>{return withDocumentStorageLock(async()=>{
  const all=await listPdfAreaNotes(),state=all[documentId]??{notes:[],updatedAt:0},id=next?.id??expected?.id,old=state.notes.find(note=>note.id===id);
  if(!id||JSON.stringify(old)!==JSON.stringify(expected))throw new Error('区域笔记已在其他窗口变化，草稿仍保留。');
  const notes=state.notes.filter(note=>note.id!==id);if(next)notes.push(next);
  all[documentId]={notes,updatedAt:Math.max(Date.now(),state.updatedAt+1)};await browser.storage.local.set({[PDF_AREA_NOTES_KEY]:normalizePdfAreaNotes(all)});
})}
