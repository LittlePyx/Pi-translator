import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DOCUMENT_MEMORY_STORAGE_KEY,getDocumentMemory,upsertDocumentTerm,listDocumentTermSources,reuseDocumentTerms,mergeDocumentGlossaryWithScope} from '../core/document/document-memory-repository';
import {libraryDocumentTerms,mergedDocumentMemories} from '../core/translation/document-library-state';
import {termSourceUrl,validTermProvenance,type TermSource} from '../core/document/term-provenance';
const local:Record<string,any>={};let fail=false;
const a={documentId:'doc-a',label:'论文 A'},b={documentId:'doc-b',label:'论文 B'},c={documentId:'doc-c',label:'论文 C'};
const context=(id:typeof a):TermSource=>({documentId:id.documentId,title:id.label,sourceUrl:'https://example.org/paper.pdf',pageNumber:2});
async function seed(language:'zh-CN'|'en'='zh-CN'){
 const origin=context(a);await upsertDocumentTerm(a,{source:'kernel',target:'核函数',provenance:{origin,confirmed:{...origin,targetLanguage:language,at:1}}});
 return (await listDocumentTermSources(b,language))[0]!.terms[0]!;
}
beforeEach(()=>{for(const key of Object.keys(local))delete local[key];fail=false;vi.stubGlobal('browser',{storage:{local:{get:async(key:string)=>({[key]:local[key]}),set:async(values:Record<string,unknown>)=>{if(fail)throw Error('quota');Object.assign(local,structuredClone(values))}}}})});
afterEach(()=>vi.unstubAllGlobals());
describe('source-backed confirmed terminology reuse',()=>{
 it('lists confirmed terms only, filters known languages, keeps legacy language unknown and does not write',async()=>{
  await seed();await upsertDocumentTerm(c,{source:'sample',target:'样本'});
  local[DOCUMENT_MEMORY_STORAGE_KEY][a.documentId].candidateTerms=[{id:'candidate',source:'private candidate',target:'不应展示',createdAt:1}];
  const before=JSON.stringify(local);
  expect((await listDocumentTermSources(b,'en')).flatMap(d=>d.terms).map(t=>t.source)).toEqual(['sample']);
  expect((await listDocumentTermSources(a,'zh-CN')).map(d=>d.documentId)).toEqual([c.documentId]);
  expect(JSON.stringify(await listDocumentTermSources(b,'zh-CN'))).not.toContain('private candidate');expect(JSON.stringify(local)).toBe(before);
 });
 it('copies explicit selections, retains origin across reuse and exposes only wording to translation prompts',async()=>{
  const term=await seed(),sourceBefore=JSON.stringify(local[DOCUMENT_MEMORY_STORAGE_KEY][a.documentId]);
  const result=await reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}]);
  expect(result.confirmedTerms[0]!.provenance).toMatchObject({origin:context(a),confirmed:{...context(b),targetLanguage:'zh-CN'},via:{documentId:a.documentId,termId:term.id,termUpdatedAt:term.updatedAt}});
  const final=await reuseDocumentTerms(c,context(c),'zh-CN',[{documentId:b.documentId,term:result.confirmedTerms[0]!}]);
  expect(final.confirmedTerms[0]!.provenance).toMatchObject({origin:context(a),confirmed:{documentId:c.documentId},via:{documentId:b.documentId}});
  expect(mergeDocumentGlossaryWithScope([],result)).toEqual([{source:'kernel',target:'核函数',scope:'document'}]);
  expect(mergeDocumentGlossaryWithScope([],result,'en')).toEqual([]);
  expect(mergeDocumentGlossaryWithScope([],result,'zh-CN')).toEqual([{source:'kernel',target:'核函数',scope:'document'}]);
  expect(JSON.stringify(local[DOCUMENT_MEMORY_STORAGE_KEY][a.documentId])).toBe(sourceBefore);
  const restored=mergedDocumentMemories({},libraryDocumentTerms(local[DOCUMENT_MEMORY_STORAGE_KEY]));
  expect((restored[b.documentId] as any).confirmedTerms).toEqual(result.confirmedTerms);
 });
 it('records a legacy source without inventing original pages or language',async()=>{
  await upsertDocumentTerm(a,{source:'sample',target:'样本'});const term=(await listDocumentTermSources(b,'zh-CN'))[0]!.terms[0]!;
  const next=await reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}]);
  expect(next.confirmedTerms[0]!.provenance!.origin).toEqual({documentId:a.documentId,title:a.label});
  expect(next.confirmedTerms[0]!.provenance!.confirmed.targetLanguage).toBe('zh-CN');
 });
 it('preserves unrelated candidate terms and old translation memory during an explicit reuse',async()=>{
  const term=await seed();await upsertDocumentTerm(b,{source:'local',target:'本文约定'});
  const memory=local[DOCUMENT_MEMORY_STORAGE_KEY][b.documentId],candidate={id:'candidate-local',source:'local',target:'保留的候选',createdAt:1};
  memory.candidateTerms=[candidate,{id:'candidate-import',source:'kernel',target:'待确认',createdAt:1}];memory.recentTranslations=[{translatedText:'人工旧译文',originalText:'Existing source'}];const previous=structuredClone(memory.recentTranslations);
  const result=await reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}]);expect(result.candidateTerms).toEqual([candidate]);expect(result.recentTranslations).toEqual(previous);
 });
 it('rejects stale sources and destination conflicts atomically without replacing local terms',async()=>{
  const term=await seed();await upsertDocumentTerm(a,{source:'kernel',target:'不同的新约定'});
  let before=JSON.stringify(local);await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}])).rejects.toThrow('已变化');expect(JSON.stringify(local)).toBe(before);
  const fresh=(await listDocumentTermSources(b,'zh-CN'))[0]!.terms[0]!;await upsertDocumentTerm(b,{source:'ＫＥＲＮＥＬ',target:'本文人工约定'});
  before=JSON.stringify(local);await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term:fresh}])).rejects.toThrow('同名');expect(JSON.stringify(local)).toBe(before);
 });
 it('rejects wrong languages, duplicate selections and failed storage without partial writes',async()=>{
  const term=await seed();let before=JSON.stringify(local);
  await expect(reuseDocumentTerms(b,context(b),'en',[{documentId:a.documentId,term}])).rejects.toThrow('语言');
  await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term},{documentId:a.documentId,term}])).rejects.toThrow('同名');expect(JSON.stringify(local)).toBe(before);
  fail=true;await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}])).rejects.toThrow('quota');expect(JSON.stringify(local)).toBe(before);
 });
 it('refuses document and term capacity instead of evicting older translations or corrections',async()=>{
  const term=await seed();for(let i=0;i<39;i++){const id=`doc-x${i}`;local[DOCUMENT_MEMORY_STORAGE_KEY][id]={...local[DOCUMENT_MEMORY_STORAGE_KEY][a.documentId],documentId:id,recentTranslations:[{translatedText:'人工旧译文'}],confirmedTerms:[]}}
  let before=JSON.stringify(local);await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}])).rejects.toThrow('40');expect(JSON.stringify(local)).toBe(before);
  delete local[DOCUMENT_MEMORY_STORAGE_KEY]['doc-x0'];await upsertDocumentTerm(b,{source:'first',target:'已有'});
  const memory=local[DOCUMENT_MEMORY_STORAGE_KEY][b.documentId];memory.confirmedTerms=Array.from({length:100},(_,i)=>({id:`term-${i}`,source:`entry${i}`,target:'旧约定',createdAt:1,updatedAt:1}));
  before=JSON.stringify(local);await expect(reuseDocumentTerms(b,context(b),'zh-CN',[{documentId:a.documentId,term}])).rejects.toThrow('100');expect(JSON.stringify(local)).toBe(before);
 });
 it('rejects unsafe provenance in backups and clears old attribution after a wording change',async()=>{
  const term=await seed();expect(termSourceUrl('javascript:alert(1)')).toBeUndefined();expect(termSourceUrl('https://example.org/file?token=private')).toBeUndefined();expect(termSourceUrl('https://user:password@example.org/file')).toBeUndefined();
  expect(validTermProvenance({...term.provenance,origin:{...context(a),sourceUrl:'file:///private.pdf'}})).toBe(false);
  const invalid=structuredClone(local[DOCUMENT_MEMORY_STORAGE_KEY]);invalid[a.documentId].confirmedTerms[0].provenance.origin.sourceUrl='javascript:bad';expect(()=>libraryDocumentTerms(invalid)).toThrow('来源');
  await upsertDocumentTerm(a,{source:'kernel',target:'手动更改的新译法'});expect((await getDocumentMemory(a)).confirmedTerms[0]!.provenance).toBeUndefined();
 });
});
