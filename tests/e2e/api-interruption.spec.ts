import {context,expect,extensionId,installEdgeExtensionHooks,page,replaceStoredApiKeys,selectElementText,test,textRequests,visionRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('keeps the API draft and sends no request when access is denied',async()=>{
 const options=await context.newPage();
 try{
  await options.addInitScript(()=>{(globalThis as any).chrome.permissions.request=async()=>false});
  await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
  await expect(options.locator('#model')).toHaveValue('e2e-model');
  await options.locator('#api-key').fill('offline-permission-draft');
  const before=textRequests.length+visionRequests.length;
  await options.locator('#refresh-models').click();
  await expect(options.locator('#connection-feedback')).toContainText('未获得');
  await expect(options.locator('#text-connection-state')).toHaveText('未通过测试');
  await expect(options.locator('#api-key')).toHaveValue('offline-permission-draft');
  expect(textRequests.length+visionRequests.length).toBe(before);
 }finally{await options.close({runBeforeUnload:false})}
});

test('offers manual validation after a model-list network failure without sending another request',async({},info)=>{
 const options=await context.newPage();
 try{
  await options.addInitScript(()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>{if(message.type==='LIST_API_MODELS'){g.listCalls=(g.listCalls??0)+1;return Promise.resolve({ok:false,error:{code:'NETWORK_ERROR',message:'offline fixture',retryable:true}})}return send(message,...args)}});
  await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
  await expect(options.locator('#model')).toHaveValue('e2e-model');
  await options.locator('#api-key').fill('offline-network-draft');
  const before=textRequests.length+visionRequests.length;
  await options.locator('#refresh-models').click();
  await expect(options.locator('#connection-feedback')).toContainText('网络恢复后可重试');
  await expect(options.locator('#connection-more')).toHaveAttribute('open','');
  await expect(options.locator('#test-connection')).toBeVisible();
  await expect(options.locator('#api-key')).toHaveValue('offline-network-draft');
  await options.setViewportSize({width:360,height:700});
  await options.locator('#connection-feedback').scrollIntoViewIfNeeded();
  await options.screenshot({path:info.outputPath('network-error-360.png')});
  await options.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await options.screenshot({path:info.outputPath('network-error-360-dark.png')});
  expect(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await options.evaluate(()=>(globalThis as any).listCalls)).toBe(1);
  expect(textRequests.length+visionRequests.length).toBe(before);
 }finally{await options.close({runBeforeUnload:false})}
});

test('can reopen configuration after closing it without discarding the original selection',async()=>{
 await replaceStoredApiKeys({'vision-e2e':'e2e-vision-key'});
 const source='A configured API should resume this selected translation automatically.';
 const matchingBefore=textRequests.filter(request=>JSON.stringify(request).includes(source)).length;
 const before=textRequests.length+visionRequests.length;
 await selectElementText('#recovery-source');
 const overlay=page.locator('#tex-selection-translator-root');
 await overlay.locator('.trigger').click();
 await expect(overlay.locator('.error')).toContainText('API Key');
 let opened=context.waitForEvent('page');
 await overlay.getByRole('button',{name:'配置 API'}).click();
 const first=await opened;
 await expect(first.locator('#settings-recovery-banner')).toBeVisible();
 await first.close();
 await expect(overlay.getByRole('button',{name:'重新打开设置'})).toBeVisible();
 opened=context.waitForEvent('page');
 await overlay.getByRole('button',{name:'重新打开设置'}).click();
 const second=await opened;
 try{
  await expect(second.locator('#settings-recovery-banner')).toBeVisible();
  await expect(second.locator('#settings-recovery-description')).toContainText('无需重新选择');
  expect(textRequests.length+visionRequests.length).toBe(before);
  await second.locator('#api-key').fill('offline-recovery-key');
  await second.locator('#refresh-models').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await expect.poll(()=>textRequests.filter(request=>JSON.stringify(request).includes(source)).length).toBe(matchingBefore+1);
 }finally{await second.close()}
});

test('reuses the open recovery settings page and keeps its unsaved key',async()=>{
 await replaceStoredApiKeys({'vision-e2e':'e2e-vision-key'});
 await page.reload();
 await page.locator('#recovery-source').evaluate(element=>{element.textContent='A different source for recovering an open settings draft.'});
 const before=textRequests.length+visionRequests.length;
 await selectElementText('#recovery-source');
 const overlay=page.locator('#tex-selection-translator-root');
 await overlay.locator('.trigger').click();
 await expect(overlay.locator('.error')).toContainText('API Key');
 const opened=context.waitForEvent('page');
 await overlay.getByRole('button',{name:'配置 API'}).click();
 const settings=await opened;
 try{
  await expect(settings.locator('#settings-recovery-banner')).toBeVisible();
  await settings.locator('#api-key').fill('unsaved-recovery-draft');
  const pageCount=context.pages().length;
  await page.bringToFront();
  await overlay.getByRole('button',{name:'重新打开设置'}).click();
  await expect.poll(async()=>settings.evaluate(()=>document.visibilityState)).toBe('visible');
  expect(context.pages().length).toBe(pageCount);
  await expect(settings.locator('#api-key')).toHaveValue('unsaved-recovery-draft');
  await expect(settings.locator('#settings-recovery-banner')).toBeVisible();
  expect(textRequests.length+visionRequests.length).toBe(before);
  await settings.locator('#refresh-models').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
 }finally{await settings.close({runBeforeUnload:false})}
});
