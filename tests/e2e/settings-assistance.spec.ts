import {context, expect, extensionId, installEdgeExtensionHooks, test, textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('continues in the same page and restores only non-secret progress after reopening', async ({}, info) => {
  const worker=context.serviceWorkers()[0]!,saved=await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  let page=await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,onboardingCompleted:false}}),saved);
    await page.setViewportSize({width:360,height:640});await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('[name="onboarding-purpose-choice"][value="research"]').check();
    await page.locator('#onboarding-research-field').fill('量子材料');
    await page.locator('#onboarding-next').click();
    await page.locator('#onboarding-preset').selectOption('custom');
    await page.locator('#onboarding-base-url').fill('https://private.example/v1');
    await page.locator('#onboarding-api-key').fill('private-test-key');
    await page.locator('#onboarding-later').click();
    await expect(page.locator('#onboarding-later-panel')).toContainText('Key、接口地址与模型不会保存');
    const confirm=await page.locator('#onboarding-later-confirm').boundingBox();expect(confirm).not.toBeNull();expect(confirm!.y+confirm!.height).toBeLessThanOrEqual(640);
    await page.locator('#onboarding-dialog').screenshot({path:info.outputPath('continue-later.png')});
    await page.locator('#onboarding-later-confirm').click();
    await expect(page.locator('#onboarding-dialog')).toBeHidden();
    const progress=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('pi-onboarding-progress-v1:')));
    expect(progress).toHaveLength(1);
    expect(JSON.stringify(progress)).not.toContain('private-test-key');
    expect(JSON.stringify(progress)).not.toContain('private.example');
    await page.screenshot({path:info.outputPath('paused-settings.png')});
    await page.locator('#resume-paused-setup').click();
    await expect(page.locator('#onboarding-api-key')).toHaveValue('private-test-key');
    await page.locator('#onboarding-later').click();await page.locator('#onboarding-later-confirm').click();
    await page.close();page=await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#onboarding-resume')).toBeVisible();
    await page.locator('[name="onboarding-purpose-choice"][value="learning"]').check();
    await page.locator('#onboarding-resume-button').click();
    await expect(page.locator('#onboarding-status')).toContainText('当前已有未保存输入');
    await expect(page.locator('[name="onboarding-purpose-choice"][value="learning"]')).toBeChecked();
    await page.close({runBeforeUnload:false});page=await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('#onboarding-resume-button').click();
    await expect(page.locator('#onboarding-preset')).toHaveValue('custom');
    await expect(page.locator('#onboarding-api-key')).toHaveValue('');
    await expect(page.locator('#onboarding-base-url')).toHaveValue('');
    await page.locator('#onboarding-back').click();
    await expect(page.locator('#onboarding-research-field')).toHaveValue('量子材料');
    expect(textRequests).toHaveLength(0);
  } finally {
    await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('pi-onboarding-progress-v1:'))localStorage.removeItem(key)}).catch(()=>{});
    await page.close({runBeforeUnload:false});
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),saved);
  }
});

test('does not restore old purposes over a change made in another window', async () => {
  const worker=context.serviceWorkers()[0]!,saved=await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const page=await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,onboardingCompleted:false}}),saved);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('[name="onboarding-purpose-choice"][value="research"]').check();
    await page.locator('#onboarding-research-field').fill('原有草稿');
    await page.locator('#onboarding-later').click();await page.locator('#onboarding-later-confirm').click();
    await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,v=(await s.get('extensionSettings')).extensionSettings;await s.set({extensionSettings:{...v,purposePreferences:{purposes:['learning'],researchField:''}}})});
    await page.reload();await page.locator('#onboarding-resume-button').click();
    await expect(page.locator('#onboarding-status')).toContainText('其他窗口更改');
    const current=await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
    expect(current.purposePreferences.purposes).toEqual(['learning']);
  } finally {
    await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('pi-onboarding-progress-v1:'))localStorage.removeItem(key)}).catch(()=>{});
    await page.close({runBeforeUnload:false});await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),saved);
  }
});

test('common tasks retain unsaved inputs and the overview reports configuration conservatively', async () => {
  const page=await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#setup-readiness')).toContainText('文字翻译');
    await page.setViewportSize({width:320,height:640});
    const geometry=await page.evaluate(()=>{
      const brand=document.querySelector('.brand-row')!.getBoundingClientRect();
      const quickbar=document.querySelector('.settings-quickbar')!.getBoundingClientRect();
      const status=document.querySelector('#setup-readiness')!.getBoundingClientRect();
      return {brandBottom:brand.bottom,quickbarTop:quickbar.top,statusRight:status.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth};
    });
    expect(geometry.quickbarTop).toBeGreaterThanOrEqual(geometry.brandBottom);
    expect(geometry.statusRight).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({width:1200,height:900});
    await page.locator('#api-key').fill('unsaved-test-key');
    await page.locator('#common-tasks > summary').click();
    await page.locator('[data-settings-task="translation"]').click();
    await expect(page.locator('#target-language')).toBeFocused();
    await page.locator('[data-settings-task="pages"]').click();
    await expect(page.locator('#general-page-mode')).toBeFocused();
    await page.locator('[data-settings-task="connection"]').click();
    await expect(page.locator('#api-key')).toHaveValue('unsaved-test-key');
    await expect(page.locator('#save-button')).toBeEnabled();
  } finally { await page.close({runBeforeUnload:false}); }
});

test('separate setup windows save independent progress without overwriting each other', async () => {
  const worker=context.serviceWorkers()[0]!,saved=await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const first=await context.newPage(),second=await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,onboardingCompleted:false}}),saved);
    await first.goto(`chrome-extension://${extensionId}/options.html`);await second.goto(`chrome-extension://${extensionId}/options.html`);
    await first.locator('[name="onboarding-purpose-choice"][value="research"]').check();await first.locator('#onboarding-research-field').fill('领域甲');
    await second.locator('[name="onboarding-purpose-choice"][value="research"]').check();await second.locator('#onboarding-research-field').fill('领域乙');
    await first.locator('#onboarding-later').click();await first.locator('#onboarding-later-confirm').click();
    await second.locator('#onboarding-later').click();await second.locator('#onboarding-later-confirm').click();
    const drafts=await first.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('pi-onboarding-progress-v1:')).map(([,value])=>JSON.parse(value).field).sort());
    expect(drafts).toEqual(['领域乙','领域甲'].sort());
  } finally {
    await first.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('pi-onboarding-progress-v1:'))localStorage.removeItem(key)}).catch(()=>{});
    await first.close({runBeforeUnload:false});await second.close({runBeforeUnload:false});await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),saved);
  }
});
