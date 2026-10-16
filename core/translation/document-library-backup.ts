import {PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,retainedPdfRecordsForBackup,sanitizeRetainedPdfRecord} from '../pdf/document-translation-session';
import {BILINGUAL_PAGE_RETAINED_STORAGE_KEY,retainedWebRecordsForBackup,sanitizeRetainedWebRecord} from './bilingual-page-session';
import {fixedDocumentKey,readFixedDocumentRecords,retainedDocumentId,retainDocumentSessions} from './fixed-document-storage';
import {RETAINED_DOCUMENT_NAMES_KEY} from './retained-document-library';
import {normalizePdfTranslationMarkerState,PDF_TRANSLATION_MARKERS_KEY,type PdfTranslationMarkerState} from '../pdf/translation-marker-repository';
import {withDocumentStorageLock} from './document-storage-lock';
import {LIBRARY_READING_STATE_KEYS,libraryReadingStates,libraryBookmarks,libraryDocumentTerms,mergeNewestStates,mergedDocumentMemories} from './document-library-state';
import {PDF_READING_STATES_KEY} from '../pdf/reading-state';
import {PDF_READING_BOOKMARKS_KEY} from '../pdf/reading-bookmark-repository';
import {DOCUMENT_MEMORY_STORAGE_KEY} from '../document/document-memory-repository';
import {withParagraphHistory,MAX_PDF_PARAGRAPH_REVISIONS} from '../pdf/paragraph-history';
import type {PdfDocumentTranslationSessionBlock} from '../pdf/document-translation-session';
import {WEB_EXCERPTS_KEY,validateWebExcerptMap,mergeWebExcerptMaps} from '../content/web-excerpt-repository';

const FORMAT='pi-translator-document-library';
function mergeImportedPdfBlock(chosen:PdfDocumentTranslationSessionBlock,other:PdfDocumentTranslationSessionBlock|undefined):PdfDocumentTranslationSessionBlock{
  if(!other)return chosen;
  const revisions=[...new Map([...(chosen.revisions??[]),...(other.revisions??[])].map(revision=>[revision.id,revision])).values()]
    .sort((a,b)=>b.createdAt-a.createdAt).slice(0,MAX_PDF_PARAGRAPH_REVISIONS);
  return withParagraphHistory(other,{...chosen,...(revisions.length?{revisions}:{})},'import');
}
function markerStates(value:unknown):Record<string,PdfTranslationMarkerState>{
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const entries=Object.entries(value);
  if(entries.length>30)throw new Error('标记备份超过 30 份文档，请先清理。');
  const result=Object.fromEntries(entries.flatMap(([id,raw])=>{
    if(!/^[a-f0-9]{32}$/u.test(id))throw new Error('标记文档标识无效。');
    const state=normalizePdfTranslationMarkerState(raw);if(!state)throw new Error('标记备份无效。');
    return [[id,state]];
  }));
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>4_000_000)throw new Error('标记备份超过本机容量。');
  return result;
}
export function exportDocumentLibraryBackup():Promise<string>{return withDocumentStorageLock(exportLocked)}
async function exportLocked():Promise<string>{
  const [pdf,web,fixedPdf,fixedWeb,stored]=await Promise.all([retainedPdfRecordsForBackup(),retainedWebRecordsForBackup(),readFixedDocumentRecords('pdf'),readFixedDocumentRecords('web'),browser.storage.local.get([RETAINED_DOCUMENT_NAMES_KEY,PDF_TRANSLATION_MARKERS_KEY,WEB_EXCERPTS_KEY,...LIBRARY_READING_STATE_KEYS])]);
  const names=(stored[RETAINED_DOCUMENT_NAMES_KEY]??{}) as Record<string,unknown>;
  const documents=[...pdf.map(record=>({kind:'pdf',record,fixed:Boolean(fixedPdf[fixedDocumentKey('pdf',record)]),name:names[retainedDocumentId('pdf',record)]})),...web.map(record=>({kind:'web',record,fixed:Boolean(fixedWeb[fixedDocumentKey('web',record)]),name:names[retainedDocumentId('web',record)]}))];
  return JSON.stringify({format:FORMAT,version:3,exportedAt:new Date().toISOString(),documents,markers:markerStates(stored[PDF_TRANSLATION_MARKERS_KEY]),webExcerpts:await validateWebExcerptMap(stored[WEB_EXCERPTS_KEY]),
    readingStates:libraryReadingStates(stored[PDF_READING_STATES_KEY]),bookmarks:libraryBookmarks(stored[PDF_READING_BOOKMARKS_KEY]),documentTerms:libraryDocumentTerms(stored[DOCUMENT_MEMORY_STORAGE_KEY])},null,2);
}
/** Validate the complete import before one storage write; never evict existing work. */
export function importDocumentLibraryBackup(text:string):Promise<number>{
  return withDocumentStorageLock(()=>importLocked(text));
}
async function importLocked(text:string):Promise<number>{
  if(new TextEncoder().encode(text).byteLength>20_000_000)throw new Error('备份文件超过 20 MB。');
  const data=JSON.parse(text) as Record<string,unknown>;
  if(!data||data.format!==FORMAT||![1,2,3].includes(Number(data.version))||!Array.isArray(data.documents)||data.documents.length>2000)throw new Error('不是有效的 Pi 文档库备份。');
  const [pdf,web,fixedPdf,fixedWeb,stored]=await Promise.all([retainedPdfRecordsForBackup(),retainedWebRecordsForBackup(),readFixedDocumentRecords('pdf'),readFixedDocumentRecords('web'),browser.storage.local.get([RETAINED_DOCUMENT_NAMES_KEY,PDF_TRANSLATION_MARKERS_KEY,WEB_EXCERPTS_KEY,...LIBRARY_READING_STATE_KEYS])]);
  const pdfMap=new Map(pdf.map(record=>[retainedDocumentId('pdf',record),record]));
  const webMap=new Map(web.map(record=>[retainedDocumentId('web',record),record]));
  const names={...((stored[RETAINED_DOCUMENT_NAMES_KEY]??{}) as Record<string,string>)};
  const writes:Record<string,unknown>={};const fixedKeys=new Set([...Object.keys(fixedPdf),...Object.keys(fixedWeb)]);const seen=new Set<string>();
  for(const item of data.documents){
    if(!item||typeof item!=='object'||!['pdf','web'].includes(item.kind)||typeof item.fixed!=='boolean')throw new Error('备份中的文档格式无效。');
    const record=item.kind==='pdf'?sanitizeRetainedPdfRecord(item.record):sanitizeRetainedWebRecord(item.record);
    if(!record)throw new Error('备份中的译文或公式结构无效，未导入任何记录。');
    const kind=item.kind as 'pdf'|'web';const id=retainedDocumentId(kind,record);if(seen.has(id))throw new Error('备份包含重复文档。');seen.add(id);
    const old=kind==='pdf'?pdfMap.get(id):webMap.get(id);
    let selected=old&&old.updatedAt>=record.updatedAt?old:record;
    if(kind==='pdf'&&old){
      const other=selected===old?record:old;
      const chosen=selected as typeof pdf[number],alternative=other as typeof pdf[number];
      if(chosen.sourceFingerprint&&chosen.sourceFingerprint===alternative.sourceFingerprint){
        const active=new Map(chosen.blocks.map(block=>[block.signature,block]));
        const archived=new Map((chosen.archivedBlocks??[]).map(block=>[block.signature,block]));
        const source=new Set(chosen.documentSignatures);
        for(const block of [...alternative.blocks,...(alternative.archivedBlocks??[])]){
          if(active.has(block.signature))active.set(block.signature,mergeImportedPdfBlock(active.get(block.signature)!,block));
          else if(!source.has(block.signature))archived.set(block.signature,mergeImportedPdfBlock(archived.get(block.signature)??block,block));
          else if(chosen.behaviorKey===alternative.behaviorKey)active.set(block.signature,block);
        }
        // A later automatic backup must not silently replace a local manual correction.
        for(const block of (old as typeof pdf[number]).blocks)if(block.manualCorrection&&active.has(block.signature))active.set(block.signature,mergeImportedPdfBlock(block,active.get(block.signature)!));
        selected={...chosen,blocks:[...active.values()],...(archived.size?{archivedBlocks:[...archived.values()]}:{})};
        if(!sanitizeRetainedPdfRecord(selected))throw new Error('合并后的校订历史或旧分段超过保存上限；现有记录未改变。');
      }
    }
    if(kind==='pdf')pdfMap.set(id,selected as typeof pdf[number]);else webMap.set(id,selected as typeof web[number]);
    const key=fixedDocumentKey(kind,selected);
    if(item.fixed||fixedKeys.has(key)){fixedKeys.add(key);writes[key]=selected;}
    if(!names[id]&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=120)names[id]=item.name.trim();
  }
  for(const [kind,records] of [['pdf',[...pdfMap.values()]],['web',[...webMap.values()]]] as const){
    const retained=retainDocumentSessions<typeof pdf[number]|typeof web[number]>(kind,records,fixedKeys,6,1_000_000);
    if(retained.length!==records.length)throw new Error('导入后将超过保存容量，请先备份并清理部分文档；现有记录未改变。');
    writes[kind==='pdf'?PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY:BILINGUAL_PAGE_RETAINED_STORAGE_KEY]=retained.filter(record=>!fixedKeys.has(fixedDocumentKey(kind,record)));
  }
  const markers=markerStates(stored[PDF_TRANSLATION_MARKERS_KEY]);
  for(const [id,state] of Object.entries(markerStates(data.markers)))if(!markers[id]||state.updatedAt>markers[id].updatedAt)markers[id]=state;
  writes[PDF_TRANSLATION_MARKERS_KEY]=markerStates(markers);writes[RETAINED_DOCUMENT_NAMES_KEY]=names;
  writes[WEB_EXCERPTS_KEY]=await validateWebExcerptMap(mergeWebExcerptMaps(stored[WEB_EXCERPTS_KEY],data.webExcerpts));
  writes[PDF_READING_STATES_KEY]=mergeNewestStates(libraryReadingStates(stored[PDF_READING_STATES_KEY]),libraryReadingStates(data.readingStates),30);
  writes[PDF_READING_BOOKMARKS_KEY]=mergeNewestStates(libraryBookmarks(stored[PDF_READING_BOOKMARKS_KEY]),libraryBookmarks(data.bookmarks),30);
  writes[DOCUMENT_MEMORY_STORAGE_KEY]=mergedDocumentMemories((stored[DOCUMENT_MEMORY_STORAGE_KEY]??{}) as Record<string,unknown>,libraryDocumentTerms(data.documentTerms));
  await browser.storage.local.set(writes);return seen.size;
}
