import {ARTICLE_FIXTURE_URL, context, expect, extensionId, installEdgeExtensionHooks, mockControl, OVERLEAF_FIXTURE_URL, page, selectElementText, test, textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

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
