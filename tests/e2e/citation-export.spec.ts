import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const pageUrl='https://example.org/research',key=createHash('sha256').update(pageUrl).digest('hex').slice(0,32);
const record={markerId:'realistic-note',pageUrl,anchor:{sourceText:'The original result is retained.',prefix:'',suffix:''},content:{sourceTitle:'Known source & evidence',sourceUrl:'https://example.org/citation',doi:'10.1234/source',originalText:'The original result is retained.',translatedText:'保留原有结果。',note:'人工笔记保持原样。'},createdAt:1,updatedAt:2};
for(const width of [1100,360])test(`exports confirmed citations at ${width}px without editing any saved content`,async({},info)=>{
  const worker=context.serviceWorkers()[0]!,options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  const previous=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
  try{
    await worker.evaluate(async({key,record})=>{const c=(globalThis as any).chrome,settings=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.clear();await c.storage.local.set({extensionSettings:settings,piWebExcerptsV1:{[key]:[record]},uiLanguagePreference:'zh-CN'})},{key,record});
    const before=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
    await options.setViewportSize({width,height:780});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    if(width===360)await options.locator('[data-source-kind="excerpt"] .library-select').click();
    const pane=options.locator('#library-detail');await expect(pane).toContainText(record.content.note);
    const openMenu=async()=>{await pane.locator('.library-menu > summary').click();await pane.getByRole('button',{name:'导出引用…'}).click()};
    await openMenu();const dialog=options.locator('.citation-export-dialog');
    await expect(dialog.getByLabel('来源标题',{exact:true})).toHaveValue(record.content.sourceTitle);
    await expect(dialog.getByLabel('来源链接',{exact:true})).toHaveValue(record.content.sourceUrl);
    await expect(dialog.getByLabel('作者（每行一位，可选）')).toHaveValue('');await expect(dialog.getByLabel('年份（可选）')).toHaveValue('');
    await dialog.getByLabel('来源标题',{exact:true}).fill('未确认草稿');await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toHaveCount(0);
    expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(before);
    await openMenu();await dialog.getByLabel('年份（可选）').fill('oops');await dialog.getByRole('button',{name:'确认导出'}).click();await expect(dialog.getByRole('status')).toContainText('四位数字');
    await dialog.getByLabel('年份（可选）').fill('2026');await dialog.getByLabel('作者（每行一位，可选）').fill('Doe, Jane\n研究小组');
    await expect(dialog.getByRole('status')).toBeHidden();
    await options.screenshot({path:info.outputPath(`citation-${width}.png`)});
    expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    for(const format of ['bibtex','ris']){
      if(format==='ris'){await openMenu();await dialog.getByLabel('格式',{exact:true}).selectOption('ris')}
      const downloading=options.waitForEvent('download');await dialog.getByRole('button',{name:'确认导出'}).click();
      const download=await downloading;await download.saveAs(info.outputPath(download.suggestedFilename()));const text=await readFile(info.outputPath(download.suggestedFilename()),'utf8');
      if(format==='bibtex'){expect(text).toContain('author = {{Doe, Jane} and {研究小组}}');expect(text).toContain('year = {2026}');expect(text).toContain('doi = {10.1234/source}')}
      else {expect(text).toContain('TI  - Known source & evidence');expect(text).toContain('UR  - https://example.org/citation');expect(text).not.toContain('AU  -');expect(text).not.toContain('PY  -')}
      expect(text).not.toContain(record.content.note);expect(text).not.toContain(record.content.translatedText);
    }
    await options.locator('#web-excerpts-library > summary').click();const legacy=options.locator('.saved-web-excerpt');await legacy.locator('.library-menu > summary').click();await legacy.getByRole('button',{name:'导出引用…'}).click();await expect(dialog).toBeVisible();await options.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await worker.evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.local.set(previous)},previous)}
});

test('keeps the English citation dialog usable on a narrow screen without changing notes',async({},info)=>{
  const worker=context.serviceWorkers()[0]!,options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  const previous=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
  try{
    await worker.evaluate(async({key,record})=>{const c=(globalThis as any).chrome;await c.storage.local.set({piWebExcerptsV1:{[key]:[record]},uiLanguagePreference:'en'})},{key,record});
    const before=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
    await options.setViewportSize({width:360,height:620});await options.emulateMedia({colorScheme:'dark'});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await options.locator('[data-source-kind="excerpt"]').filter({hasText:record.content.sourceTitle}).locator('.library-select').click();
    const pane=options.locator('#library-detail');await pane.locator('.library-menu > summary').click();await pane.getByRole('button',{name:'Export citation…'}).click();
    const dialog=options.locator('.citation-export-dialog');await expect(dialog.getByRole('heading',{name:'Export citation',exact:true})).toBeVisible();
    await expect(dialog.getByLabel('Authors (one per line, optional)',{exact:true})).toHaveValue('');
    await dialog.getByRole('button',{name:'Confirm export'}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Confirm export'})).toBeInViewport();
    expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
    await options.screenshot({path:info.outputPath('citation-360-en-dark.png')});await options.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await worker.evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.local.set(previous)},previous)}
});
