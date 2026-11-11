import {createHash} from 'node:crypto';
import {delayStorageWrite,releaseStorageWrite} from './support/storage-delay';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {executedExtensionBackground} from './support/executed-extension-source';
import {CONFIGURATION_REVISION_STORAGE_KEY} from '../../core/settings/configuration-revision';
import {context,page,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests,mockControl,ARTICLE_FIXTURE_URL,createTwoPageTextPdf,OVERLEAF_FIXTURE_URL,selectElementText} from './support/edge-extension-fixture';
import {clickPdfReaderAction,openTranslationMore} from './support/translation-controls';
installEdgeExtensionHooks();
const worker=()=>context.serviceWorkers()[0]!;
const snapshot=()=>worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
async function preserve(run:()=>Promise<void>){const before=await snapshot();try{await run()}finally{await worker().evaluate(async before=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.local.set(before)},before)}}
const sourceUrl='https://example.org/context',sourceKey=createHash('sha256').update(sourceUrl).digest('hex').slice(0,32);
const note={markerId:'contextual-word',pageUrl:sourceUrl,anchor:{sourceText:'evidence',prefix:'The ',suffix:' is clear.'},content:{sourceTitle:'Known scientific source',sourceUrl,originalText:'evidence',translatedText:'证据',note:'我的原有笔记',doi:'10.1234/paper',authors:'Doe, Jane',year:'2024'},createdAt:1,updatedAt:2};

test('keeps absolutely positioned sidenotes apart while translations expand and restores their positions',async()=>{
 await page.goto(ARTICLE_FIXTURE_URL);
 await page.evaluate(()=>{const column=document.createElement('div');column.className='sidenote-column';column.style.cssText='position:relative;width:320px;height:500px';column.innerHTML='<blockquote class="sidenote-margin" style="position:absolute;top:0px;width:300px"><p id="note-first">The first sidenote explains a detailed experiment and its implications for the reader.</p></blockquote><blockquote class="sidenote-margin" style="position:absolute;top:100px;width:300px"><p id="note-second">The second sidenote explains another aspect of this experiment.</p></blockquote>';document.querySelector('article')!.append(column)});
 const first=page.locator('.sidenote-margin').first(),second=page.locator('.sidenote-margin').nth(1);
 const tabId=await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL);await popupExtensionMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}});await expect(first.locator('[data-pi-bilingual-translation]')).toBeVisible();
 await expect.poll(async()=>{const a=await first.boundingBox(),b=await second.boundingBox();return b!.y-(a!.y+a!.height)}).toBeGreaterThanOrEqual(9);
 await expect(page.locator('#pi-translator-bilingual-page-control .bar')).toHaveAttribute('data-phase','complete');await page.locator('.sidenote-column').evaluate(e=>e.querySelectorAll('[data-pi-bilingual-translation]').forEach(node=>node.remove()));await expect.poll(()=>second.evaluate(e=>(e as HTMLElement).style.top)).toBe('100px');
});

async function popupExtensionMessage(message:unknown):Promise<any>{
 const sender=await context.newPage();try{await sender.goto(`chrome-extension://${extensionId}/options.html`);await expect(sender.locator('#api-profile')).not.toHaveValue('');return await sender.evaluate(async message=>await(globalThis as any).chrome.runtime.sendMessage(message),message)}finally{await sender.close()}
}

async function preparePopupStateGate(popup:Page,mode:'hold'|'reject'){
 const tab=await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0],ARTICLE_FIXTURE_URL);
 await popup.addInitScript(({tab,mode})=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);let first=true;c.tabs.query=async()=>[tab];c.runtime.sendMessage=async(message:any,...args:any[])=>{if(message.type==='GET_BILINGUAL_PAGE_STATE'&&first){first=false;const response=await send(message,...args);g.popupStateGateReady=true;if(mode==='reject')throw new Error('Controlled status read failure');await new Promise<void>(resolve=>g.releasePopupStateGate=resolve);return response}return send(message,...args)}},{tab,mode});
}

for(const language of ['zh-CN','en'] as const)test(`keeps popup navigation usable while page status is delayed in ${language}`,async({},info)=>preserve(async()=>{
 await worker().evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);await page.goto(ARTICLE_FIXTURE_URL);
 await popupExtensionMessage({type:'GET_BILINGUAL_PAGE_STATE',payload:{tabId:await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL)}});
 const popup=await context.newPage(),before=await snapshot(),calls=textRequests.length+visionRequests.length;
 try{
  await preparePopupStateGate(popup,'hold');await popup.setViewportSize(language==='en'?{width:300,height:420}:{width:360,height:700});await popup.emulateMedia({colorScheme:language==='en'?'dark':'light',reducedMotion:'reduce'});await popup.goto(`chrome-extension://${extensionId}/popup.html`);await expect.poll(()=>popup.evaluate(()=>(globalThis as any).popupStateGateReady)).toBe(true);
  await expect(popup.locator('#quick-actions')).toHaveAttribute('data-primary','article');await expect(popup.locator('#translate-page')).toBeDisabled();await expect(popup.locator('#target-language')).toBeDisabled();await expect(popup.locator('#readiness-panel')).not.toHaveAttribute('data-state','loading');
  await expect(popup.locator('#translate-page')).toHaveText(language==='en'?'Reload page status':'重新读取正文状态');await expect(popup.locator('#translate-page')).toBeEnabled();await expect(popup.locator('#target-language')).toBeDisabled();await expect(popup.locator('#open-library')).toBeInViewport();expect(await popup.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);await popup.screenshot({path:info.outputPath(`popup-delayed-${language}.png`)});const opened=context.waitForEvent('page');await popup.locator('#open-library').click();const library=await opened;await expect(library.locator('#settings-storage')).toBeVisible();await expect.poll(()=>popup.isClosed()).toBe(true);await library.close();expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{if(!popup.isClosed()){await popup.evaluate(()=>(globalThis as any).releasePopupStateGate?.());await popup.close()}}
}));

test('retries only popup status and ignores an older idle reply after the page completes',async({},info)=>preserve(async()=>{
 await page.goto(ARTICLE_FIXTURE_URL);const tabId=await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL);await popupExtensionMessage({type:'GET_BILINGUAL_PAGE_STATE',payload:{tabId}});const popup=await context.newPage();
 try{
  await preparePopupStateGate(popup,'hold');await popup.goto(`chrome-extension://${extensionId}/popup.html`);await expect.poll(()=>popup.evaluate(()=>(globalThis as any).popupStateGateReady)).toBe(true);await expect(popup.locator('#quick-actions')).toHaveAttribute('data-primary','article');
  await popup.evaluate(async tabId=>await(globalThis as any).chrome.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}}),tabId);await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成 7/7');await expect(page.locator('[data-pi-bilingual-text]')).toHaveCount(7);const before=await snapshot(),calls=textRequests.length+visionRequests.length,prose=await page.locator('[data-pi-bilingual-text]').allTextContents();
  await expect(popup.locator('#translate-page')).toHaveText('重新读取正文状态');await popup.locator('#translate-page').click();await expect(popup.locator('#translate-page')).toHaveAttribute('data-phase','complete');await expect(popup.locator('#translate-page')).toContainText('清除双语正文');await expect(popup.locator('#target-language')).toBeEnabled();await popup.evaluate(()=>(globalThis as any).releasePopupStateGate());await popup.waitForTimeout(150);await expect(popup.locator('#translate-page')).toHaveAttribute('data-phase','complete');expect(await page.locator('[data-pi-bilingual-text]').allTextContents()).toEqual(prose);expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);await popup.screenshot({path:info.outputPath('popup-retry-current-state.png')});
 }finally{if(!popup.isClosed()){await popup.evaluate(()=>(globalThis as any).releasePopupStateGate?.());await popup.close()}await popupExtensionMessage({type:'CONTROL_BILINGUAL_PAGE',payload:{tabId,action:'clear'}})}
}));

test('requires a status retry after a rejected popup read instead of offering a fresh translation',async()=>preserve(async()=>{
 await page.goto(ARTICLE_FIXTURE_URL);const expectedPhase=(await popupExtensionMessage({type:'GET_BILINGUAL_PAGE_STATE',payload:{tabId:await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL)}})).data.state.phase,popup=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{await preparePopupStateGate(popup,'reject');await popup.goto(`chrome-extension://${extensionId}/popup.html`);await expect.poll(()=>popup.evaluate(()=>(globalThis as any).popupStateGateReady)).toBe(true);await expect(popup.locator('#translate-page')).toHaveText('重新读取正文状态');await expect(popup.locator('#target-language')).toBeDisabled();const before=await snapshot();await popup.locator('#translate-page').click();await expect(popup.locator('#translate-page')).toHaveAttribute('data-phase',expectedPhase);await expect(popup.locator('#translate-page')).not.toHaveText('重新读取正文状态');await expect(popup.locator('#target-language')).toBeEnabled();expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls)}finally{await popup.close()}
}));

test('waits for webpage initialization before reporting the restored reading state',async({},info)=>preserve(async()=>{
 await page.goto(ARTICLE_FIXTURE_URL);const tabId=await worker().evaluate(async url=>(await(globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL);try{await popupExtensionMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}});await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成 7/7');await expect(page.locator('[data-pi-bilingual-text]')).toHaveCount(7);const prose=await page.locator('[data-pi-bilingual-text]').allTextContents();await page.goto(OVERLEAF_FIXTURE_URL);
 await worker().evaluate(url=>{const g=globalThis as any,c=g.chrome;g.popupOriginalGet=c.storage.local.get.bind(c.storage.local);g.popupPublicObserver=(message:any,sender:any)=>{if(message.type==='GET_PUBLIC_SETTINGS'&&sender.tab?.url===url)g.holdPopupPublicSettings=true};c.runtime.onMessage.addListener(g.popupPublicObserver);c.storage.local.get=async(key:any,...args:any[])=>{if(key==='extensionSettings'&&g.holdPopupPublicSettings){g.holdPopupPublicSettings=false;g.popupPublicGateReady=true;await new Promise<void>(resolve=>g.releasePopupPublicGate=resolve)}return g.popupOriginalGet(key,...args)}},ARTICLE_FIXTURE_URL);
 await page.goto(ARTICLE_FIXTURE_URL);const calls=textRequests.length+visionRequests.length,boot=popupExtensionMessage({type:'GET_BILINGUAL_PAGE_STATE',payload:{tabId}});
 try{await expect.poll(()=>worker().evaluate(()=>(globalThis as any).popupPublicGateReady)).toBe(true);await worker().evaluate(tabId=>{const g=globalThis as any;g.popupStateProbe=undefined;void g.chrome.tabs.sendMessage(tabId,{type:'GET_BILINGUAL_PAGE_STATE_IN_TAB'}).then((response:any)=>g.popupStateProbe=response)},tabId);await page.waitForTimeout(150);const probe=await worker().evaluate(()=>(globalThis as any).popupStateProbe);await info.attach('state-during-initialization',{body:JSON.stringify({probe:probe??null,expectedRestoredPhase:'complete'}),contentType:'application/json'});expect(probe).toBeUndefined();}
 finally{await worker().evaluate(()=>{const g=globalThis as any,c=g.chrome;g.releasePopupPublicGate?.();c.runtime.onMessage.removeListener(g.popupPublicObserver);c.storage.local.get=g.popupOriginalGet});await boot}
 await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成 7/7');expect(await page.locator('[data-pi-bilingual-text]').allTextContents()).toEqual(prose);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await popupExtensionMessage({type:'CONTROL_BILINGUAL_PAGE',payload:{tabId,action:'clear'}})}
}));

test('locks a submitted region note while saving without sending an image or changing its anchor',async()=>preserve(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'region-note-save.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('A scientific figure region.','A second page.')});const page=reader.locator('.pdf-page').first();await expect(page).toHaveAttribute('data-rendered','ready');await clickPdfReaderAction(reader,'region-translate');const rect=(await page.boundingBox())!;await reader.mouse.move(rect.x+30,rect.y+80);await reader.mouse.down();await reader.mouse.move(rect.x+220,rect.y+180,{steps:8});await reader.mouse.up();await reader.locator('.region-confirm').getByRole('button',{name:'区域笔记',exact:true}).click();const dialog=reader.getByRole('dialog',{name:'区域笔记',exact:true}),input=dialog.getByRole('textbox');await input.fill('已提交的图表观察');await delayStorageWrite(reader,'piPdfAreaNotesV1');await dialog.getByRole('button',{name:'保存笔记',exact:true}).click();await expect.poll(()=>reader.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);const saved=(await snapshot()).piPdfAreaNotesV1;await expect(input).toHaveJSProperty('readOnly',true);await input.press('End');await input.pressSequentially('late draft');await expect(input).toHaveValue('已提交的图表观察');await releaseStorageWrite(reader);await expect(dialog).toHaveCount(0);expect((await snapshot()).piPdfAreaNotesV1).toEqual(saved);expect(Object.values(saved).flatMap((state:any)=>state.notes).some((item:any)=>item.note==='已提交的图表观察')).toBe(true);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await releaseStorageWrite(reader);await reader.close()}
}));

async function openParagraphShortcut(modifier:'alt'|'shift'){
  await worker().evaluate(async modifier=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,paragraphShortcut:modifier,enableSessionCache:false,generalPageMode:'allowlist',siteAllowlist:['www.overleaf.com']}})},modifier);
  await page.goto(ARTICLE_FIXTURE_URL);await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},files:['content-scripts/general.js']})},page.url());await expect(page.locator('#tex-selection-translator-root')).toHaveCount(1);
}
function holdParagraph(){const started=new Promise<void>(resolve=>{mockControl.bilingualRequestStarted=resolve});mockControl.heldBilingualRequestGate=new Promise<void>(resolve=>{mockControl.releaseHeldBilingualRequest=resolve});mockControl.holdNextBilingualRequest=true;return started}
for(const [modifier,width] of [['alt',1100],['shift',360]] as const)test(`resumes a stopped paragraph with the same ${modifier} shortcut at ${width}px`,async()=>preserve(async()=>{
  await page.setViewportSize({width,height:850});await openParagraphShortcut(modifier);const before=textRequests.length,started=holdParagraph(),paragraph=page.locator('#article-intro');
  try{
    await paragraph.click({modifiers:[modifier==='alt'?'Alt':'Shift']});await started;const control=page.locator('#pi-translator-bilingual-page-control');await control.locator('details.more > summary').click();await control.locator('[data-action="stop"]').click();await expect(control.locator('output')).toContainText('已停止');mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined;
    await page.evaluate(()=>getSelection()?.removeAllRanges());await paragraph.click({modifiers:[modifier==='alt'?'Alt':'Shift']});await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toBeVisible();expect(textRequests.length).toBe(before+2);await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(1);
  }finally{mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined}
}));

for(const modifier of ['alt','shift'] as const)test(`leaves native and ARIA controls usable under the ${modifier} paragraph shortcut`,async()=>preserve(async()=>{
  await openParagraphShortcut(modifier);const before=textRequests.length;
  await page.evaluate(()=>{const article=document.querySelector('article')!,p=document.createElement('p'),label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='shortcut-checkbox';label.htmlFor=checkbox.id;label.id='shortcut-label';label.textContent='A practical guide to reliable bilingual reading should keep this native checkbox usable.';p.append(label);article.prepend(p,checkbox);
    const role=document.createElement('p');role.id='shortcut-role';role.role='checkbox';role.tabIndex=0;role.setAttribute('aria-checked','false');role.textContent='A practical guide to reliable bilingual reading should keep this ARIA widget usable.';role.addEventListener('click',()=>role.setAttribute('aria-checked','true'));article.append(role);
    const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');details.id='shortcut-details';text.id='shortcut-summary';text.textContent='A practical guide to reliable bilingual reading should keep this disclosure usable.';summary.append(text);details.append(summary,document.createTextNode('Native disclosure content'));article.append(details)});
  await page.locator('#shortcut-label').click({modifiers:[modifier==='alt'?'Alt':'Shift']});await expect(page.locator('#shortcut-checkbox')).toBeChecked();await page.evaluate(()=>getSelection()?.removeAllRanges());await page.locator('#shortcut-role').click({modifiers:[modifier==='alt'?'Alt':'Shift']});await expect(page.locator('#shortcut-role')).toHaveAttribute('aria-checked','true');await page.evaluate(()=>getSelection()?.removeAllRanges());await page.locator('#shortcut-summary').click({modifiers:[modifier==='alt'?'Alt':'Shift']});await expect(page.locator('#shortcut-details')).toHaveJSProperty('open',true);expect(textRequests.length).toBe(before);await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
}));

test('cancels a waiting paragraph beside its source and ignores the late response without clearing saved work',async({},info)=>preserve(async()=>{
  await page.setViewportSize({width:360,height:850});await openParagraphShortcut('alt');const before=await snapshot(),started=holdParagraph();
  try{
    await page.locator('#article-intro').click({modifiers:['Alt']});await started;const pending=page.locator('[data-pi-bilingual-pending]');await expect(pending).toBeVisible();const cancel=pending.getByRole('button',{name:'取消本段翻译',exact:true});await expect(cancel).toBeVisible();await expect(page.locator('#pi-translator-bilingual-page-control .control-title')).toHaveText('单段翻译');await page.screenshot({path:info.outputPath('paragraph-wait-360.png')});await cancel.click();await expect(pending).toHaveCount(0);const control=page.locator('#pi-translator-bilingual-page-control');await expect(control.locator('output')).toContainText('已停止');await expect(control.locator('[data-action="pause"]')).toBeFocused();
    mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined;await page.waitForTimeout(400);await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);expect(await snapshot()).toEqual(before);await page.screenshot({path:info.outputPath('paragraph-cancel-360.png')});
  }finally{mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined}
}));

test('keeps a conflict-only glossary import out of the unsaved settings state',async()=>preserve(async()=>{
  const options=await context.newPage();try{
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,academicGlossary:[{source:'evidence',target:'人工约定'}]}})});await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();const before=await snapshot();
    const upload=()=>options.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'terms.csv',mimeType:'text/csv',buffer:Buffer.from('evidence,候选译法')});await upload();await options.locator('.glossary-import-dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('#save-button')).toBeDisabled();await upload();await options.locator('.glossary-import-dialog').getByRole('button',{name:'确认导入',exact:true}).click();await expect(options.locator('#save-button')).toBeDisabled();await expect(options.locator('#academic-glossary')).toHaveValue('evidence = 人工约定');expect(await snapshot()).toEqual(before);
    const raw='  evidence   =   人工约定  \n';await options.locator('#academic-glossary').fill(raw);await upload();await options.locator('.glossary-import-dialog').getByRole('button',{name:'确认导入',exact:true}).click();await expect(options.locator('#academic-glossary')).toHaveValue(raw);expect(await snapshot()).toEqual(before);
  }finally{await options.close()}
}));

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`explains glossary draft and saved state locally in ${language} at ${width}px`,async({},info)=>preserve(async()=>{
  const options=await context.newPage();try{
    await worker().evaluate(async language=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({uiLanguagePreference:language,extensionSettings:{...s,academicGlossary:[{source:'evidence',target:'人工约定'}]}})},language);await options.setViewportSize({width,height:850});await options.emulateMedia({colorScheme:language==='en'?'dark':'light'});await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();const before=await snapshot();
    await options.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'terms.csv',mimeType:'text/csv',buffer:Buffer.from('evidence,候选译法\nnew term,新增术语')});await options.locator('.glossary-import-dialog').getByRole('button',{name:language==='en'?'Confirm import':'确认导入',exact:true}).click();const status=options.locator('#glossary-transfer-status');await expect(status).toContainText(language==='en'?'draft':'草稿');await expect(status).toContainText(language==='en'?'conflict':'冲突');await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);await status.scrollIntoViewIfNeeded();await expect(status).toBeInViewport();await options.screenshot({path:info.outputPath(`glossary-draft-${language}.png`)});
    await options.locator('#save-button').click();await expect(status).toHaveText(language==='en'?'Glossary saved with settings.':'术语已随设置保存。');const after=await snapshot();expect((after.extensionSettings as any).academicGlossary).toEqual([{source:'new term',target:'新增术语'},{source:'evidence',target:'人工约定'}]);expect(after[CONFIGURATION_REVISION_STORAGE_KEY]).toMatchObject({invalidatesTranslationState:true});for(const key of Object.keys(before).filter(key=>key!=='extensionSettings'&&key!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
  }finally{await options.close()}
}));

test('keeps the imported glossary draft and its pending notice when another window fills glossary capacity',async()=>preserve(async()=>{
  const options=await context.newPage();try{
    await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'terms.csv',mimeType:'text/csv',buffer:Buffer.from('fixed new term,草稿术语')});await options.locator('.glossary-import-dialog').getByRole('button',{name:'确认导入',exact:true}).click();const draft=await options.locator('#academic-glossary').inputValue();
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,academicGlossary:Array.from({length:100},(_,i)=>({source:`concurrent term ${i}`,target:'另一窗口的约定'}))}})});const concurrent=await snapshot();await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('100');await expect(options.locator('#save-button')).toBeEnabled();await expect(options.locator('#glossary-transfer-status')).toContainText('草稿');await expect(options.locator('#academic-glossary')).toHaveValue(draft);expect(await snapshot()).toEqual(concurrent);
  }finally{await options.close()}
}));

test('switches an explicitly requested paragraph while waiting and ignores the superseded response',async()=>preserve(async()=>{
  await openParagraphShortcut('alt');const before=await snapshot(),calls=textRequests.length,started=holdParagraph();
  try{
    await page.locator('#article-intro').click({modifiers:['Alt']});await started;await page.locator('#article-method').click({modifiers:['Alt']});mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined;await expect(page.locator('#article-method + [data-pi-bilingual-translation]')).toBeVisible();await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toHaveCount(0);await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成');expect(textRequests.length).toBe(calls+2);expect(await snapshot()).toEqual(before);
  }finally{mockControl.releaseHeldBilingualRequest?.();mockControl.releaseHeldBilingualRequest=undefined}
}));

for(const width of [1100,360])test(`refreshes area notes across reading, search and the existing editor at ${width}px`,async({},info)=>preserve(async()=>{
  const reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async({key,note})=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.clear();await c.storage.local.set({extensionSettings:s,uiLanguagePreference:'zh-CN',piWebExcerptsV1:{[key]:[note]}})},{key:sourceKey,note});
    const bytes=createTwoPageTextPdf('A diagram for the reading note workflow.','The reading continues here.');
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'reading-loop.pdf',mimeType:'application/pdf',buffer:bytes});
    const source=reader.locator('.pdf-page').first();await expect(source).toHaveAttribute('data-rendered','ready');
    await options.setViewportSize({width,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const search=options.locator('#retained-library-search');await search.fill('待讨论的图表');
    const legacy=options.locator('#web-excerpts-library');await legacy.locator(':scope > summary').click();await options.locator('#web-excerpts-search').fill('待讨论的图表');
    await clickPdfReaderAction(reader,'region-translate');const rect=(await source.boundingBox())!;await reader.mouse.move(rect.x+30,rect.y+80);await reader.mouse.down();await reader.mouse.move(rect.x+220,rect.y+180,{steps:8});await reader.mouse.up();await reader.locator('.region-confirm').getByRole('button',{name:'区域笔记',exact:true}).click();
    const dialog=reader.getByRole('dialog',{name:'区域笔记',exact:true});await dialog.getByRole('textbox').fill('待讨论的图表：保留原始观察');await dialog.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(dialog).toHaveCount(0);
    const row=options.locator('[data-source-kind="excerpt"]');await expect(row).toHaveCount(1);await expect(legacy.locator('.saved-web-excerpt-note')).toContainText('保留原始观察');
    await row.locator('.library-select').click();const detail=options.locator('#library-detail'),edit=detail.locator('.library-detail-edit'),editor=legacy.locator('.saved-web-excerpt-editor');
    const spacing=await detail.evaluate(node=>{const edit=node.querySelector('.library-detail-edit')!.getBoundingClientRect(),tags=node.querySelector('.library-tag-edit')!.getBoundingClientRect();return tags.top>=edit.bottom||tags.left-edit.right>=12});expect(spacing).toBe(true);
    const before=await snapshot();await edit.click();await editor.getByRole('textbox',{name:'个人笔记',exact:true}).fill('取消的临时草稿');await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(edit).toBeFocused();await expect(search).toHaveValue('待讨论的图表');expect(await snapshot()).toEqual(before);
    await edit.click();await editor.getByRole('textbox',{name:'个人笔记',exact:true}).fill('待讨论的图表：编辑后的观察');await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(edit).toBeFocused();await expect(detail.locator('.library-personal-note')).toHaveText('待讨论的图表：编辑后的观察');
    await clickPdfReaderAction(reader,'pdf-open-annotations');await expect(reader.locator('#pdf-annotations-dialog')).toContainText('编辑后的观察');
    await reader.locator('#pdf-annotations-dialog').getByRole('button',{name:'编辑笔记',exact:true}).click();await dialog.getByRole('textbox').fill('待讨论的图表：阅读时再次补充');await dialog.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(detail.locator('.library-personal-note')).toHaveText('待讨论的图表：阅读时再次补充');await expect(legacy.locator('.saved-web-excerpt-note')).toContainText('阅读时再次补充');
    await expect(row.locator('.library-meta')).toContainText('区域笔记');
    await edit.click();await editor.getByRole('textbox',{name:'个人笔记',exact:true}).fill('待讨论的图表：未保存的本地草稿');
    await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.locator('#pdf-annotations-dialog').getByRole('button',{name:'编辑笔记',exact:true}).click();await dialog.getByRole('textbox').fill('待讨论的图表：另一窗口的新观察');await dialog.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(editor.getByRole('textbox',{name:'个人笔记',exact:true})).toHaveValue('待讨论的图表：未保存的本地草稿');const concurrent=(await snapshot()).piPdfAreaNotesV1;
    await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor.locator('.saved-web-excerpt-editor-error')).toContainText('其他窗口');await expect(editor.getByRole('textbox',{name:'个人笔记',exact:true})).toHaveValue('待讨论的图表：未保存的本地草稿');expect((await snapshot()).piPdfAreaNotesV1).toEqual(concurrent);
    await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(edit).toBeFocused();await expect(detail.locator('.library-personal-note')).toHaveText('待讨论的图表：另一窗口的新观察');
    const saved=(await snapshot()).piPdfAreaNotesV1;
    await reader.setViewportSize({width,height:850});const tabs=context.pages().length;
    await detail.locator('.library-source-open').click();await expect(reader.locator('[data-library-source]').first()).toBeInViewport();await expect(reader.locator('#notice')).toContainText('已定位原文');expect(context.pages().length).toBe(tabs);
    await expect(search).toHaveValue('待讨论的图表');expect((await snapshot()).piPdfAreaNotesV1).toEqual(saved);
    await reader.locator('#page-number').fill('2');await reader.locator('#page-number').press('Enter');await expect(reader.locator('#page-number')).toHaveValue('2');
    await reader.reload();await reader.locator('#file-input').setInputFiles({name:'renamed-reading-loop.pdf',mimeType:'application/pdf',buffer:bytes});await expect(reader.locator('#page-number')).toHaveValue('2');expect((await snapshot()).piPdfAreaNotesV1).toEqual(saved);expect((await snapshot()).piWebExcerptsV1).toEqual(before.piWebExcerptsV1);
    if(width===360)await options.locator('.library-detail-back').click();await expect(search).toHaveValue('待讨论的图表');await options.screenshot({path:info.outputPath(`reading-note-search-${width}.png`)});
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close();await options.close()}
}));

for(const rotation of [0,90])test(`reveals the saved area in the reader viewport at 360px and rotation ${rotation}`,async({},info)=>preserve(async()=>{
  const bytes=createTwoPageTextPdf('First page of the source.','The saved figure is at the right of this page.'),fingerprint=createHash('sha256').update(bytes).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
  const area={id:'right-area',sourceTitle:'Reading source',note:'图表观察',anchor:{kind:'region',pageNumber:2,leftRatio:.85,topRatio:.05,widthRatio:.1,heightRatio:.1},createdAt:1,updatedAt:2};
  const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async({id,area})=>await(globalThis as any).chrome.storage.local.set({piPdfAreaNotesV1:{[id]:{notes:[area],updatedAt:2}},uiLanguagePreference:'zh-CN'}),{id,area});
    await reader.setViewportSize({width:360,height:850});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'renamed-source.pdf',mimeType:'application/pdf',buffer:bytes});await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');
    if(rotation)await clickPdfReaderAction(reader,'rotate-page');
    await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.locator('#pdf-annotations-dialog').getByRole('button',{name:'定位原文',exact:true}).click();
    const mark=reader.locator('[data-area-note-id="right-area"]');await expect(mark).toHaveCount(1);
    const geometry=await mark.evaluate(node=>{const stage=node.closest('#pdf-viewer')!.parentElement!,rect=node.getBoundingClientRect(),bounds=stage.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,stage:bounds.toJSON(),bodyScroll:document.body.scrollTop}});
    await writeFile(info.outputPath('area-location.json'),JSON.stringify(geometry,null,2));await reader.screenshot({path:info.outputPath(`area-location-${rotation}.png`)});
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.stage.left-1);expect(geometry.right).toBeLessThanOrEqual(geometry.stage.right+1);expect(geometry.top).toBeGreaterThanOrEqual(geometry.stage.top);expect(geometry.top).toBeLessThan(geometry.stage.bottom);expect(geometry.bodyScroll).toBe(0);await expect(reader.locator('#page-number')).toHaveValue('2');
    expect((await snapshot()).piPdfAreaNotesV1).toEqual({[id]:{notes:[area],updatedAt:2}});expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close()}
}));

for(const width of [1100,360])test(`integrates export presets, contextual vocabulary and topic views at ${width}px without rewriting notes`,async({},info)=>preserve(async()=>{
  const options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async({key,note})=>{const c=(globalThis as any).chrome,settings=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.clear();await c.storage.local.set({extensionSettings:settings,uiLanguagePreference:'zh-CN',piWebExcerptsV1:{[key]:[note]}})},{key:sourceKey,note});
    await options.setViewportSize({width,height:780});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    if(width===360)await options.locator('[data-source-kind="excerpt"] .library-select').click();
    const detail=options.locator('#library-detail');await detail.locator('.library-menu > summary').click();await detail.getByRole('button',{name:'导出笔记…',exact:true}).click();
    const dialog=options.locator('.research-export-dialog');await expect(dialog.getByLabel('导出预览')).toHaveValue(/我的原有笔记/);const duplicateHelp=dialog.locator('details');await expect(duplicateHelp).toBeHidden();
    await dialog.getByLabel('格式',{exact:true}).selectOption('obsidian');await expect(dialog.getByLabel('导出预览')).toHaveValue(/type: research-excerpts/);
    await dialog.getByLabel('格式',{exact:true}).selectOption('anki-basic');await expect(dialog.getByLabel('导出预览')).toHaveValue(/#notetype:Basic/);await expect(dialog).toContainText('语境、笔记和出处都在背面');await expect(duplicateHelp).toBeVisible();await expect(duplicateHelp).toHaveJSProperty('open',false);await duplicateHelp.locator('summary').click();await expect(duplicateHelp).toContainText('Preserve（保留）');await expect(duplicateHelp).toContainText('Basic 背面会整体替换');await options.screenshot({path:info.outputPath(`anki-import-help-${width}.png`)});expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await dialog.getByLabel('格式',{exact:true}).selectOption('obsidian');await expect(duplicateHelp).toBeHidden();await expect(duplicateHelp).toHaveJSProperty('open',false);
    await dialog.getByLabel('格式',{exact:true}).selectOption('anki');await expect(dialog.getByLabel('导出预览')).toHaveValue(/The evidence is clear/);
    await expect(dialog).toContainText('Basic 不适用');
    const downloading=options.waitForEvent('download');await dialog.getByRole('button',{name:'下载',exact:true}).click();const download=await downloading;await download.saveAs(info.outputPath('vocabulary.txt'));expect(await readFile(info.outputPath('vocabulary.txt'),'utf8')).toContain('"evidence"\t"证据"');
    await detail.getByRole('button',{name:'编辑主题标签…'}).click();const tags=options.getByRole('dialog',{name:'主题标签（逗号分隔，最多 12 个）'});await tags.getByRole('textbox').fill('课题 A, 待整理');await tags.getByRole('button',{name:'保存',exact:true}).click();await expect(tags).toHaveCount(0);
    await options.locator('#library-tag-filter').selectOption('课题 A');await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'保存当前筛选…'}).click();const view=options.getByRole('dialog',{name:'筛选名称'});await view.getByRole('textbox').fill('课题 A 笔记');await view.getByRole('button',{name:'保存',exact:true}).click();await expect(view).toHaveCount(0);
    await options.reload();await expect(options.locator('#library-saved-view')).toContainText('课题 A 笔记');await options.locator('#library-saved-view').selectOption({label:'课题 A 笔记'});await expect(options.locator('#library-tag-filter')).toHaveValue('课题 A');
    if(width===360)await options.locator('[data-source-kind="excerpt"] .library-select').click();await detail.locator('.library-menu > summary').click();await detail.getByRole('button',{name:'导出引用…'}).click();const citation=options.locator('.citation-export-dialog');await expect(citation.getByLabel('作者（每行一位，可选）')).toHaveValue('Doe, Jane');await expect(citation.getByLabel('年份（可选）')).toHaveValue('2024');await citation.getByRole('button',{name:'取消',exact:true}).click();
    const after=await snapshot();expect((after.piWebExcerptsV1 as any)[sourceKey]).toEqual([note]);expect(textRequests.length+visionRequests.length).toBe(calls);
    await options.screenshot({path:info.outputPath(`library-tags-${width}.png`)});expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }finally{await options.close()}
}));

test('imports glossary files into the existing draft with cancellation, direction and local-conflict protection',async()=>preserve(async()=>{
  const options=await context.newPage();try{
    await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();
    await options.locator('#academic-glossary').fill('evidence = 人工约定');const before=await snapshot(),file=options.locator('input[type="file"][accept=".csv,.tsv,.txt"]');
    const upload=()=>file.setInputFiles({name:'terms.csv',mimeType:'text/csv',buffer:Buffer.from('evidence,模型候选\nnew term,新增术语')});await upload();const dialog=options.locator('.glossary-import-dialog');await expect(dialog.getByLabel('导入预览')).toHaveValue(/冲突/);await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('#academic-glossary')).toHaveValue('evidence = 人工约定');expect(await snapshot()).toEqual(before);
    await upload();await dialog.getByRole('button',{name:'确认导入',exact:true}).click();await expect(options.locator('#academic-glossary')).toHaveValue('evidence = 人工约定\nnew term = 新增术语');expect(await snapshot()).toEqual(before);
    await options.locator('#save-button').click();await expect.poll(async()=>((await snapshot()).extensionSettings as any).academicGlossary).toEqual([{source:'new term',target:'新增术语'},{source:'evidence',target:'人工约定'}]);
  }finally{await options.close()}
}));

test('translates only an explicitly clicked paragraph and reuses its result without expanding into the article',async()=>preserve(async()=>{
  await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,paragraphShortcut:'alt',generalPageMode:'allowlist',siteAllowlist:['www.overleaf.com']}})});
  await page.goto(ARTICLE_FIXTURE_URL);await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},files:['content-scripts/general.js']})},page.url());
  await expect(page.locator('#tex-selection-translator-root')).toHaveCount(1);
  const paragraph=page.locator('article p').first(),source=await paragraph.textContent(),before=textRequests.length,visionBefore=visionRequests.length;
  await paragraph.hover();expect(textRequests.length).toBe(before);await paragraph.click({modifiers:['Alt']});await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(1);await expect.poll(()=>textRequests.length).toBe(before+1);
  await paragraph.click({modifiers:['Alt']});expect(textRequests.length).toBe(before+1);await expect(page.locator('article p').first()).toHaveText(source!);expect(visionRequests).toHaveLength(visionBefore);
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='A new paragraph must remain untranslated until explicitly requested.';document.querySelector('article')!.append(p)});await page.waitForTimeout(400);expect(textRequests.length).toBe(before+1);
}));

test('saves a PDF region as a note with no OCR and restores it from version 8 alongside existing notes',async({},info)=>preserve(async()=>{
  await worker().evaluate(async({key,note})=>{const c=(globalThis as any).chrome,old=(await c.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1??{};await c.storage.local.set({piWebExcerptsV1:{...old,[key]:[note]}})},{key:sourceKey,note});
  const reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
    const bytes=createTwoPageTextPdf('Original scientific diagram region, no OCR is needed.','Reading continues on page two.');await reader.setViewportSize({width:1100,height:800});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'area-notes.pdf',mimeType:'application/pdf',buffer:bytes});const source=reader.locator('.pdf-page').first();await expect(source).toHaveAttribute('data-rendered','ready');
    await clickPdfReaderAction(reader,'region-translate');const rect=(await source.boundingBox())!;await reader.mouse.move(rect.x+30,rect.y+80);await reader.mouse.down();await reader.mouse.move(rect.x+220,rect.y+180,{steps:12});await reader.mouse.up();await reader.locator('.region-confirm').getByRole('button',{name:'区域笔记',exact:true}).click();
    const dialog=reader.getByRole('dialog',{name:'区域笔记',exact:true});await dialog.getByRole('textbox').fill('图表中有待讨论的现象');await dialog.getByRole('button',{name:'保存笔记',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(reader.locator('.pdf-area-note-mark')).toHaveCount(1);
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('图表中有待讨论');await expect(options.locator('[data-source-kind="excerpt"]')).toHaveCount(1);
    await options.locator('[data-source-kind="excerpt"] .library-select').click();await options.getByRole('button',{name:'编辑主题标签…'}).click();const tags=options.getByRole('dialog',{name:'主题标签（逗号分隔，最多 12 个）'});await tags.getByRole('textbox').fill('图表讨论');await tags.getByRole('button',{name:'保存',exact:true}).click();await expect(tags).toHaveCount(0);
    await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'保存当前筛选…'}).click();const view=options.getByRole('dialog',{name:'筛选名称'});await view.getByRole('textbox').fill('图表研究');await view.getByRole('button',{name:'保存',exact:true}).click();await expect(view).toHaveCount(0);
    await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const download=await downloading;await download.saveAs(info.outputPath('v8.json'));const backup=JSON.parse(await readFile(info.outputPath('v8.json'),'utf8'));expect(backup.version).toBe(8);expect(Object.values(backup.areaNotes)).toHaveLength(1);
    const saved=await snapshot();await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.remove(['piPdfAreaNotesV1','piLibraryOrganizationV1']));await expect(reader.locator('.pdf-area-note-mark')).toHaveCount(0);
    const upload=()=>options.locator('#library-backup-input').setInputFiles(info.outputPath('v8.json'));await upload();const restore=options.locator('#library-import-dialog');await expect(restore).toBeVisible();await expect(restore.locator('#library-import-summary')).toContainText('区域笔记 1 条');await restore.locator('#library-import-cancel').click();expect((await snapshot()).piPdfAreaNotesV1).toBeUndefined();expect((await snapshot()).piLibraryOrganizationV1).toBeUndefined();
    await upload();await expect(restore).toBeVisible();await restore.locator('#library-import-confirm').click();await expect(restore).toBeHidden();await expect(reader.locator('.pdf-area-note-mark')).toHaveCount(1);const restored=await snapshot();expect(restored.piPdfAreaNotesV1).toEqual(saved.piPdfAreaNotesV1);expect(restored.piLibraryOrganizationV1).toEqual(saved.piLibraryOrganizationV1);expect(restored.piWebExcerptsV1).toEqual(saved.piWebExcerptsV1);await expect(options.locator('#library-saved-view')).toContainText('图表研究');
    await reader.reload();await reader.locator('#file-input').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer:bytes});await expect(reader.locator('.pdf-area-note-mark')).toHaveCount(1);const anchors=(await snapshot()).piPdfAreaNotesV1;await clickPdfReaderAction(reader,'rotate-page');await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-view-rotation','90');await expect(reader.locator('.pdf-area-note-mark')).toHaveCount(1);expect((await snapshot()).piPdfAreaNotesV1).toEqual(anchors);expect(textRequests.length+visionRequests.length).toBe(calls);await reader.screenshot({path:info.outputPath('region-note.png')});
  }finally{await reader.close();await options.close()}
}));

test('uses the exact built background and settings modules and keeps English export usable on a narrow screen',async({},info)=>preserve(async()=>{
  const options=await context.newPage();try{
    await worker().evaluate(async({key,note})=>{const c=(globalThis as any).chrome;await c.storage.local.set({piWebExcerptsV1:{[key]:[note]},uiLanguagePreference:'en'})},{key:sourceKey,note});
    await options.setViewportSize({width:360,height:700});await options.emulateMedia({colorScheme:'dark'});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const built=path.resolve(process.env.PI_E2E_EXTENSION_PATH??'.output/edge-mv3'),background=await executedExtensionBackground(context,extensionId);expect(background).toBe(createHash('sha256').update(await readFile(path.join(built,'background.js'))).digest('hex'));
    const cdp=await context.newCDPSession(options),scripts:{scriptId:string;url:string}[]=[];cdp.on('Debugger.scriptParsed',script=>{if(script.url.startsWith(`chrome-extension://${extensionId}/`)&&script.url.endsWith('.js'))scripts.push(script)});await cdp.send('Debugger.enable');
    const checked=[];for(const script of scripts){const source=(await cdp.send('Debugger.getScriptSource',{scriptId:script.scriptId})).scriptSource,relative=new URL(script.url).pathname.slice(1),actual=createHash('sha256').update(source).digest('hex'),expected=createHash('sha256').update(await readFile(path.join(built,relative))).digest('hex');expect(actual).toBe(expected);checked.push({relative,sha256:actual})}expect(checked.length).toBeGreaterThanOrEqual(5);await cdp.detach();await writeFile(info.outputPath('executed-source.json'),JSON.stringify({background,optionsModules:checked,allExact:true},null,2));
    await options.locator('[data-source-kind="excerpt"]').filter({hasText:note.content.sourceTitle}).locator('.library-select').click();const detail=options.locator('#library-detail');await detail.locator('.library-menu > summary').click();await detail.getByRole('button',{name:'Export notes…'}).click();const dialog=options.locator('.research-export-dialog');await dialog.getByLabel('Format',{exact:true}).selectOption('anki');await expect(dialog.getByLabel('Export preview')).toHaveValue(/evidence/);await expect(dialog.getByRole('button',{name:'Download',exact:true})).toBeInViewport();expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath('notes-export-360-en-dark.png')});await dialog.locator('details > summary').click();await expect(dialog.locator('details')).toContainText('Choose Preserve');await expect(dialog.locator('details')).toContainText('entire Basic back');await dialog.getByRole('button',{name:'Download',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'Download',exact:true})).toBeInViewport();expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath('anki-import-help-360-en-dark.png')});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  }finally{await options.close()}
}));

const schemeSeed={glossaryProfiles:[{id:'statistics',name:'统计学',entries:[{source:'power',target:'检验效能'}]},{id:'energy',name:'能源',entries:[{source:'power',target:'电功率'}]}],activeGlossaryProfileId:'statistics',academicGlossary:[{source:'power',target:'通用人工译法'},{source:'sample',target:'样本'}]};
async function seedSchemes(){await worker().evaluate(async seed=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,...seed}})},schemeSeed)}
async function schemeOptions(){const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();return options}

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`retains glossary scheme drafts and import conflicts through save and reload in ${language} at ${width}px`,async({},info)=>preserve(async()=>{
  await seedSchemes();await worker().evaluate(async language=>{await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language})},language);const options=await schemeOptions();try{
    await options.setViewportSize({width,height:850});await options.emulateMedia({colorScheme:language==='en'?'dark':'light'});await expect(options.locator('#glossary-profile')).toHaveValue('statistics');await expect(options.locator('#academic-glossary')).toHaveValue('power = 检验效能');const before=await snapshot();
    const raw='  power =  本方案人工修改  \n';await options.locator('#academic-glossary').fill(raw);await options.locator('#glossary-profile').selectOption('energy');await options.locator('#academic-glossary').fill('power = 电功率\nheat = 热量');await options.locator('#glossary-profile').selectOption('statistics');await expect(options.locator('#academic-glossary')).toHaveValue(raw);
    await options.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'statistics.csv',mimeType:'text/csv',buffer:Buffer.from('power,候选错误译法\nsignificance,显著性')});await options.locator('.glossary-import-dialog button.primary').click();await expect(options.locator('#glossary-transfer-status')).toContainText(language==='en'?'draft':'草稿');expect(await snapshot()).toEqual(before);
    await options.locator('#glossary-profile').selectOption('general');await expect(options.locator('#academic-glossary')).toHaveValue('power = 通用人工译法\nsample = 样本');await options.locator('#glossary-profile').selectOption('statistics');await options.locator('#glossary-profile').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath(`scheme-draft-${language}.png`)});await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();
    const after=await snapshot(),s=after.extensionSettings as any;expect(s.academicGlossary).toEqual(schemeSeed.academicGlossary);expect(s.glossaryProfiles.find((p:any)=>p.id==='statistics').entries).toEqual([{source:'significance',target:'显著性'},{source:'power',target:'本方案人工修改'}]);expect(s.glossaryProfiles.find((p:any)=>p.id==='energy').entries).toContainEqual({source:'heat',target:'热量'});for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
    await options.reload();await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();await expect(options.locator('#glossary-profile')).toHaveValue('statistics');await expect(options.locator('#academic-glossary')).toHaveValue('significance = 显著性\npower = 本方案人工修改');await options.locator('#glossary-profile').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath(`scheme-saved-${language}.png`)});
  }finally{await options.close()}
}));

test('creates and renames a scheme without altering the general draft and rejects stale import previews',async()=>preserve(async()=>{
  const options=await schemeOptions();try{
    const before=await snapshot();await options.locator('#academic-glossary').fill('  original = 人工词条 \n');options.once('dialog',d=>d.accept('生物信息学'));await options.locator('#glossary-profile-add').click();await expect(options.locator('#academic-glossary')).toHaveValue('');const id=await options.locator('#glossary-profile').inputValue();await options.locator('#academic-glossary').fill('gene = 基因');
    options.once('dialog',d=>d.accept('基因组学'));await options.locator('#glossary-profile-rename').click();await expect(options.locator('#glossary-profile option:checked')).toHaveText('基因组学');
    await options.locator('input[type="file"][accept=".csv,.tsv,.txt"]').setInputFiles({name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('sample,样本')});await expect(options.locator('.glossary-import-dialog')).toBeVisible();
    // Simulate a queued programmatic scheme change while the import dialog is open.
    await options.locator('#glossary-profile').evaluate((el:HTMLSelectElement)=>{el.value='general';el.dispatchEvent(new Event('change',{bubbles:true}))});await options.locator('.glossary-import-dialog button.primary').click();await expect(options.locator('.glossary-import-dialog [role="status"]')).toHaveText('设置草稿已变化，请重新预览。');await options.locator('.glossary-import-dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('#academic-glossary')).toHaveValue('  original = 人工词条 \n');expect(await snapshot()).toEqual(before);
    await options.locator('#glossary-profile').selectOption(id);await expect(options.locator('#academic-glossary')).toHaveValue('gene = 基因');await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const saved=(await snapshot()).extensionSettings as any;expect(saved.academicGlossary).toEqual([{source:'original',target:'人工词条'}]);expect(saved.glossaryProfiles).toContainEqual({id,name:'基因组学',entries:[{source:'gene',target:'基因'}]});
  }finally{await options.close()}
}));

test('rejects a conflicting concurrent scheme save and retains the visible manual draft',async()=>preserve(async()=>{
  await seedSchemes();const first=await schemeOptions(),second=await schemeOptions();try{
    await first.locator('#academic-glossary').fill('power = 第一窗口人工修改');await second.locator('#academic-glossary').fill('power = 第二窗口人工修改');await second.locator('#save-button').click();await expect(second.locator('#save-button')).toBeDisabled();const saved=await snapshot();await first.locator('#save-button').click();await expect(first.locator('#status')).toContainText('另一窗口');await expect(first.locator('#academic-glossary')).toHaveValue('power = 第一窗口人工修改');await expect(first.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(saved);
  }finally{await first.close();await second.close()}
}));

test('sends only effective domain terms and gives manually confirmed document terms priority in offline paragraph requests',async()=>preserve(async()=>{
  await seedSchemes();await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;s.glossaryProfiles[0].entries=[{source:'translation',target:'统计领域约定'}];s.glossaryProfiles[1].entries=[{source:'translation',target:'能源领域约定'}];await c.storage.local.set({extensionSettings:s})});await openParagraphShortcut('alt');const options=await context.newPage();try{
    await options.goto(`chrome-extension://${extensionId}/options.html`);const before=textRequests.length;await page.locator('#article-intro').click({modifiers:['Alt']});await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(1);expect(JSON.stringify(textRequests[before])).toContain('统计领域约定');expect(JSON.stringify(textRequests[before])).not.toContain('能源领域约定');
    const response=await options.evaluate(async pageUrl=>(globalThis as any).chrome.runtime.sendMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{pageUrl,profileId:'energy',expectedId:''}}),page.url());expect(response.ok).toBe(true);await page.locator('#article-intro-repeat').click({modifiers:['Alt']});await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(2);expect(JSON.stringify(textRequests[before+1])).toContain('能源领域约定');expect(JSON.stringify(textRequests[before+1])).not.toContain('统计领域约定');
    const confirmed=await options.evaluate(async pageUrl=>(globalThis as any).chrome.runtime.sendMessage({type:'UPSERT_DOCUMENT_TERM',payload:{pageUrl,term:{source:'translation',target:'本文人工确认'}}}),page.url());expect(confirmed.ok).toBe(true);await page.evaluate(()=>{const el=document.createElement('p');el.textContent=document.querySelector('#article-intro')!.textContent;el.id='scheme-third';document.querySelector('article')!.append(el)});await page.locator('#scheme-third').click({modifiers:['Alt']});await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(3);expect(JSON.stringify(textRequests[before+2])).toContain('本文人工确认');expect(JSON.stringify(textRequests[before+2])).not.toContain('能源领域约定');expect(textRequests.length-before).toBe(3);
  }finally{await options.close()}
}));


test('keeps the scheme draft and stored data when its combined term budget exceeds 100',async()=>preserve(async()=>{
  await seedSchemes();const options=await schemeOptions();try{
    const before=await snapshot(),raw=Array.from({length:100},(_,i)=>`field term ${i} = 领域人工约定`).join('\n');await options.locator('#academic-glossary').fill(raw);await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('100');await expect(options.locator('#academic-glossary')).toHaveValue(raw);await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);await options.locator('#glossary-profile').selectOption('general');await expect(options.locator('#academic-glossary')).toHaveValue('power = 通用人工译法\nsample = 样本');await options.locator('#glossary-profile').selectOption('statistics');await expect(options.locator('#academic-glossary')).toHaveValue(raw);
  }finally{await options.close()}
}));

async function purposeOptions(language='zh-CN',fresh=false){
  await worker().evaluate(async({language,fresh})=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({uiLanguagePreference:language,extensionSettings:{...s,onboardingCompleted:!fresh,style:fresh?'academic':'literal',contentMode:fresh?'auto':'plain',contextMode:'off',sentenceAlignmentDefault:false,autoRenderLatex:fresh?true:false,glossaryProfiles:[{id:'statistics',name:'统计学',entries:[{source:'power',target:'检验效能'}]},{id:'energy',name:'能源',entries:[{source:'power',target:'电功率'}]}],activeGlossaryProfileId:'energy'}})}, {language,fresh});
  const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await expect(options.locator('#glossary-profile')).toHaveValue('energy');return options;
}
async function openPurpose(options:import('@playwright/test').Page){await options.locator('#purpose-preferences > summary').click()}
async function choosePurposes(options:import('@playwright/test').Page,ids:string[]){for(const id of ids)await options.locator(`#purpose-preferences input[name="purpose"][value="${id}"]`).check()}
async function blockPurposePermissions(options:import('@playwright/test').Page){await options.evaluate(()=>{const g=globalThis as any;g.purposePermissionRequests=0;g.chrome.permissions.request=()=>{g.purposePermissionRequests++;return Promise.reject(new Error('Purpose-only saves must not request permissions'))}})}
const fieldPreview=(options:import('@playwright/test').Page,key:string)=>options.locator(`.purpose-preview-dialog input[data-setting="${key}"]`);

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`previews optional purposes and saves only selected suggestions without model calls in ${language} at ${width}px`,async({},info)=>preserve(async()=>{
  const options=await purposeOptions(language);const network:string[]=[];const listen=(request:import('@playwright/test').Request)=>{if(/^https?:/.test(request.url()))network.push(request.url())};try{
    await options.setViewportSize({width,height:850});await options.emulateMedia({colorScheme:language==='en'?'dark':'light'});await openPurpose(options);await choosePurposes(options,['daily','research','learning']);await expect(options.locator('#purpose-summary-hint')).toContainText(language==='en'?'default to research':'默认按科研');await expect(options.locator('#purpose-summary')).toHaveText(language==='en'?'Draft not saved':'草稿待保存');await options.locator('#purpose-research-field').fill(' 统计学 ');await options.locator('#purpose-glossary').selectOption('statistics');const before=await snapshot();
    await options.locator('#purpose-preview').click();await expect(options.locator('.purpose-preview-dialog')).toBeVisible();const proposals=options.locator('.purpose-preview-dialog input[type="checkbox"]');expect(await proposals.count()).toBe(6);expect(await options.locator('.purpose-preview-dialog input:checked').count()).toBe(0);await expect(options.locator('.purpose-preview-dialog')).toContainText(language==='en'?'nearby sentences':'附近句子');await fieldPreview(options,'contextMode').check();await fieldPreview(options,'sentenceAlignmentDefault').check();await fieldPreview(options,'activeGlossaryProfileId').check();await options.screenshot({path:info.outputPath(`purpose-preview-${language}.png`)});expect(await snapshot()).toEqual(before);await options.locator('.purpose-preview-dialog button.primary').click();await expect(options.locator('#purpose-status')).toContainText(language==='en'?'draft':'草稿');expect(await snapshot()).toEqual(before);await expect(options.locator('#style')).toHaveValue('literal');await expect(options.locator('#content-mode')).toHaveValue('plain');await expect(options.locator('#auto-render-latex')).not.toBeChecked();
    await blockPurposePermissions(options);context.on('request',listen);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);expect(network).toEqual([]);const after=await snapshot(),settings=after.extensionSettings as any;expect(settings).toMatchObject({purposePreferences:{purposes:['daily','research','learning'],researchField:'统计学'},style:'literal',contentMode:'plain',autoRenderLatex:false,contextMode:'sentence',sentenceAlignmentDefault:true,activeGlossaryProfileId:'statistics'});expect(settings.glossaryProfiles).toEqual((before.extensionSettings as any).glossaryProfiles);for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
    await options.reload();await expect(options.locator('#purpose-summary')).toBeVisible();await expect(options.locator('#purpose-summary')).toContainText(language==='en'?'Research':'科研阅读');await options.locator('#purpose-preferences').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath(`purpose-collapsed-${language}.png`)});await openPurpose(options);await expect(options.locator('#purpose-research-field')).toHaveValue('统计学');for(const id of ['daily','research','learning'])await expect(options.locator(`#purpose-preferences input[value="${id}"]`)).toBeChecked();await options.locator('#purpose-preferences').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath(`purpose-saved-${language}.png`)});
  }finally{context.off('request',listen);await options.close()}
}));

test('keeps the purpose draft after canceling or rejecting a stale suggestion preview',async()=>preserve(async()=>{
  const options=await purposeOptions();try{
    await openPurpose(options);const before=await snapshot();await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('生物统计');await expect(options.locator('#save-button')).toBeEnabled();await options.locator('#purpose-preview').click();await options.locator('.purpose-preview-dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await snapshot()).toEqual(before);await expect(options.locator('#save-button')).toBeEnabled();
    await options.locator('#purpose-preview').click();await fieldPreview(options,'contextMode').check();await options.locator('#context-mode').evaluate((el:HTMLSelectElement)=>{el.value='paragraph';el.dispatchEvent(new Event('change',{bubbles:true}))});await options.locator('.purpose-preview-dialog button.primary').click();await expect(options.locator('.purpose-preview-dialog [role="status"]')).toHaveText('设置草稿已变化，请重新预览。');expect(await snapshot()).toEqual(before);await options.locator('.purpose-preview-dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('#context-mode')).toHaveValue('paragraph');await expect(options.locator('#purpose-research-field')).toHaveValue('生物统计');
  }finally{await options.close()}
}));

test('keeps a later manual choice above an applied purpose suggestion',async()=>preserve(async()=>{
  const options=await purposeOptions();try{
    await openPurpose(options);await choosePurposes(options,['daily']);await options.locator('#purpose-preview').click();await fieldPreview(options,'style').check();await options.locator('.purpose-preview-dialog button.primary').click();await expect(options.locator('#style')).toHaveValue('general');await options.locator('#style').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('#style').selectOption('literal');await blockPurposePermissions(options);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();expect(((await snapshot()).extensionSettings as any).style).toBe('literal');expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('protects another window from an outdated purpose suggestion and retains the local draft',async()=>preserve(async()=>{
  const options=await purposeOptions();try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-preview').click();await fieldPreview(options,'contextMode').check();await options.locator('.purpose-preview-dialog button.primary').click();await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,contextMode:'paragraph'}})});const otherWindow=await snapshot();await blockPurposePermissions(options);await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('另一窗口');await expect(options.locator('#context-mode')).toHaveValue('sentence');await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(otherWindow);expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('offers purpose preferences inside the first-run wizard and saves without an API test',async({},info)=>preserve(async()=>{
  const options=await purposeOptions('zh-CN',true),network:string[]=[];const listen=(request:import('@playwright/test').Request)=>{if(/^https?:/.test(request.url()))network.push(request.url())};try{
    await options.setViewportSize({width:360,height:850});await expect(options.locator('#onboarding-dialog')).toBeVisible();const before=await snapshot();if (!await options.locator('#onboarding-purpose').evaluate(el => (el as HTMLDetailsElement).open)) await options.locator('#onboarding-purpose > summary').click();await expect(options.locator('#onboarding-dialog')).toBeVisible();expect(await snapshot()).toEqual(before);await options.locator('[name="onboarding-purpose-choice"][value="learning"]').check();await options.screenshot({path:info.outputPath('first-run-purpose-360.png')});context.on('request',listen);await options.locator('#onboarding-skip').click();await expect(options.locator('#onboarding-dialog')).not.toBeVisible();expect(network).toEqual([]);expect((await snapshot()).extensionSettings).toMatchObject({purposePreferences:{purposes:['learning'],researchField:''},style:'academic',contextMode:'off',sentenceAlignmentDefault:false,onboardingCompleted:true});
  }finally{context.off('request',listen);await options.close()}
}));


test('keeps edits made while a purpose save is waiting and rejects the outdated submission',async()=>preserve(async()=>{
  const options=await purposeOptions();try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-preview').click();await fieldPreview(options,'contextMode').check();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);const before=await snapshot();
    await worker().evaluate(()=>{const g=globalThis as any;g.purposeSaveLockReady=false;g.purposeSaveLock=navigator.locks.request('pi-translator:settings-write:v1',async()=>{g.purposeSaveLockReady=true;await new Promise<void>(resolve=>{g.releasePurposeSaveLock=resolve})})});await expect.poll(()=>worker().evaluate(()=>(globalThis as any).purposeSaveLockReady)).toBe(true);
    await options.locator('#save-button').click();await options.locator('#context-mode').evaluate((el:HTMLSelectElement)=>{el.value='paragraph';el.dispatchEvent(new Event('change',{bubbles:true}))});await worker().evaluate(async()=>{const g=globalThis as any;g.releasePurposeSaveLock();await g.purposeSaveLock});await expect(options.locator('#status')).toContainText('用途或建议设置已变化');await expect(options.locator('#context-mode')).toHaveValue('paragraph');await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await worker().evaluate(async()=>{const g=globalThis as any;g.releasePurposeSaveLock?.();await g.purposeSaveLock});await options.close()}
}));

test('keeps dormant API permissions when saving purpose preferences',async()=>preserve(async()=>{
  await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,apiProfiles:[s.apiProfiles[0],{id:'purpose-unused',name:'保留的备用接口',apiBaseUrl:'https://unused-api.example.org',model:'unused-model'}],activeApiProfileId:s.apiProfiles[0].id,visionApiProfileId:''}})});
  const options=await purposeOptions();try{
    await openPurpose(options);await choosePurposes(options,['daily']);await options.locator('#purpose-preview').click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);await options.evaluate(()=>{const g=globalThis as any;g.purposePermissionRemovals=[];g.chrome.permissions.remove=(request:unknown)=>{g.purposePermissionRemovals.push(request);return Promise.resolve(true)}});const before=(await snapshot()).extensionSettings as any;await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();expect(await options.evaluate(()=>(globalThis as any).purposePermissionRemovals)).toEqual([]);expect(((await snapshot()).extensionSettings as any).apiProfiles).toEqual(before.apiProfiles);
  }finally{await options.close()}
}));

test('saves successive purpose suggestions in one options window without a false concurrent conflict',async()=>preserve(async()=>{
  const options=await purposeOptions();try{
    await openPurpose(options);await blockPurposePermissions(options);const before=await snapshot();
    await choosePurposes(options,['daily']);await options.locator('#purpose-preview').click();await fieldPreview(options,'style').check();await options.locator('.purpose-preview-dialog button.primary').click();await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();expect((await snapshot()).extensionSettings).toMatchObject({style:'general'});
    await options.locator('input[name="purpose"][value="daily"]').uncheck();await choosePurposes(options,['research']);await options.locator('#purpose-preview').click();await fieldPreview(options,'style').check();await fieldPreview(options,'contextMode').check();await options.locator('.purpose-preview-dialog button.primary').click();await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();
    const after=await snapshot();expect(after.extensionSettings).toMatchObject({style:'academic',contextMode:'sentence',purposePreferences:{purposes:['research'],researchField:''}});for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('reports an invalid hidden glossary draft without changing the chosen default or either raw draft',async()=>preserve(async()=>{
  await seedSchemes();const options=await schemeOptions();try{
    const before=await snapshot(),invalid='  power =   \n',energy='  power = 我的能源译法  \n';await options.locator('#academic-glossary').fill(invalid);await options.locator('#glossary-profile').selectOption('energy');await options.locator('#academic-glossary').fill(energy);await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('第 1 行');await expect(options.locator('#glossary-profile')).toHaveValue('energy');await expect(options.locator('#academic-glossary')).toHaveValue(energy);await expect(options.locator('#status')).toContainText('统计学');expect(await snapshot()).toEqual(before);
    await options.locator('#glossary-profile').selectOption('statistics');await expect(options.locator('#academic-glossary')).toHaveValue(invalid);await options.locator('#academic-glossary').fill('power = 修正后的人工译法');await options.locator('#glossary-profile').selectOption('energy');await expect(options.locator('#academic-glossary')).toHaveValue(energy);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const after=await snapshot();expect(after.extensionSettings).toMatchObject({activeGlossaryProfileId:'energy',academicGlossary:schemeSeed.academicGlossary});expect((after.extensionSettings as any).glossaryProfiles).toEqual([{id:'statistics',name:'统计学',entries:[{source:'power',target:'修正后的人工译法'}]},{id:'energy',name:'能源',entries:[{source:'power',target:'我的能源译法'}]}]);for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
  }finally{await options.close()}
}));

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`keeps a saved purpose preview clean and gives accurate no-change feedback in ${language} at ${width}px`,async({},info)=>preserve(async()=>{
  const options=await purposeOptions(language);try{
    await options.setViewportSize({width,height:850});await openPurpose(options);await choosePurposes(options,['daily']);await options.locator('#purpose-preview').click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const before=await snapshot();
    await options.locator('#purpose-preview').click();await options.locator('.purpose-preview-dialog button.primary').click();await expect(options.locator('#purpose-status')).toHaveText(language==='en'?'No changes were added.':'没有新增更改。');await expect(options.locator('#save-button')).toBeDisabled();expect(await snapshot()).toEqual(before);await options.locator('#purpose-status').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath(`purpose-no-change-${language}.png`)});
  }finally{await options.close()}
}));

test('keeps purpose suggestions optional after first-run choices are saved',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN',true);try{
    if (!await options.locator('#onboarding-purpose').evaluate(el => (el as HTMLDetailsElement).open)) await options.locator('#onboarding-purpose > summary').click();await options.locator('[name="onboarding-purpose-choice"][value="research"]').check();await options.locator('#onboarding-skip').click();await openPurpose(options);await expect(options.locator('input[name="purpose"][value="research"]')).toBeChecked();const before=await snapshot();
    await options.locator('input[name="purpose"][value="research"]').uncheck();await choosePurposes(options,['learning']);await options.locator('#purpose-preview').click();await expect(options.locator('.purpose-preview-dialog input:checked')).toHaveCount(0);await options.locator('.purpose-preview-dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(options.locator('input[name="purpose"][value="research"]')).not.toBeChecked();await expect(options.locator('input[name="purpose"][value="learning"]')).toBeChecked();await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);
  }finally{await options.close()}
}));

test('refreshes the webpage document scheme without replacing a focused manual term draft or translation',async()=>preserve(async()=>{
  await seedSchemes();await openParagraphShortcut('alt');await page.locator('#article-intro').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()?.removeAllRanges();getSelection()?.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const overlay=page.locator('#tex-selection-translator-root');await expect.poll(async()=>['trigger','card','sidebar'].includes(await overlay.getAttribute('data-pi-view')??'')).toBe(true);if(await overlay.getAttribute('data-pi-view')==='trigger')await overlay.locator('.trigger').click();if(await overlay.getAttribute('data-pi-view')!=='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();await expect(overlay.locator('.document-memory-action')).toBeVisible();await overlay.locator('.document-memory-action').click();const choice=overlay.getByLabel('本文术语方案',{exact:true});await expect(choice.locator('option:checked')).toHaveText('跟随默认：统计学');await overlay.getByTitle('添加本文术语').click();const source=overlay.getByRole('textbox',{name:'原文术语',exact:true}),target=overlay.getByRole('textbox',{name:'固定译法',exact:true});await source.fill('manual source');await target.fill('保留人工草稿');const before=await snapshot(),calls=textRequests.length+visionRequests.length;
  await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,activeGlossaryProfileId:'energy'}})});await expect(choice.locator('option:checked')).toHaveText('跟随默认：能源');await expect(overlay.locator('.document-glossary [role="status"]')).toContainText('跟随默认方案');await expect(source).toHaveValue('manual source');await expect(target).toHaveValue('保留人工草稿');await expect(target).toBeFocused();const after=await snapshot();for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);expect(textRequests.length+visionRequests.length).toBe(calls);await overlay.getByTitle('取消编辑本文术语').click();await overlay.getByTitle('返回翻译结果').click();await expect(overlay.locator('.body')).toBeVisible();
}));
test('recovers a webpage glossary read failure without losing the focused draft',async()=>preserve(async()=>{
 await seedSchemes();await openParagraphShortcut('alt');await page.locator('#article-intro').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()?.removeAllRanges();getSelection()?.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const overlay=page.locator('#tex-selection-translator-root');await expect.poll(async()=>['trigger','card','sidebar'].includes(await overlay.getAttribute('data-pi-view')??'')).toBe(true);if(await overlay.getAttribute('data-pi-view')==='trigger')await overlay.locator('.trigger').click();if(await overlay.getAttribute('data-pi-view')!=='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();await overlay.locator('.document-memory-action').click();const box=overlay.locator('.document-glossary');await expect(box.locator('select')).toBeEnabled();await overlay.getByTitle('添加本文术语').click();const source=overlay.getByRole('textbox',{name:'原文术语',exact:true}),target=overlay.getByRole('textbox',{name:'固定译法',exact:true});await source.fill('web draft');await target.fill('网页人工草稿');
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);g.failWebGlossaryRead=true;c.runtime.sendMessage=async(message:any,...args:any[])=>{if(message?.type==='GET_DOCUMENT_GLOSSARY'&&g.failWebGlossaryRead)throw new Error('synthetic local read failure');return send(message,...args)}}})},page.url());const calls=textRequests.length+visionRequests.length;
 await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,activeGlossaryProfileId:'energy'}})});await expect(box.getByRole('status')).toContainText('暂时无法读取术语方案');await expect(box.locator('select')).toBeDisabled();await expect(source).toHaveValue('web draft');await expect(target).toHaveValue('网页人工草稿');const before=await snapshot();
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{(globalThis as any).failWebGlossaryRead=false}})},page.url());await box.getByRole('button',{name:'重新读取'}).click();await expect(box.locator('select option:checked')).toHaveText('跟随默认：能源');await expect(box.getByRole('status')).toContainText('跟随默认方案');await expect(source).toHaveValue('web draft');await expect(target).toHaveValue('网页人工草稿');expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
}));
test('recovers an initial webpage document-term read failure in place',async()=>preserve(async()=>{
 await seedSchemes();await openParagraphShortcut('alt');await page.locator('#article-intro').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()?.removeAllRanges();getSelection()?.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const overlay=page.locator('#tex-selection-translator-root');await expect.poll(async()=>['trigger','card','sidebar'].includes(await overlay.getAttribute('data-pi-view')??'')).toBe(true);if(await overlay.getAttribute('data-pi-view')==='trigger')await overlay.locator('.trigger').click();if(await overlay.getAttribute('data-pi-view')!=='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);g.failWebMemoryRead=true;c.runtime.sendMessage=async(message:any,...args:any[])=>{if(message?.type==='GET_DOCUMENT_MEMORY'&&g.failWebMemoryRead)throw new Error('synthetic local memory failure');return send(message,...args)}}})},page.url());const calls=textRequests.length+visionRequests.length;await overlay.locator('.document-memory-action').click();await expect(overlay).toContainText('暂时无法读取本文术语');const before=await snapshot();
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{(globalThis as any).failWebMemoryRead=false}})},page.url());await overlay.getByRole('button',{name:'重新读取'}).click();await expect(overlay.getByTitle('添加本文术语')).toBeVisible();expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
}));
test('keeps a webpage term draft when a pending document-term read fails and recovers',async({},info)=>preserve(async()=>{
 await seedSchemes();await openParagraphShortcut('alt');await page.locator('#article-intro').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()?.removeAllRanges();getSelection()?.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const overlay=page.locator('#tex-selection-translator-root');await expect.poll(async()=>['trigger','card','sidebar'].includes(await overlay.getAttribute('data-pi-view')??'')).toBe(true);if(await overlay.getAttribute('data-pi-view')==='trigger')await overlay.locator('.trigger').click();if(await overlay.getAttribute('data-pi-view')!=='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();await overlay.locator('.document-memory-action').click();await expect(overlay.getByTitle('添加本文术语')).toBeVisible();await overlay.getByTitle('返回翻译结果').click();
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);g.holdWebMemoryRead=true;c.runtime.sendMessage=async(message:any,...args:any[])=>{if(message?.type==='GET_DOCUMENT_MEMORY'&&g.holdWebMemoryRead){g.holdWebMemoryRead=false;g.webMemoryReadWaiting=true;await new Promise<void>(resolve=>g.releaseWebMemoryRead=resolve);throw new Error('synthetic local memory failure')}return send(message,...args)}}})},page.url());const calls=textRequests.length+visionRequests.length;await overlay.locator('.document-memory-action').click();await expect(overlay.getByTitle('添加本文术语')).toBeVisible();await overlay.getByTitle('添加本文术语').click();const source=overlay.getByRole('textbox',{name:'原文术语',exact:true}),target=overlay.getByRole('textbox',{name:'固定译法',exact:true});await source.fill('unsaved source');await target.fill('人工译法草稿');
 await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.scripting.executeScript({target:{tabId:tab.id},func:()=>{(globalThis as any).releaseWebMemoryRead()}})},page.url());await expect(source).toHaveValue('unsaved source');await expect(target).toHaveValue('人工译法草稿');await expect(overlay).toContainText('暂时无法读取本文术语');await overlay.screenshot({path:info.outputPath('web-memory-read-failure.png')});const before=await snapshot();await overlay.getByRole('button',{name:'重新读取'}).click();await expect(overlay.locator('[data-document-memory-error]')).toHaveCount(0);await expect(source).toHaveValue('unsaved source');await expect(target).toHaveValue('人工译法草稿');expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
}));
test('uses a webpage recommendation only for this document and keeps a manual term draft',async()=>preserve(async()=>{
 await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,activeGlossaryProfileId:'general',glossaryProfiles:[{id:'reading',name:'阅读研究',entries:[{source:'Bilingual reading',target:'双语阅读'},{source:'original article',target:'原始文章'}]}]}})});
 await openParagraphShortcut('alt');await page.locator('#article-intro').click({modifiers:['Alt']});await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toBeVisible();await page.locator('#article-intro').evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection()?.removeAllRanges();getSelection()?.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const overlay=page.locator('#tex-selection-translator-root');await expect.poll(async()=>['trigger','card','sidebar'].includes(await overlay.getAttribute('data-pi-view')??'')).toBe(true);if(await overlay.getAttribute('data-pi-view')==='trigger')await overlay.locator('.trigger').click();if(await overlay.getAttribute('data-pi-view')!=='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();await overlay.locator('.document-memory-action').click();const suggestion=overlay.locator('.document-glossary-suggestion');await expect(suggestion).toBeVisible();await expect(suggestion).toContainText('仅影响本文后续翻译');await overlay.getByTitle('添加本文术语').click();const source=overlay.getByRole('textbox',{name:'原文术语',exact:true}),target=overlay.getByRole('textbox',{name:'固定译法',exact:true});await source.fill('web draft');await target.fill('网页人工草稿');const before=await snapshot(),calls=textRequests.length+visionRequests.length;await suggestion.getByRole('button',{name:'仅本文采用'}).click();await expect(overlay.locator('.document-glossary select')).toHaveValue('reading');await expect(overlay.locator('.document-glossary [role="status"]')).toContainText(/本文固定方案|本文方案已保存/);await expect(source).toHaveValue('web draft');await expect(target).toHaveValue('网页人工草稿');const after=await snapshot();expect((after.extensionSettings as any).activeGlossaryProfileId).toBe('general');expect(Object.values((after.extensionSettings as any).documentGlossaryProfiles)).toContain('reading');expect(after.documentTranslationMemoryV1).toEqual(before.documentTranslationMemoryV1);expect(textRequests.length+visionRequests.length).toBe(calls);
}));
test('finds existing settings, PDF and popup actions without performing them or changing research data',async({},info)=>preserve(async()=>{
 const options=await context.newPage(),reader=await context.newPage(),popup=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await options.setViewportSize({width:1100,height:700});await options.goto(`chrome-extension://${extensionId}/options.html#translation`);const before=await snapshot();await options.locator('.settings-nav .pi-action-guide-trigger').click();let guide=options.getByRole('dialog',{name:'常用操作',exact:true});await guide.getByRole('searchbox').fill('文档');await guide.getByRole('button',{name:'文档库',exact:true}).click();await expect(guide).toHaveCount(0);await expect(options.locator('[data-settings-target="storage"]')).toBeFocused();await expect(options.locator('#settings-translation')).toBeVisible();await options.locator('[data-settings-target="storage"]').click();await expect(options.locator('#settings-storage')).toBeVisible();await options.setViewportSize({width:360,height:700});await options.locator('.settings-nav .pi-action-guide-trigger').click();guide=options.getByRole('dialog',{name:'常用操作',exact:true});await expect(guide.getByRole('button',{name:'文档库',exact:true})).toHaveCount(0);await guide.getByRole('button',{name:'设置分区',exact:true}).click();await expect(options.locator('#settings-section-select')).toBeFocused();
  await reader.setViewportSize({width:360,height:700});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'guide.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Discover existing reading actions.','Reading continues.')});await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');await reader.locator('#pdf-reader-menu > summary').click();await reader.locator('.pdf-reader-menu-content .pi-action-guide-trigger').click();guide=reader.getByRole('dialog',{name:'常用操作',exact:true});await guide.getByRole('searchbox').fill('搜索');await guide.getByRole('button',{name:'搜索 PDF',exact:true}).click();await expect(reader.locator('#open-search')).toBeFocused();await expect(reader.locator('#pdf-search')).toBeHidden();await reader.locator('#open-search').click();await expect(reader.locator('#pdf-search')).toBeVisible();await reader.screenshot({path:info.outputPath('guide-pdf-search.png')});
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);await popup.locator('#popup-more-actions > summary').click();await popup.locator('.pi-action-guide-trigger').click();guide=popup.getByRole('dialog',{name:'常用操作',exact:true});await guide.getByRole('searchbox').fill('PDF');await expect(guide.getByRole('button',{name:'打开 PDF 阅读器',exact:true})).toBeVisible();await popup.screenshot({path:info.outputPath('guide-popup.png')});await popup.keyboard.press('Escape');await expect(guide).toHaveCount(0);await expect(popup.locator('#popup-more-actions > summary')).toBeFocused();
  const after=await snapshot();for(const key of ['pdfDocumentTranslationRetainedV1','piWebExcerptsV1','piPdfReadingAnnotationsV1','piPdfAreaNotesV1','piLibraryOrganizationV1','documentTranslationMemoryV1'])expect(after[key]).toEqual(before[key]);expect(after.extensionSettings).toEqual(before.extensionSettings);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await options.close();await reader.close();await popup.close()}
}));


test('keeps the English action guide compact, keyboard accessible and read only',async({},info)=>preserve(async()=>{
 await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en'})});const popup=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await popup.setViewportSize({width:300,height:420});await popup.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await popup.goto(`chrome-extension://${extensionId}/popup.html`);const before=await snapshot();await popup.locator('#popup-more-actions > summary').click();await popup.locator('.pi-action-guide-trigger').click();const guide=popup.getByRole('dialog',{name:'Common actions',exact:true});await expect(guide.getByRole('searchbox',{name:'Find an action'})).toBeFocused();await guide.getByRole('searchbox').fill('no-such-action');await expect(guide.getByRole('status')).toHaveText('No matching actions are available here.');await guide.getByRole('searchbox').fill('PDF');await expect(guide.getByRole('button',{name:'Open PDF reader',exact:true})).toBeVisible();await expect.poll(()=>guide.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await popup.screenshot({path:info.outputPath('guide-english-short-dark.png')});await popup.keyboard.press('Escape');await expect(guide).toHaveCount(0);await expect(popup.locator('#popup-more-actions > summary')).toBeFocused();expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await popup.close()}
}));


test('keeps the reading surface when Escape closes its action dialog',async({},info)=>preserve(async()=>{
 await page.goto(OVERLEAF_FIXTURE_URL);await selectElementText('#source');const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await expect(overlay.locator('.body')).toBeVisible();const calls=textRequests.length+visionRequests.length,before=await snapshot(),translation=await overlay.locator('.body').textContent();
 for(const view of ['card','sidebar']){
  if(view==='sidebar')await overlay.getByTitle('在页面侧栏中显示').click();await openTranslationMore(overlay);await overlay.locator('.pi-action-guide-trigger').click();const dialog=overlay.getByRole('dialog',{name:'常用操作',exact:true});await dialog.getByRole('searchbox').fill('修正');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(overlay).toHaveAttribute('data-pi-view',view);await expect(overlay.locator('details.more > summary')).toBeFocused();await expect(overlay.locator('.body')).toHaveText(translation!);await page.screenshot({path:info.outputPath(`dialog-return-${view}.png`)});
 }
 const after=await snapshot();for(const key of ['extensionSettings','piWebExcerptsV1','piPdfReadingAnnotationsV1','documentTranslationMemoryV1','pdfDocumentTranslationRetainedV1'])expect(after[key]).toEqual(before[key]);expect(textRequests.length+visionRequests.length).toBe(calls);
}));

for(const background of ['search','outline','region'] as const)test(`keeps PDF ${background} behind the annotation dialog until it closes`,async({},info)=>preserve(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
  await reader.setViewportSize({width:360,height:640});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'dialog-flow.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Searchable research note context.','Continue reading the original source.')});await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');
  if(background==='search'){await clickPdfReaderAction(reader,'open-search');await reader.locator('#pdf-search-query').fill('research')}else if(background==='outline')await clickPdfReaderAction(reader,'open-outline');else{await reader.locator('.pdf-page').first().click({position:{x:15,y:20}});await reader.keyboard.press('Shift+r');await expect(reader.locator('#region-translate')).toHaveAttribute('data-region-mode','continuous')}
  const before=await snapshot();await clickPdfReaderAction(reader,'pdf-open-annotations');const dialog=reader.locator('#pdf-annotations-dialog');await expect(dialog).toBeVisible();await reader.keyboard.press('Control+f');await expect(dialog).toBeVisible();if(background!=='search')await expect(reader.locator('#pdf-search')).toBeHidden();await reader.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(reader.locator('#pdf-reader-menu > summary')).toBeFocused();if(background==='search'){await expect(reader.locator('#pdf-search')).toBeVisible();await expect(reader.locator('#pdf-search-query')).toHaveValue('research')}else if(background==='outline')await expect(reader.locator('#pdf-outline')).toBeVisible();else await expect(reader.locator('#region-translate')).toHaveAttribute('data-region-mode','continuous');await reader.screenshot({path:info.outputPath(`dialog-return-pdf-${background}.png`)});
  const after=await snapshot();for(const key of ['extensionSettings','piWebExcerptsV1','piPdfReadingAnnotationsV1','documentTranslationMemoryV1','pdfDocumentTranslationRetainedV1'])expect(after[key]).toEqual(before[key]);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await reader.close()}
}));

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`returns from note export to its visible menu in ${language}`,async({},info)=>preserve(async()=>{
 await worker().evaluate(async({sourceKey,note,language})=>await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[sourceKey]:[note]},uiLanguagePreference:language}),{sourceKey,note,language});const options=await context.newPage(),before=await snapshot(),calls=textRequests.length+visionRequests.length;
 try{
  await options.setViewportSize({width,height:640});await options.emulateMedia({colorScheme:language==='en'?'dark':'light',reducedMotion:'reduce'});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('evidence');await options.locator('[data-source-kind="excerpt"] .library-select').click();const detail=options.locator('#library-detail'),menu=detail.locator('.library-menu > summary');
  for(const close of ['cancel','escape']){await menu.click();await detail.getByRole('button',{name:language==='en'?'Export notes…':'导出笔记…',exact:true}).click();const dialog=options.locator('.research-export-dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('combobox')).toBeFocused();if(close==='cancel')await dialog.getByRole('button',{name:language==='en'?'Cancel':'取消',exact:true}).click();else await options.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(menu).toBeFocused();await expect(detail).toContainText(note.content.note);await expect(options.locator('#retained-library-search')).toHaveValue('evidence');await options.screenshot({path:info.outputPath(`note-export-return-${language}-${close}.png`)})}
  expect(await snapshot()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await options.close()}
}));


test('opens an explicitly selected PDF after delayed interface initialization without losing the file',async({},info)=>preserve(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await reader.addInitScript(()=>{const g=globalThis as any,area=g.chrome.storage.local,get=area.get.bind(area);let held=false;area.get=async(key:unknown,...args:unknown[])=>{if(key==='uiLanguagePreference'&&!held){held=true;g.readerUiGateReady=true;await new Promise<void>(resolve=>g.releaseReaderUiGate=resolve)}return get(key,...args)}});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await expect.poll(()=>reader.evaluate(()=>(globalThis as any).readerUiGateReady)).toBe(true);await expect(reader.locator('#choose-file')).toBeDisabled();await expect(reader.locator('#empty-open')).toBeDisabled();await reader.locator('#file-input').setInputFiles({name:'early-selected.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('The deliberately selected file must remain available.','The reading continues without another file selection.')});await reader.evaluate(()=>(globalThis as any).releaseReaderUiGate());await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');await expect(reader.locator('#page-number')).toHaveValue('1');await expect(reader.locator('#choose-file')).toBeEnabled();await reader.screenshot({path:info.outputPath('reader-initialization-selected-file.png')});expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await reader.evaluate(()=>(globalThis as any).releaseReaderUiGate?.());await reader.close()}
}));

test('protects unconfirmed purpose choices from language changes and page exit',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('未确认的统计学');
    const before=await snapshot();
    const protectedExit=await options.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented});
    expect(protectedExit).toBe(true);
    await options.locator('#ui-language').selectOption('en');
    await expect(options.locator('#ui-language')).toHaveValue('zh-CN');
    await expect(options.locator('#status')).toContainText('请先保存或撤销当前更改');
    await expect(options.locator('#purpose-research-field')).toHaveValue('未确认的统计学');
    expect(await snapshot()).toEqual(before);
  }finally{await options.close()}
}));

test('records purposes without applying suggestions or changing other settings',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('材料科学');
    const before=await snapshot();
    await expect(options.locator('#purpose-status')).toContainText('加入草稿');await expect(options.locator('#save-button')).toBeEnabled();
    expect(await snapshot()).toEqual(before);await blockPurposePermissions(options);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();
    const after=await snapshot(),old=before.extensionSettings as any,saved=after.extensionSettings as any;
    expect(saved.purposePreferences).toEqual({purposes:['research'],researchField:'材料科学'});
    for(const key of ['style','contentMode','contextMode','sentenceAlignmentDefault','autoRenderLatex','activeGlossaryProfileId','glossaryProfiles','academicGlossary'])expect(saved[key]).toEqual(old[key]);
    for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
    expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('does not silently discard a selected terminology scheme when recording purposes only',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-glossary').selectOption('statistics');
    const before=await snapshot();await options.locator('#save-button').click();
    await expect(options.locator('#status')).toContainText('已选择术语方案');await expect(options.locator('#purpose-glossary')).toHaveValue('statistics');
    await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);
    await options.locator('#purpose-reset').click();await expect(options.locator('#purpose-glossary')).toHaveValue('');await expect(options.locator('input[name="purpose"][value="research"]')).toBeChecked();
  }finally{await options.close()}
}));

test('keeps a record-only purpose draft when another window changes purposes',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('材料科学');await blockPurposePermissions(options);
    await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,purposePreferences:{purposes:['learning'],researchField:'其他窗口'}}})});
    const before=await snapshot();await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('另一窗口已修改用途偏好');
    await expect(options.locator('#purpose-research-field')).toHaveValue('材料科学');await expect(options.locator('#save-button')).toBeEnabled();expect(await snapshot()).toEqual(before);
    expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('blocks settings import while an unconfirmed purpose or settings draft exists',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('未确认的研究领域');
    const before=await snapshot();await options.locator('[data-settings-target="support"]').click();await options.locator('.support-disclosure').filter({has:options.locator('#import-settings')}).locator('summary').click();
    await options.locator('#import-settings').click();await expect(options.locator('#support-status')).toContainText('请先保存或撤销当前设置草稿');
    await options.locator('#restart-onboarding').click();await expect(options.locator('#onboarding-dialog')).not.toBeVisible();await expect(options.locator('#status')).toContainText('请先保存或撤销当前更改');await expect(options.locator('#purpose-research-field')).toHaveValue('未确认的研究领域');
    await options.locator('[data-settings-target="support"]').click();
    await options.locator('#import-settings-file').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await expect(options.locator('#support-status')).toContainText('请先保存或撤销当前设置草稿');expect(await snapshot()).toEqual(before);
    await options.locator('[data-settings-target="translation"]').click();await expect(options.locator('#purpose-research-field')).toHaveValue('未确认的研究领域');
    await options.locator('[data-settings-target="support"]').click();await options.locator('#import-settings').click();
    await expect(options.locator('#support-status')).toContainText('请先保存或撤销当前设置草稿');expect(await snapshot()).toEqual(before);
  }finally{await options.close()}
}));

test('locks settings editing only while a configuration import is being read',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await options.locator('[data-settings-target="support"]').click();
    await options.evaluate(()=>{const g=globalThis as any;g.originalPurposeFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{g.releasePurposeFileText=()=>resolve('{}')})}});
    const before=await snapshot();await options.locator('#import-settings-file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await expect(options.locator('#settings-form')).toHaveJSProperty('inert',true);await expect(options.locator('#settings-form')).toHaveAttribute('aria-busy','true');
    await options.evaluate(()=> (globalThis as any).releasePurposeFileText());
    await expect(options.locator('#settings-form')).toHaveJSProperty('inert',false);await expect(options.locator('#settings-form')).not.toHaveAttribute('aria-busy');
    await expect(options.locator('#support-status')).toContainText('配置');expect(await snapshot()).toEqual(before);
  }finally{await options.evaluate(()=>{const g=globalThis as any;g.releasePurposeFileText?.();if(g.originalPurposeFileText)File.prototype.text=g.originalPurposeFileText});await options.close()}
}));

test('suggests an exact research-field scheme but applies it only after preview and save',async({},info)=>preserve(async()=>{
  const options=await purposeOptions('zh-CN'),calls=textRequests.length+visionRequests.length;try{
    await options.setViewportSize({width:360,height:850});await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');
    const before=await snapshot(),suggestion=options.locator('#purpose-glossary-suggestion');await expect(suggestion).toBeVisible();await expect(suggestion).toContainText('方案“统计学”与研究领域名称一致');
    await expect(options.locator('#purpose-glossary')).toHaveValue('');await expect(options.locator('#glossary-profile')).toHaveValue('energy');expect(await snapshot()).toEqual(before);
    await suggestion.screenshot({path:info.outputPath('field-recommendation.png')});await suggestion.getByRole('button',{name:'选择此方案'}).click();
    await expect(options.locator('.purpose-preview-dialog')).toBeVisible();await options.locator('.purpose-preview-dialog').screenshot({path:info.outputPath('recommendation-confirmation.png')});await expect(options.locator('#glossary-profile')).toHaveValue('energy');expect(await snapshot()).toEqual(before);
    await options.locator('.purpose-preview-dialog').getByRole('button',{name:'取消',exact:true}).click();expect(await snapshot()).toEqual(before);
    await suggestion.getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await expect(options.locator('#glossary-profile')).toHaveValue('statistics');expect(await snapshot()).toEqual(before);
    await blockPurposePermissions(options);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const after=await snapshot();
    expect((after.extensionSettings as any).activeGlossaryProfileId).toBe('statistics');expect((after.extensionSettings as any).documentGlossaryProfiles).toEqual((before.extensionSettings as any).documentGlossaryProfiles);
    expect((after.extensionSettings as any).glossaryProfiles).toEqual((before.extensionSettings as any).glossaryProfiles);expect((after.extensionSettings as any).academicGlossary).toEqual((before.extensionSettings as any).academicGlossary);
    for(const key of Object.keys(before).filter(k=>k!=='extensionSettings'&&k!==CONFIGURATION_REVISION_STORAGE_KEY))expect(after[key]).toEqual(before[key]);
    expect(textRequests.length+visionRequests.length).toBe(calls);expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('keeps manual scheme choices and lets field suggestions be ignored',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);const field=options.locator('#purpose-research-field'),suggestion=options.locator('#purpose-glossary-suggestion');
    await field.fill('统计');await expect(suggestion).toBeHidden();await field.fill('统计学');await expect(suggestion).toBeVisible();
    await options.locator('#purpose-glossary').selectOption('energy');await expect(suggestion).toBeHidden();await field.fill('统计学 ');await expect(options.locator('#purpose-glossary')).toHaveValue('energy');
    await options.locator('#purpose-glossary').selectOption('');await expect(suggestion).toBeVisible();await suggestion.getByRole('button',{name:'本次忽略'}).click();await expect(suggestion).toBeHidden();
    await field.fill('能源');await expect(suggestion).toBeHidden();await field.fill('统计学');await expect(suggestion).toBeHidden();
  }finally{await options.close()}
}));

test('rejects an outdated field recommendation when another window renames its scheme',async()=>preserve(async()=>{
  const options=await purposeOptions('zh-CN');try{
    await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();
    await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
    await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>p.id==='statistics'?{...p,name:'统计与机器学习'}:p)}})});
    const before=await snapshot();await options.locator('#save-button').click();await expect(options.locator('#status')).toContainText('推荐的术语方案已变化');await expect(options.locator('#save-button')).toBeEnabled();await expect(options.locator('#glossary-profile')).toHaveValue('statistics');expect(await snapshot()).toEqual(before);expect(await options.evaluate(()=>(globalThis as any).purposePermissionRequests)).toBe(0);
  }finally{await options.close()}
}));

test('shows the field recommendation accessibly in narrow English settings',async()=>preserve(async()=>{
  const options=await purposeOptions('en');try{
    await options.setViewportSize({width:360,height:760});await options.emulateMedia({colorScheme:'dark'});await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');
    const suggestion=options.locator('#purpose-glossary-suggestion');await expect(suggestion).toContainText('matches your research field by name');await expect(suggestion.getByRole('button',{name:'Select this scheme'})).toBeVisible();await expect(suggestion.getByRole('button',{name:'Dismiss for now'})).toBeVisible();
    expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await suggestion.screenshot({path:test.info().outputPath('recommendation-en-dark.png')});
    await suggestion.getByRole('button',{name:'Select this scheme'}).click();await expect(options.locator('.purpose-preview-dialog')).toContainText('document');await expect(options.locator('.purpose-preview-dialog button.primary')).toBeVisible();expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }finally{await options.close()}
}));

test('abandons a stale recommendation without reloading or losing other settings drafts',async({},info)=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{
  await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');
  await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('#academic-glossary').fill('power = 未保存的人工译法');
  await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>p.id==='statistics'?{...p,name:'统计研究'}:p)}})});
  const before=await snapshot();await options.locator('#save-button').click();const recovery=options.locator('#purpose-glossary-recovery');await expect(recovery).toBeVisible();await recovery.getByRole('button',{name:'核对最新方案'}).click();await expect(recovery).toContainText('暂无唯一名称匹配');await options.setViewportSize({width:360,height:760});await options.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await recovery.screenshot({path:info.outputPath('recovery-dark.png')});
  await recovery.getByRole('button',{name:'放弃本次推荐'}).click();await expect(options.locator('#glossary-profile')).toHaveValue('energy');await expect(options.locator('#academic-glossary')).toHaveValue('power = 未保存的人工译法');await expect(options.locator('#purpose-research-field')).toHaveValue('统计学');expect(await snapshot()).toEqual(before);
  await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const after=await snapshot(),s=after.extensionSettings as any;expect(s.activeGlossaryProfileId).toBe('energy');expect(s.glossaryProfiles.find((p:any)=>p.id==='statistics').name).toBe('统计研究');expect(s.glossaryProfiles.find((p:any)=>p.id==='energy').entries).toEqual([{source:'power',target:'未保存的人工译法'}]);
 }finally{await options.close()}
}));

test('rechecks and previews a new unique match after another window changes schemes',async()=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{
  await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>({...p,name:p.id==='statistics'?'统计旧方案':'统计学'}))}})});
  const before=await snapshot();await options.locator('#save-button').click();const recovery=options.locator('#purpose-glossary-recovery');await expect(recovery).toBeVisible();await recovery.getByRole('button',{name:'核对最新方案'}).click();await expect(recovery).toContainText('最新匹配：统计学');expect(await snapshot()).toEqual(before);
  await recovery.getByRole('button',{name:'重新预览'}).click();await expect(options.locator('.purpose-preview-dialog')).toContainText('本文固定方案');await options.locator('.purpose-preview-dialog button.primary').click();expect(await snapshot()).toEqual(before);
  await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();const after=await snapshot(),s=after.extensionSettings as any;expect(s.activeGlossaryProfileId).toBe('energy');expect(s.glossaryProfiles.map((p:any)=>p.name)).toEqual(['统计旧方案','统计学']);
 }finally{await options.close()}
}));

test('offers a quiet manual scheme entry when there is no field match',async()=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{await openPurpose(options);await choosePurposes(options,['research']);const field=options.locator('#purpose-research-field');await field.fill('生物统计');await expect(options.locator('#purpose-glossary-no-match')).toBeHidden();await field.blur();const hint=options.locator('#purpose-glossary-no-match');await expect(hint).toBeVisible();const before=await snapshot();await hint.getByRole('button',{name:'管理术语方案'}).click();await expect(options.locator('#glossary-profile')).toBeFocused();await expect(field).toHaveValue('生物统计');expect(await snapshot()).toEqual(before)}finally{await options.close()}
}));

test('preserves another window default when a stale recommendation is abandoned',async()=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{
  await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,activeGlossaryProfileId:'general'}})});
  const before=await snapshot();await options.locator('#save-button').click();const recovery=options.locator('#purpose-glossary-recovery');await expect(recovery).toBeVisible();await recovery.getByRole('button',{name:'核对最新方案'}).click();await expect(recovery).toContainText('默认方案也已在另一窗口变化');await expect(recovery.getByRole('button',{name:'重新预览'})).toHaveCount(0);
  await recovery.getByRole('button',{name:'放弃本次推荐'}).click();expect(await snapshot()).toEqual(before);await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();expect(((await snapshot()).extensionSettings as any).activeGlossaryProfileId).toBe('general');
 }finally{await options.close()}
}));

test('keeps local name and term drafts when the refreshed scheme conflicts',async()=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{
  await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>({...p,name:p.id==='statistics'?'统计旧方案':'统计学'}))}})});
  const before=await snapshot();await options.locator('#save-button').click();const recovery=options.locator('#purpose-glossary-recovery');await expect(recovery).toBeVisible();
  await options.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('#academic-glossary').fill('power = 保留人工译法');options.once('dialog',dialog=>dialog.accept('本页名称草稿'));await options.locator('#glossary-profile-rename').click();
  await recovery.getByRole('button',{name:'核对最新方案'}).click();await recovery.getByRole('button',{name:'重新预览'}).click();await expect(recovery).toContainText('本页已修改该方案名称');await expect(options.locator('#academic-glossary')).toHaveValue('power = 保留人工译法');await expect(options.locator('#glossary-profile option:checked')).toHaveText('本页名称草稿');expect(await snapshot()).toEqual(before);
 }finally{await options.close()}
}));

test('rechecks a recommendation again before reopening its preview',async()=>preserve(async()=>{
 const options=await purposeOptions('zh-CN');try{
  await openPurpose(options);await choosePurposes(options,['research']);await options.locator('#purpose-research-field').fill('统计学');await options.locator('#purpose-glossary-suggestion').getByRole('button',{name:'选择此方案'}).click();await options.locator('.purpose-preview-dialog button.primary').click();await blockPurposePermissions(options);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>({...p,name:p.id==='statistics'?'统计旧方案':'统计学'}))}})});
  await options.locator('#save-button').click();const recovery=options.locator('#purpose-glossary-recovery');await recovery.getByRole('button',{name:'核对最新方案'}).click();await expect(recovery).toContainText('最新匹配：统计学');
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,glossaryProfiles:v.glossaryProfiles.map((p:any)=>p.id==='energy'?{...p,name:'再次修改'}:p)}})});const before=await snapshot();
  await recovery.getByRole('button',{name:'重新预览'}).click();await expect(recovery).toContainText('方案或草稿再次变化');await expect(options.locator('.purpose-preview-dialog')).not.toBeVisible();await expect(options.locator('#purpose-research-field')).toHaveValue('统计学');expect(await snapshot()).toEqual(before);
 }finally{await options.close()}
}));
