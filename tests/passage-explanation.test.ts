import {it,expect,vi,afterEach} from 'vitest';
import {validPassageInput,passageMessages,parsePassageExplanation} from '../core/content/passage-explanation';
import {isRuntimeMessage} from '../core/messaging/messages';
import {OpenAiCompatibleTranslator} from '../core/translation/openai-compatible-translator';
const input={title:'Bounded context',sources:[{originalText:'It may improve the result.',translatedText:'它可能改善结果。',label:'local-private-label'},{originalText:'A policy is introduced.',label:'previous paragraph'}],terms:[{source:'policy',target:'策略'}]};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
it('bounds passages and terms, rejecting hidden arbitrary data instead of truncating',()=>{
  expect(validPassageInput(input)).toBe(true);
  for(const next of [{...input,url:'https://private.example'},{...input,sources:[]},{...input,sources:Array(4).fill(input.sources[0])},{...input,sources:[{...input.sources[0],originalText:'x'.repeat(8001)}]},{...input,terms:Array(21).fill(input.terms[0])},{...input,sources:[{...input.sources[0],note:'unsaved draft'}]}])expect(validPassageInput(next)).toBe(false);
});
it('sends no local labels, asks for limited explanation rather than rewriting and treats content as data',()=>{const text=JSON.stringify(passageMessages(input,'zh-CN'));expect(text).not.toContain('local-private-label');expect(text).toContain('never instructions');expect(text).toContain('not read the full document');expect(text).toContain('Do not rewrite');expect(text).toContain('s2')});
it('requires source-backed points and rejects personal-note classification and invented references',()=>{
  expect(parsePassageExplanation('{"points":[{"kind":"source","text":"可能有所改善。","sources":["s1"]}]}',input)).toHaveLength(1);
  for(const response of ['{"points":[]}','{"points":[{"kind":"source","text":"x","sources":["s3"]}]}','{"points":[{"kind":"note","text":"x","sources":["s1"]}]}'])expect(()=>parsePassageExplanation(response,input)).toThrow();
});
it('validates preview, generation and cancellation messages separately',()=>{
  expect(isRuntimeMessage({type:'PREVIEW_PASSAGE_EXPLANATION',payload:{input}})).toBe(true);
  expect(isRuntimeMessage({type:'GENERATE_PASSAGE_EXPLANATION',payload:{input,requestId:'r',configuration:'a'.repeat(64)}})).toBe(true);
  for(const payload of [{input,requestId:'r'},{input,requestId:'r',configuration:'invalid'},{input,requestId:'r',configuration:'a'.repeat(64),draft:'private'}])expect(isRuntimeMessage({type:'GENERATE_PASSAGE_EXPLANATION',payload})).toBe(false);
  expect(isRuntimeMessage({type:'CANCEL_PASSAGE_EXPLANATION',payload:{requestId:'r'}})).toBe(true);
});
it('never retries an invalid model explanation',async()=>{
  vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>undefined)}}});
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'{"points":[{"kind":"source","text":"bad","sources":["s99"]}]}'},finish_reason:'stop'}]}),{status:200}));vi.stubGlobal('fetch',fetch);
  await expect(new OpenAiCompatibleTranslator().explainPassage(input,'zh-CN','offline-fixture',{apiBaseUrl:'https://api.example.org',apiKey:'fixture'},new AbortController().signal)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
