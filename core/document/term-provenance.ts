import {isSupportedTargetLanguage,type SupportedTargetLanguage} from '../language/supported-target-languages';
import {normalizeGlossaryTermKey} from '../translation/glossary';
export const normalizeReusedTermKey=(value:string)=>normalizeGlossaryTermKey(value.normalize('NFKC'));
export class DocumentTermReuseError extends Error {constructor(message:string){super(message);this.name='DocumentTermReuseError'}}

export interface TermSource {documentId:string;title:string;sourceUrl?:string;pageNumber?:number}
export interface TermProvenance {
  origin:TermSource;
  confirmed:TermSource & {targetLanguage:SupportedTargetLanguage;at:number};
  via?:{documentId:string;title:string;termId:string;termUpdatedAt:number};
}
export const termAppliesToLanguage=(term:{provenance?:TermProvenance},language:string)=>!term.provenance||term.provenance.confirmed.targetLanguage===language;
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const docId=(v:unknown):v is string=>typeof v==='string'&&/^doc-[a-z0-9]{1,8}$/u.test(v);
const title=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=160;
export function termSourceUrl(value:unknown):string|undefined{
  if(typeof value!=='string'||value.length>2000)return undefined;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&![...url.searchParams.keys()].some(key=>/token|key|signature|auth|secret/iu.test(key))?url.href:undefined}catch{return undefined}
}
function source(value:unknown,confirmed=false):value is TermSource & Record<string,unknown>{
  return record(value)&&Object.keys(value).every(key=>['documentId','title','sourceUrl','pageNumber',...(confirmed?['targetLanguage','at']:[])].includes(key))&&docId(value.documentId)&&title(value.title)&&
    (value.sourceUrl===undefined||termSourceUrl(value.sourceUrl)===value.sourceUrl)&&
    (value.pageNumber===undefined||Number.isSafeInteger(value.pageNumber)&&Number(value.pageNumber)>0&&Number(value.pageNumber)<=100_000);
}
export function validTermProvenance(value:unknown):value is TermProvenance{
  return record(value)&&Object.keys(value).every(key=>['origin','confirmed','via'].includes(key))&&source(value.origin)&&source(value.confirmed,true)&&
    isSupportedTargetLanguage(value.confirmed.targetLanguage)&&Number.isFinite(value.confirmed.at)&&Number(value.confirmed.at)>=0&&
    (value.via===undefined||record(value.via)&&Object.keys(value.via).every(key=>['documentId','title','termId','termUpdatedAt'].includes(key))&&docId(value.via.documentId)&&title(value.via.title)&&typeof value.via.termId==='string'&&value.via.termId.length>0&&value.via.termId.length<=120&&Number.isFinite(value.via.termUpdatedAt)&&Number(value.via.termUpdatedAt)>=0);
}
