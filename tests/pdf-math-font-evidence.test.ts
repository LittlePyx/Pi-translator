import {describe,it,expect,vi} from 'vitest';
import type {PDFPageProxy,TextContent,TextItem} from 'pdfjs-dist/types/src/display/api';
import {pdfNativeMathFontHints,pdfMathFontIssues,validPdfMathFontHints,pdfFontHintText} from '../core/pdf/math-font-evidence';
import {parseFormulaDocument} from '../core/translation/formula-document';
import {pdfBackgroundVisualOutcome} from '../core/pdf/background-document-translation';
const ops={setFont:37,showText:44,save:10,restore:11,setGState:9};
const item={str:'F',fontName:'face',transform:[10,0,0,10,100,100],width:7,height:10,dir:'ltr',hasEOL:false} satisfies TextItem;
describe('native mathematical font evidence',()=>{
  it.each([['CMSY10','script'],['MSBM10','double-struck'],['CMBX10','bold'],['CMMIB10','bold-italic']])('retains the original slot and loaded %s face without rewriting PDF text',async(name,variant)=>{
    const page={getOperatorList:vi.fn(async()=>({fnArray:[ops.setFont,ops.showText],argsArray:[['face',10],[[{unicode:'F',originalCharCode:70,isInFont:true}]]]})),commonObjs:{get:()=>({name:'ABCDEF+'+name,missingFile:false})}} as unknown as PDFPageProxy;
    const content={items:[item],styles:{},lang:null} satisfies TextContent;
    expect((await pdfNativeMathFontHints(page,content,ops)).get(item)).toEqual({letter:'F',variant});expect(item.str).toBe('F');
  });
  it.each(['unknown-font','missing-file','wrong-slot','rotated'])('does not invent evidence from %s',async mode=>{
    const page={getOperatorList:vi.fn(async()=>({fnArray:[ops.setFont,ops.showText],argsArray:[['face',10],[[{unicode:'F',originalCharCode:mode==='wrong-slot'?71:70,isInFont:true}]]]})),commonObjs:{get:()=>({name:mode==='unknown-font'?'Arial':'CMSY10',missingFile:mode==='missing-file'})}} as unknown as PDFPageProxy;
    const text=mode==='rotated'?{...item,transform:[0,10,-10,0,100,100]}:item;
    expect((await pdfNativeMathFontHints(page,{items:[text],styles:{},lang:null} as TextContent,ops)).size).toBe(0);
  });
  it('catches the actual plain-F downgrade even when registration counts pass, while allowing nested accents and explicit styles',()=>{
    const hints=[{letter:'F',variant:'bold' as const},{letter:'E',variant:'double-struck' as const},{letter:'N',variant:'script' as const}];
    const make=(latex:string)=>parseFormulaDocument({formulas:[{id:'m1',display:false,latex}],recognizedText:'The expression is {{m1}}.',translation:'表达式为 {{m1}}。'});
    expect(pdfMathFontIssues(hints,make('F+E+N'))).toHaveLength(3);
    expect(pdfMathFontIssues(hints,make(String.raw`\widehat{\mathbf{F}}+\mathbb{E}+\mathcal{N}`))).toEqual([]);
    const outcome=pdfBackgroundVisualOutcome({id:'demo',text:'The expression is F plus E plus N.',containsFormula:true,visualPurpose:'document',sourceFontHints:hints},{formulaDocument:make('F+E+N')},'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('原文字体未保留');expect(outcome.visualProcessed).toBe(false);
    expect(pdfMathFontIssues([{letter:'F',variant:'bold'},{letter:'F',variant:'script'}],make('F'))).toEqual([]);
    expect(validPdfMathFontHints([{letter:'FF',variant:'bold'}])).toBe(false);expect(validPdfMathFontHints([{letter:'F',variant:'unknown'}])).toBe(false);
    expect(pdfFontHintText('Original text',hints)).toContain('不是正文');
  });
});
