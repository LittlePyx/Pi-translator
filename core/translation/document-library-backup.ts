import {RECOVERY_JOURNAL_KEY,recoveryJournal,type RecoveryJournal} from './recovery-journal';
import {LIBRARY_ORGANIZATION_KEY,normalizeLibraryOrganization,mergeLibraryOrganization} from './library-organization';
import {LIBRARY_PROJECTS_KEY,normalizeLibraryProjects,mergeLibraryProjects} from './library-projects';
import {PDF_AREA_NOTES_KEY,normalizePdfAreaNotes,mergePdfAreaNotes} from '../pdf/area-note-repository';
import {PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,PDF_REPAIR_ARCHIVE_KEY,normalizePdfRepairArchives,mergePdfRepairArchives,retainedPdfRecordsForBackup,sanitizeRetainedPdfRecord} from '../pdf/document-translation-session';
import {BILINGUAL_PAGE_RETAINED_STORAGE_KEY,retainedWebRecordsForBackup,sanitizeRetainedWebRecord} from './bilingual-page-session';
import {fixedDocumentKey,readFixedDocumentRecords,retainedDocumentId,retainDocumentSessions} from './fixed-document-storage';
import {RETAINED_DOCUMENT_NAMES_KEY} from './retained-document-library';
import {normalizePdfTranslationMarkerState,PDF_TRANSLATION_MARKERS_KEY,type PdfTranslationMarkerState} from '../pdf/translation-marker-repository';
import {withDocumentStorageLock} from './document-storage-lock';
import {LIBRARY_READING_STATE_KEYS,libraryReadingStates,libraryBookmarks,libraryDocumentTerms,mergeNewestStates,mergedDocumentMemories} from './document-library-state';
import {PDF_READING_STATES_KEY} from '../pdf/reading-state';
import {PDF_READING_BOOKMARKS_KEY} from '../pdf/reading-bookmark-repository';
import {DOCUMENT_MEMORY_STORAGE_KEY} from '../document/document-memory-repository';
import {withParagraphHistory,MAX_PDF_PARAGRAPH_REVISIONS,LEGACY_PDF_PARAGRAPH_REVISIONS,paragraphValue} from '../pdf/paragraph-history';
import type {PdfDocumentTranslationSessionBlock} from '../pdf/document-translation-session';
import {WEB_EXCERPTS_KEY,validateWebExcerptMap,mergeWebExcerptMaps} from '../content/web-excerpt-repository';
import {PDF_READING_ANNOTATIONS_KEY,validatePdfReadingAnnotationMap,mergePdfReadingAnnotationMaps} from '../pdf/reading-annotation-repository';
import {RECENT_PDF_DOCUMENTS_KEY,recentPdfDocuments} from '../pdf/recent-documents';
import {RECENT_PDF_OVERRIDES_KEY,MAX_RECENT_PDF_OVERRIDES,recentPdfOverrides} from '../pdf/recent-reading-overrides';
import {importOriginalPdfs,type OriginalPdfImportEntry} from '../pdf/original-file-repository';

const FORMAT='pi-translator-document-library';
function hasBibliographicMetadata(web:unknown,markers:unknown,annotations:unknown):boolean{
  const values=(value:unknown):unknown[]=>value&&typeof value==='object'?Object.values(value):[];
  const citations=[...values(web).flatMap(v=>Array.isArray(v)?v.map(item=>item?.content):[]),...values(markers).flatMap(v=>values((v as {markers?:unknown})?.markers).map(item=>(item as {content?:unknown})?.content)),...values(annotations).flatMap(v=>values((v as {annotations?:unknown})?.annotations))];
  return citations.some(value=>Boolean(value&&typeof value==='object'&&('authors' in value||'year' in value)));
}

export interface DocumentLibraryImportPreview {
  token:string;
  addedDocuments:number;
  mergedDocuments:number;
  unchangedDocuments:number;
  manualCorrectionsKept:number;
  readingStates:number;
  bookmarkDocuments:number;
  termDocuments:number;
  markerDocuments:number;
  excerptPages:number;
  annotationCount:number;
  recentDocuments:number;
  recentListSettings:number;
  organizationItems?:number;
  areaNotes?:number;
  repairArchives?:number;
}
function mergeImportedPdfBlock(chosen:PdfDocumentTranslationSessionBlock,other:PdfDocumentTranslationSessionBlock|undefined):PdfDocumentTranslationSessionBlock{
  if(!other)return chosen;
  const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
  const byId=new Map<string,NonNullable<PdfDocumentTranslationSessionBlock['revisions']>[number]>();
  for(const revision of [...(chosen.revisions??[]),...(other.revisions??[])]){
    const prior=byId.get(revision.id);
    if(prior&&JSON.stringify(ordered(prior))!==JSON.stringify(ordered(revision)))throw new Error('备份与本机修订历史存在冲突，未导入任何记录。请保留两份备份。');
    byId.set(revision.id,revision);
  }
  const revisions=[...byId.values()].sort((a,b)=>b.createdAt-a.createdAt);
  if(revisions.length>MAX_PDF_PARAGRAPH_REVISIONS)throw new Error('合并后的修订历史超过保存上限，未导入任何记录。请保留两份备份。');
  const merged=withParagraphHistory(other,{...chosen,...(revisions.length?{revisions}:{})},'import');
  if(revisions.some(revision=>!merged.revisions?.some(item=>item.id===revision.id)))throw new Error('合并后的修订历史超过保存上限，未导入任何记录。请保留两份备份。');
  return merged;
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
  const [pdf,web,fixedPdf,fixedWeb,stored]=await Promise.all([retainedPdfRecordsForBackup(),retainedWebRecordsForBackup(),readFixedDocumentRecords('pdf'),readFixedDocumentRecords('web'),browser.storage.local.get([RETAINED_DOCUMENT_NAMES_KEY,PDF_TRANSLATION_MARKERS_KEY,WEB_EXCERPTS_KEY,PDF_READING_ANNOTATIONS_KEY,LIBRARY_PROJECTS_KEY,PDF_REPAIR_ARCHIVE_KEY,...LIBRARY_READING_STATE_KEYS])]);
  const names=(stored[RETAINED_DOCUMENT_NAMES_KEY]??{}) as Record<string,unknown>;
  const documents=[...pdf.map(record=>({kind:'pdf',record,fixed:Boolean(fixedPdf[fixedDocumentKey('pdf',record)]),name:names[retainedDocumentId('pdf',record)]})),...web.map(record=>({kind:'web',record,fixed:Boolean(fixedWeb[fixedDocumentKey('web',record)]),name:names[retainedDocumentId('web',record)]}))];
  const readingAnnotations=validatePdfReadingAnnotationMap(stored[PDF_READING_ANNOTATIONS_KEY]);
  const recentDocuments=recentPdfDocuments(stored[RECENT_PDF_DOCUMENTS_KEY]);
  const recentReadingOverrides=recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]);
  const libraryOrganization=normalizeLibraryOrganization(stored[LIBRARY_ORGANIZATION_KEY]),areaNotes=normalizePdfAreaNotes(stored[PDF_AREA_NOTES_KEY]);
  const hasOrganization=Boolean(Object.keys(libraryOrganization.tags).length+Object.keys(libraryOrganization.views).length),hasAreas=Object.keys(areaNotes).length>0;
  const hasMetadata=hasBibliographicMetadata(stored[WEB_EXCERPTS_KEY],stored[PDF_TRANSLATION_MARKERS_KEY],readingAnnotations);
  const projects=normalizeLibraryProjects(stored[LIBRARY_PROJECTS_KEY]),hasProjects=Boolean(Object.keys(projects.projects).length||Object.keys(projects.members).length);
  const extendedHistory=pdf.some(record=>[...record.blocks,...(record.archivedBlocks??[])].some(block=>(block.revisions?.length??0)>LEGACY_PDF_PARAGRAPH_REVISIONS));
  const repairArchives=normalizePdfRepairArchives(stored[PDF_REPAIR_ARCHIVE_KEY]);
  const version=extendedHistory||repairArchives.length?10:hasProjects||Object.values(libraryOrganization.views).some(view=>view.project)?9:hasOrganization||hasAreas||hasMetadata?8:Object.keys(recentReadingOverrides).length?7:Object.keys(recentDocuments).length?6:Object.values(readingAnnotations).some(state=>state.annotations.some(item=>item.continuations))?5:4;
  return JSON.stringify({format:FORMAT,version,exportedAt:new Date().toISOString(),documents,readingAnnotations,...(repairArchives.length?{pdfRepairArchives:repairArchives}:{}),...(hasProjects?{libraryProjects:projects}:{}),...(hasOrganization?{libraryOrganization}:{}),...(hasAreas?{areaNotes}:{}),...(Object.keys(recentDocuments).length?{recentDocuments}:{}),...(Object.keys(recentReadingOverrides).length?{recentReadingOverrides}:{}),markers:markerStates(stored[PDF_TRANSLATION_MARKERS_KEY]),webExcerpts:await validateWebExcerptMap(stored[WEB_EXCERPTS_KEY]),
    readingStates:libraryReadingStates(stored[PDF_READING_STATES_KEY]),bookmarks:libraryBookmarks(stored[PDF_READING_BOOKMARKS_KEY]),documentTerms:libraryDocumentTerms(stored[DOCUMENT_MEMORY_STORAGE_KEY])},null,2);
}
/** Validate the complete import before one storage write; never evict existing work. */
export function previewDocumentLibraryBackup(text:string):Promise<DocumentLibraryImportPreview>{
  return withDocumentStorageLock(async()=> (await prepareImport(text)).preview);
}
export function importDocumentLibraryBackup(text:string,expectedToken?:string,originals?:{entries:OriginalPdfImportEntry[];token:string},recoveryFingerprint?:string):Promise<number>{
  return withDocumentStorageLock(async()=>{
    const {writes,preview,count}=await prepareImport(text);
    if(expectedToken!==undefined&&expectedToken!==preview.token)throw new Error('文档库已变化，请重新预览后导入。');
    let journal:RecoveryJournal|undefined;
    if(recoveryFingerprint){
      const previous=recoveryJournal((await browser.storage.local.get(RECOVERY_JOURNAL_KEY))[RECOVERY_JOURNAL_KEY]);
      const pending=previous?.pending??[];
      journal={version:1,pending:pending.includes(recoveryFingerprint)?pending:[...pending,recoveryFingerprint]};
      await browser.storage.local.set({[RECOVERY_JOURNAL_KEY]:journal});
    }
    const remaining=journal?.pending.filter(id=>id!==recoveryFingerprint);
    const committed=journal?{...writes,[RECOVERY_JOURNAL_KEY]:{version:1,pending:remaining}}:writes;
    if(originals)await importOriginalPdfs(originals.entries,originals.token,()=>browser.storage.local.set(committed));
    else await browser.storage.local.set(committed);
    if(journal&&!remaining?.length)await browser.storage.local.remove(RECOVERY_JOURNAL_KEY).catch(()=>undefined);
    return count;
  });
}
async function prepareImport(text:string){
  if(new TextEncoder().encode(text).byteLength>20_000_000)throw new Error('备份文件超过 20 MB。');
  const data=JSON.parse(text) as Record<string,unknown>;
  if(!data||data.format!==FORMAT||![1,2,3,4,5,6,7,8,9,10].includes(Number(data.version))||!Array.isArray(data.documents)||data.documents.length>2000)throw new Error('不是有效的 Pi 文档库备份。');
  const [pdf,web,fixedPdf,fixedWeb,stored]=await Promise.all([retainedPdfRecordsForBackup(),retainedWebRecordsForBackup(),readFixedDocumentRecords('pdf'),readFixedDocumentRecords('web'),browser.storage.local.get([RETAINED_DOCUMENT_NAMES_KEY,PDF_TRANSLATION_MARKERS_KEY,WEB_EXCERPTS_KEY,PDF_READING_ANNOTATIONS_KEY,LIBRARY_PROJECTS_KEY,PDF_REPAIR_ARCHIVE_KEY,...LIBRARY_READING_STATE_KEYS])]);
  const token=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([pdf,web,fixedPdf,fixedWeb,stored,text])))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const preview:DocumentLibraryImportPreview={token,addedDocuments:0,mergedDocuments:0,unchangedDocuments:0,manualCorrectionsKept:0,readingStates:0,bookmarkDocuments:0,termDocuments:0,markerDocuments:0,excerptPages:0,annotationCount:0,recentDocuments:0,recentListSettings:0};
  const incomingOrganization=normalizeLibraryOrganization(data.libraryOrganization),incomingAreas=normalizePdfAreaNotes(data.areaNotes);
  if(Number(data.version)<9&&data.libraryProjects!==undefined)throw new Error('项目资料需要版本 9 备份，原记录未改变。');
  if(Number(data.version)<9&&Object.values(incomingOrganization.views).some(view=>view.project))throw new Error('项目资料需要版本 9 备份，原记录未改变。');
  const incomingProjects=normalizeLibraryProjects(data.libraryProjects);
  if(Number(data.version)<10&&data.pdfRepairArchives!==undefined)throw new Error('修复版本存档需要版本 10 备份，原记录未改变。');
  const incomingRepairArchives=normalizePdfRepairArchives(data.pdfRepairArchives);
  if(incomingRepairArchives.length)preview.repairArchives=incomingRepairArchives.length;
  if(Number(data.version)<8&&hasBibliographicMetadata(data.webExcerpts,data.markers,data.readingAnnotations))throw new Error('完整来源元数据需要版本 8 备份，原记录未改变。');
  if(Number(data.version)<8&&(data.libraryOrganization!==undefined||data.areaNotes!==undefined))throw new Error('标签、保存筛选和区域笔记需要版本 8 备份，原记录未改变。');
  const pdfMap=new Map(pdf.map(record=>[retainedDocumentId('pdf',record),record]));
  const webMap=new Map(web.map(record=>[retainedDocumentId('web',record),record]));
  const names={...((stored[RETAINED_DOCUMENT_NAMES_KEY]??{}) as Record<string,string>)};
  const writes:Record<string,unknown>={};const fixedKeys=new Set([...Object.keys(fixedPdf),...Object.keys(fixedWeb)]);const seen=new Set<string>();
  for(const item of data.documents){
    if(!item||typeof item!=='object'||!['pdf','web'].includes(item.kind)||typeof item.fixed!=='boolean')throw new Error('备份中的文档格式无效。');
    const record=item.kind==='pdf'?sanitizeRetainedPdfRecord(item.record):sanitizeRetainedWebRecord(item.record);
    if(!record)throw new Error('备份中的译文或公式结构无效，未导入任何记录。');
    if(item.kind==='pdf'&&Number(data.version)<10&&[...record.blocks,...((record as Awaited<ReturnType<typeof retainedPdfRecordsForBackup>>[number]).archivedBlocks??[])].some(block=>(('revisions' in block&&Array.isArray(block.revisions))?block.revisions.length:0)>LEGACY_PDF_PARAGRAPH_REVISIONS))throw new Error('较长的修订历史需要版本 10 备份，原记录未改变。');
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
      const local=old as typeof pdf[number],merged=selected as typeof pdf[number],incoming=record as typeof pdf[number];
      const after=new Map([...merged.blocks,...(merged.archivedBlocks??[])].map(block=>[block.signature,block]));
      const imported=new Map([...incoming.blocks,...(incoming.archivedBlocks??[])].map(block=>[block.signature,block]));
      for(const block of [...local.blocks,...(local.archivedBlocks??[])]){
        if(!block.manualCorrection)continue;
        const kept=after.get(block.signature),other=imported.get(block.signature),value=JSON.stringify(paragraphValue(block));
        if(!kept||JSON.stringify(paragraphValue(kept))!==value)throw new Error('备份与本机人工修正无法安全合并，未导入任何记录。请保留两份备份并检查原文件。');
        if(other&&JSON.stringify(paragraphValue(other))!==value)preview.manualCorrectionsKept++;
      }
    }
    if(kind==='pdf')pdfMap.set(id,selected as typeof pdf[number]);else webMap.set(id,selected as typeof web[number]);
    const key=fixedDocumentKey(kind,selected);
    if(!old)preview.addedDocuments++;
    else if(JSON.stringify(selected)!==JSON.stringify(old)||(item.fixed&&!fixedKeys.has(key))||(!names[id]&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=120))preview.mergedDocuments++;
    else preview.unchangedDocuments++;
    if(item.fixed||fixedKeys.has(key)){fixedKeys.add(key);writes[key]=selected;}
    if(!names[id]&&typeof item.name==='string'&&item.name.trim()&&item.name.length<=120)names[id]=item.name.trim();
  }
  for(const [kind,records] of [['pdf',[...pdfMap.values()]],['web',[...webMap.values()]]] as const){
    const retained=retainDocumentSessions<typeof pdf[number]|typeof web[number]>(kind,records,fixedKeys,6,1_000_000);
    if(retained.length!==records.length)throw new Error('导入后将超过保存容量，请先备份并清理部分文档；现有记录未改变。');
    writes[kind==='pdf'?PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY:BILINGUAL_PAGE_RETAINED_STORAGE_KEY]=retained.filter(record=>!fixedKeys.has(fixedDocumentKey(kind,record)));
  }
  const markers=markerStates(stored[PDF_TRANSLATION_MARKERS_KEY]);
  const incomingMarkers=markerStates(data.markers);preview.markerDocuments=Object.keys(incomingMarkers).length;
  for(const [id,state] of Object.entries(incomingMarkers))if(!markers[id]||state.updatedAt>markers[id].updatedAt)markers[id]=state;
  writes[PDF_TRANSLATION_MARKERS_KEY]=markerStates(markers);writes[RETAINED_DOCUMENT_NAMES_KEY]=names;
  writes[WEB_EXCERPTS_KEY]=await validateWebExcerptMap(mergeWebExcerptMaps(stored[WEB_EXCERPTS_KEY],data.webExcerpts));
  preview.excerptPages=Object.keys(await validateWebExcerptMap(data.webExcerpts)).length;
  const incomingAnnotations=validatePdfReadingAnnotationMap(data.readingAnnotations);
  const incomingRecent=recentPdfDocuments(data.recentDocuments);
  if(Number(data.version)<6&&Object.keys(incomingRecent).length)throw new Error('最近阅读需要版本 6 备份，原记录未改变。');
  preview.recentDocuments=Object.keys(incomingRecent).length;
  writes[RECENT_PDF_DOCUMENTS_KEY]=mergeNewestStates(recentPdfDocuments(stored[RECENT_PDF_DOCUMENTS_KEY]),incomingRecent,30);
  const incomingOverrides=recentPdfOverrides(data.recentReadingOverrides);
  preview.recentListSettings=Object.keys(incomingOverrides).length;
  if(Number(data.version)<7&&Object.keys(incomingOverrides).length)throw new Error('最近阅读的名称与移除状态需要版本 7 备份，原记录未改变。');
  writes[RECENT_PDF_OVERRIDES_KEY]=recentPdfOverrides(mergeNewestStates(recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]),incomingOverrides,MAX_RECENT_PDF_OVERRIDES));
  if(Number(data.version)<5&&Object.values(incomingAnnotations).some(state=>state.annotations.some(item=>item.continuations)))throw new Error('跨页批注需要版本 5 备份，原记录未改变。');
  preview.annotationCount=Object.values(incomingAnnotations).reduce((count,state)=>count+state.annotations.length,0);
  writes[PDF_READING_ANNOTATIONS_KEY]=mergePdfReadingAnnotationMaps(stored[PDF_READING_ANNOTATIONS_KEY],incomingAnnotations);
  preview.readingStates=Object.keys(libraryReadingStates(data.readingStates)).length;
  preview.bookmarkDocuments=Object.keys(libraryBookmarks(data.bookmarks)).length;
  preview.termDocuments=Object.keys(libraryDocumentTerms(data.documentTerms)).length;
  writes[PDF_READING_STATES_KEY]=mergeNewestStates(libraryReadingStates(stored[PDF_READING_STATES_KEY]),libraryReadingStates(data.readingStates),30);
  writes[PDF_READING_BOOKMARKS_KEY]=mergeNewestStates(libraryBookmarks(stored[PDF_READING_BOOKMARKS_KEY]),libraryBookmarks(data.bookmarks),30);
  writes[DOCUMENT_MEMORY_STORAGE_KEY]=mergedDocumentMemories((stored[DOCUMENT_MEMORY_STORAGE_KEY]??{}) as Record<string,unknown>,libraryDocumentTerms(data.documentTerms));
  if(data.libraryOrganization!==undefined||stored[LIBRARY_ORGANIZATION_KEY]!==undefined)writes[LIBRARY_ORGANIZATION_KEY]=mergeLibraryOrganization(stored[LIBRARY_ORGANIZATION_KEY],incomingOrganization);
  if(data.libraryProjects!==undefined||stored[LIBRARY_PROJECTS_KEY]!==undefined)writes[LIBRARY_PROJECTS_KEY]=mergeLibraryProjects(stored[LIBRARY_PROJECTS_KEY],incomingProjects);
  if(data.pdfRepairArchives!==undefined||stored[PDF_REPAIR_ARCHIVE_KEY]!==undefined)writes[PDF_REPAIR_ARCHIVE_KEY]=mergePdfRepairArchives(stored[PDF_REPAIR_ARCHIVE_KEY],incomingRepairArchives);
  if(data.areaNotes!==undefined||stored[PDF_AREA_NOTES_KEY]!==undefined)writes[PDF_AREA_NOTES_KEY]=mergePdfAreaNotes(stored[PDF_AREA_NOTES_KEY],incomingAreas);
  const organizationCount=Object.keys(incomingOrganization.tags).length+Object.keys(incomingOrganization.views).length;if(organizationCount)preview.organizationItems=organizationCount;
  const areaCount=Object.values(incomingAreas).reduce((sum,state)=>sum+state.notes.length,0);if(areaCount)preview.areaNotes=areaCount;
  return {writes,preview,count:seen.size};
}
