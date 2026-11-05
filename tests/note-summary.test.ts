import {describe,it,expect,vi,afterEach} from 'vitest';
import {assertSummarySize,noteSummaryHash,noteSummaryMessages,parseNoteSummary,summaryPurpose,validNoteSummaryTarget,type NoteSummarySource} from '../core/content/note-summary';
import {alternativeSearchTerms,searchWithConfirmedTerms} from '../core/translation/search-assistance';
import {isRuntimeMessage} from '../core/messaging/messages';
import {OpenAiCompatibleTranslator} from '../core/translation/openai-compatible-translator';
const sources:NoteSummarySource[]=[{id:'local-private-id',revision:'a'.repeat(64),title:'Private source title',originalText:'The effect may be limited.',translatedText:'效果可能有限。',note:'我的待验证想法',href:'https://example.org/private',pageNumber:3},{id:'region',revision:'b'.repeat(64),title:'Region note',originalText:'',note:'仅有个人区域笔记'}];
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
describe('bounded, source-linked note summaries',()=>{
 it('validates document identities and rejects arbitrary payloads',()=>{
  expect(validNoteSummaryTarget({kind:'pdf',documentId:'a'.repeat(32)})).toBe(true);expect(validNoteSummaryTarget({kind:'web',pageUrl:'https://example.org/p#section'})).toBe(true);
  for(const target of [{kind:'pdf',documentId:'filename'},{kind:'web',pageUrl:'file:///paper'},{kind:'web',pageUrl:'https://u:p@example.org'},{kind:'pdf',documentId:'a'.repeat(32),text:'extra'}])expect(validNoteSummaryTarget(target)).toBe(false);
 });
 it('uses existing multi-purpose precedence',()=>{expect(summaryPurpose(['daily','learning','research'])).toBe('research');expect(summaryPurpose(['daily','learning'])).toBe('learning');expect(summaryPurpose()).toBe('daily')});
 it('does not silently truncate selected material',()=>{expect(()=>assertSummarySize([])).toThrow();expect(()=>assertSummarySize([{...sources[0]!,originalText:'',translatedText:'',note:''}])).toThrow();expect(()=>assertSummarySize(Array(31).fill(sources[0]))).toThrow();expect(()=>assertSummarySize([{...sources[0]!,originalText:'x'.repeat(40_001)}])).toThrow();expect(()=>assertSummarySize([{...sources[0]!,originalText:'x'.repeat(40_000),translatedText:'',note:''}])).not.toThrow()});
 it('keeps local IDs, source URLs, titles and page numbers out of the provider payload',()=>{
  const messages=noteSummaryMessages(sources,'zh-CN','research'),body=JSON.stringify(messages);expect(body).not.toContain('local-private-id');expect(body).not.toContain('example.org');expect(body).not.toContain('Private source title');expect(body).toContain('s1');expect(body).toContain('personal');expect(body).toContain('not read the full document');
 });
 it('accepts only explicitly cited, separately classified points',()=>{
  const points=[{kind:'source',text:'效果可能有限。',sources:['s1']},{kind:'note',text:'个人待验证想法。',sources:['s1','s2']}];expect(parseNoteSummary(JSON.stringify({points}),sources)).toEqual(points);expect(parseNoteSummary('```json\n{"points":[]}\n```',sources)).toEqual([]);
 });
 it.each([
  {kind:'source',text:'No reference',sources:[]},
  {kind:'source',text:'Outside reference',sources:['s3']},
  {kind:'source',text:'Personal thought asserted as source',sources:['s2']},
  {kind:'source',text:'Repeated reference',sources:['s1','s1']},
  {kind:'source',text:'x'.repeat(601),sources:['s1']},
  {kind:'source',text:'Injected URL',sources:['s1'],url:'https://invented.example'},
  {kind:'source',text:'Bad ID',sources:['s01']}
 ])('rejects invalid provenance %#',point=>{expect(()=>parseNoteSummary(JSON.stringify({points:[point]}),sources)).toThrow()});
 it('rejects a personal-note point citing a source with no note',()=>{expect(()=>parseNoteSummary('{"points":[{"kind":"note","text":"x","sources":["s1"]}]}',[{...sources[0]!,note:''}])).toThrow()});
 it('rejects overlong or extra-field responses',()=>{expect(()=>parseNoteSummary(JSON.stringify({points:[],url:'x'}),sources)).toThrow();expect(()=>parseNoteSummary('x'.repeat(20_001),sources)).toThrow();expect(()=>parseNoteSummary(JSON.stringify({points:Array(9).fill({kind:'source',text:'x',sources:['s1']})}),sources)).toThrow()});
 it('detects changes in saved notes without recording content',async()=>{expect(await noteSummaryHash(sources[0])).toHaveLength(64);expect(await noteSummaryHash(sources[0])).not.toBe(await noteSummaryHash({...sources[0],note:'changed'}))});
 it('validates message ownership data and rejects arbitrary text or duplicate selections',()=>{
  const payload={target:{kind:'pdf',documentId:'a'.repeat(32)},requestId:'r',configuration:'b'.repeat(64),selections:[{id:'local',revision:'c'.repeat(64)}]};expect(isRuntimeMessage({type:'GENERATE_NOTE_SUMMARY',payload})).toBe(true);
  for(const change of [{text:'untrusted'},{purpose:'invented-template'},{selections:[...payload.selections,...payload.selections]},{target:{kind:'web',pageUrl:'javascript:bad'}},{configuration:'bad'},{selections:[{id:'x',revision:'c'.repeat(64),note:'extra'}]}])expect(isRuntimeMessage({type:'GENERATE_NOTE_SUMMARY',payload:{...payload,...change}})).toBe(false);
 });
 it('offers only explicit bilingual term alternatives and keeps the original query',()=>{const terms=[{source:'Kernel',target:'核函数'},{source:'Kernel',target:'核函数'},{source:'Kernel',target:'内核'}];expect(alternativeSearchTerms(' kernel ',terms)).toEqual(['核函数','内核']);expect(alternativeSearchTerms('核函数',terms)).toEqual(['Kernel']);expect(alternativeSearchTerms('Kern',terms)).toEqual([]);expect(alternativeSearchTerms('x',[])).toEqual([])});
 it('uses the existing transport once and never retries malformed summaries',async()=>{
  vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>undefined)}}});
  const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({choices:[{message:{content:'{"points":[{"kind":"source","text":"bad","sources":["s99"]}]}'},finish_reason:'stop'}]}),{status:200}));vi.stubGlobal('fetch',fetch);
  await expect(new OpenAiCompatibleTranslator().summarizeNotes(sources,'zh-CN','research','offline-model',{apiBaseUrl:'https://api.example.org',apiKey:'offline-fixture'},new AbortController().signal)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);const body=JSON.parse(fetch.mock.calls[0]![1]!.body as string);expect(body.stream).toBe(false);expect(body.messages).toHaveLength(2);
 });
});


describe('automatic confirmed-term fallback',()=>{
 const terms=[{source:'Kernel',target:'核函数'},{source:'Kernel',target:'内核'},{source:'kernel',target:'核函数'}];
 it('keeps direct matches first without trying an alternative',()=>{
  const search=vi.fn(()=>['direct']);expect(searchWithConfirmedTerms('kernel',terms,search,id=>id)).toEqual({matches:[{item:'direct',query:'kernel'}],aliases:[]});expect(search).toHaveBeenCalledTimes(1);
 });
 it('finds both confirmed translations, deduplicates identities and records the actual matched query',()=>{
  const input='kernel',search=vi.fn((q:string)=>q==='核函数'?['shared','a']:q==='内核'?['shared','b']:[]);
  expect(searchWithConfirmedTerms(input,terms,search,id=>id)).toEqual({matches:[{item:'shared',query:'核函数'},{item:'a',query:'核函数'},{item:'b',query:'内核'}],aliases:['核函数','内核']});expect(input).toBe('kernel');expect(search.mock.calls.map(([q])=>q)).toEqual(['kernel','核函数','内核']);
 });
 it('uses the same caller scope for every query and cannot introduce an out-of-scope result',()=>{
  const inScope=[{id:'pdf',text:'核函数'}],outside={id:'web',text:'内核'};
  const result=searchWithConfirmedTerms('Kernel',terms,q=>inScope.filter(item=>item.text.includes(q)),item=>item.id);expect(result.matches.map(({item})=>item.id)).toEqual(['pdf']);expect(result.matches).not.toContainEqual(expect.objectContaining({item:outside}));
 });
 it('does not infer partial phrases, follow mappings recursively or search when no mapping is confirmed',()=>{
  const search=vi.fn(()=>[] as string[]);expect(searchWithConfirmedTerms('Kern',terms,search,id=>id).aliases).toEqual([]);expect(search).toHaveBeenCalledTimes(1);search.mockClear();searchWithConfirmedTerms('Kernel',[{source:'Kernel',target:'核函数'},{source:'核函数',target:'another'}],search,id=>id);expect(search.mock.calls).toEqual([['Kernel'],['核函数']]);
 });
 it('bounds alternatives and ignores case-only duplicates and empty targets',()=>{
  const mappings=[{source:'x',target:''},{source:'x',target:'Alpha'},{source:'X',target:'alpha'},{source:'x',target:'Beta'},{source:'x',target:'Gamma'},{source:'x',target:'Delta'}];expect(alternativeSearchTerms('x',mappings)).toEqual(['Alpha','Beta','Gamma']);
 });
});
