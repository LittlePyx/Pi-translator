import {RECENT_PDF_DOCUMENTS_KEY,recentPdfDocuments} from '../pdf/recent-documents';
import {PDF_READING_STATES_KEY,normalizePdfReadingState,type PdfReadingState} from '../pdf/reading-state';
import {PDF_READING_ANNOTATIONS_KEY,validatePdfReadingAnnotationMap} from '../pdf/reading-annotation-repository';
import type {RetainedLibraryEntry} from './retained-document-library';
import {RECENT_PDF_OVERRIDES_KEY,recentPdfOverrides,type RecentPdfOverride} from '../pdf/recent-reading-overrides';
import {withDocumentStorageLock} from './document-storage-lock';
import {listOriginalPdfs} from '../pdf/original-file-repository';

export interface RecentPdfReading {id:string;name:string;updatedAt:number;pageCount?:number;state?:PdfReadingState;noteCount:number;fallbackPage:number;hidden?:true;hasLocalCopy?:true;originalCopyUnavailable?:true}
/** Existing note documents are included without inventing titles for anonymous legacy positions. */
export async function listRecentPdfReadings(entries:RetainedLibraryEntry[]=[],onOriginalCopyError?:()=>void):Promise<RecentPdfReading[]>{
  const stored=await browser.storage.local.get([RECENT_PDF_DOCUMENTS_KEY,PDF_READING_STATES_KEY,PDF_READING_ANNOTATIONS_KEY,RECENT_PDF_OVERRIDES_KEY]);
  const overrides=recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]);
  const metadata=recentPdfDocuments(stored[RECENT_PDF_DOCUMENTS_KEY]),notes=validatePdfReadingAnnotationMap(stored[PDF_READING_ANNOTATIONS_KEY]);
  const states=stored[PDF_READING_STATES_KEY] as Record<string,unknown>|undefined;
  let originalCopyUnavailable=false;
  const copies=new Map((await listOriginalPdfs().catch(()=>{originalCopyUnavailable=true;onOriginalCopyError?.();return []})).map(item=>[item.id,item]));
  const known=new Map(entries.flatMap(entry=>entry.readingId?[[entry.readingId,entry] as const]:[]));
  return [...new Set([...Object.keys(metadata),...Object.keys(notes),...copies.keys(),...Array.from(known.keys()).filter(id=>normalizePdfReadingState(states?.[id]))])].map(id=>{
    const document=metadata[id],annotations=notes[id]?.annotations??[],state=normalizePdfReadingState(states?.[id]);
    const first=[...annotations].sort((a,b)=>a.anchor.pageNumber-b.anchor.pageNumber)[0];
    return {id,name:overrides[id]?.name??document?.title??first?.sourceTitle??known.get(id)?.name??copies.get(id)?.name??'PDF',updatedAt:Math.max(document?.updatedAt??0,notes[id]?.updatedAt??0,state?.updatedAt??0,copies.get(id)?.savedAt??0),
      ...(copies.has(id)?{hasLocalCopy:true as const}:{}),
      ...(originalCopyUnavailable?{originalCopyUnavailable:true as const}:{}),
      ...(overrides[id]?.hidden?{hidden:true as const}:{}),
      ...(document?.pageCount!==undefined?{pageCount:document.pageCount}:{}),...(state?{state}:{}),noteCount:annotations.length,fallbackPage:first?.anchor.pageNumber??1};
  }).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
}
export type LibraryReadingRow={kind:'translation';entry:RetainedLibraryEntry;recent?:RecentPdfReading}|{kind:'recent';recent:RecentPdfReading};
export function libraryReadingRows(entries:RetainedLibraryEntry[],recent:RecentPdfReading[],allEntries=entries):LibraryReadingRow[]{
  const ids=new Set(allEntries.flatMap(entry=>entry.readingId?[entry.readingId]:[])),byId=new Map(recent.map(item=>[item.id,item]));
  const rows:LibraryReadingRow[]=[...entries.map(entry=>({kind:'translation' as const,entry,...(entry.readingId&&byId.has(entry.readingId)?{recent:byId.get(entry.readingId)!}:{})})),...recent.filter(item=>!item.hidden&&!ids.has(item.id)).map(item=>({kind:'recent' as const,recent:item}))];
  const pinned=(row:LibraryReadingRow)=>row.kind==='translation'&&row.entry.pinned;
  const updated=(row:LibraryReadingRow)=>Math.max(row.recent?.updatedAt??0,row.kind==='translation'?Math.max(row.entry.updatedAt,row.entry.reading?.updatedAt??0):0);
  return rows.sort((a,b)=>Number(pinned(b))-Number(pinned(a))||updated(b)-updated(a));
}
async function updateRecentPdfOverride(id:string,change:{name:string}|{hidden:true}):Promise<{before?:RecentPdfOverride;after:RecentPdfOverride}>{
  if(!/^[a-f0-9]{32}$/u.test(id))throw new Error('最近阅读记录无效，原有资料未改变。');
  return withDocumentStorageLock(async()=>{
    const stored=await browser.storage.local.get([RECENT_PDF_DOCUMENTS_KEY,PDF_READING_ANNOTATIONS_KEY,RECENT_PDF_OVERRIDES_KEY]);
    if(!recentPdfDocuments(stored[RECENT_PDF_DOCUMENTS_KEY])[id]&&!validatePdfReadingAnnotationMap(stored[PDF_READING_ANNOTATIONS_KEY])[id]){
      const copies=await listOriginalPdfs().catch(()=>{throw new Error('原 PDF 副本暂时无法读取，请在文档库管理中刷新。')});
      if(!copies.some(item=>item.id===id))throw new Error('这条阅读记录已移除，原有译文与笔记未改变。');
    }
    const overrides=recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]),old=overrides[id];
    const next:RecentPdfOverride={hidden:false,...old,...change,updatedAt:Math.max(Date.now(),(old?.updatedAt??0)+1)};
    await browser.storage.local.set({[RECENT_PDF_OVERRIDES_KEY]:recentPdfOverrides({...overrides,[id]:next})});
    return {...(old?{before:old}:{}),after:next};
  });
}
export function renameRecentPdfReading(id:string,name:string):Promise<void>{
  const trimmed=name.trim();
  if(!trimmed||trimmed.length>120)return Promise.reject(new Error('名称需为 1–120 个字符。'));
  return updateRecentPdfOverride(id,{name:trimmed}).then(()=>undefined);
}
export function removeRecentPdfReading(id:string):Promise<void>{return updateRecentPdfOverride(id,{hidden:true}).then(()=>undefined)}
export async function removeRecentPdfReadingWithUndo(id:string):Promise<()=>Promise<void>>{
  const receipt=await updateRecentPdfOverride(id,{hidden:true});
  return ()=>withDocumentStorageLock(async()=>{
    const stored=await browser.storage.local.get(RECENT_PDF_OVERRIDES_KEY),map=recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]);
    if(JSON.stringify(map[id])!==JSON.stringify(receipt.after))throw new Error('列表已在其他窗口修改，不能覆盖较新的选择。');
    // Undo is the latest list choice; keep its timestamp ahead of a backup made during removal.
    map[id]={hidden:false,...receipt.before,updatedAt:Math.max(Date.now(),receipt.after.updatedAt+1)};
    await browser.storage.local.set({[RECENT_PDF_OVERRIDES_KEY]:recentPdfOverrides(map)});
  });
}
