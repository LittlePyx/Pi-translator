import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';
import {openPdfTranslationOptions,openPdfTranslationSettings} from './support/pdf-controls';

installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_READING_ACCEPTANCE!=='1','Opt-in actual public-paper workflow only.');
test.use({trace:'off'});
const evidenceDirectory=path.resolve('output/pdf/live-workflow-2026-10-15');
const checkpointFile=path.join(evidenceDirectory,'runtime-checkpoint.json');
const sourceUrl='https://proceedings.mlr.press/v80/garnelo18a/garnelo18a.pdf';
const citation='Garnelo et al. (2018), Conditional Neural Processes. ICML, PMLR 80:1704–1713. https://proceedings.mlr.press/v80/garnelo18a.html · CC BY 4.0. Machine translation by Pi Translator; not author-reviewed.';

test('accepts a complete public paper through real translation, pause, restart, correction and exports',async({},info)=>{
  test.setTimeout(1_200_000);
  const apiKey=process.env.QWEN_API_KEY!,base=process.env.QWEN_BASE_URL!,model=process.env.QWEN_MODEL!;
  const source=process.env.PI_PDF_REGRESSION_SOURCE!;
  if(!apiKey||!base||!model||!source)throw new Error('Live acceptance configuration is incomplete.');
  const worker=context.serviceWorkers()[0]!;
  const resume=process.env.PI_LIVE_READING_RESUME?JSON.parse(await readFile(process.env.PI_LIVE_READING_RESUME,'utf8')):undefined;
  if(resume&&(resume.model!==model||resume.providerHost!==new URL(base).hostname||resume.sourceUrl!==sourceUrl))throw new Error('Checkpoint does not match this source and model.');
  await worker.evaluate(({base,apiKey})=>{
    const scope=globalThis as any,original=scope.fetch.bind(scope);scope.piReadingRequests=[];scope.piReadingReplies=[];
    const pending:Promise<unknown>[]=[];scope.piReadingFlush=()=>Promise.allSettled(pending);
    scope.fetch=async(...args:any[])=>{
      const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);
      if(!url.startsWith(base.replace(/\/+$/u,''))||!url.includes('/chat/completions'))return original(...args);
      const id=scope.piReadingRequests.length+1;const record:any={id,startedAt:Date.now()};scope.piReadingRequests.push(record);
      try{
        const response=await original(...args);record.status=response.status;
        pending.push(response.clone().text().then((body:string)=>{record.finishedAt=Date.now();scope.piReadingReplies.push({id,status:response.status,body:body.replaceAll(apiKey,'[redacted]')})}).catch(()=>{record.streamAborted=true}));
        return response;
      }catch(error){record.aborted=(error as Error).name==='AbortError';record.error=(error as Error).name;throw error;}
    };
  },{base,apiKey});
  let reader=await context.newPage();const options=await context.newPage();
  const report:any={sourceUrl,citation,model,providerHost:new URL(base).hostname,requestLimit:180,
    evidence:resume?'Saved actual results reused; any additional provider replies recorded below; public CC BY paper; isolated profile; no request bodies, credentials or traces recorded':'Fresh actual provider replies; public CC BY paper; isolated profile; no request bodies, credentials or traces recorded',
    resume:resume?process.env.PI_LIVE_READING_RESUME:undefined,steps:[]};
  const requests=()=>worker.evaluate(()=>(globalThis as any).piReadingRequests.length as number);
  const save=async(label:string)=>{
    const data=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;const s=await c.storage.session.get('pdfDocumentTranslationSessionsV1');const l=await c.storage.local.get('pdfDocumentTranslationRetainedV1');return{sessions:s.pdfDocumentTranslationSessionsV1??[],retained:l.pdfDocumentTranslationRetainedV1??[]}});
    const snapshot={sourceUrl,citation,model,providerHost:new URL(base).hostname,...data};
    await writeFile(checkpointFile,JSON.stringify(snapshot,null,2));
    await writeFile(info.outputPath(`${label}-checkpoint.json`),JSON.stringify(snapshot,null,2));return snapshot;
  };
  const open=async()=>{await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(source);await expect(reader.locator('#page-count')).toHaveText('10');await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/idle|preparing/u)};
  let monitoring=false;const started=Date.now();
  const timer=setInterval(async()=>{if(monitoring||reader.isClosed())return;monitoring=true;try{await writeFile(info.outputPath('progress.json'),JSON.stringify({seconds:Math.round((Date.now()-started)/1000),requests:await requests(),phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase'),status:await reader.locator('#pdf-document-translation-status').textContent()}))}catch{}finally{monitoring=false}},5000);
  try{
    await reader.setViewportSize({width:1450,height:1000});await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async({base,model,apiKey,resume})=>{
      const c=(globalThis as any).chrome,stored=await c.storage.local.get('extensionSettings');
      await c.storage.local.set({extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'全文实际验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'全文视觉验收',apiBaseUrl:base,model}]},...(resume?{pdfDocumentTranslationRetainedV1:resume.retained}:{})});
      await c.storage.session.set({apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey},...(resume?{pdfDocumentTranslationSessionsV1:resume.sessions}:{})});
    },{base,model,apiKey,resume});
    await open();await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-translation-skip-references').uncheck();await reader.locator('#pdf-document-translation-skip-appendix').uncheck();
    await reader.locator('#pdf-document-translation-retention-toggle').check();
    await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('1');
    await reader.screenshot({path:info.outputPath('preflight.png')});
    if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')!=='complete'&&process.env.PI_LIVE_READING_FINISH_ONLY==='1'){
      await reader.locator('#pdf-document-request-limit').fill('180');await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:900_000});
      report.steps.push({step:'targeted continuation of actual v3 after final source-boundary fix; pause and restart already verified in actual v3',requests:await requests()});
    }else if(await reader.locator('#pdf-document-translation').getAttribute('data-phase')!=='complete'){
      await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused',{timeout:180_000});
      const paused=await save('budget-paused');report.steps.push({step:'request-limit pause',requests:await requests(),savedBlocks:paused.sessions[0]?.blocks.length});
      await reader.screenshot({path:info.outputPath('paused.png')});
      const before=await requests();await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1450,height:1000});await open();
      await expect(reader.locator('#pdf-document-translation-status')).toContainText('恢复');expect(await requests()).toBe(before);
      const reopened=await save('reopened');
      const bySignature=(blocks:any[])=>[...blocks].sort((a,b)=>a.signature.localeCompare(b.signature));
      expect(bySignature(reopened.sessions[0]?.blocks??[])).toEqual(bySignature(paused.sessions[0]?.blocks??[]));
      report.steps.push({step:'close and reopen paused task',extraRequests:(await requests())-before});
      await openPdfTranslationOptions(reader);if(await reader.locator('#pdf-document-budget-details').getAttribute('open')===null)await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('180');
      await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','running',{timeout:30_000});
      await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');await save('manual-paused');
      report.steps.push({step:'manual pause after resume',requests:await requests()});
      await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:900_000});
    }
    const translated=await save('translated');report.steps.push({step:'translation finished',status:await reader.locator('#pdf-document-translation-status').textContent(),requests:await requests()});
    if(process.env.PI_LIVE_TABLE_VERIFICATION==='1'){
      const prepared=JSON.parse(await readFile(path.join(evidenceDirectory,'prepared-source.json'),'utf8')).blocks;
      const index=prepared.findIndex((block:any)=>block.text.startsWith('Table 2.'));
      const table=translated.sessions[0].blocks.find((block:any)=>block.signature===translated.sessions[0].documentSignatures[index]);
      expect(table.translatedText).toMatch(/运行|复杂度/u);
      for(const row of [/MANN[^\n]*82\.8%[^\n]*94\.9%/u,/MN[^\n]*98\.1%[^\n]*98\.9%[^\n]*93\.8%[^\n]*98\.5%/u,/CNP[^\n]*95\.3%[^\n]*98\.5%[^\n]*89\.9%[^\n]*96\.8%/u])expect(table.translatedText).toMatch(row);
      expect(translated.sessions[0].blocks.filter((block:any)=>block.visualFallbackMessage||block.formulaReviewMessage)).toEqual([]);
      report.steps.push({step:'complete Table 2: translated header and all three numeric rows verified',blockId:prepared[index].id});
    }
    report.cards=await reader.locator('[data-translation-block]').evaluateAll(elements=>elements.map(element=>({id:(element as HTMLElement).dataset.translationBlock,status:(element as HTMLElement).dataset.status,mode:(element as HTMLElement).dataset.translationMode,text:element.textContent})));
    report.reviewCount=await reader.locator('.pdf-formula-reference-review').count();
    await reader.locator('#pdf-document-translation-view-reading').click();await reader.screenshot({path:info.outputPath('reading.png')});
    for(let page=1;page<=10;page++){
      const section=reader.locator(`.pdf-document-translation-page[data-page-number="${page}"]`);
      if(await section.count()){await section.scrollIntoViewIfNeeded();await section.screenshot({path:info.outputPath(`translated-page-${page}.png`)});}
    }
    const exportFile=async(id:string,filename:string)=>{const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const download=reader.waitForEvent('download');await reader.locator(`#${id}`).click();await(await download).saveAs(info.outputPath(filename))};
    await exportFile('pdf-document-translation-download-translation','actual-translation.md');await exportFile('pdf-document-translation-download-bilingual','actual-bilingual.md');await exportFile('pdf-document-translation-download-html','actual-bilingual.html');
    const markdown=await readFile(info.outputPath('actual-translation.md'),'utf8');expect(markdown).toMatch(/\p{Script=Han}/u);
    const local=await save('before-library');
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const row=options.locator('.library-entry').first();await expect(row).toBeVisible();
    await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'固定保存',exact:true}).click();await expect(row).toContainText('已固定');
    const libraryId=await row.getAttribute('data-library-id');
    await options.locator('#library-storage-tools > summary').click();const backup=options.waitForEvent('download');await options.locator('#export-library-backup').click();await(await backup).saveAs(info.outputPath('actual-library-backup.json'));
    const completedRequests=await requests();await reader.close();
    await worker.evaluate(async()=>{await(globalThis as any).chrome.storage.session.clear()});await context.setOffline(true);
    reader=await context.newPage();await reader.setViewportSize({width:1450,height:1000});
    const restore=async()=>{await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(libraryId!)}`);await reader.locator('#file-input').setInputFiles(source);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:30_000})};
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(libraryId!)}`);
    await reader.locator('#file-input').setInputFiles({name:'modified-source.pdf',mimeType:'application/pdf',buffer:Buffer.concat([await readFile(source),Buffer.from('\n% acceptance: changed source bytes\n')])});
    await expect(reader.locator('#notice')).toContainText('不是保留译文对应的原 PDF');
    report.steps.push({step:'modified PDF with same page content rejected by SHA-256 fingerprint',extraRequests:0});
    await restore();expect(await requests()).toBe(completedRequests);report.steps.push({step:'offline library recovery after session loss, without API key',extraRequests:0});
    const editable=local.retained[0].blocks.find((block:any)=>block.formulaDocument&&/[\u4e00-\u9fff]/u.test(block.translatedText));
    if(!editable)throw new Error('No formula-bearing translated paragraph available for correction.');
    const sourceSession=local.sessions[0];const index=sourceSession.documentSignatures.indexOf(editable.signature);
    const prepared=JSON.parse(await readFile(path.join(evidenceDirectory,'prepared-source.json'),'utf8'));const blockId=prepared.blocks[index].id;
    const block=reader.locator(`[data-translation-block="${blockId}"]`);
    const beforeMath=await block.locator('math mi').evaluateAll(elements=>elements.map(el=>({text:el.textContent,variant:el.getAttribute('mathvariant')})));
    await block.hover();await block.locator('.pdf-paragraph-edit-action').click();const input=reader.locator('#pdf-paragraph-editor textarea').first();const beforeText=await input.inputValue();await input.fill('【人工校订验收】'+beforeText);
    await reader.screenshot({path:info.outputPath('actual-correction.png')});await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();await expect(block).toContainText('【人工校订验收】');
    expect(await block.locator('math mi').evaluateAll(elements=>elements.map(el=>({text:el.textContent,variant:el.getAttribute('mathvariant')})))).toEqual(beforeMath);
    await exportFile('pdf-document-translation-download-translation','actual-corrected-translation.md');expect(await readFile(info.outputPath('actual-corrected-translation.md'),'utf8')).toContain('【人工校订验收】');
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-undo-correction').click();await expect(block).not.toContainText('【人工校订验收】');
    report.steps.push({step:'formula-protected correction, save, export and undo',blockId,formulaEntries:editable.formulaDocument.formulas.length,mathFontVariantsPreserved:true});
    expect(await requests()).toBe(completedRequests);
    await reader.close();reader=await context.newPage();await restore();await expect(reader.locator(`[data-translation-block="${blockId}"]`)).not.toContainText('【人工校订验收】');
    await reader.setViewportSize({width:360,height:700});await reader.emulateMedia({colorScheme:'dark'});await reader.screenshot({path:info.outputPath('actual-restored-narrow.png')});
    await save('final');report.steps.push({step:'persisted undo and second offline recovery',extraRequests:0});
  }finally{
    clearInterval(timer);await context.setOffline(false);
    report.finalStatus=await reader.locator('#pdf-document-translation-status').textContent().catch(()=>null);
    await save('final-state').catch(()=>undefined);
    await worker.evaluate(async()=>{await(globalThis as any).piReadingFlush()}).catch(()=>undefined);
    report.requests=await worker.evaluate(()=>(globalThis as any).piReadingRequests).catch(()=>[]);
    report.replies=await worker.evaluate(()=>(globalThis as any).piReadingReplies).catch(()=>[]);
    report.seconds=Math.round((Date.now()-started)/1000);
    await writeFile(info.outputPath('actual-workflow-report.json'),JSON.stringify(report,null,2).replaceAll(apiKey,'[redacted]'));
    if(!reader.isClosed())await reader.close();await options.close();
  }
});
