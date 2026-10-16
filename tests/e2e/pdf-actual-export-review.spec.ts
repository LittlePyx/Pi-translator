import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();test.skip(process.env.PI_ACTUAL_EXPORT_REVIEW!=='1','Offline export review of completed actual public-paper results.');test.use({trace:'off',actionTimeout:20_000});
test('renders and prints every actual translated block with equations and mathematical fonts',async({},info)=>{
  test.setTimeout(180_000);
  const root=path.resolve('output/pdf/live-workflow-2026-10-15');
  const checkpoint=JSON.parse(await readFile(process.env.PI_READING_ACTUAL_CHECKPOINT??path.join(root,'runtime-checkpoint.json'),'utf8'));
  const record=checkpoint.retained[0],id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
  const reader=await context.newPage();let preview:any;
  try{
    const worker=context.serviceWorkers()[0]!;await worker.evaluate(async(record)=>{const c=(globalThis as any).chrome;await c.storage.session.clear();await c.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await reader.setViewportSize({width:1450,height:1000});await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles(path.join(root,'source/conditional-neural-processes.pdf'));
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect(reader.locator('.pdf-formula-reference-review')).toHaveCount(0);
    await expect(reader.locator('.pdf-document-translation-block[data-status="done"]')).toHaveCount(record.documentSignatures.length);
    // A real wording correction, separate from the raw model response: this
    // paragraph says “one-shot”, not “one classification”. Keep its math locked.
    const classification=reader.locator('[data-translation-block="P8B3"]');
    const beforeCorrectionMath=await classification.locator('math annotation').allTextContents();
    await classification.hover();await classification.locator('.pdf-paragraph-edit-action').click();
    const term=reader.locator('#pdf-paragraph-editor textarea').first();
    expect(await term.inputValue()).toContain('一次分类任务');
    await term.fill((await term.inputValue()).replace('一次分类任务','单样本分类任务'));
    await reader.locator('#pdf-paragraph-editor-save').click();await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();
    await expect(classification).toContainText('单样本分类任务');
    expect(await classification.locator('math annotation').allTextContents()).toEqual(beforeCorrectionMath);
    await reader.reload();await reader.locator('#file-input').setInputFiles(path.join(root,'source/conditional-neural-processes.pdf'));await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await expect(classification).toContainText('单样本分类任务');
    const saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{sessions:(await c.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1,retained:(await c.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1}});
    await writeFile(info.outputPath('proofread-checkpoint.json'),JSON.stringify({...checkpoint,...saved,evidence:'Saved actual replies plus an explicit offline paragraph correction: one-shot rendered as 单样本, with mathematical content unchanged.'},null,2));
    const download=async(id:string,name:string)=>{const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const file=reader.waitForEvent('download');await reader.locator(`#${id}`).click();await(await file).saveAs(info.outputPath(name))};
    await download('pdf-document-translation-download-translation','actual-translation.md');
    await download('pdf-document-translation-download-bilingual','actual-bilingual.md');await download('pdf-document-translation-download-html','actual-bilingual.html');
    const library=await context.newPage();await library.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const entry=library.locator('.library-entry').first();await entry.locator('.library-menu > summary').click();await entry.getByRole('button',{name:'固定保存',exact:true}).click();
    await library.locator('#library-storage-tools > summary').click();const backup=library.waitForEvent('download');await library.locator('#export-library-backup').click();await(await backup).saveAs(info.outputPath('actual-library-backup.json'));await library.close();
    await reader.bringToFront();
    const openMenu=reader.locator('#pdf-document-translation-copy-menu');if(await openMenu.getAttribute('open')!==null)await openMenu.locator(':scope > summary').click();
    await expect(reader.locator('#pdf-document-translation')).toBeVisible();
    await reader.locator('#pdf-document-translation-view-reading').click();
    await writeFile(info.outputPath('capture-state.json'),JSON.stringify(await reader.locator('[data-translation-block="P3B3"]').evaluate(element=>{const chain=[];for(let node:Element|null=element;node;node=node.parentElement)chain.push({tag:node.tagName,id:node.id,display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,hidden:node.hasAttribute('hidden')});return chain}),null,2));
    for(const blockId of ['P3B3','P3B10','P5B7','P8B6']){
      const block=reader.locator(`[data-translation-block="${blockId}"]`);await block.scrollIntoViewIfNeeded();await block.screenshot({path:info.outputPath(`${blockId}-actual.png`)});
    }
    const annotations=await reader.locator('math annotation').allTextContents();
    expect(annotations.some(value=>value.includes('mathbb{R}'))).toBe(true);expect(annotations.some(value=>value.includes('mathcal{L}'))).toBe(true);
    const fonts=await reader.locator('math mi').allTextContents();expect(fonts.some(value=>value.includes('ℝ'))).toBe(true);expect(fonts.some(value=>value.includes('ℒ'))).toBe(true);
    const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
    const popup=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();preview=await popup;
    await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true',{timeout:90_000});
    await expect(preview.locator('[data-layout-source-page]')).toHaveCount(10);
    const renderedIds=await preview.locator('[data-layout-block-id]').evaluateAll((els:any[])=>[...new Set(els.map(el=>el.dataset.layoutBlockId))]);expect(renderedIds).toHaveLength(record.documentSignatures.length);
    await expect(preview.locator('.pdf-formula-reference-review')).toHaveCount(0);
    for(const number of ['1','2','3','4'])await expect(preview.locator('.pi-equation-tag').filter({hasText:new RegExp(`^\\(${number}\\)$`,'u')})).toHaveCount(1);
    await preview.emulateMedia({media:'print'});
    const geometry=await preview.locator('[data-layout-translation-page]').evaluateAll((els:any[])=>els.map(el=>({page:el.dataset.layoutTranslationPage,horizontal:el.scrollWidth>el.clientWidth+1,vertical:el.scrollHeight>el.clientHeight+1})));
    expect(geometry.filter((page:any)=>page.horizontal||page.vertical)).toEqual([]);
    await preview.locator('[data-layout-translation-page="3"]').first().screenshot({path:info.outputPath('actual-print-page3.png')});
    const client=await context.newCDPSession(preview);const pdf=await client.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false});
    await writeFile(info.outputPath('actual-bilingual.pdf'),Buffer.from(pdf.data,'base64'));
    await writeFile(info.outputPath('actual-layout.html'),await preview.content());
    expect(textRequests.length+visionRequests.length).toBe(0);
    await writeFile(info.outputPath('export-review.json'),JSON.stringify({evidence:'Completed actual results restored and exported locally; no new model calls',sourcePages:10,renderedBlocks:renderedIds.length,translationPages:geometry.length,geometry,equationNumbers:['1','2','3','4'],fontChecks:{blackboardR:true,scriptL:true,originalTexAnnotations:true},proofreading:{block:'P8B3',from:'一次分类任务',to:'单样本分类任务',sourceTerm:'one-shot',mathUnchanged:true,persistedAfterReload:true},modelRequests:0},null,2));
  }finally{
    await writeFile(info.outputPath('last-ui.json'),JSON.stringify({url:reader.url(),phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase').catch(()=>null),panelVisible:await reader.locator('#pdf-document-translation').isVisible().catch(()=>null)},null,2)).catch(()=>undefined);
    if(preview)await preview.close();await reader.close()}
});
