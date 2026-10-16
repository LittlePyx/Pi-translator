import {pdfCorrectionParts,applyPdfParagraphCorrection,type PdfCorrectionValue} from './document-correction';
export interface ConfirmedPdfTerm {source:string;target:string}
export interface TermCheckBlock extends PdfCorrectionValue {id:string;pageNumber:number;text:string;manualCorrection?:true;referencePreserved?:boolean;formulaReviewDraft?:true;status:string;included:boolean}
export interface PdfTermCandidate {blockId:string;source:string;target:string;context:string;protected:boolean}
const normalized=(text:string)=>text.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase();
export function containsPdfTerm(text:string,term:string):boolean{
  const haystack=normalized(text),needle=normalized(term);if(!needle)return false;
  const word=/^[\p{Script=Latin}\p{N}_]/u.test(needle)||/[\p{Script=Latin}\p{N}_]$/u.test(needle);
  for(let index=haystack.indexOf(needle);index>=0;index=haystack.indexOf(needle,index+1)){
    if(!word||(!/[\p{L}\p{N}_]/u.test(haystack[index-1]??'')&&!/[\p{L}\p{N}_]/u.test(haystack[index+needle.length]??'')))return true;
  }return false;
}
export function checkPdfTermConsistency(blocks:readonly TermCheckBlock[],terms:readonly ConfirmedPdfTerm[],maximum=200):PdfTermCandidate[]{
  const result:PdfTermCandidate[]=[];
  const unique=[...new Map(terms.filter(term=>term.source.trim()&&term.target.trim()).map(term=>[normalized(term.source),term])).values()];
  for(const block of blocks){
    if(!block.included||block.status!=='done'||block.referencePreserved||block.formulaReviewDraft)continue;
    const source=pdfCorrectionParts({translatedText:block.text}).filter(part=>part.kind==='text').map(part=>part.text).join(' ').normalize('NFKC').replace(/\s+/gu,' ').trim();
    const target=pdfCorrectionParts(block).filter(part=>part.kind==='text').map(part=>part.text).join(' ');
    for(const term of unique){
      if(!containsPdfTerm(source,term.source)||containsPdfTerm(target,term.target))continue;
      const at=normalized(source).indexOf(normalized(term.source));
      result.push({blockId:block.id,source:term.source,target:term.target,context:source.slice(Math.max(0,at-160),Math.max(0,at-160)+800),protected:Boolean(block.manualCorrection)});
      if(result.length>=maximum)return result;
    }
  }return result;
}
/** Only user-specified wording inside editable prose may be replaced. */
export function previewPdfTermCorrection(value:PdfCorrectionValue,from:string,to:string):PdfCorrectionValue{
  if(!from.trim()||!to.trim()||from===to||from.length>120||to.length>120)throw new Error('请填写需要替换的现有译法和建议译法（各不超过 120 字符）。');
  const edits=new Map<string,string>();
  for(const part of pdfCorrectionParts(value)){
    if(part.kind!=='text')continue;
    const escaped=from.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    const pattern=new RegExp(/^[A-Za-z0-9_]|[A-Za-z0-9_]$/u.test(from)?`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`:escaped,'giu');
    const changed=part.text.replace(pattern,()=>to);if(changed!==part.text)edits.set(part.id,changed);
  }
  if(!edits.size)throw new Error('未在本段可编辑文字中找到该译法；公式和命令不会参与替换。');
  return applyPdfParagraphCorrection(value,edits);
}
