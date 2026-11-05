import {describe,it,expect,vi} from 'vitest';
import {readingPageUrl,pdfReadingTarget,selectedReadingQuery} from '../core/content/reading-navigation';
import {openReadingSource} from '../core/background/reading-source-navigation';
import {isRuntimeMessage} from '../core/messaging/messages';
const viewer='chrome-extension://ours/pdf.html',id='a'.repeat(32);
describe('reading navigation boundaries',()=>{
 it('keeps real page queries and routes while discarding only source hints',()=>{
  expect(readingPageUrl('https://example.org/p?q=1#section&pi-excerpt=saved:~:text=quote')).toBe('https://example.org/p?q=1#section');
  expect(readingPageUrl('https://example.org/p#route-a')).not.toBe(readingPageUrl('https://example.org/p#route-b'));
  for(const url of ['javascript:alert(1)','file:///secret','https://user:pass@example.org','broken'])expect(readingPageUrl(url)).toBeUndefined();
 });
 it('accepts only our viewer and a single valid saved source identity',()=>{
  expect(pdfReadingTarget(viewer+'?recent='+id,viewer)).toEqual({kind:'recent',id});
  expect(pdfReadingTarget(viewer+'?excerpt='+encodeURIComponent('["pdf-note","id","note"]'),viewer)?.kind).toBe('excerpt');
  for(const url of [viewer+'?recent=x',viewer+'?recent='+id+'&url=file:///x',viewer+'?recent='+id+'#x',viewer+'?recent='+id+'&recent='+id,viewer.replace('ours','other')+'?recent='+id,viewer+'?restore=x'])expect(pdfReadingTarget(url,viewer)).toBeUndefined();
 });
 it('preserves manual queries including a deliberately cleared search',()=>{
  expect(selectedReadingQuery('  source\n  passage ',false)).toBe('source passage');
  expect(selectedReadingQuery('a'.repeat(160),false)).toHaveLength(160);
  for(const value of ['', ' '.repeat(20),'a'.repeat(161)])expect(selectedReadingQuery(value,false)).toBeUndefined();
  expect(selectedReadingQuery('new selection',true)).toBeUndefined();
 });
 it('validates transport ownership and rejects extra form data',()=>{
  expect(isRuntimeMessage({type:'REUSE_READING_SOURCE',payload:{url:viewer+'?recent='+id,tabId:1}})).toBe(true);
  for(const payload of [{url:viewer},{url:viewer,tabId:-1},{url:viewer,tabId:1,note:'draft'}])expect(isRuntimeMessage({type:'REUSE_READING_SOURCE',payload})).toBe(false);
 });
});
function api(){return {runtime:{getURL:()=>viewer,sendMessage:vi.fn(async(_:unknown)=>({ok:true,data:{matched:false}}))},tabs:{query:vi.fn(async()=>[{id:1,windowId:2,url:viewer},{id:3,windowId:4,url:viewer,active:true}]),sendMessage:vi.fn(async(_:number,__:unknown)=>({ok:true,data:{matched:true}})),update:vi.fn(async()=>({})),create:vi.fn(async()=>({}))},windows:{update:vi.fn(async()=>({}))}}}
describe('source reuse without navigation writes',()=>{
 it('asks the active reader first, skips a different file, and focuses the matched draft',async()=>{
  const fake=api();fake.runtime.sendMessage.mockResolvedValueOnce({ok:true,data:{matched:false}}).mockResolvedValueOnce({ok:true,data:{matched:true,draft:true}} as any);
  expect(await openReadingSource(viewer+'?recent='+id,fake)).toEqual({opened:true,reused:true,draft:true});
  expect(fake.runtime.sendMessage.mock.calls.map(([m])=>(m as any).payload.tabId)).toEqual([3,1]);
  expect(fake.tabs.update).toHaveBeenCalledWith(1,{active:true});expect(fake.windows.update).toHaveBeenCalledWith(2,{focused:true});expect(fake.tabs.create).not.toHaveBeenCalled();
 });
 it('leaves native source opening to the original anchor if no reader verifies the identity',async()=>{
  const fake=api();expect(await openReadingSource(viewer+'?recent='+id,fake)).toEqual({opened:false,reused:false});expect(fake.tabs.create).not.toHaveBeenCalled();
 });
 it('reuses only the same web route and preserves the requested source marker',async()=>{
  const fake=api();fake.tabs.query.mockResolvedValue([{id:1,windowId:2,url:'https://example.org/p#other'},{id:3,windowId:4,url:'https://example.org/p#section'}]);
  const url='https://example.org/p#section&pi-excerpt=saved';await openReadingSource(url,fake);
  expect(fake.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(3,{type:'REUSE_READING_SOURCE',payload:{url,tabId:3}});expect(fake.tabs.create).not.toHaveBeenCalled();
 });
 it('rejects unsafe links before any browser action',async()=>{
  const fake=api();await expect(openReadingSource('file:///secret',fake)).rejects.toThrow();expect(fake.tabs.query).not.toHaveBeenCalled();expect(fake.tabs.create).not.toHaveBeenCalled();
 });
});
