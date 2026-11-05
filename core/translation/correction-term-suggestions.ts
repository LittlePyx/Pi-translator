import {protectLatex} from '../latex/protector';
import {containsPdfTerm} from '../pdf/term-consistency';
import {normalizeGlossaryTermKey} from './glossary';
import type {GlossaryEntry} from './types';
import type {PdfParagraphHistory} from '../pdf/paragraph-history';
export interface CorrectionTermSuggestion extends GlossaryEntry {previousTarget:string}
export function deduplicateCorrectionTerms<T extends CorrectionTermSuggestion>(items:readonly T[],confirmed:readonly GlossaryEntry[]):T[]{
  const grouped=new Map<string,T[]>();
  for(const item of items){const key=normalizeGlossaryTermKey(item.source);grouped.set(key,[...(grouped.get(key)??[]),item])}
  return [...grouped.values()].filter(items=>new Set(items.map(item=>item.target.trim().normalize('NFKC'))).size===1)
    .map(items=>items[0]!).filter(item=>!confirmed.some(term=>normalizeGlossaryTermKey(term.source)===normalizeGlossaryTermKey(item.source)&&term.target.trim().normalize('NFKC')===item.target.trim().normalize('NFKC')));
}

/** A restore keeps its real correction baseline; the outgoing restored value
 * is not evidence of which phrase the user originally corrected. */
export function paragraphCorrectionTerms(source:string,current:PdfParagraphHistory,known:readonly GlossaryEntry[]):CorrectionTermSuggestion[]{
  if(!current.manualCorrection||current.formulaReviewDraft||current.retranslation)return [];
  const latest=current.revisions?.[0];
  const previous=current.revisions?.find(value=>value.reason==='correction'&&!value.manualCorrection&&!value.formulaReviewDraft)??(latest?.reason==='correction'?latest:undefined);
  if(!previous||previous.formulaReviewDraft)return [];
  return correctionTermSuggestions(source,previous.formulaDocument?.translationTemplate??previous.translatedText,current.formulaDocument?.translationTemplate??current.translatedText,known);
}
const safe=(value:string)=>value.trim().length>0&&value.length<=120&&!/[\n\r.!?。！？;；{}\\$]/u.test(value)&&!protectLatex(value,'SUGGESTION').fragments.length;
/** Propose only a short source selection or an existing source/translation mapping.
 * A free paragraph edit cannot establish a new bilingual term by itself. */
export function correctionTermSuggestions(sourceText:string,before:string,after:string,knownTerms:readonly GlossaryEntry[]=[]):CorrectionTermSuggestion[]{
  if(before===after||sourceText.length>20_000||before.length>24_000||after.length>24_000)return [];
  const result:CorrectionTermSuggestion[]=[];
  const original=sourceText.trim(),previous=before.trim(),next=after.trim();
  if(previous===next)return [];
  if(safe(original)&&safe(previous)&&safe(next)&&original.length<=80&&original.split(/\s+/u).length<=6){
    result.push({source:original,target:next,previousTarget:previous});
  }else{
    const protectedSource=protectLatex(sourceText,'CORRECTION_CONTEXT');
    const prose=protectedSource.fragments.reduce((text,fragment)=>text.replaceAll(fragment.token,' '),protectedSource.protectedText);
    for(const term of knownTerms){
      if(!safe(term.source)||!safe(term.target)||!containsPdfTerm(prose,term.source))continue;
      const at=before.indexOf(term.target);
      if(at<0||before.indexOf(term.target,at+term.target.length)>=0)continue;
      const prefix=before.slice(0,at),suffix=before.slice(at+term.target.length);
      if(!after.startsWith(prefix)||!after.endsWith(suffix)||after.length<=prefix.length+suffix.length)continue;
      const replacement=after.slice(prefix.length,after.length-suffix.length);
      if(safe(replacement)&&replacement!==term.target)result.push({source:term.source,target:replacement,previousTarget:term.target});
    }
  }
  const previousSources=new Map<string,Set<string>>();
  for(const term of result){const key=normalizeGlossaryTermKey(term.previousTarget);previousSources.set(key,new Set([...(previousSources.get(key)??[]),normalizeGlossaryTermKey(term.source)]))}
  const bySource=new Map<string,CorrectionTermSuggestion[]>();
  for(const term of result){if(previousSources.get(normalizeGlossaryTermKey(term.previousTarget))!.size>1)continue;const key=normalizeGlossaryTermKey(term.source);bySource.set(key,[...bySource.get(key)??[],term])}
  return [...bySource.values()].filter(items=>new Set(items.map(item=>item.target)).size===1).map(items=>items[0]!).slice(0,5);
}
