import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';
import {openPdfTranslationOptions,openPdfTranslationSettings} from './support/pdf-controls';
installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_SCANNED_PAPER!=='1','Opt-in actual archival scan acceptance only.');
test.use({trace:'off'});
test('accepts a complete archival scanned paper with actual OCR and translation',async({},info)=>{
  test.setTimeout(720_000);
  const replayOnly=process.env.PI_SCAN_REPLAY_ONLY==='1';
  const reviewExisting=process.env.PI_SCAN_REVIEW_EXISTING_ONLY==='1';
  const retranslateAll=process.env.PI_LIVE_SCAN_RETRANSLATE_ALL==='1';
  const continueWhole=process.env.PI_LIVE_SCAN_CONTINUE_WHOLE==='1';
  const retryBlocks=(process.env.PI_LIVE_SCAN_RETRY_BLOCKS??'').split(',').filter(Boolean);
  const retrySignatures:Record<string,string>={P1B1:'block-16z1s4hagobpp',P1B4:'block-1gw8jbu1rurlny'};
  if(retryBlocks.some(id=>!retrySignatures[id]))throw new Error('Unsupported targeted repair block.');
  const requestCap=Number(process.env.PI_LIVE_SCAN_REQUEST_CAP??(retryBlocks.length||24));
  const replayVision=process.env.PI_SCAN_REPLAY_VISION_FROM?await readFile(process.env.PI_SCAN_REPLAY_VISION_FROM,'utf8'):undefined;
  const apiKey=replayOnly?'offline-no-credentials':process.env.QWEN_API_KEY!,base=process.env.QWEN_BASE_URL!,model=process.env.QWEN_MODEL!;
  if(!apiKey||!base||!model)throw new Error('Actual provider configuration missing.');
  const root=path.resolve('output/excerpts-scan-2026-10-16'),source=path.join(root,'source/nash-1950-archival-scan.pdf');
  const resume=process.env.PI_LIVE_SCAN_RESUME?JSON.parse(await readFile(process.env.PI_LIVE_SCAN_RESUME,'utf8')):undefined;
  if(retranslateAll&&(!resume||reviewExisting||replayOnly||retryBlocks.length||replayVision))throw new Error('Whole-paper actual retranslation requires a saved baseline and fresh provider requests.');
  const ocrPages=resume?JSON.parse(await readFile(path.join(root,'actual-ocr-pages.json'),'utf8')):undefined;
  const worker=context.serviceWorkers()[0]!;
  await worker.evaluate(({apiKey,base,replayOnly,requestCap,replayVision})=>{
    const scope=globalThis as any,original=scope.fetch.bind(scope),host=new URL(base).hostname;
    scope.scanCalls=[];scope.scanReplies=[];scope.scanReplays=[];const pending:Promise<unknown>[]=[];scope.scanFlush=()=>Promise.allSettled(pending);
    scope.fetch=async(...args:any[])=>{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);
      if(new URL(url).hostname!==host)return original(...args);
      const requestBody=JSON.parse(args[1]?.body??'{}');const image=(requestBody.messages??[]).some((message:any)=>Array.isArray(message.content)&&message.content.some((part:any)=>part.type==='image_url'));
      if(image&&replayVision){scope.scanReplays.push({kind:'saved-actual-vision-response',at:Date.now()});return new Response(JSON.stringify({choices:[{message:{content:replayVision}}]}),{status:200,headers:{'Content-Type':'application/json'}})}
      if(replayOnly)throw new Error('Recorded-result replay must not make provider requests.');
      if(scope.scanCalls.length>=requestCap)throw new Error('Actual acceptance hard request cap reached.');
      const record:any={id:scope.scanCalls.length+1,kind:url.includes('multimodal-generation')?'ocr':'translation',image,startedAt:Date.now()};scope.scanCalls.push(record);
      try{const response=await original(...args);record.status=response.status;pending.push(response.clone().text().then((body:string)=>{record.finishedAt=Date.now();scope.scanReplies.push({id:record.id,status:response.status,body:body.replaceAll(apiKey,'[redacted]')})}).catch(()=>{record.streamAborted=true}));return response}
      catch(error){record.error=(error as Error).name;throw error}
    };
  },{apiKey,base,replayOnly,requestCap,replayVision});
  let reader=await context.newPage();const report:any={source:'https://pmc.ncbi.nlm.nih.gov/articles/PMC1063129/',model,providerHost:new URL(base).hostname,evidence:replayOnly?'Saved completed actual results inspected offline with fake credentials and provider requests blocked; no new model call, OCR or pause.':retranslateAll?'Fresh actual retranslation of every included non-manual block. Saved actual OCR reused; manual author and previous translations/formulas/history protected. No synthetic text, credentials, traces or request image bodies recorded.':resume?'Saved original actual OCR and unchanged actual targets reused; only changed source blocks receive new actual requests. No synthetic paper text, traces, credentials or request image bodies recorded.':'Fresh actual OCR and translation; original archive page scans cropped to remove adjacent articles; no synthetic paper text, traces, credentials or request image bodies recorded.',...(resume?{resume:process.env.PI_LIVE_SCAN_RESUME}:{}),steps:[]};
  const snapshot=async(label:string)=>{const data=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(['pdfDocumentTranslationRetainedV1','pdfDocumentTranslationFixedV1']),session:await c.storage.session.get(['pdfDocumentTranslationSessionsV1']),calls:(globalThis as any).scanCalls}});await writeFile(info.outputPath(`${label}.json`),JSON.stringify(data,null,2));await writeFile(info.outputPath('actual-replies.json'),JSON.stringify(await worker.evaluate(()=>({calls:(globalThis as any).scanCalls,replies:(globalThis as any).scanReplies})),null,2));return data as any};
  try{
    await reader.setViewportSize({width:1400,height:1000});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async({base,model,apiKey,resume,ocrPages})=>{const c=(globalThis as any).chrome,stored=await c.storage.local.get('extensionSettings');await c.storage.local.set({extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'扫描实际验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'扫描实际识别',apiBaseUrl:base,model}]},...(resume?resume.local:{})});await c.storage.session.set({apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey},...(resume?resume.session:{}),...(resume?{pdfCoordinateOcrSessionsV1:[{fingerprint:resume.session.pdfDocumentTranslationSessionsV1[0].sourceFingerprint,pageCount:2,pages:ocrPages,updatedAt:Date.now()}]}:{})})},{base,model,apiKey,resume,ocrPages});
    await reader.reload();await reader.locator('#file-input').setInputFiles(source);await expect(reader.locator('#page-count')).toHaveText('2');await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/idle|preparing/u);
    await openPdfTranslationOptions(reader);await reader.locator('#pdf-document-translation-retention-toggle').check();await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('2');
    await reader.screenshot({path:info.outputPath('scan-preflight.png')});
    if(!resume){await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation-status')).toContainText('请求上限',{timeout:180_000});await snapshot('actual-ocr-budget-paused')}
    report.steps.push({step:replayOnly?'Completed actual checkpoint and saved OCR restored; no new translation needed':resume?'Original actual OCR and unchanged actual translations restored; changed source blocks need new translation':'Both original scan pages recognized; OCR request budget pauses before translation',status:await reader.locator('#pdf-document-translation-status').textContent()});
    await reader.screenshot({path:info.outputPath('scan-ocr-paused.png')});
    await openPdfTranslationOptions(reader);await reader.locator('#pdf-document-request-limit').fill('24');
    if(retranslateAll){
      const before=(await snapshot('whole-before')).session.pdfDocumentTranslationSessionsV1[0];
      if(!continueWhole){
      const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();await reader.locator('#pdf-document-translation-clear').click();
      await expect.poll(()=>worker.evaluate(()=>(globalThis as any).scanCalls.length),{timeout:120000}).toBeGreaterThan(0);
      if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')==='running')await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused',{timeout:180000});
      await expect.poll(()=>worker.evaluate(()=>(globalThis as any).scanCalls.every((call:any)=>call.finishedAt||call.error||call.streamAborted)),{timeout:180000}).toBe(true);
      }else await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
      await expect(reader.locator('[data-translation-block][data-status="translating"]')).toHaveCount(0,{timeout:30000});
      const paused=await snapshot('whole-paused'),callsAtPause=paused.calls.length;
      for(const old of before.blocks.filter((block:any)=>block.manualCorrection))expect(paused.session.pdfDocumentTranslationSessionsV1[0].blocks.find((block:any)=>block.signature===old.signature)).toEqual(old);
      await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1400,height:1000});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(source);await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused',{timeout:30000});
      expect((await snapshot('whole-reopened-paused')).calls).toHaveLength(callsAtPause);
      await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:360000});
      const after=(await snapshot('whole-retranslated')).session.pdfDocumentTranslationSessionsV1[0];expect(after.blocks).toHaveLength(before.blocks.length);expect(after.archivedBlocks).toEqual(before.archivedBlocks);
      for(const old of before.blocks){const current=after.blocks.find((block:any)=>block.signature===old.signature);expect(current.formulaReviewMessage).toBeUndefined();expect(current.visualFallbackMessage).toBeUndefined();expect(current.retranslation).toBeUndefined();if(old.manualCorrection)expect(current).toEqual(old);else if(current.translatedText!==old.translatedText||!isDeepStrictEqual(current.formulaDocument,old.formulaDocument))expect(current.revisions).toEqual(expect.arrayContaining([expect.objectContaining({reason:'translation',translatedText:old.translatedText,...(old.formulaDocument?{formulaDocument:old.formulaDocument}:{})})]))}
      const calls=await worker.evaluate(()=>(globalThis as any).scanCalls);expect(calls.filter((call:any)=>call.image).length).toBeGreaterThanOrEqual(before.blocks.filter((block:any)=>!block.manualCorrection&&!block.referencePreserved).length);
      report.steps.push({step:continueWhole?'Saved actual pause restored, closed/reopened without requests, then every non-manual block freshly retranslated with previous versions preserved':'Fresh full retranslation with actual pause, close, restored pause, continuation and preserved old versions',callsAtPause,sourceBlocks:after.blocks.length,manualBlocks:after.blocks.filter((block:any)=>block.manualCorrection).length});
    }
    if(!retranslateAll&&!retryBlocks.length&&!reviewExisting&&await reader.locator('#pdf-document-translation').getAttribute('data-phase')!=='complete'){
    await reader.locator('#pdf-document-translation-primary').click();
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).scanCalls.filter((call:any)=>call.kind==='translation').length),{timeout:120_000}).toBeGreaterThan(0);
    if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')==='running')await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase',/paused|complete/u,{timeout:180_000});await snapshot('actual-manual-paused');
    if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')!=='complete')await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:360_000});
    }
    report.steps.push({step:replayOnly?'Saved actual completion inspected; no provider calls or new pause':continueWhole?'Continuation from saved actual pause; no new pause request':retryBlocks.length||reviewExisting?'Existing task state inspected; no full-queue resume or new pause performed':'Manual pause and continuation',phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase')});
    const complete=await snapshot('actual-complete');report.cards=await reader.locator('[data-translation-block]').evaluateAll(nodes=>nodes.map(node=>({id:(node as HTMLElement).dataset.translationBlock,status:(node as HTMLElement).dataset.status,mode:(node as HTMLElement).dataset.translationMode,text:node.textContent})));
    expect(complete.local.pdfDocumentTranslationRetainedV1?.[0]?.blocks?.length).toBe(complete.session.pdfDocumentTranslationSessionsV1?.[0]?.blocks?.length);
    await reader.locator('#pdf-document-translation-view-reading').click();
    if(retryBlocks.length){
      for(const id of retryBlocks){
        const block=reader.locator(`[data-translation-block="${id}"]`);await block.getByRole('button',{name:'重试本段',exact:true}).click({timeout:8000});await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/running|preparing/u,{timeout:180000});await expect(block).toHaveAttribute('data-status','done');await snapshot(`repaired-${id}`);
      }
      const repaired=await snapshot('actual-formulas-repaired'),before=complete.session.pdfDocumentTranslationSessionsV1[0],after=repaired.session.pdfDocumentTranslationSessionsV1[0];
      const changed=after.blocks.filter((block:any)=>retryBlocks.some(id=>retrySignatures[id]===block.signature));
      for(const block of changed){expect(block.formulaReviewMessage).toBeUndefined();expect(block.visualFallbackMessage).toBeUndefined();expect(block.formulaReviewDraft).toBeUndefined();expect(block.revisions?.some((revision:any)=>revision.formulaReviewMessage)).toBe(true)}
      if(retryBlocks.includes('P1B4')){
        const body=changed.find((block:any)=>block.signature===retrySignatures.P1B4)!;
        // Both citations occur after the final formula. Formula counts alone
        // must never let a response omit the two concluding prose paragraphs.
        expect(body.translatedText).toContain('¹');expect(body.translatedText).toContain('²');
      }
      if(retryBlocks.includes('P1B1'))await expect(reader.locator('[data-translation-block="P1B1"] math mi')).toHaveText('N');
      for(const block of before.blocks)if(!changed.some((item:any)=>item.signature===block.signature))expect(after.blocks.find((item:any)=>item.signature===block.signature)).toEqual(block);
      expect(after.archivedBlocks).toEqual(before.archivedBlocks);expect(changed).toHaveLength(retryBlocks.length);
      report.steps.push({step:'Targeted actual verification after occurrence-reference contract and old-result protection changes',ids:retryBlocks,unchangedBlocks:after.blocks.length-changed.length,previousResultsPreserved:true});
    }
    if(process.env.PI_LIVE_SCAN_RETRY_FOOTNOTE==='1'){
      const footnote=reader.locator('[data-translation-block="P2B2"]');await footnote.getByRole('button',{name:'重试本段',exact:true}).click({timeout:8000});
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:180_000});
      await expect.poll(async()=>{const saved=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1[0].blocks);const record=saved.find((item:any)=>item.signature==='block-pxogvk1c8gu78');return record&&!record.formulaReviewMessage&&!record.visualFallbackMessage}).toBe(true);
      await snapshot('actual-footnote-verified');report.steps.push({step:'One actual footnote retry after fixing citation and possessive-text false positives; no formula check disabled'});
    }
    const author=reader.locator('[data-translation-block="P1B2"]');await author.hover();await author.locator('.pdf-paragraph-edit-action').click({timeout:8000});const authorInput=reader.locator('#pdf-paragraph-editor textarea').first();
    if(await authorInput.inputValue()==='作者：约翰·F·纳什（小）*')await reader.locator('#pdf-paragraph-editor-cancel').click();
    else{await authorInput.fill('作者：约翰·F·纳什（小）*');await reader.locator('#pdf-paragraph-editor-save').click()}
    await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();await snapshot('actual-corrected');
    if(reviewExisting){for(const summary of await reader.locator('.pdf-formula-review-details[open] > summary').all())await summary.click()}
    await reader.mouse.move(10,10);
    await reader.screenshot({path:info.outputPath('scan-reading.png')});
    await reader.setViewportSize({width:1200,height:1800});await reader.locator('.pdf-document-translation-page[data-page-number="1"]').screenshot({path:info.outputPath('reading-card.png')});await reader.setViewportSize({width:1400,height:1000});
    for(const [id,file] of [['pdf-document-translation-download-translation','actual-scan-translation.md'],['pdf-document-translation-download-bilingual','actual-scan-bilingual.md'],['pdf-document-translation-download-html','actual-scan-bilingual.html']]){
      const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const downloading=reader.waitForEvent('download');await reader.locator(`#${id}`).click();await(await downloading).saveAs(info.outputPath(file!));
    }
    expect(await readFile(info.outputPath('actual-scan-translation.md'),'utf8')).toMatch(/均衡/);
    const mathBefore=await reader.locator('[data-translation-block] math').count();
    const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const printing=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();const preview=await printing;await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true',{timeout:20000});
    const layout=await preview.locator('.pdf-layout-continuation').evaluateAll(nodes=>nodes.map(node=>({overflowX:node.scrollWidth-node.clientWidth,overflowY:node.scrollHeight-node.clientHeight})));expect(layout.every(page=>page.overflowX<=1&&page.overflowY<=1)).toBe(true);expect(await preview.locator('math').count()).toBe(mathBefore);report.layout={pages:layout,mathNodes:mathBefore};
    const cdp=await context.newCDPSession(preview);const pdf=await cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(info.outputPath('actual-scan-bilingual.pdf'),Buffer.from(pdf.data,'base64'));await cdp.detach();await preview.close();
    await reader.close();reader=await context.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(source);await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/idle|preparing/u);
    report.steps.push({step:'Close and reopen before any additional paid request',phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase'),status:await reader.locator('#pdf-document-translation-status').textContent(),storedBlocks:complete.session.pdfDocumentTranslationSessionsV1?.[0]?.blocks?.length});
    await snapshot('actual-reopened');await reader.screenshot({path:info.outputPath('scan-reopened.png')});
    if(reviewExisting){
      expect(await reader.locator('#pdf-document-translation').getAttribute('data-phase')).toBe('paused');
      await expect(reader.locator('[data-translation-block="P1B4"]')).toContainText('待核对');
      const reopened=await snapshot('review-restored');
      const before=complete.session.pdfDocumentTranslationSessionsV1[0],after=reopened.session.pdfDocumentTranslationSessionsV1[0];
      for(const block of before.blocks){const restored=after.blocks.find((item:any)=>item.signature===block.signature);expect(restored.translatedText).toBe(block.translatedText);expect(restored.formulaDocument).toEqual(block.formulaDocument);expect(restored.revisions).toEqual(block.revisions)}
      expect(after.archivedBlocks).toEqual(before.archivedBlocks);expect(reopened.calls).toHaveLength(0);
    }else expect(await reader.locator('#pdf-document-translation').getAttribute('data-phase')).toBe('complete');
    await expect(reader.locator('[data-translation-block="P1B2"]')).toContainText('作者：约翰·F·纳什（小）*');
    await reader.setViewportSize({width:360,height:800});await reader.emulateMedia({colorScheme:'dark'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath('scan-reopened-360-dark.png')});
  }catch(error){report.failure=(error as Error).message;await snapshot('failure').catch(()=>undefined);await reader.screenshot({path:info.outputPath('failure.png')}).catch(()=>undefined);throw error}
  finally{await worker.evaluate(async()=>{await(globalThis as any).scanFlush()}).catch(()=>undefined);const evidence=await worker.evaluate(()=>({calls:(globalThis as any).scanCalls,replies:(globalThis as any).scanReplies,replays:(globalThis as any).scanReplays}));report.calls=evidence.calls;report.replays=evidence.replays;await writeFile(info.outputPath('actual-replies.json'),JSON.stringify(evidence,null,2));await writeFile(info.outputPath('actual-report.json'),JSON.stringify(report,null,2));await reader.close()}
});
