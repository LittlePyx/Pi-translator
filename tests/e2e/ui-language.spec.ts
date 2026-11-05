import {openSettingsSection} from './support/settings-navigation';
import {
  context, expect, extensionId, installEdgeExtensionHooks, page,
  selectElementText, test, textRequests, OVERLEAF_FIXTURE_URL,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test.beforeEach(async ({}, info) => {
  // Every test owns its locale, including when Playwright starts a new worker
  // after a failure. Do not depend on another test having switched the UI.
  await context.serviceWorkers()[0]!.evaluate(async value => {
    await (globalThis as any).chrome.storage.local.set({uiLanguagePreference:value});
  }, info.title.startsWith('switches') ? 'zh-CN' : 'en');
});

test('switches to English independently and protects an unsaved translation-settings draft', async ({}, info) => {
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html#translation`);
    await expect(options.locator('#ui-language')).toHaveValue('zh-CN');
    const before = await options.evaluate(async () => (globalThis as any).chrome.storage.local.get(null));
    await options.locator('#ui-language').selectOption('en');
    await expect(options.locator('html')).toHaveAttribute('lang', 'en');
    await expect(options.locator('#target-language')).toHaveValue(before.extensionSettings.targetLanguage);
    await expect(options.locator('[data-settings-target="connection"]')).toContainText('Connect API');
    await expect(options.locator('#save-button')).toBeDisabled();
    const after = await options.evaluate(async () => (globalThis as any).chrome.storage.local.get(null));
    expect(after).toEqual({ ...before, uiLanguagePreference: 'en' });
    await options.screenshot({path: info.outputPath('english-preferences-desktop.png'), fullPage: true});
    await options.setViewportSize({width: 360, height: 760});
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await options.screenshot({path: info.outputPath('english-preferences-mobile.png'), fullPage: true});
    await options.locator('#target-language').selectOption('ja');
    await options.locator('#ui-language').selectOption('zh-CN');
    await expect(options.locator('#ui-language')).toHaveValue('en');
    await expect(options.locator('#target-language')).toHaveValue('ja');
    await expect(options.locator('#status')).toContainText('Save or discard');
    expect((await options.evaluate(async () => (globalThis as any).chrome.storage.local.get('uiLanguagePreference'))).uiLanguagePreference).toBe('en');
    expect((await options.evaluate(async () => (globalThis as any).chrome.storage.local.get('extensionSettings'))).extensionSettings)
      .toEqual(before.extensionSettings);
    options.on('dialog', dialog => dialog.accept());
  } finally { await options.close(); }
});

test('uses English selection controls while preserving Chinese model output and page text', async ({}, info) => {
  await page.goto(OVERLEAF_FIXTURE_URL);
  await page.evaluate(() => { const p=document.createElement('p');p.id='user-copy';p.textContent='复制 · 人工修正 $E=mc^2$';document.body.append(p); });
  const before = textRequests.length;
  await selectElementText('#lookup-source');
  const overlay=page.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.trigger')).toHaveAttribute('aria-label', 'Translate selected text');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
  await expect(overlay.locator('.lexical-sense')).toContainText('连贯性');
  await expect(overlay.locator('.lexical-details > summary')).toHaveText('Additional meanings (1)');
  await expect(overlay.locator('.lexical-sense')).toBeHidden();
  await overlay.locator('.lexical-details > summary').click();
  await expect(overlay.locator('.lexical-sense')).toBeVisible();
  await expect(overlay.locator('.copy-action').first()).toHaveText('Copy translation');
  await expect(page.locator('#user-copy')).toHaveText('复制 · 人工修正 $E=mc^2$');
  expect(textRequests.length).toBe(before+1);
  await overlay.locator('.surface').screenshot({path:info.outputPath('english-selection.png')});
  // A display-language change must not broadcast a translation-settings change
  // into an active reading session. Existing controls change on reopening.
  await context.serviceWorkers()[0]!.evaluate(async () => {
    await (globalThis as any).chrome.storage.local.set({uiLanguagePreference:'zh-CN'});
  });
  await overlay.locator('.copy-action').first().click();
  await expect(overlay.locator('.copy-action').first()).toHaveText('Copied');
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
  await expect(page.locator('#user-copy')).toHaveText('复制 · 人工修正 $E=mc^2$');
  expect(textRequests.length).toBe(before+1);
});

test('renders English setup, popup, sidebar and PDF reader at narrow widths without translation calls', async ({}, info) => {
  const before=textRequests.length;
  for(const entry of ['popup','sidepanel','pdf','options']){
    const surface=await context.newPage();
    try{
      await surface.setViewportSize({width:entry==='popup'?390:360,height:800});
      await surface.goto(`chrome-extension://${extensionId}/${entry}.html`);
      await expect(surface.locator('html')).toHaveAttribute('lang','en');
      if(entry==='options'){
        await openSettingsSection(surface,'support');
        await surface.locator('details.support-disclosure').filter({has:surface.locator('#restart-onboarding')}).locator('summary').click();
        await surface.locator('#restart-onboarding').click();
        await expect(surface.locator('#onboarding-title')).toHaveText('Get started in three steps');
        await surface.locator('#onboarding-preset').selectOption('openai');
        await surface.locator('#onboarding-next').click();
        await expect(surface.locator('#onboarding-api-key')).toBeVisible();
      }
      expect(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await surface.screenshot({path:info.outputPath(`english-${entry}-mobile.png`),fullPage:true});
    }finally{await surface.close()}
  }
  expect(textRequests.length).toBe(before);
});
