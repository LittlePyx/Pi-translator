import type {GlossaryProfile} from './glossary-profiles';
import {containsPdfTerm} from '../pdf/term-consistency';
import {normalizeGlossaryTermKey} from '../translation/glossary';
import {protectLatex} from '../latex/protector';
export interface GlossaryRecommendation {profileId:string;name:string;matchedTerms:string[];revision:string;profileSnapshot:string}
/** A suggestion from existing terms, not an inferred permanent user identity. */
export function recommendGlossaryProfile(profiles:readonly GlossaryProfile[],evidence:string):GlossaryRecommendation|undefined{
  const protectedContent=protectLatex(evidence.slice(0,6000),'GLOSSARY_CONTEXT');
  const content=protectedContent.fragments.reduce((text,fragment)=>text.replaceAll(fragment.token,' '),protectedContent.protectedText);
  const scored=profiles.map(profile=>{
    const matches=[...new Map(profile.entries.filter(term=>term.source.trim().length>=2&&containsPdfTerm(content,term.source)).map(term=>[normalizeGlossaryTermKey(term.source),term.source])).values()];
    return {profile,matches};
  }).filter(item=>item.matches.length>=2).sort((a,b)=>b.matches.length-a.matches.length);
  const first=scored[0],second=scored[1];
  if(!first||second&&first.matches.length<second.matches.length+2)return;
  let hash=0x811c9dc5;for(const character of JSON.stringify(first.profile))hash=Math.imul(hash^character.charCodeAt(0),0x01000193);
  return {profileId:first.profile.id,name:first.profile.name,matchedTerms:first.matches.slice(0,5),revision:(hash>>>0).toString(36),profileSnapshot:JSON.stringify(first.profile)};
}
