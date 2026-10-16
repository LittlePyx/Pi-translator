import {describe,expect,it,vi} from 'vitest';
import type {PDFPageProxy,TextContent,TextItem} from 'pdfjs-dist/types/src/display/api';
import {pdfLeftBraceGlyphMetrics} from '../core/pdf/tex-font-glyphs';

const ops={setFont:37,showText:44,save:10,restore:11,setGState:9};
const item={str:'(',fontName:'extension',transform:[10,0,0,10,100,100],width:8.056,height:10,dir:'ltr',hasEOL:false} satisfies TextItem;
const glyph={unicode:'(',originalCharCode:40,width:805.6,isInFont:true};
const font={name:'ABCDEF+CMEX10',missingFile:false};
const content={items:[item],styles:{extension:{ascent:.04,descent:-.6,fontFamily:'sans-serif',vertical:false}},lang:null} satisfies TextContent;
const page=(rows: [number,unknown[]][],face=font)=>({getOperatorList:vi.fn(async()=>({fnArray:rows.map(row=>row[0]),argsArray:rows.map(row=>row[1])})),commonObjs:{get:()=>face}} as unknown as PDFPageProxy);

describe('embedded TeX delimiter evidence',()=>{
  it('uses the original CMEX10 slot and AFM ink instead of its broken parenthesis Unicode',async()=>{
    const source=page([[ops.setFont,['extension',10]],[ops.showText,[[glyph]]]]);
    const result=await pdfLeftBraceGlyphMetrics(source,content,ops);
    expect(result.get(item)).toEqual({ascent:.039,descent:2.959});
    expect(item.str).toBe('(');
  });
  it.each(['ordinary-font','large-parenthesis-slot','wrong-width','missing-font','missing-glyph','ambiguous','rotated'])(
    'does not infer a curly brace from %s',async mode=>{
      const face={...font},entry={...glyph},text={...item};
      if(mode==='ordinary-font')face.name='ABCDEF+CMR10';
      if(mode==='large-parenthesis-slot')entry.originalCharCode=32;
      if(mode==='wrong-width')entry.width=700;
      if(mode==='missing-font')face.missingFile=true;
      if(mode==='missing-glyph')entry.isInFont=false;
      if(mode==='rotated')text.transform=[0,10,-10,0,100,100];
      const source=page([[ops.setFont,['extension',10]],[ops.showText,[[entry,...(mode==='ambiguous'?[{...entry,originalCharCode:32}]:[])]]]],face);
      expect((await pdfLeftBraceGlyphMetrics(source,{...content,items:[text]},ops)).size).toBe(0);
    });
  it('tracks font save/restore and graphics-state font changes',async()=>{
    const source=page([[ops.setGState,[[['Font',['extension',10]]]]],[ops.save,[]],[ops.setFont,['ordinary',10]],
      [ops.showText,[[{...glyph,originalCharCode:32}]]],[ops.restore,[]],[ops.showText,[[glyph]]]]);
    expect((await pdfLeftBraceGlyphMetrics(source,content,ops)).size).toBe(1);
  });
  it('does not load drawing operators for ordinary text fonts and tolerates unavailable evidence',async()=>{
    const source=page([]);
    expect((await pdfLeftBraceGlyphMetrics(source,{...content,styles:{extension:{...content.styles.extension!,ascent:.7}}},ops)).size).toBe(0);
    expect(source.getOperatorList).not.toHaveBeenCalled();
    vi.mocked(source.getOperatorList).mockRejectedValueOnce(new Error('Font unavailable'));
    expect((await pdfLeftBraceGlyphMetrics(source,content,ops)).size).toBe(0);
  });
});
