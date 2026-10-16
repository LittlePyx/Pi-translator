import {openPdfTranslationOptions,openPdfTranslationSettings} from './support/pdf-controls';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Route} from '@playwright/test';
import {context,createTextPdf,createTwoPageTextPdf,expect,extensionId,installEdgeExtensionHooks,page,selectElementText,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
import {bilingualPageSessionPageKey,bilingualPageSessionBlockSignature,bilingualPageSessionBehaviorKey} from '../../core/translation/bilingual-page-session';
import {fixedDocumentKey,retainedDocumentStorageCost} from '../../core/translation/fixed-document-storage';
import {parseFormulaDocument} from '../../core/translation/formula-document';
installEdgeExtensionHooks();

test('filters the local library and reports formula/history capacity without changing saved work or requesting translation',async({},info)=>{
  const options=await context.newPage();const common={targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:Date.now()};
  const signature=pdfDocumentTranslationSessionBlockSignature(1,'Saved paper',0);
  const formulaDocument=parseFormulaDocument({recognizedText:'Source {{m1}}.',translation:'人工校订 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
  const pdf={...common,sourceFingerprint:'a'.repeat(64),documentKey:pdfDocumentTranslationSessionDocumentKey('library-capacity'),documentSignatures:[signature],scopeSignatures:[signature],preservedSignatures:[],blocks:[{signature,translatedText:'人工校订 {{m1}}。',formulaDocument,manualCorrection:true,formulaReviewMessage:'请核对原文',revisions:[{id:'revision-library',createdAt:1,reason:'correction',translatedText:'历史译文'}]}],archivedBlocks:[{signature:pdfDocumentTranslationSessionBlockSignature(2,'Archived source',0),translatedText:'旧分段译文'}],activity:'complete',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model')};
  const webSignature=bilingualPageSessionBlockSignature('P','Saved web',0);
  const web={...common,pageKey:bilingualPageSessionPageKey('https://example.com/saved'),documentSignatures:[webSignature,bilingualPageSessionBlockSignature('P','Pending source',0)],excludedSignatures:[],displayMode:'bilingual',translationsHidden:false,controlCollapsed:false,blocks:[{signature:webSignature,translatedText:'网页摘记',hidden:false}],activity:'paused',behaviorKey:bilingualPageSessionBehaviorKey('model')};
  const seeded={pdfDocumentTranslationRetainedV1:[pdf],[fixedDocumentKey('pdf',pdf)]:pdf,bilingualPageRetainedV1:[web]};
  let storageBefore:Record<string,unknown>|undefined;
  try{
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    storageBefore=await options.evaluate(async keys=>(globalThis as any).chrome.storage.local.get(keys),Object.keys(seeded));
    await options.evaluate(async seeded=>{await(globalThis as any).chrome.storage.local.set(seeded)},seeded);await options.reload();
    const rows=options.locator('#retained-document-library .library-entry'),filter=options.getByRole('combobox',{name:'筛选文档'});
    await expect(rows).toHaveCount(2);
    const before=await options.evaluate(async keys=>(globalThis as any).chrome.storage.local.get(keys),Object.keys(seeded));
    const requests=textRequests.length+visionRequests.length;
    for(const [value,kind] of [['pdf','PDF'],['web','WEB'],['pinned','PDF'],['review','PDF'],['incomplete','WEB']]){
      await filter.selectOption(value!);await expect(rows).toHaveCount(1);await expect(rows.locator('.library-kind')).toHaveText(kind!);await expect(options.locator('#retained-library-count')).toHaveText('1 / 2 份');
    }
    await options.locator('#retained-library-search').fill('不存在');await expect(rows).toHaveCount(0);
    await options.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(filter).toHaveValue('all');await expect(rows).toHaveCount(2);await expect(options.locator('#retained-library-search')).toBeFocused();
    await filter.selectOption('review');await options.locator('#retained-library-search').fill('人工校订');await expect(rows).toHaveCount(1);
    await rows.locator('.library-menu > summary').click();await expect(rows.locator('.library-storage-detail')).toContainText('含公式与历史');await expect(rows.locator('.library-storage-detail')).toContainText('更新于');await options.keyboard.press('Escape');
    await options.locator('#library-storage-tools > summary').click();
    const expectedCost=retainedDocumentStorageCost(pdf);await expect(options.locator('#retained-pdf-storage-status')).toContainText(`容量 ${new Intl.NumberFormat('zh-CN').format(expectedCost.capacityCharacters)} / 1,000,000`);
    await expect(options.locator('#retained-pdf-storage-status')).toHaveCSS('white-space','normal');
    const downloaded=options.waitForEvent('download');await options.locator('#export-library-backup').click();const backup=await downloaded;await backup.saveAs(info.outputPath('library-backup.json'));
    const backupText=await readFile(info.outputPath('library-backup.json'),'utf8');for(const text of ['人工校订','历史译文','旧分段译文','x=y'])expect(backupText).toContain(text);
    await filter.selectOption('all');await options.locator('#retained-library-search').fill('');
    for(const [width,scheme] of [[1100,'light'],[360,'dark'],[300,'light']] as const){
      await options.setViewportSize({width,height:900});await options.emulateMedia({colorScheme:scheme});
      await expect(filter).toHaveCSS('appearance','none');
      if(scheme==='dark')await expect(filter).toHaveCSS('background-color','rgb(44, 44, 44)');
      await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      await options.screenshot({path:info.outputPath(`library-${width}-${scheme}.png`)});
      await options.locator('#library-storage-tools > summary').click();await expect(options.locator('#retained-pdf-storage-status')).toHaveCSS('white-space','normal');await expect.poll(()=>options.locator('#retained-pdf-storage-status').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath(`library-capacity-${width}-${scheme}.png`)});await options.keyboard.press('Escape');
    }
    expect(await options.evaluate(async keys=>(globalThis as any).chrome.storage.local.get(keys),Object.keys(seeded))).toEqual(before);
    expect(textRequests.length+visionRequests.length).toBe(requests);
  }finally{
    if(storageBefore)await options.evaluate(async({keys,before})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set(before)},{keys:Object.keys(seeded),before:storageBefore});
    await options.close();
  }
});

test('saves model prices and estimates reported foreground and background PDF usage',async({ },testInfo)=>{
  const options=await context.newPage();const reader=await context.newPage();
  const handle=async(route:Route)=>{
    const body=route.request().postDataJSON();
    const user=JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{content:JSON.stringify({translation:'这是一段完整的中文说明。',detectedLanguage:'en',warnings:[],segments:user.segments.map((item:{id:string})=>({id:item.id,translation:'这是一段完整的中文说明。'}))})}}]})});
  };
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/chat/completions',handle);
  try{
    await options.emulateMedia({reducedMotion:'reduce'});await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('[data-settings-target="cost"]').click();
    await options.locator('#price-profile').selectOption('default');await options.locator('#price-model').fill('e2e-model');
    await options.locator('#price-input').fill('2');await options.locator('#price-output').fill('8');
    await options.locator('#add-model-price').click();await expect(options.locator('#model-price-list')).toContainText('e2e-model');
    await options.locator('#save-button').click();await expect(options.locator('#save-state')).toHaveText('所有设置已保存');
    await options.reload();await options.locator('[data-settings-target="cost"]').click();await expect(options.locator('#model-price-list')).toContainText('输入 2 · 输出 8');
    await expect(options.locator('#model-price-editor')).not.toHaveAttribute('open');
    await options.setViewportSize({width:1360,height:1000});await options.screenshot({path:testInfo.outputPath('cost-configured-light.png')});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'priced.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('The first paragraph describes an experimental image reconstruction method.','The second paragraph evaluates the proposed method using several measurements.')});
    await reader.locator('#translate-document').click();
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-cost-details > summary').click();
    await expect(reader.locator('#pdf-document-cost-estimate')).toContainText('剩余文字粗估');
    await reader.locator('#pdf-document-trial > summary').click();await reader.locator('#pdf-document-trial-start').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await expect(reader.locator('#pdf-document-cost-estimate')).toContainText('¥0.000120');
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await openPdfTranslationSettings(reader);
    await expect(reader.locator('#pdf-document-cost-estimate')).toContainText('¥0.000240');
    await expect(reader.locator('#pdf-document-cost-estimate')).toBeVisible();
    await reader.screenshot({path:testInfo.outputPath('pdf-reported-cost.png')});
  }finally{await options.close();await reader.close();await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/chat/completions',handle)}
});

test('manages retained PDF and webpage entries independently and exports their translations',async({ },testInfo)=>{
  const options=await context.newPage();
  await options.emulateMedia({reducedMotion:'reduce'});
  const common={targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:Date.now()};
  const pdfSignature=pdfDocumentTranslationSessionBlockSignature(1,'Private PDF source',0);
  const webSignature=bilingualPageSessionBlockSignature('P','Private web source',0);
  try{
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(async(data)=>{
      const api=(globalThis as any).chrome;
      await api.storage.local.set(data);
    },{pdfDocumentTranslationRetainedV1:[{...common,documentKey:pdfDocumentTranslationSessionDocumentKey('private-file.pdf'),documentSignatures:[pdfSignature],blocks:[{signature:pdfSignature,translatedText:'PDF 译文包含 $x=y$。'}],activity:'complete',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model')}],bilingualPageRetainedV1:[{...common,pageKey:bilingualPageSessionPageKey('https://private.example/source'),documentSignatures:[webSignature],excludedSignatures:[],displayMode:'bilingual',translationsHidden:false,controlCollapsed:false,blocks:[{signature:webSignature,translatedText:'独立的网页译文。',hidden:false}],activity:'paused',behaviorKey:bilingualPageSessionBehaviorKey('model')} ]});
    await options.locator('[data-settings-target="storage"]').click();
    const rows=options.locator('#retained-document-library .library-entry');await expect(rows).toHaveCount(2);
    const pdf=rows.filter({has:options.locator('.library-kind', {hasText:'PDF'})});
    await expect(pdf.getByRole('textbox',{name:'文档名称'})).toBeHidden();
    await pdf.locator('.library-menu > summary').click();await pdf.getByRole('button',{name:'重命名',exact:true}).click();
    await pdf.getByRole('textbox',{name:'文档名称'}).fill('我的实验论文');await pdf.getByRole('button',{name:'保存名称'}).click();
    await expect(options.locator('#retained-storage-action-status')).toContainText('名称已保存');
    await options.reload();await options.locator('[data-settings-target="storage"]').click();
    await expect(pdf.locator('.library-title')).toHaveText('我的实验论文');
    await expect(options.locator('#library-storage-tools')).not.toHaveAttribute('open');
    await options.setViewportSize({width:1360,height:1000});await options.screenshot({path:testInfo.outputPath('library-list-light.png')});
    await options.locator('#library-storage-tools > summary').click();await expect(options.locator('#refresh-retained-storage')).toBeVisible();await options.screenshot({path:testInfo.outputPath('library-management-light.png')});await options.keyboard.press('Escape');await expect(options.locator('#library-storage-tools > summary')).toBeFocused();await expect(options.locator('#refresh-retained-storage')).toBeHidden();
    await options.emulateMedia({colorScheme:'dark'});await options.screenshot({path:testInfo.outputPath('library-list-dark.png')});
    await options.setViewportSize({width:360,height:1000});await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:testInfo.outputPath('library-list-mobile-dark.png')});
    await options.locator('#library-storage-tools > summary').click();await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:testInfo.outputPath('library-management-mobile-dark.png')});await options.keyboard.press('Escape');
    await options.emulateMedia({colorScheme:'light'});
    await options.locator('#retained-library-search').fill('网页');await expect(rows).toHaveCount(1);await expect(rows.locator('.library-kind')).toHaveText('WEB');
    await expect(options.locator('#retained-library-count')).toHaveText('1 / 2 份');
    await options.locator('#retained-library-search').fill('中文');await expect(rows).toHaveCount(2);
    await options.locator('#retained-library-search').fill('不存在的文档');await expect(rows).toHaveCount(0);
    await options.getByRole('button',{name:'清除搜索',exact:true}).click();await expect(options.locator('#retained-library-search')).toBeFocused();await expect(rows).toHaveCount(2);
    for(const row of [rows.nth(0),rows.nth(1)]){
      const opened=context.waitForEvent('page');await row.locator('.library-open').click();const reading=await opened;
      try{await expect(reading.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await expect(reading.locator('#pdf-document-translation-pages')).toContainText(await row.getAttribute('data-kind')==='pdf'?'PDF 译文包含':'独立的网页译文。')}finally{await reading.close()}
    }
    await pdf.locator('.library-menu > summary').focus();await options.keyboard.press('Enter');await expect(pdf.getByRole('button',{name:'重命名',exact:true})).toBeVisible();
    await options.keyboard.press('Escape');await expect(pdf.locator('.library-menu > summary')).toBeFocused();await expect(pdf.getByRole('button',{name:'重命名',exact:true})).toBeHidden();
    await pdf.locator('.library-menu > summary').click();await pdf.getByRole('button',{name:'重命名',exact:true}).click();await pdf.getByRole('textbox',{name:'文档名称'}).fill('临时名称');await options.keyboard.press('Escape');await expect(pdf.locator('.library-title')).toHaveText('我的实验论文');
    await pdf.locator('.library-menu > summary').click();
    const download=options.waitForEvent('download');await pdf.getByRole('button',{name:'导出 Markdown'}).click();const exported=await download;
    expect(exported.suggestedFilename()).toBe('我的实验论文.md');await exported.saveAs(testInfo.outputPath('library-export.md'));
    const exportedText=await readFile(testInfo.outputPath('library-export.md'),'utf8');expect(exportedText).toContain('PDF 译文包含 $x=y$。');expect(exportedText).not.toContain('Private PDF source');
    const contents=await options.evaluate(async()=>{const data=await (globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1');return JSON.stringify(data)});expect(contents).not.toContain('private-file.pdf');
    await pdf.locator('.library-menu > summary').click();await pdf.getByRole('button',{name:'删除',exact:true}).click();await pdf.getByRole('button',{name:'确认删除',exact:true}).click();
    await expect(rows).toHaveCount(1);await expect(rows.locator('.library-kind')).toHaveText('WEB');const openedWeb=context.waitForEvent('page');await rows.locator('.library-open').click();const webReading=await openedWeb;try{await expect(webReading.locator('#pdf-document-translation-pages')).toContainText('独立的网页译文。')}finally{await webReading.close()}
    await options.setViewportSize({width:360,height:1000});await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await options.screenshot({path:testInfo.outputPath('local-library-mobile.png')});
  }finally{await options.close()}
});

test('edits and copies a webpage excerpt with its URL without storing it as a PDF note',async()=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://www.overleaf.com'});
  await selectElementText('#source');const overlay=page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();await overlay.getByRole('button',{name:'标记原文，悬停查看译文'}).click();
  const before=textRequests.length+visionRequests.length;
  await overlay.locator('details.more > summary').click();await overlay.getByRole('button',{name:'查看本文标记（1）'}).click();
  await overlay.locator('.marker-note-more > summary').click();await overlay.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();await overlay.getByRole('textbox',{name:'DOI（可选）'}).fill('10.1000/web-demo');
  await overlay.getByRole('button',{name:'保存这条标记的出处和笔记'}).click();await expect(overlay.locator('.excerpt-citation-editor')).toHaveCount(0);
  await overlay.getByRole('button',{name:'复制这条标记'}).click();
  await expect(overlay.getByRole('button',{name:'复制这条标记'})).toHaveText('已复制');
  const markdown=await page.evaluate(()=>navigator.clipboard.readText());
  expect(markdown).toContain(page.url());expect(markdown).toContain('https://doi.org/10.1000/web-demo');expect(markdown).toContain('Pi Translator E2E Paper');expect(textRequests.length+visionRequests.length).toBe(before);
  const stored=await context.serviceWorkers()[0]!.evaluate(async()=>JSON.stringify(await (globalThis as any).chrome.storage.local.get('piPdfTranslationMarkersV1')));expect(stored).not.toContain('10.1000/web-demo');
});

test('edits, persists and copies a PDF excerpt with title, page, DOI and source link without API calls',async({ },testInfo)=>{
  const sourceUrl='https://www.overleaf.com/citation-excerpt.pdf';
  const id=createHash('sha256').update(sourceUrl).digest('hex').slice(0,32);
  const anchor='The experiment uses a calibrated reconstruction model.';
  const handle=async(route:Route)=>route.fulfill({contentType:'application/pdf',body:createTextPdf(anchor)});
  await context.route(sourceUrl,handle);
  const reader=await context.newPage();
  await reader.addInitScript(()=>{Object.defineProperty(navigator.clipboard,'writeText',{value:async(text:string)=>{(globalThis as any).__excerptClipboard=text},configurable:true})});
  try{
    await reader.goto(`chrome-extension://${extensionId}/popup.html`);
    await reader.evaluate(async({id,anchor})=>{await (globalThis as any).chrome.storage.local.set({piPdfTranslationMarkersV1:{[id]:{enabled:true,updatedAt:Date.now(),markers:[{markerId:'citation-note::full',anchor:{kind:'text-quote',pageNumber:1,sourceText:anchor,prefix:'',suffix:''},content:{sourceTitle:'citation-excerpt.pdf',originalText:anchor,translatedText:'实验使用经过校准的重建模型 $x=y$。',pageNumber:1},createdAt:1}]}}})},{id,anchor});
    const open=async()=>{
      await reader.goto(`chrome-extension://${extensionId}/pdf.html?url=${encodeURIComponent(sourceUrl)}`);
      await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');
      const mark=reader.locator('#pi-translation-marker-layer .marker').first();await expect(mark).toBeVisible();const bounds=await mark.boundingBox();await reader.mouse.click(bounds!.x+Math.min(20,bounds!.width/2),bounds!.y+bounds!.height/2);
      const overlay=reader.locator('#tex-selection-translator-root');await overlay.locator('details.more > summary').click();await overlay.getByRole('button',{name:'查看本文标记（1）'}).click();return overlay;
    };
    await reader.setViewportSize({width:360,height:1000});let overlay=await open();const before=textRequests.length+visionRequests.length;
    await overlay.locator('.marker-note-more > summary').click();await overlay.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();
    await overlay.getByRole('textbox',{name:'论文或来源标题'}).fill('Calibration Study');await overlay.getByRole('textbox',{name:'来源链接（可选）'}).fill('https://example.com/paper(1).pdf');await overlay.getByRole('textbox',{name:'DOI（可选）'}).fill('10.1000/demo');await overlay.getByRole('textbox',{name:'个人笔记（可选）'}).fill('检查实验条件。');
    await overlay.getByRole('button',{name:'保存这条标记的出处和笔记'}).click();await expect(overlay.locator('.excerpt-citation-editor')).toHaveCount(0);
    overlay=await open();await overlay.locator('.marker-note-more > summary').click();await overlay.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();await expect(overlay.getByRole('textbox',{name:'论文或来源标题'})).toHaveValue('Calibration Study');await expect(overlay.getByRole('textbox',{name:'DOI（可选）'})).toHaveValue('10.1000/demo');
    await reader.screenshot({path:testInfo.outputPath('excerpt-citation-mobile.png')});await overlay.getByRole('button',{name:'取消编辑出处'}).click();await overlay.getByRole('button',{name:'复制这条标记'}).click();
    const markdown=await reader.evaluate(()=>(globalThis as any).__excerptClipboard as string);expect(markdown).toContain('Calibration Study · 第 1 页');expect(markdown).toContain('https://example.com/paper%281%29.pdf');expect(markdown).toContain('https://doi.org/10.1000/demo');expect(markdown).toContain('$x=y$');expect(markdown).toContain('检查实验条件。');expect(textRequests.length+visionRequests.length).toBe(before);
  }finally{await reader.close();await context.unroute(sourceUrl,handle)}
});
