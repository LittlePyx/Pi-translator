import {context,createTwoPageTextPdf,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openPdfTranslationOptions} from './support/pdf-controls';
import {clickPdfReaderAction} from './support/translation-controls';
import {parseFormulaDocument,formulaDocumentText} from '../../core/translation/formula-document';
import {pdfReviewConfirmation} from '../../core/pdf/review-queue';
import {pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();

async function preserveReadingStorage(){
  const worker=context.serviceWorkers()[0]!;
  const previous=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(['pdfDocumentTranslationRetainedV1','piPdfReadingStatesV1','piPdfReadingBookmarksV1','documentTranslationMemoryV1','retainedDocumentNamesV1','piPdfTranslationMarkersV1']),session:await c.storage.session.get('pdfDocumentTranslationSessionsV1')}});
  return async()=>worker.evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.remove(['pdfDocumentTranslationRetainedV1','piPdfReadingStatesV1','piPdfReadingBookmarksV1','documentTranslationMemoryV1','retainedDocumentNamesV1','piPdfTranslationMarkersV1']);await c.storage.session.remove('pdfDocumentTranslationSessionsV1');await c.storage.local.set(previous.local);await c.storage.session.set(previous.session)},previous);
}

test('keeps old targets on failed retranslation, protects manual edits and restores history after close',async({},info)=>{
  const restoreStorage=await preserveReadingStorage(),worker=context.serviceWorkers()[0]!;
  const sources=['A controlled experiment measures the sample.','The final paragraph describes the results.'];
  const buffer=createTwoPageTextPdf(sources[0]!,sources[1]!);
  const signatures=sources.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('safe-retranslation-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:[
    {signature:signatures[0],translatedText:'演示文本：已人工校订的实验方法。',manualCorrection:true,pageNumber:1},
    {signature:signatures[1],translatedText:'演示文本：需要保留的旧结果。',pageNumber:2}]};
  let reader=await context.newPage();
  const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
  const open=async()=>{await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本-校订.pdf',mimeType:'application/pdf',buffer})};
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.addInitScript(()=>{const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...rest:any[])=>{
      if(message?.type==='ENSURE_PDF_BACKGROUND_DOCUMENT')return Promise.resolve({ok:false});
      if(message?.type==='TRANSLATE_DOCUMENT_BATCH')return (globalThis as any).piUnreliableReplacement?Promise.resolve({ok:true,data:{items:message.payload.items.map((item:any)=>({id:item.id,translatedText:item.text}))}}):Promise.resolve({ok:false,error:{code:'NETWORK_ERROR',message:'Local simulated offline failure'}});
      return send(message,...rest);
    }});
    await open();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    const first=reader.locator('[data-translation-block="P1B1"]');await first.hover();await first.locator('.pdf-paragraph-edit-action').click();
    await reader.locator('#pdf-paragraph-editor textarea').first().fill('演示文本：再次人工校订的实验方法。');await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-translation-clear').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','error');
    await expect(first).toContainText('再次人工校订');await expect(reader.locator('[data-translation-block="P2B1"]')).toContainText('需要保留的旧结果');
    const saved=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    expect(saved.blocks).toHaveLength(2);expect(saved.blocks.find((block:any)=>block.signature===signatures[0]).manualCorrection).toBe(true);expect(saved.blocks.find((block:any)=>block.signature===signatures[1]).retranslation).toBe(true);
    await reader.screenshot({path:info.outputPath('failed-retranslation-retains-old.png')});
    await reader.close();reader=await context.newPage();await open();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await expect(reader.locator('[data-translation-block="P2B1"]')).toContainText('需要保留的旧结果');await reader.locator('#pdf-document-translation-stop').click();
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-history').click();await expect(reader.locator('#pdf-history-previous')).toContainText('已人工校订的实验方法');
    await reader.setViewportSize({width:300,height:420});await reader.emulateMedia({colorScheme:'dark'});
    expect(await reader.locator('#pdf-history-dialog').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    await reader.screenshot({path:info.outputPath('durable-history-narrow.png')});await reader.locator('#pdf-history-restore').click();await expect(reader.locator('#pdf-history-dialog')).not.toBeVisible();
    await expect(reader.locator('[data-translation-block="P1B1"]')).toContainText('已人工校订的实验方法');
    const after=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    expect(after.blocks.every((block:any)=>!block.retranslation)).toBe(true);expect(after.blocks.find((block:any)=>block.signature===signatures[0]).revisions.length).toBeGreaterThanOrEqual(2);
    await reader.evaluate(()=>{(globalThis as any).piUnreliableReplacement=true});
    // The second reader does not inherit the first page's init script.
    await reader.evaluate(()=>{const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...rest:any[])=>{
      if(message?.type==='ENSURE_PDF_BACKGROUND_DOCUMENT')return Promise.resolve({ok:false});
      if(message?.type==='TRANSLATE_DOCUMENT_BATCH')return Promise.resolve({ok:true,data:{items:message.payload.items.map((item:any)=>({id:item.id,translatedText:item.text}))}});
      return send(message,...rest);
    }});
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-translation-clear').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','warning');await expect(reader.locator('[data-translation-block="P2B1"]')).toContainText('需要保留的旧结果');
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-history').click();await reader.locator('#pdf-history-paragraph').selectOption(signatures[1]!);
    await expect(reader.locator('#pdf-history-status')).toContainText('未采用');await expect(reader.locator('#pdf-history-restore')).toBeDisabled();await reader.locator('#pdf-history-close').click();
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close();await restoreStorage()}
});

for(const failSaving of [false,true])test(`keeps the prior version when an accepted replacement ${failSaving?'cannot be saved':'is saved successfully'}`,async()=>{
  const restoreStorage=await preserveReadingStorage(),worker=context.serviceWorkers()[0]!;
  const sources=['A controlled experiment measures the sample.','The final paragraph describes the results.'],buffer=createTwoPageTextPdf(sources[0]!,sources[1]!);
  const signatures=sources.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('accepted-replacement-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:[{signature:signatures[0],pageNumber:1,translatedText:'演示文本：人工修正保持不变。',manualCorrection:true},{signature:signatures[1],pageNumber:2,translatedText:'演示文本：重译前的旧稿。'}]};
  const reader=await context.newPage(),id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.addInitScript(failSaving=>{const scope=globalThis as any,c=scope.chrome,send=c.runtime.sendMessage.bind(c.runtime);scope.piRejectReplacement=false;
      for(const area of ['session','local']){const set=c.storage[area].set.bind(c.storage[area]);c.storage[area].set=(values:any,...rest:any[])=>scope.piRejectReplacement&&('pdfDocumentTranslationSessionsV1' in values||'pdfDocumentTranslationRetainedV1' in values)?Promise.reject(new Error('Injected replacement storage failure')):set(values,...rest)}
      c.runtime.sendMessage=(message:any,...rest:any[])=>{if(message?.type==='ENSURE_PDF_BACKGROUND_DOCUMENT')return Promise.resolve({ok:false});if(message?.type==='TRANSLATE_DOCUMENT_BATCH'){scope.piRejectReplacement=failSaving;return Promise.resolve({ok:true,data:{items:message.payload.items.map((item:any)=>({id:item.id,translatedText:'演示文本：最终段落介绍了实验结果。'}))}})}return send(message,...rest)};
    },failSaving);
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-translation-clear').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase',failSaving?'warning':'complete');
    await expect(reader.locator('[data-translation-block="P1B1"]')).toContainText('人工修正保持不变');
    const block=reader.locator('[data-translation-block="P2B1"]');await expect(block).toContainText(failSaving?'重译前的旧稿':'最终段落介绍');
    const saved=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    expect(saved.blocks.find((value:any)=>value.signature===signatures[1]).translatedText).toBe(failSaving?'演示文本：重译前的旧稿。':'演示文本：最终段落介绍了实验结果。');
    if(!failSaving){await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-history').click();await reader.locator('#pdf-history-paragraph').selectOption(signatures[1]!);await expect(reader.locator('#pdf-history-previous')).toContainText('重译前的旧稿');await reader.locator('#pdf-history-restore').click();await expect(block).toContainText('重译前的旧稿')}
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close();await restoreStorage()}
});

test('serializes backup import and correction saves across extension windows',async({},info)=>{
  const restoreStorage=await preserveReadingStorage(),worker=context.serviceWorkers()[0]!;
  const sources=['A controlled experiment measures the sample.','The final paragraph describes the results.'],buffer=createTwoPageTextPdf(sources[0]!,sources[1]!);
  const signatures=sources.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('concurrent-backup-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:signatures.map((signature,index)=>({signature,pageNumber:index+1,translatedText:`演示文本：旧译文 ${index+1}。`}))};
  const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
  const reader=await context.newPage(),options=await context.newPage();
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer});
    // Wait for local parsing before asserting the restored translation state.
    await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready',{timeout:30_000});
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    const block=reader.locator('[data-translation-block="P1B1"]');await block.hover();await block.locator('.pdf-paragraph-edit-action').click();await reader.locator('#pdf-paragraph-editor textarea').first().fill('演示文本：导入期间的新人工修正。');
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#library-storage-tools > summary').click();
    const download=options.waitForEvent('download');await options.locator('#export-library-backup').click();await(await download).saveAs(info.outputPath('before-concurrent-save.json'));
    const backup=await readFile(info.outputPath('before-concurrent-save.json'),'utf8');
    await options.evaluate(()=>{const scope=globalThis as any,c=scope.chrome,set=c.storage.local.set.bind(c.storage.local);scope.piImportHeld=false;scope.piImportGate=new Promise<void>(resolve=>scope.piReleaseImport=resolve);c.storage.local.set=async(values:any,...rest:any[])=>{if('retainedDocumentNamesV1' in values&&'piPdfTranslationMarkersV1' in values){scope.piImportHeld=true;await scope.piImportGate}return set(values,...rest)}});
    await options.locator('#library-backup-input').setInputFiles({name:'old-backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await expect.poll(()=>options.evaluate(()=>(globalThis as any).piImportHeld)).toBe(true);
    await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor-save')).toBeDisabled();await expect(reader.locator('#pdf-paragraph-editor')).toBeVisible();
    await options.evaluate(()=>{(globalThis as any).piReleaseImport()});await expect(options.locator('#retained-storage-action-status')).toContainText('已恢复');await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();
    const saved=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    expect(saved.blocks.find((item:any)=>item.signature===signatures[0])).toMatchObject({translatedText:'演示文本：导入期间的新人工修正。',manualCorrection:true});expect(saved.blocks.find((item:any)=>item.signature===signatures[0]).revisions[0].translatedText).toBe('演示文本：旧译文 1。');
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await options.evaluate(()=>{(globalThis as any).piReleaseImport?.()}).catch(()=>undefined);await reader.close();await options.close();await restoreStorage()}
});

test('shares the same paragraph position between the library reader and original PDF',async({},info)=>{
  const restoreStorage=await preserveReadingStorage(),worker=context.serviceWorkers()[0]!;
  const source=['The first long paragraph describes the experiment.','The second long paragraph describes the evaluation.'],buffer=createTwoPageTextPdf(source[0]!,source[1]!);
  const signatures=source.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('shared-reader-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:signatures.map((signature,index)=>({signature,pageNumber:index+1,translatedText:`演示文本：第${index+1}段。`+'我们记录模型在相同条件下的观测结果，并保留实验参数和分析过程。'.repeat(80)}))};
  const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
  let reader=await context.newPage();
  const position=()=>reader.locator('#pdf-document-translation-pages').evaluate(panel=>{const bounds=panel.getBoundingClientRect(),node=[...panel.querySelectorAll<HTMLElement>('[data-translation-block]')].find(node=>node.getBoundingClientRect().bottom>bounds.top+4);return{signature:node?.dataset.readingSignature,offset:node?bounds.top-node.getBoundingClientRect().top:0}});
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.setViewportSize({width:1100,height:800});await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('[data-translation-block="P2B1"]').evaluate(node=>{const panel=node.closest('#pdf-document-translation-pages')!;panel.scrollTop+=node.getBoundingClientRect().top-panel.getBoundingClientRect().top+140});await reader.waitForTimeout(400);const before=await position();
    await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1100,height:800});await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(id)}`);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect.poll(async()=>(await position()).signature).toBe(signatures[1]);expect(Math.abs((await position()).offset-before.offset)).toBeLessThan(5);
    await reader.screenshot({path:info.outputPath('unified-reading-from-library.png')});
    await reader.locator('[data-reading-signature]').first().evaluate(node=>{const panel=node.closest('#pdf-document-translation-pages')!;panel.scrollTop+=node.getBoundingClientRect().top-panel.getBoundingClientRect().top+120});await reader.waitForTimeout(400);const cached=await position();
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-library-source').click();await reader.locator('#file-input').setInputFiles({name:'改名后的演示文本.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect.poll(async()=>(await position()).signature).toBe(cached.signature);expect(Math.abs((await position()).offset-cached.offset)).toBeLessThan(5);
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close();await restoreStorage()}
});

test('restores translated paragraph and view after close and renamed PDF selection without model calls',async({},info)=>{
  const restoreStorage=await preserveReadingStorage();
  const worker=context.serviceWorkers()[0]!;
  const source=['The first source paragraph describes a controlled experiment.','The second source paragraph discusses its implications.'];
  const buffer=createTwoPageTextPdf(source[0]!,source[1]!);
  const signatures=source.map((text,i)=>pdfDocumentTranslationSessionBlockSignature(i+1,text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('reading-anchor-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),
    behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],
    blocks:signatures.map((signature,i)=>({signature,translatedText:`演示文本：第 ${i+1} 段。\n`+'我们在相同的实验条件下比较了模型输出，并记录每一次观测结果。这段内容用于验证译文滚动位置的恢复。'.repeat(45)}))};
  await worker.evaluate(async(record)=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
  const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
  let reader=await context.newPage();
  const open=async(name:string)=>{await reader.setViewportSize({width:1100,height:800});await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name,mimeType:'application/pdf',buffer});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete')};
  const position=()=>reader.locator('#pdf-document-translation-pages').evaluate(panel=>{
    const bounds=panel.getBoundingClientRect(),node=[...panel.querySelectorAll<HTMLElement>('[data-translation-block]')].find(el=>el.getBoundingClientRect().bottom>bounds.top+4);
    return{block:node?.dataset.translationBlock,offset:node?bounds.top-node.getBoundingClientRect().top:0,scroll:panel.scrollTop};
  });
  try{
    await open('演示文本.pdf');
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('已保存到本机');
    await reader.locator('[data-translation-block="P2B1"]').evaluate(node=>{const panel=node.closest('#pdf-document-translation-pages')!;panel.scrollTop+=node.getBoundingClientRect().top-panel.getBoundingClientRect().top+180});
    const before=await position();expect(before.block).toBe('P2B1');
    await expect.poll(async()=>{const states=await worker.evaluate(async()=>Object.values((await(globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1??{}) as any[]);return states.some(state=>state.translation?.signature===signatures[1]&&state.translation.mode==='reading')}).toBe(true);
    await reader.close();reader=await context.newPage();await open('改名后的演示文本.pdf');
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');
    await expect.poll(async()=>(await position()).block).toBe(before.block);
    expect(Math.abs((await position()).offset-before.offset)).toBeLessThan(4);
    await reader.screenshot({path:info.outputPath('reading-position-restored.png')});
    await reader.locator('#pdf-document-translation-view-compare').click();await reader.waitForTimeout(400);
    await reader.close();reader=await context.newPage();await open('再次改名的演示文本.pdf');
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','compare');
    await reader.locator('#pdf-document-translation-view-reading').click();await expect.poll(async()=>(await position()).block).toBe(before.block);
    await reader.close();
    await worker.evaluate(async()=>{const c=(globalThis as any).chrome,states=(await c.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1;for(const state of Object.values(states) as any[])if(state.translation)state.translation={...state.translation,mode:'reading',signature:'block-stale',pageNumber:2};await c.storage.local.set({piPdfReadingStatesV1:states})});
    reader=await context.newPage();await open('演示文本-旧锚点.pdf');await expect.poll(async()=>(await position()).block).toBe('P2B1');
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close();await restoreStorage()}
});

test('searches complete saved translations and continues at a matched paragraph in a clean narrow library',async({},info)=>{
  const restoreStorage=await preserveReadingStorage();
  const options=await context.newPage();const worker=context.serviceWorkers()[0]!;let cachedReader:typeof options|undefined;
  const signatures=['Title','Long body','Formula paragraph'].map((text,i)=>pdfDocumentTranslationSessionBlockSignature(1,text,i));
  const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'全文末尾的唯一检索词：边界条件。公式 {{m1}}。',formulas:[{id:'m1',latex:'\\mathcal{P}',display:false}]});
  const warning={translatedText:formulaDocument.translationTemplate,formulaDocument,formulaReviewMessage:'演示核对信息'};
  const confirmation=pdfReviewConfirmation({...warning,id:'demo',pageNumber:1,included:true,status:'done'});
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('library-content-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:[
    {signature:signatures[0],translatedText:'演示文本：条件分布研究'},
    {signature:signatures[1],translatedText:'这一段用于检查完整译文是否可阅读，而不是只截取开头的摘要。'.repeat(150)},
    {signature:signatures[2],pageNumber:2,...warning,reviewConfirmation:confirmation}]};
  try{
    await worker.evaluate(async(record)=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await options.goto(`chrome-extension://${extensionId}/options.html`);await options.locator('[data-settings-target="storage"]').click();
    let row=options.locator('.library-entry').first();await expect(row.locator('.library-title')).toHaveText('演示文本：条件分布研究');
    await expect(row.locator('.library-meta')).toContainText('3/3 段已处理');await expect(row.locator('.library-meta')).toContainText('1 段已核对');await expect(row.locator('.library-meta')).not.toContainText('待核对');
    await options.locator('#retained-library-search').fill('边界条件');await expect(options.locator('.library-entry')).toHaveCount(1);
    row=options.locator('.library-entry').first();await expect(row.locator('.library-match-snippet mark')).toHaveText('边界条件');
    const opened=context.waitForEvent('page');await row.locator('.library-open').click();cachedReader=await opened;
    await expect(cachedReader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect(cachedReader.locator('.pdf-document-translation-page > header').first()).not.toBeVisible();
    await expect(cachedReader.locator('.pdf-document-translation-page > header').last()).toContainText('第 2 页');
    await expect(cachedReader.locator('.pdf-search-translation-current')).toBeInViewport();
    await expect(cachedReader.locator('#pdf-document-translation-pages .katex')).toHaveCount(1);await expect(cachedReader.locator('#pdf-document-translation-pages')).toContainText('已人工核对');
    expect((await cachedReader.locator('#pdf-document-translation-pages').textContent())!.length).toBeGreaterThan(2000);
    await cachedReader.setViewportSize({width:300,height:420});await cachedReader.emulateMedia({colorScheme:'dark'});
    expect(await cachedReader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await cachedReader.locator('#pdf-search-query').press('Enter');await expect(cachedReader.locator('.pdf-search-translation-current')).toBeInViewport();
    await cachedReader.screenshot({path:info.outputPath('library-content-search-narrow.png')});
    await cachedReader.keyboard.press('Escape');await cachedReader.locator('#pdf-document-translation-pages').evaluate(node=>{node.scrollTop=900});await cachedReader.waitForTimeout(400);
    expect(new URL(cachedReader.url()).searchParams.has('query')).toBe(false);
    await cachedReader.reload();await expect(cachedReader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect.poll(()=>cachedReader!.locator('#pdf-document-translation-pages').evaluate(node=>Math.abs(node.scrollTop-900))).toBeLessThan(5);
    await options.locator('#retained-library-search').fill('<img onerror=alert(1)>');await expect(options.locator('.library-entry')).toHaveCount(0);expect(await options.locator('#retained-document-library img').count()).toBe(0);
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await cachedReader?.close();await options.close();await restoreStorage()}
});

test('partially restores changed segmentation and keeps old corrections accessible without model calls',async({},info)=>{
  const reader=await context.newPage();const worker=context.serviceWorkers()[0]!;
  const previous=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:(await c.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1,session:(await c.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1}});
  const buffer=createTwoPageTextPdf('A complete sentence about an experiment.','The distribution P describes the observations.');
  const current=[pdfDocumentTranslationSessionBlockSignature(1,'A complete sentence about an experiment.',0),pdfDocumentTranslationSessionBlockSignature(2,'The distribution P describes the observations.',0)];
  const old=[pdfDocumentTranslationSessionBlockSignature(1,'A complete sentence',0),pdfDocumentTranslationSessionBlockSignature(1,'about an experiment.',0),current[1]!];
  const formulaDocument=parseFormulaDocument({recognizedText:'The distribution {{m1}} describes the observations.',translation:'人工修正：分布 {{m1}} 描述观测数据。',formulas:[{id:'m1',latex:'\\mathcal{P}',display:false}]});
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('segmentation-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),
    documentSignatures:old,sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),activity:'complete',updatedAt:Date.now(),blocks:[
      {signature:old[0],translatedText:'人工修正的旧分段一。'},
      {signature:old[1],translatedText:'人工修正的旧分段二。'},
      {signature:old[2],translatedText:formulaDocument.translationTemplate,formulaDocument,reviewConfirmation:'review-ab12'},
    ]};
  const id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer});
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');await expect(reader.locator('#pdf-document-translation-status')).toContainText('1/2');
    await expect(reader.locator('.pdf-document-translation-block')).toHaveCount(1);await expect(reader.locator('.pdf-document-translation-block')).toContainText('人工修正');
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open','');
    await expect.poll(async()=>{const stored=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1);return stored[0].archivedBlocks?.length}).toBe(2);
    const stored=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    expect(stored.documentSignatures).toEqual(current);expect(stored.blocks[0].formulaDocument.formulas).toEqual(formulaDocument.formulas);expect(stored.blocks[0].reviewConfirmation).toBe('review-ab12');
    const session=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1[0]);
    expect(session.archivedBlocks).toEqual(stored.archivedBlocks);
    await reader.setViewportSize({width:300,height:420});await reader.locator('#pdf-document-translation-copy-menu > summary').click();
    const archive=reader.locator('#pdf-document-translation-download-archive');await archive.scrollIntoViewIfNeeded();
    expect(await archive.evaluate(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true);
    await reader.screenshot({path:info.outputPath('archive-menu-narrow.png')});const pending=reader.waitForEvent('download');await archive.click();await(await pending).saveAs(info.outputPath('old-segments.md'));
    const text=await readFile(info.outputPath('old-segments.md'),'utf8');expect(text).toContain('人工修正的旧分段一');expect(text).toContain('人工修正的旧分段二');
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{
    await reader.close();await worker.evaluate(async previous=>{const c=(globalThis as any).chrome;for(const [area,key,value] of [['local','pdfDocumentTranslationRetainedV1',previous.local],['session','pdfDocumentTranslationSessionsV1',previous.session]]){if(value===undefined)await c.storage[area].remove(key);else await c.storage[area].set({[key]:value})}},previous);
  }
});

test('honors a pause while the background document is still starting',async()=>{
  const reader=await context.newPage();
  await reader.addInitScript(()=>{
    const scope=globalThis as any,c=scope.chrome,send=c.runtime.sendMessage.bind(c.runtime);let held=false;
    scope.piReleaseBackgroundStart=undefined;scope.piBackgroundStartReleased=false;
    c.runtime.sendMessage=async(message:any,...rest:any[])=>{
      if(message?.type==='ENSURE_PDF_BACKGROUND_DOCUMENT'&&!held){held=true;await new Promise<void>(resolve=>{scope.piReleaseBackgroundStart=resolve});const response=await send(message,...rest);scope.piBackgroundStartReleased=true;return response;}
      return send(message,...rest);
    };
  });
  try{
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'演示文本-暂停.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('The first sentence describes an experiment.','The second sentence describes the results.')});
    await reader.locator('#translate-document').click();await reader.locator('#pdf-document-translation-primary').click();
    await expect.poll(()=>reader.evaluate(()=>typeof(globalThis as any).piReleaseBackgroundStart)).toBe('function');
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await reader.evaluate(()=>(globalThis as any).piReleaseBackgroundStart());await expect.poll(()=>reader.evaluate(()=>(globalThis as any).piBackgroundStartReleased)).toBe(true);
    await reader.waitForTimeout(500); // Give the released background start an opportunity to incorrectly send.
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');expect(textRequests.length+visionRequests.length).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
  }finally{await reader.close()}
});

test('searches the visible PDF translation and reveals source hits without extra model calls',async({},info)=>{
  const reader=await context.newPage();
  try{
    await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.setViewportSize({width:1100,height:800});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Search for a reconstructed image.','Read the second source paragraph.')});
    await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','ready');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('#pdf-document-translation-view-reading').click();
    const requests=textRequests.length+visionRequests.length;
    const query=(await reader.locator('#pdf-document-translation-pages').innerText()).match(/[\u4e00-\u9fff]{2,}/u)![0].slice(0,2);
    await reader.keyboard.press('Control+f');
    await expect(reader.locator('#pdf-search-scope')).toHaveValue('translation');
    await reader.locator('#pdf-search-query').fill(query);
    await expect(reader.locator('#pdf-search-status')).toContainText('1 / 2');
    await reader.locator('#pdf-search-query').press('Enter');
    await expect(reader.locator('.pdf-search-translation-current')).toBeInViewport();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');
    await reader.screenshot({path:info.outputPath('translation-search.png')});
    await reader.locator('#pdf-search-scope').selectOption('source');
    await reader.locator('#pdf-search-query').fill('image');
    await expect(reader.locator('#pdf-search-status')).toContainText('1 / 1');
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','compare');
    await expect(reader.locator('.pi-pdf-search-current')).toContainText('image');
    await reader.setViewportSize({width:300,height:420});
    await expect.poll(()=>reader.locator('#pdf-search').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await reader.screenshot({path:info.outputPath('search-narrow.png')});
    await reader.locator('#pdf-search-query').press('Escape');
    await expect(reader.locator('.pdf-search-translation-current')).toHaveCount(0);
    expect(textRequests.length+visionRequests.length).toBe(requests);
  }finally{await reader.close()}
});

test('corrects, undoes, pins, backs up and restores a PDF with a renamed source file',async({},info)=>{
  const reader=await context.newPage();const options=await context.newPage();let restored:typeof reader|undefined;
  const buffer=createTwoPageTextPdf('A complete paragraph about a controlled experiment.','A second paragraph reports the evaluation results.');
  try{
    await reader.emulateMedia({reducedMotion:'reduce'});await reader.setViewportSize({width:1100,height:800});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer});
    await reader.locator('#translate-document').click();await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-translation-retention-toggle').check();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('#pdf-document-translation-view-reading').click();
    const requests=textRequests.length+visionRequests.length;
    const block=reader.locator('.pdf-document-translation-block').first();
    const edit=async(text:string)=>{await block.hover();await block.locator('.pdf-paragraph-edit-action').click();await reader.locator('#pdf-paragraph-editor textarea').first().fill(text);await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible()};
    await edit('这是修正后的实验方法说明。');await expect(block).toContainText('修正后的实验方法');
    await reader.locator('#pdf-document-translation-view-compare').click();await clickPdfReaderAction(reader,'zoom-in');await reader.locator('#pdf-document-translation-view-reading').click();
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-undo-correction').click();await expect(block).not.toContainText('修正后的实验方法');
    await edit('这是最终保存的实验方法说明。');
    await options.goto(`chrome-extension://${extensionId}/options.html`);await options.locator('[data-settings-target="storage"]').click();
    let row=options.locator('.library-entry').first();await expect(row).toContainText('2/2 段');
    await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'固定保存',exact:true}).click();await expect(row).toContainText('已固定');
    await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'重命名',exact:true}).click();await row.getByRole('textbox',{name:'文档名称'}).fill('实验论文');await row.getByRole('button',{name:'保存名称',exact:true}).click();
    await options.screenshot({path:info.outputPath('fixed-library.png')});
    await options.locator('#library-storage-tools > summary').click();
    const download=options.waitForEvent('download');await options.locator('#export-library-backup').click();const backup=await download;await backup.saveAs(info.outputPath('document-library.json'));
    const text=await readFile(info.outputPath('document-library.json'),'utf8');expect(text).toContain('最终保存的实验方法');expect(text).not.toContain('controlled experiment');expect(text).not.toContain('e2e-test-key');
    await reader.close();
    await options.evaluate(async()=>{const storage=(globalThis as any).chrome.storage;const data=await storage.local.get(null);const keys=Object.keys(data).filter(key=>key.startsWith('fixedDocumentTranslationV1:')||key==='pdfDocumentTranslationRetainedV1'||key==='retainedDocumentNamesV1');await storage.local.remove(keys);await storage.session.remove('pdfDocumentTranslationSessionsV1')});
    await options.locator('#library-backup-input').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(text)});
    await expect(options.locator('#retained-storage-action-status')).toContainText('已恢复 1 份文档');
    row=options.locator('.library-entry').first();await expect(row).toContainText('实验论文');await expect(row).toContainText('已固定');
    await options.setViewportSize({width:300,height:420});await options.emulateMedia({colorScheme:'dark'});
    await row.locator('.library-menu > summary').click();
    expect(await row.getByRole('button',{name:'取消固定',exact:true}).evaluate(button=>{const rect=button.getBoundingClientRect();return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))})).toBe(true);
    await options.screenshot({path:info.outputPath('fixed-library-narrow.png')});
    const newPage=context.waitForEvent('page');await row.getByRole('button',{name:'选择原 PDF 恢复阅读',exact:true}).click();restored=await newPage;await restored.waitForLoadState('domcontentloaded');
    await expect(restored.locator('#empty-state')).toContainText('选择原 PDF 恢复阅读');
    await restored.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Wrong PDF content.','Different results.')});
    await expect(restored.locator('#notice')).toContainText('不是保留译文对应的原 PDF');
    await restored.locator('#file-input').setInputFiles({name:'改名后的原文件.pdf',mimeType:'application/pdf',buffer});
    await expect(restored.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect(restored.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');
    await expect(restored.locator('.pdf-document-translation-block').first()).toContainText('最终保存的实验方法');
    await restored.screenshot({path:info.outputPath('restored-reading.png')});expect(textRequests.length+visionRequests.length).toBe(requests);
  }finally{if(!reader.isClosed())await reader.close();await options.close();await restored?.close()}
});

test('keeps restored formulas and review warnings locked during local paragraph correction at narrow sizes',async({},info)=>{
  const reader=await context.newPage();const source='A paragraph includes a mathematical relation.';const second='The next paragraph provides context.';
  const buffer=createTwoPageTextPdf(source,second);const documentKey=pdfDocumentTranslationSessionDocumentKey('formula-correction-fixture');
  const signatures=[source,second].map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const formulaDocument=parseFormulaDocument({recognizedText:'Source {{m1}}.',translation:'原有译文 {{m1}}。',formulas:[{id:'m1',latex:'E^{h}',display:false}]});
  const descriptor={documentKey,targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto'};
  const id=JSON.stringify(['pdf',documentKey,'zh-CN','auto','academic','auto']);
  try{
    await reader.goto(`chrome-extension://${extensionId}/popup.html`);
    await reader.evaluate(async(record)=>{await (globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},{...descriptor,sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('mock'),documentSignatures:signatures,activity:'complete',updatedAt:Date.now(),blocks:[{signature:signatures[0],translatedText:formulaDocumentText(formulaDocument),formulaDocument,formulaReviewMessage:'演示公式待核对',formulaReviewDraft:true},{signature:signatures[1],translatedText:'后续段落。'}]});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);
    await reader.locator('#file-input').setInputFiles({name:'演示文本-公式.pdf',mimeType:'application/pdf',buffer});
    await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');
    await expect(reader.locator('#notice')).not.toContainText(/失败|不是|移除|不一致/u);
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');const requests=textRequests.length+visionRequests.length;
    const block=reader.locator('.pdf-document-translation-block').first();await block.hover();await block.locator('.pdf-paragraph-edit-action').click();
    await expect(reader.locator('#pdf-paragraph-editor .pdf-paragraph-locked')).toHaveText('E^{h}');
    await reader.locator('#pdf-paragraph-editor textarea').first().fill('核实后的文字 ');
    await reader.screenshot({path:info.outputPath('formula-correction-light.png')});
    await reader.setViewportSize({width:300,height:420});await reader.emulateMedia({colorScheme:'dark'});
    await expect.poll(()=>reader.locator('#pdf-paragraph-editor').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    const layout=await reader.locator('#pdf-paragraph-editor').evaluate(el=>{const body=el.querySelector('.pdf-paragraph-editor-parts')!.getBoundingClientRect();const footer=el.querySelector('footer')!.getBoundingClientRect();return{gap:footer.top-body.bottom,bottom:footer.bottom,height:window.innerHeight}});
    expect(layout.gap).toBeGreaterThanOrEqual(-1);expect(layout.bottom).toBeLessThanOrEqual(layout.height);
    await reader.locator('#pdf-paragraph-editor-save').scrollIntoViewIfNeeded();await expect(reader.locator('#pdf-paragraph-editor-save')).toBeInViewport();
    await reader.screenshot({path:info.outputPath('formula-correction-narrow.png')});
    await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();await expect(block).toContainText('核实后的文字');await expect(block).toContainText('演示公式待核对');await expect(block.locator('.katex')).toHaveCount(1);
    const saved=await reader.evaluate(async()=>{const data=await (globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1');return data.pdfDocumentTranslationRetainedV1.flatMap((record:any)=>record.blocks).find((block:any)=>block.formulaDocument)});
    expect(saved.formulaDocument.formulas[0].latex).toBe('E^{h}');expect(saved.formulaDocument.translationTemplate).toContain('{{m1}}');expect(saved.formulaReviewMessage).toBe('演示公式待核对');expect(textRequests.length+visionRequests.length).toBe(requests);
  }finally{await reader.close()}
});
