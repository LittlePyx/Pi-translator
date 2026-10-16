import {clickPdfReaderAction} from './support/translation-controls';
import {writeFile} from 'node:fs/promises';
import type {Locator,Page,TestInfo} from '@playwright/test';
import {ARTICLE_FIXTURE_URL,context,createTwoPageTextPdf,expect,extensionId,installEdgeExtensionHooks,page,selectElementText,setStoredSidebarMode,test} from './support/edge-extension-fixture';
import {openTranslationMore} from './support/translation-controls';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();
const sizes=[{width:1360,height:900},{width:360,height:700},{width:300,height:420}];
type Evidence={state:string;overflow:number;clipped:string[];occluded:string[];menu?:{x:number;y:number;width:number;height:number}};
async function inspect(target:Page,state:string,evidence:Evidence[],menu?:Locator):Promise<void>{
  const layout=await target.evaluate(()=>({
    overflow:location.protocol==='chrome-extension:'?document.documentElement.scrollWidth-innerWidth:0,
    clipped:[...document.querySelectorAll<HTMLElement>('button,summary')].filter(element=>{
      if(!element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))return false;
      const closed=element.closest('details:not([open])');if(closed&&!closed.querySelector(':scope > summary')?.contains(element))return false;
      const rect=element.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight&&element.scrollWidth>element.clientWidth+2;
    }).map(element=>`${element.id||element.className}: ${element.textContent?.trim().slice(0,70)}`),
  }));
  const bounds=menu?await menu.boundingBox():null;
  const occluded=menu?await menu.evaluate(panel=>{
    const area=panel.getBoundingClientRect();
    return [...panel.querySelectorAll<HTMLElement>('button,summary,input,select')].filter(element=>{
      if(!element.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))return false;
      const rect=element.getBoundingClientRect();const x=rect.x+rect.width/2;const y=rect.y+rect.height/2;
      if(x<area.left||x>area.right||y<area.top||y>area.bottom||x<0||x>innerWidth||y<0||y>innerHeight)return false;
      let hit=document.elementFromPoint(x,y);
      while(hit?.shadowRoot){const inner=hit.shadowRoot.elementFromPoint(x,y);if(!inner||inner===hit)break;hit=inner;}
      return !hit||!element.contains(hit);
    }).map(element=>element.id||element.textContent?.trim()||element.tagName);
  }):[];
  evidence.push({state,...layout,occluded,...(bounds?{menu:bounds}:{})});
  expect.soft(layout.overflow,`${state}: page overflow`).toBeLessThanOrEqual(1);
  expect.soft(layout.clipped,`${state}: clipped button labels`).toEqual([]);
  expect.soft(occluded,`${state}: occluded menu controls`).toEqual([]);
  if(bounds){const viewport=target.viewportSize()!;expect.soft(bounds.x,`${state}: menu left`).toBeGreaterThanOrEqual(0);expect.soft(bounds.y,`${state}: menu top`).toBeGreaterThanOrEqual(0);expect.soft(bounds.x+bounds.width,`${state}: menu right`).toBeLessThanOrEqual(viewport.width+1);expect.soft(bounds.y+bounds.height,`${state}: menu bottom`).toBeLessThanOrEqual(viewport.height+1)}
}
async function save(info:TestInfo,evidence:Evidence[]):Promise<void>{await writeFile(info.outputPath('layout-evidence.json'),JSON.stringify(evidence,null,2))}

test('audits all settings pages and management menus at desktop, narrow and short sizes',async({},info)=>{
  const target=await context.newPage();const evidence:Evidence[]=[];
  try{
    await target.emulateMedia({reducedMotion:'reduce'});await target.goto(`chrome-extension://${extensionId}/options.html`);await expect(target.locator('#api-profile')).toHaveValue('default');
    const signature=pdfDocumentTranslationSessionBlockSignature(1,'Demonstration source',0);
    await target.evaluate(async(data)=>{await (globalThis as any).chrome.storage.local.set(data)},{pdfDocumentTranslationRetainedV1:[{targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:Date.now(),documentKey:pdfDocumentTranslationSessionDocumentKey('demonstration.pdf'),documentSignatures:[signature],blocks:[{signature,translatedText:'演示文本：用于检查文档库预览和菜单。'}],activity:'complete',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model')}]});
    for(const size of sizes){await target.setViewportSize(size);await target.emulateMedia({colorScheme:size.width===1360?'light':'dark'});
      for(const section of ['connection','translation','results','pages','cost','storage','support']){
        await target.locator(`[data-settings-target="${section}"]`).click();await inspect(target,`${size.width}-${size.height}-${section}`,evidence);await target.screenshot({path:info.outputPath(`${section}-${size.width}.png`)});
      }
      for(const [section,id,panel] of [['connection','profile-menu','.profile-menu-actions'],['storage','library-storage-tools',':scope > .disclosure-content']] as const){
        await target.locator(`[data-settings-target="${section}"]`).click();const details=target.locator(`#${id}`);await details.locator(':scope > summary').click();await inspect(target,`${size.width}-${size.height}-${id}`,evidence,details.locator(panel));await target.screenshot({path:info.outputPath(`${id}-${size.width}.png`)});await target.setViewportSize({width:300,height:300});
        await expect.poll(async()=>{if(await details.getAttribute('open')===null)return true;const box=await details.locator(panel).boundingBox();return Boolean(box&&box.x>=0&&box.y>=0&&box.x+box.width<=301&&box.y+box.height<=301)}).toBe(true);
        if(await details.getAttribute('open')===null){await expect(details.locator(panel)).toBeHidden();await inspect(target,`${id}-resized-closed`,evidence)}else await inspect(target,`${id}-resized`,evidence,details.locator(panel));await target.keyboard.press('Escape');await expect(details.locator(':scope > summary')).toBeFocused();await target.setViewportSize(size);
      }
      const row=target.locator('.library-entry').first();await row.locator('.library-menu > summary').click();await inspect(target,`${size.width}-${size.height}-document-menu`,evidence,row.locator('.library-actions'));await target.keyboard.press('Escape');
    }
    await target.locator('[data-settings-target="support"]').click();await target.locator('.support-disclosure > summary').first().click();await target.locator('#restart-onboarding').click();await inspect(target,'onboarding-short',evidence);await target.screenshot({path:info.outputPath('onboarding-short.png')});await target.locator('#onboarding-skip').click();
  }finally{await save(info,evidence);await target.close()}
});

test('audits popup expansion and capture permission UI without clipping controls',async({},info)=>{
  const target=await context.newPage();const permission=await context.newPage();const evidence:Evidence[]=[];
  try{
    const source=await context.serviceWorkers()[0]!.evaluate(async()=>((await (globalThis as any).chrome.tabs.query({url:'https://www.overleaf.com/project/pi-translator-e2e'}))[0]));
    await target.addInitScript(tab=>{(globalThis as any).chrome.tabs.query=async()=>[tab]},source);await target.emulateMedia({reducedMotion:'reduce'});await target.goto(`chrome-extension://${extensionId}/popup.html`);await expect(target.locator('#quick-actions')).not.toHaveAttribute('data-primary','loading');
    for(const size of [{width:320,height:600},{width:300,height:420}]){await target.setViewportSize(size);await inspect(target,`popup-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`popup-${size.width}.png`)});await target.locator('#popup-more-actions > summary').click();await target.locator('#popup-service-details > summary').click();await inspect(target,`popup-expanded-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`popup-expanded-${size.width}.png`),fullPage:true});await target.locator('#popup-more-actions > summary').click()}
    await permission.setViewportSize({width:260,height:120});await permission.goto(`chrome-extension://${extensionId}/web-capture-permission.html`);await inspect(permission,'capture-permission',evidence);await permission.screenshot({path:info.outputPath('capture-permission.png')});
  }finally{await save(info,evidence);await target.close();await permission.close()}
});

test('audits PDF empty, reading and full translation states with short-window menus',async({},info)=>{
  const target=await context.newPage();const evidence:Evidence[]=[];
  try{
    await target.emulateMedia({reducedMotion:'reduce'});await target.goto(`chrome-extension://${extensionId}/pdf.html`);
    await target.setViewportSize({width:300,height:420});await inspect(target,'pdf-empty',evidence);await target.screenshot({path:info.outputPath('pdf-empty-short.png')});
    await target.locator('#file-input').setInputFiles({name:'演示文本-用于检查长文件名在工具栏中是否被挤压.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Demonstration: Sparse samples reconstruct an image.','Demonstration: We use a fixed test set.')});
    for(const size of sizes){await target.setViewportSize(size);await clickPdfReaderAction(target,'fit-width');await expect.poll(()=>target.locator('#document-stage').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(0);await inspect(target,`pdf-reading-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`pdf-reading-${size.width}.png`)});}
    const readerMore=target.locator('#pdf-reader-menu');await readerMore.locator(':scope > summary').click();await inspect(target,'pdf-reader-more-short',evidence,readerMore.locator(':scope > div'));await target.screenshot({path:info.outputPath('pdf-reader-more-short.png')});await target.keyboard.press('Escape');
    await target.locator('#translate-document').click();await expect(target.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/^(idle|preparing)$/);await inspect(target,'pdf-ready-short',evidence);await target.screenshot({path:info.outputPath('pdf-ready-short.png')});
    await target.locator('#pdf-document-trial > summary').click();await target.locator('#pdf-document-trial-start').click();await expect(target.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');await target.locator('#pdf-document-translation-view-reading').click();await inspect(target,'pdf-paused-short',evidence);await target.screenshot({path:info.outputPath('pdf-paused-short.png')});
    const more=target.locator('#pdf-document-translation-copy-menu');await more.locator(':scope > summary').click();await inspect(target,'pdf-more-short',evidence,more.locator(':scope > div'));await target.keyboard.press('Escape');await target.locator('#pdf-document-translation-primary').click();await expect(target.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await inspect(target,'pdf-complete-short',evidence);await target.screenshot({path:info.outputPath('pdf-complete-short.png')});
  }finally{await save(info,evidence);await target.close()}
});

test('audits native sidebar translating, partial error, complete and correction states',async({},info)=>{
  const target=await context.newPage();const sender=await context.newPage();const evidence:Evidence[]=[];
  try{
    await target.emulateMedia({reducedMotion:'reduce'});await target.goto(`chrome-extension://${extensionId}/sidepanel.html`);await sender.goto(`chrome-extension://${extensionId}/popup.html`);const tabId=await sender.evaluate(async()=>(await (globalThis as any).chrome.tabs.getCurrent()).id);
    for(const size of sizes.slice(1)){await target.setViewportSize(size);await target.emulateMedia({colorScheme:'dark'});
      const base={tabId,requestId:`audit-${size.width}`,targetLanguage:'zh-CN',sourceText:'Demonstration text: The reconstruction loss is $L=\\sum_i(x_i-y_i)^2$. This example checks the layout of the translation panel.',pageUrl:'https://www.overleaf.com/demonstration.pdf',sourceLabel:'演示文本-一个较长的科研文档名称.pdf',pageNumber:2,startedAt:Date.now()};
      for(const status of ['translating','error','complete']){
        const payload={...base,status,partialText:status==='translating'?'演示文本：正在接收译文。':status==='error'?'演示文本：已经收到的部分译文。':undefined,...(status==='error'?{error:{code:'REQUEST_TIMEOUT',message:'请求超时，请检查接口后继续。',retryable:true}}:{}),...(status==='complete'?{result:{requestId:base.requestId,originalText:base.sourceText,translatedText:'演示文本：重建损失为 $L=\\sum_i(x_i-y_i)^2$。\n\n这段内容用于检查侧栏布局。',warnings:[],latencyMs:1200,completedAt:Date.now()}}:{})};
        await sender.evaluate(async(payload)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload})},payload);await expect(target.locator('#session')).toBeVisible();await inspect(target,`sidepanel-${status}-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`sidepanel-${status}-${size.width}.png`)});await openTranslationMore(target);await inspect(target,`sidepanel-menu-${status}-${size.width}`,evidence,target.locator('.panel-menu'));await target.screenshot({path:info.outputPath(`sidepanel-menu-${status}-${size.width}.png`)});await target.keyboard.press('Escape');
      }
      await openTranslationMore(target);await target.locator('#correct').click();await inspect(target,`correction-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`correction-${size.width}.png`)});await target.keyboard.press('Escape');
      await sender.evaluate(async(payload)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload})},{...base,status:'translating',partialText:'演示文本：正在接收译文。'});
      await expect(target.locator('#panel-more')).not.toHaveClass(/in-footer/);await openTranslationMore(target);
      await sender.evaluate(async(payload)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload})},{...base,status:'complete',result:{requestId:base.requestId,originalText:base.sourceText,translatedText:'演示文本：翻译完成。',warnings:[],latencyMs:1200,completedAt:Date.now()}});
      await expect(target.locator('#panel-more')).toHaveClass(/in-footer/);await expect(target.locator('#panel-more')).not.toHaveAttribute('open');await expect(target.locator('#panel-more > summary')).toBeFocused();
    }
  }finally{await save(info,evidence);await target.close();await sender.close()}
});

test('audits webpage reading controls and their coexistence with selected text',async({},info)=>{
  const target=await context.newPage();const evidence:Evidence[]=[];
  try{
    await setStoredSidebarMode('browser');await page.goto(ARTICLE_FIXTURE_URL);const tab=await context.serviceWorkers()[0]!.evaluate(async(url)=>(await (globalThis as any).chrome.tabs.query({url}))[0],ARTICLE_FIXTURE_URL);
    await target.goto(`chrome-extension://${extensionId}/sidepanel.html`);await target.emulateMedia({reducedMotion:'reduce'});await page.bringToFront();await expect(target.locator('#bilingual-page-control')).toBeVisible();
    for(const size of sizes.slice(1)){await target.setViewportSize(size);await inspect(target,`web-sidebar-idle-${size.width}`,evidence);await target.screenshot({path:info.outputPath(`web-sidebar-idle-${size.width}.png`)});}
    await target.evaluate(async(tabId)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}})},tab.id);await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成');
    await selectElementText('#article-intro');await context.serviceWorkers()[0]!.evaluate(async(tabId)=>{await (globalThis as any).chrome.tabs.sendMessage(tabId,{type:'TRIGGER_TRANSLATE'})},tab.id);await expect(target.locator('#session')).toBeVisible();
    await inspect(target,'web-sidebar-complete-short',evidence);await target.screenshot({path:info.outputPath('web-sidebar-complete-short.png')});
    const readingMore=target.locator('#bilingual-page-copy-menu');await readingMore.locator(':scope > summary').click();await inspect(target,'web-sidebar-more-short',evidence,readingMore.locator(':scope > div'));await target.screenshot({path:info.outputPath('web-sidebar-more-short.png')});await target.keyboard.press('Escape');
    const control=page.locator('#pi-translator-bilingual-page-control');await control.locator('button[data-action="compact"]').click();await page.setViewportSize({width:300,height:420});await inspect(page,'web-control-short',evidence,control.locator('.bar'));await page.screenshot({path:info.outputPath('web-control-short.png')});
  }finally{await save(info,evidence);await target.close()}
});
