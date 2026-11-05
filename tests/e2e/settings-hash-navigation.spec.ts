import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
test('routes same-document settings hashes without losing drafts or writing settings',async()=>{
  const page=await context.newPage(),worker=context.serviceWorkers()[0]!,calls=textRequests.length+visionRequests.length;
  try{
    await page.goto(`chrome-extension://${extensionId}/options.html#connection`);await expect(page.locator('#model')).toHaveValue('e2e-model');
    const before=await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null));
    await page.locator('#model').fill('unsaved-model-draft');
    await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(page.locator('#retained-library-search')).toBeVisible();
    await page.goto(`chrome-extension://${extensionId}/options.html#cost`);await expect(page.locator('#settings-cost')).toHaveAttribute('open','');await expect(page.locator('#model')).toHaveValue('unsaved-model-draft');
    await page.setViewportSize({width:360,height:780});await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(page.locator('#retained-library-search')).toBeVisible();
    await page.goBack();await expect(page.locator('#settings-cost')).toBeVisible();await expect(page.locator('#model')).toHaveValue('unsaved-model-draft');
    expect(await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null))).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await page.close()}
});
