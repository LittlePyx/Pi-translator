import { openTranslationMore } from './support/translation-controls';
import {
  ARTICLE_FIXTURE_URL, OVERLEAF_FIXTURE_URL, context, expect, extensionId,
  installEdgeExtensionHooks, page, selectElementText, test, textRequests, visionRequests,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

async function storage() {
  return context.serviceWorkers()[0]!.evaluate(async () => (globalThis as any).chrome.storage.local.get(null));
}
async function popup() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator('#target-language')).toBeEnabled();
  await popup.locator('#popup-more-actions > summary').click();
  await expect(popup.locator('#site-name')).toHaveText('www.overleaf.com');
  return popup;
}

test.beforeEach(async () => {
  await context.serviceWorkers()[0]!.evaluate(async () => {
    const api = (globalThis as any).chrome;
    const { extensionSettings } = await api.storage.local.get('extensionSettings');
    await api.storage.local.set({ uiLanguagePreference: 'zh-CN', siteReadingPreferencesV1: {}, extensionSettings: { ...extensionSettings, targetLanguage: 'zh-CN' } });
    await api.storage.session.set({ pausedSiteHosts: [] });
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test('opts in explicitly, scopes language to the site, persists pause and restores global without requests', async ({}, info) => {
  const before = await storage();
  const requests = textRequests.length + visionRequests.length;
  let panel = await popup();
  await expect(panel.locator('#remember-site')).not.toBeChecked();
  await expect(panel.locator('#reset-site')).toBeHidden();
  await panel.locator('#remember-site').check();
  await expect(panel.locator('#status')).toContainText('已记住');
  await panel.locator('#target-language').selectOption('ja');
  await expect(panel.locator('#status')).toContainText('目标语言已更新');
  await panel.locator('#pause-site').check();
  await expect(panel.locator('#status')).toContainText('已暂停');
  expect((await storage()).extensionSettings).toEqual(before.extensionSettings);
  expect((await storage()).siteReadingPreferencesV1).toEqual({ 'www.overleaf.com': { targetLanguage: 'ja', paused: true } });
  await panel.setViewportSize({ width: 360, height: 740 });
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const helpBounds = await panel.locator('#site-preference-help').boundingBox();
  const pauseBounds = await panel.locator('label:has(#pause-site)').boundingBox();
  expect(helpBounds!.width).toBeGreaterThan(220);
  expect(helpBounds!.y).toBeGreaterThanOrEqual(pauseBounds!.y + pauseBounds!.height);
  await panel.screenshot({ path: info.outputPath('site-preferences-narrow.png'), fullPage: true });
  await panel.close();
  // Clear session storage only: durable preferences must continue to win on a new page.
  await context.serviceWorkers()[0]!.evaluate(async () => { await (globalThis as any).chrome.storage.session.set({ pausedSiteHosts: [] }); });
  await page.reload();
  panel = await popup();
  await expect(panel.locator('#target-language')).toHaveValue('ja');
  await expect(panel.locator('#pause-site')).toBeChecked();
  await expect(panel.locator('#remember-site')).toBeChecked();
  const publicDefaults = await panel.evaluate(async () => (globalThis as any).chrome.runtime.sendMessage({ type: 'GET_PUBLIC_SETTINGS' }));
  expect(publicDefaults.data.targetLanguage).toBe('zh-CN');
  expect(publicDefaults.data.siteTargetLanguage).toBeUndefined();
  await panel.locator('#reset-site').click();
  await expect(panel.locator('#status')).toContainText('现有译文保留');
  await expect(panel.locator('#target-language')).toHaveValue('zh-CN');
  await expect(panel.locator('#pause-site')).not.toBeChecked();
  expect((await storage()).siteReadingPreferencesV1).toEqual({});
  expect((await storage()).extensionSettings).toEqual(before.extensionSettings);
  expect(textRequests.length + visionRequests.length).toBe(requests);
  await panel.close();
});

test('keeps remembered site controls readable in English and narrow dark mode', async ({}, info) => {
  await context.serviceWorkers()[0]!.evaluate(async () => { await (globalThis as any).chrome.storage.local.set({ uiLanguagePreference: 'en' }); });
  const panel = await popup();
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.setViewportSize({ width: 360, height: 640 });
  await expect(panel.locator('label:has(#remember-site)')).toContainText('Remember this site');
  await panel.locator('#remember-site').check();
  await expect(panel.locator('#status')).toContainText('saved for this site');
  await expect(panel.locator('#reset-site')).toHaveText('Use global settings');
  const helpBounds = await panel.locator('#site-preference-help').boundingBox();
  const pauseBounds = await panel.locator('label:has(#pause-site)').boundingBox();
  expect(helpBounds!.width).toBeGreaterThan(220);
  expect(helpBounds!.y).toBeGreaterThanOrEqual(pauseBounds!.y + pauseBounds!.height);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath('site-preferences-english-dark.png'), fullPage: true });
  await panel.close();
});

test('retains a page language override across site default and pause broadcasts', async () => {
  await selectElementText('#source');
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('学术翻译');
  await openTranslationMore(overlay);
  await overlay.locator('details.more select').selectOption('en');
  await expect.poll(() => JSON.stringify(textRequests.at(-1)?.messages)).toContain(' to en.');
  await expect(overlay.locator('.body')).toHaveText('经用户调整后，更忠实地保留原文限定条件。');
  const existing = await overlay.locator('.body').innerText();
  const panel = await popup();
  await panel.locator('#remember-site').check();
  await expect(panel.locator('#status')).toContainText('已记住');
  await panel.locator('#target-language').selectOption('ja');
  await expect(panel.locator('#status')).toContainText('目标语言已更新');
  const before = textRequests.length;
  await panel.locator('#pause-site').check();
  await expect(panel.locator('#status')).toContainText('已暂停');
  await expect(overlay.locator('.body')).toHaveText(existing);
  expect(textRequests.length).toBe(before);
  await panel.locator('#pause-site').uncheck();
  await expect(panel.locator('#status')).toContainText('已恢复');
  await panel.close();
  await openTranslationMore(overlay);
  await expect(overlay.locator('details.more select')).toHaveValue('en');
  await page.keyboard.press('Escape');
  await selectElementText('#multi-source');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.length).toBe(before + 1);
  expect(JSON.stringify(textRequests.at(-1)?.messages)).toContain(' to en.');
  expect((await storage()).siteReadingPreferencesV1['www.overleaf.com'].targetLanguage).toBe('ja');
  await page.reload();
  await selectElementText('#source');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.length).toBe(before + 2);
  expect(JSON.stringify(textRequests.at(-1)?.messages)).toContain(' to ja.');
});

test('keeps automatic sidebar selection paused while explicit translation remains available', async () => {
  const panel = await popup();
  await panel.locator('#remember-site').check();
  await expect(panel.locator('#status')).toContainText('已记住');
  await panel.locator('#pause-site').check();
  await expect(panel.locator('#status')).toContainText('已暂停');
  const tabId = await panel.evaluate(async url => (await (globalThis as any).chrome.tabs.query({})).find((tab: any) => tab.url === url).id, OVERLEAF_FIXTURE_URL);
  await panel.evaluate(async tabId => { await (globalThis as any).chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDEBAR' }); }, tabId);
  await expect(page.locator('#tex-selection-translator-root .sidebar')).toBeVisible();
  const before = textRequests.length;
  await selectElementText('#source');
  // Observe beyond the production automatic-selection debounce; no forced interaction or mock retry.
  await expect(page.locator('#tex-selection-translator-root .sidebar')).toBeVisible();
  await page.waitForTimeout(400);
  expect(textRequests.length).toBe(before);
  await panel.evaluate(async tabId => { await (globalThis as any).chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_TRANSLATE' }); }, tabId);
  await expect.poll(() => textRequests.length).toBe(before + 1);
  await expect(page.locator('#tex-selection-translator-root .body')).toContainText('学术翻译');
  await selectElementText('#multi-source');
  await page.waitForTimeout(400);
  expect(textRequests.length).toBe(before + 1);
  await panel.evaluate(async tabId => { await (globalThis as any).chrome.tabs.sendMessage(tabId, { type: 'OPEN_SIDEBAR' }); }, tabId);
  await expect.poll(() => textRequests.length).toBe(before + 2);
  await expect(page.locator('#tex-selection-translator-root .body')).not.toBeEmpty();
  await selectElementText('#global-term-source');
  await page.waitForTimeout(400);
  expect(textRequests.length).toBe(before + 2);
  await panel.close();
});

test('changing and restoring site defaults keeps existing bilingual paragraphs intact without requests', async () => {
  await page.goto(ARTICLE_FIXTURE_URL);
  let panel = await popup();
  await panel.locator('#translate-page').click();
  const translated = page.locator('[data-pi-bilingual-translation]');
  await expect(translated).toHaveCount(7);
  panel = await popup();
  const old = await translated.allTextContents();
  const before = textRequests.length;
  await panel.locator('#remember-site').check();
  await expect(panel.locator('#status')).toContainText('已记住');
  await panel.locator('#pause-site').check();
  await expect(panel.locator('#status')).toContainText('已暂停');
  await panel.locator('#reset-site').click();
  await expect(panel.locator('#status')).toContainText('恢复全局');
  expect(await translated.allTextContents()).toEqual(old);
  expect(textRequests.length).toBe(before);
  await panel.close();
});
