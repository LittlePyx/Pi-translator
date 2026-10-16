import {readFile, writeFile} from 'node:fs/promises';
import {context, expect, extensionId, installEdgeExtensionHooks, test} from './support/edge-extension-fixture';
import {openPdfTranslationOptions} from './support/pdf-controls';

installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_WHOLE_PAPER !== '1', 'Opt-in actual public-paper acceptance only.');
test.use({trace:'off'});

test('accepts all pages of the public HATNet paper and records every unresolved outcome', async ({}, testInfo) => {
  test.setTimeout(1_200_000);
  const apiKey=process.env.QWEN_API_KEY!, base=process.env.QWEN_BASE_URL!, model=process.env.QWEN_MODEL!, source=process.env.PI_PDF_REGRESSION_SOURCE!;
  if(!apiKey||!base||!model||!source)throw new Error('Incomplete live configuration');
  const worker=context.serviceWorkers()[0]!;
  // Observe cloned replies without buffering or replaying the actual stream.
  // Never record request bodies, authorization headers or browser traces.
  await worker.evaluate(({base,apiKey})=>{
    const scope=globalThis as any, original=scope.fetch.bind(scope); let tail=Promise.resolve();
    scope.piWholePaperControls=[];
    scope.chrome.runtime.onMessage.addListener((message:any)=>{
      if(message.type==='CONTROL_PDF_BACKGROUND_DOCUMENT_TRANSLATION')scope.piWholePaperControls.push({time:Date.now(),payload:message.payload});
    });
    scope.fetch=async(...args:any[])=>{
      const response=await original(...args);
      const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);
      if(url.startsWith(base.replace(/\/+$/u,''))&&url.includes('/chat/completions')){
        void response.clone().text().then((body:string)=>{
          tail=tail.then(async()=>{
            const stored=await scope.chrome.storage.session.get('piWholePaperReplies');
            const replies=stored.piWholePaperReplies??[];
            replies.push({status:response.status,body:body.slice(0,100_000).replaceAll(apiKey,'[redacted]')});
            if(replies.reduce((sum:number,reply:any)=>sum+reply.body.length,0)<=3_000_000)await scope.chrome.storage.session.set({piWholePaperReplies:replies});
          });
        });
      }
      return response;
    };
  },{base,apiKey});
  const reader=await context.newPage(); const started=Date.now();
  const resume=process.env.PI_LIVE_RESUME_REPORT?JSON.parse(await readFile(process.env.PI_LIVE_RESUME_REPORT,'utf8')):undefined;
  if(resume&&(resume.model!==model||resume.providerHost!==new URL(base).hostname))throw new Error('Refusing results from another provider/model');
  const report:Record<string,unknown>={model,providerHost:new URL(base).hostname,requestLimit:120,
    evidence:'Actual public 11-page paper; native extension; session credentials; API host pregranted only in isolated test package.'};
  if(resume)report.resume={source:resume.sourceReport,actualCompleted:resume.sessions[0].blocks.length,repairedOffline:resume.repairedOffline};
  let monitoring=false;
  const monitor=setInterval(async()=>{
    if(monitoring)return;monitoring=true;
    try{await writeFile(testInfo.outputPath('progress.json'),JSON.stringify({seconds:Math.round((Date.now()-started)/1000),
      phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase'),status:await reader.locator('#pdf-document-translation-status').textContent()}))}
    catch{}finally{monitoring=false}
  },5000);
  try{
    await reader.setViewportSize({width:1500,height:1040});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async({base,apiKey,model,sessions})=>{
      const chrome=(globalThis as any).chrome,stored=await chrome.storage.local.get('extensionSettings');
      await chrome.storage.local.set({extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,
        apiProfiles:[{id:'default',name:'整篇真实验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'整篇视觉验收',apiBaseUrl:base,model}]}});
      await chrome.storage.session.set({apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey}});
      if(sessions)await chrome.storage.session.set({pdfDocumentTranslationSessionsV1:sessions});
    },{base,apiKey,model,sessions:resume?.sessions});
    await reader.reload();await reader.locator('#file-input').setInputFiles(source);
    await expect(reader.locator('#page-count')).toHaveText('11');
    await reader.locator('#translate-document').click();
    if(resume)await expect(reader.locator('#pdf-document-translation-status')).toContainText('已恢复');
    await expect(reader.locator('#pdf-document-translation-range')).toHaveValue('all');
    await openPdfTranslationOptions(reader);await reader.locator('#pdf-document-budget-details > summary').click();
    await reader.locator('#pdf-document-request-limit').fill('120');
    await reader.screenshot({path:testInfo.outputPath('whole-paper-preflight.png')});
    await reader.evaluate(()=>{
      const scope=globalThis as any;scope.piLiveControls=[];scope.piLiveSnapshots=[];
      document.addEventListener('click',event=>{if((event.target as Element).closest('#pdf-document-translation-primary'))scope.piLiveControls.push({event:'primary-click',trusted:event.isTrusted,time:Date.now()})},true);
      scope.chrome.runtime.onMessage.addListener((message:any)=>{if(message.type==='PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED')scope.piLiveSnapshots.push({time:Date.now(),phase:message.payload?.phase,error:message.payload?.errorMessage})});
    });
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','running',{timeout:30_000});
    await expect.poll(async()=>{
      const phase=await reader.locator('#pdf-document-translation').getAttribute('data-phase');
      const status=await reader.locator('#pdf-document-translation-status').textContent()??'';
      return /已完成/u.test(status)||['paused','stopped','error'].includes(phase??'');
    },{timeout:1_080_000,intervals:[2000,4000]}).toBe(true);
    report.status=await reader.locator('#pdf-document-translation-status').textContent();
    report.phase=await reader.locator('#pdf-document-translation').getAttribute('data-phase');
    report.snapshot=await reader.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1);
    report.cards=await reader.locator('[data-translation-block]').evaluateAll(elements=>elements.map(element=>({id:(element as HTMLElement).dataset.translationBlock,
      status:(element as HTMLElement).dataset.status,mode:(element as HTMLElement).dataset.translationMode,text:element.textContent})));
    report.usage=await reader.locator('#pdf-document-request-usage').textContent();
    await reader.locator('#pdf-document-translation-view-reading').click();
    await reader.screenshot({path:testInfo.outputPath('whole-paper-reading.png')});
    const menu=reader.locator('#pdf-document-translation-copy-menu');await menu.locator('summary').click();
    const download=reader.waitForEvent('download');await reader.locator('#pdf-document-translation-download-translation').click();
    await(await download).saveAs(testInfo.outputPath('whole-paper-translation.md'));
    expect(await readFile(testInfo.outputPath('whole-paper-translation.md'),'utf8')).toMatch(/\p{Script=Han}/u);
    expect(report.phase).toBe('complete');
    for(const id of ['P1B5','P2B1','P5B12']){
      const card=reader.locator(`[data-translation-block="${id}"]`);
      await expect(card).toHaveAttribute('data-status','done');
      await expect(card.locator('.pdf-formula-reference-review')).toHaveCount(0);
      await card.scrollIntoViewIfNeeded();await card.screenshot({path:testInfo.outputPath(`${id}-whole-result.png`)});
    }
    await expect(reader.locator('[data-translation-block="P1B5"]')).toContainText('西湖大学');
    expect(await reader.locator('[data-translation-block="P2B1"] .pi-equation-tag').allTextContents()).toEqual(['(1)','(2)','(3)','(4)']);
    await expect(reader.locator('[data-translation-block="P2B1"] math mi[mathvariant="bold-italic"]').first()).not.toHaveText(/^[A-Za-z]$/u);
  }finally{
    clearInterval(monitor);
    report.seconds=Math.round((Date.now()-started)/1000);
    report.finalStatus=await reader.locator('#pdf-document-translation-status').textContent().catch(()=>null);
    report.finalSnapshot=await reader.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1).catch(()=>null);
    report.replies=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('piWholePaperReplies')).piWholePaperReplies).catch(()=>null);
    report.controls=await reader.evaluate(()=>(globalThis as any).piLiveControls).catch(()=>null);
    report.backgroundControls=await worker.evaluate(()=>(globalThis as any).piWholePaperControls).catch(()=>null);
    report.snapshotPhases=await reader.evaluate(()=>(globalThis as any).piLiveSnapshots).catch(()=>null);
    await writeFile(testInfo.outputPath('whole-paper-report.json'),JSON.stringify(report,null,2).replaceAll(apiKey,'[redacted]'));
    await reader.close();
  }
});
