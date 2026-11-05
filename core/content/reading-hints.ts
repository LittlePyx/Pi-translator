import type {NoteSummarySource} from './note-summary';
import type {ResearchExcerpt} from './research-excerpt-repository';
import type {PdfReadingState} from '../pdf/reading-state';

export interface ReadingRecapSource extends NoteSummarySource {updatedAt?:number;endPageNumber?:number}
export interface ReadingRecapItem {source:ReadingRecapSource;reason:'nearby'|'recent-note'|'saved'}
const validPage=(page:unknown):page is number=>typeof page==='number'&&Number.isSafeInteger(page)&&page>0;

/** Prefer the saved translated reading page when the source viewport was hidden. */
export function readingRecapPage(state:PdfReadingState|undefined):number|undefined{
  const page=state?.translation?.mode==='reading'?state.translation.pageNumber:state?.pageNumber;
  return validPage(page)?page:undefined;
}

/** Existing record metadata only; a PDF marker collection time is not an item edit time. */
export function readingRecapMetadata(item:ResearchExcerpt):Pick<ReadingRecapSource,'updatedAt'|'endPageNumber'>{
  return {...(!('marker' in item)&&Number.isFinite(item.updatedAt)&&item.updatedAt>=0?{updatedAt:item.updatedAt}:{}),
    ...(validPage(item.content.endPageNumber)&&validPage(item.content.pageNumber)&&item.content.endPageNumber>=item.content.pageNumber?{endPageNumber:item.content.endPageNumber}:{})};
}

/** Two nearby marks, then a recent note; fill remaining space without duplicates. */
export function selectReadingRecap(sources:readonly ReadingRecapSource[],pageNumber?:number):ReadingRecapItem[]{
  const ids=new Set<string>(),unique=sources.filter(source=>{if(ids.has(source.id))return false;ids.add(source.id);return true});
  const time=(source:ReadingRecapSource)=>typeof source.updatedAt==='number'&&Number.isFinite(source.updatedAt)&&source.updatedAt>=0?source.updatedAt:-1;
  const distance=(source:ReadingRecapSource)=>{
    if(!validPage(pageNumber)||!validPage(source.pageNumber))return Infinity;
    const end=validPage(source.endPageNumber)&&source.endPageNumber>=source.pageNumber?source.endPageNumber:source.pageNumber;
    return Math.max(source.pageNumber-pageNumber,pageNumber-end,0);
  };
  const nearby=unique.filter(source=>distance(source)<=1).sort((a,b)=>distance(a)-distance(b)||time(b)-time(a));
  const recent=unique.filter(source=>source.note?.trim()&&time(source)>=0).sort((a,b)=>time(b)-time(a));
  const chosen:ReadingRecapItem[]=[],seen=new Set<string>();
  const add=(source:ReadingRecapSource,reason:ReadingRecapItem['reason'])=>{if(chosen.length<3&&!seen.has(source.id)){seen.add(source.id);chosen.push({source,reason})}};
  for(const source of nearby.slice(0,2))add(source,'nearby');
  for(const source of recent)add(source,'recent-note');
  for(const source of nearby)add(source,'nearby');
  for(const source of unique.filter(source=>source.note?.trim()))add(source,'saved');
  for(const source of unique)add(source,'saved');
  return chosen;
}

export const READING_HINT_PREFERENCES_KEY='piReadingHintPreferencesV1';
export interface ReadingHintPreference {shownAt:number;dismissed?:true}
export type ReadingHintPreferences=Record<string,ReadingHintPreference>;
export function readingHintPreferences(value:unknown):ReadingHintPreferences{
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>/^[a-f0-9]{64}$/u.test(key)&&item&&typeof item==='object'&&Number.isFinite((item as ReadingHintPreference).shownAt)&&((item as ReadingHintPreference).shownAt>=0)).slice(0,500).map(([key,item])=>[key,{shownAt:(item as ReadingHintPreference).shownAt,...((item as ReadingHintPreference).dismissed===true?{dismissed:true as const}:{})}]));
}
/** Bounded local presentation preferences; never evict a user's ignored document. */
export function claimReadingHint(preferences:ReadingHintPreferences,key:string,now:number):boolean{
  const saved=preferences[key];
  return !(saved?.dismissed||saved&&now-saved.shownAt<86_400_000||!saved&&Object.keys(preferences).length>=500);
}
export function newReadingHighlights(ids:readonly string[],baseline:ReadonlySet<string>):string[]{return [...new Set(ids)].filter(id=>!baseline.has(id))}
