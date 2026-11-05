export const RECENT_PDF_DOCUMENTS_KEY='piRecentPdfDocumentsV1';
export interface RecentPdfDocument {title:string;pageCount?:number;updatedAt:number}
export type RecentPdfDocumentMap=Record<string,RecentPdfDocument>;
export function validRecentPdfDocument(value:unknown):value is RecentPdfDocument{
  if(!value||typeof value!=='object')return false;
  const item=value as RecentPdfDocument;
  return Object.keys(item).every(key=>['title','pageCount','updatedAt'].includes(key))&&typeof item.title==='string'&&Boolean(item.title.trim())&&item.title.length<=120&&
    Number.isFinite(item.updatedAt)&&item.updatedAt>=0&&
    (item.pageCount===undefined||Number.isSafeInteger(item.pageCount)&&item.pageCount>0);
}
export function recentPdfDocuments(value:unknown):RecentPdfDocumentMap{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>30)throw new Error('最近阅读记录格式无效，原记录未改变。');
  const result:RecentPdfDocumentMap={};
  for(const [id,item] of Object.entries(value)){
    if(!/^[a-f0-9]{32}$/u.test(id)||!validRecentPdfDocument(item))throw new Error('最近阅读记录格式无效，原记录未改变。');
    result[id]={title:item.title,...(item.pageCount!==undefined?{pageCount:item.pageCount}:{}),updatedAt:item.updatedAt};
  }
  return result;
}
/** Only the bounded recent-title list rolls over; translations, notes and their sources are never removed. */
export function updatedRecentPdfDocuments(value:unknown,id:string,next:RecentPdfDocument):RecentPdfDocumentMap{
  const result=recentPdfDocuments(value);
  if(!/^[a-f0-9]{32}$/u.test(id)||!validRecentPdfDocument(next))throw new Error('最近阅读记录格式无效，原记录未改变。');
  const old=result[id];if(old&&old.updatedAt>next.updatedAt)return result;
  result[id]={...old,...next};
  return Object.fromEntries(Object.entries(result).sort((a,b)=>b[1].updatedAt-a[1].updatedAt||a[0].localeCompare(b[0])).slice(0,30));
}
