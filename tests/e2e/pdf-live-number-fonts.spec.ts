import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';
import {openPdfTranslationOptions} from './support/pdf-controls';
installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_NUMBER_FONTS!=='1','Opt-in actual public-paper formula/font acceptance.');
test.use({trace:'off'});

test('accepts the complete publisher normalizing-flows paper with actual model responses',async({},info)=>{
  test.setTimeout(2_400_000);
  const root=path.resolve('output/pdf/number-fonts-2026-10-16');
  const source=path.join(root,'source/rezende15.pdf');
  const baseline=JSON.parse(await readFile('output/pdf/semantic-units-2026-10-16/final-build-replay/pdf-live-scanned-paper-acc-9c4bd--actual-OCR-and-translation/actual-reopened.json','utf8'));
  const resume=process.env.PI_NUMBER_FONTS_RESUME?JSON.parse(await readFile(process.env.PI_NUMBER_FONTS_RESUME,'utf8')):undefined;
  const offline=process.env.PI_NUMBER_FONTS_OFFLINE==='1';
  const retry=(process.env.PI_NUMBER_FONTS_RETRY??'').split(',').filter(Boolean);
  const requestCap=Number(process.env.PI_NUMBER_FONTS_CAP??180);
  if(!Number.isInteger(requestCap)||requestCap<1||requestCap>180)throw new Error('Invalid actual request cap.');
  const apiKey=offline?'offline-no-credentials':process.env.QWEN_API_KEY!,base=process.env.QWEN_BASE_URL!,model=process.env.QWEN_MODEL!;
  if(!apiKey||!base||!model||offline&&!resume)throw new Error('Incomplete acceptance configuration.');
  const worker=context.serviceWorkers()[0]!;
  const report:any={source:'https://proceedings.mlr.press/v37/rezende15.pdf',pages:9,model,providerHost:new URL(base).hostname,offline,requestCap,steps:[],evidence:offline?'Saved actual results, fake credentials, provider requests blocked.':'Actual production translation of unmodified publisher PDF. Raw provider replies recorded; no request images, authorization, credentials or traces saved.',resume:process.env.PI_NUMBER_FONTS_RESUME};
  await worker.evaluate(({base,apiKey,offline,requestCap})=>{
    const s=globalThis as any,original=s.fetch.bind(s),host=new URL(base).hostname,pending:Promise<unknown>[]=[];
    s.fontCalls=[];s.fontReplies=[];s.fontFlush=()=>Promise.allSettled(pending);
    s.fetch=async(...args:any[])=>{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);
      if(new URL(url).hostname!==host)return original(...args);
      if(offline)throw new Error('Offline result verification blocks provider calls.');
      if(s.fontCalls.length>=requestCap)throw new Error('Acceptance request cap reached.');
      const body=JSON.parse(args[1]?.body??'{}');
      const call:any={id:s.fontCalls.length+1,image:(body.messages??[]).some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url')),startedAt:Date.now()};s.fontCalls.push(call);
      try{
        const response=await original(...args);call.status=response.status;
        pending.push(response.clone().text().then((body:string)=>{call.finishedAt=Date.now();s.fontReplies.push({id:call.id,status:response.status,body:body.replaceAll(apiKey,'[redacted]')})}).catch(()=>{call.streamAborted=true}));return response;
      }catch(error){call.error=(error as Error).name;throw error}
    };
  },{base,apiKey,offline,requestCap});
  let reader=await context.newPage();
  const snapshot=async(label:string)=>{
    const data=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(['pdfDocumentTranslationRetainedV1','pdfDocumentTranslationFixedV1']),session:await c.storage.session.get('pdfDocumentTranslationSessionsV1')}});
    await writeFile(info.outputPath(`${label}.json`),JSON.stringify(data,null,2));
    await writeFile(info.outputPath('runtime-checkpoint.json'),JSON.stringify(data,null,2));
    await writeFile(info.outputPath('actual-replies.json'),JSON.stringify(await worker.evaluate(()=>({calls:(globalThis as any).fontCalls,replies:(globalThis as any).fontReplies})),null,2));
    return data as any;
  };
  const current=(data:any)=>data.session.pdfDocumentTranslationSessionsV1.find((s:any)=>!baseline.session.pdfDocumentTranslationSessionsV1.some((old:any)=>old.documentKey===s.documentKey));
  const calls=()=>worker.evaluate(()=>(globalThis as any).fontCalls.length);
  const open=async()=>{await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(source);await expect(reader.locator('#page-count')).toHaveText('9');await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/idle|preparing/u)};
  let saving=false;const started=Date.now();
  const timer=setInterval(async()=>{if(saving||reader.isClosed())return;saving=true;try{await snapshot('progress-state');await writeFile(info.outputPath('progress.json'),JSON.stringify({seconds:Math.round((Date.now()-started)/1000),calls:await calls(),phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase'),status:await reader.locator('#pdf-document-translation-status').textContent()}))}catch{}finally{saving=false}},5000);
  try{
    await reader.setViewportSize({width:1400,height:1000});await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async({base,model,apiKey,seed})=>{const c=(globalThis as any).chrome,stored=await c.storage.local.get('extensionSettings');await c.storage.local.set({...seed.local,extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'实际整篇验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'实际公式验收',apiBaseUrl:base,model}]}});await c.storage.session.set({...seed.session,apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey}})},{base,model,apiKey,seed:resume??baseline});
    await open();await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-translation-skip-references').uncheck();await reader.locator('#pdf-document-translation-skip-appendix').uncheck();await reader.locator('#pdf-document-translation-retention-toggle').check();
    await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('180');
    await snapshot('before');await reader.screenshot({path:info.outputPath('preflight.png')});
    if(!resume){
      await reader.locator('#pdf-document-translation-primary').click();
      await expect.poll(async()=>worker.evaluate(async()=>{const s=(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1??[];return s.find((d:any)=>d.sourceFingerprint==='f23313ce8e35165be79324c4490e537dba349e19ff942cf368e6e8333df0c1b6')?.blocks?.length??0}),{timeout:180000}).toBeGreaterThan(0);
      if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')==='running')await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused',{timeout:180000});
      await expect.poll(()=>worker.evaluate(()=>(globalThis as any).fontCalls.every((c:any)=>c.finishedAt||c.error||c.streamAborted)),{timeout:180000}).toBe(true);
      const paused=current(await snapshot('paused')),count=await calls();await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1400,height:1000});await open();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');expect(await calls()).toBe(count);expect(current(await snapshot('reopened-paused')).blocks).toEqual(paused.blocks);
      report.steps.push({step:'Actual pause, closed/reopened, retained existing targets/formulas without extra provider request',requestsAtPause:count});
    }
    if(!offline&&await reader.locator('#pdf-document-translation').getAttribute('data-phase')!=='complete'){
      await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','running',{timeout:30000});
      await expect.poll(async()=>['complete','warning','paused','stopped','error'].includes(await reader.locator('#pdf-document-translation').getAttribute('data-phase')??''),{timeout:1800000,intervals:[2000,4000]}).toBe(true);
    }
    if(retry.length)await reader.locator('#pdf-document-translation-view-reading').click();
    for(const id of retry){
      const count=await calls(),block=reader.locator(`[data-translation-block="${id}"]`),action=block.locator('[data-review-retry]');
      await block.scrollIntoViewIfNeeded({timeout:15000});
      if(!await action.count()){report.steps.push({step:'Previously flagged block already resolved or migrated',block:id});continue}
      await expect(action).toBeVisible();
      await action.click();await expect.poll(calls,{timeout:30000}).toBeGreaterThan(count);
      await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/running|preparing/u,{timeout:240000});await snapshot(`retry-${id}`);
    }
    const completed=await snapshot('translated');report.phase=await reader.locator('#pdf-document-translation').getAttribute('data-phase');report.status=await reader.locator('#pdf-document-translation-status').textContent();
    report.review=current(completed).blocks.filter((b:any)=>b.formulaReviewMessage||b.visualFallbackMessage||b.retranslation).map((b:any)=>({signature:b.signature,formula:b.formulaReviewMessage,fallback:b.visualFallbackMessage,retranslation:b.retranslation}));
    report.cards=await reader.locator('[data-translation-block]').evaluateAll(nodes=>nodes.map(node=>({id:(node as HTMLElement).dataset.translationBlock,status:(node as HTMLElement).dataset.status,mode:(node as HTMLElement).dataset.translationMode,text:node.textContent})));
    for(const old of baseline.session.pdfDocumentTranslationSessionsV1){const retained=completed.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.documentKey===old.documentKey);expect(retained.blocks).toEqual(old.blocks);expect(retained.archivedBlocks).toEqual(old.archivedBlocks)}
    report.steps.push({step:'Previous actual Nash document, formula history and manual author untouched'});
    await reader.locator('#pdf-document-translation-view-reading').click();await reader.mouse.move(10,10);
    report.numbers=await reader.locator('.pi-equation-tag').allTextContents();
    report.mathFonts=await reader.locator('[data-translation-block] math mi').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,variant:n.getAttribute('mathvariant')})));
    await reader.screenshot({path:info.outputPath('reading.png')});
    for(const p of [2,3,4,5,6,7,8,9]){const section=reader.locator(`.pdf-document-translation-page[data-page-number="${p}"]`);if(await section.count()){await section.scrollIntoViewIfNeeded();await section.screenshot({path:info.outputPath(`reading-page-${p}.png`)})}}
    for(const [id,file] of [['pdf-document-translation-download-translation','translation.md'],['pdf-document-translation-download-bilingual','bilingual.md'],['pdf-document-translation-download-html','bilingual.html']]){const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const download=reader.waitForEvent('download');await reader.locator(`#${id}`).click();await(await download).saveAs(info.outputPath(file!))}
    const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const printing=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();const preview=await printing;await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true',{timeout:30000});
    report.layout={mathNodes:await preview.locator('math').count(),pages:await preview.locator('.pdf-layout-continuation').evaluateAll(nodes=>nodes.map(n=>({overflowX:n.scrollWidth-n.clientWidth,overflowY:n.scrollHeight-n.clientHeight})))};
    const cdp=await context.newCDPSession(preview),pdf=await cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(info.outputPath('bilingual.pdf'),Buffer.from(pdf.data,'base64'));await cdp.detach();await preview.close();
    const count=await calls();await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1400,height:1000});await open();expect(await calls()).toBe(count);const ordered=(blocks:any[])=>blocks.slice().sort((a,b)=>a.signature.localeCompare(b.signature));expect(ordered(current(await snapshot('reopened')).blocks)).toEqual(ordered(current(completed).blocks));
    await reader.setViewportSize({width:360,height:800});await reader.emulateMedia({colorScheme:'dark'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath('reopened-360-dark.png')});
    report.steps.push({step:'Four exports and final close/reopen retain actual targets and formulas; no extra calls'});
    expect(report.phase).toBe('complete');expect(report.review).toEqual([]);
    expect(report.numbers.slice().sort((a:string,b:string)=>parseInt(a.slice(1))-parseInt(b.slice(1)))).toEqual(Array.from({length:20},(_,i)=>`(${i+1})`));
  }catch(error){report.failure=(error as Error).message;await snapshot('failure').catch(()=>undefined);await reader.screenshot({path:info.outputPath('failure.png')}).catch(()=>undefined);throw error}
  finally{
    clearInterval(timer);await snapshot('final-state').catch(()=>undefined);await worker.evaluate(async()=>{await(globalThis as any).fontFlush()}).catch(()=>undefined);
    const evidence=await worker.evaluate(()=>({calls:(globalThis as any).fontCalls,replies:(globalThis as any).fontReplies}));report.calls=evidence.calls;report.seconds=Math.round((Date.now()-started)/1000);
    await writeFile(info.outputPath('actual-replies.json'),JSON.stringify(evidence,null,2));await writeFile(info.outputPath('actual-report.json'),JSON.stringify(report,null,2));if(!reader.isClosed())await reader.close();
  }
});
