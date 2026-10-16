import {listWebExcerpts,updateWebExcerptCitation,removeWebExcerpt,type WebExcerpt} from './web-excerpt-repository';
import {normalizeExcerptCitation,type ExcerptCitation} from './excerpt-citation';
import type {PersistedPdfTranslationMarker,TranslationMarkerContent} from './session-translation-markers';
import {PDF_TRANSLATION_MARKERS_KEY,normalizePdfTranslationMarkerState,normalizePersistedPdfTranslationMarker} from '../pdf/translation-marker-repository';
import {withDocumentStorageLock} from '../translation/document-storage-lock';

export type ResearchExcerpt={id:string;markerId:string;content:TranslationMarkerContent;updatedAt:number}&(
  {kind:'web';item:WebExcerpt}|{kind:'pdf';documentId:string;marker:PersistedPdfTranslationMarker}
);
export async function listResearchExcerpts():Promise<ResearchExcerpt[]>{
  const [web,stored]=await Promise.all([listWebExcerpts(),browser.storage.local.get(PDF_TRANSLATION_MARKERS_KEY)]);
  const records:ResearchExcerpt[]=web.map(item=>({kind:'web',id:JSON.stringify(['web',item.pageUrl,item.markerId]),markerId:item.markerId,content:item.content,updatedAt:item.updatedAt,item}));
  const map=stored[PDF_TRANSLATION_MARKERS_KEY];
  if(map&&typeof map==='object')for(const [documentId,raw] of Object.entries(map)){
    if(!/^[a-f0-9]{32}$/u.test(documentId))continue;
    const state=normalizePdfTranslationMarkerState(raw);
    for(const marker of state?.markers??[])records.push({kind:'pdf',id:JSON.stringify(['pdf',documentId,marker.markerId]),markerId:marker.markerId,content:{...marker.content,pageNumber:marker.anchor.pageNumber},updatedAt:state!.updatedAt,documentId,marker});
  }
  return records.sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
}
export function researchExcerptSourceUrl(item:ResearchExcerpt):string|undefined{return item.content.sourceUrl??(item.kind==='web'?item.item.pageUrl:undefined)}
export function filterResearchExcerpts(items:ResearchExcerpt[],query:string,kind='all'):ResearchExcerpt[]{
  const needle=query.trim().toLocaleLowerCase();
  return items.filter(item=>(kind==='all'||kind===item.kind)&&[item.content.sourceTitle,item.content.originalText,item.content.translatedText,item.content.note,item.content.sourceUrl,item.content.doi,item.kind==='pdf'?`PDF 第 ${item.content.pageNumber} 页`:item.item.pageUrl].some(text=>text?.toLocaleLowerCase().includes(needle)));
}
async function mutatePdfExcerpt(item:Extract<ResearchExcerpt,{kind:'pdf'}>,citation?:ExcerptCitation):Promise<void>{
  await withDocumentStorageLock(async()=>{
    const stored=await browser.storage.local.get(PDF_TRANSLATION_MARKERS_KEY),map=stored[PDF_TRANSLATION_MARKERS_KEY] as Record<string,unknown>|undefined;
    const raw=map?.[item.documentId] as {markers?:PersistedPdfTranslationMarker[];updatedAt?:number}|undefined;
    const current=raw?.markers?.find(marker=>marker.markerId===item.markerId);
    if(!raw||!current)throw new Error('这条摘录已在其他窗口删除。编辑内容仍保留。');
    if(JSON.stringify(normalizePersistedPdfTranslationMarker(current))!==JSON.stringify(item.marker))throw new Error('摘录已在其他窗口修改。编辑内容仍保留，请先复制笔记后重新打开。');
    const markers=raw.markers!.flatMap(marker=>{
      if(marker!==current)return [marker];if(!citation)return [];
      const {sourceTitle:_title,sourceUrl:_url,doi:_doi,note:_note,...content}=marker.content;
      return [{...marker,content:{...content,...citation}}];
    });
    // No pruning or schema migration: update one marker and retain every sibling.
    const next={...map,[item.documentId]:{...raw,markers,updatedAt:Math.max(Date.now(),(raw.updatedAt??0)+1)}};
    if(new TextEncoder().encode(JSON.stringify(next)).byteLength>4_000_000)throw new Error('已保存 PDF 摘录超过 4 MB，请先备份。原内容未改变。');
    await browser.storage.local.set({[PDF_TRANSLATION_MARKERS_KEY]:next});
  });
}
export async function updateResearchExcerptCitation(item:ResearchExcerpt,value:ExcerptCitation):Promise<void>{
  const citation=normalizeExcerptCitation(value);
  if(item.kind==='web')return updateWebExcerptCitation(item.item,citation);
  return mutatePdfExcerpt(item,citation);
}
export async function removeResearchExcerpt(item:ResearchExcerpt):Promise<void>{
  if(item.kind==='web')return removeWebExcerpt(item.item.pageUrl,item.markerId);
  return mutatePdfExcerpt(item);
}
