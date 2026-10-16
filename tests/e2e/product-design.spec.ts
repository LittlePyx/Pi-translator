import {clickPdfReaderAction} from './support/translation-controls';
import {ARTICLE_FIXTURE_URL,context,createMultilineTextPdf,expect,extensionId,installEdgeExtensionHooks,page,selectElementText,test} from './support/edge-extension-fixture';
import {openTranslationMore} from './support/translation-controls';
import type {Locator} from '@playwright/test';
async function captureOverlay(overlay:Locator,path:string):Promise<void>{
  const clip=await overlay.locator('.surface').evaluate(surface=>{
    const boxes=[surface.getBoundingClientRect(),...surface.querySelectorAll('details.more[open] .menu')].map(element=>element instanceof Element?element.getBoundingClientRect():element);
    const x=Math.max(0,Math.min(...boxes.map(box=>box.left))-4),y=Math.max(0,Math.min(...boxes.map(box=>box.top))-4);
    return {x,y,width:Math.min(innerWidth,Math.max(...boxes.map(box=>box.right))+4)-x,height:Math.min(innerHeight,Math.max(...boxes.map(box=>box.bottom))+4)-y};
  });
  await overlay.page().screenshot({path,clip});
}
installEdgeExtensionHooks();
test('captures settings hierarchy in light, dark and narrow layouts',async({},testInfo)=>{
  const options=await context.newPage();
  try{
    await options.emulateMedia({reducedMotion:'reduce'});
    await options.setViewportSize({width:1360,height:1000});await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#api-profile')).toHaveValue('default');
    for(const section of ['connection','translation','results','pages','cost','storage','support']){
      await options.locator(`[data-settings-target="${section}"]`).click();
      await options.screenshot({path:testInfo.outputPath(`settings-${section}-light.png`),fullPage:true});
      await options.emulateMedia({colorScheme:'dark'});await options.screenshot({path:testInfo.outputPath(`settings-${section}-dark.png`),fullPage:true});await options.emulateMedia({colorScheme:'light'});
    }
    await options.locator('[data-settings-target="connection"]').click();
    await expect(options.locator('#add-profile')).toBeHidden();await expect(options.locator('#clear-key')).toBeHidden();await expect(options.locator('#setup-qwen')).toBeHidden();
    const profileMenu=options.locator('#profile-menu');await profileMenu.locator('summary').click();await expect(options.locator('#add-profile')).toBeVisible();
    await options.screenshot({path:testInfo.outputPath('settings-profile-menu-light.png'),fullPage:true});
    await options.keyboard.press('Escape');await expect(profileMenu).not.toHaveAttribute('open');await expect(profileMenu.locator('summary')).toBeFocused();
    await profileMenu.locator('summary').click();await options.locator('#model').click();await expect(profileMenu).not.toHaveAttribute('open');
    await options.locator('#vision-setup-details > summary').click();await expect(options.locator('#setup-qwen')).toBeVisible();await options.screenshot({path:testInfo.outputPath('settings-vision-expanded-light.png'),fullPage:true});
    await options.locator('#vision-setup-details > summary').click();
    await options.locator('[data-settings-target="translation"]').click();await expect(options.locator('#style')).toBeHidden();await options.locator('#settings-translation details > summary').first().click();await options.screenshot({path:testInfo.outputPath('settings-translation-expanded-light.png'),fullPage:true});
    await options.locator('[data-settings-target="pages"]').click();await expect(options.locator('#open-shortcuts')).toBeHidden();await options.locator('#settings-pages details > summary').click();await options.screenshot({path:testInfo.outputPath('settings-pages-expanded-light.png'),fullPage:true});
    await options.locator('[data-settings-target="results"]').click();await options.locator('#settings-results .advanced-panel > summary').click();await options.screenshot({path:testInfo.outputPath('settings-results-expanded-light.png'),fullPage:true});
    await options.locator('[data-settings-target="support"]').click();await options.locator('#settings-support .support-disclosure > summary').first().click();await options.screenshot({path:testInfo.outputPath('settings-support-expanded-light.png'),fullPage:true});
    await options.locator('#restart-onboarding').click();await expect(options.locator('#onboarding-dialog')).toBeVisible();await options.screenshot({path:testInfo.outputPath('onboarding-light.png')});await options.locator('#onboarding-skip').click();
    await options.emulateMedia({colorScheme:'dark'});await options.locator('[data-settings-target="connection"]').click();
    await options.screenshot({path:testInfo.outputPath('settings-connection-dark.png'),fullPage:true});
    await options.setViewportSize({width:360,height:1000});
    await options.locator('.settings-section details[open]:not(#model-price-editor)').evaluateAll(details=>details.forEach(detail=>{(detail as HTMLDetailsElement).open=false}));
    for(const section of ['connection','translation','results','pages','cost','storage','support']){
      await options.locator(`[data-settings-target="${section}"]`).click();
      await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await options.screenshot({path:testInfo.outputPath(`settings-${section}-mobile-dark.png`),fullPage:true});
      await options.emulateMedia({colorScheme:'light'});await options.screenshot({path:testInfo.outputPath(`settings-${section}-mobile-light.png`),fullPage:true});await options.emulateMedia({colorScheme:'dark'});
    }
    for(const [section,disclosure] of [['connection','#vision-setup-details'],['results','#settings-results .advanced-panel'],['pages','#settings-pages details'],['support','#settings-support details:first-of-type']]){
      await options.locator(`[data-settings-target="${section}"]`).click();await options.locator(`${disclosure} > summary`).click();
      await expect.poll(()=>options.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await options.screenshot({path:testInfo.outputPath(`settings-${section}-mobile-expanded-dark.png`),fullPage:true});
    }
  }finally{await options.close()}
});
test('captures PDF reading, preflight and result cards without changing translation behavior',async({},testInfo)=>{
  const reader=await context.newPage();
  try{
    await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.setViewportSize({width:1360,height:1000});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'演示文本.pdf',mimeType:'application/pdf',buffer:createMultilineTextPdf(['Demonstration text','Image reconstruction from sparse measurements','','We reconstruct an image from a small set of measurements.','The model is trained with a reconstruction loss.','','The experiment uses a fixed measurement budget.','Results are reviewed alongside the original document.'],{fontSize:14,lineStep:26})});
    await clickPdfReaderAction(reader,'fit-width');await reader.locator('#translate-document').click();await clickPdfReaderAction(reader,'fit-width');
    await expect(reader.locator('#pdf-document-options-more')).not.toHaveAttribute('open');
    await expect(reader.locator('#pdf-document-request-limit')).toBeHidden();
    await expect(reader.locator('#pdf-document-review')).toBeHidden();
    const readingArea=await reader.locator('#pdf-document-translation-reader').boundingBox();expect(readingArea!.height).toBeGreaterThan(400);
    await reader.screenshot({path:testInfo.outputPath('pdf-preflight-light.png')});
    await expect(reader.locator('#pdf-document-trial-start')).toBeHidden();
    await reader.locator('#pdf-document-trial > summary').click();await reader.locator('#pdf-document-trial-start').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await reader.locator('#pdf-document-translation-view-reading').click();
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open');
    await expect(reader.locator('#pdf-document-trial')).not.toHaveAttribute('open');
    const progress=reader.locator('#pdf-document-translation-progress');await expect(progress).toBeVisible();
    const progressLayout=await reader.locator('.pdf-document-translation-overview').evaluate(element=>({available:element.clientWidth,progress:element.querySelector<HTMLElement>('.pdf-document-translation-progress')!.getBoundingClientRect().width}));
    expect(progressLayout.progress).toBeGreaterThanOrEqual(progressLayout.available-1);
    await reader.screenshot({path:testInfo.outputPath('pdf-reading-paused-light.png')});await reader.locator('#pdf-document-translation-view-compare').click();
    await reader.locator('#pdf-document-translation-primary').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.screenshot({path:testInfo.outputPath('pdf-compare-light.png')});
    await reader.locator('#pdf-document-translation-view-reading').click();await reader.screenshot({path:testInfo.outputPath('pdf-reading-light.png')});
    await reader.emulateMedia({colorScheme:'dark'});await reader.screenshot({path:testInfo.outputPath('pdf-reading-dark.png')});
    await reader.setViewportSize({width:360,height:1000});await reader.screenshot({path:testInfo.outputPath('pdf-reading-mobile-dark.png')});
  }finally{await reader.close()}
});
test('captures the quick popup and the in-page translation reading surface',async({},testInfo)=>{
  const popup=await context.newPage();
  try{
    await popup.emulateMedia({reducedMotion:'reduce'});
    const sourceTab=await context.serviceWorkers()[0]!.evaluate(async()=>{const tabs=await (globalThis as any).chrome.tabs.query({url:'https://www.overleaf.com/project/pi-translator-e2e'});return tabs[0]});
    await popup.addInitScript((sourceTab)=>{(globalThis as any).chrome.tabs.query=async()=>[sourceTab]},sourceTab);
    await popup.setViewportSize({width:360,height:900});await popup.goto(`chrome-extension://${extensionId}/popup.html`);await expect(popup.locator('#quick-actions')).not.toHaveAttribute('data-primary','loading');
    await expect(popup.locator('#popup-service-details')).not.toHaveAttribute('open');
    await expect(popup.locator('#feature-guide')).toBeHidden();
    await expect(popup.locator('#api-profile-field')).toBeHidden();await expect(popup.locator('#site-control')).toBeHidden();
    await expect(popup.locator('#open-web-region')).toBeHidden();await expect(popup.locator('#open-library')).toBeVisible();
    expect(await popup.locator('main').evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(320);
    await popup.locator('main').screenshot({path:testInfo.outputPath('popup-light.png')});await popup.emulateMedia({colorScheme:'dark'});await popup.locator('main').screenshot({path:testInfo.outputPath('popup-dark.png')});
    await popup.locator('#popup-more-actions > summary').click();await expect(popup.locator('#api-profile-field')).toBeHidden();await popup.locator('main').screenshot({path:testInfo.outputPath('popup-more-dark.png')});await popup.emulateMedia({colorScheme:'light'});await popup.locator('main').screenshot({path:testInfo.outputPath('popup-more-light.png')});await popup.emulateMedia({colorScheme:'dark'});
    await popup.locator('#popup-service-details > summary').click();await expect(popup.locator('#text-api-status')).toBeVisible();
    await popup.locator('main').screenshot({path:testInfo.outputPath('popup-details-dark.png')});
    await popup.emulateMedia({colorScheme:'light'});await popup.locator('main').screenshot({path:testInfo.outputPath('popup-details-light.png')});
    const opened=context.waitForEvent('page');await popup.locator('#open-library').click();const library=await opened;await expect(library.locator('#settings-storage')).toBeVisible();await expect(library.locator('#retained-library-search')).toBeFocused();await library.close();
  }finally{await popup.close()}
  await page.setViewportSize({width:1200,height:850});await selectElementText('#source');const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await expect(overlay.locator('.body')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('translation-card-light.png')});
  await captureOverlay(overlay,testInfo.outputPath('translation-card-compact-light.png'));
  await expect(overlay.locator('.correction-action')).toBeHidden();await openTranslationMore(overlay);await expect(overlay.locator('.correction-action')).toBeVisible();await captureOverlay(overlay,testInfo.outputPath('translation-card-more-light.png'));await page.keyboard.press('Escape');
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.evaluate(()=>{document.body.style.backgroundColor='#191919';document.body.style.color='#ededed'});await expect(overlay).toHaveAttribute('data-pi-theme','dark');await captureOverlay(overlay,testInfo.outputPath('translation-card-compact-dark.png'));await openTranslationMore(overlay);await captureOverlay(overlay,testInfo.outputPath('translation-card-more-dark.png'));await page.keyboard.press('Escape');await page.setViewportSize({width:360,height:700});await captureOverlay(overlay,testInfo.outputPath('translation-card-mobile-dark.png'));await page.setViewportSize({width:1200,height:850});await page.emulateMedia({colorScheme:'light'});await page.evaluate(()=>{document.body.style.backgroundColor='#ffffff';document.body.style.color='#202020'});await expect(overlay).toHaveAttribute('data-pi-theme','light');
  await overlay.getByTitle('在页面侧栏中显示').click();await expect(overlay).toHaveAttribute('data-pi-view','sidebar');await overlay.locator('.surface').screenshot({path:testInfo.outputPath('floating-sidebar-light.png')});await openTranslationMore(overlay);await overlay.locator('.surface').screenshot({path:testInfo.outputPath('floating-sidebar-more-light.png')});await page.keyboard.press('Escape');
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.evaluate(()=>{document.body.style.backgroundColor='#191919';document.body.style.color='#ededed'});await expect(overlay).toHaveAttribute('data-pi-theme','dark');await overlay.locator('.surface').screenshot({path:testInfo.outputPath('floating-sidebar-dark.png')});await openTranslationMore(overlay);await overlay.locator('.surface').screenshot({path:testInfo.outputPath('floating-sidebar-more-dark.png')});await page.keyboard.press('Escape');
  await page.setViewportSize({width:360,height:700});await expect.poll(()=>overlay.locator('.surface').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await overlay.locator('.surface').screenshot({path:testInfo.outputPath('floating-sidebar-mobile-dark.png')});await page.emulateMedia({colorScheme:'light'});
  await page.goto(ARTICLE_FIXTURE_URL);
  const articlePopup=await context.newPage();
  try{
    await articlePopup.emulateMedia({reducedMotion:'reduce'});
    const articleTab=await context.serviceWorkers()[0]!.evaluate(async(url)=>{const tabs=await (globalThis as any).chrome.tabs.query({url});return tabs[0]},ARTICLE_FIXTURE_URL);
    await articlePopup.addInitScript((tab)=>{(globalThis as any).chrome.tabs.query=async()=>[tab]},articleTab);
    await articlePopup.setViewportSize({width:360,height:900});await articlePopup.goto(`chrome-extension://${extensionId}/popup.html`);await expect(articlePopup.locator('#quick-actions')).toHaveAttribute('data-primary','article');
    await expect(page.locator('#pi-translator-bilingual-page-launcher')).toBeVisible();await page.screenshot({path:testInfo.outputPath('web-launcher-light.png')});
    await articlePopup.locator('main').screenshot({path:testInfo.outputPath('popup-web-light.png')});
    await articlePopup.evaluate(async(tabId)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}})},articleTab.id);
    await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成 7/7');await page.screenshot({path:testInfo.outputPath('web-bilingual-light.png')});
    const compact=page.locator('#pi-translator-bilingual-page-control button[data-action="compact"]');await compact.click();await page.screenshot({path:testInfo.outputPath('web-control-expanded-light.png')});
  }finally{await articlePopup.close()}
});

test('captures a readable native side panel with preserved math in both themes',async({},testInfo)=>{
  const sidePanel=await context.newPage();const sender=await context.newPage();
  try{
    await sidePanel.emulateMedia({reducedMotion:'reduce'});
    await sidePanel.setViewportSize({width:390,height:900});await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-empty-light.png')});
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId=await sender.evaluate(async()=>(await (globalThis as any).chrome.tabs.getCurrent()).id as number);
    const sourceText='Demonstration text: The reconstruction loss is defined as $L=\\sum_i(x_i-y_i)^2$. The model minimizes this objective during training.';
    await sender.evaluate(async(payload)=>{await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload})},{
      tabId,targetLanguage:'zh-CN',requestId:'design-native-result',sourceText,pageUrl:'https://www.overleaf.com/demonstration.pdf',pageNumber:2,sourceLabel:'演示文本.pdf',status:'complete',startedAt:Date.now()-1800,
      result:{requestId:'design-native-result',originalText:sourceText,translatedText:'演示文本：重建损失定义为 $L=\\sum_i(x_i-y_i)^2$。\n\n模型在训练过程中最小化这一目标函数。',warnings:[],latencyMs:1800,completedAt:Date.now()},
    });
    await expect(sidePanel.locator('#translation-text')).toContainText('演示文本');await expect(sidePanel.locator('#translation-text math')).toBeVisible();
    await expect(sidePanel.locator('#correct')).toBeHidden();await expect(sidePanel.locator('#formula-view')).toBeHidden();await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-light.png')});
    await openTranslationMore(sidePanel);await expect(sidePanel.locator('#correct')).toBeVisible();await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-more-light.png')});await sidePanel.keyboard.press('Escape');await expect(sidePanel.locator('#panel-more > summary')).toBeFocused();
    await sidePanel.emulateMedia({colorScheme:'dark'});await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-dark.png')});await openTranslationMore(sidePanel);await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-more-dark.png')});await sidePanel.keyboard.press('Escape');
    await sidePanel.setViewportSize({width:360,height:900});await expect.poll(()=>sidePanel.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-mobile-dark.png')});await openTranslationMore(sidePanel);await sidePanel.setViewportSize({width:300,height:420});await sidePanel.screenshot({path:testInfo.outputPath('sidepanel-short-more-dark.png')});await expect(sidePanel.locator('.panel-menu')).toBeInViewport();
  }finally{await sidePanel.close();await sender.close()}
});
