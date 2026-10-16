import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pdfDocumentTranslationSessionBlockSignature} from '../../core/pdf/document-translation-session';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
test.skip(!process.env.PI_NUMBER_FONTS_RESTORED,'Opt-in saved actual normalizing-flow results; no provider calls.');
test.use({trace:'off'});
test('restores actual numbered formulas, local corrections and structured exports without provider calls',async({},info)=>{
  test.setTimeout(180000);
  const root=path.resolve('output/pdf/number-fonts-2026-10-16'),seed=JSON.parse(await readFile(process.env.PI_NUMBER_FONTS_RESTORED!,'utf8'));
  const worker=context.serviceWorkers()[0]!;
  let attempts=0;await context.route('https://dashscope.aliyuncs.com/**',route=>{attempts++;return route.abort()});
  await worker.evaluate(()=>{const g=globalThis as any,fetch=g.fetch.bind(g);g.fontOfflineAttempts=0;g.fetch=(...args:any[])=>{const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);if(new URL(url).hostname==='dashscope.aliyuncs.com'){g.fontOfflineAttempts++;throw new Error('Provider blocked in saved-result acceptance')}return fetch(...args)}});
  let reader=await context.newPage();
  const snapshot=async(name:string)=>{const data=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(['pdfDocumentTranslationRetainedV1','pdfDocumentTranslationFixedV1']),session:await c.storage.session.get('pdfDocumentTranslationSessionsV1')}});await writeFile(info.outputPath(`${name}.json`),JSON.stringify(data,null,2));return data as any};
  const current=(data:any)=>data.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.sourceFingerprint.startsWith('f233'));
  const open=async()=>{await reader.setViewportSize({width:1100,height:900});await reader.emulateMedia({reducedMotion:'reduce'});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(path.join(root,'source/rezende15.pdf'));await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await reader.locator('#pdf-document-translation-view-reading').click()};
  try{
    await worker.evaluate(async({seed,base,model})=>{const c=(globalThis as any).chrome,stored=await c.storage.local.get('extensionSettings');await c.storage.local.set({...seed.local,extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'保存结果恢复验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'保存结果公式验收',apiBaseUrl:base,model}]}});await c.storage.session.set({...seed.session,apiKeysByProfile:{default:'offline-no-credentials','vision-e2e':'offline-no-credentials'}})},{seed,base:process.env.QWEN_BASE_URL!,model:process.env.QWEN_MODEL!});
    await open();await expect(reader.locator('.pi-equation-tag')).toHaveCount(20);
    const prepared=JSON.parse(await readFile(path.join(root,process.env.PI_NUMBER_FONTS_LAYOUT??'prepared-source-v6.json'),'utf8'));
    const source=prepared.blocks.find((b:any)=>b.text.startsWith('Normalizing flows and this free energy bound'));
    const signature=pdfDocumentTranslationSessionBlockSignature(source.pageNumber,source.text,0);
    const original=current(await snapshot('before')),originalBlock=original.blocks.find((b:any)=>b.signature===signature);
    expect(originalBlock).toBeTruthy();
    // Critical crop screenshots remain at normal reading size, never a reduced whole-page montage.
    const critical=prepared.blocks.filter((b:any)=>b.sourceEquations?.some((e:any)=>['1','10','14','15','16','20'].includes(e.number))||/^Figure 4\.|^Table 3\./u.test(b.text));
    for(const {id} of critical){
      const block=reader.locator(`[data-translation-block="${id}"]`);await expect(block).toBeVisible();await block.scrollIntoViewIfNeeded();await reader.mouse.move(0,0);await block.screenshot({path:info.outputPath(`${id}.png`)});
    }
    expect(source).toBeTruthy();const block=reader.locator(`[data-translation-block="${source.id}"]`);
    await block.hover();await block.locator('.pdf-paragraph-edit-action').click();
    const input=reader.locator('#pdf-paragraph-editor textarea').first(),note='（校订恢复验收用注记，非论文原文）';
    await input.fill((await input.inputValue())+note);await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();
    await expect(block).toContainText(note);const corrected=current(await snapshot('corrected')).blocks.find((b:any)=>b.signature===originalBlock.signature);
    expect(corrected.formulaDocument.formulas).toEqual(originalBlock.formulaDocument.formulas);expect(corrected.manualCorrection).toBe(true);
    const revision=corrected.revisions.find((r:any)=>r.reason==='correction'&&r.translatedText===originalBlock.translatedText);expect(revision).toBeTruthy();
    await reader.close();reader=await context.newPage();await open();await expect(reader.locator(`[data-translation-block="${source.id}"]`)).toContainText(note);
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-history').click();await reader.locator('#pdf-history-paragraph').selectOption(originalBlock.signature);await reader.locator('#pdf-history-version').selectOption(revision.id);
    await reader.setViewportSize({width:360,height:800});await reader.emulateMedia({colorScheme:'dark'});await reader.screenshot({path:info.outputPath('history-360-dark.png')});
    await reader.locator('#pdf-history-restore').click();await expect(reader.locator('#pdf-history-dialog')).not.toBeVisible();
    const restored=current(await snapshot('history-restored')).blocks.find((b:any)=>b.signature===originalBlock.signature);expect(restored.translatedText).toBe(originalBlock.translatedText);expect(restored.formulaDocument).toEqual(originalBlock.formulaDocument);
    await reader.setViewportSize({width:1100,height:900});await reader.emulateMedia({colorScheme:'light'});
    await expect(reader.locator('[data-object-role="table"] table')).toHaveCount(3);
    for(const [id,file] of [['pdf-document-translation-download-translation','translation.md'],['pdf-document-translation-download-bilingual','bilingual.md'],['pdf-document-translation-download-html','bilingual.html']]){const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const downloading=reader.waitForEvent('download');await reader.locator(`#${id}`).click();await(await downloading).saveAs(info.outputPath(file!))}
    const html=await readFile(info.outputPath('bilingual.html'),'utf8');expect((html.match(/<table /gu)??[]).length).toBe(3);
    const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const printing=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();const preview=await printing;await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true');await expect(preview.locator('table')).toHaveCount(3);
    const layout=await preview.locator('.pdf-layout-continuation').evaluateAll(nodes=>nodes.map(n=>({overflowX:n.scrollWidth-n.clientWidth,overflowY:n.scrollHeight-n.clientHeight})));
    const tags=await preview.locator('.pi-equation-tag').allTextContents();expect(tags.slice().sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)))).toEqual(Array.from({length:20},(_,i)=>`(${i+1})`));
    const cdp=await context.newCDPSession(preview),pdf=await cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(info.outputPath('bilingual.pdf'),Buffer.from(pdf.data,'base64'));await cdp.detach();await preview.close();
    await reader.close();reader=await context.newPage();await open();const final=await snapshot('reopened');
    for(const old of seed.session.pdfDocumentTranslationSessionsV1){const now=final.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.documentKey===old.documentKey);expect(now.archivedBlocks).toEqual(old.archivedBlocks);for(const before of old.blocks){const after=now.blocks.find((b:any)=>b.signature===before.signature);expect(after.translatedText).toBe(before.translatedText);expect(after.formulaDocument).toEqual(before.formulaDocument);if(before.signature!==originalBlock.signature)expect(after).toEqual(before)}}
    await reader.setViewportSize({width:360,height:800});await reader.emulateMedia({colorScheme:'dark'});expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath('reading-360-dark.png')});
    expect(attempts).toBe(0);expect(await worker.evaluate(()=>(globalThis as any).fontOfflineAttempts)).toBe(0);
    await writeFile(info.outputPath('report.json'),JSON.stringify({evidence:'Saved actual model outputs; fake credentials and provider blocked. Local annotation added only to exercise correction and history, then restored.',providerAttempts:0,blocks:current(final).blocks.length,archived:current(final).archivedBlocks?.length,tags,layout,mathNodes:html.match(/<math /gu)?.length,correctionPreservedFormulas:true,historyRestoredOriginal:true,oldDocumentsUntouched:true},null,2));
  }finally{if(!reader.isClosed())await reader.close()}
});
