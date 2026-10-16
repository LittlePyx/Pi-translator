import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {citationUrl,normalizeExcerptCitation,type ExcerptCitation} from './excerpt-citation';
import {markerTextStillMatches,type TranslationMarkerContent} from './session-translation-markers';
export const WEB_EXCERPTS_KEY='piWebExcerptsV1';
export interface WebExcerpt {markerId:string;pageUrl:string;anchor:{sourceText:string;prefix:string;suffix:string};content:TranslationMarkerContent;createdAt:number;updatedAt:number}
export function webExcerptPageUrl(value:string):string{
  const safe=citationUrl(value);if(!safe)throw new Error('网页摘录仅支持 HTTP 或 HTTPS 页面。');
  const url=new URL(safe);url.hash='';for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|mc_)/iu.test(key))url.searchParams.delete(key);url.searchParams.sort();return url.href;
}
export function normalizeWebExcerpt(value:unknown):WebExcerpt{
  if(!value||typeof value!=='object')throw new Error('网页摘录格式无效。');
  const item=value as WebExcerpt;
  if(typeof item.markerId!=='string'||!item.markerId||item.markerId.length>240||typeof item.pageUrl!=='string'||!Number.isFinite(item.createdAt)||!Number.isFinite(item.updatedAt)||!item.anchor||!item.content)throw new Error('网页摘录标识无效。');
  const {sourceText,prefix,suffix}=item.anchor,{originalText,translatedText}=item.content;
  if([sourceText,originalText,translatedText].some(text=>typeof text!=='string'||!text.trim()||text.length>20_000)||[prefix,suffix].some(text=>typeof text!=='string'||text.length>256)||!markerTextStillMatches(sourceText,originalText))throw new Error('网页摘录正文或定位信息无效。');
  const citation=normalizeExcerptCitation(item.content);
  return {markerId:item.markerId,pageUrl:webExcerptPageUrl(item.pageUrl),anchor:{sourceText,prefix,suffix},content:{originalText,translatedText,...citation},createdAt:item.createdAt,updatedAt:item.updatedAt};
}
export function normalizeWebExcerptMap(value:unknown):Record<string,WebExcerpt[]>{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>30)throw new Error('网页摘录超过 30 个页面，或格式无效。');
  const map:Record<string,WebExcerpt[]>={};
  for(const [id,records] of Object.entries(value)){
    if(!/^[a-f0-9]{32}$/u.test(id)||!Array.isArray(records)||records.length>100)throw new Error('每个页面最多保存 100 条摘录。');
    map[id]=records.map(normalizeWebExcerpt);
    if(new Set(map[id].map(item=>item.markerId)).size!==map[id].length||new Set(map[id].map(item=>item.pageUrl)).size>1)throw new Error('网页摘录包含重复标识或不同页面。');
  }
  if(new TextEncoder().encode(JSON.stringify(map)).byteLength>4_000_000)throw new Error('已保存网页摘录超过 4 MB，请先备份并清理。');
  return map;
}
async function pageKey(pageUrl:string):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(webExcerptPageUrl(pageUrl)));return [...new Uint8Array(digest)].slice(0,16).map(byte=>byte.toString(16).padStart(2,'0')).join('')}
export async function validateWebExcerptMap(value:unknown):Promise<Record<string,WebExcerpt[]>>{const map=normalizeWebExcerptMap(value);for(const [id,items] of Object.entries(map))if(items.length&&await pageKey(items[0]!.pageUrl)!==id)throw new Error('网页摘录页面标识与来源不匹配。');return map}
export function webExcerptAnchorKey(item:Pick<WebExcerpt,'anchor'>):string{return JSON.stringify(item.anchor)}
export async function listWebExcerpts(pageUrl?:string):Promise<WebExcerpt[]>{
  const map=await validateWebExcerptMap((await browser.storage.local.get(WEB_EXCERPTS_KEY))[WEB_EXCERPTS_KEY]);
  const records=pageUrl?map[await pageKey(pageUrl)]??[]:Object.values(map).flat();return records.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function filterWebExcerpts(records:WebExcerpt[],query:string):WebExcerpt[]{
  const needle=query.trim().toLocaleLowerCase();
  return records.filter(({content,pageUrl})=>[content.sourceTitle,content.originalText,content.translatedText,content.note,content.sourceUrl,content.doi,pageUrl].join(' ').toLocaleLowerCase().includes(needle));
}
/** Only citation metadata is editable here; never replace a newer translation or recreate a deleted excerpt. */
export function updateWebExcerptCitation(item:WebExcerpt,citation:ExcerptCitation):Promise<void>{return withDocumentStorageLock(async()=>{
  const next=normalizeExcerptCitation(citation),id=await pageKey(item.pageUrl);
  const map=await validateWebExcerptMap((await browser.storage.local.get(WEB_EXCERPTS_KEY))[WEB_EXCERPTS_KEY]);
  const current=map[id]?.find(record=>record.markerId===item.markerId);
  if(!current||webExcerptAnchorKey(current)!==webExcerptAnchorKey(item))throw new Error('这条摘录已被删除或替换，编辑内容仍保留，请先复制笔记。');
  if(JSON.stringify(normalizeExcerptCitation(current.content))!==JSON.stringify(normalizeExcerptCitation(item.content)))throw new Error('笔记或出处已在其他窗口修改。编辑内容仍保留；可复制后取消编辑，查看已保存版本。');
  current.content={originalText:current.content.originalText,translatedText:current.content.translatedText,...next};
  current.updatedAt=Math.max(Date.now(),current.updatedAt+1);
  await browser.storage.local.set({[WEB_EXCERPTS_KEY]:normalizeWebExcerptMap(map)});
})}
export function saveWebExcerpt(value:WebExcerpt):Promise<void>{return withDocumentStorageLock(async()=>{
  const item=normalizeWebExcerpt(value),id=await pageKey(item.pageUrl),map=normalizeWebExcerptMap((await browser.storage.local.get(WEB_EXCERPTS_KEY))[WEB_EXCERPTS_KEY]);
  map[id]=[item,...(map[id]??[]).filter(old=>old.markerId!==item.markerId&&webExcerptAnchorKey(old)!==webExcerptAnchorKey(item))];
  await browser.storage.local.set({[WEB_EXCERPTS_KEY]:normalizeWebExcerptMap(map)});
})}
export function removeWebExcerpt(pageUrl:string,markerId:string):Promise<void>{return withDocumentStorageLock(async()=>{
  const id=await pageKey(pageUrl),map=normalizeWebExcerptMap((await browser.storage.local.get(WEB_EXCERPTS_KEY))[WEB_EXCERPTS_KEY]);map[id]=(map[id]??[]).filter(item=>item.markerId!==markerId);if(!map[id].length)delete map[id];await browser.storage.local.set({[WEB_EXCERPTS_KEY]:map});
})}
export function mergeWebExcerptMaps(current:unknown,incoming:unknown):Record<string,WebExcerpt[]>{
  const merged=normalizeWebExcerptMap(current);
  for(const [id,items] of Object.entries(normalizeWebExcerptMap(incoming))){const records=new Map((merged[id]??[]).map(item=>[webExcerptAnchorKey(item),item]));for(const item of items){const key=webExcerptAnchorKey(item),old=records.get(key);if(!old||item.updatedAt>old.updatedAt)records.set(key,item)}merged[id]=[...records.values()]}
  return normalizeWebExcerptMap(merged);
}
