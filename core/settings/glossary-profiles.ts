import type {ExtensionSettings} from './schema';
import type {GlossaryEntry} from '../translation/types';
import {recommendGlossaryProfile,type GlossaryRecommendation} from './glossary-recommendation';
import {mergeGlossaryDraft,normalizeGlossaryTermKey,MAX_GLOSSARY_ENTRIES,MAX_GLOSSARY_TERM_LENGTH} from '../translation/glossary';

export interface GlossaryProfile {id:string;name:string;entries:GlossaryEntry[]}
export interface GlossaryProfileSettings {
  glossaryProfiles?:GlossaryProfile[];
  activeGlossaryProfileId?:string;
  documentGlossaryProfiles?:Record<string,string>;
}
export interface DocumentGlossarySelection {
  profiles:Array<{id:string;name:string}>;
  selectedId:string;
  defaultId:string;
  missing:boolean;
  suggestion?:GlossaryRecommendation;
  termHints?:GlossaryEntry[];
}
export const GENERAL_GLOSSARY_ID='general';
export function glossaryDocumentId(request:{glossaryDocumentId?:string},fallback:string):string{
  if(request.glossaryDocumentId===undefined)return fallback;
  if(!/^doc-[a-z0-9]{1,8}$/u.test(request.glossaryDocumentId))throw new Error('文档地址无效。');
  return request.glossaryDocumentId;
}
export const MAX_GLOSSARY_PROFILES=12;
const invalid=()=>new Error('术语方案无效或超过容量，原设置未改变。');
const profileId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/u.test(id)&&id!==GENERAL_GLOSSARY_ID;

/** New optional fields are validated strictly; legacy settings need no migration. */
export function validateGlossaryProfiles(value:GlossaryProfileSettings):GlossaryProfileSettings{
  const result:GlossaryProfileSettings={};
  if(value.glossaryProfiles!==undefined){
    if(!Array.isArray(value.glossaryProfiles)||value.glossaryProfiles.length>MAX_GLOSSARY_PROFILES)throw invalid();
    const ids=new Set<string>(),names=new Set<string>();
    result.glossaryProfiles=value.glossaryProfiles.map(profile=>{
      if(!profile||!profileId(profile.id)||ids.has(profile.id)||typeof profile.name!=='string'||!profile.name.trim()||profile.name.length>40||/[\u0000-\u001f]/u.test(profile.name)||!Array.isArray(profile.entries)||profile.entries.length>MAX_GLOSSARY_ENTRIES)throw invalid();
      const name=profile.name.trim(),nameKey=name.toLocaleLowerCase(),keys=new Set<string>();
      if(names.has(nameKey))throw new Error('术语方案名称不能重复。');ids.add(profile.id);names.add(nameKey);
      const entries=profile.entries.map(term=>{
        if(!term||typeof term.source!=='string'||typeof term.target!=='string'||!term.source.trim()||!term.target.trim()||term.source.length>MAX_GLOSSARY_TERM_LENGTH||term.target.length>MAX_GLOSSARY_TERM_LENGTH)throw invalid();
        const key=normalizeGlossaryTermKey(term.source);if(keys.has(key))throw invalid();keys.add(key);return {source:term.source.trim(),target:term.target.trim()};
      });
      return {id:profile.id,name,entries};
    });
  }
  if(value.activeGlossaryProfileId!==undefined){
    if(value.activeGlossaryProfileId!==GENERAL_GLOSSARY_ID&&!result.glossaryProfiles?.some(p=>p.id===value.activeGlossaryProfileId))throw invalid();
    result.activeGlossaryProfileId=value.activeGlossaryProfileId;
  }
  if(value.documentGlossaryProfiles!==undefined){
    const map=value.documentGlossaryProfiles;
    if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length>400)throw invalid();
    result.documentGlossaryProfiles={};
    for(const [id,selection] of Object.entries(map)){
      if(!/^doc-[a-z0-9]{1,8}$/u.test(id)||(selection!==GENERAL_GLOSSARY_ID&&!profileId(selection)))throw invalid();
      result.documentGlossaryProfiles[id]=selection;
    }
  }
  return result;
}

export function documentGlossarySelection(settings:ExtensionSettings,documentId:string,evidence=''):DocumentGlossarySelection{
  const defaultId=settings.activeGlossaryProfileId??GENERAL_GLOSSARY_ID;
  const selectedId=settings.documentGlossaryProfiles?.[documentId]??'';
  const effectiveId=selectedId||defaultId;
  const suggestion=!selectedId&&evidence?recommendGlossaryProfile(settings.glossaryProfiles??[],evidence):undefined;
  return {profiles:(settings.glossaryProfiles??[]).map(({id,name})=>({id,name})),selectedId,defaultId,
    missing:effectiveId!==GENERAL_GLOSSARY_ID&&!settings.glossaryProfiles?.some(p=>p.id===effectiveId),
    ...(suggestion&&suggestion.profileId!==defaultId?{suggestion}:{}),
    ...(evidence?{termHints:effectiveSettingsGlossary(settings,documentId).filter(term=>evidence.toLocaleLowerCase().includes(term.source.toLocaleLowerCase()))}:{}),
  };
}

/** Confirmed document terms are merged by the existing caller, after this layer. */
export function effectiveSettingsGlossary(settings:ExtensionSettings,documentId?:string):GlossaryEntry[]{
  const id=(documentId&&settings.documentGlossaryProfiles?.[documentId])||settings.activeGlossaryProfileId;
  const profile=settings.glossaryProfiles?.find(p=>p.id===id);
  const entries=profile?.entries??[],keys=new Set(entries.map(term=>normalizeGlossaryTermKey(term.source)));
  const result=[...entries,...settings.academicGlossary.filter(term=>!keys.has(normalizeGlossaryTermKey(term.source)))];
  if(result.length>MAX_GLOSSARY_ENTRIES)throw new Error('领域方案与通用词表合计最多 100 个不同术语，请整理后再保存。');
  return result;
}

export function validateGlossaryProfileSettings(settings:ExtensionSettings):void{
  validateGlossaryProfiles(settings);
  for(const profile of settings.glossaryProfiles??[])effectiveSettingsGlossary({...settings,activeGlossaryProfileId:profile.id});
}

/** Preserve unrelated concurrent edits; reject conflicting edits or deletion. */
export function mergeGlossaryProfiles(baseline:ExtensionSettings,draft:ExtensionSettings,latest:ExtensionSettings):GlossaryProfileSettings{
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const conflict=()=>new Error('另一窗口已修改同一术语方案，请保留草稿并重新加载后整理。');
  const result=(latest.glossaryProfiles??[]).map(p=>({...p,entries:[...p.entries]}));
  for(const old of baseline.glossaryProfiles??[]){
    if(draft.glossaryProfiles?.some(p=>p.id===old.id))continue;
    const index=result.findIndex(p=>p.id===old.id);if(index<0)continue;
    if(!same(result[index],old))throw conflict();result.splice(index,1);
  }
  for(const next of draft.glossaryProfiles??[]){
    const old=baseline.glossaryProfiles?.find(p=>p.id===next.id);if(same(old,next))continue;
    const index=result.findIndex(p=>p.id===next.id),current=result[index];
    if(old&&!current)throw conflict();
    if(current&&old){
      if(next.name!==old.name&&current.name!==old.name&&current.name!==next.name)throw conflict();
      for(const term of old.entries){
        const key=normalizeGlossaryTermKey(term.source),a=next.entries.find(t=>normalizeGlossaryTermKey(t.source)===key),b=current.entries.find(t=>normalizeGlossaryTermKey(t.source)===key);
        if(!same(a,term)&&!same(b,term)&&!same(a,b))throw conflict();
      }
      for(const term of next.entries){
        const key=normalizeGlossaryTermKey(term.source);
        if(!old.entries.some(t=>normalizeGlossaryTermKey(t.source)===key)){const b=current.entries.find(t=>normalizeGlossaryTermKey(t.source)===key);if(b&&!same(b,term))throw conflict()}
      }
      result[index]={id:next.id,name:next.name!==old.name?next.name:current.name,entries:mergeGlossaryDraft(old.entries,next.entries,current.entries)};
    }else if(current&&!same(current,next))throw conflict();else if(!current)result.push(next);
  }
  const merged:GlossaryProfileSettings={};
  if(result.length||draft.glossaryProfiles!==undefined||latest.glossaryProfiles!==undefined)merged.glossaryProfiles=result;
  if(draft.activeGlossaryProfileId!==baseline.activeGlossaryProfileId&&draft.activeGlossaryProfileId!==undefined)merged.activeGlossaryProfileId=draft.activeGlossaryProfileId;
  else if(latest.activeGlossaryProfileId!==undefined)merged.activeGlossaryProfileId=latest.activeGlossaryProfileId;
  if(merged.activeGlossaryProfileId&&merged.activeGlossaryProfileId!==GENERAL_GLOSSARY_ID&&!result.some(p=>p.id===merged.activeGlossaryProfileId))throw conflict();
  // The settings form does not edit per-document bindings; runtime updates survive saves.
  if(latest.documentGlossaryProfiles!==undefined)merged.documentGlossaryProfiles=latest.documentGlossaryProfiles;
  return validateGlossaryProfiles(merged);
}
