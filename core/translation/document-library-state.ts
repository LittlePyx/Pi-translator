import {PDF_READING_STATES_KEY,normalizePdfReadingState,type PdfReadingState} from '../pdf/reading-state';
import {PDF_READING_BOOKMARKS_KEY,normalizePdfReadingBookmarkState,type PdfReadingBookmarkState} from '../pdf/reading-bookmark-repository';
import {DOCUMENT_MEMORY_STORAGE_KEY,type DocumentConfirmedTerm} from '../document/document-memory-repository';
import {validTermProvenance} from '../document/term-provenance';

export const LIBRARY_READING_STATE_KEYS=[PDF_READING_STATES_KEY,PDF_READING_BOOKMARKS_KEY,DOCUMENT_MEMORY_STORAGE_KEY];
interface Terms {documentId:string;updatedAt:number;confirmedTerms:DocumentConfirmedTerm[]}
function mapStates<T>(value:unknown,maximum:number,normalize:(v:unknown)=>T|undefined):Record<string,T>{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('备份中的阅读状态格式无效。');
  const entries=Object.entries(value);if(entries.length>maximum)throw new Error('备份中的阅读记录超过容量。');
  const result:Record<string,T>={};
  for(const [id,raw] of entries){if(!/^[a-f0-9]{32}$/u.test(id))throw new Error('阅读记录标识无效。');const state=normalize(raw);if(!state)throw new Error('备份中的阅读状态无效。');result[id]=state}
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>2_000_000)throw new Error('阅读状态超过本机保存容量。');
  return result;
}
export function libraryReadingStates(value:unknown){return mapStates<PdfReadingState>(value,30,normalizePdfReadingState)}
export function libraryBookmarks(value:unknown){return mapStates<PdfReadingBookmarkState>(value,30,normalizePdfReadingBookmarkState)}
export function libraryDocumentTerms(value:unknown):Record<string,Terms>{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>40)throw new Error('本文术语备份无效或超过容量。');
  const result:Record<string,Terms>={};
  for(const [id,raw] of Object.entries(value)){
    const state=raw as Partial<Terms>;
    if(!/^doc-[a-z0-9]{1,8}$/u.test(id)||!state||state.documentId!==id||!Number.isFinite(state.updatedAt)||!Array.isArray(state.confirmedTerms)||state.confirmedTerms.length>100)throw new Error('本文术语备份格式无效。');
    const confirmedTerms=state.confirmedTerms.map(term=>{
      if(!term||typeof term.id!=='string'||term.id.length>120||typeof term.source!=='string'||!term.source.trim()||term.source.length>120||typeof term.target!=='string'||!term.target.trim()||term.target.length>120||!Number.isFinite(term.updatedAt)||!Number.isFinite(term.createdAt))throw new Error('本文术语内容无效。');
      if(term.provenance!==undefined&&(!validTermProvenance(term.provenance)||term.provenance.confirmed.documentId!==id))throw new Error('术语来源记录无效。');
      return {id:term.id,source:term.source,target:term.target,createdAt:term.createdAt,updatedAt:term.updatedAt,...(term.provenance?{provenance:term.provenance}:{})};
    });
    if(confirmedTerms.length)result[id]={documentId:id,updatedAt:state.updatedAt!,confirmedTerms};
  }
  return result;
}
export function mergeNewestStates<T extends {updatedAt:number}>(current:Record<string,T>,incoming:Record<string,T>,maximum:number):Record<string,T>{
  const merged={...current};for(const [id,next] of Object.entries(incoming))if(!merged[id]||next.updatedAt>merged[id].updatedAt)merged[id]=next;
  if(Object.keys(merged).length>maximum)throw new Error('导入后阅读记录超过容量，现有记录未改变。请先清理或分开导入。');
  return merged;
}
export function mergedDocumentMemories(current:Record<string,unknown>,incoming:Record<string,Terms>):Record<string,unknown>{
  const merged={...current};
  for(const [id,next] of Object.entries(incoming)){
    const old=merged[id] as Record<string,unknown>|undefined;
    const terms=new Map<string,DocumentConfirmedTerm>();
    for(const term of [...(Array.isArray(old?.confirmedTerms)?old.confirmedTerms:[]),...next.confirmedTerms]){
      const key=term.source.normalize('NFKC').trim().toLocaleLowerCase();const previous=terms.get(key);if(!previous||term.updatedAt>previous.updatedAt)terms.set(key,term);
    }
    if(terms.size>100)throw new Error('合并后的本文术语超过容量，现有记录未改变。');
    merged[id]={...(old??{schemaVersion:1,documentId:id,label:'本文术语',candidateTerms:[],recentTranslations:[],dismissedTermKeys:[]}),confirmedTerms:[...terms.values()],updatedAt:Math.max(Number(old?.updatedAt)||0,next.updatedAt)};
  }
  if(Object.keys(merged).length>40)throw new Error('合并后的本文术语超过 40 份文档，现有记录未改变。');
  return merged;
}
