import {createManualCorrectionDraft,createManualCorrectionSession,validateManualCorrectionText} from '../translation/manual-correction';
import {formulaDocumentText,type FormulaDocument} from '../translation/formula-document';

export interface PdfCorrectionPart {id:string;kind:'text'|'locked';text:string;label?:string}
export interface PdfCorrectionValue {translatedText:string;formulaDocument?:FormulaDocument}
/** References, malformed reviewed formula entries and ordinary TeX stay read-only. */
export function pdfCorrectionParts(value:PdfCorrectionValue):PdfCorrectionPart[]{
  const template=value.formulaDocument?.translationTemplate??value.translatedText;
  const parts:PdfCorrectionPart[]=[];
  for(const token of template.split(/(\{\{m[1-9]\d{0,2}\}\})/gu)){
    if(!token)continue;
    if(/^\{\{m[1-9]\d{0,2}\}\}$/u.test(token)){
      const formula=value.formulaDocument?.formulas.find(item=>`{{${item.id}}}`===token);
      parts.push({id:`part-${parts.length}`,kind:'locked',text:token,label:formula?.latex??token});
    }else if(!token.trim()){
      parts.push({id:`part-${parts.length}`,kind:'text',text:token});
    }else{
      const draft=createManualCorrectionDraft(createManualCorrectionSession({translatedText:token}));
      for(const part of draft.parts)parts.push({id:`part-${parts.length}`,kind:part.kind==='text'?'text':'locked',text:part.text});
    }
  }
  return parts;
}
export function applyPdfParagraphCorrection(value:PdfCorrectionValue,edits:ReadonlyMap<string,string>):PdfCorrectionValue{
  const parts=pdfCorrectionParts(value);
  for(const [id,text] of edits){
    if(!parts.some(part=>part.id===id&&part.kind==='text'))throw new Error('公式和命令不可修改。');
    if(/\{\{m\d+\}\}/u.test(text))throw new Error('自然语言中不能加入公式引用。');
  }
  const template=parts.map(part=>part.kind==='text'?(edits.get(part.id)??part.text):part.text).join('');
  const formulaDocument=value.formulaDocument?{...value.formulaDocument,translationTemplate:template}:undefined;
  const translatedText=formulaDocument?formulaDocumentText(formulaDocument):template;
  validateManualCorrectionText(value.formulaDocument?formulaDocumentText(value.formulaDocument):value.translatedText,translatedText);
  return {translatedText,...(formulaDocument?{formulaDocument}:{})};
}
