import type {Page} from '@playwright/test';
import {delayStorageWrite,releaseStorageWrite} from './support/storage-delay';
import {readFile,writeFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,createMultiPageTextPdf,mockControl,textRequests,visionRequests} from './support/edge-extension-fixture';
import {clickPdfReaderAction} from './support/translation-controls';
installEdgeExtensionHooks();
const key='piPdfReadingAnnotationsV1';
const buffer=createTwoPageTextPdf('alpha beta independent reading notes','Second page preserves research source');
test('adds a new PDF note to its project without retaining the full translation',async()=>{
 const restore=await isolate(),reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.set({piLibraryProjectsV1:{projects:{p1:{name:'阅读课题',updatedAt:1}},members:{}}}));await reader.goto(`chrome-extension://${extensionId}/pdf.html?project=p1`);await reader.locator('#file-input').setInputFiles({name:'project-note.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');await reader.locator('#pdf-annotation-mode').click();await select(reader);await reader.locator('#tex-selection-translator-root .selection-annotate').click();const form=reader.locator('.pdf-annotation-editor');await form.locator('textarea').fill('项目中的独立笔记');await form.locator('button[type="submit"]').click();await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();const saved=await read(),documentId=Object.keys(saved)[0]!,note=(saved as any)[documentId].annotations[0],membership=JSON.stringify(['pdf-note',documentId,note.id]);await expect.poll(async()=>worker().evaluate(async id=>(await(globalThis as any).chrome.storage.local.get('piLibraryProjectsV1')).piLibraryProjectsV1?.members?.[id]?.projects??[],membership)).toEqual(['p1']);
  await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#library-project-filter').selectOption('p1');await expect(options.locator('.library-source-result')).toContainText('项目中的独立笔记');expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await reader.close();await options.close();await restore()}
});
test('keeps the PDF note if its project is removed while editing',async()=>{
 const restore=await isolate(),reader=await context.newPage();
 try{
  await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.set({piLibraryProjectsV1:{projects:{p1:{name:'阅读课题',updatedAt:1}},members:{}}}));await reader.goto(`chrome-extension://${extensionId}/pdf.html?project=p1`);await reader.locator('#file-input').setInputFiles({name:'project-note.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');await reader.locator('#pdf-annotation-mode').click();await select(reader);await reader.locator('#tex-selection-translator-root .selection-annotate').click();const form=reader.locator('.pdf-annotation-editor');await form.locator('textarea').fill('保留的项目笔记');await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.set({piLibraryProjectsV1:{projects:{p1:{name:'阅读课题',updatedAt:2,deleted:true}},members:{}}}));await form.locator('button[type="submit"]').click();await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();await expect(reader.locator('#notice')).toContainText('笔记已保存，但未加入项目');expect((Object.values(await read())[0] as any).annotations[0].note).toBe('保留的项目笔记');
 }finally{await reader.close();await restore()}
});
test('locks a submitted PDF reading note while saving and permits editing it after completion',async()=>{
 const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await open(reader);await reader.locator('#pdf-annotation-mode').click();await select(reader);await reader.locator('#tex-selection-translator-root .selection-annotate').click();const form=reader.locator('.pdf-annotation-editor'),note=form.locator('textarea');await note.fill('提交的 PDF 阅读想法');await delayStorageWrite(reader,key);await form.locator('button[type="submit"]').click();await expect.poll(()=>reader.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);await expect(note).toHaveJSProperty('readOnly',true);await note.press('End');await note.pressSequentially('late draft');await expect(note).toHaveValue('提交的 PDF 阅读想法');await releaseStorageWrite(reader);await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();const saved=Object.values(await read()).flatMap((state:any)=>state.annotations) as any[];expect(saved).toHaveLength(1);expect(saved[0].note).toBe('提交的 PDF 阅读想法');await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.getByRole('button',{name:'编辑笔记',exact:true}).click();await expect(note).toHaveJSProperty('readOnly',false);await note.fill('第二次明确保存的想法');await form.locator('button[type="submit"]').click();await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();expect((Object.values(await read())[0] as any).annotations[0]).toEqual({...saved[0],note:'第二次明确保存的想法',updatedAt:(Object.values(await read())[0] as any).annotations[0].updatedAt});expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await releaseStorageWrite(reader);await reader.close();await restore()}
});
const worker=()=>context.serviceWorkers()[0]!;
const read=()=>worker().evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key))[key]??{},key);
async function isolate(){
  const previous=await worker().evaluate(async()=>{const c=(globalThis as any).chrome;return{local:await c.storage.local.get(null),session:await c.storage.session.get(null)}});
  await worker().evaluate(async key=>{const c=(globalThis as any).chrome;await c.storage.local.remove(key);await c.storage.session.remove('apiKeysByProfile')},key);
  return async()=>worker().evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.session.clear();await c.storage.local.set(previous.local);await c.storage.session.set(previous.session)},previous);
}
async function open(reader:Page,name='reading-notes.pdf',input=buffer){
  await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name,mimeType:'application/pdf',buffer:input});
  await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');
}
async function select(reader:Page,word='alpha',showAction=true,clickCount=2){
  const text=reader.locator('.pdf-page[data-page-number="1"] .textLayer');
  await expect(text).toContainText('alpha');
  const point=await text.evaluate((node,word)=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const i=n.textContent!.indexOf(word);if(i<0)continue;const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+word.length);const b=r.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}}throw Error('Missing fixed word')},word);
  await reader.mouse.click(point.x,point.y,{clickCount});if(showAction)await expect(reader.locator('#tex-selection-translator-root .selection-annotate')).toBeVisible();
}
test('switches from continuous translation to annotation-only selection and resumes only on an explicit action',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage();
  const sidebar=()=>worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.tabs.sendMessage(tab.id,{type:'OPEN_SIDEBAR'})},reader.url());
  try{
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.session.set({apiKeysByProfile:{[s.activeApiProfileId]:'e2e-test-key'}})});
    await open(reader);await sidebar();await select(reader,'alpha',false);
    await expect(reader.locator('#tex-selection-translator-root .copy-action:not(:disabled)')).toBeVisible();
    const before=textRequests.length+visionRequests.length;expect(before).toBeGreaterThan(0);
    await reader.locator('#pdf-annotation-mode').click();
    await expect(reader.locator('#pdf-annotation-mode')).toHaveAttribute('aria-pressed','true');
    await select(reader,'beta');await reader.waitForTimeout(450);expect(textRequests.length+visionRequests.length).toBe(before);
    await expect(reader.locator('#tex-selection-translator-root .trigger')).toHaveCount(0);
    await reader.locator('#tex-selection-translator-root .selection-annotate').click();await reader.locator('.pdf-annotation-editor textarea').fill('Only a local annotation');await reader.locator('.pdf-annotation-editor button[type="submit"]').click();
    await reader.locator('#pdf-annotation-mode').click();
    await reader.waitForTimeout(450);expect(textRequests.length+visionRequests.length).toBe(before);
    await select(reader,'independent');await reader.waitForTimeout(450);expect(textRequests.length+visionRequests.length).toBe(before);
    await reader.locator('#tex-selection-translator-root .trigger').click();await expect(reader.locator('#tex-selection-translator-root .copy-action:not(:disabled)')).toBeVisible();expect(textRequests.length+visionRequests.length).toBe(before+1);
    await reader.locator('#pdf-annotation-mode').click();await open(reader,'another-open.pdf');await expect(reader.locator('#pdf-reader-menu > summary')).toHaveText('更多');
    await reader.screenshot({path:info.outputPath('annotation-mode-reset.png')});await writeFile(info.outputPath('annotation-mode.json'),JSON.stringify({provider:'simulated',automaticRequestsWhileAnnotating:0,switchExitRequests:0,explicitTranslateRequests:1,documentSwitchResetsMode:true},null,2));
  }finally{await reader.close();await restore()}
});
test('keeps one native cross-page note through per-page location, rotation, renaming, search and version 6 restore',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await reader.setViewportSize({width:1100,height:1900});await open(reader);
    for(let i=0;i<3;i++)await clickPdfReaderAction(reader,'zoom-out');
    await expect(reader.locator('.pdf-page[data-page-number="2"]')).toHaveAttribute('data-rendered','ready');
    await reader.locator('#pdf-annotation-mode').click();
    const ends=await reader.evaluate(()=>[1,2].map(number=>{
      const text=document.querySelector(`.pdf-page[data-page-number="${number}"] .textLayer`)!,walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT),nodes:Text[]=[];let node;
      while(node=walker.nextNode())if(node.textContent?.trim())nodes.push(node as Text);
      const target=number===1?nodes[0]!:nodes.at(-1)!,range=document.createRange();range.selectNodeContents(target);const rect=range.getBoundingClientRect();return{x:number===1?rect.left+.1:rect.right-.1,y:rect.top+rect.height/2};
    }));
    await reader.mouse.move(ends[0]!.x,ends[0]!.y);await reader.mouse.down();await reader.mouse.move(ends[1]!.x,ends[1]!.y,{steps:20});await reader.mouse.up();
    await expect(reader.locator('#tex-selection-translator-root .selection-annotate')).toBeVisible();await reader.locator('#tex-selection-translator-root .selection-annotate').click();
    await expect(reader.locator('.pdf-annotation-editor .pdf-annotation-page')).toHaveText('第 1–2 页');await expect(reader.locator('.pdf-annotation-editor blockquote')).toContainText('Second page preserves research source');
    await reader.locator('.pdf-annotation-editor textarea').fill('Cross-page research note');await reader.locator('.pdf-annotation-editor button[type="submit"]').click();
    await expect.poll(async()=>(Object.values(await read()) as any[]).flatMap(item=>item.annotations??[]).length).toBe(1);
    const saved=await read(),record=(Object.values(saved) as any[])[0].annotations[0];expect(record.anchor.sourceText.trim()).toBe('alpha beta independent reading notes');expect(record.continuations[0].sourceText.trim()).toBe('Second page preserves research source');
    for(const number of [1,2])await expect(reader.locator(`.pdf-page[data-page-number="${number}"] .pdf-reading-highlight-layer [data-annotation-id]`).first()).toBeAttached();
    await open(reader,'renamed-cross-page.pdf');expect(await read()).toEqual(saved);
    await clickPdfReaderAction(reader,'rotate-page');await expect(reader.locator('.pdf-page[data-page-number="1"] .pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();
    for(const number of [1,2]){
      const alignment=await reader.locator(`.pdf-page[data-page-number="${number}"]`).evaluate(page=>{const range=document.createRange();range.selectNodeContents(page.querySelector('.textLayer span')!);const text=range.getBoundingClientRect(),mark=page.querySelector('.pdf-reading-highlight-layer span')!.getBoundingClientRect();return{vertical:text.height>text.width,error:Math.max(...(['left','top','right','bottom'] as const).map(edge=>Math.abs(text[edge]-mark[edge])))}});
      expect(alignment.vertical).toBe(true);expect(alignment.error).toBeLessThanOrEqual(1);
    }
    await clickPdfReaderAction(reader,'pdf-open-annotations');await expect(reader.locator('.pdf-reading-annotation .pdf-annotation-page')).toHaveText('第 1–2 页');await reader.getByRole('combobox',{name:'批注页码'}).selectOption('2');await reader.getByRole('button',{name:'定位原文',exact:true}).click();
    await reader.waitForTimeout(350);await writeFile(info.outputPath('locate-geometry.json'),JSON.stringify(await reader.evaluate(()=>{const viewer=document.querySelector('#pdf-viewer')!;return {viewport:{width:innerWidth,height:innerHeight},viewer:{height:viewer.clientHeight,scrollHeight:viewer.scrollHeight,scrollTop:viewer.scrollTop},pages:[...document.querySelectorAll('.pdf-page')].map(p=>({number:(p as HTMLElement).dataset.pageNumber,rect:p.getBoundingClientRect().toJSON(),marks:[...p.querySelectorAll('.pdf-reading-highlight-layer span')].map(m=>m.getBoundingClientRect().toJSON())}))}}),null,2));await reader.screenshot({path:info.outputPath('cross-page-locate-diagnosis.png')});
    // At 1900px both rotated pages fit completely; the dominant visible page remains 1.
    // Verify the second quote is visible, then check page-number navigation in a scrollable viewport.
    await expect(reader.locator('.pdf-page[data-page-number="2"] .pdf-reading-highlight-layer [data-annotation-id]').first()).toBeInViewport();
    await reader.setViewportSize({width:1100,height:600});await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.getByRole('combobox',{name:'批注页码'}).selectOption('2');await reader.getByRole('button',{name:'定位原文',exact:true}).click();
    await expect(reader.locator('#page-number')).toHaveValue('2');await expect(reader.locator('.pdf-page[data-page-number="2"] .pdf-reading-highlight-layer [data-annotation-id]').first()).toBeInViewport();
    await reader.setViewportSize({width:360,height:740});await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.screenshot({path:info.outputPath('cross-page-note-360.png')});expect(await reader.locator('#pdf-annotations-dialog').evaluate(d=>d.scrollWidth-d.clientWidth)).toBeLessThanOrEqual(1);await reader.keyboard.press('Escape');
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('Second page preserves research source');const result=options.locator('[data-source-kind="excerpt"]');await expect(result).toHaveCount(1);await expect(result).toContainText('第 1–2 页');await result.locator('.library-select').click();await expect(options.locator('#library-detail')).toContainText('Cross-page research note');
    await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const download=await downloading;await download.saveAs(info.outputPath('cross-page-backup.json'));const text=await readFile(info.outputPath('cross-page-backup.json'),'utf8');expect(JSON.parse(text).version).toBe(6);expect(JSON.parse(text).readingAnnotations).toEqual(saved);
    await worker().evaluate(async key=>{await(globalThis as any).chrome.storage.local.remove(key)},key);await options.locator('#library-backup-input').setInputFiles({name:'cross-page-backup.json',mimeType:'application/json',buffer:Buffer.from(text)});await options.locator('#library-import-confirm').click();await expect.poll(read).toEqual(saved);
    expect(textRequests.length+visionRequests.length).toBe(calls);await writeFile(info.outputPath('cross-page.json'),JSON.stringify({nativeMouseSelection:true,records:await read(),modelRequests:0,backupVersion:6},null,2));
  }finally{await reader.close();await options.close();await restore()}
});
test('rejects a cross-page selection with an unreadable middle page without storing a partial note',async()=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:'three-page-boundary.pdf',mimeType:'application/pdf',buffer:createMultiPageTextPdf([{text:'First native page'},{text:'Middle native page'},{text:'Last native page'}])});
    for(const number of [1,2,3])await expect(reader.locator(`.pdf-page[data-page-number="${number}"]`)).toHaveAttribute('data-rendered','ready');
    await reader.locator('#pdf-annotation-mode').click();
    await reader.evaluate(()=>{const pages=[...document.querySelectorAll('.pdf-page')],range=document.createRange(),selection=getSelection()!;range.setStart(pages[0]!.querySelector('.textLayer span')!.firstChild!,0);const last=pages[2]!.querySelector('.textLayer span')!.firstChild!;range.setEnd(last,last.textContent!.length);selection.removeAllRanges();selection.addRange(range);pages[1]!.setAttribute('data-has-native-text','false');document.dispatchEvent(new Event('selectionchange'))});
    await reader.locator('#tex-selection-translator-root .selection-annotate').click();await expect(reader.locator('#notice')).toContainText('未加载或没有原生文字');await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();expect(await read()).toEqual({});expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close();await restore()}
});
test('cancels an in-flight continuous result before annotating and ignores its late response',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage();
  try{
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.session.set({apiKeysByProfile:{[s.activeApiProfileId]:'e2e-test-key'}})});await open(reader,'held-source.pdf',createTwoPageTextPdf('alpha Bilingual reading should preserve the original article beta','Second page'));
    await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);await c.tabs.sendMessage(tab.id,{type:'OPEN_SIDEBAR'})},reader.url());
    const started=new Promise<void>(resolve=>{mockControl.interactiveRequestStarted=resolve});mockControl.heldInteractiveRequestGate=new Promise<void>(resolve=>{mockControl.releaseHeldInteractiveRequest=resolve});mockControl.holdNextInteractiveRequest=true;
    await select(reader,'alpha',false,3);await started;const requests=textRequests.length+visionRequests.length;
    await reader.locator('#pdf-annotation-mode').click();mockControl.releaseHeldInteractiveRequest?.();
    await select(reader,'beta');await reader.waitForTimeout(450);await expect(reader.locator('#tex-selection-translator-root .surface')).toHaveCount(0);expect(textRequests.length+visionRequests.length).toBe(requests);
    await reader.locator('#tex-selection-translator-root .selection-annotate').click();await reader.keyboard.press('Escape');expect(await read()).toEqual({});await reader.screenshot({path:info.outputPath('late-result-does-not-reopen.png')});
  }finally{mockControl.releaseHeldInteractiveRequest?.();mockControl.holdNextInteractiveRequest=false;await reader.close();await restore()}
});
async function save(reader:Page,note='A local research note',screenshot?:string){
  await select(reader);const selected=await reader.evaluate(()=>getSelection()!.toString());if(screenshot)await reader.screenshot({path:screenshot});await reader.locator('#tex-selection-translator-root .selection-annotate').click();
  await expect(reader.locator('#pdf-annotations-dialog')).toBeVisible();await reader.locator('.pdf-annotation-editor textarea').fill(note);await reader.locator('.pdf-annotation-editor button[type="submit"]').click();await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();
  await expect(reader.locator('.pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();
  return selected;
}
test('saves a native selection without an API, restores after renaming and zooming, and manages the source-only excerpt',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await open(reader);const selected=await save(reader,'A local research note',info.outputPath('selection-actions.png'));const before=await read();const record=(Object.values(before) as any[])[0].annotations[0];
    expect(selected.trim()).toBe('alpha');expect(record.anchor).toMatchObject({kind:'text-quote',pageNumber:1,sourceText:selected});expect(record).not.toHaveProperty('translatedText');
    await reader.screenshot({path:info.outputPath('highlight-saved.png')});
    await open(reader,'renamed-copy.pdf');await expect(reader.locator('.pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();expect(await read()).toEqual(before);
    await clickPdfReaderAction(reader,'zoom-in');await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');await expect(reader.locator('.pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();
    await clickPdfReaderAction(reader,'pdf-open-annotations');await expect(reader.locator('.pdf-reading-annotation-note')).toHaveText('A local research note');await reader.locator('.pdf-reading-annotation button').filter({hasText:'定位原文'}).click();await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();await options.locator('#web-excerpts-search').fill('A local research note');
    const item=options.locator('.saved-web-excerpt');await expect(item).toHaveCount(1);await expect(item.locator('.saved-web-excerpt-target')).toContainText('原文高亮');await expect(item.locator('.saved-web-excerpt-target')).toContainText('alpha');
    await item.locator('.saved-web-excerpt-edit').click();await item.locator('textarea[name="note"]').fill('Edited in excerpt library');await item.locator('button[type="submit"]').click();
    await expect.poll(async()=>JSON.stringify(await read())).toContain('Edited in excerpt library');
    await reader.setViewportSize({width:360,height:640});await clickPdfReaderAction(reader,'pdf-open-annotations');await expect(reader.locator('.pdf-reading-annotation-note')).toHaveText('Edited in excerpt library');
    expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const box=await reader.locator('#pdf-annotations-dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(361);
    await reader.screenshot({path:info.outputPath('annotations-360.png')});await reader.locator('#pdf-annotations-dialog').screenshot({path:info.outputPath('dialog-360.png')});expect(textRequests.length+visionRequests.length).toBe(calls);
    await writeFile(info.outputPath('annotations.json'),JSON.stringify({records:await read(),modelRequests:0,renamedCopyRestored:true},null,2));
  }finally{await reader.close();await options.close();await restore()}
});
test('cancels without writes, uses the live selection, and preserves a draft on a cross-window conflict',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await open(reader);await select(reader);
    await reader.evaluate(()=>{const selection=getSelection()!;selection.removeAllRanges();(document.querySelector('#tex-selection-translator-root')!.shadowRoot!.querySelector('.selection-annotate') as HTMLButtonElement).click()});
    await expect(reader.locator('#pdf-annotations-dialog')).not.toBeVisible();expect(await read()).toEqual({});
    await select(reader);await reader.evaluate(()=>{const node=document.querySelector('.textLayer span')!.firstChild!,range=document.createRange(),i=node.textContent!.indexOf('beta');range.setStart(node,i);range.setEnd(node,i+4);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);(document.querySelector('#tex-selection-translator-root')!.shadowRoot!.querySelector('.selection-annotate') as HTMLButtonElement).click()});
    await expect(reader.locator('.pdf-annotation-editor blockquote')).toHaveText('beta');await reader.keyboard.press('Escape');expect(await read()).toEqual({});
    await save(reader);await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.locator('.pdf-reading-annotation button').filter({hasText:'编辑笔记'}).click();await reader.locator('.pdf-annotation-editor textarea').fill('Unsaved personal draft');
    await worker().evaluate(async key=>{const c=(globalThis as any).chrome,map=(await c.storage.local.get(key))[key];Object.values(map).forEach((state:any)=>{state.annotations[0].note='Saved by another window';state.annotations[0].updatedAt+=1});await c.storage.local.set({[key]:map})},key);
    await reader.locator('.pdf-annotation-editor button[type="submit"]').click();await expect(reader.locator('.pdf-annotation-error')).toContainText('其他窗口');await expect(reader.locator('.pdf-annotation-editor textarea')).toHaveValue('Unsaved personal draft');
    expect(JSON.stringify(await read())).toContain('Saved by another window');expect(JSON.stringify(await read())).not.toContain('Unsaved personal draft');expect(textRequests.length+visionRequests.length).toBe(calls);
    await reader.screenshot({path:info.outputPath('conflict-preserves-draft.png')});
  }finally{await reader.close();await restore()}
});
test('previews and restores standalone annotations through a version 6 library backup without translation',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await open(reader);await save(reader,'Backup annotation');const original=await read();
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const download=await downloading;await download.saveAs(info.outputPath('annotation-backup.json'));
    const text=await readFile(info.outputPath('annotation-backup.json'),'utf8'),data=JSON.parse(text);expect(data.version).toBe(6);expect(data.readingAnnotations).toEqual(original);expect(text).not.toContain('e2e-test-key');
    await worker().evaluate(async key=>{await(globalThis as any).chrome.storage.local.remove(key)},key);
    await options.locator('#library-backup-input').setInputFiles({name:'annotation-backup.json',mimeType:'application/json',buffer:Buffer.from(text)});
    await expect(options.locator('#library-import-summary')).toContainText('阅读批注 1 条');expect(await read()).toEqual({});
    await options.locator('#library-import-confirm').click();await expect.poll(read).toEqual(original);await expect(reader.locator('.pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();
    expect(textRequests.length+visionRequests.length).toBe(calls);await writeFile(info.outputPath('restore.json'),JSON.stringify({unchanged:JSON.stringify(await read())===JSON.stringify(original),modelRequests:0}));
  }finally{await reader.close();await options.close();await restore()}
});
test('keeps the English annotation editor within a narrow viewport without an API',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en'})});await reader.setViewportSize({width:360,height:640});
    await open(reader);await select(reader);await expect(reader.locator('#tex-selection-translator-root .selection-annotate')).toHaveText('Highlight / note');await reader.locator('#tex-selection-translator-root .selection-annotate').click();
    await expect(reader.locator('#pdf-annotations-title')).toHaveText('Reading annotations');await expect(reader.locator('.pdf-annotation-editor button[type="submit"]')).toHaveText('Save highlight');
    const box=await reader.locator('#pdf-annotations-dialog').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(361);await reader.screenshot({path:info.outputPath('annotation-editor-en-360.png')});
    await reader.keyboard.press('Escape');expect(await read()).toEqual({});expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close();await restore()}
});
test('keeps annotation actions reachable, confirms deletion and preserves content across visual states',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await open(reader,'A research paper.pdf');await save(reader,'先确认实验条件，再回到原文核对。');await clickPdfReaderAction(reader,'pdf-open-annotations');
    const before=await read();
    const hierarchy=await reader.locator('.pdf-reading-annotation').evaluate(row=>{const note=row.querySelector<HTMLElement>('.pdf-reading-annotation-note')!,quote=row.querySelector('blockquote')!;return{noteBeforeQuote:Boolean(note.compareDocumentPosition(quote)&Node.DOCUMENT_POSITION_FOLLOWING),noteSize:parseFloat(getComputedStyle(note).fontSize),quoteSize:parseFloat(getComputedStyle(quote).fontSize),noteBottom:note.getBoundingClientRect().bottom,quoteTop:quote.getBoundingClientRect().top,fullQuote:quote.textContent}});
    expect(hierarchy.noteBeforeQuote).toBe(true);expect(hierarchy.noteSize).toBeGreaterThan(hierarchy.quoteSize);expect(hierarchy.noteBottom).toBeLessThanOrEqual(hierarchy.quoteTop);expect(hierarchy.fullQuote).toContain('alpha');
    await reader.screenshot({path:info.outputPath('annotations-desktop.png')});await reader.locator('#pdf-annotations-dialog').screenshot({path:info.outputPath('dialog-desktop.png')});
    await reader.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(globalThis as any).annotationCopied=text}}})});
    await reader.locator('.pdf-annotation-copy').click();await expect(reader.locator('.pdf-annotation-copy')).toContainText('已复制');
    expect(await reader.evaluate(()=>(globalThis as any).annotationCopied)).toContain('先确认实验条件');expect(await read()).toEqual(before);
    const more=reader.locator('.pdf-annotation-menu'),summary=more.locator('summary');
    await summary.focus();await reader.keyboard.press('Enter');await expect(more).toHaveAttribute('open');
    await reader.keyboard.press('Escape');await expect(more).not.toHaveAttribute('open');await expect(summary).toBeFocused();await expect(reader.locator('#pdf-annotations-dialog')).toBeVisible();
    await reader.setViewportSize({width:360,height:640});await summary.click();
    const box=await more.locator(':scope > div').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(361);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(641);
    await more.locator('button').click();await expect(more.locator('button')).toHaveText('确认删除');expect(await read()).toEqual(before);
    await reader.screenshot({path:info.outputPath('annotations-delete-confirm-360.png')});await reader.keyboard.press('Escape');
    await summary.click();await more.locator('button').click();await expect(more.locator('button')).toHaveText('确认删除');await more.locator('button').click();await expect.poll(read).toEqual({});await expect(reader.locator('.pdf-annotation-empty')).toBeVisible();
    await reader.locator('#pdf-annotations-dialog .pi-undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await expect(reader.locator('.pdf-reading-annotation')).toHaveCount(1);
    expect(Object.values(await read()).map((state:any)=>state.annotations)).toEqual(Object.values(before).map((state:any)=>state.annotations));
    await worker().evaluate(async key=>{const c=(globalThis as any).chrome,map=(await c.storage.local.get(key))[key],state=Object.values(map)[0] as any,item=state.annotations[0];state.annotations.push({...item,id:item.id+'-second',anchor:{...item.anchor,sourceText:'alpha beta independent reading notes',prefix:'',suffix:''},note:'保持原文、公式和人工修正。\n'.repeat(30)});await c.storage.local.set({[key]:map})},key);
    await expect(reader.locator('.pdf-reading-annotation')).toHaveCount(2);const full=await read();
    await reader.screenshot({path:info.outputPath('annotations-long-360.png')});await reader.emulateMedia({colorScheme:'dark'});
    const contrast=await reader.locator('.pdf-annotation-locate').first().evaluate(button=>{const style=getComputedStyle(button),luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4});return .2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!};const a=luminance(style.color),b=luminance(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});expect(contrast).toBeGreaterThanOrEqual(4.5);
    await reader.screenshot({path:info.outputPath('annotations-dark-360.png')});await reader.locator('#pdf-annotations-dialog').screenshot({path:info.outputPath('dialog-dark-360.png')});expect(await read()).toEqual(full);
    await worker().evaluate(async key=>{await(globalThis as any).chrome.storage.local.remove(key)},key);await expect(reader.locator('.pdf-reading-annotation')).toHaveCount(0);await expect(reader.locator('.pdf-annotation-empty')).toContainText('留下阅读时的想法');await reader.screenshot({path:info.outputPath('annotations-empty-dark.png')});
    expect(textRequests.length+visionRequests.length).toBe(calls);
    await writeFile(info.outputPath('design-validation.json'),JSON.stringify({keyboardMenu:true,confirmationZeroWrites:true,clipboard:'mocked; system clipboard unchanged',visualStateContentUnchanged:true,darkLocateContrast:contrast,modelRequests:0},null,2));
  }finally{await reader.close();await restore()}
});


test('keeps a waiting note dialog and its background search intact on Escape',async({},info)=>{
 const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
 try{
  await reader.setViewportSize({width:360,height:640});await open(reader);await save(reader,'原有阅读想法');await clickPdfReaderAction(reader,'open-search');await reader.locator('#pdf-search-query').fill('alpha');await clickPdfReaderAction(reader,'pdf-open-annotations');const dialog=reader.locator('#pdf-annotations-dialog');await dialog.getByRole('button',{name:'编辑笔记',exact:true}).click();const note=dialog.locator('textarea');await note.fill('这次明确保存的人工笔记');const original=Object.values(await read())[0] as any;
  await delayStorageWrite(reader,key);await dialog.locator('button[type="submit"]').click();await expect.poll(()=>reader.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);await expect(reader.locator('#pdf-search')).toBeVisible();await info.attach('waiting-dialog-focus',{body:JSON.stringify(await reader.evaluate(()=>({active:document.activeElement?.tagName,activeId:document.activeElement?.id,modal:document.querySelector('dialog:modal')?.id}))),contentType:'application/json'});await reader.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(note).toHaveValue('这次明确保存的人工笔记');await expect(note).toHaveJSProperty('readOnly',true);await expect(reader.locator('#pdf-search')).toBeVisible();await expect(reader.locator('#pdf-search-query')).toHaveValue('alpha');await reader.screenshot({path:info.outputPath('note-dialog-saving-escape.png')});await releaseStorageWrite(reader);await expect(dialog).not.toBeVisible();await expect(reader.locator('#pdf-reader-menu > summary')).toBeFocused();const saved=Object.values(await read())[0] as any;expect(saved.annotations[0]).toEqual({...original.annotations[0],note:'这次明确保存的人工笔记',updatedAt:saved.annotations[0].updatedAt});expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await releaseStorageWrite(reader);await reader.close();await restore()}
});
