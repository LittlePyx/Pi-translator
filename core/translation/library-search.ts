import {listResearchExcerpts,type ResearchExcerpt} from '../content/research-excerpt-repository';
import {citationUrl} from '../content/excerpt-citation';
import {listSavedDocumentTermSources,type DocumentConfirmedTerm} from '../document/document-memory-repository';

export type LibrarySourceResult =
  | {kind:'excerpt';id:string;title:string;text:string;updatedAt:number;item:ResearchExcerpt}
  | {kind:'term';id:string;title:string;text:string;updatedAt:number;documentId:string;term:DocumentConfirmedTerm};

/** A read-only view of existing records: no new index, migration, or model request. */
export async function listLibrarySources():Promise<LibrarySourceResult[]>{
  const [excerpts,sources]=await Promise.all([listResearchExcerpts(),listSavedDocumentTermSources()]);
  const results:LibrarySourceResult[]=[
    ...excerpts.map(item=>({kind:'excerpt' as const,id:item.id,title:item.content.sourceTitle,
      text:[item.content.originalText,item.content.translatedText,item.content.note,item.content.doi,item.content.sourceUrl].filter(Boolean).join('\n'),updatedAt:item.updatedAt,item})),
    ...sources.flatMap(source=>source.terms.map(term=>({kind:'term' as const,id:JSON.stringify(['term',source.documentId,term.id]),
      title:term.provenance?.confirmed.title??source.label,text:[term.source,term.target,term.provenance?.origin.title,term.provenance?.origin.sourceUrl,term.provenance?.confirmed.sourceUrl,term.provenance?.via?.title,term.provenance?.confirmed.targetLanguage].filter(Boolean).join('\n'),
      updatedAt:term.updatedAt,documentId:source.documentId,term}))),
  ];
  return results.sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
}

export function filterLibrarySources(items:LibrarySourceResult[],query:string,filter:string):LibrarySourceResult[]{
  const needle=query.trim().toLocaleLowerCase();
  // Existing notes are part of the default library; terminology remains opt-in.
  if(!needle&&filter==='all')return items.filter(item=>item.kind==='excerpt');
  return items.filter(item=>(filter==='all'||filter===item.kind||item.kind==='excerpt'&&filter===item.item.kind)&&
    `${item.title}\n${item.text}`.toLocaleLowerCase().includes(needle));
}

/** Text-directive punctuation must be encoded, including literal hyphens. */
export function textSourceUrl(value:string|undefined,text:string,prefix='',suffix=''):string|undefined{
  const source=citationUrl(value);if(!source)return undefined;
  const url=new URL(source),quote=text.trim().replace(/\s+/gu,' ');
  if(!quote)return url.href;
  const encode=(value:string)=>encodeURIComponent(value).replace(/-/gu,'%2D');
  const context=(value:string)=>value.trim().replace(/\s+/gu,' ');
  // Preserve ordinary element fragments; replace only an earlier text directive.
  url.hash=`${url.hash.slice(1).split(':~:')[0]}:~:text=${prefix?`${encode(context(prefix))}-,`:''}${encode(quote)}${suffix?`,-${encode(context(suffix))}`:''}`;
  return url.href;
}

export function excerptSourceHref(item:ResearchExcerpt):string|undefined{
  if(item.kind==='pdf')return browser.runtime.getURL(`/pdf.html?excerpt=${encodeURIComponent(item.id)}`);
  const href=textSourceUrl(item.item.pageUrl,item.item.anchor.sourceText,item.item.anchor.prefix,item.item.anchor.suffix);
  if(!href)return undefined;
  const url=new URL(href),[element='',directive='']=url.hash.slice(1).split(':~:');
  url.hash=`${element?`${element}&`:''}pi-excerpt=${encodeURIComponent(item.item.markerId)}${directive?`:~:${directive}`:''}`;
  return url.href;
}
