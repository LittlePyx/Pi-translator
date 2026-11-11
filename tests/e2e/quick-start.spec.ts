import { context, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('offers optional enhancement after setup without sending an image', async ({}, info) => {
  const worker=context.serviceWorkers()[0]!;
  const original=await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const options=await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,onboardingCompleted:false,visionApiProfileId:'',visionModel:''}}),original);
    await options.addInitScript(() => { (globalThis as any).chrome.permissions.request = async () => true; });
    await options.setViewportSize({width:360,height:640});
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('isolated-test-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    await options.locator('#onboarding-next').click();
    const textBefore=textRequests.length, visionBefore=visionRequests.length;
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-enhancement')).toBeVisible();
    await expect(options.locator('#onboarding-enhancement')).toContainText('公式与图像增强');
    await options.locator('#onboarding-dialog').screenshot({path:info.outputPath('enhancement-360.png')});
    await options.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await options.locator('#onboarding-dialog').screenshot({path:info.outputPath('enhancement-360-dark.png')});
    await options.locator('#onboarding-enhancement-setup').click();
    await expect(options.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open','');
    await expect(options.locator('#vision-setup-title')).toHaveText('公式与图像增强');
    await expect(options.locator('#vision-test-status')).toContainText('可能产生费用');
    expect(textRequests.length).toBe(textBefore);
    expect(visionRequests.length).toBe(visionBefore);
    expect(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {
    await options.close({runBeforeUnload:false});
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),original);
  }
});

for (const testFirst of [false, true]) test(`quick start ${testFirst ? 'tests explicitly' : 'saves without translating'}`, async ({}, info) => {
  const worker = context.serviceWorkers()[0]!;
  const original = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const options = await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings: {...settings, onboardingCompleted: false, generalPageMode: 'on-demand'}}), original);
    await options.addInitScript(() => { (globalThis as any).chrome.permissions.request = async () => true; });
    await options.setViewportSize({width: 360, height: 700});
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const dialog = options.locator('#onboarding-dialog');
    await expect(dialog).toBeVisible();
    await expect(options.locator('[name="onboarding-purpose-choice"][value="research"]')).toBeVisible();
    await expect(options.locator('#onboarding-preset')).toBeHidden();
    await options.locator('[name="onboarding-purpose-choice"][value="research"]').check();
    await options.locator('#onboarding-research-field').fill('统计学');
    await dialog.screenshot({path: info.outputPath('purpose.png')});
    await options.emulateMedia({colorScheme: 'dark'});
    await expect(options.locator('#onboarding-next')).toBeEnabled();
    await expect.poll(() => options.locator('#onboarding-next').evaluate(el => ({color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, opacity: getComputedStyle(el).opacity})))
      .toEqual({color: 'rgb(32, 32, 32)', background: 'rgb(237, 237, 237)', opacity: '1'});
    await dialog.screenshot({path: info.outputPath('purpose-dark.png')});
    expect(await options.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await options.emulateMedia({colorScheme: 'light'});
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('isolated-test-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-model')).toHaveValue('e2e-model');
    await dialog.screenshot({path: info.outputPath('model.png')});
    const before = textRequests.length;
    await options.locator(testFirst ? '#onboarding-test' : '#onboarding-next').click();
    await expect(options.locator('#onboarding-success')).toBeVisible();
    await expect(options.locator('#onboarding-success-title')).toHaveText(testFirst ? '连接成功，已经完成一次真实翻译' : '设置已保存');
    await expect(options.locator('#onboarding-sample-source')).toHaveCount(1);
    await expect(options.locator('.onboarding-sample')).toBeVisible({visible: testFirst});
    expect(textRequests.length).toBe(before + (testFirst ? 1 : 0));
    await expect(options.locator('#onboarding-enable-web')).toBeVisible();
    expect(await options.locator('#onboarding-open-pdf').evaluate(el=>el.compareDocumentPosition(document.getElementById('onboarding-web-access')!) & Node.DOCUMENT_POSITION_FOLLOWING)).not.toBe(0);
    const settings = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
    expect(settings.purposePreferences.researchField).toBe('统计学');
    expect(settings.purposePreferences.useFieldInTranslation).not.toBe(true);
    await dialog.screenshot({path: info.outputPath('complete.png')});
  } finally {
    await options.close();
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings: settings}), original);
  }
});

test('can save a manually entered model when model discovery is offline', async () => {
  const worker = context.serviceWorkers()[0]!;
  const original = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const options = await context.newPage();
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings: {...settings, onboardingCompleted: false}}), original);
    await options.addInitScript(() => {
      const api = (globalThis as any).chrome, send = api.runtime.sendMessage.bind(api.runtime);
      api.permissions.request = async () => true;
      api.runtime.sendMessage = (message: any, ...args: any[]) => message.type === 'LIST_API_MODELS'
        ? Promise.resolve({ok: false, error: {code: 'NETWORK_ERROR', message: 'offline fixture'}})
        : send(message, ...args);
    });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-base-url').fill('https://example.invalid/v1');
    await options.locator('#onboarding-api-key').fill('offline-test-key');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-status')).toContainText('未能读取模型列表');
    await options.locator('#onboarding-model').fill('manual-text-model');
    const before = textRequests.length;
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-success-detail')).toContainText('尚未测试');
    expect(textRequests.length).toBe(before);
  } finally {
    await options.close();
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings: settings}), original);
  }
});
