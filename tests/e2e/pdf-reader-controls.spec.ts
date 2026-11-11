import type {Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createMultiPageTextPdf,createOutlinedPdf,createRasterPdf,textRequests,visionRequests} from './support/edge-extension-fixture';
import {clickPdfReaderAction,openPdfReaderMore} from './support/translation-controls';
installEdgeExtensionHooks();

for(const background of ['region','search'])for(const width of [360,1100])for(const menuId of ['pdf-reader-menu','pdf-document-translation-copy-menu']){
  test(`prioritizes Escape for the focused ${menuId} over ${background} mode at ${width}px`,async({},info)=>{
    const reader=await context.newPage(),restore=await isolate(),calls=textRequests.length,vision=visionRequests.length;
    await reader.addInitScript(()=>{
      const g=globalThis as any;g.piMenuEscapeEvents=[];
      for(const kind of ['keydown','keyup','click','toggle'])document.addEventListener(kind,event=>{
        const target=event.target as Element|null;
        g.piMenuEscapeEvents.push({kind,key:(event as KeyboardEvent).key,target:target?.id||target?.tagName,trusted:event.isTrusted,phase:event.eventPhase,region:document.getElementById('region-translate')?.getAttribute('data-region-mode'),menus:['pdf-reader-menu','pdf-document-translation-copy-menu'].map(id=>({id,open:(document.getElementById(id) as HTMLDetailsElement|null)?.open}))});
      },true);
    });
    try{
      await reader.setViewportSize({width,height:900});
      await open(reader,createMultiPageTextPdf([{text:`Menu Escape ${background} interaction ${menuId} width ${width}. This paragraph describes a controlled experiment.`}]),`menu-${background}-${menuId}-${width}.pdf`);
      if(background==='region'){await reader.locator('.pdf-page').first().click({position:{x:15,y:20}});await reader.keyboard.press('Shift+r');}
      if(menuId==='pdf-document-translation-copy-menu'){
        await reader.locator('#translate-document').click();await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
      }
      if(background==='search'){await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search')).toBeVisible();}
      const region=reader.locator('#region-translate'),menu=reader.locator(`#${menuId}`),summary=menu.locator(':scope > summary');
      if(background==='region')await expect(region).toHaveAttribute('data-region-mode','continuous');await summary.click();await expect(menu).toHaveJSProperty('open',true);await expect(summary).toBeFocused();
      await reader.keyboard.press('Escape');
      await writeFile(info.outputPath('after-first-escape.json'),JSON.stringify(await reader.evaluate(({menuId})=>({menuOpen:(document.getElementById(menuId) as HTMLDetailsElement).open,region:document.getElementById('region-translate')!.getAttribute('data-region-mode'),active:document.activeElement?.id||document.activeElement?.tagName,events:(globalThis as any).piMenuEscapeEvents}),{menuId}),null,2));
      await expect(menu).toHaveJSProperty('open',false);await expect(summary).toBeFocused();
      if(background==='region')await expect(region).toHaveAttribute('data-region-mode','continuous');else await expect(reader.locator('#pdf-search')).toBeVisible();
      await summary.click();await menu.locator(menuId==='pdf-reader-menu'?'#fit-page':'#pdf-document-translation-copy-translation').focus();await reader.keyboard.press('Escape');await expect(menu).toHaveJSProperty('open',false);await expect(summary).toBeFocused();
      if(background==='region')await expect(region).toHaveAttribute('data-region-mode','continuous');else await expect(reader.locator('#pdf-search')).toBeVisible();
      await reader.keyboard.press('Escape');if(background==='region')await expect(region).toHaveAttribute('data-region-mode','off');else await expect(reader.locator('#pdf-search')).toBeHidden();await expect(menu).toHaveJSProperty('open',false);
      const phase=await reader.locator('#pdf-document-translation').getAttribute('data-phase');
      await reader.emulateMedia({colorScheme:'dark'});await reader.mouse.move(0,0);await reader.screenshot({path:info.outputPath('closed-after-escape.png')});await expect(menu).toHaveJSProperty('open',false);expect(await reader.locator('#pdf-document-translation').getAttribute('data-phase')).toBe(phase);
      expect(textRequests.length-calls).toBe(menuId==='pdf-document-translation-copy-menu'?1:0);expect(visionRequests.length).toBe(vision);
    }finally{if(!reader.isClosed())await writeFile(info.outputPath('menu-escape-events.json'),JSON.stringify(await reader.evaluate(()=>(globalThis as any).piMenuEscapeEvents).catch(()=>[]),null,2));await reader.close();await restore()}
  });
}
const url=()=>`chrome-extension://${extensionId}/pdf.html`;
async function open(reader:Page,buffer:Buffer,name='reader-controls-fixed.pdf') {
  await reader.goto(url());await reader.locator('#file-input').setInputFiles({name,mimeType:'application/pdf',buffer});
  await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');
}
async function isolate() {
  const worker=context.serviceWorkers()[0]!;
  const before=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;const keys=['piPdfReadingStatesV1','piPdfReadingAnnotationsV1'];const values=await c.storage.local.get(keys);await c.storage.local.remove(keys);return values});
  return async()=>worker.evaluate(async before=>{const c=(globalThis as any).chrome;await c.storage.local.remove(['piPdfReadingStatesV1','piPdfReadingAnnotationsV1']);await c.storage.local.set(before)},before);
}

test('keeps frequent reading actions direct and reuses zoom controls when changing width',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try {
    await reader.setViewportSize({width:1100,height:800});
    await open(reader,createMultiPageTextPdf([{text:'Direct reading controls alpha'},{text:'Second page beta'}]));
    const menu=reader.locator('#pdf-reader-menu'),zoom=reader.locator('.zoom-controls');
    await expect(menu).not.toHaveAttribute('open');
    for(const id of ['open-outline','open-search','page-number','zoom-out','zoom-in','fit-width']){
      await expect(reader.locator(`#${id}`)).toBeVisible();
      expect(await reader.locator(`#${id}`).evaluate(node=>Boolean(node.closest('#pdf-reader-menu')))).toBe(false);
    }
    const zoomNode=await zoom.elementHandle();
    const initial=await reader.locator('#zoom-value').innerText();
    await reader.locator('#zoom-in').click();await expect(reader.locator('#zoom-value')).not.toHaveText(initial);
    const changed=await reader.locator('#zoom-value').innerText();
    await reader.locator('#open-search').click();await reader.locator('#pdf-search-query').fill('beta');
    await expect(reader.locator('#pdf-search-status')).toContainText('1 / 1');
    await expect(reader.locator('#page-number')).toHaveValue('2');await reader.keyboard.press('Escape');
    await reader.screenshot({path:info.outputPath('toolbar-desktop.png')});
    await reader.locator('#zoom-out').focus();await reader.setViewportSize({width:360,height:700});
    await expect(menu.locator(':scope > summary')).toBeFocused();
    await expect(zoom).toBeHidden();await expect(reader.locator('#open-search')).toBeVisible();
    await expect(reader.locator('#open-outline')).toBeVisible();
    await expect(reader.locator('#page-number')).toHaveValue('2');
    expect(await zoomNode!.evaluate(node=>node===document.querySelector('.zoom-controls'))).toBe(true);
    await openPdfReaderMore(reader);await expect(zoom).toBeVisible();
    await expect(reader.locator('#zoom-value')).toHaveText(changed);
    await reader.screenshot({path:info.outputPath('toolbar-360-more.png')});
    await reader.locator('#zoom-out').focus();await reader.setViewportSize({width:1100,height:800});
    await expect(reader.locator('#zoom-out')).toBeFocused();
    await expect(reader.locator('#pdf-toolbar-zoom .zoom-controls')).toBeVisible();
    await reader.keyboard.press('Escape');
    for(const width of [360,720,721,1100]){
      await reader.setViewportSize({width,height:700});
      expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      for(const id of ['open-outline','open-search','zoom-out','zoom-in','zoom-value'])await expect(reader.locator(`#${id}`)).toHaveCount(1);
    }
    await reader.setViewportSize({width:360,height:700});await reader.emulateMedia({colorScheme:'dark'});
    await expect(reader.locator('#open-search')).toBeEnabled();
    expect(await menu.locator(':scope > summary').evaluate(node=>innerWidth-node.getBoundingClientRect().right)).toBeLessThanOrEqual(12);
    await reader.screenshot({path:info.outputPath('toolbar-360-dark.png')});
    expect(textRequests.length+visionRequests.length).toBe(calls);
  } finally {await reader.close();await restore()}
});
async function jump(reader:Page,number:number) {
  await reader.locator('#page-number').fill(String(number));await reader.locator('#page-number').press('Enter');
  await expect(reader.locator(`.pdf-page[data-page-number="${number}"]`)).toHaveAttribute('data-rendered','ready');
}
async function rotation(reader:Page,angle:number) {
  await clickPdfReaderAction(reader,'rotate-page');
  await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-view-rotation',String(angle));
  await expect.poll(()=>reader.locator('.pdf-page[data-rendered="ready"]').count()).toBeGreaterThan(0);
}

test('loads bounded thumbnails only on demand and navigates a long PDF with mouse and keyboard',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try {
    await reader.setViewportSize({width:1280,height:850});
    await open(reader,createMultiPageTextPdf(Array.from({length:80},(_,i)=>({text:`Fixed thumbnail sample page ${i+1}`}))));
    await reader.evaluate(()=>{const scope=globalThis as any;scope.piPreviewPeak=0;scope.piPreviewCanvases=[];new MutationObserver(()=>{const canvases=[...document.querySelectorAll<HTMLCanvasElement>('#pdf-thumbnails canvas')];scope.piPreviewPeak=Math.max(scope.piPreviewPeak,canvases.length);for(const canvas of canvases)if(!scope.piPreviewCanvases.includes(canvas))scope.piPreviewCanvases.push(canvas)}).observe(document.querySelector('#pdf-thumbnails')!,{childList:true,subtree:true})});
    await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);
    await clickPdfReaderAction(reader,'open-outline');await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);
    await reader.locator('#pdf-navigation-thumbnails-tab').click();
    await expect(reader.locator('[data-thumbnail-page]')).toHaveCount(80);
    await expect.poll(()=>reader.locator('#pdf-thumbnails [data-rendered="ready"]').count()).toBeGreaterThan(0);
    expect(await reader.locator('#pdf-thumbnails canvas').count()).toBeLessThanOrEqual(8);
    await reader.screenshot({path:info.outputPath('thumbnails-long-light.png')});
    await reader.locator('[data-thumbnail-page="1"]').focus();await reader.keyboard.press('End');
    await expect(reader.locator('[data-thumbnail-page="80"]')).toBeFocused();
    await expect(reader.locator('[data-thumbnail-page="80"]')).toHaveAttribute('data-rendered','ready');
    await reader.keyboard.press('Enter');await expect(reader.locator('#page-number')).toHaveValue('80');
    await expect(reader.locator('.pdf-page[data-page-number="80"]')).toHaveAttribute('data-rendered','ready');
    await expect(reader.locator('[data-thumbnail-page="80"]')).toHaveAttribute('aria-current','page');
    expect(await reader.locator('#pdf-thumbnails canvas').count()).toBeLessThanOrEqual(8);
    await reader.keyboard.press('Escape');await expect(reader.locator('#pdf-outline')).not.toBeVisible();
    await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);
    const resources=await reader.evaluate(()=>{const scope=globalThis as any;return{peakCanvases:scope.piPreviewPeak,allReleased:scope.piPreviewCanvases.length>0&&scope.piPreviewCanvases.every((canvas:HTMLCanvasElement)=>canvas.width===0&&canvas.height===0)}});
    expect(resources.peakCanvases).toBeGreaterThan(0);expect(resources.peakCanvases).toBeLessThanOrEqual(8);expect(resources.allReleased).toBe(true);
    await reader.locator('#pdf-link-return').click();await expect(reader.locator('#page-number')).toHaveValue('1');
    expect(textRequests.length+visionRequests.length).toBe(calls);
    await writeFile(info.outputPath('thumbnail-resources.json'),JSON.stringify({pages:80,...resources,closedCanvases:0,newModelRequests:0}));
  } finally {await reader.close();await restore()}
});

test('fits mixed pages, rotates native text, preserves highlights and restores the view after renaming',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  const buffer=createMultiPageTextPdf([{text:'alpha native selection remains accurate',height:1200},{text:'Landscape page',width:1000,height:600}]);
  try {
    await reader.setViewportSize({width:1100,height:800});await open(reader,buffer);
    const text=reader.locator('.pdf-page[data-page-number="1"] .textLayer');
    await text.evaluate(node=>{const text=node.querySelector('span')!.firstChild!,range=document.createRange();range.setStart(text,0);range.setEnd(text,5);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'))});
    await reader.locator('#tex-selection-translator-root .selection-annotate').click();await reader.locator('.pdf-annotation-editor textarea').fill('Protected source note');await reader.locator('.pdf-annotation-editor button[type="submit"]').click();
    await expect.poll(async()=>context.serviceWorkers()[0]!.evaluate(async()=>Boolean((await(globalThis as any).chrome.storage.local.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1))).toBe(true);
    const notes=await context.serviceWorkers()[0]!.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1);
    await clickPdfReaderAction(reader,'fit-page');
    const fits=()=>reader.locator('.pdf-page[data-page-number="1"]').evaluate(node=>{const r=node.getBoundingClientRect(),stage=document.querySelector<HTMLElement>('#document-stage')!;return r.width<=stage.clientWidth&&r.height<=stage.clientHeight});
    await expect.poll(fits).toBe(true);
    await rotation(reader,90);await expect.poll(fits).toBe(true);
    await expect(reader.locator('.pdf-page[data-page-number="1"] .pdf-reading-highlight-layer [data-annotation-id]').first()).toBeAttached();
    await expect(text).toContainText('alpha');
    await clickPdfReaderAction(reader,'pdf-open-annotations');await reader.getByRole('button',{name:'定位原文',exact:true}).click();
    await expect(reader.locator('.pdf-page[data-page-number="1"] .pdf-reading-highlight-layer [data-annotation-id]').first()).toBeInViewport();
    const highlightGeometry=await reader.locator('.pdf-page[data-page-number="1"]').evaluate(page=>{const span=[...page.querySelectorAll('.textLayer span')].find(span=>span.textContent!.startsWith('alpha'))!,range=document.createRange();range.setStart(span.firstChild!,0);range.setEnd(span.firstChild!,5);const r=range.getBoundingClientRect(),mark=page.querySelector<HTMLElement>('[data-annotation-id]')!,m=mark.getBoundingClientRect();return{range:{left:r.left,top:r.top,width:r.width,height:r.height},mark:{left:m.left,top:m.top,width:m.width,height:m.height},style:mark.getAttribute('style'),layer:span.parentElement?.outerHTML.slice(0,1300)}});
    await writeFile(info.outputPath('highlight-geometry.json'),JSON.stringify(highlightGeometry,null,2));
    expect(highlightGeometry.range.height).toBeGreaterThan(highlightGeometry.range.width);
    const rotatedPage=(await reader.locator('.pdf-page[data-page-number="1"]').boundingBox())!;
    expect(highlightGeometry.range.left-rotatedPage.x).toBeGreaterThan(rotatedPage.width*.8);
    expect(Math.abs(highlightGeometry.range.left-highlightGeometry.mark.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(highlightGeometry.range.top-highlightGeometry.mark.top)).toBeLessThanOrEqual(2);
    await reader.screenshot({path:info.outputPath('rotated-highlight-light.png')});
    await expect.poll(async()=>context.serviceWorkers()[0]!.evaluate(async()=>JSON.stringify((await(globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1))).toContain('"rotation":90');
    await open(reader,buffer,'renamed-same-content.pdf');await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-view-rotation','90');
    await openPdfReaderMore(reader);await expect(reader.locator('#fit-page')).toHaveAttribute('aria-pressed','true');await reader.keyboard.press('Escape');
    expect(await context.serviceWorkers()[0]!.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1)).toEqual(notes);
    await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-query').fill('alpha');await expect(reader.locator('#pdf-search-status')).toContainText('1 / 1');await reader.keyboard.press('Escape');
    await clickPdfReaderAction(reader,'open-outline');await reader.locator('#pdf-navigation-thumbnails-tab').click();
    await reader.locator('[data-thumbnail-page="2"]').click();await expect(reader.locator('#page-number')).toHaveValue('2');
    await reader.keyboard.press('Escape');await reader.locator('#pdf-link-return').click();await expect(reader.locator('#page-number')).toHaveValue('1');
    await jump(reader,2);await clickPdfReaderAction(reader,'fit-page');
    await expect.poll(()=>reader.locator('.pdf-page[data-page-number="2"]').evaluate(node=>{const r=node.getBoundingClientRect(),s=document.querySelector<HTMLElement>('#document-stage')!;return r.width<=s.clientWidth&&r.height<=s.clientHeight})).toBe(true);
    await clickPdfReaderAction(reader,'zoom-in');await openPdfReaderMore(reader);await expect(reader.locator('#fit-page')).toHaveAttribute('aria-pressed','false');
    expect(textRequests.length+visionRequests.length).toBe(calls);
  } finally {await reader.close();await restore()}
});

test('keeps navigation tabs accessible in Chinese and English at 360px and clears previews on document replacement',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),worker=context.serviceWorkers()[0]!;
  const previous=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('uiLanguagePreference')).uiLanguagePreference);
  try {
    await reader.setViewportSize({width:360,height:700});
    for(const language of ['zh-CN','en']) {
      await worker.evaluate(async language=>{await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language})},language);
      await reader.emulateMedia({colorScheme:language==='en'?'dark':'light'});await open(reader,createOutlinedPdf(),`${language}-fixed-outline.pdf`);
      await clickPdfReaderAction(reader,'open-outline');await reader.locator('#pdf-navigation-outline-tab').focus();await reader.keyboard.press('ArrowRight');
      await expect(reader.locator('#pdf-navigation-thumbnails-tab')).toBeFocused();await expect(reader.locator('#pdf-thumbnails')).toBeVisible();
      await expect.poll(()=>reader.locator('#pdf-thumbnails canvas').count()).toBeGreaterThan(0);
      expect(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await reader.screenshot({path:info.outputPath(`thumbnails-360-${language}.png`)});
      await reader.keyboard.press('End');await expect(reader.locator('#pdf-navigation-bookmarks-tab')).toBeFocused();await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);
      await reader.keyboard.press('Escape');await open(reader,createMultiPageTextPdf([{text:'Replacement single page'}]),'replacement.pdf');
      await clickPdfReaderAction(reader,'open-outline');await reader.locator('#pdf-navigation-thumbnails-tab').click();await expect(reader.locator('[data-thumbnail-page]')).toHaveCount(1);
      await reader.locator('#pdf-outline-close').click();await openPdfReaderMore(reader);
      for(const id of ['open-outline','open-search','recognize-page'])expect(await reader.locator(`#${id}`).evaluate(node=>getComputedStyle(node,'::before').content)).toBe('none');
      await reader.screenshot({path:info.outputPath(`controls-360-${language}.png`)});await reader.keyboard.press('Escape');
    }
  } finally {await reader.close();await worker.evaluate(async previous=>{const c=(globalThis as any).chrome;if(previous===undefined)await c.storage.local.remove('uiLanguagePreference');else await c.storage.local.set({uiLanguagePreference:previous})},previous);await restore()}
});

test('enters and exits full screen through the real browser API and refits on resize',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage();
  try {
    await reader.setViewportSize({width:1000,height:750});await open(reader,createMultiPageTextPdf([{text:'Fullscreen fixed sample'}]));await clickPdfReaderAction(reader,'fit-page');
    await clickPdfReaderAction(reader,'reader-fullscreen');await expect.poll(()=>reader.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
    await reader.screenshot({path:info.outputPath('fullscreen.png')});
    await clickPdfReaderAction(reader,'reader-fullscreen');await expect.poll(()=>reader.evaluate(()=>Boolean(document.fullscreenElement))).toBe(false);
    await reader.setViewportSize({width:800,height:500});
    await expect.poll(()=>reader.locator('.pdf-page').first().evaluate(node=>{const s=document.querySelector<HTMLElement>('#document-stage')!;return node.getBoundingClientRect().height<=s.clientHeight})).toBe(true);
  } finally {await reader.close();await restore()}
});

test('resets before recognition and rotates the temporary OCR layer without real model requests',async()=>{
  const restore=await isolate(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try {
    await reader.addInitScript(()=>{const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...rest:any[])=>message?.type==='RECOGNIZE_PDF_PAGE'?Promise.resolve({ok:true,data:{page:{pageNumber:1,coordinateSystem:'normalized-page',source:'qwen-advanced-recognition',blocks:[{id:'fixed-rotated-ocr',order:0,text:'Fixed OCR source',confidence:.95,confidenceSource:'trusted-adapter',kind:'text',box:{left:.2,top:.25,width:.4,height:.05}}]}}}):send(message,...rest)});
    await open(reader,createRasterPdf(),'fixed-scan-controls.pdf');await rotation(reader,90);
    await clickPdfReaderAction(reader,'recognize-page');await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-view-rotation','0');
    await expect(reader.locator('.region-selection-box')).toBeVisible();await reader.locator('.region-confirm').getByRole('button',{name:'取消',exact:true}).click();
    await clickPdfReaderAction(reader,'recognize-page');await reader.locator('.region-confirm .confirm').click();
    await expect(reader.locator('[data-pi-ocr-block="fixed-rotated-ocr"]')).toBeVisible();await rotation(reader,90);
    const ocr=await reader.locator('[data-pi-ocr-block="fixed-rotated-ocr"]').evaluate(node=>{const r=node.getBoundingClientRect();return{width:r.width,height:r.height,layerTransform:getComputedStyle(node.parentElement!).transform}});
    expect(ocr.height).toBeGreaterThan(ocr.width);expect(ocr.layerTransform).toBe('none');
    expect(textRequests.length+visionRequests.length).toBe(calls);
  } finally {await reader.close();await restore()}
});

test('keeps a rotated region canonical and returns to that same source after changing orientation',async({},info)=>{
  const restore=await isolate(),reader=await context.newPage(),images=visionRequests.length;
  try {
    await reader.addInitScript(()=>{const scope=globalThis as any,c=scope.chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...rest:any[])=>{if(message?.type==='TRANSLATE_IMAGE_REGION')scope.piFixedRegion=structuredClone(message.payload.sourceLocation);return send(message,...rest)}});
    await reader.setViewportSize({width:1200,height:850});await open(reader,createRasterPdf(),'fixed-rotated-region.pdf');await clickPdfReaderAction(reader,'fit-page');await rotation(reader,90);
    const page=reader.locator('.pdf-page').first();await expect(page).toHaveAttribute('data-rendered','ready');await reader.locator('#region-translate').click();
    const box=(await page.boundingBox())!;
    await reader.mouse.move(box.x+box.width*.2,box.y+box.height*.25);await reader.mouse.down();await reader.mouse.move(box.x+box.width*.5,box.y+box.height*.65,{steps:5});await reader.mouse.up();
    const actual=(await page.locator('.region-selection-box').boundingBox())!;
    const expected={leftRatio:(actual.y-box.y)/box.height,topRatio:1-(actual.x-box.x+actual.width)/box.width,widthRatio:actual.height/box.height,heightRatio:actual.width/box.width};
    await page.locator('.region-confirm .confirm').click();await expect.poll(()=>reader.evaluate(()=>(globalThis as any).piFixedRegion)).toBeTruthy();
    const reference=await reader.evaluate(()=>(globalThis as any).piFixedRegion);
    for(const name of Object.keys(expected) as (keyof typeof expected)[])expect(reference[name]).toBeCloseTo(expected[name],2);
    await expect.poll(()=>visionRequests.length).toBe(images+1);
    const overlay=reader.locator('#tex-selection-translator-root');await expect(overlay.locator('.source-location').first()).toBeVisible();
    for(const angle of [180,270,0])await rotation(reader,angle);
    await overlay.locator('.source-location').first().click();await expect(page.locator('.region-source-highlight')).toBeVisible();
    const highlighted=await page.locator('.region-source-highlight').evaluate(node=>{const p=node.parentElement!,r=node.getBoundingClientRect(),b=p.getBoundingClientRect();return{leftRatio:(r.left-b.left)/b.width,topRatio:(r.top-b.top)/b.height,widthRatio:r.width/b.width,heightRatio:r.height/b.height}});
    for(const name of Object.keys(expected) as (keyof typeof expected)[])expect(highlighted[name]).toBeCloseTo(expected[name],2);
    await reader.screenshot({path:info.outputPath('canonical-region-return.png')});await writeFile(info.outputPath('region-mapping.json'),JSON.stringify({expected,reference,highlighted,simulatedVisionRequests:1,realModelRequests:0},null,2));
  } finally {await reader.close();await restore()}
});

const planPath=process.env.PI_PDF_READING_PLAN;
const realPlan=planPath?JSON.parse(readFileSync(planPath,'utf8')):undefined;
for(const sample of realPlan?.samples ?? [{id:'requires-fixed-local-plan'}])test(`checks navigation controls on fixed real PDF: ${sample.id}`,async({},info)=>{
  test.skip(!realPlan,'Requires the fixed local PDF plan; no download or model calls.');test.setTimeout(120_000);
  const restore=await isolate(),reader=await context.newPage(),worker=context.serviceWorkers()[0]!,calls=textRequests.length+visionRequests.length;
  const buffer=readFileSync(sample.file);expect(createHash('sha256').update(buffer).digest('hex')).toBe(sample.sha256);
  await worker.evaluate(()=>{const scope=globalThis as any,fetch=scope.fetch.bind(scope);scope.piControlProviderAttempts=0;scope.piControlOriginalFetch=fetch;scope.fetch=(...args:any[])=>{const url=typeof args[0]==='string'?args[0]:args[0]?.url??String(args[0]);if(/^https?:/u.test(url)){scope.piControlProviderAttempts++;throw new Error('Blocked in real PDF navigation test')}return fetch(...args)}});
  try {
    await reader.setViewportSize({width:1280,height:900});await open(reader,buffer,`${sample.id}-fixed-local.pdf`);
    await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);await clickPdfReaderAction(reader,'fit-page');await clickPdfReaderAction(reader,'open-outline');await reader.locator('#pdf-navigation-thumbnails-tab').click();
    await expect(reader.locator('[data-thumbnail-page="1"]')).toHaveAttribute('data-rendered','ready');
    // The short first scan page can leave page 2 dominant on initial load.
    // Establish the fixed starting page explicitly before checking return-to-origin.
    await reader.locator('[data-thumbnail-page="1"]').click();await expect(reader.locator('#page-number')).toHaveValue('1');
    await reader.screenshot({path:info.outputPath(`${sample.id}-thumbnails.png`)});
    await reader.locator('[data-thumbnail-page="1"]').focus();await reader.keyboard.press('End');await reader.keyboard.press('Enter');
    await expect(reader.locator('#page-number')).toHaveValue(String(sample.pages));await expect(reader.locator(`.pdf-page[data-page-number="${sample.pages}"]`)).toHaveAttribute('data-rendered','ready');
    const previews=await reader.locator('#pdf-thumbnails canvas').count();expect(previews).toBeLessThanOrEqual(8);
    await reader.keyboard.press('Escape');await expect(reader.locator('#pdf-thumbnails canvas')).toHaveCount(0);await rotation(reader,90);
    await expect(reader.locator('#page-number')).toHaveValue(String(sample.pages));
    await reader.locator('#pdf-link-return').click();await expect(reader.locator('#page-number')).toHaveValue('1');await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-view-rotation','0');
    expect(textRequests.length+visionRequests.length).toBe(calls);expect(await worker.evaluate(()=>(globalThis as any).piControlProviderAttempts)).toBe(0);
    expect(createHash('sha256').update(readFileSync(sample.file)).digest('hex')).toBe(sample.sha256);
    await writeFile(info.outputPath('real-control-results.json'),JSON.stringify({sample:sample.id,sha256:sample.sha256,pages:sample.pages,maxPreviews:previews,closedPreviews:0,thumbnailJump:true,rotation:true,returnRestoresOrientation:true,sourceUnchanged:true,newModelRequests:0},null,2));
  } finally {await reader.close();await worker.evaluate(()=>{const scope=globalThis as any;scope.fetch=scope.piControlOriginalFetch});await restore()}
});
