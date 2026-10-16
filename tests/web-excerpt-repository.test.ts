import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {saveWebExcerpt,listWebExcerpts,removeWebExcerpt,updateWebExcerptCitation,filterWebExcerpts,WEB_EXCERPTS_KEY,webExcerptPageUrl,type WebExcerpt} from '../core/content/web-excerpt-repository';
import {exportDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';
import {isRuntimeMessage} from '../core/messaging/messages';
const stored:Record<string,unknown>={};
const excerpt=(index=0):WebExcerpt=>({markerId:`excerpt-${index}`,pageUrl:'https://example.org/paper?b=2&a=1#section',anchor:{sourceText:`Source ${index}`,prefix:'Before ',suffix:' after'},content:{sourceTitle:'演示文本论文',sourceUrl:'https://example.org/paper',originalText:`Source ${index}`,translatedText:`演示文本译文 ${index}`,note:'检查实验条件'},createdAt:1,updatedAt:2});
beforeEach(()=>{for(const key of Object.keys(stored))delete stored[key];vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(keys:string|string[]|null)=>keys===null?structuredClone(stored):Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(stored[key])]))),set:vi.fn(async(values:Record<string,unknown>)=>Object.assign(stored,structuredClone(values))),remove:vi.fn(async(key:string)=>delete stored[key])}}})});
afterEach(()=>vi.unstubAllGlobals());
describe('explicitly retained webpage excerpts',()=>{
  it('edits citation metadata without losing a newer translation, and refuses stale or deleted notes',async()=>{
    await saveWebExcerpt(excerpt());const initial=(await listWebExcerpts())[0]!;
    await saveWebExcerpt({...initial,updatedAt:3,content:{...initial.content,translatedText:'新的可靠译文 $\\mathbb{R}$'}});
    await updateWebExcerptCitation(initial,{sourceTitle:'修订出处',sourceUrl:'https://doi.org/10.1000/demo',doi:'https://doi.org/10.1000/demo',note:'新笔记'});
    const updated=(await listWebExcerpts())[0]!;expect(updated.content).toMatchObject({translatedText:'新的可靠译文 $\\mathbb{R}$',note:'新笔记',doi:'10.1000/demo'});expect(updated.anchor).toEqual(initial.anchor);expect(updated.createdAt).toBe(initial.createdAt);expect(updated.updatedAt).toBeGreaterThan(3);
    const before=structuredClone(stored);await expect(updateWebExcerptCitation(initial,{sourceTitle:'旧表单',note:'不得覆盖'})).rejects.toThrow('其他窗口');expect(stored).toEqual(before);
    await removeWebExcerpt(updated.pageUrl,updated.markerId);await expect(updateWebExcerptCitation(updated,{sourceTitle:'不可复活'})).rejects.toThrow('删除');expect(await listWebExcerpts()).toEqual([]);
  });
  it('keeps stored data on invalid citation and storage failures, and filters all saved citation fields',async()=>{
    await saveWebExcerpt(excerpt());const item=(await listWebExcerpts())[0]!,before=structuredClone(stored);
    await expect(updateWebExcerptCitation(item,{sourceTitle:'标题',sourceUrl:'javascript:alert(1)'})).rejects.toThrow('HTTP');expect(stored).toEqual(before);
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('空间不足'));
    await expect(updateWebExcerptCitation(item,{sourceTitle:'修改',note:'不能丢失'})).rejects.toThrow('空间不足');expect(stored).toEqual(before);
    await updateWebExcerptCitation(item,{sourceTitle:'修改',note:'不能丢失',doi:'10.1000/example',sourceUrl:'https://source.example/paper'});
    const records=await listWebExcerpts();for(const query of ['  EXAMPLE  ','source.example','不能丢失','source 0','演示文本译文'])expect(filterWebExcerpts(records,query)).toHaveLength(1);expect(filterWebExcerpts(records,'不存在')).toHaveLength(0);
  });
  it('retains citation, original quote, translation and note across reload, keyed by canonical page',async()=>{
    await saveWebExcerpt(excerpt());expect(await listWebExcerpts('https://example.org/paper?a=1&b=2&utm_source=demo')).toHaveLength(1);
    await saveWebExcerpt({...excerpt(),markerId:'new-id',updatedAt:3,content:{...excerpt().content,note:'后来修正的笔记'}});expect(await listWebExcerpts()).toHaveLength(1);expect((await listWebExcerpts())[0]?.content.note).toBe('后来修正的笔记');
    await removeWebExcerpt(excerpt().pageUrl,'new-id');expect(await listWebExcerpts()).toEqual([]);
  });
  it('round trips through v3 backup and keeps newer local notes on older import',async()=>{
    await saveWebExcerpt(excerpt());const backup=await exportDocumentLibraryBackup();expect(JSON.parse(backup).version).toBe(3);
    await saveWebExcerpt({...excerpt(),updatedAt:20,content:{...excerpt().content,note:'本机较新笔记'}});await importDocumentLibraryBackup(backup);expect((await listWebExcerpts())[0]?.content.note).toBe('本机较新笔记');
    delete stored[WEB_EXCERPTS_KEY];await importDocumentLibraryBackup(backup);expect((await listWebExcerpts())[0]?.content.originalText).toBe('Source 0');
    const invalid=JSON.parse(backup),key=Object.keys(invalid.webExcerpts)[0]!;invalid.webExcerpts['a'.repeat(32)]=invalid.webExcerpts[key];delete invalid.webExcerpts[key];const before=structuredClone(stored);
    await expect(importDocumentLibraryBackup(JSON.stringify(invalid))).rejects.toThrow('标识');expect(stored).toEqual(before);
    expect(isRuntimeMessage({type:'SAVE_WEB_EXCERPT',payload:{pageUrl:excerpt().pageUrl}})).toBe(false);
  });
  it('rejects over-capacity and unsafe input without evicting saved work, and still imports old backups',async()=>{
    const id=createHash('sha256').update(webExcerptPageUrl(excerpt().pageUrl)).digest('hex').slice(0,32);stored[WEB_EXCERPTS_KEY]={[id]:Array.from({length:100},(_,i)=>({...excerpt(i),pageUrl:webExcerptPageUrl(excerpt().pageUrl)}))};
    const before=structuredClone(stored);await expect(saveWebExcerpt(excerpt(101))).rejects.toThrow('100');expect(stored).toEqual(before);
    await expect(saveWebExcerpt({...excerpt(),pageUrl:'javascript:alert(1)'})).rejects.toThrow('HTTP');expect(stored).toEqual(before);
    await importDocumentLibraryBackup(JSON.stringify({format:'pi-translator-document-library',version:1,documents:[]}));expect(await listWebExcerpts()).toHaveLength(100);
  });
});
