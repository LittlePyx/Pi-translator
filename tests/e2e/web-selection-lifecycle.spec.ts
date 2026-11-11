import {ARTICLE_FIXTURE_URL, context, expect, extensionId, installEdgeExtensionHooks, mockControl, OVERLEAF_FIXTURE_URL, page, selectElementText, test, textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('quietly hides confident target-language selections without requesting translation', async ({}, info) => {
  const worker = context.serviceWorkers()[0]!;
  const original = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const caller = await context.newPage();
  try {
    await worker.evaluate(async () => {
      const store = (globalThis as any).chrome.storage.local;
      const settings = (await store.get('extensionSettings')).extensionSettings;
      await store.set({extensionSettings: {...settings, targetLanguage: 'zh-CN', hideFloatingButtonForTargetLanguage: true, generalPageMode: 'allowlist', siteAllowlist: ['www.overleaf.com']}});
    });
    const fixtureUrl = ARTICLE_FIXTURE_URL;
    await page.goto(fixtureUrl);
    await caller.goto(`chrome-extension://${extensionId}/options.html`);
    const tabId = await caller.evaluate(async url => (await (globalThis as any).chrome.tabs.query({}))
      .find((tab: {url?: string}) => tab.url === url).id, fixtureUrl);
    await caller.evaluate(async tabId => (globalThis as any).chrome.scripting.executeScript({target: {tabId}, files: ['content-scripts/general.js']}), tabId);
    await page.evaluate(() => { const node = document.createElement('p'); node.id = 'passive-language-probe'; document.body.prepend(node); });
    const overlay = page.locator('#tex-selection-translator-root');
    const before = textRequests.length;
    for (const text of ['设置', '查看 PDF 文件', '这是 API 的使用说明']) {
      await page.locator('#passive-language-probe').evaluate(node => { node.textContent = 'A short English sentence'; });
      await selectElementText('#passive-language-probe');
      await expect(overlay.locator('.trigger')).toBeVisible();
      await page.locator('#passive-language-probe').evaluate((node, text) => { node.textContent = text; }, text);
      await selectElementText('#passive-language-probe');
      await expect(overlay.locator('.trigger')).toHaveCount(0);
    }
    await page.locator('#passive-language-probe').evaluate(node => { node.textContent = 'A short English sentence'; });
    await selectElementText('#passive-language-probe');
    await expect(overlay.locator('.trigger')).toBeVisible();
    const size = await overlay.locator('.trigger').boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(38);
    await overlay.locator('.trigger').screenshot({path: info.outputPath('selection-trigger.png')});
    expect(textRequests.length).toBe(before);
    await worker.evaluate(async () => {
      const store = (globalThis as any).chrome.storage.local;
      const settings = (await store.get('extensionSettings')).extensionSettings;
      await store.set({extensionSettings: {...settings, hideFloatingButtonForTargetLanguage: false}});
    });
    await page.reload();
    await page.evaluate(() => { const node = document.createElement('p'); node.id = 'passive-language-probe'; node.textContent = '设置'; document.body.prepend(node); });
    await caller.evaluate(async tabId => (globalThis as any).chrome.scripting.executeScript({target: {tabId}, files: ['content-scripts/general.js']}), tabId);
    await selectElementText('#passive-language-probe');
    await expect(overlay.locator('.trigger')).toBeVisible();
    expect(textRequests.length).toBe(before);
  } finally {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings: settings}), original);
    await caller.close();
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});

test('keeps a webpage translation alive across same-URL history updates and frame loading', async ({}, info) => {
  const caller = await context.newPage();
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await caller.goto(`chrome-extension://${extensionId}/options.html`);
    const tabId = await caller.evaluate(async url => (await (globalThis as any).chrome.tabs.query({}))
      .find((tab: {url?: string}) => tab.url === url).id, ARTICLE_FIXTURE_URL);
    await caller.evaluate(async tabId => {
      const api = (globalThis as any).chrome;
      await api.scripting.executeScript({target: {tabId}, files: ['content-scripts/general.js']});
      await api.tabs.sendMessage(tabId, {type: 'OPEN_SIDEBAR'});
    }, tabId);
    await page.bringToFront();
    await page.route('https://frame.pi-test.invalid/embedded-frame-probe', route => route.fulfill({
      contentType: 'text/html', body: '<p>Embedded interactive example</p>',
    }));
    await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.id = 'live-widget-frame';
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
      frame.src = 'about:blank'; document.body.append(frame); await loaded;
    });
    const started = new Promise<void>(resolve => { mockControl.interactiveRequestStarted = resolve; });
    mockControl.heldInteractiveRequestGate = new Promise<void>(resolve => { mockControl.releaseHeldInteractiveRequest = resolve; });
    mockControl.holdNextInteractiveRequest = true;
    await selectElementText('#article-intro');
    await started;
    const before = textRequests.length;
    await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>('#live-widget-frame')!;
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
      frame.src = 'https://frame.pi-test.invalid/embedded-frame-probe';
      await loaded;
      history.replaceState(history.state, '', location.href);
    });
    await page.waitForTimeout(300);
    await page.screenshot({path: info.outputPath('frame-loaded-during-translation.png')});
    const overlay = page.locator('#tex-selection-translator-root');
    await expect(overlay.locator('.error')).toHaveCount(0);
    mockControl.releaseHeldInteractiveRequest?.();
    await expect(overlay.locator('.body')).toHaveText('一致的学术翻译能够提升研究论文的可读性。');
    expect(textRequests.length).toBe(before);
  } finally {
    mockControl.releaseHeldInteractiveRequest?.();
    await page.unroute('https://frame.pi-test.invalid/embedded-frame-probe');
    await caller.close();
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});

test('still cancels a previous webpage request after a same-URL top-level reload', async () => {
  const caller = await context.newPage();
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await caller.goto(`chrome-extension://${extensionId}/options.html`);
    const tabId = await caller.evaluate(async url => (await (globalThis as any).chrome.tabs.query({}))
      .find((tab: {url?: string}) => tab.url === url).id, ARTICLE_FIXTURE_URL);
    const readHistory = () => caller.evaluate(async tabId => {
      const api = (globalThis as any).chrome;
      return (await api.storage.session.get('translationHistoryByTab')).translationHistoryByTab?.[String(tabId)] ?? [];
    }, tabId);
    const historyBefore = await readHistory();
    await caller.evaluate(async tabId => {
      const api = (globalThis as any).chrome;
      await api.scripting.executeScript({target: {tabId}, files: ['content-scripts/general.js']});
      await api.tabs.sendMessage(tabId, {type: 'OPEN_SIDEBAR'});
    }, tabId);
    await page.bringToFront();
    await page.locator('#article-intro').evaluate(element => {
      element.textContent = 'Bilingual reading should preserve the original article after a full reload.';
    });
    const started = new Promise<void>(resolve => { mockControl.interactiveRequestStarted = resolve; });
    mockControl.heldInteractiveRequestGate = new Promise<void>(resolve => { mockControl.releaseHeldInteractiveRequest = resolve; });
    mockControl.holdNextInteractiveRequest = true;
    await selectElementText('#article-intro');
    await started;
    await page.reload();
    mockControl.releaseHeldInteractiveRequest?.();
    await expect.poll(readHistory).toEqual(historyBefore);
    await page.waitForTimeout(400);
    expect(await readHistory()).toEqual(historyBefore);
  } finally {
    mockControl.releaseHeldInteractiveRequest?.();
    await caller.close();
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});
