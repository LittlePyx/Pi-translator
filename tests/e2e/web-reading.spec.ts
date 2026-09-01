import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ARTICLE_FIXTURE_URL,
  clearBrowserSelection,
  context,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  LONG_ARTICLE_FIXTURE_URL,
  MEDIAWIKI_MATH_FIXTURE_URL,
  mockControl,
  OVERLEAF_FIXTURE_URL,
  page,
  selectElementText,
  test,
  textRequests,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('exposes the native Edge side panel API to the service worker', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const availability = await worker!.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      browser?: { sidePanel?: unknown };
      chrome?: { sidePanel?: unknown };
    };
    return {
      browserNamespace: Boolean(scope.browser),
      browserSidePanel: Boolean(scope.browser?.sidePanel),
      chromeSidePanel: Boolean(scope.chrome?.sidePanel),
    };
  });
  expect(availability.chromeSidePanel || availability.browserSidePanel).toBe(true);
});

test('treats MediaWiki MathML and its fallback image as one extractable formula', async () => {
  const popup = await context.newPage();
  try {
    await page.goto(MEDIAWIKI_MATH_FIXTURE_URL);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    const requestsBefore = textRequests.length;
    const startResponse = await popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          runtime: { sendMessage(message: object): Promise<unknown> };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id === undefined) throw new Error('MediaWiki fixture tab not found.');
      return api.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId: tab.id, targetLanguage: 'zh-CN' },
      });
    }, MEDIAWIKI_MATH_FIXTURE_URL);
    expect(startResponse).toMatchObject({ ok: true });

    const source = page.locator('#mediawiki-inline');
    const translation = page.locator(
      '#mediawiki-inline + [data-pi-bilingual-translation]',
    );
    await expect(translation).toBeVisible();
    await expect(translation.locator('[data-pi-bilingual-formula-notice]')).toHaveCount(0);
    await expect(translation.locator('math')).toBeVisible();
    await expect(source.locator('.mwe-math-element img')).toBeVisible();
    await expect(page.locator('#pi-translator-bilingual-page-control output'))
      .toContainText('已完成 4/4');

    const mediaWikiRequests = textRequests.slice(requestsBefore).filter((request) => {
      const messages = request.messages as Array<{ role?: string; content?: unknown }> | undefined;
      const content = messages?.find((message) => message.role === 'user')?.content;
      if (typeof content !== 'string') return false;
      try {
        const payload = JSON.parse(content) as { text?: unknown };
        return typeof payload.text === 'string' && payload.text.includes(
          'MediaWiki keeps accessible MathML beside a visible fallback image',
        );
      } catch {
        return false;
      }
    }).map((request) => JSON.stringify(request));
    expect(mediaWikiRequests).toHaveLength(1);
    expect(mediaWikiRequests[0]).toMatch(/⟦FULL\d+_/u);
    expect(mediaWikiRequests[0]).not.toContain('mwe-math-fallback-image');

    await page.locator(
      '#pi-translator-bilingual-page-control select[data-action="display"]',
    ).selectOption('translation');
    await expect(source).toHaveAttribute('data-pi-bilingual-source-hidden', 'block');
  } finally {
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL).catch(() => undefined);
  }
});

test('discovers bilingual article translation and lets the reader adjust its scope', async ({}, testInfo) => {
  const popup = await context.newPage();
  let originalTargetLanguage = 'zh-CN';
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await page.bringToFront();
    await page.evaluate(() => {
      const widget = document.createElement('button');
      widget.id = 'article-fixed-widget';
      widget.textContent = 'Page help';
      widget.style.cssText = [
        'position:fixed',
        'right:8px',
        'bottom:8px',
        'z-index:2147483000',
        'width:210px',
        'height:52px',
      ].join(';');
      document.body.append(widget);
    });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    originalTargetLanguage = await popup.locator('#target-language').inputValue();
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.locator('#target-language').selectOption('zh-CN');
      await expect(popup.locator('#status')).toContainText('目标语言已更新');
    }
    await page.bringToFront();

    const launcher = page.locator('#pi-translator-bilingual-page-launcher');
    const pageControl = page.locator('#pi-translator-bilingual-page-control');
    const scopeCandidates = page.locator('[data-pi-bilingual-scope-preview]');
    const requestCountBeforePreview = textRequests.length;
    await expect(launcher).toBeVisible();
    await expect(launcher.locator('img.mark')).toHaveAttribute('src', /brand\/pi_logo\.png$/);
    await expect(launcher.locator('button[data-action="start"]')).toContainText('译全文');
    await expect(launcher.locator('.count')).toHaveText('· 7 段');
    const launcherStyle = await launcher.locator('.launcher').evaluate((element) => ({
      shadow: getComputedStyle(element).boxShadow,
      startBackground: getComputedStyle(
        element.querySelector<HTMLElement>('button[data-action="start"]')!,
      ).backgroundColor,
      markFilter: getComputedStyle(element.querySelector<HTMLElement>('.mark')!).filter,
    }));
    expect(launcherStyle.shadow).not.toContain('24px');
    expect(launcherStyle.startBackground).toBe('rgba(0, 0, 0, 0)');
    expect(launcherStyle.markFilter).toBe('none');
    await expect(launcher).not.toHaveAttribute('data-pi-placement', 'bottom-right');
    const launcherAvoidance = await page.evaluate(() => {
      const launcherRect = document.getElementById('pi-translator-bilingual-page-launcher')!
        .getBoundingClientRect();
      const widgetRect = document.getElementById('article-fixed-widget')!
        .getBoundingClientRect();
      return {
        launcher: launcherRect.toJSON(),
        widget: widgetRect.toJSON(),
        clear: !(
          launcherRect.left < widgetRect.right + 8 &&
          launcherRect.right > widgetRect.left - 8 &&
          launcherRect.top < widgetRect.bottom + 8 &&
          launcherRect.bottom > widgetRect.top - 8
        ),
      };
    });
    expect(launcherAvoidance.clear, JSON.stringify(launcherAvoidance)).toBe(true);
    await page.locator('#article-fixed-widget').evaluate((element) => element.remove());
    await expect(launcher).toHaveAttribute('data-pi-placement', 'bottom-right');
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await page.screenshot({
        path: testInfo.outputPath('bilingual-page-launcher.png'),
        fullPage: false,
      });
    }

    await page.setViewportSize({ width: 480, height: 720 });
    await expect(launcher.locator('button[data-action="scope"]')).toBeHidden();
    await expect(launcher.locator('details.more')).toBeVisible();
    await launcher.locator('details.more > summary').click();
    await expect(launcher.locator('button[data-action="scope-menu"]')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.bringToFront();
    const articleTabId = await popup.evaluate(async (url) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { query(queryInfo: object): Promise<Array<{ id?: number; url?: string }>> } };
      }).chrome;
      const tabs = await api.tabs.query({});
      return tabs.find((tab) => tab.url?.startsWith(url))?.id;
    }, ARTICLE_FIXTURE_URL);
    expect(articleTabId).toBeDefined();
    await popup.evaluate(async (tabId) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { sendMessage(id: number, message: object): Promise<void> } };
      }).chrome;
      await api.tabs.sendMessage(tabId!, { type: 'BROWSER_SIDEBAR_ACTIVE' });
    }, articleTabId);
    await expect(launcher).toHaveCount(0);
    await popup.evaluate(async (tabId) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { sendMessage(id: number, message: object): Promise<void> } };
      }).chrome;
      await api.tabs.sendMessage(tabId!, { type: 'BROWSER_SIDEBAR_CLOSED' });
    }, articleTabId);
    await expect(launcher).toBeVisible();

    await launcher.locator('button[data-action="scope"]').click();
    await expect(launcher).toHaveCount(0);
    await expect(pageControl).toBeVisible();
    await expect(scopeCandidates).toHaveCount(7);
    await expect(pageControl.locator('.control-title')).toHaveText('选择翻译范围');
    await expect(pageControl.locator('output')).toContainText('正文范围 7/7 段');
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await page.locator('#article-later').evaluate((element) => (element as HTMLElement).click());
    await expect(page.locator('#article-later')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await expect(pageControl.locator('output')).toContainText('正文范围 6/7 段');
    expect(textRequests.length).toBe(requestCountBeforePreview);
    await pageControl.locator('button[data-action="cancel-scope"]').click();
    await expect(scopeCandidates).toHaveCount(0);
    await expect(pageControl).toHaveCount(0);
    await expect(launcher).toBeVisible();
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await launcher.locator('button[data-action="scope"]').click();
    await page.locator('#article-later').evaluate((element) => (element as HTMLElement).click());
    await pageControl.locator('button[data-action="apply-scope"]').click();
    await expect(scopeCandidates).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('#article-summary + [data-pi-bilingual-translation]')).toBeVisible();
    await expect(page.locator('#article-later + [data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(6);
    await expect(pageControl.locator('output')).toContainText('已完成 6/6');
    const controlBar = pageControl.locator('.bar');
    await expect(controlBar).toHaveAttribute('data-phase', 'complete');
    await expect(pageControl.locator('.control-title')).toHaveText('网页全文翻译');
    await expect(pageControl.locator('.progress')).toHaveAttribute('aria-valuenow', '100');
    const compactControl = pageControl.locator('button[data-action="compact"]');
    await expect(controlBar).toHaveAttribute('data-collapsed', 'true');
    await expect(compactControl).toHaveAttribute('aria-expanded', 'false');
    const compactWidth = await controlBar.evaluate((bar) => bar.getBoundingClientRect().width);
    expect(compactWidth).toBeLessThan(440);
    await compactControl.click();
    await expect(controlBar).toHaveAttribute('data-collapsed', 'false');
    await expect(compactControl).toHaveAttribute('aria-expanded', 'true');
    const expandedControlLayout = await controlBar.evaluate((bar) => {
      const compact = bar.querySelector<HTMLElement>('[data-action="compact"]')!
        .getBoundingClientRect();
      const more = bar.querySelector<HTMLElement>('details.more')!.getBoundingClientRect();
      return {
        clientWidth: bar.clientWidth,
        scrollWidth: bar.scrollWidth,
        compactTop: compact.top,
        moreTop: more.top,
      };
    });
    expect(expandedControlLayout.scrollWidth)
      .toBeLessThanOrEqual(expandedControlLayout.clientWidth + 1);
    expect(Math.abs(expandedControlLayout.compactTop - expandedControlLayout.moreTop))
      .toBeLessThanOrEqual(1);

    const requestsBeforeRestore = textRequests.length;
    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="scope"]').click();
    await expect(page.locator('#article-later')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await page.locator('#article-later').evaluate((element) => (element as HTMLElement).click());
    await expect(pageControl.locator('output')).toContainText('正文范围 7/7 段');
    await pageControl.locator('button[data-action="apply-scope"]').click();
    await expect(page.locator('#article-later + [data-pi-bilingual-translation]')).toBeVisible();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    await expect(pageControl.locator('output')).toContainText('已完成 7/7');
    expect(textRequests.length).toBe(requestsBeforeRestore + 1);

    const requestsBeforeCancelledExclusion = textRequests.length;
    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="scope"]').click();
    await page.locator('#article-later').evaluate((element) => (element as HTMLElement).click());
    await expect(pageControl.locator('.scope-panel span')).toContainText('将清除已译 1 段');
    await expect(pageControl.locator('button[data-action="apply-scope"]'))
      .toHaveText('清除 1 段并应用');
    await pageControl.locator('button[data-action="cancel-scope"]').click();
    await expect(page.locator('#article-later + [data-pi-bilingual-translation]')).toBeVisible();
    expect(textRequests.length).toBe(requestsBeforeCancelledExclusion);

    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="clear"]').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(launcher).toBeVisible();
    await launcher.locator('button[data-action="dismiss"]').click();
    await expect(launcher).toHaveCount(0);
    await page.waitForTimeout(1_100);
    await expect(launcher).toHaveCount(0);
    await page.evaluate(() => history.pushState({}, '', '/pi-translator-bilingual-article-e2e-next'));
    await expect(launcher).toBeVisible();
    await launcher.locator('button[data-action="dismiss"]').click();

    await page.evaluate(() => {
      const chineseParagraph = '这是一段用于双语阅读的中文正文，包含完整的自然语言叙述、阅读上下文和足够的信息密度，应当只在目标语言不是中文时提供整页翻译入口。';
      document.querySelectorAll<HTMLElement>('article > h1, article > p, article > blockquote')
        .forEach((element, index) => {
          element.textContent = `${chineseParagraph}${chineseParagraph}（第 ${index + 1} 段）`;
        });
      history.pushState({}, '', '/pi-translator-bilingual-chinese-article');
    });
    await page.waitForTimeout(1_100);
    await expect(launcher).toHaveCount(0);

    await popup.bringToFront();
    await popup.locator('#target-language').selectOption('en');
    await expect(popup.locator('#status')).toContainText('目标语言已更新');
    await page.bringToFront();
    await expect(launcher).toBeVisible();
    await expect(launcher.locator('.count')).toHaveText('· 7 段');

    await popup.bringToFront();
    await popup.locator('#target-language').selectOption('zh-CN');
    await expect(popup.locator('#status')).toContainText('目标语言已更新');
    await page.bringToFront();
    await expect(launcher).toHaveCount(0);
  } finally {
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#pi-translator-bilingual-page-control')?.shadowRoot
        ?.querySelector<HTMLButtonElement>('button[data-action="clear"]')?.click();
    }).catch(() => undefined);
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { remove(key: string): Promise<void> } } };
      }).chrome;
      await api.storage.session.remove('translationCacheByTab');
    }).catch(() => undefined);
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.bringToFront().catch(() => undefined);
      await popup.reload().catch(() => undefined);
      await popup.locator('#target-language').selectOption(originalTargetLanguage).catch(() => undefined);
    }
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL).catch(() => undefined);
  }
});

test('restores explicitly retained webpage progress after session loss and translates only changed content', async () => {
  const popup = await context.newPage();
  let originalTargetLanguage = 'zh-CN';
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    originalTargetLanguage = await popup.locator('#target-language').inputValue();
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.locator('#target-language').selectOption('zh-CN');
      await expect(popup.locator('#status')).toContainText('目标语言已更新');
    }
    await page.bringToFront();
    const startResponse = await popup.evaluate(async (articleUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          runtime: { sendMessage(message: object): Promise<unknown> };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === articleUrl);
      return api.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId: tab?.id, targetLanguage: 'zh-CN' },
      });
    }, ARTICLE_FIXTURE_URL) as { ok?: boolean };
    expect(startResponse.ok).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    await expect(page.locator('#pi-translator-bilingual-page-control output'))
      .toContainText('已完成 7/7');
    await expect(page.locator('#pi-translator-bilingual-page-control .bar'))
      .toHaveAttribute('data-collapsed', 'true');

    const initialPageControl = page.locator('#pi-translator-bilingual-page-control');
    await initialPageControl.locator('button[data-action="compact"]').click();
    await initialPageControl.locator('details.more > summary').click();
    await initialPageControl.locator('button[data-action="retention"]').click();
    await expect(initialPageControl.locator('button[data-action="retention"]'))
      .toHaveText('不再本机保留');
    await initialPageControl.locator('button[data-action="compact"]').click();
    await expect.poll(() => popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.local.get('bilingualPageRetainedV1');
      return JSON.stringify(result.bilingualPageRetainedV1 ?? []);
    })).toContain('page-');
    const retainedSerialization = await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.local.get('bilingualPageRetainedV1');
      return JSON.stringify(result.bilingualPageRetainedV1 ?? []);
    });
    expect(retainedSerialization).not.toContain(ARTICLE_FIXTURE_URL);
    expect(retainedSerialization).not.toContain(
      'Bilingual reading should preserve the original article',
    );

    const introTranslation = page.locator(
      '#article-intro + [data-pi-bilingual-translation]',
    );
    await introTranslation.hover();
    await introTranslation.locator('button[data-action="visibility"]')
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(introTranslation).toHaveAttribute('data-pi-bilingual-hidden', '');
    const preRefreshDisplay = page.locator(
      '#pi-translator-bilingual-page-control select[data-action="display"]',
    );
    await preRefreshDisplay.selectOption('translation');
    await expect(page.locator('#article-intro')).not.toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-method')).toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await page.waitForTimeout(250);
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { remove(key: string | string[]): Promise<void> } } };
      }).chrome;
      await api.storage.session.remove([
        'translationCacheByTab',
        'bilingualPageSessionsByTabV1',
      ]);
    });

    const requestsBeforeRefresh = textRequests.length;
    mockControl.bilingualArticleRevision = 1;
    await page.reload();
    const restoredState = await popup.evaluate(async (articleUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          runtime: { sendMessage(message: object): Promise<unknown> };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === articleUrl);
      return api.runtime.sendMessage({
        type: 'GET_BILINGUAL_PAGE_STATE',
        payload: { tabId: tab?.id },
      });
    }, ARTICLE_FIXTURE_URL) as { ok?: boolean };
    expect(restoredState.ok).toBe(true);
    await page.bringToFront();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    const pageControl = page.locator('#pi-translator-bilingual-page-control');
    await expect(pageControl).toBeVisible();
    await expect(pageControl.locator('output')).toContainText('已从本机恢复 6 段');
    await expect(pageControl.locator('select[data-action="display"]'))
      .toHaveValue('translation');
    await expect(page.locator('#article-intro + [data-pi-bilingual-translation]'))
      .toHaveAttribute('data-pi-bilingual-hidden', '');
    await expect(page.locator('#article-intro')).not.toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-method + [data-pi-bilingual-translation]'))
      .toBeVisible();
    await expect(page.locator('#article-method')).toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-new + [data-pi-bilingual-translation]'))
      .toBeVisible();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(8);
    await expect(pageControl.locator('output')).toContainText('已完成 8/8');
    await expect(pageControl.locator('.bar')).toHaveAttribute('data-collapsed', 'true');
    expect(textRequests.length - requestsBeforeRefresh).toBe(1);

    await pageControl.locator('button[data-action="compact"]').click();
    await pageControl.locator('details.more > summary').click();
    await expect(pageControl.locator('button[data-action="retention"]'))
      .toHaveText('不再本机保留');
    await pageControl.locator('button[data-action="clear"]').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
    await expect.poll(() => popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.session.get('bilingualPageSessionsByTabV1');
      return JSON.stringify(result.bilingualPageSessionsByTabV1 ?? {}).includes('page-');
    })).toBe(false);
    await expect.poll(() => popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.local.get('bilingualPageRetainedV1');
      return JSON.stringify(result.bilingualPageRetainedV1 ?? []).includes('page-');
    })).toBe(false);
  } finally {
    mockControl.bilingualArticleRevision = 0;
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#pi-translator-bilingual-page-control')?.shadowRoot
        ?.querySelector<HTMLButtonElement>('button[data-action="clear"]')?.click();
    }).catch(() => undefined);
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            session: { remove(keys: string | string[]): Promise<void> };
            local: { remove(key: string): Promise<void> };
          };
        };
      }).chrome;
      await api.storage.session.remove([
        'translationCacheByTab',
        'bilingualPageSessionsByTabV1',
      ]);
      await api.storage.local.remove('bilingualPageRetainedV1');
    }).catch(() => undefined);
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.bringToFront().catch(() => undefined);
      await popup.reload().catch(() => undefined);
      await popup.locator('#target-language').selectOption(originalTargetLanguage)
        .catch(() => undefined);
    }
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL).catch(() => undefined);
  }
});

test('completes bilingual article translation without scrolling and keeps controls safe', async ({}, testInfo) => {
  const popup = await context.newPage();
  const sidePanel = await context.newPage();
  let originalTargetLanguage = 'zh-CN';
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { remove(key: string): Promise<void> } } };
      }).chrome;
      await api.storage.session.remove('bilingualParagraphActionsHintSeen');
    });
    originalTargetLanguage = await popup.locator('#target-language').inputValue();
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.locator('#target-language').selectOption('zh-CN');
      await expect(popup.locator('#status')).toContainText('目标语言已更新');
    }
    const tabId = await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { query(query: object): Promise<Array<{ id?: number }>> } };
      }).chrome;
      return (await api.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    });
    expect(tabId).toBeDefined();
    const historyBefore = await popup.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get('translationHistoryByTab');
      const history = stored.translationHistoryByTab as Record<string, unknown[]> | undefined;
      return history?.[String(id)]?.length ?? 0;
    }, tabId!);
    const requestsBefore = textRequests.length;
    const initialBilingualRequestStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;

    const translatePage = popup.locator('#translate-page');
    await expect(translatePage).toBeVisible();
    await expect(translatePage).toHaveClass(/primary-action/);
    await expect(translatePage).toHaveText('翻译网页正文');
    await popup.evaluate(() => {
      document.querySelector<HTMLButtonElement>('#translate-page')?.click();
    });

    const pageControl = page.locator('#pi-translator-bilingual-page-control');
    await expect(pageControl).toBeVisible();
    await initialBilingualRequestStarted;
    await pageControl.locator('button[data-action="pause"]').click();
    await expect(pageControl.locator('output')).toContainText('已暂停');
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    const hintedTranslation = page.locator('[data-pi-bilingual-translation]').first();
    await expect(hintedTranslation).toBeVisible();
    await expect(hintedTranslation).toHaveAttribute('data-pi-bilingual-hint', '');
    const hintedActions = hintedTranslation.locator('[data-pi-bilingual-actions]');
    await expect(hintedActions.locator('[data-pi-bilingual-feedback]'))
      .toHaveText('悬停译文可复制、重译或隐藏');
    await expect.poll(() => hintedActions.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).opacity),
    )).toBeGreaterThan(0);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await page.screenshot({
        path: testInfo.outputPath('bilingual-paragraph-actions-hint.png'),
        fullPage: false,
      });
    }
    await hintedActions.getByRole('button', { name: '复制' }).click();
    await expect(hintedTranslation).not.toHaveAttribute('data-pi-bilingual-hint', '');
    await expect(hintedActions.locator('[data-pi-bilingual-feedback]'))
      .toHaveText('译文已复制');
    // A request already sent before pausing is allowed to finish; no new request
    // should begin once that active paragraph has settled.
    await page.waitForTimeout(450);
    const translatedWhilePaused = await page.locator('[data-pi-bilingual-translation]').count();
    await page.waitForTimeout(450);
    await expect(page.locator('[data-pi-bilingual-translation]'))
      .toHaveCount(translatedWhilePaused);

    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await sidePanel.reload();
    const sidePanelControl = sidePanel.locator('#bilingual-page-control');
    await expect(sidePanelControl).toBeVisible();
    await expect(sidePanelControl).toHaveAttribute('data-phase', 'paused');
    await expect(sidePanelControl.locator('.bilingual-page-mark img'))
      .toHaveAttribute('src', /brand\/pi_logo\.png$/);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已暂停');
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('继续');
    await expect(sidePanel.locator('#bilingual-page-progress')).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-progress'))
      .toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(sidePanel.locator('#bilingual-page-retention')).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-retention-status'))
      .toHaveText('默认只保留在当前 Edge 会话');
    await expect(sidePanel.locator('#bilingual-page-retention-manage')).toHaveText('管理');
    await expect(sidePanel.locator('#bilingual-page-retention-toggle')).not.toBeChecked();
    await sidePanel.setViewportSize({ width: 300, height: 720 });
    const controlLayout = await sidePanelControl.evaluate((control) => ({
      clientWidth: control.clientWidth,
      scrollWidth: control.scrollWidth,
      borderRadius: getComputedStyle(control).borderRadius,
      boxShadow: getComputedStyle(control).boxShadow,
      markDisplay: getComputedStyle(
        control.querySelector<HTMLElement>('.bilingual-page-mark')!,
      ).display,
      primaryHeight: control.querySelector<HTMLButtonElement>('#bilingual-page-primary')!
        .getBoundingClientRect().height,
      displayHeight: control.querySelector<HTMLSelectElement>('#bilingual-page-display')!
        .getBoundingClientRect().height,
      languageHeight: control.querySelector<HTMLSelectElement>('#bilingual-page-language')!
        .getBoundingClientRect().height,
      retentionSwitchHeight: control.querySelector<HTMLInputElement>(
        '#bilingual-page-retention-toggle',
      )!.getBoundingClientRect().height,
    }));
    expect(controlLayout.scrollWidth).toBeLessThanOrEqual(controlLayout.clientWidth + 1);
    expect(controlLayout.borderRadius).toBe('0px');
    expect(controlLayout.boxShadow).toBe('none');
    expect(controlLayout.markDisplay).toBe('none');
    expect(controlLayout.primaryHeight).toBeGreaterThanOrEqual(33);
    expect(controlLayout.displayHeight).toBeGreaterThanOrEqual(31);
    expect(controlLayout.languageHeight).toBeGreaterThanOrEqual(31);
    expect(controlLayout.retentionSwitchHeight).toBeGreaterThanOrEqual(16);
    const retentionToggle = sidePanel.locator('#bilingual-page-retention-toggle');
    await retentionToggle.check();
    await expect(retentionToggle).toBeChecked();
    await expect(sidePanel.locator('#bilingual-page-retention-status'))
      .toContainText('不保存原文与网址');
    await expect.poll(() => sidePanel.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.local.get('bilingualPageRetainedV1');
      return JSON.stringify(result.bilingualPageRetainedV1 ?? []).includes('page-');
    })).toBe(true);
    await retentionToggle.uncheck();
    await expect(retentionToggle).not.toBeChecked();
    await expect(sidePanel.locator('#bilingual-page-retention-status'))
      .toHaveText('默认只保留在当前 Edge 会话');
    await expect.poll(() => sidePanel.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const result = await api.storage.local.get('bilingualPageRetainedV1');
      return JSON.stringify(result.bilingualPageRetainedV1 ?? []).includes('page-');
    })).toBe(false);
    const exportBeforeCopy = await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'GET_BILINGUAL_PAGE_EXPORT',
        payload: { tabId: id },
      });
    }, tabId!) as {
      ok: true;
      data: {
        export: {
          translationText: string;
          bilingualMarkdown: string;
          printableHtml: string;
          blockCount: number;
          totalBlockCount: number;
          complete: boolean;
        };
      };
    };
    expect(exportBeforeCopy.ok).toBe(true);
    expect(exportBeforeCopy.data.export.blockCount).toBeGreaterThan(0);
    await sidePanel.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __piCopiedText?: string };
      scope.__piCopiedText = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            scope.__piCopiedText = value;
          },
        },
      });
    });
    const requestsBeforeCopy = textRequests.length;
    const copyMenu = sidePanel.locator('#bilingual-page-copy-menu');
    await expect(copyMenu).toBeVisible();
    await copyMenu.locator(':scope > summary').click();
    await sidePanel.locator('#bilingual-page-copy-translation').click();
    await expect(sidePanel.locator('#bilingual-page-copy-feedback')).toContainText('段译文');
    expect(await sidePanel.evaluate(() => (
      globalThis as typeof globalThis & { __piCopiedText?: string }
    ).__piCopiedText))
      .toBe(exportBeforeCopy.data.export.translationText);
    await copyMenu.locator(':scope > summary').click();
    await sidePanel.locator('#bilingual-page-copy-bilingual').click();
    await expect(sidePanel.locator('#bilingual-page-copy-feedback'))
      .toContainText('双语 Markdown');
    expect(await sidePanel.evaluate(() => (
      globalThis as typeof globalThis & { __piCopiedText?: string }
    ).__piCopiedText))
      .toBe(exportBeforeCopy.data.export.bilingualMarkdown);
    expect(exportBeforeCopy.data.export.bilingualMarkdown).toContain('> ');
    await copyMenu.locator(':scope > summary').click();
    const htmlDownloadPromise = sidePanel.waitForEvent('download');
    await sidePanel.locator('#bilingual-page-download-html').click();
    const htmlDownload = await htmlDownloadPromise;
    expect(htmlDownload.suggestedFilename()).toBe('pi-translator-webpage-bilingual.html');
    const htmlDownloadPath = await htmlDownload.path();
    expect(htmlDownloadPath).toBeTruthy();
    const htmlContent = await readFile(htmlDownloadPath!, 'utf8');
    expect(htmlContent).toContain('Pi Translator 双语译文');
    expect(htmlContent).toContain(exportBeforeCopy.data.export.complete
      ? `完整结果 · ${exportBeforeCopy.data.export.blockCount} 段`
      : `部分结果 · 已完成 ${exportBeforeCopy.data.export.blockCount}/${exportBeforeCopy.data.export.totalBlockCount} 段`);
    expect(htmlContent).not.toContain(ARTICLE_FIXTURE_URL);
    expect(htmlContent).not.toContain('<script');
    await expect(sidePanel.locator('#bilingual-page-copy-feedback'))
      .toContainText('已下载可打印 HTML');
    expect(textRequests.length).toBe(requestsBeforeCopy);
    const copyMenuLayout = await copyMenu.evaluate((menu) => ({
      right: menu.getBoundingClientRect().right,
      viewportWidth: innerWidth,
    }));
    expect(copyMenuLayout.right).toBeLessThanOrEqual(copyMenuLayout.viewportWidth);
    await pageControl.locator('details.more > summary').click();
    await expect(pageControl.locator('button[data-action="copy-translation"]')).toBeVisible();
    await expect(pageControl.locator('button[data-action="copy-bilingual"]')).toBeVisible();
    await expect(pageControl.locator('button[data-action="download-html"]')).toBeVisible();
    await pageControl.locator('details.more > summary').click();
    const inPageProgressLayout = await pageControl.locator('.bar').evaluate((bar) => {
      const barRect = bar.getBoundingClientRect();
      const progress = bar.querySelector<HTMLElement>('.progress')!.getBoundingClientRect();
      return {
        bottomGap: barRect.bottom - progress.bottom,
        leftInset: progress.left - barRect.left,
        rightInset: barRect.right - progress.right,
        languageBorder: getComputedStyle(
          bar.querySelector<HTMLSelectElement>('[data-action="language"]')!,
        ).borderTopWidth,
      };
    });
    expect(Math.abs(inPageProgressLayout.bottomGap)).toBeLessThanOrEqual(2);
    expect(inPageProgressLayout.leftInset).toBeGreaterThanOrEqual(8);
    expect(inPageProgressLayout.rightInset).toBeGreaterThanOrEqual(8);
    expect(inPageProgressLayout.languageBorder).toBe('0px');
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await Promise.all([
        page.screenshot({ path: testInfo.outputPath('bilingual-article-paused.png'), fullPage: false }),
        sidePanel.screenshot({ path: testInfo.outputPath('bilingual-sidepanel-300.png'), fullPage: true }),
      ]);
      await Promise.all([
        page.emulateMedia({ colorScheme: 'dark' }),
        sidePanel.emulateMedia({ colorScheme: 'dark' }),
      ]);
      await Promise.all([
        page.screenshot({ path: testInfo.outputPath('bilingual-article-paused-dark.png'), fullPage: false }),
        sidePanel.screenshot({ path: testInfo.outputPath('bilingual-sidepanel-300-dark.png'), fullPage: true }),
      ]);
      await Promise.all([
        page.emulateMedia({ colorScheme: 'light' }),
        sidePanel.emulateMedia({ colorScheme: 'light' }),
      ]);
    }

    const resumedBilingualRequestStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;
    await sidePanel.locator('#bilingual-page-primary').click();
    await resumedBilingualRequestStarted;
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('全文翻译中');
    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="stop"]').click();
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    await expect(pageControl.locator('output')).toContainText('已停止');
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已停止');
    const translatedAfterStop = await page.locator('[data-pi-bilingual-translation]').count();
    await page.waitForTimeout(350);
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(translatedAfterStop);
    await sidePanel.locator('#bilingual-page-primary').click();
    await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toBeVisible();
    await expect(page.locator('#article-intro')).toHaveText(
      'Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.',
    );
    await expect(page.locator('#article-code + [data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(page.locator('#article-navigation + [data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(page.locator('#article-form-help + [data-pi-bilingual-translation]')).toHaveCount(0);

    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成');
    await expect(sidePanelControl).toHaveAttribute('data-phase', 'complete');
    await expect(sidePanel.locator('#bilingual-page-progress'))
      .toHaveAttribute('aria-valuenow', '100');
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    const requestsWithoutScroll = JSON.stringify(textRequests.slice(requestsBefore));
    expect(requestsWithoutScroll).toContain('The full article task should translate this later paragraph');
    expect(requestsWithoutScroll).not.toContain('translateAllParagraphs');
    const pageControlBar = pageControl.locator('.bar');
    const compactPageControl = pageControl.locator('button[data-action="compact"]');
    await expect(pageControlBar).toHaveAttribute('data-collapsed', 'true');
    await expect(compactPageControl).toHaveAttribute('aria-expanded', 'false');
    await compactPageControl.click();
    await expect(pageControlBar).toHaveAttribute('data-collapsed', 'false');
    await expect(page.locator('#article-intro-repeat + [data-pi-bilingual-translation]'))
      .toBeVisible();
    const articleRequests = textRequests.slice(requestsBefore);
    const introRequest = articleRequests.find((body) => JSON.stringify(body).includes(
      'Bilingual reading should preserve the original article',
    ));
    const introUserContent = (introRequest?.messages as Array<{
      role?: string;
      content?: unknown;
    }> | undefined)?.find((message) => message.role === 'user')?.content;
    expect(typeof introUserContent).toBe('string');
    const introPayload = JSON.parse(introUserContent as string) as {
      text?: string;
      referenceContext?: string;
      segments?: Array<{ id?: string; text?: string }>;
    };
    expect(introPayload.segments?.some((segment) => segment.text ===
      'Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.'
    )).toBe(true);
    expect(introPayload.text).toContain('A practical guide to reliable bilingual reading');
    expect(introPayload.text).toContain(
      'Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.',
    );
    if (introPayload.referenceContext) {
      expect(introPayload.referenceContext).not.toContain(
        'Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.',
      );
      expect(introPayload.referenceContext.length).toBeLessThanOrEqual(800);
    }
    const completedRequests = JSON.stringify(textRequests.slice(requestsBefore));
    expect(completedRequests).toContain('`npm run build:edge`');
    expect(completedRequests).toContain('⟦FULL1_0001⟧');
    expect(completedRequests).not.toContain('duplicated rendered x 2');
    expect(completedRequests).not.toContain('legacy preview x 2');
    expect(completedRequests).not.toContain('g(x)=x³+1');
    const renderedFormulaTranslation = page.locator(
      '#article-inline-code + [data-pi-bilingual-translation]',
    );
    await expect(renderedFormulaTranslation.locator('.pi-math-inline')).toBeVisible();
    await expect(renderedFormulaTranslation.locator('.pi-math-inline math')).toBeVisible();
    await expect(renderedFormulaTranslation.locator('[data-pi-bilingual-text]'))
      .not.toContainText('$f(x)=x^2$');
    const visualFormulaTranslation = page.locator(
      '#article-summary + [data-pi-bilingual-translation]',
    );
    const visualFormulaNotice = visualFormulaTranslation.locator(
      '[data-pi-bilingual-formula-notice]',
    );
    await expect(visualFormulaNotice).toContainText('本段公式无法读取，已保留原文');
    await expect(visualFormulaNotice.getByRole('button', { name: '框选识别' })).toBeVisible();

    const introTranslation = page.locator(
      '#article-intro + [data-pi-bilingual-translation]',
    );
    const introActions = introTranslation.locator('[data-pi-bilingual-actions]');
    await expect(introActions).toHaveAttribute('role', 'toolbar');
    expect(await introActions.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
    await introTranslation.hover();
    await expect.poll(() => introActions.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).opacity),
    )).toBeGreaterThan(0);
    const copyTranslation = introActions.getByRole('button', { name: '复制' });
    const retranslateBlock = introActions.getByRole('button', { name: '重译本段' });
    const toggleTranslation = introActions.getByRole('button', { name: '隐藏' });
    await retranslateBlock.focus();
    expect(await retranslateBlock.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThan(27.9);
    await copyTranslation.click();
    await expect(introActions.locator('[data-pi-bilingual-feedback]'))
      .toContainText('译文已复制');
    await toggleTranslation.click();
    await expect(introTranslation).toHaveAttribute('data-pi-bilingual-hidden', '');
    await expect(introTranslation.locator('[data-pi-bilingual-text]')).toBeHidden();
    await expect(introActions.getByRole('button', { name: '显示译文' })).toBeVisible();

    const globalDisplay = sidePanel.locator('#bilingual-page-display');
    const pageDisplay = pageControl.locator('select[data-action="display"]');
    await expect(globalDisplay).toBeVisible();
    await expect(globalDisplay).toHaveValue('bilingual');
    await expect(pageDisplay).toHaveValue('bilingual');
    const requestsBeforeDisplayChange = textRequests.length;
    await globalDisplay.selectOption('translation');
    await expect(globalDisplay).toHaveValue('translation');
    await expect(pageDisplay).toHaveValue('translation');
    await expect(page.locator('#article-intro')).not.toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-method')).toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-code')).not.toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await expect(page.locator('#article-summary')).not.toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    expect(textRequests.length).toBe(requestsBeforeDisplayChange);
    await introActions.getByRole('button', { name: '显示译文' }).press('Enter');
    await expect(introTranslation).not.toHaveAttribute('data-pi-bilingual-hidden', '');
    await expect(page.locator('#article-intro')).toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await pageDisplay.selectOption('source');
    await expect(globalDisplay).toHaveValue('source');
    expect(await page.locator('[data-pi-bilingual-translation]').evaluateAll((translations) =>
      translations.every((translation) => (
        translation.hasAttribute('data-pi-bilingual-global-hidden') &&
        getComputedStyle(translation).display === 'none'
      )),
    )).toBe(true);
    await expect(page.locator('[data-pi-bilingual-source-hidden]')).toHaveCount(0);
    expect(textRequests.length).toBe(requestsBeforeDisplayChange);
    await pageDisplay.selectOption('bilingual');
    await expect(globalDisplay).toHaveValue('bilingual');
    await expect(introTranslation).not.toHaveAttribute('data-pi-bilingual-hidden', '');
    await expect(introTranslation.locator('[data-pi-bilingual-text]')).toBeVisible();
    await expect(page.locator(
      '#article-inline-code + [data-pi-bilingual-translation]',
    )).toBeVisible();
    expect(textRequests.length).toBe(requestsBeforeDisplayChange);

    const requestsBeforeVisualFormula = textRequests.length;
    await visualFormulaNotice.getByRole('button', { name: '框选识别' }).click();
    const visualFormulaRegion = page.locator('#pi-web-region-selection-root');
    await expect(visualFormulaRegion).toBeVisible();
    await expect(visualFormulaRegion.locator('.selection')).toHaveAttribute('data-visible', 'true');
    const seededFormulaRegion = await visualFormulaRegion.locator('.selection').boundingBox();
    const sourceFormulaRegion = await page.locator('#article-summary').boundingBox();
    expect(seededFormulaRegion).not.toBeNull();
    expect(sourceFormulaRegion).not.toBeNull();
    if (seededFormulaRegion && sourceFormulaRegion) {
      expect(Math.abs(seededFormulaRegion.x - Math.max(0, sourceFormulaRegion.x - 6)))
        .toBeLessThanOrEqual(2);
      expect(seededFormulaRegion.width).toBeGreaterThanOrEqual(sourceFormulaRegion.width);
    }
    await visualFormulaRegion.getByRole('button', { name: '取消' }).click();
    await expect(visualFormulaRegion).toHaveCount(0);
    await expect(visualFormulaTranslation).toBeVisible();
    expect(textRequests.length).toBe(requestsBeforeVisualFormula);

    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      });
      expect(await page.evaluate(() => matchMedia('(any-hover: none)').matches)).toBe(true);
      const moreActions = introActions.locator('button[data-action="more"]');
      await expect(moreActions).toBeVisible();
      await expect(moreActions).toHaveText('更多');
      await expect(moreActions).toHaveAttribute('aria-expanded', 'false');
      await expect(copyTranslation).toBeHidden();
      expect(await moreActions.evaluate((button) => button.getBoundingClientRect().height))
        .toBeGreaterThan(27.9);
      await moreActions.click();
      await expect(moreActions).toHaveText('收起');
      await expect(moreActions).toHaveAttribute('aria-expanded', 'true');
      await expect(copyTranslation).toBeVisible();
      if (process.env.PI_VISUAL_ARTIFACTS === '1') {
        await page.screenshot({
          path: testInfo.outputPath('bilingual-paragraph-actions-touch.png'),
          fullPage: false,
        });
      }
      await moreActions.press('Enter');
      await expect(moreActions).toHaveAttribute('aria-expanded', 'false');
      await expect(copyTranslation).toBeHidden();
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await expect.poll(() => page.evaluate(
        () => matchMedia('(any-hover: none)').matches,
      )).toBe(false);
      await cdp.detach();
    }

    mockControl.returnBilingualRetranslationOnce = true;
    const requestsBeforeRetranslation = textRequests.length;
    await retranslateBlock.focus();
    await retranslateBlock.press('Enter');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeRetranslation);
    await expect(introTranslation.locator('[data-pi-bilingual-text]'))
      .toHaveText('重新翻译后的段落只替换当前译文。');
    await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toHaveCount(1);
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 7/7');

    const formulaTranslation = page.locator(
      '#article-inline-code + [data-pi-bilingual-translation]',
    );
    const formulaActions = formulaTranslation.locator('[data-pi-bilingual-actions]');
    mockControl.failBilingualFormulaPreservation = true;
    const requestsBeforeFailedRetranslation = textRequests.length;
    await formulaTranslation.hover();
    const formulaRetranslate = formulaActions.getByRole('button', { name: '重译本段' });
    await formulaRetranslate.focus();
    await formulaRetranslate.press('Enter');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeFailedRetranslation);
    await expect(formulaActions.locator('[data-pi-bilingual-feedback]'))
      .toContainText('重译失败');
    await expect(formulaTranslation.locator('.pi-math-inline math')).toBeVisible();
    await expect(page.locator('#article-inline-code + [data-pi-bilingual-error]')).toHaveCount(0);
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 7/7');
    mockControl.failBilingualFormulaPreservation = false;
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await introTranslation.hover();
      await page.screenshot({
        path: testInfo.outputPath('bilingual-paragraph-actions.png'),
        fullPage: false,
      });
    }

    const dynamicText = 'A dynamically loaded paragraph should join the active full-page translation without requiring the reader to scroll.';
    const requestsBeforeDynamicBlock = textRequests.length;
    await globalDisplay.selectOption('source');
    await expect(globalDisplay).toHaveValue('source');
    await page.locator('article').evaluate((article, text) => {
      const paragraph = document.createElement('p');
      paragraph.id = 'article-dynamic';
      paragraph.textContent = text;
      article.append(paragraph);
    }, dynamicText);
    const dynamicTranslation = page.locator(
      '#article-dynamic + [data-pi-bilingual-translation]',
    );
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeDynamicBlock);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 8/8');
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(8);
    await expect(dynamicTranslation).toHaveAttribute('data-pi-bilingual-global-hidden', '');
    await expect(dynamicTranslation).toBeHidden();
    await globalDisplay.selectOption('bilingual');
    await expect(globalDisplay).toHaveValue('bilingual');
    await expect(dynamicTranslation).not.toHaveAttribute('data-pi-bilingual-global-hidden', '');
    await expect(dynamicTranslation).toBeVisible();

    const requestsBeforeSameTextRerender = textRequests.length;
    await page.locator('#article-dynamic').evaluate((paragraph) => {
      paragraph.replaceWith(paragraph.cloneNode(true));
    });
    await expect(dynamicTranslation).toBeVisible();
    await page.waitForTimeout(650);
    expect(textRequests.length).toBe(requestsBeforeSameTextRerender);
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(8);

    const heldDynamicText = 'A held dynamically loaded paragraph keeps its request visible while the reader pauses translation.';
    const heldDynamicStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;
    await page.locator('article').evaluate((article, text) => {
      const paragraph = document.createElement('p');
      paragraph.id = 'article-dynamic-held';
      paragraph.textContent = text;
      article.append(paragraph);
    }, heldDynamicText);
    await heldDynamicStarted;
    const heldDynamicPending = page.locator(
      '#article-dynamic-held + [data-pi-bilingual-pending]',
    );
    await expect(heldDynamicPending).toBeVisible();
    await globalDisplay.selectOption('source');
    await expect(globalDisplay).toHaveValue('source');
    await expect(heldDynamicPending).toHaveCount(0);
    await globalDisplay.selectOption('bilingual');
    await expect(globalDisplay).toHaveValue('bilingual');
    await expect(heldDynamicPending).toBeVisible();
    await pageControl.locator('button[data-action="pause"]').click();
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已暂停');

    const pausedDynamicText = 'A paragraph added during the pause must wait for the reader to resume before using the translation API.';
    const requestsWhilePaused = textRequests.length;
    await page.locator('article').evaluate((article, text) => {
      const paragraph = document.createElement('p');
      paragraph.id = 'article-dynamic-paused';
      paragraph.textContent = text;
      article.append(paragraph);
    }, pausedDynamicText);
    await page.waitForTimeout(650);
    expect(JSON.stringify(textRequests.slice(requestsWhilePaused))).not.toContain(pausedDynamicText);
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    await expect(page.locator(
      '#article-dynamic-held + [data-pi-bilingual-translation]',
    )).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已暂停');
    expect(JSON.stringify(textRequests.slice(requestsWhilePaused))).not.toContain(pausedDynamicText);
    await sidePanel.locator('#bilingual-page-primary').click();
    await expect(page.locator(
      '#article-dynamic-paused + [data-pi-bilingual-translation]',
    )).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 10/10');

    await page.locator('article').evaluate((article) => {
      const heading = document.createElement('h1');
      heading.id = 'spa-article-title';
      heading.textContent = 'A different dynamically routed article replaces the previous bilingual document';
      const firstParagraph = document.createElement('p');
      firstParagraph.id = 'spa-article-intro';
      firstParagraph.textContent = 'The new route should ask the reader before translating a substantially different article.';
      const secondParagraph = document.createElement('p');
      secondParagraph.id = 'spa-article-detail';
      secondParagraph.textContent = 'Translations from the previous route must disappear instead of attaching to unrelated content.';
      article.replaceChildren(heading, firstParagraph, secondParagraph);
    });
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('页面正文已更新');
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('开始');
    await sidePanel.locator('#bilingual-page-primary').click();
    await expect(page.locator('#spa-article-intro + [data-pi-bilingual-translation]'))
      .toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 3/3');
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(3);

    const languagePopup = await context.newPage();
    try {
      await languagePopup.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.bringToFront();
      await languagePopup.reload();
      const popupPageLanguage = languagePopup.locator('#target-language');
      const sidePanelPageLanguage = sidePanel.locator('#bilingual-page-language');
      const pageControlLanguage = pageControl.locator('select[data-action="language"]');
      await expect(popupPageLanguage).toHaveValue('zh-CN');
      await expect(sidePanelPageLanguage).toHaveValue('zh-CN');
      await expect(pageControlLanguage).toHaveValue('zh-CN');

      const requestsBeforeCancelledPopupSwitch = textRequests.length;
      await popupPageLanguage.selectOption('ja');
      const popupLanguageConfirmation = languagePopup.locator(
        '#bilingual-language-confirmation',
      );
      await expect(popupLanguageConfirmation).toBeVisible();
      await expect(languagePopup.locator('#bilingual-language-message'))
        .toHaveText('切换为日语将清除已译 3 段，并重新调用翻译接口。');
      await expect(popupPageLanguage).toHaveValue('zh-CN');
      await expect(sidePanelPageLanguage).toHaveValue('zh-CN');
      await expect(pageControlLanguage).toHaveValue('zh-CN');
      expect(textRequests).toHaveLength(requestsBeforeCancelledPopupSwitch);
      await languagePopup.locator('#bilingual-language-cancel').click();
      await expect(popupLanguageConfirmation).toBeHidden();
      await expect(languagePopup.locator('#status')).toContainText('已保留当前中文正文');
      await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(3);
      expect(textRequests).toHaveLength(requestsBeforeCancelledPopupSwitch);

      await popupPageLanguage.selectOption('ja');
      await expect(popupLanguageConfirmation).toBeVisible();
      await languagePopup.locator('#bilingual-language-confirm').click();
      await expect(sidePanelPageLanguage).toHaveValue('ja');
      await expect(pageControlLanguage).toHaveValue('ja');
      await expect(popupLanguageConfirmation).toBeHidden();
      await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 3/3');
      await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(3);
      await expect.poll(() => JSON.stringify(
        textRequests.slice(requestsBeforeCancelledPopupSwitch),
      )).toContain('to ja');
      await pageControl.locator('button[data-action="compact"]').click();
      await expect(pageControl.locator('.bar')).toHaveAttribute('data-collapsed', 'false');

      const requestsBeforeCancelledSidePanelSwitch = textRequests.length;
      await sidePanelPageLanguage.selectOption('de');
      const sidePanelLanguageConfirmation = sidePanel.locator(
        '#bilingual-page-language-confirmation',
      );
      await expect(sidePanelLanguageConfirmation).toBeVisible();
      await expect(sidePanel.locator('#bilingual-page-language-message'))
        .toHaveText('切换为德语将清除已译 3 段，并重新调用翻译接口。');
      await sidePanel.locator('#bilingual-page-language-cancel').click();
      await expect(sidePanelLanguageConfirmation).toBeHidden();
      await expect(sidePanelPageLanguage).toHaveValue('ja');
      await expect(pageControlLanguage).toHaveValue('ja');
      expect(textRequests).toHaveLength(requestsBeforeCancelledSidePanelSwitch);

      const requestsBeforeCancelledPageSwitch = textRequests.length;
      await pageControlLanguage.selectOption('fr');
      const pageLanguageConfirmation = pageControl.locator('.language-confirmation');
      await expect(pageLanguageConfirmation).toBeVisible();
      await expect(pageLanguageConfirmation.locator('span'))
        .toHaveText('切换为法语将清除已译 3 段，并重新调用翻译接口。');
      await pageLanguageConfirmation.locator('button[data-action="cancel-language"]').click();
      await expect(pageLanguageConfirmation).toBeHidden();
      await expect(pageControlLanguage).toHaveValue('ja');
      await expect(sidePanelPageLanguage).toHaveValue('ja');
      expect(textRequests).toHaveLength(requestsBeforeCancelledPageSwitch);

      await sidePanel.locator('#bilingual-page-clear').click();
      await expect(pageControl).toHaveCount(0);
      await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
      const requestsBeforeIdleLanguageChoice = textRequests.length;
      await sidePanelPageLanguage.selectOption('de');
      await expect(sidePanelPageLanguage).toHaveValue('de');
      await expect(sidePanelLanguageConfirmation).toBeHidden();
      expect(textRequests).toHaveLength(requestsBeforeIdleLanguageChoice);
      await sidePanel.locator('#bilingual-page-primary').click();
      await expect(pageControl.locator('select[data-action="language"]')).toHaveValue('de');
      await expect.poll(() => JSON.stringify(
        textRequests.slice(requestsBeforeIdleLanguageChoice),
      )).toContain('to de');

      const historyAfter = await sidePanel.evaluate(async (id) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
        }).chrome;
        const stored = await api.storage.session.get('translationHistoryByTab');
        const history = stored.translationHistoryByTab as Record<string, unknown[]> | undefined;
        return history?.[String(id)]?.length ?? 0;
      }, tabId!);
      expect(historyAfter).toBe(historyBefore);

      await sidePanel.locator('#bilingual-page-clear').click();
      await expect(pageControl).toHaveCount(0);

      await page.bringToFront();
      await languagePopup.reload();
      await expect(popupPageLanguage).toHaveValue('ja');
      await popupPageLanguage.selectOption('zh-CN');
      await expect(languagePopup.locator('#status')).toContainText('目标语言已更新');
      await expect(sidePanelPageLanguage).toHaveValue('zh-CN');
    } finally {
      await languagePopup.close().catch(() => undefined);
      await page.bringToFront();
    }

    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
    await expect(pageControl).toHaveCount(0);
    await expect(sidePanel.locator('#bilingual-page-clear')).toBeHidden();
    await expect(sidePanel.locator('#bilingual-page-display-control')).toBeHidden();

    await page.reload();
    await page.locator('#article-inline-code').evaluate((paragraph) => {
      paragraph.append(' Retry isolation fixture.');
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.bringToFront();
    await sidePanel.reload();
    mockControl.failBilingualFormulaPreservation = true;
    await sidePanel.locator('#bilingual-page-primary').click();
    const blockError = page.locator('#article-inline-code + [data-pi-bilingual-error]');
    await expect(blockError).toBeVisible();
    await expect(page.locator('[data-pi-bilingual-pending]')).toHaveCount(0);
    await expect(blockError).toContainText('本段未译');
    await expect(blockError.locator('button')).toHaveText('重试本段');
    await expect(page.locator('[data-pi-bilingual-translation]').first()).toBeVisible();
    await expect(page.locator('[data-pi-bilingual-hint]')).toHaveCount(0);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('1 段待重试');
    await expect(sidePanel.locator('#bilingual-page-control'))
      .toHaveAttribute('data-phase', 'warning');
    await expect(pageControl.locator('.bar')).toHaveAttribute('data-phase', 'warning');
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('重试 1 段');
    await expect(page.locator('#article-later + [data-pi-bilingual-translation]')).toBeVisible();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(6);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await blockError.scrollIntoViewIfNeeded();
      await Promise.all([
        page.screenshot({ path: testInfo.outputPath('bilingual-block-error.png'), fullPage: false }),
        sidePanel.screenshot({ path: testInfo.outputPath('bilingual-block-error-sidepanel.png'), fullPage: true }),
      ]);
    }
    mockControl.failBilingualFormulaPreservation = false;
    const retryRequestsBefore = textRequests.length;
    await blockError.locator('button').click();
    await expect.poll(() => textRequests.length).toBeGreaterThan(retryRequestsBefore);
    await expect(blockError).toHaveCount(0);
    await expect(page.locator(
      '#article-inline-code + [data-pi-bilingual-translation] .pi-math-inline math',
    )).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 7/7');
    await sidePanel.locator('#bilingual-page-clear').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);

    await page.reload();
    await page.locator('#article-title').evaluate((title) => {
      title.textContent = 'Failure recovery keeps reliable bilingual reading under user control';
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.bringToFront();
    await sidePanel.reload();
    await expect(sidePanel.locator('#bilingual-page-control')).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('开始');
    mockControl.bilingualFailuresRemaining = 2;
    await sidePanel.locator('#bilingual-page-primary').click();
    await expect(page.locator('#pi-translator-bilingual-page-control')).toBeVisible();
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('重试');
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('请求过于频繁');
    await sidePanel.locator('#bilingual-page-primary').click();
    await expect(page.locator('[data-pi-bilingual-translation]').first()).toBeVisible();
    await sidePanel.locator('#bilingual-page-clear').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
  } finally {
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    if (originalTargetLanguage !== 'zh-CN' && !popup.isClosed()) {
      await popup.locator('#target-language').selectOption(originalTargetLanguage).catch(() => undefined);
      await popup.locator('#status').waitFor({ state: 'visible' }).catch(() => undefined);
    } else if (originalTargetLanguage !== 'zh-CN') {
      const settingsPage = await context.newPage();
      await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await settingsPage.locator('#target-language').selectOption(originalTargetLanguage).catch(() => undefined);
      await expect(settingsPage.locator('#status')).toContainText('目标语言已更新');
      await settingsPage.close();
    }
    await sidePanel.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { remove(key: string): Promise<void> } } };
      }).chrome;
      await api.storage.local.remove('bilingualPageRetainedV1');
    }).catch(() => undefined);
    await sidePanel.close().catch(() => undefined);
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});

test('translates a 520-paragraph webpage and exposes a later safety limit without false completion', async () => {
  test.setTimeout(90_000);
  const popup = await context.newPage();
  let bridge: Page | undefined;
  let originalTargetLanguage = 'zh-CN';
  try {
    await page.goto(LONG_ARTICLE_FIXTURE_URL);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    originalTargetLanguage = await popup.locator('#target-language').inputValue();
    if (originalTargetLanguage !== 'zh-CN') {
      await popup.locator('#target-language').selectOption('zh-CN');
      await expect(popup.locator('#status')).toContainText('目标语言已更新');
    }
    const tabId = await popup.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { query(query: object): Promise<Array<{ id?: number }>> } };
      }).chrome;
      return (await api.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    });
    expect(tabId).toBeDefined();
    const requestCountBeforePreview = textRequests.length;
    await popup.evaluate(() => {
      document.querySelector<HTMLButtonElement>('#translate-page')?.click();
    });

    const pageControl = page.locator('#pi-translator-bilingual-page-control');
    await expect(pageControl).toBeVisible();
    await expect(pageControl.locator('.control-title')).toHaveText('确认全文翻译');
    await expect(pageControl.locator('output')).toContainText('已识别 520 段');
    await expect(pageControl.locator('output')).toContainText('预计约 87 次批量请求');
    await expect(pageControl.locator('.start-confirmation')).toContainText(
      '确认前不会调用翻译接口',
    );
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0);
    expect(textRequests.length).toBe(requestCountBeforePreview);

    bridge = await context.newPage();
    await bridge.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await bridge.reload();
    await expect(bridge.locator('#bilingual-page-control')).toHaveAttribute(
      'data-phase',
      'preview',
    );
    await expect(bridge.locator('#bilingual-page-status')).toContainText('发现 520 段');
    await expect(bridge.locator('#bilingual-page-status')).toContainText('预计约 87 次批量请求');
    await expect(bridge.locator('#bilingual-page-primary')).toHaveText('翻译全部');
    await expect(bridge.locator('#bilingual-page-scope')).toBeVisible();
    await expect(bridge.locator('#bilingual-page-progress')).toBeHidden();
    await expect(bridge.locator('#bilingual-page-retention')).toBeHidden();
    await expect(bridge.locator('#bilingual-page-clear')).toHaveText('取消');

    await bridge.locator('#bilingual-page-scope').click();
    await expect(page.locator('[data-pi-bilingual-scope-preview]')).toHaveCount(520);
    await expect(pageControl.locator('.control-title')).toHaveText('选择翻译范围');
    await expect(pageControl.locator('output')).toContainText('预计约 87 次批量请求');
    const scopePanel = pageControl.locator('.scope-panel');
    const allScope = scopePanel.locator('button[data-action="scope-all"]');
    const chapterScope = scopePanel.locator('button[data-action="scope-chapter"]');
    const fromHereScope = scopePanel.locator('button[data-action="scope-from-here"]');
    await expect(allScope).toHaveAttribute('aria-pressed', 'true');
    await expect(chapterScope).toBeEnabled();
    await expect(fromHereScope).toBeEnabled();
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await page.locator('#long-paragraph-0401').evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
    await fromHereScope.click();
    await expect(fromHereScope).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#long-paragraph-0400')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await expect(page.locator('#long-paragraph-0420')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'included',
    );
    await expect(scopePanel.locator('.scope-message')).toContainText('当前位置以下正文');
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await chapterScope.click();
    await expect(chapterScope).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#long-paragraph-0360')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await expect(page.locator('#long-paragraph-0361')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'included',
    );
    await expect(page.locator('#long-paragraph-0480')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'included',
    );
    await expect(page.locator('#long-paragraph-0481')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await expect(pageControl.locator('output')).toContainText('正文范围 120/520 段');
    await expect(pageControl.locator('output')).toContainText('预计约 20 次批量请求');
    await expect(scopePanel.locator('.scope-message')).toContainText('当前章节');
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await allScope.click();
    await expect(allScope).toHaveAttribute('aria-pressed', 'true');
    await expect(pageControl.locator('output')).toContainText('正文范围 520/520 段');
    await expect(pageControl.locator('output')).toContainText('预计约 87 次批量请求');
    await expect(page.locator('[data-pi-bilingual-scope-preview="included"]')).toHaveCount(520);
    expect(textRequests.length).toBe(requestCountBeforePreview);
    await pageControl.locator('button[data-action="cancel-scope"]').click();
    await expect(page.locator('[data-pi-bilingual-scope-preview]')).toHaveCount(0);
    await expect(pageControl.locator('.control-title')).toHaveText('确认全文翻译');
    await expect(bridge.locator('#bilingual-page-primary')).toHaveText('翻译全部');
    expect(textRequests.length).toBe(requestCountBeforePreview);

    await bridge.locator('#bilingual-page-primary').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(520, {
      timeout: 90_000,
    });
    await expect(pageControl.locator('output')).toContainText('已完成 520/520');
    await expect(page.locator(
      '#long-paragraph-0520 + [data-pi-bilingual-translation]',
    )).toBeVisible();

    await bridge.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'CONTROL_BILINGUAL_PAGE',
        payload: { tabId: id, action: 'display-translation' },
      });
    }, tabId!);
    await expect(page.locator('#long-paragraph-0401')).toHaveAttribute(
      'data-pi-bilingual-source-hidden',
      'block',
    );
    await page.locator(
      '#long-paragraph-0401 + [data-pi-bilingual-translation]',
    ).evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const requestsBeforeTranslationOnlyScope = textRequests.length;
    await pageControl.locator('button[data-action="scope"]').evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await pageControl.locator('button[data-action="scope-from-here"]').click();
    await expect(page.locator('#long-paragraph-0400')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'excluded',
    );
    await expect(page.locator('#long-paragraph-0420')).toHaveAttribute(
      'data-pi-bilingual-scope-preview',
      'included',
    );
    expect(textRequests.length).toBe(requestsBeforeTranslationOnlyScope);
    await pageControl.locator('button[data-action="cancel-scope"]').click();
    await bridge.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'CONTROL_BILINGUAL_PAGE',
        payload: { tabId: id, action: 'display-bilingual' },
      });
    }, tabId!);

    const completeExport = await bridge.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'GET_BILINGUAL_PAGE_EXPORT',
        payload: { tabId: id },
      });
    }, tabId!) as {
      ok: true;
      data: { export: {
        blockCount: number;
        totalBlockCount: number;
        contentTruncated: boolean;
        complete: boolean;
      } };
    };
    expect(completeExport.data.export).toMatchObject({
      blockCount: 520,
      totalBlockCount: 520,
      contentTruncated: false,
      complete: true,
    });

    const overflowRequestStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;
    await page.locator('article').evaluate((article) => {
      const fragment = document.createDocumentFragment();
      for (let index = 1; index <= 685; index += 1) {
        const paragraph = document.createElement('p');
        paragraph.textContent = `Overflow article paragraph ${String(index).padStart(4, '0')} contains enough prose to verify that the safety limit is visible.`;
        fragment.append(paragraph);
      }
      article.append(fragment);
    });
    await overflowRequestStarted;
    await expect(pageControl.locator('button[data-action="scope"]')).toHaveText('范围 1200+');
    await expect(pageControl.locator('output')).toContainText('页面仍有后续正文');

    const partialExport = await bridge.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'GET_BILINGUAL_PAGE_EXPORT',
        payload: { tabId: id },
      });
    }, tabId!) as {
      ok: true;
      data: { export: {
        blockCount: number;
        totalBlockCount: number;
        contentTruncated: boolean;
        complete: boolean;
        translationMarkdown: string;
      } };
    };
    expect(partialExport.data.export).toMatchObject({
      blockCount: 520,
      totalBlockCount: 1_200,
      contentTruncated: true,
      complete: false,
    });
    expect(partialExport.data.export.translationMarkdown)
      .toContain('页面仍有后续正文超出安全上限');

    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="stop"]').click();
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    await expect(pageControl.locator('output')).toContainText('已停止');
    await pageControl.locator('details.more > summary').click();
    await pageControl.locator('button[data-action="clear"]').click();
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(0, {
      timeout: 30_000,
    });
  } finally {
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    mockControl.holdNextBilingualRequest = false;
    if (originalTargetLanguage !== 'zh-CN') {
      const settingsPage = popup.isClosed() ? await context.newPage() : popup;
      if (popup.isClosed()) await settingsPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await settingsPage.locator('#target-language').selectOption(originalTargetLanguage)
        .catch(() => undefined);
      if (settingsPage !== popup) await settingsPage.close().catch(() => undefined);
    }
    await bridge?.close().catch(() => undefined);
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL).catch(() => undefined);
  }
});

test('reprioritizes pending bilingual paragraphs around the current viewport', async ({}, testInfo) => {
  const popup = await context.newPage();
  const titleText = 'A practical guide to reliable bilingual reading. Viewport queue priority fixture.';
  const oldQueuedText = 'This initially nearby paragraph should wait after the reader jumps to a distant section.';
  const laterOldQueuedText = 'This second old paragraph must remain pending when the next batch is reprioritized.';
  const currentViewportText = 'This paragraph at the current reading position should be translated before the old queue.';
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await page.locator('article').evaluate((article, fixture) => {
      const title = document.createElement('h1');
      title.id = 'priority-title';
      title.textContent = fixture.titleText;
      const oldQueued = document.createElement('p');
      oldQueued.id = 'priority-old-queued';
      oldQueued.textContent = fixture.oldQueuedText;
      const laterOldQueued = document.createElement('p');
      laterOldQueued.id = 'priority-later-old-queued';
      laterOldQueued.textContent = fixture.laterOldQueuedText;
      const spacer = document.createElement('div');
      spacer.style.height = '2800px';
      spacer.setAttribute('aria-hidden', 'true');
      const currentViewport = document.createElement('p');
      currentViewport.id = 'priority-current-viewport';
      currentViewport.textContent = fixture.currentViewportText;
      article.replaceChildren(title, oldQueued, laterOldQueued, spacer, currentViewport);
    }, { titleText, oldQueuedText, laterOldQueuedText, currentViewportText });
    await page.evaluate(() => window.scrollTo(0, 0));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();

    const requestsBefore = textRequests.length;
    const firstRequestStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;
    const startResponse = await popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          runtime: { sendMessage(message: object): Promise<unknown> };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id === undefined) throw new Error('Article tab not found.');
      return api.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId: tab.id, targetLanguage: 'zh-CN' },
      });
    }, page.url());
    expect(startResponse).toMatchObject({ ok: true });
    await firstRequestStarted;
    const titlePending = page.locator(
      '#priority-title + [data-pi-bilingual-pending]',
    );
    await expect(titlePending).toBeVisible();
    await expect(titlePending).toHaveText('正在翻译此段…');
    expect(await titlePending.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      opacity: Number.parseFloat(getComputedStyle(element).opacity),
    }))).toMatchObject({
      height: expect.any(Number),
      opacity: 0.56,
    });
    expect(await titlePending.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThanOrEqual(24);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await page.screenshot({
        path: testInfo.outputPath('bilingual-paragraph-pending.png'),
        fullPage: false,
      });
    }
    await page.locator('#priority-current-viewport').scrollIntoViewIfNeeded();
    await expect.poll(() => page.locator('#priority-current-viewport').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.bottom >= 0 && bounds.top <= window.innerHeight;
    })).toBe(true);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;

    await expect(page.locator(
      '#priority-title + [data-pi-bilingual-translation]',
    )).toBeAttached();
    await expect(page.locator(
      '#priority-current-viewport + [data-pi-bilingual-translation]',
    )).toBeVisible();
    await expect(page.locator('[data-pi-bilingual-pending]')).toHaveCount(0);
    await expect.poll(() => textRequests.length).toBeGreaterThanOrEqual(requestsBefore + 2);
    const requestedSources = textRequests.slice(requestsBefore).flatMap((body) => {
      const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
      const content = messages?.find((message) => message.role === 'user')?.content;
      if (typeof content !== 'string') return [];
      try {
        const payload = JSON.parse(content) as {
          text?: unknown;
          segments?: Array<{ text?: unknown }>;
        };
        if (Array.isArray(payload.segments)) {
          return payload.segments.flatMap((segment) => (
            typeof segment.text === 'string' ? [segment.text] : []
          ));
        }
        return typeof payload.text === 'string' ? [payload.text] : [content];
      } catch {
        return [content];
      }
    });
    expect(requestedSources[0]).toBe(titleText);
    expect(requestedSources.indexOf(currentViewportText)).toBeGreaterThan(0);
    expect(requestedSources.indexOf(currentViewportText))
      .toBeLessThan(requestedSources.indexOf(laterOldQueuedText));
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#pi-translator-bilingual-page-control')?.shadowRoot
        ?.querySelector<HTMLButtonElement>('button[data-action="clear"]')?.click();
    });
  } finally {
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});

test('prioritizes an explicit selection and resumes bilingual article translation without a false failure', async () => {
  const popup = await context.newPage();
  const sidePanel = await context.newPage();
  try {
    await page.goto(ARTICLE_FIXTURE_URL);
    await page.locator('#article-title').evaluate((element) => {
      element.append(' Interactive selection priority fixture.');
    });
    await page.locator('#article-intro').evaluate((element) => {
      element.append(' Explicit selection priority fixture.');
    });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();

    const bilingualStarted = new Promise<void>((resolve) => {
      mockControl.bilingualRequestStarted = resolve;
    });
    mockControl.heldBilingualRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldBilingualRequest = resolve;
    });
    mockControl.holdNextBilingualRequest = true;
    const startResponse = await popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          runtime: { sendMessage(message: object): Promise<unknown> };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id === undefined) throw new Error('Article tab not found.');
      return api.runtime.sendMessage({
        type: 'START_BILINGUAL_PAGE',
        payload: { tabId: tab.id, targetLanguage: 'zh-CN' },
      });
    }, page.url());
    expect(startResponse).toMatchObject({ ok: true });
    await bilingualStarted;
    const bilingualPending = page.locator(
      '#article-title + [data-pi-bilingual-pending]',
    );
    await expect(bilingualPending).toBeVisible();
    await popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: {
          query(query: object): Promise<Array<{ id?: number; url?: string }>>;
          sendMessage(tabId: number, message: object): Promise<unknown>;
        } };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id !== undefined) {
        await api.tabs.sendMessage(tab.id, { type: 'BROWSER_SIDEBAR_CLOSED' });
      }
    }, page.url());
    const historyBefore = await popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id === undefined) throw new Error('Article tab not found.');
      const stored = await api.storage.session.get('translationHistoryByTab');
      const history = stored.translationHistoryByTab as Record<string, unknown[]> | undefined;
      return history?.[String(tab.id)]?.length ?? 0;
    }, page.url());

    const interactiveStarted = new Promise<void>((resolve) => {
      mockControl.interactiveRequestStarted = resolve;
    });
    mockControl.heldInteractiveRequestGate = new Promise<void>((resolve) => {
      mockControl.releaseHeldInteractiveRequest = resolve;
    });
    mockControl.holdNextInteractiveRequest = true;
    await selectElementText('#article-intro');
    const overlay = page.locator('#tex-selection-translator-root');
    const startedAutomatically = await Promise.race([
      interactiveStarted.then(() => true),
      page.waitForTimeout(450).then(() => false),
    ]);
    if (!startedAutomatically) {
      await popup.evaluate(async (targetUrl) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          } };
        }).chrome;
        const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
        if (tab?.id === undefined) throw new Error('Article tab not found.');
        await api.tabs.sendMessage(tab.id, { type: 'TRIGGER_TRANSLATE' });
      }, page.url());
      await interactiveStarted;
    }
    await expect(bilingualPending).toHaveCount(0);

    const pageControl = page.locator('#pi-translator-bilingual-page-control');
    await expect(pageControl.locator('output'))
      .toContainText('正在处理划词，正文稍后继续');
    await expect(pageControl.locator('button[data-action="pause"]')).toBeDisabled();
    await expect(page.locator('[data-pi-bilingual-error]')).toHaveCount(0);

    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await sidePanel.reload();
    await expect(sidePanel.locator('#bilingual-page-status'))
      .toContainText('正在处理划词，正文稍后继续');
    await expect(sidePanel.locator('#bilingual-page-primary')).toHaveText('稍后继续');
    await expect(sidePanel.locator('#bilingual-page-primary')).toBeDisabled();

    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldBilingualRequest = undefined;
    mockControl.releaseHeldInteractiveRequest?.();
    mockControl.releaseHeldInteractiveRequest = undefined;
    await expect.poll(() => popup.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          storage: { session: { get(key: string): Promise<Record<string, unknown>> } };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
      if (tab?.id === undefined) return -1;
      const stored = await api.storage.session.get('translationHistoryByTab');
      const history = stored.translationHistoryByTab as Record<string, unknown[]> | undefined;
      return history?.[String(tab.id)]?.length ?? 0;
    }, page.url())).toBe(historyBefore + 1);
    await expect(page.locator('[data-pi-bilingual-error]')).toHaveCount(0);
    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('全文翻译中');

    await expect(sidePanel.locator('#bilingual-page-status')).toContainText('已完成 7/7');
    await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(7);
    await expect(page.locator('#article-intro + [data-pi-bilingual-translation]')).toHaveCount(1);
    await expect(page.locator('[data-pi-bilingual-error]')).toHaveCount(0);
    await sidePanel.locator('#bilingual-page-clear').click();
  } finally {
    (mockControl.releaseHeldBilingualRequest as (() => void) | undefined)?.();
    mockControl.releaseHeldInteractiveRequest?.();
    await sidePanel.close().catch(() => undefined);
    if (!popup.isClosed()) {
      await popup.evaluate(async (targetUrl) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          } };
        }).chrome;
        const tab = (await api.tabs.query({})).find((candidate) => candidate.url === targetUrl);
        if (tab?.id !== undefined) {
          await api.tabs.sendMessage(tab.id, { type: 'BROWSER_SIDEBAR_CLOSED' });
        }
      }, page.url()).catch(() => undefined);
    }
    await popup.close().catch(() => undefined);
    await page.goto(OVERLEAF_FIXTURE_URL);
  }
});

test('keeps passive code browsing quiet while continuous and explicit translation remain available', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await clearBrowserSelection();
  const close = overlay.locator('.surface-close');
  if (await close.isVisible().catch(() => false)) await close.click();

  for (const selector of ['#code-source', '#terminal-source', '#latex-structure']) {
    await selectElementText(selector);
    await page.waitForTimeout(240);
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  }

  await selectElementText('#overleaf-editor-prose');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const requestsBeforePassiveSidebarSelection = textRequests.length;
  await selectElementText('#code-source');
  await expect.poll(() => textRequests.length).toBe(requestsBeforePassiveSidebarSelection + 1);
  await expect(overlay.locator('.body')).not.toBeEmpty();
  const requestsBeforeMixedSidebarSelection = textRequests.length;
  await selectElementText('#mixed-code-source');
  await expect.poll(() => textRequests.length).toBe(requestsBeforeMixedSidebarSelection + 1);
  await expect(overlay.locator('.body')).not.toBeEmpty();
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');

  await selectElementText('#code-source');
  await page.waitForTimeout(240);
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  const sender = await context.newPage();
  try {
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    await sender.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          };
        };
      }).chrome;
      const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
      if (target?.id === undefined) throw new Error('Missing target tab for explicit translation.');
      await api.tabs.sendMessage(target.id, { type: 'TRIGGER_TRANSLATE' });
    }, page.url());
  } finally {
    await sender.close();
  }
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.body')).not.toBeEmpty();
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});
