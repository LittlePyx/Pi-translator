import type {PDFPageProxy,TextContent,TextItem} from 'pdfjs-dist/types/src/display/api';
import {formulaDocumentParts,type FormulaDocument} from '../translation/formula-document';
import {renderLatexMathMl} from '../translation/latex-mathml';
import {mathMlFontVariants} from '../translation/mathml-font-variants';
export interface PdfMathFontHint {letter:string;variant:'script'|'double-struck'|'bold'|'bold-italic'}
export function validPdfMathFontHints(value:unknown):value is PdfMathFontHint[]|undefined{
  return value===undefined||Array.isArray(value)&&value.length<=104&&value.every(v=>v&&typeof v==='object'&&
    Object.keys(v).every(k=>['letter','variant'].includes(k))&&typeof v.letter==='string'&&/^[A-Z]$/u.test(v.letter)&&['script','double-struck','bold','bold-italic'].includes(v.variant));
}
/** Upright single Latin glyphs in loaded standard TeX faces with their
 * original ASCII slots; unknown or substituted faces remain unknown. */
export async function pdfNativeMathFontHints(page:PDFPageProxy,content:TextContent,ops:{setFont:number;showText:number;save:number;restore:number;setGState:number}):Promise<Map<TextItem,PdfMathFontHint>>{
  const result=new Map<TextItem,PdfMathFontHint>();
  const candidates=content.items.filter((i):i is TextItem=>'str'in i&&/^[A-Z]$/u.test(i.str)&&Math.abs(i.transform[1]!)<.001&&Math.abs(i.transform[2]!)<.001);
  if(!candidates.length)return result;
  try{
    const list=await page.getOperatorList(),slots=new Map<string,Set<string>>(),stack:string[]=[];let face='';
    for(let i=0;i<list.fnArray.length;i++){
      const fn=list.fnArray[i],args=list.argsArray[i];
      if(fn===ops.save)stack.push(face);if(fn===ops.restore)face=stack.pop()??'';
      if(fn===ops.setFont)face=args[0];if(fn===ops.setGState)for(const state of args[0])if(state[0]==='Font')face=state[1][0];
      if(fn===ops.showText)for(const glyph of args[0])if(glyph?.isInFont&&/^[A-Z]$/u.test(glyph.unicode)&&glyph.originalCharCode===glyph.unicode.charCodeAt(0)){
        const known=slots.get(face)??new Set<string>();known.add(glyph.unicode);slots.set(face,known);
      }
    }
    for(const item of candidates){
      const font=page.commonObjs.get(item.fontName) as {name:string;missingFile:boolean};
      const family=/^(?:[A-Z]{6}\+)?(CMSY|MSBM|CMBX|CMMIB)\d{1,2}$/iu.exec(font?.name??'')?.[1]?.toUpperCase();
      if(!font||font.missingFile||!family||!slots.get(item.fontName)?.has(item.str))continue;
      result.set(item,{letter:item.str,variant:family==='CMSY'?'script':family==='MSBM'?'double-struck':family==='CMBX'?'bold':'bold-italic'});
    }
  }catch{/* Unsupported font evidence cannot justify guessing a style. */}
  return result;
}
export function pdfFontHintText(text:string,hints:readonly PdfMathFontHint[]|undefined):string{
  return hints?.length?`[本地字体证据，仅辅助原图，不是正文] ${JSON.stringify(hints)}\n${text}`:text;
}
/** Presence only, not a pixel/font-family proof. A letter with multiple
 * observed styles stays unchecked; existing formula checks remain strict. */
export function pdfMathFontIssues(hints:readonly PdfMathFontHint[]|undefined,doc:FormulaDocument):string[]{
  if(!hints?.length)return [];
  const html=formulaDocumentParts(doc,true).flatMap(p=>'formula'in p?[renderLatexMathMl(p.formula.latex,p.formula.display)??'']:[]).join('').replace(/<annotation[\s\S]*?<\/annotation>/gu,'');
  return hints.filter((h,i)=>hints.findIndex(other=>other.letter===h.letter&&other.variant===h.variant)===i&&
    hints.every(other=>other.letter!==h.letter||other.variant===h.variant)).flatMap(h=>{
      const glyph=mathMlFontVariants(`<mi mathvariant="${h.variant}">${h.letter}</mi>`).replace(/<[^>]*>/gu,'');
      const label={'script':'花体','double-struck':'黑板体','bold':'粗体直立','bold-italic':'粗斜体'}[h.variant];
      return html.includes(glyph)?[]:[`原文字体未保留：${h.letter}（${label}）`];
    });
}
