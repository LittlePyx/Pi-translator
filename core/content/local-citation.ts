import {citationDoi,citationUrl,type ExcerptCitation} from './excerpt-citation';
import type {CitationMetadata} from './citation-metadata';

const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\u0000-\u001f]/u.test(value)?value.trim():undefined;
function authors(value:unknown):string|undefined{
  const values=Array.isArray(value)?value:typeof value==='string'?value.split(/[;\n]/u):[];
  const names=values.map(value=>text(value,200));
  return names.length&&names.length<=30&&names.every(Boolean)?names.join('\n'):undefined;
}
/** Only explicit publication dates count; PDF creation/modification dates do not. */
export function pdfCitationMetadata(info:Record<string,unknown>,xmp:Record<string,unknown>={},firstPageText=''):CitationMetadata{
  let title=text(xmp['dc:title'],500)??text(info.Title,500);
  if(title&&/^(?:untitled|untitled document|microsoft word\b.*|无标题)$/iu.test(title))title=undefined;
  const author=authors(xmp['dc:creator'])??authors(info.Author);
  const explicitDoi=citationDoi(xmp['prism:doi'])??citationDoi(info.DOI);
  const matches=[...firstPageText.slice(0,12_000).matchAll(/(?:\bdoi\s*:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s<>"\u0000-\u001f]+)/giu)].map(match=>match[1]!);
  const dois=[...new Set(matches.map(raw=>{
    let value=raw.replace(/[.,;:]+$/u,'');
    while(value.endsWith(')')&&(value.match(/\)/gu)?.length??0)>(value.match(/\(/gu)?.length??0))value=value.slice(0,-1);
    return citationDoi(value)?.toLocaleLowerCase();
  }).filter((value):value is string=>Boolean(value)))];
  const doi=explicitDoi??(dois.length===1?dois[0]:undefined);
  const date=text(xmp['prism:publicationdate'],80),year=date?.match(/^(\d{4})(?:[-/]|$)/u)?.[1];
  const url=citationUrl(xmp['prism:url']);
  return {...(title?{title}:{}),...(author?{authors:author}:{}),...(year?{year}:{}),...(doi?{doi}:{}),...(url?{url}:{})};
}

/** Fill blanks in a draft; never change a nonempty user field or persist a record. */
export function fillMissingCitationFields<T extends ExcerptCitation>(current:T,metadata:CitationMetadata):T{
  const next={...current};
  for(const key of ['authors','year','doi'] as const)if(!next[key]?.trim()&&metadata[key])next[key]=metadata[key];
  if(!next.sourceTitle.trim()&&metadata.title)next.sourceTitle=metadata.title;
  if(!next.sourceUrl?.trim()&&metadata.url)next.sourceUrl=metadata.url;
  return next;
}
