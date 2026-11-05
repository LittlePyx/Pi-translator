import {createHash} from 'node:crypto';
import {context,page,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,selectSourceText,OVERLEAF_FIXTURE_URL,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
const pdf=createTwoPageTextPdf('A fixed original file for local retention.','Reading position and notes must survive.');
const fingerprint=createHash('sha256').update(pdf).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
test('shows icon titles on keyboard focus in the web shadow surface and settings',async()=>{
  await page.goto(OVERLEAF_FIXTURE_URL);await selectSourceText();const host=page.locator('#tex-selection-translator-root');await host.locator('.trigger').click();const copy=host.locator('.copy-action');await expect(copy).toBeEnabled();
  await page.keyboard.press('Tab');await copy.focus();await expect(host.getByRole('tooltip')).toContainText('复制');const described=await copy.getAttribute('aria-describedby');expect(described).toContain('pi-keyboard-hint');
  expect(await copy.getAttribute('title')).toBeTruthy();await copy.press('Escape');await expect(host.getByRole('tooltip')).toHaveCount(0);
  const options=await context.newPage();try{await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const toggle=options.locator('#library-storage-tools > summary');await options.keyboard.press('Tab');await toggle.focus();await expect(options.getByRole('tooltip')).toBeVisible();await toggle.press('Escape');await expect(options.getByRole('tooltip')).toHaveCount(0)}finally{await options.close()}
});
test('removes and undoes a recent reading without deleting its position, and rejects a concurrent rename',async({},info)=>{
  const worker=context.serviceWorkers()[0]!,key='piRecentPdfOverridesV1',recent='piRecentPdfDocumentsV1',states='piPdfReadingStatesV1';
  const before=await worker.evaluate(async keys=>(await(globalThis as any).chrome.storage.local.get(keys)),[key,recent,states]);const reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'Undo reading.pdf',mimeType:'application/pdf',buffer:pdf});await expect(reader.locator('#page-count')).toHaveText('2');await reader.locator('#page-number').fill('2');await reader.locator('#page-number').press('Enter');await reader.close();
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const row=options.locator(`[data-recent-id="${id}"]`);await expect(row).toBeVisible();
    const remove=async()=>{await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'从最近列表移除',exact:true}).click();await expect(row).toHaveCount(0)};
    await options.setViewportSize({width:360,height:720});await options.emulateMedia({colorScheme:'dark'});await remove();
    const box=await options.locator('.pi-undo-notice').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(8);expect(box!.x+box!.width).toBeLessThanOrEqual(352);expect((await options.locator('.pi-undo-notice > span').boundingBox())!.height).toBeLessThanOrEqual(24);await options.screenshot({path:info.outputPath('undo-recent-dark-360.png')});
    await options.locator('.pi-undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await expect(row).toBeVisible();
    await remove();await worker.evaluate(async({key,id})=>{const api=(globalThis as any).chrome.storage.local,v=await api.get(key);v[key][id]={...v[key][id],name:'较新名称',updatedAt:v[key][id].updatedAt+1};await api.set(v)},{key,id});
    await options.locator('.pi-undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await expect(options.locator('.pi-undo-notice')).toContainText('较新');
    const after=await worker.evaluate(async({key,id})=>(await(globalThis as any).chrome.storage.local.get(key))[key][id],{key,id});expect(after.name).toBe('较新名称');expect(after.hidden).toBe(true);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{if(!reader.isClosed())await reader.close();await options.close();await worker.evaluate(async({keys,before})=>{const api=(globalThis as any).chrome.storage.local;await api.remove(keys);await api.set(before)},{keys:[key,recent,states],before})}
});
test('restores a deleted saved excerpt with its formula, note and source intact',async()=>{
  const worker=context.serviceWorkers()[0]!,key='piWebExcerptsV1',pageUrl='https://example.org/undo-note',pageId=createHash('sha256').update(pageUrl).digest('hex').slice(0,32),item={markerId:'undo-quote',pageUrl,anchor:{sourceText:'A fixed quote.',prefix:'',suffix:''},content:{originalText:'A fixed quote.',translatedText:'固定译文 $x^2$。',sourceTitle:'离线笔记验收',note:'这条人工笔记必须完整保留'},createdAt:1,updatedAt:2};
  const before=await worker.evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key)),key),options=await context.newPage();
  try{
    await worker.evaluate(async({key,pageId,item})=>{await(globalThis as any).chrome.storage.local.set({[key]:{[pageId]:[item]}})},{key,pageId,item});
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();const row=options.locator('.saved-web-excerpt').filter({hasText:'离线笔记验收'});await expect(row).toBeVisible();
    await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'删除摘录',exact:true}).click();await row.getByRole('button',{name:'确认删除',exact:true}).click();await expect(row).toHaveCount(0);
    await options.locator('.pi-undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await expect(row).toBeVisible();
    const restored=await worker.evaluate(async({key,pageId})=>(await(globalThis as any).chrome.storage.local.get(key))[key][pageId],{key,pageId});expect(restored).toEqual([item]);
  }finally{await options.close();await worker.evaluate(async({key,before})=>{const api=(globalThis as any).chrome.storage.local;await api.remove(key);await api.set(before)},{key,before})}
});
