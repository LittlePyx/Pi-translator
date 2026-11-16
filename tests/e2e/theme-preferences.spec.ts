import {test,expect,context,page,extensionId,installEdgeExtensionHooks,selectElementText,ARTICLE_FIXTURE_URL,OVERLEAF_FIXTURE_URL,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
test('synchronizes appearance across open surfaces while preserving API drafts and webpage theme',async({},info)=>{
 const worker=context.serviceWorkers()[0]!;
 const before=await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null));
 const calls=textRequests.length+visionRequests.length;
 const options=await context.newPage(),popup=await context.newPage(),reader=await context.newPage(),side=await context.newPage();
 try{
  await options.goto('chrome-extension://'+extensionId+'/options.html#connection');
  await options.locator('#api-key').fill('appearance-draft');

  await popup.goto('chrome-extension://'+extensionId+'/popup.html');
  await reader.goto('chrome-extension://'+extensionId+'/pdf.html');
  await side.goto('chrome-extension://'+extensionId+'/sidepanel.html');
  const surfaces=[options,popup,reader,side];
  for(const surface of surfaces)await surface.emulateMedia({colorScheme:'light'});
  for(const mode of ['dark','light'] as const){
   await popup.locator('[data-theme-choice]').selectOption(mode);
   for(const surface of surfaces){
    await expect(surface.locator('html')).toHaveAttribute('data-pi-theme',mode);
    await expect.poll(()=>surface.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--pi-surface').trim())).toBe(mode==='dark'?'#222222':'#ffffff');
   }
   await expect(options.locator('#api-key')).toHaveValue('appearance-draft');
   await popup.setViewportSize({width:360,height:760});
   await popup.screenshot({path:info.outputPath('popup-'+mode+'.png')});
  }
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','dark');document.body.style.backgroundColor='rgb(10,10,10)'});
  await selectElementText('#source');
  const overlay=page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-theme','light');
  await popup.reload();
  await expect(popup.locator('[data-theme-choice]')).toHaveValue('light');
  await popup.locator('[data-theme-choice]').selectOption('auto');
  await reader.emulateMedia({colorScheme:'dark'});
  await expect(reader.locator('html')).toHaveAttribute('data-pi-theme','dark');
  await reader.emulateMedia({colorScheme:'light'});
  await expect(reader.locator('html')).toHaveAttribute('data-pi-theme','light');
  await expect(overlay).toHaveAttribute('data-pi-theme','dark');
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','light');document.body.style.backgroundColor='white'});
  await expect(overlay).toHaveAttribute('data-pi-theme','light');
  await options.evaluate(()=>{location.hash='translation'});
  await options.locator('[data-theme-choice]').selectOption('dark');
  await expect(popup.locator('[data-theme-choice]')).toHaveValue('dark');
  await page.goto(ARTICLE_FIXTURE_URL);
  await worker.evaluate(async url=>{const c=(globalThis as any).chrome;const tab=(await c.tabs.query({url}))[0];await c.scripting.executeScript({target:{tabId:tab.id},files:['content-scripts/general.js']})},ARTICLE_FIXTURE_URL);
  const tabId=await worker.evaluate(async url=>(await (globalThis as any).chrome.tabs.query({url}))[0].id,ARTICLE_FIXTURE_URL);
  await popup.evaluate(async tabId=>(globalThis as any).chrome.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId,targetLanguage:'zh-CN'}}),tabId);
  const control=page.locator('#pi-translator-bilingual-page-control');
  await expect(control.locator('output')).toContainText('已完成');
  await expect(control).toHaveAttribute('data-pi-theme','dark');
  const completedCalls=textRequests.length+visionRequests.length;
  await popup.locator('[data-theme-choice]').selectOption('light');
  await expect(control).toHaveAttribute('data-pi-theme','light');
  const after=await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null));
  expect(after.extensionSettings).toEqual(before.extensionSettings);
  expect(completedCalls).toBeGreaterThan(calls);
  expect(textRequests.length+visionRequests.length).toBe(completedCalls);
 }finally{
  for(const surface of [options,popup,reader,side])await surface.close({runBeforeUnload:false});
  await worker.evaluate(async previous=>{const s=(globalThis as any).chrome.storage.local;if('piThemePreference' in previous)await s.set({piThemePreference:previous.piThemePreference});else await s.remove('piThemePreference')},before);
 }
});


test('applies all reading palettes in both modes with readable text and no settings writes',async({},info)=>{
 const worker=context.serviceWorkers()[0]!;
 const before=await worker.evaluate(()=>(globalThis as any).chrome.storage.local.get(null));
 const options=await context.newPage(),popup=await context.newPage();
 const calls=textRequests.length+visionRequests.length;
 try{
  await options.setViewportSize({width:860,height:850});
  await options.goto('chrome-extension://'+extensionId+'/options.html#translation');
  await popup.goto('chrome-extension://'+extensionId+'/popup.html');
  await options.locator('#appearance-palettes > summary').click();
  await page.goto(OVERLEAF_FIXTURE_URL);
  await selectElementText('#source');
  for(const palette of ['neutral','blue','graphite','paper','sage','teal','violet','rose']){
   await options.locator('[data-palette-choice="'+palette+'"]').click();
   for(const mode of ['light','dark']){
    await popup.locator('[data-theme-choice]').selectOption(mode);
    await expect(page.locator('#tex-selection-translator-root')).toHaveAttribute('data-pi-palette',palette);
    for(const surface of [options,popup]){
     await expect(surface.locator('html')).toHaveAttribute('data-pi-palette',palette);
     await expect(surface.locator('html')).toHaveAttribute('data-pi-theme',mode);
     const ratios=await surface.evaluate(()=>{
      const css=getComputedStyle(document.documentElement);
      const luminance=(color:string)=>{
       const hex=color.trim().slice(1);
       const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
       return rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
      };
      const contrast=(a:string,b:string)=>{const x=luminance(css.getPropertyValue(a)),y=luminance(css.getPropertyValue(b));return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      return [contrast('--pi-text','--pi-surface'),contrast('--pi-muted','--pi-surface'),contrast('--pi-primary-text','--pi-primary')];
     });
     for(const ratio of ratios)expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await options.locator('.palette-options').screenshot({path:info.outputPath(palette+'-'+mode+'.png')});
    const trigger=page.locator('#tex-selection-translator-root .trigger');
    await expect(trigger).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(trigger).toHaveCSS('box-shadow','none');
    await trigger.hover();
    await expect(trigger).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    expect(await trigger.evaluate(el=>getComputedStyle(el,'::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await trigger.screenshot({path:info.outputPath('trigger-'+palette+'-'+mode+'.png')});
   }
  }
  await popup.reload();
  await expect(popup.locator('html')).toHaveAttribute('data-pi-palette','rose');
  await worker.evaluate(()=>(globalThis as any).chrome.storage.local.set({piPalettePreference:'unsupported'}));
  await expect(options.locator('[data-palette-choice="neutral"]')).toHaveAttribute('aria-pressed','true');
  const after=await worker.evaluate(()=>(globalThis as any).chrome.storage.local.get(null));
  expect(after.extensionSettings).toEqual(before.extensionSettings);
  expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{
  await options.close({runBeforeUnload:false});await popup.close();
  await worker.evaluate(async previous=>{const s=(globalThis as any).chrome.storage.local;for(const key of ['piThemePreference','piPalettePreference'])if(key in previous)await s.set({[key]:previous[key]});else await s.remove(key)},before);
 }
});
