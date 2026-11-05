export const RECENT_PDF_OVERRIDES_KEY='piRecentPdfOverridesV1';
export const MAX_RECENT_PDF_OVERRIDES=2000;
export interface RecentPdfOverride {name?:string;hidden:boolean;updatedAt:number}
export function recentPdfOverrides(value:unknown):Record<string,RecentPdfOverride>{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>MAX_RECENT_PDF_OVERRIDES)throw new Error('最近阅读的列表设置无效或超过容量，原有资料未改变。');
  const result:Record<string,RecentPdfOverride>={};
  for(const [id,raw] of Object.entries(value)){
    const item=raw as RecentPdfOverride;
    if(!/^[a-f0-9]{32}$/u.test(id)||!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['name','hidden','updatedAt'].includes(key))||typeof item.hidden!=='boolean'||!Number.isFinite(item.updatedAt)||item.updatedAt<0||
      (item.name!==undefined&&(typeof item.name!=='string'||!item.name.trim()||item.name.length>120)))throw new Error('最近阅读的列表设置无效或超过容量，原有资料未改变。');
    result[id]={...(item.name!==undefined?{name:item.name}:{}),hidden:item.hidden,updatedAt:item.updatedAt};
  }
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>1_000_000)throw new Error('最近阅读的列表设置无效或超过容量，原有资料未改变。');
  return result;
}
