import {compactFormulaDocument,isFormulaDocument,type FormulaDocument} from '../translation/formula-document';

export interface PdfParagraphValue {
  translatedText:string; formulaDocument?:FormulaDocument; reviewConfirmation?:string;
  formulaReviewMessage?:string; formulaReviewDraft?:true; visualFallbackMessage?:string; manualCorrection?:true;
}
export interface PdfParagraphRevision extends PdfParagraphValue {
  id:string; createdAt:number; reason:'correction'|'translation'|'restore'|'unaccepted'|'import';
}
export interface PdfParagraphHistory extends PdfParagraphValue {revisions?:PdfParagraphRevision[]; retranslation?:true}
export const MAX_PDF_PARAGRAPH_REVISIONS=5;
const valueKeys=['translatedText','formulaDocument','reviewConfirmation','formulaReviewMessage','formulaReviewDraft','visualFallbackMessage','manualCorrection'];
export function paragraphValue(value:PdfParagraphValue):PdfParagraphValue {
  return {translatedText:value.formulaDocument?.translationTemplate??value.translatedText.trim(),
    ...(value.formulaDocument?{formulaDocument:compactFormulaDocument(value.formulaDocument)}:{}),
    ...Object.fromEntries(valueKeys.slice(2).flatMap(key=>value[key as keyof PdfParagraphValue]!==undefined?[[key,value[key as keyof PdfParagraphValue]]]:[]))};
}
export function validParagraphValue(value:unknown):value is PdfParagraphValue {
  if(!value||typeof value!=='object')return false;
  const v=value as Record<string,unknown>;
  return typeof v.translatedText==='string'&&v.translatedText.trim().length>0&&v.translatedText.length<=20_000&&
    (v.formulaDocument===undefined||isFormulaDocument(v.formulaDocument))&&
    (v.manualCorrection===undefined||v.manualCorrection===true)&&
    (v.reviewConfirmation===undefined||typeof v.reviewConfirmation==='string'&&/^review-[a-f0-9]{1,8}$/u.test(v.reviewConfirmation))&&
    (v.formulaReviewDraft===undefined||v.formulaReviewDraft===true&&typeof v.formulaReviewMessage==='string')&&
    ['formulaReviewMessage','visualFallbackMessage'].every(key=>v[key]===undefined||typeof v[key]==='string'&&v[key].trim().length>0&&v[key].length<=2000);
}
export function validParagraphRevision(value:unknown):value is PdfParagraphRevision {
  if(!validParagraphValue(value))return false;
  const v=value as unknown as Record<string,unknown>;
  return Object.keys(v).every(key=>[...valueKeys,'id','createdAt','reason'].includes(key))&&
    typeof v.id==='string'&&/^revision-[a-z0-9-]{1,80}$/u.test(v.id)&&typeof v.createdAt==='number'&&Number.isFinite(v.createdAt)&&
    ['correction','translation','restore','unaccepted','import'].includes(String(v.reason));
}
export function paragraphRevision(value:PdfParagraphValue,reason:PdfParagraphRevision['reason']):PdfParagraphRevision {
  return {...paragraphValue(value),id:`revision-${crypto.randomUUID()}`,createdAt:Date.now(),reason};
}
function paragraphContent(value:PdfParagraphValue):string{
  const {reviewConfirmation:_confirmation,...rest}=paragraphValue(value);
  if(rest.formulaDocument){
    // Restoring a display reference may change its line indentation. This is
    // layout metadata, not a new translation; never normalize the LaTeX itself.
    const displays=new Set(rest.formulaDocument.formulas.filter(formula=>formula.display).map(formula=>formula.id));
    const template=rest.formulaDocument.translationTemplate.replace(/(^|\n)[ \t]+(\{\{([A-Za-z0-9_-]+)\}\})/gu,(match,prefix,reference,id)=>displays.has(id)?prefix+reference:match);
    rest.translatedText=template;rest.formulaDocument={...rest.formulaDocument,translationTemplate:template};
  }
  const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
  return JSON.stringify(ordered(rest));
}
export function withParagraphHistory<T extends PdfParagraphHistory>(previous:PdfParagraphHistory|undefined,next:T,reason:PdfParagraphRevision['reason']='translation'):T & PdfParagraphHistory {
  if(previous?.revisions&&!next.revisions)next={...next,revisions:previous.revisions};
  if(!previous||paragraphContent(previous)===paragraphContent(next))return next;
  const history=next.revisions??previous.revisions??[];
  const before=paragraphValue(previous);
  return {...next,revisions:[...(history[0]&&JSON.stringify(paragraphValue(history[0]))===JSON.stringify(before)?[]:[paragraphRevision(before,reason)]),...history].slice(0,MAX_PDF_PARAGRAPH_REVISIONS)};
}
export function restoredParagraphRevision(current:PdfParagraphHistory,id:string):PdfParagraphHistory {
  const revision=current.revisions?.find(item=>item.id===id);
  if(!revision||revision.reason==='unaccepted')throw new Error('这条版本不可恢复；未通过校验的新结果仅供核对。');
  return withParagraphHistory(current,{...paragraphValue(revision),manualCorrection:true,revisions:current.revisions!},'restore');
}
