import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {saveWebExcerpt,listWebExcerpts,updateWebExcerptCitation,WEB_EXCERPTS_KEY,type WebExcerpt} from '../core/content/web-excerpt-repository';
import {listResearchExcerpts,removeResearchExcerptWithUndo} from '../core/content/research-excerpt-repository';
import {removeRecentPdfReadingWithUndo,renameRecentPdfReading} from '../core/translation/recent-reading-library';
import {RECENT_PDF_DOCUMENTS_KEY} from '../core/pdf/recent-documents';
import {RECENT_PDF_OVERRIDES_KEY} from '../core/pdf/recent-reading-overrides';
let stored:Record<string,any>;
const excerpt=(id='original'):WebExcerpt=>({markerId:id,pageUrl:'https://example.org/reading',anchor:{sourceText:id,prefix:'',suffix:''},content:{originalText:id,translatedText:'完整译文 $x^2$ '+id,sourceTitle:'固定离线测试',note:'人工笔记'},createdAt:1,updatedAt:2});
beforeEach(()=>{stored={};vi.stubGlobal('browser',{storage:{local:{get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(stored[key])])),set:async(values:Record<string,unknown>)=>{Object.assign(stored,structuredClone(values))}}}})});
afterEach(()=>vi.unstubAllGlobals());
it('restores an exact deleted excerpt and retains sibling changes; refuses a new record for the same quote',async()=>{
  await saveWebExcerpt(excerpt());const item=(await listResearchExcerpts())[0]!,undo=await removeResearchExcerptWithUndo(item);
  await saveWebExcerpt(excerpt('sibling'));await undo();expect(await listWebExcerpts()).toContainEqual(excerpt());expect(await listWebExcerpts()).toHaveLength(2);
  const again=await removeResearchExcerptWithUndo((await listResearchExcerpts()).find(x=>x.markerId==='original')!);
  await saveWebExcerpt({...excerpt(),content:{...excerpt().content,note:'新人工笔记'},updatedAt:9});const before=structuredClone(stored);
  await expect(again()).rejects.toThrow('不会覆盖');expect(stored).toEqual(before);
});
it('refuses stale deletion and capacity overflow without overwriting user work',async()=>{
  await saveWebExcerpt(excerpt());const item=(await listResearchExcerpts())[0]!;
  await updateWebExcerptCitation(excerpt(),{sourceTitle:'新标题',note:'另一个窗口修正'});const before=structuredClone(stored);
  await expect(removeResearchExcerptWithUndo(item)).rejects.toThrow('其他窗口');expect(stored).toEqual(before);
  const undo=await removeResearchExcerptWithUndo((await listResearchExcerpts())[0]!);
  for(let i=0;i<100;i++)await saveWebExcerpt(excerpt('sibling-'+i));const full=structuredClone(stored);
  await expect(undo()).rejects.toThrow('100');expect(stored).toEqual(full);expect(stored[WEB_EXCERPTS_KEY]).toBeDefined();
});
it('undoes only a recent-list override and refuses to overwrite a later rename',async()=>{
  const id='a'.repeat(32);stored[RECENT_PDF_DOCUMENTS_KEY]={[id]:{title:'PDF',updatedAt:1}};stored.userNotes={text:'必须保留'};
  const before=structuredClone(stored),undo=await removeRecentPdfReadingWithUndo(id);expect(stored[RECENT_PDF_OVERRIDES_KEY][id].hidden).toBe(true);const removedAt=stored[RECENT_PDF_OVERRIDES_KEY][id].updatedAt;
  await undo();expect(stored[RECENT_PDF_DOCUMENTS_KEY]).toEqual(before[RECENT_PDF_DOCUMENTS_KEY]);expect(stored.userNotes).toEqual(before.userNotes);expect(stored[RECENT_PDF_OVERRIDES_KEY][id]).toEqual({hidden:false,updatedAt:expect.any(Number)});expect(stored[RECENT_PDF_OVERRIDES_KEY][id].updatedAt).toBeGreaterThan(removedAt);
  const second=await removeRecentPdfReadingWithUndo(id);await renameRecentPdfReading(id,'较新名称');const changed=structuredClone(stored);
  await expect(second()).rejects.toThrow('较新');expect(stored).toEqual(changed);
});
