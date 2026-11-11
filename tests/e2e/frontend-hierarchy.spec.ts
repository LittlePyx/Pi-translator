import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Page,TestInfo} from '@playwright/test';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {openSettingsSection} from './support/settings-navigation';
installEdgeExtensionHooks();
const baseline=process.env.PI_FRONTEND_BASELINE==='1';
async function inspect(target:Page,info:TestInfo,name:string){
 const dialog=target.locator('dialog[open]');
 await expect(dialog).toBeVisible();
 const geometry=await dialog.evaluate(node=>({overflow:node.scrollWidth-node.clientWidth,viewportOverflow:document.documentElement.scrollWidth-innerWidth,rect:node.getBoundingClientRect().toJSON()}));
 await writeFile(info.outputPath(`${name}.json`),JSON.stringify(geometry,null,2));
 await target.screenshot({path:info.outputPath(`${name}.png`)});
 expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.viewportOverflow).toBeLessThanOrEqual(1);
 if(!baseline){
  await expect(dialog.locator('.pi-task-heading')).toBeInViewport();
  const buttons=dialog.locator('.pi-task-footer button');
  for(let i=0;i<await buttons.count();i++)await expect(buttons.nth(i)).toBeInViewport();
  const body=dialog.locator('.pi-task-body');
  await body.evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect(dialog.locator('.pi-task-heading')).toBeInViewport();
  for(let i=0;i<await buttons.count();i++)await expect(buttons.nth(i)).toBeInViewport();
 }
}
for(const language of ['zh-CN','en'] as const)test(`keeps deep settings tasks readable and actions reachable in ${language}`,async({},info)=>{
 test.setTimeout(90_000);
 const worker=context.serviceWorkers()[0]!,target=await context.newPage();
 const old=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
 try{
  await worker.evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);
  const stored=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
  const calls=textRequests.length+visionRequests.length;
  for(const [width,height,scheme] of [[1360,900,'light'],[360,700,'dark'],[300,420,'dark']] as const){
   await target.setViewportSize({width,height});await target.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
   await target.goto('about:blank');
   await target.goto(`chrome-extension://${extensionId}/options.html#translation`);
   await expect(target.locator('#api-profile')).toHaveValue('default');
   await target.bringToFront();
   const terms=target.locator('#academic-glossary');await terms.locator('xpath=ancestor::details').locator(':scope > summary').click();
   const csv=Array.from({length:70},(_,i)=>`term ${i},保留人工约定的术语 ${i}`).join('\n');
   await target.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'hierarchy.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
   await inspect(target,info,`import-${width}`);await target.keyboard.press('Escape');
   await expect(target.locator('.glossary-import-dialog')).toHaveCount(0);
   await writeFile(info.outputPath(`import-return-${width}.json`),JSON.stringify(await target.evaluate(()=>({url:location.href,focused:document.activeElement?.outerHTML,open:[...document.querySelectorAll('details[open]')].map(el=>el.id)})),null,2));
   if(!baseline)await expect(target.locator('input[type="file"][accept=".csv,.tsv,.txt"]').locator('..').locator('button').first()).toBeFocused();
   await target.locator('#purpose-preferences > summary').click();await target.locator('input[name="purpose"][value="research"]').check();await target.locator('input[name="purpose"][value="learning"]').check();await target.locator('#purpose-preview').click();
   await inspect(target,info,`purpose-${width}`);await target.keyboard.press('Escape');await expect(target.locator('#purpose-preview')).toBeFocused();
   await openSettingsSection(target,'storage');await target.locator('#library-storage-tools > summary').click();
   await target.getByRole('button',{name:language==='en'?'Save current filter…':'保存当前筛选…',exact:true}).click();
   await inspect(target,info,`saved-filter-${width}`);await target.keyboard.press('Escape');
  }
  expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(stored);
  expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await target.close();await worker.evaluate(async old=>{const s=(globalThis as any).chrome.storage.local;await s.clear();await s.set(old)},old)}
});

for(const language of ['zh-CN','en'] as const)test(`aligns nested diagnostics, prices and support with the product theme in ${language}`,async({},info)=>{
 const worker=context.serviceWorkers()[0]!,target=await context.newPage();const old=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
 try{
  await worker.evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);
  // Fixed local report exercises rendering only; no diagnostic/model request leaves the page.
  await target.addInitScript(()=>{const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>message.type==='DIAGNOSE_API'?Promise.resolve({ok:true,data:{origin:'https://fixture.invalid',permissionGranted:true,authenticated:true,configuredModelAvailable:true,modelCount:12,chatCompletion:true,structuredOutput:false,sentenceAlignment:false,latencyMs:120,notes:['Offline layout fixture']}}):send(message,...args)});
  const stored=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null)),calls=textRequests.length+visionRequests.length;
  for(const [width,scheme] of [[1360,'light'],[360,'dark']] as const){
   await target.setViewportSize({width,height:800});await target.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await target.goto('about:blank');await target.goto(`chrome-extension://${extensionId}/options.html`);await expect(target.locator('#api-profile')).toHaveValue('default');
   await target.locator('#connection-more > summary').click();await target.locator('#connection-advanced > summary').click();await target.locator('#diagnose-api').click();await expect(target.locator('.diagnostic-item')).toHaveCount(7);
   await target.locator('#diagnostic-report').screenshot({path:info.outputPath(`diagnostic-${width}.png`)});
   expect(await target.locator('#diagnostic-report').evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
   await openSettingsSection(target,'cost');await target.locator('#model-price-editor > summary').click();await target.screenshot({path:info.outputPath(`prices-${width}.png`),fullPage:true});
   await openSettingsSection(target,'support');await target.locator('.support-disclosure > summary').first().click();await target.screenshot({path:info.outputPath(`support-${width}.png`),fullPage:true});
   expect(await target.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(stored);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await target.close();await worker.evaluate(async old=>{const s=(globalThis as any).chrome.storage.local;await s.clear();await s.set(old)},old)}
});

for(const language of ['zh-CN','en'] as const)test(`keeps note exports and backup previews focused in ${language}`,async({},info)=>{
 const worker=context.serviceWorkers()[0]!,target=await context.newPage();
 const old=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
 const pageUrl='https://example.org/hierarchy',key=createHash('sha256').update(pageUrl).digest('hex').slice(0,32);
 const record={markerId:'hierarchy-note',pageUrl,anchor:{sourceText:'Energy $E=mc^2$',prefix:'',suffix:''},content:{sourceTitle:'已有资料与人工修改 · Retained source',sourceUrl:pageUrl,originalText:'Energy $E=mc^2$',translatedText:'能量 $E=mc^2$',note:'保留原有笔记与人工约定。'.repeat(30),doi:'10.1234/hierarchy'},createdAt:1,updatedAt:2};
 try{
  await worker.evaluate(async({language,key,record})=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language,piWebExcerptsV1:{[key]:[record]}}),{language,key,record});
  const stored=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));const calls=textRequests.length+visionRequests.length;
  for(const [width,height,scheme] of [[1360,900,'light'],[360,700,'dark'],[300,420,'dark']] as const){
   await target.setViewportSize({width,height});await target.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await target.goto('about:blank');
   await target.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(target.locator('#api-profile')).toHaveValue('default');
   await target.locator('[data-source-kind="excerpt"] .library-select').click();const detail=target.locator('#library-detail');
   await detail.locator('.library-menu > summary').click();await detail.getByRole('button',{name:language==='en'?'Export notes…':'导出笔记…',exact:true}).click();await inspect(target,info,`notes-export-${width}`);
   await expect(target.getByLabel(language==='en'?'Export preview':'导出预览')).toHaveValue(/E=mc\^2/);await target.keyboard.press('Escape');await expect(detail.locator('.library-menu > summary')).toBeFocused();
   await detail.locator('.library-menu > summary').click();await detail.getByRole('button',{name:language==='en'?'Export citation…':'导出引用…',exact:true}).click();await inspect(target,info,`citation-${width}`);await target.keyboard.press('Escape');await expect(detail.locator('.library-menu > summary')).toBeFocused();
   await target.locator('#library-storage-tools > summary').click();const downloading=target.waitForEvent('download');await target.locator('#export-library-backup').click();
   const backup=info.outputPath(`backup-${width}.json`);await(await downloading).saveAs(backup);
   await target.locator('#library-backup-input').setInputFiles(backup);await expect(target.locator('#library-import-dialog')).toBeVisible();await inspect(target,info,`backup-preview-${width}`);await target.locator('#library-import-cancel').click();await expect(target.locator('#library-import-dialog')).not.toBeVisible();
   await target.locator('#library-storage-tools > summary').click();await target.locator('.library-storage-note > summary').click();await target.locator('.retained-storage-privacy').scrollIntoViewIfNeeded();
   if(!baseline)await expect(target.locator('.retained-storage-privacy section')).toHaveCount(4);
   await target.screenshot({path:info.outputPath(`backup-help-${width}.png`)});
   expect(await target.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null))).toEqual(stored);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await target.close();await worker.evaluate(async old=>{const s=(globalThis as any).chrome.storage.local;await s.clear();await s.set(old)},old)}
});
