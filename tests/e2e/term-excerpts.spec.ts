import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {context,page,extensionId,installEdgeExtensionHooks,createTwoPageTextPdf,selectElementText,test,expect,textRequests,visionRequests} from './support/edge-extension-fixture';
import {parseFormulaDocument} from '../../core/translation/formula-document';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();
async function isolatedStorage(){const worker=context.serviceWorkers()[0]!;const saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(null),session:await c.storage.session.get(null)}});return async()=>worker.evaluate(async saved=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.session.clear();await c.storage.local.set(saved.local);await c.storage.session.set(saved.session)},saved)}
test('reviews confirmed PDF terms locally, previews a selective correction and preserves formulas, manual edits and history',async({},info)=>{
  const restore=await isolatedStorage(),worker=context.serviceWorkers()[0]!,reader=await context.newPage();
  const sources=['The kernel maps a sample.','The kernel describes the observations.'],buffer=createTwoPageTextPdf(sources[0]!,sources[1]!);
  const signatures=sources.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
  const formulaDocument=parseFormulaDocument({recognizedText:'{{m1}}',translation:'演示文本：内核映射样本 {{m1}}。',formulas:[{id:'m1',latex:'\\mathcal{K}',display:false}]});
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('terms-demo'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:[{signature:signatures[0],pageNumber:1,translatedText:formulaDocument.translationTemplate,formulaDocument},{signature:signatures[1],pageNumber:2,translatedText:'演示文本：内核描述观测结果（人工校订）。',manualCorrection:true}]};
  try{
    await worker.evaluate(async record=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles({name:'演示文本-术语.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-terms').click();
    await reader.locator('#pdf-term-source').fill('kernel');await reader.locator('#pdf-term-target').fill('核函数');await reader.locator('#pdf-terms-add button').click();await expect(reader.locator('#pdf-terms-candidate option')).toHaveCount(2);
    await reader.locator('#pdf-terms-candidate').selectOption('1');await expect(reader.locator('#pdf-terms-apply')).toBeDisabled();await expect(reader.locator('#pdf-terms-explanation')).toContainText('人工校订');
    await reader.locator('#pdf-terms-candidate').selectOption('0');await reader.locator('#pdf-terms-from').fill('内核');await reader.locator('#pdf-terms-apply').click();await expect(reader.locator('#pdf-terms-preview')).toContainText('核函数');await expect(reader.locator('#pdf-terms-current')).toContainText('内核');await expect(reader.locator('#pdf-terms-preview math')).toHaveCount(1);
    await reader.setViewportSize({width:1100,height:900});await reader.locator('#pdf-terms-dialog').screenshot({path:info.outputPath('term-preview-desktop.png')});
    await reader.setViewportSize({width:300,height:420});await reader.emulateMedia({colorScheme:'dark'});expect(await reader.locator('#pdf-terms-dialog').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath('term-preview-narrow.png')});
    await reader.locator('#pdf-terms-apply').click();await expect(reader.locator('#pdf-terms-status')).toContainText('修正已保存');await reader.locator('#pdf-terms-close').click();await expect(reader.locator('[data-translation-block="P1B1"]')).toContainText('核函数');
    const saved=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);
    const first=saved.blocks.find((block:any)=>block.signature===signatures[0]);expect(first.manualCorrection).toBe(true);expect(first.formulaDocument.formulas).toEqual(formulaDocument.formulas);expect(first.revisions[0].translatedText).toContain('内核');expect(saved.blocks.find((block:any)=>block.signature===signatures[1]).translatedText).toBe(record.blocks[1]!.translatedText);
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close();await restore()}
});
test('explicitly saves web excerpts, restores after reload, reports ambiguous anchors and includes notes in portable backup',async({},info)=>{
  const restore=await isolatedStorage(),worker=context.serviceWorkers()[0]!,options=await context.newPage(),url=page.url();let changedSource:((route:any)=>Promise<void>)|undefined;
  const openMarks=async()=>{const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('details.more > summary').click();await overlay.getByRole('button',{name:/查看本文标记/}).click();return overlay};
  const openSidebar=async()=>{await expect(page.locator('#tex-selection-translator-root')).toBeAttached();await worker.evaluate(async url=>{const c=(globalThis as any).chrome,tabs=await c.tabs.query({});const tab=tabs.find((tab:any)=>tab.url===url);await c.tabs.sendMessage(tab.id,{type:'OPEN_SIDEBAR'})},url)};
  try{
    await selectElementText('#source');let overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await overlay.getByRole('button',{name:'标记原文，悬停查看译文'}).click();const source=await page.locator('#source').innerText();overlay=await openMarks();
    await overlay.locator('.marker-note-more > summary').click();await overlay.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();await expect.poll(()=>worker.evaluate(async()=>Object.values((await(globalThis as any).chrome.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1??{}).flat().length)).toBe(1);
    await overlay.locator('.marker-note-more > summary').click();await overlay.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();await overlay.getByRole('textbox',{name:'个人笔记（可选）'}).fill('演示笔记：核对实验条件');await overlay.getByRole('button',{name:'保存这条标记的出处和笔记'}).click();await expect(overlay.locator('.excerpt-citation-editor')).toHaveCount(0);
    const before=textRequests.length+visionRequests.length;await page.reload();await openSidebar();overlay=await openMarks();await expect(overlay.locator('.marker-note')).toContainText('演示笔记：核对实验条件');expect(textRequests.length+visionRequests.length).toBe(before);
    await overlay.locator('.surface').screenshot({path:info.outputPath('saved-web-excerpt-restored.png')});
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();await expect(options.locator('.saved-web-excerpt')).toHaveCount(1);
    await expect(options.locator('.saved-web-excerpt-detail')).toBeHidden();await options.locator('#web-excerpts-library').screenshot({path:info.outputPath('saved-excerpt-library.png')});await options.locator('.saved-web-excerpt > details > summary').click();await expect(options.locator('.saved-web-excerpt blockquote')).toBeVisible();await expect(options.locator('.saved-web-excerpt')).toContainText(source);
    await options.locator('#web-excerpts-search').fill('核对实验条件');await expect(options.locator('.saved-web-excerpt')).toHaveCount(1);await expect(options.locator('.saved-web-excerpt-note')).toBeVisible();await options.locator('#web-excerpts-search').fill('不存在的摘录');await expect(options.locator('.saved-web-excerpt')).toHaveCount(0);await options.locator('#web-excerpts-search').fill('');
    await options.setViewportSize({width:300,height:800});await options.emulateMedia({colorScheme:'dark'});await options.locator('#web-excerpts-library').evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-90));await options.locator('#web-excerpts-library').screenshot({path:info.outputPath('saved-excerpt-library-compact.png')});
    await options.setViewportSize({width:300,height:540});await options.locator('.saved-web-excerpt > details > summary').click();await options.getByLabel('这条网页摘录的更多操作').click();await expect(options.getByRole('button',{name:'删除摘录',exact:true})).toBeVisible();
    await expect.poll(async()=>{const box=await options.locator('.saved-web-excerpt .library-actions').boundingBox();return Boolean(box&&box.x>=0&&box.y>=0&&box.x+box.width<=301&&box.y+box.height<=541)}).toBe(true);await options.keyboard.press('Escape');await options.evaluate(()=>{(document.activeElement as HTMLElement)?.blur()});
    // Give the element capture enough height to exclude the sticky header.
    await options.setViewportSize({width:300,height:800});await options.locator('#web-excerpts-library').evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-90));await options.locator('#web-excerpts-library').screenshot({path:info.outputPath('saved-excerpt-library-narrow.png')});
    await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const download=await downloading;await download.saveAs(info.outputPath('web-excerpts-backup.json'));const backup=JSON.parse(await readFile(info.outputPath('web-excerpts-backup.json'),'utf8'));expect(backup.version).toBe(3);expect(JSON.stringify(backup.webExcerpts)).toContain('演示笔记');expect(JSON.stringify(backup)).not.toContain('e2e-test-key');
    const anchor=(Object.values(backup.webExcerpts).flat()[0] as any).anchor;const duplicate=`${anchor.prefix}${source}${anchor.suffix}`;
    const handler=async(route:any)=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Changed source</title><p>${duplicate}</p><p>${duplicate}</p>`});changedSource=handler;await page.route(url,handler);await page.reload();await expect(page.locator('body > p')).toHaveCount(2);await openSidebar();overlay=await openMarks();await expect(overlay.locator('.marker-note-status')).toContainText('原文位置已变化');
    await page.setViewportSize({width:300,height:540});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:info.outputPath('saved-web-excerpt-ambiguous.png')});
    await overlay.locator('.marker-note-more > summary').click();const menu=overlay.locator('.marker-note-more .menu');await expect(menu).toBeVisible();const bounds=await menu.boundingBox();expect(bounds).toBeTruthy();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(301);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(541);await page.keyboard.press('Escape');
    await page.unroute(url,handler);changedSource=undefined;expect(textRequests.length+visionRequests.length).toBe(before);
  }finally{if(changedSource)await page.unroute(url,changedSource);await options.close();await restore();await page.reload().catch(()=>undefined)}
});

test('keeps the excerpt library focused on readable translations across empty, search and narrow states',async({},info)=>{
  const restore=await isolatedStorage(),worker=context.serviceWorkers()[0]!,options=await context.newPage(),requestCount=textRequests.length+visionRequests.length;
  const url='https://example.com/demonstration-excerpts',id=createHash('sha256').update(url).digest('hex').slice(0,32);
  const fixtures=[
    {sourceTitle:'演示文本 · 论文阅读笔记',originalText:'The covariance kernel determines how function values vary together.',translatedText:'协方差核决定了不同位置的函数值如何共同变化。',note:'核对样本数量。',doi:'10.1000/demo'},
    {sourceTitle:'演示文本 · '+ '一个很长的来源标题'.repeat(12),originalText:'Demonstration text: long explanations remain available in the expanded excerpt.',translatedText:'演示文本：'+ '长段落在列表中保留简短预览，展开后可以阅读完整内容。'.repeat(18),note:''},
    {sourceTitle:'演示文本 · 数学符号',originalText:'The distribution $\\mathcal{N}$ is defined over $\\mathbb{R}$.',translatedText:'演示文本：分布 $\\mathcal{N}$ 定义在 $\\mathbb{R}$ 上。',note:'保持数学字体。'},
  ].map((content,index)=>({markerId:`excerpt-design-${index}`,pageUrl:url,anchor:{sourceText:content.originalText,prefix:'',suffix:''},content:{...content,sourceUrl:url},createdAt:Date.now()-index,updatedAt:Date.now()-index}));
  try{
    await worker.evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{}})});
    await options.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(globalThis as any).excerptClipboard=text}}}));
    await options.setViewportSize({width:1200,height:1000});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();
    await expect(options.locator('.web-excerpts-empty')).toContainText('还没有保存的摘录');await expect(options.locator('#web-excerpts-search')).toBeHidden();
    await worker.evaluate(async data=>{await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:data})},{[id]:fixtures});
    const rows=options.locator('.saved-web-excerpt');await expect(rows).toHaveCount(3);await expect(options.locator('#web-excerpts-count')).toHaveText('3');await expect(rows.first().locator('.saved-web-excerpt-detail')).toBeHidden();
    await expect(rows.nth(2).locator('math')).toHaveCount(2);await expect(rows.first().getByRole('link',{name:'打开原网页'})).toBeHidden();
    await rows.first().getByRole('button',{name:'复制摘录（含出处）',exact:true}).click();await expect.poll(()=>options.evaluate(()=>(globalThis as any).excerptClipboard??'')).toContain('核对样本数量');
    await options.locator('#web-excerpts-library').screenshot({path:info.outputPath('excerpt-list-desktop.png')});
    await rows.nth(1).locator(':scope > details > summary').focus();await options.keyboard.press('Enter');await expect(rows.nth(1).locator('.saved-web-excerpt-detail')).toBeVisible();
    expect(await rows.nth(1).locator('.saved-web-excerpt-target').evaluate(node=>node.scrollHeight-node.clientHeight)).toBeLessThanOrEqual(1);await options.keyboard.press('Enter');
    await options.locator('#web-excerpts-search').fill('核对样本数量');await expect(rows).toHaveCount(1);await expect(rows.first().locator('.saved-web-excerpt-note')).toBeVisible();
    await expect(rows.first().getByRole('link',{name:'DOI: 10.1000/demo'})).toBeVisible();await options.locator('#web-excerpts-search').fill('');await expect(rows).toHaveCount(3);
    for(const width of [1200,360,300])for(const theme of ['light','dark'] as const){
      await options.setViewportSize({width,height:800});await options.emulateMedia({colorScheme:theme});await rows.first().scrollIntoViewIfNeeded();
      expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      for(const toggle of await options.locator('.saved-web-excerpt-actions > button,.saved-web-excerpt-actions summary').all())expect(await toggle.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
      await rows.first().getByLabel('这条网页摘录的更多操作').click();const menu=rows.first().locator('.library-actions');await expect(menu.getByRole('link',{name:'打开原网页'})).toHaveAttribute('href',url);
      await expect.poll(async()=>{const box=await menu.boundingBox();return Boolean(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=801)}).toBe(true);await options.keyboard.press('Escape');
      await options.evaluate(()=>{(document.activeElement as HTMLElement)?.blur()});
      await options.locator('#web-excerpts-library').screenshot({path:info.outputPath(`excerpt-list-${width}-${theme}.png`)});
    }
    await rows.first().locator(':scope > details > summary').click();await options.setViewportSize({width:300,height:1400});await options.locator('#web-excerpts-library').evaluate(node=>window.scrollBy(0,node.getBoundingClientRect().top-90));await options.locator('#web-excerpts-library').screenshot({path:info.outputPath('excerpt-expanded-mobile.png')});
    await rows.first().getByLabel('这条网页摘录的更多操作').click();await rows.first().getByRole('button',{name:'删除摘录',exact:true}).click();await expect(rows).toHaveCount(3);await rows.first().getByRole('button',{name:'确认删除',exact:true}).click();await expect(rows).toHaveCount(2);
    expect(textRequests.length+visionRequests.length).toBe(requestCount);
  }finally{await options.close();await restore()}
});

test('edits saved excerpt metadata safely and exports only the current saved search results',async({},info)=>{
  const restore=await isolatedStorage(),worker=context.serviceWorkers()[0]!,options=await context.newPage(),requestCount=textRequests.length+visionRequests.length;
  const url='https://example.org/excerpt-edit',id=createHash('sha256').update(url).digest('hex').slice(0,32);
  const records=[0,1].map(index=>({markerId:`edit-${index}`,pageUrl:url,anchor:{sourceText:`Demonstration source ${index} with $\\mathbb{R}$.`,prefix:'',suffix:''},content:{sourceTitle:'演示文本 · 出处',originalText:`Demonstration source ${index} with $\\mathbb{R}$.`,translatedText:`演示文本译文 ${index} $\\mathbb{R}$`,note:`旧笔记 ${index}`},createdAt:1,updatedAt:2-index}));
  try{
    await worker.evaluate(async data=>{await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:data})},{[id]:records});
    await options.addInitScript(()=>{const scope=globalThis as any,set=scope.chrome.storage.local.set.bind(scope.chrome.storage.local);scope.excerptSaveFails=false;scope.chrome.storage.local.set=(values:any,...rest:any[])=>scope.excerptSaveFails&&'piWebExcerptsV1' in values?Promise.reject(new Error('模拟保存空间不足')):set(values,...rest)});
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();
    const row=options.locator('[data-excerpt-id="edit-0"]');await row.locator(':scope > details > summary').click();await row.getByRole('button',{name:'编辑笔记与出处'}).click();
    let editor=row.getByRole('form',{name:'编辑摘录笔记与出处'});await editor.getByLabel('个人笔记').fill('保存失败仍保留的笔记');await editor.getByLabel('来源标题').fill('演示文本 · 新出处');await editor.getByLabel('DOI（可选）').fill('10.1000/edit');
    await options.evaluate(()=>{(globalThis as any).excerptSaveFails=true});await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor.getByRole('status')).toContainText('空间不足');await expect(editor.getByLabel('个人笔记')).toHaveValue('保存失败仍保留的笔记');
    await options.setViewportSize({width:300,height:800});await options.emulateMedia({colorScheme:'dark'});expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await editor.screenshot({path:info.outputPath('excerpt-edit-failed-300-dark.png')});
    // A concurrent translation remains intact; unrelated citation edits conflict instead of silently overwriting.
    await worker.evaluate(async({id,url})=>{const c=(globalThis as any).chrome,map=(await c.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1;map[id][0].content.note='其他窗口的新笔记';map[id][0].content.translatedText='较新译文 $\\mathbb{R}$';await c.storage.local.set({piWebExcerptsV1:map})},{id,url});
    await expect(editor.getByLabel('个人笔记')).toHaveValue('保存失败仍保留的笔记');await options.evaluate(()=>{(globalThis as any).excerptSaveFails=false});await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor.getByRole('status')).toContainText('其他窗口');
    await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(row.locator('.saved-web-excerpt-note')).toBeVisible();await expect(row.locator('.saved-web-excerpt-note')).toContainText('其他窗口的新笔记');await row.getByRole('button',{name:'编辑笔记与出处'}).click();editor=row.getByRole('form',{name:'编辑摘录笔记与出处'});
    await editor.getByLabel('个人笔记').fill('筛选导出的新笔记');await editor.getByLabel('DOI（可选）').fill('https://doi.org/10.1000/edit');await editor.getByLabel('来源标题').fill('演示文本 · 新出处');await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor).toHaveCount(0);
    await options.locator('#web-excerpts-search').fill('10.1000/edit');await expect(options.locator('.saved-web-excerpt')).toHaveCount(1);await expect(row.locator('.saved-web-excerpt-target')).toContainText('较新译文');
    await options.reload();await options.locator('#web-excerpts-library > summary').click();await options.locator('#web-excerpts-search').fill('筛选导出');await expect(row.locator('.saved-web-excerpt-note')).toContainText('筛选导出的新笔记');
    await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-web-excerpts').click();await(await downloading).saveAs(info.outputPath('filtered-excerpts.md'));const markdown=await readFile(info.outputPath('filtered-excerpts.md'),'utf8');
    for(const expected of ['Demonstration source 0','较新译文','\\mathbb{R}','筛选导出的新笔记','https://example.org/excerpt-edit','https://doi.org/10.1000/edit'])expect(markdown).toContain(expected);expect(markdown).not.toContain('Demonstration source 1');expect(markdown).not.toContain('e2e-test-key');
    await row.getByRole('button',{name:'编辑笔记与出处'}).click();editor=row.getByRole('form',{name:'编辑摘录笔记与出处'});await editor.getByLabel('个人笔记').fill('被删除后仍能取回的草稿');
    await worker.evaluate(async id=>{const c=(globalThis as any).chrome,map=(await c.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1;map[id]=map[id].filter((item:any)=>item.markerId!=='edit-0');await c.storage.local.set({piWebExcerptsV1:map})},id);
    await expect(editor.getByLabel('个人笔记')).toHaveValue('被删除后仍能取回的草稿');await options.locator('#web-excerpts-search').fill('不匹配');await expect(options.locator('.saved-web-excerpt')).toHaveCount(0);await options.locator('#web-excerpts-search').fill('');
    await expect(editor.getByLabel('个人笔记')).toHaveValue('被删除后仍能取回的草稿');await expect(editor.getByRole('status')).toContainText('删除');await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('.saved-web-excerpt')).toHaveCount(1);await expect(row).toHaveCount(0);
    expect(textRequests.length+visionRequests.length).toBe(requestCount);
  }finally{await options.close();await restore()}
});
