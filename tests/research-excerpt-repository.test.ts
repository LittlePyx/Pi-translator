import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {listResearchExcerpts,filterResearchExcerpts,updateResearchExcerptCitation,removeResearchExcerpt} from '../core/content/research-excerpt-repository';
import {PDF_TRANSLATION_MARKERS_KEY,savePdfTranslationMarkers,getPdfTranslationMarkerState} from '../core/pdf/translation-marker-repository';
import {saveWebExcerpt} from '../core/content/web-excerpt-repository';
import {pdfReadingStateId} from '../core/pdf/reading-state';
const stored:Record<string,any>={};
const marker={markerId:'same-id',anchor:{kind:'text-quote' as const,pageNumber:3,sourceText:'Original $E=mc^2$',prefix:'',suffix:''},content:{sourceTitle:'Paper',originalText:'Original $E=mc^2$',translatedText:'译文 $E=mc^2$',note:'旧笔记',pageNumber:3},createdAt:1};
beforeEach(()=>{for(const key of Object.keys(stored))delete stored[key];vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(stored[key])})),set:vi.fn(async(values:Record<string,unknown>)=>Object.assign(stored,structuredClone(values)))}}})});
afterEach(()=>vi.unstubAllGlobals());
describe('one research excerpt library backed by existing records',()=>{
  it('lists both sources without rewriting any data and exports authoritative PDF page context',async()=>{
    await savePdfTranslationMarkers('paper',[marker]);
    await saveWebExcerpt({markerId:'same-id',pageUrl:'https://example.org/paper',anchor:{sourceText:'Web source',prefix:'',suffix:''},content:{sourceTitle:'Web',originalText:'Web source',translatedText:'网页译文'},createdAt:1,updatedAt:2});
    const before=structuredClone(stored),items=await listResearchExcerpts();expect(items).toHaveLength(2);expect(new Set(items.map(i=>i.id)).size).toBe(2);expect(stored).toEqual(before);
    expect(filterResearchExcerpts(items,'','pdf')).toHaveLength(1);expect(filterResearchExcerpts(items,'第 3 页')[0]?.kind).toBe('pdf');expect(filterResearchExcerpts(items,'web','web')).toHaveLength(1);
  });
  it('changes only citation fields, keeps siblings and formulas, and rejects stale/deleted edits',async()=>{
    await savePdfTranslationMarkers('paper',[marker,{...marker,markerId:'second',anchor:{...marker.anchor,pageNumber:4},content:{...marker.content,pageNumber:4}}]);
    const item=(await listResearchExcerpts()).find(i=>i.markerId==='same-id')!;
    const id=await pdfReadingStateId('paper'),sibling=structuredClone(stored[PDF_TRANSLATION_MARKERS_KEY][id].markers.find((m:any)=>m.markerId==='second'));
    await updateResearchExcerptCitation(item,{sourceTitle:'确认的题名',doi:'https://doi.org/10.1000/demo',note:'新的研究笔记'});
    const changed=(await listResearchExcerpts()).find(i=>i.markerId==='same-id')!;
    expect(changed.content).toMatchObject({sourceTitle:'确认的题名',doi:'10.1000/demo',translatedText:marker.content.translatedText,originalText:marker.content.originalText,pageNumber:3});
    expect(stored[PDF_TRANSLATION_MARKERS_KEY][id].markers.find((m:any)=>m.markerId==='second')).toEqual(sibling);
    const before=structuredClone(stored);await expect(updateResearchExcerptCitation(item,{sourceTitle:'旧表单'})).rejects.toThrow('其他窗口');expect(stored).toEqual(before);
    await removeResearchExcerpt(changed);await expect(updateResearchExcerptCitation(changed,{sourceTitle:'已删除'})).rejects.toThrow('删除');expect((await listResearchExcerpts()).map(i=>i.markerId)).toEqual(['second']);
  });
  it('retains notes when an old PDF reader tries to save its stale marker array',async()=>{
    const before=await savePdfTranslationMarkers('paper',[marker]);const item=(await listResearchExcerpts())[0]!;
    await updateResearchExcerptCitation(item,{sourceTitle:'Paper',note:'新笔记'});
    await expect(savePdfTranslationMarkers('paper',[marker],before.markers)).rejects.toThrow('其他窗口');
    expect((await getPdfTranslationMarkerState('paper')).markers[0]?.content.note).toBe('新笔记');
  });
  it('keeps the saved record when storage fails or a citation is invalid',async()=>{
    await savePdfTranslationMarkers('paper',[marker]);const item=(await listResearchExcerpts())[0]!,before=structuredClone(stored);
    await expect(updateResearchExcerptCitation(item,{sourceTitle:'Paper',sourceUrl:'javascript:alert(1)'})).rejects.toThrow('HTTP');
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('空间不足'));
    await expect(updateResearchExcerptCitation(item,{sourceTitle:'Paper',note:'未保存草稿'})).rejects.toThrow('空间不足');expect(stored).toEqual(before);
  });
});
