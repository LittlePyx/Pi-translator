import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PDF_READING_ANNOTATIONS_KEY,validatePdfReadingAnnotationMap,mergePdfReadingAnnotationMaps,getPdfReadingAnnotations,mutatePdfReadingAnnotation,pdfReadingAnnotationText,type PdfReadingAnnotation} from '../core/pdf/reading-annotation-repository';
import {pdfReadingStateId} from '../core/pdf/reading-state';
import {listResearchExcerpts,updateResearchExcerptCitation,removeResearchExcerpt} from '../core/content/research-excerpt-repository';
import {buildTranslationMarkerMarkdown} from '../core/content/session-translation-markers';
import {exportDocumentLibraryBackup,previewDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';
const stored:Record<string,any>={};
const annotation=(id='first'):PdfReadingAnnotation=>({id,kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Original $E=mc^2$',prefix:'Before ',suffix:' after'},sourceTitle:'Paper',note:'原笔记',createdAt:1,updatedAt:2});
beforeEach(()=>{
  for(const key of Object.keys(stored))delete stored[key];
  vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(stored[key])]))),set:vi.fn(async(values:Record<string,unknown>)=>Object.assign(stored,structuredClone(values)))}}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('independent PDF reading annotations',()=>{
  const across=():PdfReadingAnnotation=>({...annotation(),continuations:[{kind:'text-quote',pageNumber:3,sourceText:'Continuation with $\\alpha$ intact',prefix:'',suffix:' after'}]});
  it('keeps every cross-page source and formula in search, note editing, Markdown and version 5 backup',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,across());
    const item=(await listResearchExcerpts())[0]!;expect(item.content.originalText).toBe(pdfReadingAnnotationText(across()));expect(item.content.endPageNumber).toBe(3);
    expect(buildTranslationMarkerMarkdown([item.content])).toContain('第 2–3 页');expect(buildTranslationMarkerMarkdown([item.content])).toContain('$\\alpha$');
    await updateResearchExcerptCitation(item,{sourceTitle:'Paper',note:'Edited whole cross-page note'});const edited=await getPdfReadingAnnotations('content');expect(edited[0]?.continuations).toEqual(across().continuations);
    const text=await exportDocumentLibraryBackup();expect(JSON.parse(text).version).toBe(5);const snapshot=structuredClone(stored);delete stored[PDF_READING_ANNOTATIONS_KEY];
    const preview=await previewDocumentLibraryBackup(text);expect(preview.annotationCount).toBe(1);await importDocumentLibraryBackup(text,preview.token);expect(stored[PDF_READING_ANNOTATIONS_KEY]).toEqual(snapshot[PDF_READING_ANNOTATIONS_KEY]);
  });
  it('rejects reordered, missing, oversized and mutable continuation anchors without altering old notes',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,across());const before=structuredClone(stored);
    for(const continuations of [[],[{...across().continuations![0]!,pageNumber:2}],[{...across().continuations![0]!,pageNumber:4}],[{...across().continuations![0]!,sourceText:'x'.repeat(3999)}]])await expect(mutatePdfReadingAnnotation(id,{...across(),id:'new',continuations})).rejects.toThrow();
    await expect(mutatePdfReadingAnnotation(id,{...across(),continuations:[{...across().continuations![0]!,sourceText:'replaced'}]},across())).rejects.toThrow();expect(stored).toEqual(before);
    const backup=JSON.parse(await exportDocumentLibraryBackup());backup.version=4;await expect(importDocumentLibraryBackup(JSON.stringify(backup))).rejects.toThrow('版本 5');expect(stored).toEqual(before);
  });
  it('saves an original-only highlight and shares it with the excerpt library without fabricating a translation',async()=>{
    await mutatePdfReadingAnnotation(await pdfReadingStateId('content'),annotation());
    expect(await getPdfReadingAnnotations('content')).toEqual([annotation()]);
    const item=(await listResearchExcerpts())[0]!;expect(item.kind).toBe('pdf');expect(item.content.translatedText).toBeUndefined();
    expect(item.content.originalText).toBe('Original $E=mc^2$');
    const md=buildTranslationMarkerMarkdown([item.content]);expect(md).toContain('> Original $E=mc^2$');expect(md).toContain('个人笔记');expect(md).not.toContain('undefined');
  });
  it('edits one note, keeps siblings, and refuses stale update and deletion',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,annotation());await mutatePdfReadingAnnotation(id,annotation('sibling'));
    const first=(await listResearchExcerpts()).find(item=>item.markerId==='first')!;
    await updateResearchExcerptCitation(first,{sourceTitle:'Confirmed title',note:'new note'});
    const snapshot=structuredClone(stored);await expect(removeResearchExcerpt(first)).rejects.toThrow('其他窗口');expect(stored).toEqual(snapshot);
    const items=await listResearchExcerpts();expect(items.find(item=>item.markerId==='first')?.content.note).toBe('new note');
    expect((await getPdfReadingAnnotations('content')).find(a=>a.id==='sibling')).toEqual(annotation('sibling'));
    await removeResearchExcerpt(items.find(item=>item.markerId==='first')!);expect((await getPdfReadingAnnotations('content')).map(a=>a.id)).toEqual(['sibling']);
  });
  it('retains data when quota or storage fails, with no eviction',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,annotation());const before=structuredClone(stored);
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('disk full'));
    await expect(mutatePdfReadingAnnotation(id,annotation('new'))).rejects.toThrow('disk full');expect(stored).toEqual(before);
    stored[PDF_READING_ANNOTATIONS_KEY][id].annotations=Array.from({length:100},(_,i)=>annotation(String(i)));
    const full=structuredClone(stored);await expect(mutatePdfReadingAnnotation(id,annotation('overflow'))).rejects.toThrow('100');expect(stored).toEqual(full);
  });
  it('keeps source anchors immutable during note editing and serializes sibling writes',async()=>{
    const id=await pdfReadingStateId('content');
    await Promise.all([mutatePdfReadingAnnotation(id,annotation()),mutatePdfReadingAnnotation(id,annotation('parallel'))]);
    expect(await getPdfReadingAnnotations('content')).toHaveLength(2);const before=structuredClone(stored);
    await expect(mutatePdfReadingAnnotation(id,{...annotation(),anchor:{...annotation().anchor,sourceText:'replacement'}},annotation())).rejects.toThrow();expect(stored).toEqual(before);
  });
  it('releases a document slot when the user explicitly deletes its last annotation',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,annotation());await mutatePdfReadingAnnotation(id,undefined,annotation());
    expect(stored[PDF_READING_ANNOTATIONS_KEY]).toEqual({});expect(await getPdfReadingAnnotations('content')).toEqual([]);
  });
  it('rejects invalid anchors, duplicate IDs, and oversized text instead of truncating them',async()=>{
    const id=await pdfReadingStateId('content'),map=(items:unknown[])=>({[id]:{annotations:items,updatedAt:2}});
    expect(()=>validatePdfReadingAnnotationMap(map([annotation(),annotation()]))).toThrow();
    for(const a of [{...annotation(),anchor:{...annotation().anchor,pageNumber:0}},{...annotation(),anchor:{...annotation().anchor,sourceText:'x'.repeat(4001)}},{...annotation(),note:'x'.repeat(2001)},{...annotation(),sourceUrl:'javascript:alert(1)'}])expect(()=>validatePdfReadingAnnotationMap(map([a]))).toThrow();
    expect(()=>validatePdfReadingAnnotationMap([])).toThrow();expect(stored).toEqual({});
  });
  it('unions distinct records while refusing conflicting versions of the same annotation',async()=>{
    const id=await pdfReadingStateId('content'),map=(a:PdfReadingAnnotation)=>({[id]:{annotations:[a],updatedAt:a.updatedAt}});
    expect(mergePdfReadingAnnotationMaps(map(annotation()),map(annotation('new')))[id]?.annotations).toHaveLength(2);
    expect(()=>mergePdfReadingAnnotationMaps(map(annotation()),map({...annotation(),note:'conflict',updatedAt:8}))).toThrow('冲突');
  });
  it('round-trips version 4 through a zero-write preview and counts standalone notes',async()=>{
    await mutatePdfReadingAnnotation(await pdfReadingStateId('content'),annotation());const text=await exportDocumentLibraryBackup(),backup=JSON.parse(text);expect(backup.version).toBe(4);
    delete stored[PDF_READING_ANNOTATIONS_KEY];const before=structuredClone(stored),preview=await previewDocumentLibraryBackup(text);expect(preview.annotationCount).toBe(1);expect(stored).toEqual(before);
    await importDocumentLibraryBackup(text,preview.token);expect(await getPdfReadingAnnotations('content')).toEqual([annotation()]);
  });
  it('preserves annotations when importing every old backup version',async()=>{
    await mutatePdfReadingAnnotation(await pdfReadingStateId('content'),annotation());
    for(const version of [1,2,3]){await importDocumentLibraryBackup(JSON.stringify({format:'pi-translator-document-library',version,documents:[]}));expect(await getPdfReadingAnnotations('content')).toEqual([annotation()])}
  });
  it('refuses a stale import confirmation or invalid annotation before any write',async()=>{
    const text=JSON.stringify({format:'pi-translator-document-library',version:4,documents:[],readingAnnotations:{}}),preview=await previewDocumentLibraryBackup(text);
    await mutatePdfReadingAnnotation(await pdfReadingStateId('content'),annotation());const before=structuredClone(stored);
    await expect(importDocumentLibraryBackup(text,preview.token)).rejects.toThrow('重新预览');expect(stored).toEqual(before);
    await expect(importDocumentLibraryBackup(JSON.stringify({format:'pi-translator-document-library',version:4,documents:[],readingAnnotations:[]}))).rejects.toThrow();expect(stored).toEqual(before);
  });
  it('refuses a conflicting import atomically and keeps the local note',async()=>{
    const id=await pdfReadingStateId('content');await mutatePdfReadingAnnotation(id,annotation());const backup=JSON.parse(await exportDocumentLibraryBackup());
    backup.readingAnnotations[id].annotations[0].note='Different backup note';const before=structuredClone(stored);
    await expect(previewDocumentLibraryBackup(JSON.stringify(backup))).rejects.toThrow('冲突');await expect(importDocumentLibraryBackup(JSON.stringify(backup))).rejects.toThrow('冲突');expect(stored).toEqual(before);
  });
});
