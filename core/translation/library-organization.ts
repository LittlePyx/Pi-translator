import {withDocumentStorageLock} from './document-storage-lock';
export const LIBRARY_ORGANIZATION_KEY='piLibraryOrganizationV1';
export interface LibraryTagRecord {tags:string[];updatedAt:number}
export interface LibrarySavedView {name:string;query:string;kind:string;tag:string;project?:string;updatedAt:number;deleted?:boolean}
export interface LibraryOrganization {tags:Record<string,LibraryTagRecord>;views:Record<string,LibrarySavedView>}
const invalid=()=>new Error('资料标签或保存筛选无效，原资料未改变。');
export function normalizeLibraryOrganization(value:unknown):LibraryOrganization{
  if(value===undefined)return {tags:{},views:{}};
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  const data=value as LibraryOrganization,result:LibraryOrganization={tags:{},views:{}};
  for(const key of ['tags','views'] as const){
    const map=data[key];if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length>(key==='tags'?4000:40))throw invalid();
    for(const [id,raw] of Object.entries(map)){
      if(!id||id.length>9000||!raw||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<0)throw invalid();
      if(key==='tags'){
        const item=raw as LibraryTagRecord;
        if(!Array.isArray(item.tags)||item.tags.length>12||item.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag!==tag.trim()||tag.length>32||/[\u0000-\u001f,，]/u.test(tag))||new Set(item.tags).size!==item.tags.length)throw invalid();
        Object.defineProperty(result.tags,id,{value:{tags:[...item.tags],updatedAt:item.updatedAt},enumerable:true,writable:true,configurable:true});
      }else{
        const item=raw as LibrarySavedView;
        if(typeof item.name!=='string'||!item.name.trim()||item.name.length>80||typeof item.query!=='string'||item.query.length>500||typeof item.tag!=='string'||item.tag.length>32||item.project!==undefined&&(typeof item.project!=='string'||!/^[a-zA-Z0-9-]{1,80}$/u.test(item.project))||!['all','pdf','web','excerpt','term','pinned','review','incomplete'].includes(item.kind)||item.deleted!==undefined&&typeof item.deleted!=='boolean')throw invalid();
        Object.defineProperty(result.views,id,{value:{name:item.name,query:item.query,kind:item.kind,tag:item.tag,...(item.project?{project:item.project}:{}),updatedAt:item.updatedAt,...(item.deleted?{deleted:true}:{})},enumerable:true,writable:true,configurable:true});
      }
    }
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length>1_000_000)throw invalid();return result;
}
export function mergeLibraryOrganization(local:unknown,incoming:unknown):LibraryOrganization{
  const a=normalizeLibraryOrganization(local),b=normalizeLibraryOrganization(incoming);
  for(const key of ['tags','views'] as const)for(const [id,next] of Object.entries(b[key])){
    const previous=a[key][id];
    if(previous&&previous.updatedAt===next.updatedAt&&JSON.stringify(previous)!==JSON.stringify(next))throw new Error('资料标签或筛选存在同版本冲突，请保留两份备份。');
    if(!previous||next.updatedAt>previous.updatedAt)Object.defineProperty(a[key],id,{value:next,enumerable:true,writable:true,configurable:true});
  }
  return normalizeLibraryOrganization(a);
}
export async function readLibraryOrganization():Promise<LibraryOrganization>{return normalizeLibraryOrganization((await browser.storage.local.get(LIBRARY_ORGANIZATION_KEY))[LIBRARY_ORGANIZATION_KEY])}
export function updateLibraryOrganization(key:'tags'|'views',id:string,value:LibraryTagRecord|LibrarySavedView,expected:LibraryTagRecord|LibrarySavedView|undefined):Promise<void>{return withDocumentStorageLock(async()=>{
  const state=await readLibraryOrganization();if(JSON.stringify(state[key][id])!==JSON.stringify(expected))throw new Error('资料标签或筛选已在其他窗口变化，请重新打开；草稿仍保留。');
  Object.defineProperty(state[key],id,{value,enumerable:true,writable:true,configurable:true});await browser.storage.local.set({[LIBRARY_ORGANIZATION_KEY]:normalizeLibraryOrganization(state)});
})}
