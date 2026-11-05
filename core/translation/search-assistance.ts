import type {GlossaryEntry} from './types';

/** Explicit confirmed mappings only; no model call or inferred translation. */
export function alternativeSearchTerms(query:string,terms:readonly GlossaryEntry[]):string[]{
  const normalized=query.trim().toLocaleLowerCase();if(!normalized)return [];
  const seen=new Set([normalized]);
  return terms.flatMap(term=>term.source.trim().toLocaleLowerCase()===normalized?[term.target.trim()]:term.target.trim().toLocaleLowerCase()===normalized?[term.source.trim()]:[]).filter(value=>{const key=value.toLocaleLowerCase();if(!value||value.length>160||seen.has(key))return false;seen.add(key);return true}).slice(0,3);
}

/** Search the original first. Only an empty result may use confirmed mappings. */
export function searchWithConfirmedTerms<T>(query:string,terms:readonly GlossaryEntry[],search:(query:string)=>T[],identity:(item:T)=>string):{matches:{item:T;query:string}[];aliases:string[]}{
  const direct=search(query);if(direct.length||!query.trim())return {matches:direct.map(item=>({item,query})),aliases:[]};
  const seen=new Set<string>(),matches:{item:T;query:string}[]=[],aliases:string[]=[];
  for(const alternative of alternativeSearchTerms(query,terms)){
    let found=false;for(const item of search(alternative)){const key=identity(item);if(seen.has(key))continue;seen.add(key);matches.push({item,query:alternative});found=true}
    if(found)aliases.push(alternative);
  }
  return {matches,aliases};
}
