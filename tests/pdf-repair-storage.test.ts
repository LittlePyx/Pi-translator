import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {capturePdfRepairStorage,commitPdfRepairStorage,verifyPdfRepairStorage,inspectPdfRepairStorage,confirmPdfRepairStorage,resolvePdfRepairConflict,beginPdfArchivedRestore,listPdfRepairArchives,getPdfRepairGuard,pdfRepairVersionDifferences,savePdfDocumentTranslationSession,saveRetainedPdfDocumentTranslationSession,getPdfDocumentTranslationSession,getRetainedPdfDocumentTranslationSession,setRetainedPdfDocumentPinned,pdfDocumentTranslationSessionBehaviorKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionDocumentKey} from '../core/pdf/document-translation-session';
import {withParagraphHistory,MAX_PDF_PARAGRAPH_REVISIONS} from '../core/pdf/paragraph-history';
import {commitPdfTermCorrection} from '../core/pdf/document-translation-session';

const stores={session:{} as Record<string,unknown>,local:{} as Record<string,unknown>};
const area=(store:Record<string,unknown>)=>({
  get:vi.fn(async(key:string|string[]|null)=>key===null?structuredClone(store):Object.fromEntries((Array.isArray(key)?key:[key]).filter(k=>k in store).map(k=>[k,structuredClone(store[k])]))),
  set:vi.fn(async(values:Record<string,unknown>)=>Object.assign(store,structuredClone(values))),
  remove:vi.fn(async(key:string)=>{delete store[key]}),
});
const descriptor={documentKey:pdfDocumentTranslationSessionDocumentKey('https://example.com/test.pdf'),targetLanguage:'zh-CN' as const,sourceLanguage:'auto',style:'academic' as const,contentMode:'auto' as const};
const behavior=pdfDocumentTranslationSessionBehaviorKey('fixture'),signature=pdfDocumentTranslationSessionBlockSignature(1,'Energy formula text',0);
const initial={signature,translatedText:'旧译文',formulaReviewMessage:'待核对'},next={signature,translatedText:'修复后的译文'};
beforeEach(()=>{for(const store of Object.values(stores))for(const key of Object.keys(store))delete store[key];vi.stubGlobal('browser',{storage:{session:area(stores.session),local:area(stores.local)}});vi.stubGlobal('navigator',{locks:{request:async(_name:string,callback:()=>Promise<unknown>)=>callback()}})});
afterEach(()=>vi.unstubAllGlobals());
async function seed(){const update={descriptor,documentSignatures:[signature],activity:'complete' as const,blocks:[initial],sourceFingerprint:'a'.repeat(64)};await savePdfDocumentTranslationSession(update,behavior);await saveRetainedPdfDocumentTranslationSession(update,behavior)}
it('saves a confirmed term correction with manual provenance and shared history, leaving formulas locked',async()=>{
 const formula={version:1 as const,sourceTemplate:'policy {{m1}}',translationTemplate:'旧译法 {{m1}}',formulas:[{id:'m1',latex:'E=mc^2',display:false}],issues:[]};const block={signature,translatedText:'旧译法 {{m1}}',formulaDocument:formula};
 for(const save of [savePdfDocumentTranslationSession,saveRetainedPdfDocumentTranslationSession])await save({descriptor,documentSignatures:[signature],activity:'complete',blocks:[block],sourceFingerprint:'a'.repeat(64)},behavior);
 const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,block,true,'a'.repeat(64));expect((await commitPdfTermCorrection(snapshot,'旧译法','策略',()=>true)).status).toBe('saved');
 const session=(await getPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!,local=(await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!;expect(session).toEqual(local);expect(local.manualCorrection).toBe(true);expect(local.formulaDocument!.formulas).toEqual(formula.formulas);expect(local.revisions?.[0]?.reason).toBe('correction');expect(local.revisions?.[0]?.translatedText).toContain('旧译法');
});
it('rejects a term correction when another window changes either saved passage',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);(stores.local.pdfDocumentTranslationRetainedV1 as any[])[0].blocks[0].translatedText='其他窗口人工版本';const before=structuredClone(stores);expect((await commitPdfTermCorrection(snapshot,'旧译文','新译法',()=>true)).status).toBe('conflict');expect(stores).toEqual(before);
});
it('keeps both copies if the second term correction write fails',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('offline write fault'));expect((await commitPdfTermCorrection(snapshot,'旧译文','新译法',()=>true)).status).toBe('failed');expect(stores).toEqual(before);
});
it('saves only after comparing both versions and keeps the prior version in history',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('saved');
 for(const read of [getPdfDocumentTranslationSession,getRetainedPdfDocumentTranslationSession]){const block=(await read(descriptor,behavior))!.blocks[0]!;expect(block.translatedText).toBe(next.translatedText);expect(block.revisions?.[0]?.translatedText).toBe(initial.translatedText)}
 expect((await getPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!.revisions).toEqual((await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!.revisions);
});
it('rejects an intervening manual correction without altering either store',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);await saveRetainedPdfDocumentTranslationSession({descriptor,documentSignatures:[signature],activity:'complete',blocks:[{...initial,translatedText:'其他窗口人工修改',manualCorrection:true}]},behavior);const before=structuredClone(stores);expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('conflict');expect(stores).toEqual(before);
});
it.each(['documentTranslationMemoryV1','extensionSettings'])('rejects changed %s while repair is pending',async key=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);stores.local[key]={changed:'人工更新'};const before=structuredClone(stores);expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('conflict');expect(stores).toEqual(before);
});
it('keeps an unrelated document saved while this repair is pending',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);
 const other={...descriptor,documentKey:pdfDocumentTranslationSessionDocumentKey('https://example.com/unrelated.pdf')},otherBlock={signature,translatedText:'另一文档人工译文',manualCorrection:true as const};
 await savePdfDocumentTranslationSession({descriptor:other,documentSignatures:[signature],activity:'complete',blocks:[otherBlock]},behavior);await saveRetainedPdfDocumentTranslationSession({descriptor:other,documentSignatures:[signature],activity:'complete',blocks:[otherBlock]},behavior);
 expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('saved');expect((await getRetainedPdfDocumentTranslationSession(other,behavior))!.blocks[0]).toMatchObject(otherBlock);
});
it('keeps another paragraph edited while this repair is pending',async()=>{
 const otherSignature=pdfDocumentTranslationSessionBlockSignature(2,'other paragraph',0),signatures=[signature,otherSignature],other={signature:otherSignature,translatedText:'另一段原译文'};
 for(const save of [savePdfDocumentTranslationSession,saveRetainedPdfDocumentTranslationSession])await save({descriptor,documentSignatures:signatures,activity:'complete',blocks:[initial,other],sourceFingerprint:'a'.repeat(64)},behavior);
 const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),edited={...other,translatedText:'另一段人工修正',manualCorrection:true as const};
 for(const save of [savePdfDocumentTranslationSession,saveRetainedPdfDocumentTranslationSession])await save({descriptor,documentSignatures:signatures,activity:'complete',blocks:[edited]},behavior);
 expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('saved');for(const read of [getPdfDocumentTranslationSession,getRetainedPdfDocumentTranslationSession])expect((await read(descriptor,behavior))!.blocks.find(block=>block.signature===otherSignature)).toMatchObject(edited);
});
it('restores both original values when the second write fails',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);const set=vi.mocked(browser.storage.session.set);set.mockRejectedValueOnce(new Error('synthetic session failure'));expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('failed');expect(stores).toEqual(before);
});
it('reports uncertainty when rollback also fails',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('synthetic write failure'));let writes=0;vi.mocked(browser.storage.local.set).mockImplementation(async values=>{if('pdfDocumentTranslationRetainedV1' in values&&++writes===2)throw new Error('synthetic rollback failure');Object.assign(stores.local,structuredClone(values))});expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('uncertain');
});
it('keeps a non-content guard after an interrupted repair and blocks later writes until explicit consistency check',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('synthetic write failure'));let writes=0;const set=vi.mocked(browser.storage.local.set);set.mockImplementation(async values=>{if('pdfDocumentTranslationRetainedV1' in values&&++writes===2)throw new Error('synthetic rollback failure');Object.assign(stores.local,structuredClone(values))});
 expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('uncertain');const guard=await getPdfRepairGuard('a'.repeat(64));expect(guard).toEqual({fingerprint:'a'.repeat(64),documentKey:descriptor.documentKey,signature,descriptor,behaviorKey:behavior});expect(JSON.stringify(guard)).not.toContain('旧译文');
 await expect(savePdfDocumentTranslationSession({descriptor,documentSignatures:[signature],activity:'complete',blocks:[initial]},behavior)).rejects.toThrow('待核对');
 stores.local.pdfDocumentTranslationRetainedV1=structuredClone(before.local.pdfDocumentTranslationRetainedV1);stores.session.pdfDocumentTranslationSessionsV1=structuredClone(before.session.pdfDocumentTranslationSessionsV1);
 expect(await confirmPdfRepairStorage(descriptor,behavior,signature,initial,true,'a'.repeat(64),()=>true)).toBe(true);expect(await getPdfRepairGuard('a'.repeat(64))).toBeUndefined();await expect(savePdfDocumentTranslationSession({descriptor,documentSignatures:[signature],activity:'complete',blocks:[initial]},behavior)).resolves.toBeDefined();
});
it('does not start replacing data when writing the guard fails ambiguously',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);vi.mocked(browser.storage.local.set).mockImplementationOnce(async values=>{Object.assign(stores.local,structuredClone(values));throw new Error('synthetic guard write failure')});
 expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('uncertain');expect(stores.session).toEqual(before.session);expect(stores.local.pdfDocumentTranslationRetainedV1).toEqual(before.local.pdfDocumentTranslationRetainedV1);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();
});
it('can check the retained copy after the browser session is gone without rewriting it',async()=>{
 await seed();stores.local.pdfFormulaRepairGuardV1={['a'.repeat(64)]:{fingerprint:'a'.repeat(64),documentKey:descriptor.documentKey,signature,descriptor,behaviorKey:behavior}};delete stores.session.pdfDocumentTranslationSessionsV1;const retained=structuredClone(stores.local.pdfDocumentTranslationRetainedV1);
 const result=await inspectPdfRepairStorage(descriptor,behavior,signature,initial,true);expect(result.consistent).toBe(true);expect(result.session).toBeUndefined();expect(result.local?.translatedText).toBe('旧译文');expect(await confirmPdfRepairStorage(descriptor,behavior,signature,initial,true,'a'.repeat(64),()=>true)).toBe(true);expect(stores.local.pdfDocumentTranslationRetainedV1).toEqual(retained);expect(await getPdfRepairGuard('a'.repeat(64))).toBeUndefined();
});
it('can verify both written copies after cleanup and rollback fail',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);let writes=0;vi.mocked(browser.storage.local.set).mockImplementation(async values=>{if('pdfDocumentTranslationRetainedV1' in values&&++writes===2)throw new Error('rollback failed');Object.assign(stores.local,structuredClone(values))});vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error('cleanup failed'));
 expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('uncertain');const session=(await getPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!,local=(await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!;expect(session).toEqual(local);expect((await inspectPdfRepairStorage(descriptor,behavior,signature,session,true)).consistent).toBe(true);expect(await confirmPdfRepairStorage(descriptor,behavior,signature,session,true,'a'.repeat(64),()=>true)).toBe(true);
});
it('does not clear a guard using another translation configuration',async()=>{
 await seed();stores.local.pdfFormulaRepairGuardV1={['a'.repeat(64)]:{fingerprint:'a'.repeat(64),documentKey:descriptor.documentKey,signature,descriptor,behaviorKey:behavior}};
 expect(await confirmPdfRepairStorage({...descriptor,style:'literal'},behavior,signature,initial,true,'a'.repeat(64),()=>true)).toBe(false);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();
});
it('checks both saved copies without writing or choosing a version',async()=>{
 await seed();const before=structuredClone(stores);expect(await verifyPdfRepairStorage(descriptor,behavior,signature,initial,true)).toBe(true);expect(stores).toEqual(before);
 await saveRetainedPdfDocumentTranslationSession({descriptor,documentSignatures:[signature],activity:'complete',blocks:[{...initial,translatedText:'人工修正',manualCorrection:true}]},behavior);const changed=structuredClone(stores);expect(await verifyPdfRepairStorage(descriptor,behavior,signature,initial,true)).toBe(false);const compared=await inspectPdfRepairStorage(descriptor,behavior,signature,initial,true);expect(compared.consistent).toBe(false);expect(compared.session?.translatedText).toBe('旧译文');expect(compared.local?.translatedText).toBe('人工修正');expect(stores).toEqual(changed);
});
async function divergent(){
 await seed();const raw=stores.local.pdfDocumentTranslationRetainedV1 as any[];raw[0].blocks[0]={...initial,translatedText:'本机人工修改',manualCorrection:true,revisions:[{id:'revision-local',createdAt:1,reason:'correction',translatedText:'先前人工稿',manualCorrection:true}]};
 stores.local.pdfFormulaRepairGuardV1={['a'.repeat(64)]:{fingerprint:'a'.repeat(64),documentKey:descriptor.documentKey,signature,descriptor,behaviorKey:behavior}};
 const compared=await inspectPdfRepairStorage(descriptor,behavior,signature,initial,true);return {session:compared.session!,local:compared.local!};
}
it('archives both divergent versions and their histories before applying the selected version',async()=>{
 const preview=await divergent(),result=await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'local',()=>true);expect(result.status).toBe('saved');
 const archives=await listPdfRepairArchives('a'.repeat(64),signature);expect(archives).toHaveLength(1);expect(archives[0]).toMatchObject({session:preview.session,local:preview.local,visible:initial});
 expect((await getPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]).toEqual(preview.local);expect((await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]).toEqual(preview.local);expect(await getPdfRepairGuard('a'.repeat(64))).toBeUndefined();
 const begin=await beginPdfArchivedRestore(descriptor,behavior,signature,'a'.repeat(64),preview.local,()=>true);expect(begin.status).toBe('ready');if(begin.status!=='ready')throw new Error('expected ready');
 const restored=await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),preview.local,begin.preview,'session',()=>true,{archive:archives[0]!,branch:'session'});expect(restored.status).toBe('saved');expect((await getPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]).toEqual(preview.session);expect((await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]).toEqual(preview.session);expect(await listPdfRepairArchives('a'.repeat(64),signature)).toHaveLength(2);
});
it('rejects a stale conflict preview without changing either version',async()=>{
 const preview=await divergent();(stores.local.pdfDocumentTranslationRetainedV1 as any[])[0].blocks[0].translatedText='其他窗口的修改';const before=structuredClone(stores);
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'session',()=>true)).status).toBe('conflict');expect(stores).toEqual(before);
});
it('retains the archive and guard when a write fails during conflict recovery',async()=>{
 const preview=await divergent(),beforeSession=structuredClone(stores.session),beforeLocal=structuredClone(stores.local.pdfDocumentTranslationRetainedV1);vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('synthetic write failure'));
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'local',()=>true)).status).toBe('failed');expect(stores.session).toEqual(beforeSession);expect(stores.local.pdfDocumentTranslationRetainedV1).toEqual(beforeLocal);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();expect(await listPdfRepairArchives('a'.repeat(64),signature)).toHaveLength(1);
});
it('does not replace either version when archive storage is unavailable',async()=>{
 const preview=await divergent(),before=structuredClone(stores);vi.mocked(browser.storage.local.set).mockImplementation(async values=>{if('pdfFormulaRepairArchivesV1' in values)throw new Error('archive unavailable');Object.assign(stores.local,structuredClone(values))});
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'local',()=>true)).status).toBe('uncertain');expect(stores).toEqual(before);
});
it('retains the guard if the archive write reports an ambiguous failure',async()=>{
 const preview=await divergent(),beforeSession=structuredClone(stores.session),beforeLocal=structuredClone(stores.local.pdfDocumentTranslationRetainedV1);vi.mocked(browser.storage.local.set).mockImplementation(async values=>{Object.assign(stores.local,structuredClone(values));if('pdfFormulaRepairArchivesV1' in values)throw new Error('ambiguous archive write')});
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'local',()=>true)).status).toBe('uncertain');expect(stores.session).toEqual(beforeSession);expect(stores.local.pdfDocumentTranslationRetainedV1).toEqual(beforeLocal);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();expect(await listPdfRepairArchives('a'.repeat(64),signature)).toHaveLength(1);
});
it('keeps the durable archive and guard if recovery and rollback both fail',async()=>{
 const preview=await divergent();vi.mocked(browser.storage.session.set).mockRejectedValueOnce(new Error('session failure'));let writes=0;vi.mocked(browser.storage.local.set).mockImplementation(async values=>{if('pdfDocumentTranslationRetainedV1' in values&&++writes===2)throw new Error('rollback failure');Object.assign(stores.local,structuredClone(values))});
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'session',()=>true)).status).toBe('uncertain');const archive=(await listPdfRepairArchives('a'.repeat(64),signature))[0];expect(archive?.session).toEqual(preview.session);expect(archive?.local).toEqual(preview.local);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();
});
it('does not restore an archived version that changed after it was displayed',async()=>{
 const preview=await divergent();expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),initial,preview,'local',()=>true)).status).toBe('saved');const archive=(await listPdfRepairArchives('a'.repeat(64),signature))[0]!;
 const begin=await beginPdfArchivedRestore(descriptor,behavior,signature,'a'.repeat(64),preview.local,()=>true);if(begin.status!=='ready')throw new Error('expected ready');(stores.local.pdfFormulaRepairArchivesV1 as any[])[0].session.translatedText='其他窗口的新内容';const before=structuredClone(stores);
 expect((await resolvePdfRepairConflict(descriptor,behavior,signature,'a'.repeat(64),preview.local,begin.preview,'session',()=>true,{archive,branch:'session'})).status).toBe('conflict');expect(stores).toEqual(before);expect(await getPdfRepairGuard('a'.repeat(64))).toBeDefined();
});
it('explains manual and history differences even when visible text and revision counts match',()=>{
 const revision={id:'revision-one',createdAt:1,reason:'correction' as const,translatedText:'原译文'};
 const left={...initial,manualCorrection:true as const,revisions:[revision]},right={...initial,revisions:[{...revision,translatedText:'另一份历史'}]};
 expect(pdfRepairVersionDifferences(left,right)).toEqual(['manual','history']);
 expect(pdfRepairVersionDifferences(left,structuredClone(left))).toEqual([]);
});
it('refuses continuation when a saved history changes after preview without altering either version',async()=>{
 await seed();stores.local.pdfFormulaRepairGuardV1={['a'.repeat(64)]:{fingerprint:'a'.repeat(64),documentKey:descriptor.documentKey,signature,descriptor,behaviorKey:behavior}};
 expect((await inspectPdfRepairStorage(descriptor,behavior,signature,initial,true)).consistent).toBe(true);
 const retained=stores.local.pdfDocumentTranslationRetainedV1 as any[];retained[0].blocks[0].revisions=[{id:'revision-manual',createdAt:1,reason:'correction',translatedText:'人工历史',manualCorrection:true}];const before=structuredClone(stores);
 expect(await confirmPdfRepairStorage(descriptor,behavior,signature,initial,true,'a'.repeat(64),()=>true)).toBe(false);expect(stores).toEqual(before);expect((await getPdfRepairGuard('a'.repeat(64)))?.signature).toBe(signature);
});
it('demonstrates that the existing bounded history cannot safely absorb another version when full',()=>{
 const revisions=Array.from({length:MAX_PDF_PARAGRAPH_REVISIONS},(_,index)=>({id:`revision-${index}`,createdAt:index+1,reason:'correction' as const,translatedText:`人工历史 ${index}`,manualCorrection:true as const}));
 const current={...initial,manualCorrection:true as const,revisions},other={...initial,translatedText:'另一版本',manualCorrection:true as const};
 expect(()=>withParagraphHistory(current,{...other,revisions},'restore')).toThrow('修订历史已满');
 expect(current.revisions).toEqual(revisions);
});
it('refuses an already changed manual result and requires a shared browser lock',async()=>{
 await seed();await savePdfDocumentTranslationSession({descriptor,documentSignatures:[signature],activity:'complete',blocks:[{...initial,manualCorrection:true}]},behavior);await expect(capturePdfRepairStorage(descriptor,behavior,signature,initial,true)).rejects.toThrow('变化');vi.stubGlobal('navigator',{});expect(()=>capturePdfRepairStorage(descriptor,behavior,signature,initial,true)).toThrow('无法安全核对');
});
it('accepts an unchanged formula whose object keys were reordered by storage',async()=>{
 const formula={version:1 as const,sourceTemplate:'{{m1}}',translationTemplate:'能量 {{m1}}',formulas:[{id:'m1',latex:'E=mc^2',display:false}],issues:[]};
 const block={signature,translatedText:formula.translationTemplate,formulaDocument:formula,formulaReviewMessage:'待核对'};
 const update={descriptor,documentSignatures:[signature],activity:'complete' as const,blocks:[block]};await savePdfDocumentTranslationSession(update,behavior);
 const raw=stores.session.pdfDocumentTranslationSessionsV1 as any[];const stored=raw[0].blocks[0].formulaDocument;raw[0].blocks[0].formulaDocument={formulas:stored.formulas,issues:stored.issues,sourceTemplate:stored.sourceTemplate,translationTemplate:stored.translationTemplate,version:stored.version};
 await expect(capturePdfRepairStorage(descriptor,behavior,signature,block,false)).resolves.toBeDefined();
});
it('updates a pinned retained record without replacing unrelated data',async()=>{
 await seed();await setRetainedPdfDocumentPinned(descriptor,true);const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true);expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('saved');expect((await getRetainedPdfDocumentTranslationSession(descriptor,behavior))!.blocks[0]!.translatedText).toBe(next.translatedText);
});
it('rolls back if navigation occurs between writes',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);let checks=0;expect((await commitPdfRepairStorage(snapshot,next,()=>++checks<=2)).status).toBe('failed');expect(stores).toEqual(before);
});
it('restores a session write that applied before reporting failure',async()=>{
 await seed();const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);vi.mocked(browser.storage.session.set).mockImplementationOnce(async values=>{Object.assign(stores.session,structuredClone(values));throw new Error('synthetic ambiguous write')});expect((await commitPdfRepairStorage(snapshot,next)).status).toBe('failed');expect(stores).toEqual(before);
});
it('does not evict other retained documents when the repair exceeds the local limit',async()=>{
 await seed();const list=stores.local.pdfDocumentTranslationRetainedV1 as any[],other=structuredClone(list[0]);other.documentKey=pdfDocumentTranslationSessionDocumentKey('https://example.com/other.pdf');other.documentSignatures=Array.from({length:50},(_,i)=>pdfDocumentTranslationSessionBlockSignature(i+1,`large ${i}`,0));other.blocks=other.documentSignatures.map((signature:string)=>({signature,translatedText:'x'.repeat(19800)}));other.updatedAt=1;list.push(other);
 const snapshot=await capturePdfRepairStorage(descriptor,behavior,signature,initial,true),before=structuredClone(stores);expect((await commitPdfRepairStorage(snapshot,{signature,translatedText:'新'.repeat(15000)})).status).toBe('failed');expect(stores).toEqual(before);
});
