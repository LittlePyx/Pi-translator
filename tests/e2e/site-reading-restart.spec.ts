import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('keeps opt-in site language, pause and prior content through a real Edge restart', async ({}, info) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-site-reading-'));
  let context: BrowserContext | undefined;
  const launch = async () => {
    const extension = path.resolve(process.env.PI_E2E_EXTENSION_PATH??'.output/edge-mv3');
    context = await chromium.launchPersistentContext(directory, {
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: process.env.PI_E2E_HEADLESS === '1',
      locale: 'zh-CN',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    return { worker, id: new URL(worker.url()).host };
  };
  try {
    const first = await launch();
    await first.worker.evaluate(async () => { await (globalThis as any).chrome.storage.local.set({ uiLanguagePreference: 'zh-CN' }); });
    const onboardingPage = context!.pages()[0] ?? await context!.newPage();
    const optionsUrl = `chrome-extension://${first.id}/options.html`;
    try { await onboardingPage.goto(optionsUrl); }
    catch (error) {
      if (!(error instanceof Error && error.message.includes('interrupted by another navigation') && error.message.includes(`another navigation to "${optionsUrl}"`))) throw error;
      await onboardingPage.waitForURL(optionsUrl);
      await onboardingPage.waitForLoadState('domcontentloaded');
    }
    await expect(onboardingPage!.locator('#onboarding-dialog')).toBeVisible();
    await onboardingPage!.locator('#onboarding-skip').click();
    await expect(onboardingPage!.locator('#status')).toContainText('已进入完整设置');
    const oldContent = { translation: '人工修正保留 $E=mc^2$', original: 'Research source', formula: '\\mathcal{L}', revisions: ['旧译文', '人工修正'] };
    await first.worker.evaluate(async oldContent => {
      const api = (globalThis as any).chrome;
      await api.storage.local.set({ uiLanguagePreference: 'zh-CN', translationFavorites: [oldContent] });
    }, oldContent);
    const site = await context!.newPage();
    await site.route('https://www.overleaf.com/site-preferences-restart', route => route.fulfill({ contentType: 'text/html', body: '<p>Research reading preferences survive a browser restart.</p>' }));
    await site.goto('https://www.overleaf.com/site-preferences-restart');
    const panel = await context!.newPage();
    await panel.goto(`chrome-extension://${first.id}/popup.html`);
    await site.bringToFront();
    await panel.reload();
    await panel.locator('#popup-more-actions > summary').click();
    await expect(panel.locator('#site-name')).toHaveText('www.overleaf.com');
    await panel.locator('#remember-site').check();
    await expect(panel.locator('#status')).toContainText('已记住');
    await panel.locator('#target-language').selectOption('en');
    await expect(panel.locator('#status')).toContainText('目标语言已更新');
    await panel.locator('#pause-site').check();
    await expect(panel.locator('#status')).toContainText('已暂停');
    const before = await first.worker.evaluate(async () => (globalThis as any).chrome.storage.local.get(['extensionSettings', 'translationFavorites', 'siteReadingPreferencesV1']));
    await context!.close(); context = undefined;
    const second = await launch();
    const after = await second.worker.evaluate(async () => (globalThis as any).chrome.storage.local.get(['extensionSettings', 'translationFavorites', 'siteReadingPreferencesV1']));
    expect(after).toEqual(before);
    expect(after.extensionSettings.targetLanguage).toBe('zh-CN');
    expect(after.translationFavorites).toEqual([oldContent]);
    expect(after.siteReadingPreferencesV1).toEqual({ 'www.overleaf.com': { targetLanguage: 'en', paused: true } });
    await info.attach('restart-preservation.json', { body: JSON.stringify(after, null, 2), contentType: 'application/json' });
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
