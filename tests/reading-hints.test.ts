import {describe,it,expect} from 'vitest';
import {claimReadingHint,readingHintPreferences,newReadingHighlights,selectReadingRecap,readingRecapPage,readingRecapMetadata,type ReadingRecapSource} from '../core/content/reading-hints';
import {isRuntimeMessage} from '../core/messaging/messages';
const key='a'.repeat(64),day=86_400_000;
describe('local reading hint policy',()=>{
 it('claims once per document per day, including across hint kinds',()=>{expect(claimReadingHint({},key,day)).toBe(true);expect(claimReadingHint({[key]:{shownAt:day}},key,day+1)).toBe(false);expect(claimReadingHint({[key]:{shownAt:day}},key,day*2)).toBe(true)});
 it('keeps an ignored document quiet after future visits and content changes',()=>{expect(claimReadingHint({[key]:{shownAt:1,dismissed:true}},key,day*100)).toBe(false)});
 it('stays quiet on clock rollback',()=>{expect(claimReadingHint({[key]:{shownAt:day*2}},key,day)).toBe(false)});
 it('bounds preferences without evicting old ignored documents',()=>{const all=Object.fromEntries(Array.from({length:500},(_,i)=>[i.toString(16).padStart(64,'0'),{shownAt:0,dismissed:true as const}]));expect(claimReadingHint(all,key,day)).toBe(false);expect(Object.keys(readingHintPreferences(all))).toHaveLength(500)});
 it('normalizes presentation preferences without preserving content',()=>{expect(readingHintPreferences({[key]:{shownAt:1,dismissed:true,note:'private'},bad:{shownAt:1},['b'.repeat(64)]:{shownAt:-1}})).toEqual({[key]:{shownAt:1,dismissed:true}});expect(readingHintPreferences([])).toEqual({})});
 it('counts distinct new IDs rather than edits, repeated events or deletions',()=>{expect(newReadingHighlights(['old','new','new'],new Set(['old','deleted']))).toEqual(['new']);expect(newReadingHighlights(['old'],new Set(['old']))).toEqual([])});
 it('validates scoped, content-free hint messages',()=>{const target={kind:'pdf',documentId:'a'.repeat(32)};for(const action of ['snapshot','claim','dismiss'])expect(isRuntimeMessage({type:'READING_HINT',payload:{target,action}})).toBe(true);for(const payload of [{target,action:'generate'},{target,action:'claim',text:'untrusted'},{target:{kind:'web',pageUrl:'file:///paper'},action:'claim'}])expect(isRuntimeMessage({type:'READING_HINT',payload})).toBe(false)});
});


describe('reading recap relevance from saved local data',()=>{
 const source=(id:string,pageNumber?:number,updatedAt?:number,note?:string):ReadingRecapSource=>({id,revision:id,title:id,originalText:id,...(pageNumber?{pageNumber}:{}),...(updatedAt!==undefined?{updatedAt}:{}),...(note!==undefined?{note}:{})});
 it('uses the saved translated reading page and keeps compare/source positions unchanged',()=>{
  const state={pageNumber:2,pageRatio:0,zoomLevel:1,fitWidth:false,sidebarExpanded:false,updatedAt:1};
  expect(readingRecapPage({...state,translation:{mode:'reading',pageNumber:26,offsetRatio:0}})).toBe(26);
  expect(readingRecapPage({...state,translation:{mode:'compare',pageNumber:26,offsetRatio:0}})).toBe(2);
  expect(readingRecapPage(state)).toBe(2);expect(readingRecapPage(undefined)).toBeUndefined();expect(readingRecapPage({...state,pageNumber:0})).toBeUndefined();
 });
 it('reserves a recent note after two nearby marks instead of filling the recap with newly created distant highlights',()=>{
  const sources=[source('new-distant',1,1000),source('recent-note',5,900,'changed thought'),source('adjacent',2,2),source('exact',3,1),source('other-nearby',4,0)];const before=structuredClone(sources);
  expect(selectReadingRecap(sources,3).map(({source,reason})=>[source.id,reason])).toEqual([['exact','nearby'],['adjacent','nearby'],['recent-note','recent-note']]);expect(sources).toEqual(before);
 });
 it('treats a multi-page note spanning the saved page as nearby and ignores malformed ranges',()=>{
  const spanning={...source('span',2,2),endPageNumber:4},invalid={...source('invalid',1,1000),endPageNumber:0};
  expect(selectReadingRecap([source('distant',9,100),spanning,invalid,source('adjacent',5,1)],3).map(({source,reason})=>[source.id,reason])).toEqual([['span','nearby'],['distant','saved'],['invalid','saved']]);
 });
 it('prioritizes recent personal notes when no reliable position exists without treating highlight changes as note edits',()=>{
  const result=selectReadingRecap([source('latest-highlight',1,1000),source('old-note',5,10,'old'),source('new-note',9,30,'new'),source('unknown-time-note',4,undefined,'preserved')]);
  expect(result.map(({source,reason})=>[source.id,reason])).toEqual([['new-note','recent-note'],['old-note','recent-note'],['unknown-time-note','saved']]);
 });
 it('fills with nearby marks when there are no notes and stays within three unique records',()=>{
  const sources=[source('exact',3,4),source('exact',3,1),source('next',4,3),source('previous',2,2),source('far',8,10)];
  const result=selectReadingRecap(sources,3);expect(result.map(item=>item.source.id)).toEqual(['exact','next','previous']);expect(result[0]!.source.updatedAt).toBe(4);expect(result.every(item=>item.reason==='nearby')).toBe(true);
 });
 it('keeps stable input order for ties, handles empty material and does not invent a position',()=>{
  expect(selectReadingRecap([])).toEqual([]);const sources=[source('b',2),source('a',2),source('c',2),source('d',2)];
  expect(selectReadingRecap(sources,NaN).map(item=>item.source.id)).toEqual(['b','a','c']);expect(selectReadingRecap(sources,0).every(item=>item.reason==='saved')).toBe(true);
 });
 it('does not claim the shared PDF marker collection timestamp as a per-note edit time',()=>{
  const marker={kind:'pdf',marker:{},updatedAt:1000,content:{pageNumber:3,note:'preserved'}} as any;
  expect(readingRecapMetadata(marker)).toEqual({});
  expect(readingRecapMetadata({kind:'pdf',annotation:{},updatedAt:20,content:{pageNumber:2,endPageNumber:4}} as any)).toEqual({updatedAt:20,endPageNumber:4});
  expect(readingRecapMetadata({kind:'web',item:{},updatedAt:10,content:{}} as any)).toEqual({updatedAt:10});
 });
});
