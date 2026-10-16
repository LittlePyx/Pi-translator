import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {applyPdfParagraphCorrection,pdfCorrectionParts} from '../core/pdf/document-correction';
import {parseFormulaDocument,formulaDocumentText} from '../core/translation/formula-document';
import {saveRetainedPdfDocumentTranslationSession,setRetainedPdfDocumentPinned,listRetainedPdfDocumentTranslations,PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../core/pdf/document-translation-session';
import {saveRetainedBilingualPageSession,setRetainedBilingualPagePinned,listRetainedBilingualPageTranslations,BILINGUAL_PAGE_RETAINED_STORAGE_KEY,bilingualPageSessionPageKey,bilingualPageSessionBlockSignature,bilingualPageSessionBehaviorKey} from '../core/translation/bilingual-page-session';
import {listRetainedDocuments,renameRetainedDocument,deleteRetainedDocument} from '../core/translation/retained-document-library';
import {exportDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';
import {fixedDocumentKey,retainDocumentSessions} from '../core/translation/fixed-document-storage';

const local:Record<string,unknown>={};
const shared={targetLanguage:'zh-CN' as const,sourceLanguage:'auto',style:'academic' as const,contentMode:'auto' as const};
const signature=pdfDocumentTranslationSessionBlockSignature(1,'Private source paragraph',0);
const behavior=pdfDocumentTranslationSessionBehaviorKey('model');
const descriptor=(id:number)=>({...shared,documentKey:pdfDocumentTranslationSessionDocumentKey(`private-file-${id}.pdf`)});
async function savePdf(id:number,text=`译文 ${id}`){
  return saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(id),documentSignatures:[signature],activity:'complete',blocks:[{signature,translatedText:text}],sourceFingerprint:'a'.repeat(64)},behavior);
}
beforeEach(()=>{
  for(const key of Object.keys(local))delete local[key];
  const storage={
    get:vi.fn(async(keys:string|string[]|null)=>keys===null?structuredClone(local):Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(local[key])]))),
    set:vi.fn(async(value:Record<string,unknown>)=>{Object.assign(local,structuredClone(value))}),
    remove:vi.fn(async(key:string)=>{delete local[key]}),
  };
  vi.stubGlobal('browser',{storage:{local:storage}});
});
afterEach(()=>vi.unstubAllGlobals());

describe('fixed document library and portable backup',()=>{
  it('round-trips source-derived paper roles with manual corrections and formula structures in library backups',async()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'Title {{m1}}',translation:'演示题名 {{m1}}',formulas:[{id:'m1',latex:'\\mathbb{R}',display:false}]});
    const blocks=[{signature,translatedText:'演示题名',paperRole:'title' as const,manualCorrection:true as const,formulaDocument},
      {signature:pdfDocumentTranslationSessionBlockSignature(1,'Authors',0),translatedText:'演示作者',paperRole:'authors' as const},
      {signature:pdfDocumentTranslationSessionBlockSignature(1,'Publication',0),translatedText:'演示期刊 2024',paperRole:'publication' as const}];
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),documentSignatures:blocks.map(b=>b.signature),activity:'complete',blocks,sourceFingerprint:'a'.repeat(64)},behavior);
    const before=(await listRetainedPdfDocumentTranslations())[0]!.blocks;
    const backup=await exportDocumentLibraryBackup();
    for(const key of Object.keys(local))delete local[key];
    await importDocumentLibraryBackup(backup);
    expect((await listRetainedPdfDocumentTranslations())[0]!.blocks).toEqual(before);
    expect(before.map(b=>b.paperRole).sort()).toEqual(['authors','publication','title']);
  });
  it('serializes import and a concurrently saved correction without overwriting new progress',async()=>{
    await savePdf(0);const backup=await exportDocumentLibraryBackup();
    let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    vi.mocked(browser.storage.local.set).mockImplementation(async values=>{if('retainedDocumentNamesV1' in values){entered();await gate}Object.assign(local,structuredClone(values))});
    const importing=importDocumentLibraryBackup(backup);await started;
    let saved=false;const saving=savePdf(0,'并发保存的人工修正').then(()=>{saved=true});
    await Promise.resolve();expect(saved).toBe(false);release();await Promise.all([importing,saving]);
    expect((await listRetainedPdfDocumentTranslations())[0]?.blocks[0]?.translatedText).toBe('并发保存的人工修正');
  });
  it('backs up reading positions, bookmarks, confirmed terms and correction history without unrelated memory',async()=>{
    await savePdf(0);await savePdf(0,'第二版人工修正');
    const id='a'.repeat(32);
    local.piPdfReadingStatesV1={[id]:{pageNumber:8,pageRatio:.5,zoomLevel:1.25,fitWidth:false,sidebarExpanded:false,updatedAt:10,translation:{mode:'reading',signature,pageNumber:8,offsetRatio:.4}}};
    local.piPdfReadingBookmarksV1={[id]:{bookmarks:[{id:'bookmark-1',pageNumber:8,label:'实验',note:'检查条件',createdAt:1,updatedAt:10}],updatedAt:10}};
    local.documentTranslationMemoryV1={'doc-a':{schemaVersion:1,documentId:'doc-a',label:'private.example',updatedAt:10,confirmedTerms:[{id:'term-1',source:'kernel',target:'核函数',createdAt:1,updatedAt:10}],candidateTerms:[],recentTranslations:[{originalText:'Unrelated private prose'}],dismissedTermKeys:[]}};
    const backup=await exportDocumentLibraryBackup();expect(backup).not.toContain('private.example');expect(backup).not.toContain('Unrelated private prose');
    for(const key of Object.keys(local))delete local[key];await importDocumentLibraryBackup(backup);
    expect((local.piPdfReadingStatesV1 as any)[id].translation.signature).toBe(signature);expect((local.piPdfReadingBookmarksV1 as any)[id].bookmarks[0].note).toBe('检查条件');expect((local.documentTranslationMemoryV1 as any)['doc-a'].confirmedTerms[0].target).toBe('核函数');expect((await listRetainedPdfDocumentTranslations())[0]?.blocks[0]?.revisions?.[0]?.translatedText).toBe('译文 0');
    const before=structuredClone(local),invalid=JSON.parse(backup);invalid.readingStates={bad:{pageNumber:8}};
    await expect(importDocumentLibraryBackup(JSON.stringify(invalid))).rejects.toThrow('标识');expect(local).toEqual(before);
  });
  it('merges disjoint progress and retains both histories while protecting a local manual correction',async()=>{
    const second=pdfDocumentTranslationSessionBlockSignature(2,'Second source paragraph',0);
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),documentSignatures:[signature,second],sourceFingerprint:'a'.repeat(64),activity:'paused',blocks:[{signature,translatedText:'最初版本'}]},behavior);
    const older=JSON.parse(await exportDocumentLibraryBackup());
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),documentSignatures:[signature,second],sourceFingerprint:'a'.repeat(64),activity:'paused',blocks:[{signature,translatedText:'本机人工修正',manualCorrection:true},{signature:second,translatedText:'本机新完成的第二段'}]},behavior);
    older.documents[0].record.updatedAt=Date.now()+1000;
    older.documents[0].record.blocks[0].translatedText='备份中的自动重译';
    await importDocumentLibraryBackup(JSON.stringify(older));
    const saved=(await listRetainedPdfDocumentTranslations())[0]!;
    expect(saved.blocks).toHaveLength(2);expect(saved.blocks.find(block=>block.signature===second)?.translatedText).toBe('本机新完成的第二段');
    const first=saved.blocks.find(block=>block.signature===signature)!;expect(first.translatedText).toBe('本机人工修正');expect(first.manualCorrection).toBe(true);
    expect(first.revisions?.map(revision=>revision.translatedText)).toEqual(expect.arrayContaining(['最初版本','备份中的自动重译']));
  });
  it('round trips scope and preserved-reference counts through fixed storage and backup',async()=>{
    const reference=pdfDocumentTranslationSessionBlockSignature(2,'A reference entry',0);
    const outside=pdfDocumentTranslationSessionBlockSignature(3,'Outside the chosen range',0);
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),activity:'complete',documentSignatures:[signature,reference,outside],scopeSignatures:[signature,reference],preservedSignatures:[reference],blocks:[{signature,translatedText:'人工修正的正文。'},{signature:outside,translatedText:'先前保存的范围外译文。'}]},behavior);
    await setRetainedPdfDocumentPinned(descriptor(0),true);
    expect((await listRetainedDocuments())[0]).toMatchObject({coverageKnown:true,blockCount:2,processedCount:2,preservedCount:1,totalBlocks:2,state:'complete'});
    const backup=await exportDocumentLibraryBackup();for(const key of Object.keys(local))delete local[key];await importDocumentLibraryBackup(backup);
    expect((await listRetainedPdfDocumentTranslations())[0]).toMatchObject({scopeSignatures:[signature,reference],preservedSignatures:[reference]});
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),activity:'complete',documentSignatures:[signature,reference,outside],scopeSignatures:[signature,reference,outside],preservedSignatures:[]},behavior);
    expect((await listRetainedDocuments())[0]).toMatchObject({processedCount:2,totalBlocks:3,state:'incomplete',coverageKnown:true});
    const before=structuredClone(local);
    await expect(saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),activity:'complete',documentSignatures:[signature],preservedSignatures:[reference]},behavior)).rejects.toThrow('Invalid');
    expect(local).toEqual(before);
  });
  it('bounds fixed Unicode data by serialized bytes as well as translated characters',()=>{
    const record={...descriptor(0),updatedAt:1,blocks:[{translatedText:'中'.repeat(999_999)}]};
    expect(()=>retainDocumentSessions('pdf',[record],new Set([fixedDocumentKey('pdf',record)]),6,1_000_000)).toThrow('容量上限');
  });
  it('round trips archived manual corrections and formula warnings through fixed copies and backup import',async()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'Private {{m1}}',translation:'旧段人工修正 {{m1}}',formulas:[{id:'m1',latex:'\\mathbb{R}',display:false}]});
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),documentSignatures:[signature],sourceFingerprint:'a'.repeat(64),activity:'complete',
      blocks:[{signature,translatedText:formulaDocumentText(formulaDocument),formulaDocument,reviewConfirmation:'review-ab12',formulaReviewMessage:'仍需核对',formulaReviewDraft:true}]},behavior);
    await setRetainedPdfDocumentPinned(descriptor(0),true);
    const merged=pdfDocumentTranslationSessionBlockSignature(1,'New complete source paragraph',0);
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),documentSignatures:[merged],sourceFingerprint:'a'.repeat(64),activity:'paused',replaceBlocks:true,blocks:[]},behavior);
    const saved=(await listRetainedPdfDocumentTranslations())[0]!;
    expect(saved.blocks).toEqual([]);expect(saved.archivedBlocks).toHaveLength(1);
    expect(saved.archivedBlocks?.[0]).toMatchObject({reviewConfirmation:'review-ab12',formulaReviewDraft:true,formulaReviewMessage:'仍需核对'});
    const backup=await exportDocumentLibraryBackup();expect(backup).not.toContain('Private');
    for(const key of Object.keys(local))delete local[key];
    await importDocumentLibraryBackup(backup);
    delete local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY];
    expect((await listRetainedPdfDocumentTranslations())[0]?.archivedBlocks).toEqual(saved.archivedBlocks);
  });
  it('retains fixed PDFs across rolling eviction and refreshes their independent copy',async()=>{
    await savePdf(0);await setRetainedPdfDocumentPinned(descriptor(0),true);
    for(let id=1;id<9;id++)await savePdf(id);
    expect(await listRetainedPdfDocumentTranslations()).toHaveLength(7);
    expect((local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY] as unknown[])).toHaveLength(6);
    expect((await listRetainedDocuments())[0]?.pinned).toBe(true);
    await savePdf(0,'修正后的固定译文');
    delete local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY];
    expect((await listRetainedPdfDocumentTranslations())[0]?.blocks[0]?.translatedText).toBe('修正后的固定译文');
    await setRetainedPdfDocumentPinned(descriptor(0),false);
    expect(local[fixedDocumentKey('pdf',descriptor(0))]).toBeUndefined();
    expect((await listRetainedDocuments())[0]?.pinned).toBe(false);
  });
  it('allows fixed documents beyond six and preserves six independent recent slots through backup',async()=>{
    for(let id=0;id<6;id++){await savePdf(id);await setRetainedPdfDocumentPinned(descriptor(id),true)}
    await savePdf(6);await setRetainedPdfDocumentPinned(descriptor(6),true);
    for(let id=7;id<15;id++)await savePdf(id);
    expect(await listRetainedPdfDocumentTranslations()).toHaveLength(13);
    expect(local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).toHaveLength(6);
    const backup=await exportDocumentLibraryBackup();
    for(const key of Object.keys(local))delete local[key];
    expect(await importDocumentLibraryBackup(backup)).toBe(13);
    expect((await listRetainedDocuments()).filter(entry=>entry.pinned)).toHaveLength(7);
    await setRetainedPdfDocumentPinned(descriptor(0),false);
    expect((await listRetainedDocuments()).find(entry=>entry.id.includes(descriptor(0).documentKey))?.pinned).toBe(false);
    expect(local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).toHaveLength(6);
  });
  it('protects fixed webpage results independently of the PDF library',async()=>{
    const webSignature=bilingualPageSessionBlockSignature('P','Private webpage paragraph',0);
    const webDescriptor=(id:number)=>({...shared,pageKey:bilingualPageSessionPageKey(`https://private.example/${id}`)});
    for(let id=0;id<9;id++){
      await saveRetainedBilingualPageSession({descriptor:webDescriptor(id),documentSignatures:[webSignature],excludedSignatures:[],displayMode:'bilingual',translationsHidden:false,controlCollapsed:true,activity:'active',blocks:[{signature:webSignature,translatedText:`网页 ${id}`,hidden:false}]},bilingualPageSessionBehaviorKey('model'));
      if(id===0)await setRetainedBilingualPagePinned(webDescriptor(0),true);
    }
    expect(await listRetainedBilingualPageTranslations()).toHaveLength(7);
    delete local[BILINGUAL_PAGE_RETAINED_STORAGE_KEY];
    expect((await listRetainedBilingualPageTranslations())[0]?.blocks[0]?.translatedText).toBe('网页 0');
  });
  it('round-trips names, pins, fingerprints, formula registry and review status without settings or source prose',async()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'Private source {{m1}}.',translation:'修正译文 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
    await saveRetainedPdfDocumentTranslationSession({descriptor:descriptor(0),sourceFingerprint:'b'.repeat(64),documentSignatures:[signature],activity:'complete',blocks:[{signature,translatedText:formulaDocumentText(formulaDocument),formulaDocument,formulaReviewMessage:'请核对',formulaReviewDraft:true,reviewConfirmation:'review-ab12'}]},behavior);
    const entry=(await listRetainedDocuments())[0]!;await setRetainedPdfDocumentPinned(descriptor(0),true);await renameRetainedDocument(entry.id,'校准论文');
    const markerId='a'.repeat(32);
    local.piPdfTranslationMarkersV1={[markerId]:{enabled:true,updatedAt:10,markers:[{markerId:'backup-note::full',createdAt:1,anchor:{kind:'text-quote',pageNumber:1,sourceText:'Saved excerpt',prefix:'',suffix:''},content:{sourceTitle:'Calibration Study',originalText:'Saved excerpt',translatedText:'实验摘录。',pageNumber:1,doi:'10.1000/demo',note:'检查条件。'}}]}};
    local.settings={apiKey:'secret-placeholder',apiEndpoint:'https://private.example/api'};
    const backup=await exportDocumentLibraryBackup();
    expect(backup).not.toContain('Private source');expect(backup).not.toContain('private-file');expect(backup).not.toContain('secret-placeholder');expect(backup).not.toContain('private.example');
    for(const key of Object.keys(local))if(key!=='settings')delete local[key];
    expect(await importDocumentLibraryBackup(backup)).toBe(1);
    const restored=(await listRetainedDocuments())[0]!;expect(restored).toMatchObject({name:'校准论文',pinned:true,reviewCount:1});expect(restored.text).toContain('$x=y$');
    expect((await listRetainedPdfDocumentTranslations())[0]).toMatchObject({sourceFingerprint:'b'.repeat(64),blocks:[{formulaReviewDraft:true,reviewConfirmation:'review-ab12'}]});
    expect(local.settings).toEqual({apiKey:'secret-placeholder',apiEndpoint:'https://private.example/api'});
    expect((local.piPdfTranslationMarkersV1 as any)[markerId].markers[0].content).toMatchObject({originalText:'Saved excerpt',doi:'10.1000/demo',note:'检查条件。'});
  });
  it('rejects malformed formulas or imports over capacity atomically and keeps newer corrections',async()=>{
    await savePdf(0);const data=JSON.parse(await exportDocumentLibraryBackup());
    await savePdf(0,'后来修正的译文');
    data.documents[0].record.updatedAt=1;
    await importDocumentLibraryBackup(JSON.stringify(data));expect((await listRetainedDocuments())[0]?.text).toBe('后来修正的译文');
    data.documents[0].record.blocks[0].formulaDocument={version:1,formulas:'broken'};
    let before=structuredClone(local);await expect(importDocumentLibraryBackup(JSON.stringify(data))).rejects.toThrow('公式结构无效');expect(local).toEqual(before);
    for(let id=1;id<6;id++)await savePdf(id);
    const valid=JSON.parse(await exportDocumentLibraryBackup());valid.documents=[{...valid.documents[0],record:{...valid.documents[0].record,documentKey:descriptor(99).documentKey}}];
    before=structuredClone(local);await expect(importDocumentLibraryBackup(JSON.stringify(valid))).rejects.toThrow('保存容量');expect(local).toEqual(before);
  });
});

describe('PDF paragraph correction with immutable formulas',()=>{
  it('changes prose while preserving formula references, numbers, registry and whitespace',()=>{
    const formulaDocument=parseFormulaDocument({recognizedText:'Source {{m1}} and {{m2}}.',translation:'原译文 {{m1}}\n\n {{m2}}。',formulas:[{id:'m1',latex:'E^{h}',display:false},{id:'m2',latex:'x=y',display:true}]});
    const value={translatedText:formulaDocumentText(formulaDocument),formulaDocument};
    const parts=pdfCorrectionParts(value);const editable=parts.find(part=>part.kind==='text'&&part.text.includes('原译文'))!;
    const result=applyPdfParagraphCorrection(value,new Map([[editable.id,'修正后的译文 ']]));
    expect(result.formulaDocument?.formulas).toEqual(formulaDocument.formulas);
    expect(result.formulaDocument?.translationTemplate).toBe('修正后的译文 {{m1}}\n\n {{m2}}。');
    expect(result.translatedText).toContain('$E^{h}$');expect(result.translatedText).toContain('x=y');
    expect(formulaDocument.translationTemplate).toContain('原译文');
  });
  it('rejects edits to locked commands, injected formulas, empty and unchanged prose',()=>{
    const value={translatedText:'计算 $x=y$ 后的结果。'};const parts=pdfCorrectionParts(value);
    const editable=parts.find(part=>part.kind==='text')!;const locked=parts.find(part=>part.kind==='locked')!;
    expect(()=>applyPdfParagraphCorrection(value,new Map([[locked.id,'$z=0$']]))).toThrow('不可修改');
    expect(()=>applyPdfParagraphCorrection(value,new Map([[editable.id,'新增 $z=0$']]))).toThrow();
    expect(()=>applyPdfParagraphCorrection(value,new Map([[editable.id,'新增 {{m99}}']]))).toThrow('公式引用');
    expect(()=>applyPdfParagraphCorrection(value,new Map())).toThrow();
    expect(()=>applyPdfParagraphCorrection({translatedText:'译文'},new Map([['part-0',' ']]))).toThrow();
  });
});
