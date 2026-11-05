import {ARTICLE_FIXTURE_URL,context,expect,extensionId,installEdgeExtensionHooks,page,selectElementText,test,textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
for(const mode of ['off','allowlist','all-sites'] as const)test(`first-use guide preserves an existing ${mode} website choice`,async()=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage(),saved=await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;return v});
 try{
  await worker.evaluate(async({saved,mode})=>await(globalThis as any).chrome.storage.local.set({extensionSettings:{...saved,onboardingCompleted:false,generalPageMode:mode,siteAllowlist:['keep.example']}}),{saved,mode});
  await options.goto(`chrome-extension://${extensionId}/options.html`);await expect(options.locator('#onboarding-dialog')).toBeVisible();await expect(options.locator('#onboarding-web-access')).toBeHidden();
  const current=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);expect(current.generalPageMode).toBe(mode);expect(current.siteAllowlist).toEqual(['keep.example']);
 }finally{await options.close();await worker.evaluate(async v=>await(globalThis as any).chrome.storage.local.set({extensionSettings:v}),saved)}
});
for(const decision of ['deny','allow','changed'] as const)test(`first-use website access safely handles ${decision}`,async({},info)=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage();
 const saved=await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local;return (await s.get('extensionSettings')).extensionSettings});
 try{
  await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,settings=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...settings,onboardingCompleted:false,generalPageMode:'on-demand',siteAllowlist:['keep.example']}})});
  await options.addInitScript(decision=>{const g=globalThis as any;g.webPermissionCalls=[];g.chrome.permissions.request=(request:any)=>{g.webPermissionCalls.push(request);if(decision==='changed')return new Promise(resolve=>{g.releaseWebPermission=()=>resolve(true)});return Promise.resolve(decision==='allow')}},decision);
  await options.setViewportSize({width:360,height:640});await options.goto(`chrome-extension://${extensionId}/options.html`);
  const dialog=options.locator('#onboarding-dialog');await expect(dialog).toBeVisible();await expect(options.locator('#onboarding-enable-web')).toBeVisible();
  if(decision==='deny'){await dialog.screenshot({path:info.outputPath('first-use-web-permission-360.png')});expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);const next=(await options.locator('#onboarding-next').boundingBox())!,enable=(await options.locator('#onboarding-enable-web').boundingBox())!,step=(await options.locator('[data-onboarding-step="1"]').boundingBox())!;expect(next.y+next.height).toBeLessThanOrEqual(640);expect(enable.y+enable.height).toBeLessThanOrEqual(step.y+step.height+1)}
  const calls=textRequests.length;await options.locator('#onboarding-enable-web').click();
  if(decision==='changed'){
   await expect.poll(()=>options.evaluate(()=>(globalThis as any).webPermissionCalls.length)).toBe(1);
   await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,generalPageMode:'allowlist',siteAllowlist:['changed.example']}})});
   await options.evaluate(()=>(globalThis as any).releaseWebPermission());
  }
  await expect(options.locator('#onboarding-web-status')).toContainText(decision==='allow'?'刷新已打开':decision==='deny'?'未授权':'设置已变化');
  const settings=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  expect(settings.generalPageMode).toBe(decision==='allow'?'all-sites':decision==='deny'?'on-demand':'allowlist');
  expect(settings.siteAllowlist).toEqual([decision==='changed'?'changed.example':'keep.example']);
  expect(settings.apiProfiles).toEqual(saved.apiProfiles);expect(textRequests.length).toBe(calls);
  expect(await options.evaluate(()=>(globalThis as any).webPermissionCalls)).toEqual([{origins:['http://*/*','https://*/*']}]);
  if(decision==='allow'){await options.locator('#onboarding-skip').click();await expect(dialog).not.toBeVisible();const after=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);expect(after.generalPageMode).toBe('all-sites');expect(after.siteAllowlist).toEqual(['keep.example']);expect(textRequests.length).toBe(calls)}
 }finally{await options.close();await worker.evaluate(async settings=>await(globalThis as any).chrome.storage.local.set({extensionSettings:settings}),saved)}
});

test('ordinary page selection displays the button without sending a translation request',async()=>{
 const worker=context.serviceWorkers()[0]!;
 const saved=await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,generalPageMode:'all-sites',sidebarMode:'floating'}});return v});
 try{
  await page.goto(ARTICLE_FIXTURE_URL);
  await worker.evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({url}))[0];await c.scripting.executeScript({target:{tabId:tab.id},files:['content-scripts/general.js']})},ARTICLE_FIXTURE_URL);
  const before=textRequests.length;await selectElementText('#article-intro');
  const trigger=page.locator('#tex-selection-translator-root .trigger');await expect(trigger).toBeVisible();
  expect(textRequests.length).toBe(before);
  await trigger.click();await expect.poll(()=>textRequests.length).toBe(before+1);
 }finally{await worker.evaluate(async v=>await(globalThis as any).chrome.storage.local.set({extensionSettings:v}),saved)}
});
