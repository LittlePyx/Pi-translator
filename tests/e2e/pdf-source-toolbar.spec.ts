import {createHash} from 'node:crypto';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
test('returns to a saved PDF quote without scrolling the application toolbar out of view',async({},info)=>{
 const pdf=createTwoPageTextPdf('First page preserves the reading context.','The quantum source passage belongs to this paper.'),fingerprint=createHash('sha256').update(pdf).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32),worker=context.serviceWorkers()[0]!,reader=await context.newPage(),key='piPdfReadingAnnotationsV1';
 const previous=await worker.evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key),calls=textRequests.length+visionRequests.length;
 try{
  const map={...(previous[key] as object??{}),[id]:{annotations:[{id:'toolbar-source-note',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'quantum',prefix:'The ',suffix:' source passage belongs to this paper.'},sourceTitle:'Reading source',note:'阅读笔记：返回原文后继续阅读。',createdAt:1,updatedAt:1}],updatedAt:1}};
  await worker.evaluate(async({key,map})=>await(globalThis as any).chrome.storage.local.set({[key]:map}),{key,map});
  const excerpt=JSON.stringify(['pdf-note',id,'toolbar-source-note']);await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(excerpt)}`);await reader.locator('#file-input').setInputFiles({name:'source-reading.pdf',mimeType:'application/pdf',buffer:pdf});await expect(reader.locator('#notice')).toContainText('已定位原文');
  const geometry=await reader.evaluate(()=>({windowY:scrollY,bodyY:document.body.scrollTop,toolbarTop:document.querySelector('.toolbar')!.getBoundingClientRect().top,stageTop:document.querySelector('#document-stage')!.getBoundingClientRect().top}));
  await info.attach('source-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});await reader.screenshot({path:info.outputPath('source-toolbar.png')});
  expect(geometry.windowY).toBe(0);expect(geometry.bodyY).toBe(0);expect(geometry.toolbarTop).toBeGreaterThanOrEqual(0);await expect(reader.locator('[data-library-source="toolbar-source-note"]')).toBeInViewport();
  expect(textRequests.length+visionRequests.length).toBe(calls);expect(await worker.evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key)).toEqual({[key]:map});
 }finally{await reader.close();await worker.evaluate(async({key,previous})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(key);await s.set(previous)},{key,previous})}
});

for(const language of ['zh-CN','en'])test(`keeps localized reader controls and source feedback separate at narrow widths in ${language}`,async({},info)=>{
 const worker=context.serviceWorkers()[0]!,reader=await context.newPage();
 const old=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(['uiLanguagePreference','piPdfReadingAnnotationsV1']));
 const pdf=createTwoPageTextPdf('First page preserves reading context.','The quantum source passage belongs to this paper.'),fingerprint=createHash('sha256').update(pdf).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32),key='piPdfReadingAnnotationsV1';
 const map={...(old[key] as object??{}),[id]:{annotations:[{id:'narrow-source',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'quantum',prefix:'The ',suffix:' source passage belongs to this paper.'},sourceTitle:'Reading source',note:'Saved personal note',createdAt:1,updatedAt:1}],updatedAt:1}};
 const calls=textRequests.length+visionRequests.length;
 try{
  await worker.evaluate(async data=>await(globalThis as any).chrome.storage.local.set(data),{uiLanguagePreference:language,[key]:map});
  for(const width of [300,360,460,720]){
   await reader.setViewportSize({width,height:540});await reader.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
   await reader.goto('about:blank');await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(JSON.stringify(['pdf-note',id,'narrow-source']))}`);
   await reader.locator('#file-input').setInputFiles({name:'source-reading.pdf',mimeType:'application/pdf',buffer:pdf});await expect(reader.locator('#notice')).toBeVisible();
   const layout=await reader.evaluate(()=>{
    const controls=[...document.querySelectorAll<HTMLElement>('.document-actions button,.document-actions input,.region-tools button')].filter(el=>el.checkVisibility()).map(el=>({id:el.id,rect:el.getBoundingClientRect().toJSON(),clipped:el.scrollWidth>el.clientWidth+1}));
    const overlaps=controls.flatMap((a,i)=>controls.slice(i+1).filter(b=>Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>1&&Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>1).map(b=>[a.id,b.id]));
    const notice=document.querySelector('#notice')!;
    return {controls,overlaps,notice:notice.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth-innerWidth};
   });
   await info.attach(`geometry-${width}`,{body:JSON.stringify(layout),contentType:'application/json'});await reader.screenshot({path:info.outputPath(`source-${width}.png`)});
   expect.soft(layout.overlaps).toEqual([]);expect.soft(layout.controls.filter(c=>c.clipped)).toEqual([]);expect.soft(layout.overflow).toBeLessThanOrEqual(1);
   expect.soft(layout.notice.left).toBeGreaterThanOrEqual(8);expect.soft(layout.notice.right).toBeLessThanOrEqual(width-8);
   expect(await reader.locator('#translate-document').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
   for(const c of layout.controls){expect.soft(c.rect.left).toBeGreaterThanOrEqual(0);expect.soft(c.rect.right).toBeLessThanOrEqual(width)}
  }
  expect(textRequests.length+visionRequests.length).toBe(calls);expect(await worker.evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key)).toEqual({[key]:map});
 }finally{await reader.close();await worker.evaluate(async old=>{const s=(globalThis as any).chrome.storage.local;await s.remove(['uiLanguagePreference','piPdfReadingAnnotationsV1']);await s.set(old)},old)}
});
