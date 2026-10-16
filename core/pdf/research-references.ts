import type {PdfDocumentTranslationBlock} from './document-translation';
import type {FormulaDocument} from '../translation/formula-document';

export interface ResearchReferenceBlock extends Pick<PdfDocumentTranslationBlock,'id'|'text'|'pageNumber'|'kind'|'sourceEquations'> {
  formulaDocument?:FormulaDocument;
  included?:boolean;
  headingLevel?:number|undefined;
}
export interface ResearchReferenceTarget {blockId:string;pageNumber:number;label:string;equationId?:string}
export interface ResearchReferenceMatch {start:number;end:number;target:ResearchReferenceTarget}
type Kind='equation'|'figure'|'table'|'section';
const key=(kind:Kind,number:string)=>`${kind}:${number.toLowerCase()}`;
const kindOf=(word:string):Kind=>/^(?:eq|equation|式|公式)/iu.test(word)?'equation':/^(?:fig|figure|图)/iu.test(word)?'figure':/^(?:tab|table|表)/iu.test(word)?'table':'section';

/** Only unique source-derived labels establish destinations. Never infer a
 * figure/section number from translated prose or use array order to pair labels. */
export function buildResearchReferenceIndex(blocks:readonly ResearchReferenceBlock[]):Map<string,ResearchReferenceTarget>{
  const candidates=new Map<string,Map<string,ResearchReferenceTarget>>();
  const add=(kind:Kind,number:string,block:ResearchReferenceBlock,equationId?:string)=>{
    const id=key(kind,number),items=candidates.get(id)??new Map();
    items.set(JSON.stringify([block.id,equationId]),{blockId:block.id,pageNumber:block.pageNumber,label:`${kind==='equation'?'式':kind==='figure'?'图':kind==='table'?'表':'节'} ${number}`,...(equationId?{equationId}:{})});candidates.set(id,items);
  };
  for(const block of blocks){
    if(block.included===false)continue;
    for(const equation of block.sourceEquations??[])add('equation',equation.number,block,equation.id);
    // Saved formula documents retain locally bound identities without the PDF.
    if(!block.sourceEquations?.length)for(const equation of block.formulaDocument?.formulas??[])
      if(equation.display&&equation.sourceEquationId&&equation.equationNumber&&!equation.review)add('equation',equation.equationNumber,block,equation.sourceEquationId);
    if(block.kind==='figure'||block.kind==='table'){
      const caption=/^\s*(Figure|Fig\.?|Table|Tab\.?|图|表)\s*(\d{1,4}[a-z]?)(?=[\s.:：、(（]|$)/iu.exec(block.text);
      if(caption&&kindOf(caption[1]!)===block.kind)add(block.kind,caption[2]!,block);
    }
    if(block.headingLevel&&!block.kind&&block.text.length<180){
      const heading=/^\s*(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([^\n.!?。！？]{2,120})\s*$/u.exec(block.text);
      if(heading)add('section',heading[1]!,block);
    }
  }
  return new Map([...candidates].flatMap(([id,items])=>items.size===1?[[id,[...items.values()][0]!] as const]:[]));
}

export function researchReferenceMatches(text:string,index:ReadonlyMap<string,ResearchReferenceTarget>):ResearchReferenceMatch[]{
  const pattern=/(?<![A-Za-z0-9_])(?:(Eq(?:uation)?s?\.?|Figs?\.?|Figures?|Tables?|Tabs?\.?|Sections?|Secs?\.?)\s*|(?:(公式|式|图|表|章节|节))\s*)[（(]?\s*(\d{1,4}(?:\.\d{1,2}){0,3}[a-z]?)\s*[)）]?/giu;
  const matches:ResearchReferenceMatch[]=[];
  for(const match of text.matchAll(pattern)){
    const end=match.index+match[0].trimEnd().length;
    if(/[A-Za-z0-9_]/u.test(text[end]??''))continue;
    // A range/list must not misleadingly navigate only its first number.
    if(/^\s*(?:[-–—,，、]|and\b|to\b|至|和)\s*\(?\d/iu.test(text.slice(end)))continue;
    const target=index.get(key(kindOf(match[1]??match[2]!),match[3]!));
    if(target)matches.push({start:match.index,end,target});
  }
  for(const match of text.matchAll(/第\s*(\d{1,2}(?:\.\d{1,2}){0,3})\s*[章节]/gu)){
    const target=index.get(key('section',match[1]!));
    if(target)matches.push({start:match.index,end:match.index+match[0].length,target});
  }
  return matches.sort((a,b)=>a.start-b.start);
}
