import {citationDoi,citationUrl} from './excerpt-citation';
export interface CitationMetadata {title?:string;authors?:string;year?:string;doi?:string;url?:string}
const plain=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length<=max&&!/[\u0000-\u001f]/u.test(value)?value.trim():undefined;
export function pageCitationMetadata(doc:Document):CitationMetadata{
  const meta=(name:string)=>doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  const title=[meta('citation_title'),meta('DC.Title'),meta('dc.title'),doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content].map(value=>plain(value,500)).find(Boolean);
  const doi=[meta('citation_doi'),meta('DC.Identifier'),meta('dc.identifier')].map(citationDoi).find(Boolean);
  let values=[...doc.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]')].map(node=>plain(node.content,200));
  if(!values.length)values=[...doc.querySelectorAll<HTMLMetaElement>('meta[name="DC.Creator"],meta[name="dc.creator"]')].map(node=>plain(node.content,200));
  const authors=values.length&&values.length<=30&&values.every(Boolean)?values.join('\n'):undefined;
  const date=meta('citation_publication_date')??meta('citation_date')??meta('DC.Date.issued')??meta('dc.date.issued'),year=date?.match(/^(\d{4})(?:[-/]|$)/u)?.[1];
  return {...(title?{title}:{}),...(authors?{authors}:{}),...(year?{year}:{}),...(doi?{doi}:{})};
}
export function crossrefCitationMetadata(value:unknown,expectedDoi:string):CitationMetadata{
  const message=(value as {message?:Record<string,unknown>}|null)?.message;
  if(!citationDoi(expectedDoi)||!message||citationDoi(message.DOI)?.toLowerCase()!==citationDoi(expectedDoi)?.toLowerCase())throw new Error('返回的 DOI 与请求不符，未应用任何字段。');
  const title=Array.isArray(message.title)?plain(message.title[0],500):undefined;
  const names=Array.isArray(message.author)&&message.author.length<=30?message.author.map((raw:unknown)=>{
    if(!raw||typeof raw!=='object')return undefined;const author=raw as Record<string,unknown>;
    const family=plain(author.family,100),given=plain(author.given,100),name=plain(author.name,200);
    return name??(family?[family,given].filter(Boolean).join(', '):undefined);
  }):[];
  const authors=names.length&&names.every(Boolean)?names.join('\n'):undefined;
  const published=message.published as {'date-parts'?:unknown[][]}|undefined,part=published?.['date-parts']?.[0]?.[0];
  const year=typeof part==='number'&&Number.isInteger(part)&&part>=1000&&part<=9999?String(part):undefined;
  const url=citationUrl(message.URL);
  return {...(title?{title}:{}),...(authors?{authors}:{}),...(year?{year}:{}),doi:citationDoi(expectedDoi)!,...(url?{url}:{})};
}
export async function lookupCitationMetadata(doiValue:string,signal:AbortSignal):Promise<CitationMetadata>{
  const doi=citationDoi(doiValue);if(!doi)throw new Error('请先填写有效 DOI。');
  const response=await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`,{signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('暂时无法获取来源信息，请保留手工填写的内容。');
  const reader=response.body?.getReader();if(!reader)throw new Error('来源信息为空。');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>256_000)throw new Error('来源信息超过容量限制。');chunks.push(next.value)}}finally{await reader.cancel().catch(()=>undefined)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return crossrefCitationMetadata(JSON.parse(new TextDecoder().decode(bytes)),doi);
}
