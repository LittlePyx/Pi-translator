import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RECENT_PDF_DOCUMENTS_KEY,recentPdfDocuments,updatedRecentPdfDocuments} from '../core/pdf/recent-documents';
import {PDF_READING_STATES_KEY,savePdfReadingState,pdfReadingStateId} from '../core/pdf/reading-state';
import {PDF_READING_ANNOTATIONS_KEY} from '../core/pdf/reading-annotation-repository';
import {listRecentPdfReadings,libraryReadingRows,renameRecentPdfReading,removeRecentPdfReading} from '../core/translation/recent-reading-library';
import {RECENT_PDF_OVERRIDES_KEY,recentPdfOverrides} from '../core/pdf/recent-reading-overrides';
import * as originalFiles from '../core/pdf/original-file-repository';
import type {RetainedLibraryEntry} from '../core/translation/retained-document-library';
import {exportDocumentLibraryBackup,previewDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';
import {isRuntimeMessage} from '../core/messaging/messages';
const stored:Record<string,any>={};
const state={pageNumber:2,pageRatio:.25,zoomLevel:1.25,fitWidth:false,sidebarExpanded:false,updatedAt:200};
const fingerprint='a'.repeat(64);
beforeEach(()=>{
  for(const key of Object.keys(stored))delete stored[key];
  vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(stored[key])]))),set:vi.fn(async(next:Record<string,unknown>)=>Object.assign(stored,structuredClone(next)))}}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('recent reading without translation',()=>{
  it('renames and hides a legacy note-only row without writing its notes, positions or translated work',async()=>{
    const id=await pdfReadingStateId(`pdf-content:${fingerprint}`);
    stored[PDF_READING_ANNOTATIONS_KEY]={[id]:{updatedAt:1,annotations:[{id:'old-note',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Old quote',prefix:'',suffix:''},sourceTitle:'Old title',note:'Manual note',createdAt:1,updatedAt:1}]}};
    stored[PDF_READING_STATES_KEY]={[id]:state};stored.savedWork={translation:'Old {{m1}}',formula:'E=mc^2',manualCorrection:true,revisions:['old','new']};
    const before=structuredClone(stored);
    await Promise.all([renameRecentPdfReading(id,'  Custom reading name  '),removeRecentPdfReading(id)]);
    const { [RECENT_PDF_OVERRIDES_KEY]:override,...protectedValues}=stored;
    expect(protectedValues).toEqual(before);expect(override[id]).toMatchObject({name:'Custom reading name',hidden:true});
    const items=await listRecentPdfReadings();expect(items[0]).toMatchObject({name:'Custom reading name',hidden:true,noteCount:1});expect(libraryReadingRows([],items)).toEqual([]);
    await savePdfReadingState(`pdf-content:${fingerprint}`,{...state,updatedAt:300},{title:'Renamed file.pdf',pageCount:2});
    expect(libraryReadingRows([],await listRecentPdfReadings())).toEqual([]);
    await savePdfReadingState(`pdf-content:${fingerprint}`,{...state,updatedAt:400},{title:'Renamed file.pdf',pageCount:2},true);
    const visible=await listRecentPdfReadings();expect(visible[0]).toMatchObject({name:'Custom reading name',noteCount:1});expect(visible[0]?.hidden).toBeUndefined();expect(libraryReadingRows([],visible)).toHaveLength(1);
    expect(stored[PDF_READING_ANNOTATIONS_KEY]).toEqual(before[PDF_READING_ANNOTATIONS_KEY]);expect(stored.savedWork).toEqual(before.savedWork);
  });
  it('keeps all data on invalid, stale-source and failed list actions, and validates explicit reopen messages',async()=>{
    const id=await pdfReadingStateId(`pdf-content:${fingerprint}`);
    stored[RECENT_PDF_DOCUMENTS_KEY]={[id]:{title:'Paper',updatedAt:1}};const before=structuredClone(stored);
    for(const name of ['',' '.repeat(4),'x'.repeat(121)])await expect(renameRecentPdfReading(id,name)).rejects.toThrow('1–120');
    const copies=vi.spyOn(originalFiles,'listOriginalPdfs');copies.mockResolvedValueOnce([]);
    await expect(removeRecentPdfReading('b'.repeat(32))).rejects.toThrow('已移除');expect(stored).toEqual(before);
    copies.mockRejectedValueOnce(new Error('Injected copy storage failure'));
    await expect(removeRecentPdfReading('b'.repeat(32))).rejects.toThrow('原 PDF 副本暂时无法读取');expect(stored).toEqual(before);copies.mockRestore();
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('Disk full'));await expect(removeRecentPdfReading(id)).rejects.toThrow('Disk full');expect(stored).toEqual(before);
    expect(()=>recentPdfOverrides({[id]:{hidden:true,updatedAt:1,url:'https://example.org'}})).toThrow();
    expect(isRuntimeMessage({type:'SAVE_PDF_READING_STATE',payload:{fingerprint,state,document:{title:'Paper'},opened:true}})).toBe(true);
    for(const opened of [false,'true',1])expect(isRuntimeMessage({type:'SAVE_PDF_READING_STATE',payload:{fingerprint,state,document:{title:'Paper'},opened}})).toBe(false);
    expect(isRuntimeMessage({type:'SAVE_PDF_READING_STATE',payload:{fingerprint,state,opened:true}})).toBe(false);
  });
  it('round-trips names and removals as version 7 while older backups cannot reset a newer list choice',async()=>{
    await savePdfReadingState(`pdf-content:${fingerprint}`,state,{title:'Paper',pageCount:2});const id=await pdfReadingStateId(`pdf-content:${fingerprint}`);
    await renameRecentPdfReading(id,'Keep this custom name');await removeRecentPdfReading(id);
    const text=await exportDocumentLibraryBackup(),data=JSON.parse(text);expect(data.version).toBe(7);
    const original=structuredClone(stored[RECENT_PDF_OVERRIDES_KEY]);delete stored[RECENT_PDF_OVERRIDES_KEY];const before=structuredClone(stored);
    const preview=await previewDocumentLibraryBackup(text);expect(stored).toEqual(before);await importDocumentLibraryBackup(text,preview.token);expect(stored[RECENT_PDF_OVERRIDES_KEY]).toEqual(original);
    for(const version of [1,2,3,4,5,6]){await importDocumentLibraryBackup(JSON.stringify({format:'pi-translator-document-library',version,documents:[]}));expect(stored[RECENT_PDF_OVERRIDES_KEY]).toEqual(original)}
    const snapshot=structuredClone(stored);await expect(importDocumentLibraryBackup(JSON.stringify({...data,version:6}))).rejects.toThrow('版本 7');expect(stored).toEqual(snapshot);
    await savePdfReadingState(`pdf-content:${fingerprint}`,{...state,updatedAt:300},{title:'Other filename'},true);
    const reopened=structuredClone(stored[RECENT_PDF_OVERRIDES_KEY]);await importDocumentLibraryBackup(text);expect(stored[RECENT_PDF_OVERRIDES_KEY]).toEqual(reopened);expect(reopened[id].hidden).toBe(false);
  });
  it('atomically records a title with the position and refuses a stale unload snapshot',async()=>{
    stored.savedWork={translation:'Old $E=mc^2$',manualCorrection:true,revisions:['old','corrected']};
    await savePdfReadingState(`pdf-content:${fingerprint}`,state,{title:'Research paper.pdf',pageCount:4});
    const id=await pdfReadingStateId(`pdf-content:${fingerprint}`),snapshot=structuredClone(stored);
    expect(stored[RECENT_PDF_DOCUMENTS_KEY][id]).toEqual({title:'Research paper.pdf',pageCount:4,updatedAt:200});
    expect(vi.mocked(browser.storage.local.set)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(browser.storage.local.set).mock.calls[0]![0]).toHaveProperty(PDF_READING_STATES_KEY);
    await savePdfReadingState(`pdf-content:${fingerprint}`,{...state,updatedAt:100},{title:'stale name.pdf'});expect(stored).toEqual(snapshot);
    await savePdfReadingState(`pdf-content:${fingerprint}`,{...state,updatedAt:201},{title:'Saved translation'});expect(stored[RECENT_PDF_DOCUMENTS_KEY][id].pageCount).toBe(4);
    expect(stored.savedWork).toEqual(snapshot.savedWork);expect(JSON.stringify(stored[RECENT_PDF_DOCUMENTS_KEY])).not.toContain(fingerprint);
  });
  it('lists existing note-only PDFs read-only and leaves unidentifiable old positions intact',async()=>{
    const id=await pdfReadingStateId(`pdf-content:${fingerprint}`);
    stored[PDF_READING_ANNOTATIONS_KEY]={[id]:{updatedAt:150,annotations:[{id:'note',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Original source',prefix:'',suffix:''},sourceTitle:'Existing note paper',note:'Manual note',createdAt:1,updatedAt:150}]}};
    stored[PDF_READING_STATES_KEY]={[id]:state,['b'.repeat(32)]:{...state,updatedAt:300}};const before=structuredClone(stored);
    let copyError=false;expect(await listRecentPdfReadings([],()=>{copyError=true})).toEqual([{id,name:'Existing note paper',noteCount:1,fallbackPage:2,updatedAt:200,state,originalCopyUnavailable:true}]);expect(copyError).toBe(true);expect(stored).toEqual(before);
  });
  it('adds no duplicate PDF row for retained translations and keeps every language variant and pinned entry',()=>{
    const recent={id:'a'.repeat(32),name:'Source file',noteCount:2,fallbackPage:1,updatedAt:400,state};
    const entry=(id:string,pinned=false):RetainedLibraryEntry=>({id,readingId:recent.id,name:id,kind:'pdf',pinned,updatedAt:1} as RetainedLibraryEntry);
    const entries=[entry('Chinese'),entry('English'),{...entry('Pinned',true),readingId:'b'.repeat(32)}],before=structuredClone(entries);
    const rows=libraryReadingRows(entries,[recent,{...recent,id:'c'.repeat(32),name:'Only reading',updatedAt:500}]);
    expect(rows).toHaveLength(4);expect(rows[0]!.kind==='translation'&&rows[0]!.entry.id).toBe('Pinned');expect(rows[1]!.kind).toBe('recent');expect(rows.filter(r=>r.kind==='translation')).toHaveLength(3);expect(entries).toEqual(before);
    expect(libraryReadingRows([], [recent], entries)).toEqual([]);
    const {readingId:_readingId,...webFields}=entry('Web');
    const web={...webFields,kind:'web' as const,reading:{...state,updatedAt:900}};
    expect(libraryReadingRows([entries[0]!,web],[recent])[0]!.kind==='translation'&&
      (libraryReadingRows([entries[0]!,web],[recent])[0] as {entry:RetainedLibraryEntry}).entry.id).toBe('Web');
  });
  it('rolls only the 30-title recent list without deleting translations or notes',()=>{
    let current={};for(let i=1;i<=31;i++)current=updatedRecentPdfDocuments(current,i.toString(16).padStart(32,'0'),{title:`PDF ${i}`,updatedAt:i});
    expect(Object.keys(current)).toHaveLength(30);expect(current).not.toHaveProperty('1'.padStart(32,'0'));
    expect(()=>recentPdfDocuments({['a'.repeat(32)]:{title:'Bad',updatedAt:1,url:'https://example.org/private.pdf'}})).toThrow();
    expect(()=>recentPdfDocuments({['a'.repeat(32)]:{title:'x'.repeat(121),updatedAt:1}})).toThrow();
  });
  it('preserves all work on an atomic save failure and rejects invalid document metadata at the boundary',async()=>{
    stored.savedWork='Manual correction';const before=structuredClone(stored);
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('Disk full'));
    await expect(savePdfReadingState(`pdf-content:${fingerprint}`,state,{title:'Paper.pdf'})).rejects.toThrow('Disk full');expect(stored).toEqual(before);
    expect(isRuntimeMessage({type:'SAVE_PDF_READING_STATE',payload:{fingerprint,state,document:{title:'Paper.pdf',pageCount:2}}})).toBe(true);
    for(const document of [{title:''},{title:'Paper',pageCount:0},{title:'Paper',url:'https://example.org'},{title:'x'.repeat(121)}])expect(isRuntimeMessage({type:'SAVE_PDF_READING_STATE',payload:{fingerprint,state,document}})).toBe(false);
  });
  it('round-trips version 6 and keeps local recent titles when older backups are imported',async()=>{
    await savePdfReadingState(`pdf-content:${fingerprint}`,state,{title:'Recent paper',pageCount:3});
    const text=await exportDocumentLibraryBackup(),data=JSON.parse(text);expect(data.version).toBe(6);
    const recent=structuredClone(stored[RECENT_PDF_DOCUMENTS_KEY]);delete stored[RECENT_PDF_DOCUMENTS_KEY];const before=structuredClone(stored),preview=await previewDocumentLibraryBackup(text);expect(preview.recentDocuments).toBe(1);expect(stored).toEqual(before);
    await importDocumentLibraryBackup(text,preview.token);expect(stored[RECENT_PDF_DOCUMENTS_KEY]).toEqual(recent);
    for(const version of [1,2,3,4,5]){await importDocumentLibraryBackup(JSON.stringify({format:'pi-translator-document-library',version,documents:[]}));expect(stored[RECENT_PDF_DOCUMENTS_KEY]).toEqual(recent)}
    const snapshot=structuredClone(stored);data.version=5;await expect(importDocumentLibraryBackup(JSON.stringify(data))).rejects.toThrow('版本 6');expect(stored).toEqual(snapshot);
  });
});
