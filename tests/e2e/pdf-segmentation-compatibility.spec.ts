import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {openPdfTranslationOptions} from './support/pdf-controls';

installEdgeExtensionHooks();
test.use({trace:'off'});
test.skip(process.env.PI_PDF_COMPATIBILITY_ACCEPTANCE!=='1','Opt-in native public PDF and immutable actual checkpoint.');
const root=path.resolve(process.env.PI_PDF_COMPATIBILITY_OUTPUT??'output/pdf/compatibility-workflow-2026-10-15');
const source=path.resolve('output/pdf/live-workflow-2026-10-15/source/conditional-neural-processes.pdf');
const original=path.resolve('output/pdf/live-workflow-2026-10-15/final-artifacts/pdf-actual-export-review-r-fc727-ions-and-mathematical-fonts/proofread-checkpoint.json');

test('restores old segmentation without losing corrections, then validates the changed paragraph and reading workflow',async({},info)=>{
  test.setTimeout(600_000);await mkdir(root,{recursive:true});
  const replay=process.env.PI_PDF_COMPATIBILITY_REPLAY;
  const live=process.env.PI_PDF_COMPATIBILITY_LIVE==='1'&&!replay;
  const checkpoint=JSON.parse(await readFile(original,'utf8'));const old=checkpoint.retained[0];
  const worker=context.serviceWorkers()[0]!;
  const libraryId=JSON.stringify(['pdf',old.documentKey,old.targetLanguage,old.sourceLanguage,old.style,old.contentMode]);
  const apiKey=live?process.env.QWEN_API_KEY:undefined,base=live?process.env.QWEN_BASE_URL:undefined,model=live?process.env.QWEN_MODEL:undefined;
  if(live&&(!apiKey||!base||!model))throw new Error('Actual model configuration missing.');
  const steps:any[]=[];let reader=await context.newPage();const options=await context.newPage();let preview:Page|undefined;
  const requests=()=>worker.evaluate(()=>(globalThis as any).piCompatibilityRequests?.length??0);
  const snapshot=async(name:string)=>{
    const data=await worker.evaluate(async()=>{
      const c=(globalThis as any).chrome,local=await c.storage.local.get(null);
      const fixed=Object.entries(local).filter(([key])=>key.startsWith('fixedDocumentTranslationV1:["pdf",')).map(([,value])=>value as any);
      const rolling=local.pdfDocumentTranslationRetainedV1??[],seen=new Set<string>();
      const retained=[...fixed,...rolling].filter(record=>{const id=JSON.stringify([record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);if(seen.has(id))return false;seen.add(id);return true});
      return{sessions:(await c.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1??[],retained,fixedCount:fixed.length,rollingCount:rolling.length};
    });
    const result={sourceUrl:checkpoint.sourceUrl,citation:checkpoint.citation,model:model??checkpoint.model,providerHost:base?new URL(base).hostname:checkpoint.providerHost,...data,
      evidence:live?'Historical actual translations plus at most one new actual paragraph; see workflow-report for requests and results.':replay?'Historical actual translations and the independently recorded complete checkpoint reused offline; no new provider request.':'Historical actual translation migration only; the changed paragraph remains pending.'};
    await writeFile(info.outputPath(name+'.json'),JSON.stringify(result,null,2));return result;
  };
  const open=async(phase='paused')=>{await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(libraryId)}`);await reader.locator('#file-input').setInputFiles(source);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase',phase);};
  const download=async(id:string,name:string)=>{const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const pending=reader.waitForEvent('download');await reader.locator('#'+id).click();await(await pending).saveAs(info.outputPath(name));return info.outputPath(name)};
  try{
    await reader.setViewportSize({width:1350,height:960});await reader.emulateMedia({reducedMotion:'reduce'});
    await worker.evaluate(async({old,base,model,apiKey})=>{
      const c=(globalThis as any).chrome;const settings=(await c.storage.local.get('extensionSettings')).extensionSettings;
      await c.storage.local.clear();await c.storage.session.clear();
      await c.storage.local.set({extensionSettings:base?{...settings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'实际模型验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'实际模型验收',apiBaseUrl:base,model}]}:settings,pdfDocumentTranslationRetainedV1:[old]});
      if(apiKey)await c.storage.session.set({apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey}});
      const scope=globalThis as any;scope.piCompatibilityRequests=[];scope.piCompatibilityReplies=[];
      if(!base)return;const originalFetch=scope.fetch.bind(scope);const pending:Promise<unknown>[]=[];
      scope.piCompatibilityFlush=()=>Promise.allSettled(pending);
      scope.fetch=async(...args:any[])=>{
        const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);
        if(!url.startsWith(base.replace(/\/+$/u,''))||!url.includes('/chat/completions'))return originalFetch(...args);
        if(scope.piCompatibilityRequests.length>=3)throw new Error('Acceptance request cap reached.');
        const record:any={id:scope.piCompatibilityRequests.length+1,startedAt:Date.now()};scope.piCompatibilityRequests.push(record);
        try{const response=await originalFetch(...args);record.status=response.status;
          pending.push(response.clone().text().then((body:string)=>{record.finishedAt=Date.now();scope.piCompatibilityReplies.push({id:record.id,status:response.status,body:body.replaceAll(apiKey!,'[redacted]')})}).catch(()=>{record.streamAborted=true}));return response;
        }catch(error){record.error=(error as Error).name;throw error;}
      };
    },{old,base,model,apiKey});
    await open();await expect(reader.locator('.pdf-document-translation-block')).toHaveCount(128);
    await expect(reader.locator('[data-status="done"]')).toHaveCount(128);
    await expect(reader.locator('[data-translation-block="P3B18"]')).toHaveCount(0); // Idle blocks are represented by progress, not empty reading cards.
    await expect(reader.locator('[data-translation-block="P3B19"]')).toHaveCount(0);
    await expect(reader.locator('[data-translation-block="P8B3"]')).toContainText('单样本分类任务');
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open','');
    await expect.poll(async()=>{const data=await snapshot('migration-progress');return data.retained[0]?.archivedBlocks?.length}).toBe(2);
    const migrated=await snapshot('migrated');const saved=migrated.retained[0];
    expect(saved.documentSignatures).toHaveLength(129);expect(saved.blocks).toHaveLength(85);
    expect(migrated.sessions[0].archivedBlocks).toEqual(saved.archivedBlocks);
    const all=new Map([...saved.blocks,...saved.archivedBlocks].map((block:any)=>[block.signature,block]));
    for(const block of old.blocks)expect(all.get(block.signature)).toEqual(block);
    const oldFile=await download('pdf-document-translation-download-archive','old-segments.md');
    const oldText=await readFile(oldFile,'utf8');expect(oldText).toContain('旧分段译文备查');expect(oldText).toContain('经验条件分布');expect(oldText).toContain('f \\sim P');
    steps.push({step:'130 to 129 segmentation migration',unchangedActualTargets:85,archivedOldTargets:2,preservedReferenceEntries:43,newParagraphsPending:1,originalCheckpointUnmodified:true});
    await reader.locator('[data-translation-block="P3B20"]').scrollIntoViewIfNeeded();await reader.screenshot({path:info.outputPath('migration.png')});
    await reader.close();reader=await context.newPage();await open();expect(await requests()).toBe(0);
    steps.push({step:'close and reopen migrated pending task',extraRequests:0});
    if(!live&&!replay)return;
    if(live){
    await openPdfTranslationOptions(reader);await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('1');
    // Pause during preparation before sending, then resume from a closed reader.
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','running');
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    const pausedRequests=await requests();await reader.close();reader=await context.newPage();await open();expect(await requests()).toBe(pausedRequests);
    steps.push({step:'manual pause, close, restore pending paragraph',requestsBeforeResume:pausedRequests});
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete',{timeout:240_000});
    }else{
      const actual=JSON.parse(await readFile(replay!,'utf8'));
      expect(actual.sourceUrl).toBe(checkpoint.sourceUrl);expect(actual.retained[0].sourceFingerprint).toBe(old.sourceFingerprint);
      await reader.close();await worker.evaluate(async record=>{const c=(globalThis as any).chrome;await c.storage.session.remove('pdfDocumentTranslationSessionsV1');await c.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},actual.retained[0]);
      reader=await context.newPage();await open('complete');steps.push({step:'reuse independently verified new actual checkpoint',extraRequests:0,checkpoint:replay});
    }
    await expect(reader.locator('[data-status="done"]')).toHaveCount(129);await expect(reader.locator('.pdf-formula-reference-review')).toHaveCount(0);
    const complete=await snapshot('actual-complete');complete.evidence=live?'Historical actual targets preserved by exact signature; newly merged P3B18 independently translated by actual provider in this run. No concatenated target fixture used.':'Historical actual targets preserved by exact signature; P3B18 reuses the independently recorded actual result. This run is offline replay with zero new provider requests, not a new model-quality evaluation.';
    if(live)await writeFile(path.join(root,'actual-complete-checkpoint.json'),JSON.stringify(complete,null,2));
    const next=complete.retained[0];expect(next.blocks).toHaveLength(86);expect(next.archivedBlocks).toEqual(saved.archivedBlocks);
    for(const block of saved.blocks)expect(next.blocks.find((candidate:any)=>candidate.signature===block.signature)).toEqual(block);
    const first=reader.locator('[data-translation-block="P3B18"]');await expect(first).toContainText('经验');await expect(first).toContainText('条件分布');
    await expect(first.locator('math')).not.toHaveCount(0);await reader.locator('#pdf-document-translation-view-reading').click();await first.scrollIntoViewIfNeeded();await reader.screenshot({path:info.outputPath('actual-combined-paragraph.png')});
    steps.push({step:live?'actual full-sentence translation':'new actual full-sentence result reused',block:'P3B18',requests:await requests(),noDraftsOrFallbacks:true});
    await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-query').fill('单样本分类任务');await expect(reader.locator('#pdf-search-status')).toContainText('1 / 2');await reader.locator('#pdf-search-query').press('Enter');await expect(reader.locator('#pdf-search-status')).toContainText('2 / 2');await expect(reader.locator('.pdf-search-translation-current')).toBeInViewport();await reader.locator('#pdf-search-query').press('Escape');
    const block=reader.locator('[data-translation-block="P8B3"]');const math=()=>block.locator('math mi').evaluateAll(elements=>elements.map(el=>({text:el.textContent,variant:el.getAttribute('mathvariant')})));
    const beforeMath=await math();await block.hover();await block.locator('.pdf-paragraph-edit-action').click();const input=reader.locator('#pdf-paragraph-editor textarea').first();const beforeText=await input.inputValue();await input.fill('【迁移后校订】'+beforeText);await reader.locator('#pdf-paragraph-editor-save').click();await expect(block).toContainText('【迁移后校订】');expect(await math()).toEqual(beforeMath);
    const corrected=await download('pdf-document-translation-download-translation','corrected.md');expect(await readFile(corrected,'utf8')).toContain('【迁移后校订】');
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-undo-correction').click();await expect(block).not.toContainText('【迁移后校订】');
    for(const [id,name] of [['pdf-document-translation-download-translation','translation.md'],['pdf-document-translation-download-bilingual','bilingual.md'],['pdf-document-translation-download-html','bilingual.html']])await download(id!,name!);
    const menu=reader.locator('#pdf-document-translation-copy-menu');await menu.locator(':scope > summary').click();const popup=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();preview=await popup;
    await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true',{timeout:90_000});await expect(preview.locator('[data-layout-block-id]')).toHaveCount(129);await expect(preview.locator('[data-layout-source-page]')).toHaveCount(10);
    await preview.emulateMedia({media:'print'});expect(await preview.locator('[data-layout-translation-page]').evaluateAll(elements=>elements.filter(el=>el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1).length)).toBe(0);
    for(const number of ['1','2','3','4'])await expect(preview.locator('.pi-equation-tag').filter({hasText:new RegExp(`^\\(${number}\\)$`,'u')})).toHaveCount(1);
    const annotations=await preview.locator('math annotation').allTextContents();expect(annotations.some(text=>text.includes('mathbb{R}'))).toBe(true);expect(annotations.some(text=>text.includes('mathcal{L}'))).toBe(true);
    const group=preview.locator('[data-layout-list]').filter({has:preview.locator('[data-layout-block-id="P3B18"]')});await expect(group.locator('[data-layout-block-id]')).toHaveCount(3);await group.screenshot({path:info.outputPath('actual-list-export.png')});
    const client=await context.newCDPSession(preview);const pdf=await client.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});await writeFile(path.join(root,'原页对照.pdf'),Buffer.from(pdf.data,'base64'));await writeFile(path.join(root,'原页对照.html'),await preview.content());
    steps.push({step:'search, formula-locked correction, export, undo and complete layout',blocks:129,equationNumbers:[1,2,3,4],noClipping:true,translationPages:await preview.locator('[data-layout-translation-page]').count(),formulaFontVariantsPreserved:true});
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);let row=options.locator('.library-entry').first();await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'固定保存',exact:true}).click();await expect(row).toContainText('已固定');
    await options.locator('#library-storage-tools > summary').click();const backup=options.waitForEvent('download');await options.locator('#export-library-backup').click();await(await backup).saveAs(info.outputPath('library-backup.json'));const backupText=await readFile(info.outputPath('library-backup.json'),'utf8');expect(backupText).toContain('archivedBlocks');if(apiKey)expect(backupText.includes(apiKey),'Backup must not contain credentials').toBe(false);
    const doneRequests=await requests();await reader.close();await worker.evaluate(async()=>{const c=(globalThis as any).chrome;await c.storage.session.clear();const data=await c.storage.local.get(null);await c.storage.local.remove(Object.keys(data).filter(key=>key.startsWith('fixedDocumentTranslationV1:')||key==='pdfDocumentTranslationRetainedV1'))});
    await options.locator('#library-backup-input').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backupText)});await expect(options.locator('#retained-storage-action-status')).toContainText('已恢复 1 份文档');row=options.locator('.library-entry').first();await expect(row).toContainText('已固定');
    await context.setOffline(true);reader=await context.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(libraryId)}`);await reader.locator('#file-input').setInputFiles({name:'modified.pdf',mimeType:'application/pdf',buffer:Buffer.concat([await readFile(source),Buffer.from('\n% changed bytes\n')])});await expect(reader.locator('#notice')).toContainText('不是保留译文对应的原 PDF');
    await open('complete');await expect(reader.locator('[data-translation-block="P8B3"]')).toContainText('单样本分类任务');await expect(reader.locator('[data-translation-block="P8B3"]')).not.toContainText('【迁移后校订】');expect(await requests()).toBe(doneRequests);
    await reader.setViewportSize({width:300,height:650});await reader.emulateMedia({colorScheme:'dark'});await reader.locator('[data-translation-block="P3B18"]').scrollIntoViewIfNeeded();expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath('restored-narrow.png')});
    await snapshot('final');steps.push({step:'fixed library backup round trip, wrong-file rejection, offline recovery without API key and narrow reading',extraRequests:0,archivedTargets:2});expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{
    await snapshot('last-state').catch(()=>undefined);
    await reader.screenshot({path:info.outputPath('last-ui.png')}).catch(()=>undefined);
    await context.setOffline(false);await worker.evaluate(async()=>{await(globalThis as any).piCompatibilityFlush?.()});
    const evidence=await worker.evaluate(()=>({requests:(globalThis as any).piCompatibilityRequests,replies:(globalThis as any).piCompatibilityReplies}));
    await writeFile(info.outputPath('workflow-report.json'),JSON.stringify({evidence:live?'Actual provider call for changed full paragraph; historical unchanged actual results; local interactions':replay?'Complete reading workflow with actual checkpoint, no additional model calls':'Historical actual result migration only; no new model quality claim',original,steps,...evidence},null,2));
    await preview?.close();await reader.close();await options.close();
  }
});
