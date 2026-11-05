import {openTranslationMore} from './support/translation-controls';
import type { Page } from '@playwright/test';
import {
  clearBrowserSelection,
  closeVisibleTranslationSurfaceForCleanup,
  context,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  OVERLEAF_FIXTURE_URL,
  page,
  selectElementText,
  setStoredSidebarMode,
  test,
  textRequests,
  type TestChromeApi,
  type TestChromeStorageArea,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('keeps complete supplementary meanings available below the primary browser-sidebar translation', async ({}, info) => {
  const panel = await context.newPage();
  try {
    await setStoredSidebarMode('floating');
    await page.goto(OVERLEAF_FIXTURE_URL);
    await selectElementText('#lookup-source');
    const overlay = page.locator('#tex-selection-translator-root');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
    const before = textRequests.length;
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', {name: '在浏览器侧栏中显示', exact: true}).click();
    await panel.setViewportSize({width: 360, height: 780});
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await expect(panel.locator('#translation-text')).toHaveText('连续性');
    await expect(panel.locator('#lexical-summary')).toHaveText('补充释义（1）');
    await expect(panel.locator('#lexical-senses')).toBeHidden();
    const complete = await panel.locator('.lexical-sense').allTextContents();
    expect(complete.join('')).toContain('连贯性');
    await panel.screenshot({path: info.outputPath('browser-lookup-collapsed.png')});
    await panel.locator('#lexical-summary').focus();
    await panel.keyboard.press('Enter');
    await expect(panel.locator('#lexical-senses')).toBeVisible();
    expect(await panel.locator('.lexical-sense').allTextContents()).toEqual(complete);
    const primary = await panel.locator('#translation-text').boundingBox();
    const details = await panel.locator('#lexical-details').boundingBox();
    expect(details!.y).toBeGreaterThanOrEqual(primary!.y + primary!.height);
    const lineHeight = await panel.locator('#translation-text').evaluate(node => parseFloat(getComputedStyle(node).lineHeight));
    expect(primary!.height).toBeLessThanOrEqual(lineHeight * 2);
    expect(await panel.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await panel.screenshot({path: info.outputPath('browser-lookup-expanded.png')});
    await panel.keyboard.press('Enter');
    await expect(panel.locator('#lexical-senses')).toBeHidden();
    expect(textRequests).toHaveLength(before);
  } finally {
    await panel.close();
    await setStoredSidebarMode('floating');
    await page.bringToFront();
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
  }
});
test('carries the currently displayed translation when switching back to the page sidebar', async ({}, info) => {
  const panel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await setStoredSidebarMode('floating');
    await page.goto(OVERLEAF_FIXTURE_URL);
    await selectElementText('#lookup-source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', {name:'在浏览器侧栏中显示',exact:true}).click();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await selectElementText('#source');
    await expect(panel.locator('#translation-text')).toContainText('一致的学术翻译');
    await panel.setViewportSize({width:360,height:760});
    await panel.screenshot({path:info.outputPath('browser-sidebar-light.png')});
    await panel.emulateMedia({colorScheme:'dark'});
    await expect.poll(() => panel.locator('#web-sidebar-switch').evaluate(el => getComputedStyle(el).color)).toBe('rgb(237, 237, 237)');
    await panel.screenshot({path:info.outputPath('browser-sidebar-dark.png')});
    const calls = textRequests.length;
    await panel.locator('#web-sidebar-switch').click();
    await expect(overlay).toHaveAttribute('data-pi-view','sidebar');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.screenshot({path:info.outputPath('page-sidebar.png')});
    expect(textRequests).toHaveLength(calls);
    await overlay.locator('details.more > summary').click();
    await overlay.locator('.correction-action').click();
    const draft=overlay.locator('.correction-text-part').first();
    await draft.fill('页面侧栏未保存的修正');
    await overlay.locator('.sidebar-switch-action').click();
    await expect(draft).toHaveValue('页面侧栏未保存的修正');
    await expect(overlay).toHaveAttribute('data-pi-view','sidebar');
  } finally {
    await panel.close();
    await setStoredSidebarMode('floating');
    await page.bringToFront();
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
  }
});
test('carries the selected recent translation when switching sidebars', async () => {
  const panel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await setStoredSidebarMode('floating');
    await page.goto(OVERLEAF_FIXTURE_URL);
    await selectElementText('#lookup-source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button',{name:'在浏览器侧栏中显示',exact:true}).click();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await selectElementText('#source');
    await expect(panel.locator('#translation-text')).toContainText('一致的学术翻译');
    await panel.locator('#web-history-older').click();
    await expect(panel.locator('#translation-text')).toContainText('连续性');
    const calls=textRequests.length;
    await panel.locator('#web-sidebar-switch').click();
    await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
    expect(textRequests).toHaveLength(calls);
  } finally {
    await panel.close();
    await setStoredSidebarMode('floating');
    await page.bringToFront();
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
  }
});
test('moves webpage continuous translation into browser-owned side-panel space', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  let originalSentenceAlignmentDefault: boolean | undefined;
  try {
    await page.bringToFront();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    const requestsBeforeSwitch = textRequests.length;

    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '在浏览器侧栏中显示' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await page.waitForTimeout(250);
    expect(textRequests).toHaveLength(requestsBeforeSwitch);

    await sidePanel.setViewportSize({ width: 390, height: 760 });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await expect(sidePanel.locator('#session')).toBeVisible();
    await expect(sidePanel.locator('#app-subtitle')).toHaveText('网页划词翻译');
    await expect(sidePanel.locator('#source-kind-label')).toHaveText('当前网页');
    await expect(sidePanel.locator('#source-label')).toHaveText('www.overleaf.com');
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    await expect(sidePanel.locator('#open-pi-reader')).toHaveText('改用浮动侧栏');
    const browserTargetLanguage = sidePanel.getByLabel('目标语言');
    const initialTargetLanguage = await browserTargetLanguage.inputValue();
    const requestedTargetLanguage = initialTargetLanguage === 'en' ? 'ja' : 'en';
    const requestedTargetLabel = requestedTargetLanguage === 'en' ? '英文' : '日语';
    await expect(browserTargetLanguage).toBeEnabled();
    const requestsBeforeLanguageRetranslation = textRequests.length;
    await browserTargetLanguage.selectOption(requestedTargetLanguage);
    await expect.poll(() => textRequests.length)
      .toBeGreaterThan(requestsBeforeLanguageRetranslation);
    await expect(browserTargetLanguage).toHaveValue(requestedTargetLanguage);
    await expect(sidePanel.locator('#status')).toContainText(`已切换为${requestedTargetLabel}`);
    expect(JSON.stringify(textRequests.at(-1))).toContain(`to ${requestedTargetLanguage}`);
    expect(await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      return stored.extensionSettings?.targetLanguage;
    })).toBe(initialTargetLanguage);

    await browserTargetLanguage.selectOption(initialTargetLanguage);
    await expect(browserTargetLanguage).toHaveValue(initialTargetLanguage);
    await expect(browserTargetLanguage).toBeEnabled();
    await openTranslationMore(sidePanel);
    const webRegionAction = sidePanel.getByRole('button', { name: '框选网页', exact: true });
    await expect(webRegionAction).toBeVisible();
    expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);
    await sidePanel.keyboard.press('Escape');
    const browserPause = sidePanel.getByRole('button', {
      name: '暂停当前标签页的自动连续翻译',
    });
    await expect(browserPause).toHaveText('自动翻译中');
    await expect(browserPause).toHaveAttribute('aria-pressed', 'false');
    await browserPause.click();
    const browserResume = sidePanel.getByRole('button', {
      name: '继续当前标签页的自动连续翻译',
    });
    await expect(browserResume).toHaveText('已暂停');
    await expect(browserResume).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay).toHaveAttribute('data-pi-continuous-translation', 'paused');
    const browserSourceBeforePausedSelection = await sidePanel.locator('#source-text').textContent();
    const requestsBeforePausedBrowserSelection = textRequests.length;
    await selectElementText('#global-term-source');
    await page.waitForTimeout(450);
    expect(textRequests).toHaveLength(requestsBeforePausedBrowserSelection);
    await expect(sidePanel.locator('#source-text')).toHaveText(
      browserSourceBeforePausedSelection ?? '',
    );
    await browserResume.click();
    await expect(sidePanel.getByRole('button', {
      name: '暂停当前标签页的自动连续翻译',
    })).toHaveText('自动翻译中');
    await expect(overlay).toHaveAttribute('data-pi-continuous-translation', 'active');
    const storedModeAfterTemporaryOpen = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      return stored.extensionSettings?.sidebarMode;
    });
    expect(storedModeAfterTemporaryOpen).toBe('floating');
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-390-light.png'),
        fullPage: true,
      });
    }

    const requestsBeforeContinuousSelection = textRequests.length;
    await selectElementText('#multi-source');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeContinuousSelection);
    await expect(sidePanel.locator('#source-text')).toContainText('First important sentence');
    await expect(sidePanel.locator('#translation-text')).toContainText('第一句重要译文');

    const translationView = sidePanel.getByRole('group', { name: '译文显示方式' });
    const fullView = sidePanel.getByRole('button', { name: '显示完整译文' });
    const alignedView = sidePanel.getByRole('button', { name: '显示逐句对照' });
    await expect(translationView).toBeVisible();
    await expect(fullView).toHaveAttribute('aria-pressed', 'true');
    const requestsBeforeViewSwitch = textRequests.length;
    await alignedView.focus();
    await alignedView.press('Enter');
    await expect(alignedView).toBeFocused();
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    const alignedSegments = sidePanel.locator('.aligned-segment');
    await expect(alignedSegments).toHaveCount(2);
    await expect(alignedSegments.first().locator('.aligned-segment-source'))
      .toHaveText('First important sentence.');
    await expect(alignedSegments.first().locator('.aligned-segment-target'))
      .toContainText('第一句重要译文');
    await fullView.focus();
    await fullView.press('Enter');
    await expect(fullView).toBeFocused();
    await expect(fullView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeVisible();
    await expect(alignedSegments).toHaveCount(0);
    await alignedView.focus();
    await alignedView.press('Enter');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    await expect(alignedSegments).toHaveCount(2);
    expect(textRequests).toHaveLength(requestsBeforeViewSwitch);

    await sidePanel.setViewportSize({ width: 300, height: 720 });
    const alignedLayout = await sidePanel.locator('#translation-text').evaluate((result) => {
      const first = result.querySelector<HTMLElement>('.aligned-segment')!;
      const controls = [...document.querySelectorAll<HTMLElement>('#translation-view-switch button')];
      const header = document.querySelector<HTMLElement>('.app-header')!;
      const regionAction = document.querySelector<HTMLElement>('#start-web-region')!;
      const continuousToggle = document.querySelector<HTMLElement>(
        '#continuous-translation-toggle',
      )!;
      const targetLanguage = document.querySelector<HTMLElement>('#target-language')!;
      return {
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        headerClientWidth: header.clientWidth,
        headerScrollWidth: header.scrollWidth,
        regionActionHeight: regionAction.getBoundingClientRect().height,
        continuousToggleHeight: continuousToggle.getBoundingClientRect().height,
        targetLanguageHeight: targetLanguage.getBoundingClientRect().height,
        resultClientWidth: result.clientWidth,
        resultScrollWidth: result.scrollWidth,
        segmentClientWidth: first.clientWidth,
        segmentScrollWidth: first.scrollWidth,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(alignedLayout.pageScrollWidth).toBeLessThanOrEqual(alignedLayout.pageClientWidth + 1);
    expect(alignedLayout.headerScrollWidth).toBeLessThanOrEqual(alignedLayout.headerClientWidth + 1);
    await expect(sidePanel.locator('#start-web-region')).toBeHidden();
    expect(alignedLayout.continuousToggleHeight).toBeGreaterThanOrEqual(29);
    expect(alignedLayout.targetLanguageHeight).toBeGreaterThanOrEqual(31);
    expect(alignedLayout.resultScrollWidth).toBeLessThanOrEqual(alignedLayout.resultClientWidth + 1);
    expect(alignedLayout.segmentScrollWidth).toBeLessThanOrEqual(alignedLayout.segmentClientWidth + 1);
    expect(alignedLayout.controlHeights.every((height) => height >= 28)).toBe(true);
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => alignedSegments.first().evaluate((segment) => ({
      source: getComputedStyle(segment.querySelector<HTMLElement>('.aligned-segment-source')!).color,
      target: getComputedStyle(segment.querySelector<HTMLElement>('.aligned-segment-target')!).color,
    }))).toEqual({ source: 'rgb(167, 176, 191)', target: 'rgb(241, 244, 248)' });
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-aligned-300-dark.png'),
        fullPage: true,
      });
    }
    await sidePanel.emulateMedia({ colorScheme: 'light' });
    await sidePanel.setViewportSize({ width: 390, height: 760 });

    const browserHistory = sidePanel.locator('#web-history-navigation');
    const browserHistoryCounter = sidePanel.locator('#web-history-counter');
    const olderTranslation = sidePanel.getByRole('button', { name: '上一条译文' });
    const newerTranslation = sidePanel.getByRole('button', { name: '下一条译文' });
    await expect(browserHistory).toBeVisible();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [2-5]$/u);
    await expect(olderTranslation).toBeEnabled();
    await expect(newerTranslation).toBeDisabled();
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-history-390-light.png'),
        fullPage: true,
      });
    }
    const requestsBeforeHistoryNavigation = textRequests.length;
    await olderTranslation.click();
    await expect(browserHistoryCounter).toHaveText(/^2 \/ [2-5]$/u);
    await expect(browserTargetLanguage).toBeDisabled();
    await expect(sidePanel.locator('#source-text')).toContainText(
      'A consistent academic translation',
    );
    await expect(sidePanel.locator('#translation-text')).toContainText('经用户调整后');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(1);
    expect(textRequests).toHaveLength(requestsBeforeHistoryNavigation);
    await newerTranslation.click();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [2-5]$/u);
    await expect(browserTargetLanguage).toBeEnabled();
    await expect(sidePanel.locator('#translation-text')).toContainText('第一句重要译文');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(2);

    await olderTranslation.click();
    await selectElementText('#browser-history-source');
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(1);
    await expect(browserHistory).toBeVisible();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [3-5]$/u);
    await expect(newerTranslation).toBeDisabled();

    const requestsBeforeCorrectionOpen = textRequests.length;
    await openTranslationMore(sidePanel);
    await sidePanel.locator('#correct').click();
    await expect(sidePanel.getByRole('group', { name: '修正译文，公式已锁定' })).toBeVisible();
    await expect(browserTargetLanguage).toBeDisabled();
    await expect(translationView).toBeHidden();
    await expect(sidePanel.locator('#source-section')).toBeVisible();
    await sidePanel.getByRole('button', { name: '取消', exact: true }).click();
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    expect(textRequests).toHaveLength(requestsBeforeCorrectionOpen);

    await sidePanel.setViewportSize({ width: 300, height: 420 });
    originalSentenceAlignmentDefault = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      const previous = stored.extensionSettings?.sentenceAlignmentDefault === true;
      await extensionChrome.storage.local.set({
        extensionSettings: {
          ...(stored.extensionSettings ?? {}),
          sentenceAlignmentDefault: true,
        },
      });
      return previous;
    });
    await openTranslationMore(sidePanel);
    await sidePanel.locator('#correct').click();
    const switchDraft = sidePanel.locator('.correction-text-part').first();
    await switchDraft.fill('尚未保存的切换测试草稿');
    await sidePanel.locator('#web-sidebar-switch').click();
    await expect(sidePanel.locator('#status')).toContainText('请先完成或取消当前编辑');
    await expect(switchDraft).toHaveValue('尚未保存的切换测试草稿');
    await sidePanel.getByRole('button', { name: '取消', exact: true }).click();
    await sidePanel.locator('#web-sidebar-switch').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(overlay.locator('.header-tools .sidebar-switch-action')).toBeVisible();
    await overlay.locator('.sidebar-switch-action').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await sidePanel.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    const requestsBeforeLongResult = textRequests.length;
    await selectElementText('#browser-long-source');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeLongResult);
    await expect(sidePanel.locator('#source-text')).toContainText('A long browser side panel result');
    await expect(sidePanel.locator('#translation-text')).toContainText('只有确实超出一屏的结果');
    await expect(translationView).toBeVisible();
    const readingNavigation = sidePanel.getByRole('group', { name: '长译文阅读导航' });
    const readingProgress = sidePanel.locator('#reading-progress');
    const readingTop = sidePanel.getByRole('button', { name: '回到译文顶部' });
    const readingBottom = sidePanel.getByRole('button', { name: '前往译文底部' });
    await expect(readingNavigation).toBeVisible();
    await expect(readingProgress).toHaveText('顶部');
    await expect(readingTop).toBeDisabled();
    await expect(readingBottom).toBeEnabled();
    const newResultStart = await sidePanel.locator('#result-section').evaluate((result) => ({
      resultTop: result.getBoundingClientRect().top,
      headerBottom: document.querySelector<HTMLElement>('.app-header')!.getBoundingClientRect().bottom,
      historyHeight: document.querySelector<HTMLElement>('#web-history-navigation')!
        .getBoundingClientRect().height,
    }));
    expect(Math.abs(
      newResultStart.resultTop
      - newResultStart.headerBottom
      - newResultStart.historyHeight
      - 8,
    )).toBeLessThanOrEqual(1);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-reading-300-light.png'),
      });
    }

    const requestsBeforeReadingNavigation = textRequests.length;
    await readingBottom.click();
    await expect(readingProgress).toHaveText('底部');
    await expect(readingBottom).toBeDisabled();
    const longResultBottom = await sidePanel.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(longResultBottom).toBeGreaterThan(0);
    const stickyHistoryPosition = await browserHistory.evaluate((history) => ({
      historyTop: history.getBoundingClientRect().top,
      headerBottom: document.querySelector<HTMLElement>('.app-header')!.getBoundingClientRect().bottom,
    }));
    expect(Math.abs(stickyHistoryPosition.historyTop - stickyHistoryPosition.headerBottom))
      .toBeLessThanOrEqual(1);

    await olderTranslation.click();
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(readingNavigation).toBeHidden();
    await newerTranslation.click();
    await expect(sidePanel.locator('#source-text')).toContainText('A long browser side panel result');
    await expect(readingNavigation).toBeVisible();
    await expect(readingProgress).toHaveText('底部');
    await expect.poll(() => sidePanel.evaluate(() => {
      const scrolling = document.scrollingElement;
      return scrolling
        ? Math.max(0, scrolling.scrollHeight - scrolling.clientHeight - scrolling.scrollTop)
        : Number.POSITIVE_INFINITY;
    })).toBeLessThanOrEqual(2);

    const viewChangeGeometry = await sidePanel.evaluate(async () => {
      const samples:unknown[]=[];const sample=()=>{const root=document.scrollingElement!;samples.push({top:root.scrollTop,height:root.scrollHeight,viewport:root.clientHeight,progress:document.querySelector('#reading-progress')?.textContent,fonts:document.fonts.status})};
      sample();(document.querySelector('#translation-view-full') as HTMLButtonElement).click();
      for(let index=0;index<8;index++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));sample()}
      return samples;
    });
    await testInfo.attach('view-change-reading-geometry',{body:JSON.stringify(viewChangeGeometry,null,2),contentType:'application/json'});
    await expect(readingProgress).toHaveText('底部');
    const formulaView = sidePanel.locator('#formula-view');
    await expect(formulaView).toHaveText('源码');
    await openTranslationMore(sidePanel);
    await formulaView.click();
    await expect(formulaView).toHaveText('公式');
    await expect(readingProgress).toHaveText('底部');
    await alignedView.evaluate((button: HTMLButtonElement) => button.click());
    await expect(readingProgress).toHaveText('底部');
    expect(textRequests).toHaveLength(requestsBeforeReadingNavigation);

    await test.step('preserve the actual bottom across delayed math and source disclosure', async () => delayedReadingBottom(sidePanel, testInfo));
    await test.step('restore top and middle while yielding to manual reading', async () => delayedReadingInteraction(sidePanel));
    await test.step('ignore stale formula replies and retain an unsaved draft', async () => delayedReadingDraft(sidePanel));

    await readingTop.focus();
    await readingTop.press('Home');
    await expect(readingProgress).toHaveText('顶部');
    await expect(readingBottom).toBeFocused();
    await readingBottom.press('End');
    await expect(readingProgress).toHaveText('底部');
    await expect(readingTop).toBeFocused();
    const requestsBeforeCleanupSelection = textRequests.length;
    await selectElementText('#source');
    await expect(sidePanel.locator('#source-text')).toContainText(
      'A consistent academic translation',
    );
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    expect(textRequests.length - requestsBeforeCleanupSelection).toBeLessThanOrEqual(1);
    await sidePanel.setViewportSize({ width: 390, height: 760 });

    await openTranslationMore(sidePanel);

    await sidePanel.locator('#open-pi-reader').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const options = await context.newPage();
    try {
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#sidebar-mode')).toHaveValue('floating');
    } finally {
      await options.close();
    }
  } finally {
    await page.bringToFront();
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
    if (originalSentenceAlignmentDefault !== undefined && !sidePanel.isClosed()) {
      await sidePanel.evaluate(async (enabled) => {
        const extensionChrome = (
          globalThis as typeof globalThis & { chrome: TestChromeApi }
        ).chrome;
        const stored = await extensionChrome.storage.local.get('extensionSettings');
        await extensionChrome.storage.local.set({
          extensionSettings: {
            ...(stored.extensionSettings ?? {}),
            sentenceAlignmentDefault: enabled,
          },
        });
      }, originalSentenceAlignmentDefault).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
    await page.reload();
    await sidePanel.close();
  }
});

test('uses the preferred browser side panel from the result primary action', async () => {
  const sidePanel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  let browserSidebarOpened = false;
  try {
    await setStoredSidebarMode('browser');
    const options = await context.newPage();
    try {
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#sidebar-mode')).toHaveValue('browser');
    } finally {
      await options.close();
    }
    const popup = await context.newPage();
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popup.locator('#open-sidebar')).toHaveText('在浏览器侧栏中翻译');
    } finally {
      await popup.close();
    }
    await page.bringToFront();
    await selectElementText('#browser-history-source');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

    const primaryAction = overlay.getByRole('button', { name: '在浏览器侧栏中显示' });
    await expect(primaryAction).toBeVisible();
    await overlay.locator('details.more > summary').click();
    await expect(overlay.getByRole('button', { name: '在页面侧栏中显示' })).toBeVisible();
    await expect(overlay.locator('.menu').getByRole('button', { name: '在浏览器侧栏中显示' }))
      .toHaveCount(0);
    await overlay.locator('details.more > summary').click();

    const requestsBeforeOpen = textRequests.length;
    await primaryAction.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    expect(textRequests).toHaveLength(requestsBeforeOpen);

    await sidePanel.setViewportSize({ width: 390, height: 720 });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await expect(sidePanel.locator('#session')).toBeVisible();
    browserSidebarOpened = true;
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    const storedMode = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      return stored.extensionSettings?.sidebarMode;
    });
    expect(storedMode).toBe('browser');
  } finally {
    if (browserSidebarOpened && !sidePanel.isClosed()) {
      await openTranslationMore(sidePanel);
      await sidePanel.locator('#open-pi-reader').click();
      await page.bringToFront();
      await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    }
    await sidePanel.close();
    await setStoredSidebarMode('floating');
    await page.bringToFront();
    if (await overlay.locator('.surface-close').count()) {
      await overlay.locator('.surface-close').click();
    }
    await clearBrowserSelection();
  }
});

test('keeps narrow sidebar history navigation bounded and recoverable', async ({}, testInfo) => {
  const historyPage = await context.newPage();
  const historyFixtureUrl = `${OVERLEAF_FIXTURE_URL}?history-navigation=1`;
  try {
    await historyPage.setViewportSize({ width: 360, height: 700 });
    await historyPage.route(historyFixtureUrl, async (route) => {
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>
          <p id="history-one">A consistent academic translation improves the readability of research papers.</p>
          <p id="history-two">First important sentence. Second supporting sentence.</p>
          <p id="history-three">The adaptive sensing policy is stable in this document.</p>
        </body></html>`,
      });
    });
    await historyPage.goto(historyFixtureUrl);
    const selectText = async (selector: string): Promise<void> => {
      await historyPage.locator(selector).evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
    };
    const overlay = historyPage.locator('#tex-selection-translator-root');
    await selectText('#history-one');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await selectText('#history-two');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await selectText('#history-three');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');

    const counter = overlay.locator('.history-counter');
    const older = overlay.getByTitle('上一条翻译（Alt+↑）');
    const newer = overlay.getByTitle('下一条翻译（Alt+↓）');
    await expect(counter).toHaveText('1/3');
    await expect(counter).toHaveAttribute('aria-label', '第 1 条，共 3 条');
    await expect(older).toBeEnabled();
    await expect(newer).toBeDisabled();
    const navigationLayout = await overlay.locator('.surface').evaluate((surface) => {
      const tools = surface.querySelector<HTMLElement>('.header-tools')!;
      const surfaceBounds = surface.getBoundingClientRect();
      const toolsBounds = tools.getBoundingClientRect();
      const controls = [...tools.querySelectorAll<HTMLElement>('button')];
      return {
        surfaceLeft: surfaceBounds.left,
        surfaceRight: surfaceBounds.right,
        scrollWidth: surface.scrollWidth,
        clientWidth: surface.clientWidth,
        toolsLeft: toolsBounds.left,
        toolsRight: toolsBounds.right,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(navigationLayout.surfaceLeft).toBeGreaterThanOrEqual(8);
    expect(navigationLayout.surfaceRight).toBeLessThanOrEqual(352);
    expect(navigationLayout.scrollWidth).toBeLessThanOrEqual(navigationLayout.clientWidth + 1);
    expect(navigationLayout.toolsLeft).toBeGreaterThanOrEqual(navigationLayout.surfaceLeft);
    expect(navigationLayout.toolsRight).toBeLessThanOrEqual(navigationLayout.surfaceRight);
    expect(navigationLayout.controlHeights.every((height) => height >= 32)).toBe(true);

    await expect(counter).toHaveAttribute('title', '查看和搜索翻译历史（Alt+/）');
    await counter.click();
    const historySearch = overlay.getByRole('searchbox', { name: '搜索翻译历史' });
    const historySummary = overlay.locator('.history-summary');
    const historyItems = overlay.locator('.history-item');
    await expect(overlay.locator('.history-surface')).toBeVisible();
    await expect(historySearch).toBeFocused();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await expect(historyItems).toHaveCount(3);
    await expect(historyItems.first()).toHaveAttribute('aria-current', 'true');
    const historySearchLayout = await overlay.locator('.history-surface').evaluate((surface) => {
      const input = surface.querySelector<HTMLInputElement>('.history-search-field')!;
      const list = surface.querySelector<HTMLElement>('.history-list')!;
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        inputHeight: input.getBoundingClientRect().height,
        listHeight: list.getBoundingClientRect().height,
      };
    });
    expect(historySearchLayout.scrollWidth).toBeLessThanOrEqual(historySearchLayout.clientWidth + 1);
    expect(historySearchLayout.inputHeight).toBeGreaterThanOrEqual(32);
    expect(historySearchLayout.listHeight).toBeGreaterThan(120);
    if (process.env.PI_VISUAL_QA) {
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-history-search-360-light.png') });
      await historyPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-history-search-360-dark.png') });
      await historyPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }

    await historySearch.fill('supporting');
    await expect(historySummary).toHaveText('1 条匹配');
    await expect(historyItems).toHaveCount(1);
    await expect(historyItems.first()).toContainText('Second supporting sentence');
    await historySearch.press('ArrowDown');
    await expect(historyItems.first()).toBeFocused();
    await historyItems.first().press('Enter');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await expect(counter).toHaveText('2/3');
    await expect(counter).toBeFocused();

    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await expect(historySearch).toHaveValue('supporting');
    await overlay.getByRole('button', { name: '清空历史搜索' }).click();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await historySearch.fill('not-in-history');
    await expect(historySummary).toHaveText('0 条匹配');
    await expect(overlay.locator('.history-empty')).toContainText('没有匹配的历史翻译');
    await overlay.getByRole('button', { name: '清除搜索和标记筛选' }).click();
    await expect(historySearch).toHaveValue('');
    await expect(historyItems).toHaveCount(3);
    await historySearch.press('ArrowDown');
    await expect(historyItems.first()).toBeFocused();
    await historyItems.first().press('ArrowDown');
    await expect(historyItems.nth(1)).toBeFocused();
    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await historyItems.first().click();
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');
    await expect(counter).toHaveText('1/3');
    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await historyPage.keyboard.press('Escape');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');
    await expect(counter).toBeFocused();

    await overlay.getByTitle('收起侧栏').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await overlay.getByTitle('展开 Pi Translator 连续翻译侧栏').click();
    await expect(counter).toHaveText('1/3');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');

    await overlay.getByTitle('查看本文术语和最近翻译').click();
    await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
    await overlay.getByTitle('返回翻译结果').click();
    await expect(counter).toHaveText('1/3');

    await older.focus();
    await older.click();
    await expect(counter).toHaveText('2/3');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await expect(older).toBeFocused();
    await older.click();
    await expect(counter).toHaveText('3/3');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await expect(older).toBeDisabled();
    await expect(newer).toBeFocused();
    await newer.click();
    await expect(counter).toHaveText('2/3');
    await expect(newer).toBeFocused();
    await newer.click();
    await expect(counter).toHaveText('1/3');
    await expect(newer).toBeDisabled();
    await expect(older).toBeFocused();

    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(counter).toHaveText('2/3');
    await expect(older).toBeFocused();

    await historyPage.keyboard.press('Alt+ArrowDown');
    await expect(counter).toHaveText('1/3');
    await overlay.locator('.mark-action').click();
    await expect(overlay.locator('.mark-filter')).toBeVisible();
    await counter.click();
    const markedHistoryFilter = overlay.getByRole('button', { name: '仅显示已标记翻译' });
    await expect(markedHistoryFilter).toBeVisible();
    await markedHistoryFilter.click();
    await expect(historySummary).toHaveText('1 条匹配');
    await expect(historyItems).toHaveCount(1);
    await expect(historyItems.first()).toHaveAttribute('aria-current', 'true');
    await markedHistoryFilter.click();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await historyPage.keyboard.press('Escape');
    await openTranslationMore(overlay);
    await overlay.getByRole('button', { name: '修正译文' }).click();
    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await editor.fill('窄屏多控件组合下仍然清晰可读的用户修订译文。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('.history-counter')).toHaveText('1/3');
    await expect(overlay.locator('.version-counter')).toHaveText('v1/2');
    await expect(overlay.getByRole('group', { name: '翻译历史导航' })).toBeVisible();
    await expect(overlay.getByRole('group', { name: '译文版本导航' })).toBeVisible();
    await expect(overlay.locator('.mark-filter')).toBeVisible();
    await expect(overlay.locator('.document-memory-action')).toBeVisible();
    const denseLayout = await overlay.locator('.surface').evaluate((surface) => {
      const header = surface.querySelector<HTMLElement>('.header')!;
      const tools = surface.querySelector<HTMLElement>('.header-tools')!;
      const title = surface.querySelector<HTMLElement>('.title-wrap')!;
      const surfaceBounds = surface.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const toolsBounds = tools.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        surfaceRight: surfaceBounds.right,
        headerHeight: headerBounds.height,
        toolsRight: toolsBounds.right,
        titleVisible: titleBounds.width > 0 && titleBounds.height > 0,
        historyTop: surface.querySelector<HTMLElement>('.history-navigation')
          ?.getBoundingClientRect().top,
        versionTop: surface.querySelector<HTMLElement>('.version-navigation')
          ?.getBoundingClientRect().top,
      };
    });
    expect(denseLayout.scrollWidth).toBeLessThanOrEqual(denseLayout.clientWidth + 1);
    expect(denseLayout.toolsRight).toBeLessThanOrEqual(denseLayout.surfaceRight);
    expect(denseLayout.headerHeight).toBeLessThanOrEqual(70);
    expect(denseLayout.titleVisible).toBe(true);
    expect(denseLayout.versionTop).toBeGreaterThanOrEqual(denseLayout.historyTop ?? 0);
    const historyAfterContent=await overlay.locator('.surface').evaluate(surface=>{
      const result=surface.querySelector<HTMLElement>('.result-scroll')!.getBoundingClientRect();
      const navigation=surface.querySelector<HTMLElement>('.result-navigation')!;
      return Boolean(navigation.closest('.result-footer'))&&navigation.getBoundingClientRect().top>=result.bottom;
    });
    expect(historyAfterContent).toBe(true);
    const footer = overlay.locator('.footer');
    const undo = overlay.getByRole('button', { name: '撤销上次译文修正' });
    const mark = overlay.locator('.mark-action');
    const more = overlay.locator('details.more > summary');
    await expect(undo).toBeFocused();
    const footerLayout = await footer.evaluate((element) => {
      const controls = [...element.querySelectorAll<HTMLElement>(
        ':scope > button,:scope > details.more > summary',
      )];
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
        controlTops: controls.map((control) => Math.round(control.getBoundingClientRect().top)),
      };
    });
    expect(footerLayout.scrollWidth).toBeLessThanOrEqual(footerLayout.clientWidth + 1);
    expect(footerLayout.controlHeights.every((height) => height >= 32)).toBe(true);
    expect(Math.max(...footerLayout.controlTops)-Math.min(...footerLayout.controlTops)).toBeLessThanOrEqual(2);
    await historyPage.keyboard.press('Shift+Tab');
    await expect(more).toBeFocused();
    await historyPage.keyboard.press('Shift+Tab');
    await expect(mark).toBeFocused();
    const copy = overlay.locator('.copy-action');
    await copy.click();
    await expect(copy).toHaveText('已复制');
    await expect(copy).toBeFocused();
    if (process.env.PI_VISUAL_QA) {
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-dense-navigation-360-light.png') });
      await historyPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-dense-navigation-360-dark.png') });
    }

    const worker = context.serviceWorkers()[0]!;
    const replacedHead = await worker.evaluate(async (pageUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
      if (tab?.id === undefined) throw new Error('Could not find the narrow history test tab.');
      const key = `translationResultHead:${tab.id}`;
      const original = (await api.storage.session.get(key))[key] as Record<string, unknown> | undefined;
      if (!original) throw new Error('The narrow history test tab has no result head.');
      await api.storage.session.set({
        [key]: { ...original, currentResultRequestId: 'synthetic-newer-result' },
      });
      return { key, original };
    }, historyFixtureUrl);
    const undoStatus = overlay.locator('.correction-undo');
    try {
      await undo.click();
      await expect(undoStatus).toHaveAttribute('role', 'alert');
      await expect(undoStatus).toHaveClass(/is-error/);
      await expect(undo).toBeEnabled();
      await expect(undo).toHaveText('重试');
      await expect(undo).toBeFocused();
      const undoFailure = '模拟撤销失败：当前译文版本已经在另一处发生变化，请重新检查后再试。ExtremelyLongUndoFailureIdentifierWithoutNaturalBreakpoints';
      await undoStatus.locator('.correction-undo-message').evaluate((element, message) => {
        element.textContent = message;
      }, undoFailure);
      const failureLayout = await footer.evaluate((element) => {
        const footerBounds = element.getBoundingClientRect();
        const copyBounds = element.querySelector<HTMLElement>('.copy-action')!.getBoundingClientRect();
        const statusBounds = element.querySelector<HTMLElement>('.correction-undo')!.getBoundingClientRect();
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          statusInside: statusBounds.left >= footerBounds.left && statusBounds.right <= footerBounds.right,
          statusBelowActions: statusBounds.top > copyBounds.top,
        };
      });
      expect(failureLayout.scrollWidth).toBeLessThanOrEqual(failureLayout.clientWidth + 1);
      expect(failureLayout.statusInside).toBe(true);
      expect(failureLayout.statusBelowActions).toBe(true);
      if (process.env.PI_VISUAL_QA) {
        await historyPage.screenshot({ path: testInfo.outputPath('sidebar-undo-failure-360-dark.png') });
      }
    } finally {
      await worker.evaluate(async ({ key, original }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
        }).chrome;
        await api.storage.session.set({ [key]: original });
      }, replacedHead);
    }
    await undo.click();
    await expect(undoStatus).toHaveCount(0);
    await expect(overlay.locator('details.more > summary')).toBeFocused();
  } finally {
    await historyPage.close();
  }
});

test('keeps document terminology behind a compact sidebar drawer', async () => {
  const initialRequests = textRequests.length;
  await page.locator('#term-source').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect.poll(async () => ['trigger', 'card', 'sidebar'].includes(
    await overlay.getAttribute('data-pi-view') ?? '',
  )).toBe(true);
  if (await overlay.getAttribute('data-pi-view') === 'trigger') {
    await overlay.locator('.trigger').click();
  }
  if (await overlay.getAttribute('data-pi-view') !== 'sidebar') {
    const pin = overlay.getByTitle('在页面侧栏中显示');
    await expect(pin).toBeVisible();
    await pin.click();
  }
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.body')).toContainText('自适应感知策略');
  await expect(overlay.getByTitle('查看本文术语和最近翻译')).toHaveText('本文');
  await overlay.getByTitle('查看本文术语和最近翻译').click();
  await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
  await expect(overlay.locator('.document-section').filter({ hasText: '待确认术语' }))
    .toBeVisible();
  await expect(overlay.locator('.document-row').filter({ hasText: 'adaptive sensing' })).toBeVisible();
  const candidateRow = overlay.locator('.document-row').filter({ hasText: 'adaptive sensing' });
  await candidateRow.getByText('修改').click();
  const candidateEditor = candidateRow.getByLabel('修改 adaptive sensing 的候选译法');
  await expect(candidateEditor).toBeFocused();
  await candidateEditor.press('Escape');
  await expect(candidateRow.getByTitle('修改候选译法后采用')).toBeFocused();
  await candidateRow.getByText('修改').click();
  await candidateRow.getByLabel('修改 adaptive sensing 的候选译法').fill('自适应感知策略');
  await candidateRow.getByTitle('保存修改并采用').click();
  await expect(overlay.locator('.document-section').filter({ hasText: '固定译法' }))
    .toContainText('自适应感知策略');
  await overlay.getByTitle('返回翻译结果').click();

  await page.locator('#term-followup').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => textRequests.length).toBeGreaterThan(initialRequests + 1);
  const latestRequest = textRequests.at(-1);
  expect(JSON.stringify(latestRequest)).toContain('adaptive sensing');
  expect(JSON.stringify(latestRequest)).toContain('自适应感知策略');
  await expect(overlay.locator('.body')).toContainText('自适应感知策略');
  const appliedTerms = overlay.locator('details.applied-terms');
  await expect(appliedTerms.locator(':scope > summary')).toContainText('已采用术语 1');
  await expect(appliedTerms.locator(':scope > summary')).toContainText('本文 1');
  await appliedTerms.locator(':scope > summary').click();
  const appliedRow = appliedTerms.locator('.applied-term-row');
  await expect(appliedRow).toContainText('adaptive sensing');
  await expect(appliedRow).toContainText('自适应感知策略');
  await expect(appliedRow.locator('.applied-term-scope')).toHaveText('本文');
  await appliedRow.getByTitle('调整本文术语 adaptive sensing').click();
  const focusedTerm = overlay.getByRole('textbox', { name: '固定译法' });
  await expect(focusedTerm).toBeFocused();
  await expect(focusedTerm).toHaveValue('自适应感知策略');
  await overlay.getByTitle('取消编辑本文术语').click();
  await overlay.getByTitle('返回翻译结果').click();
  await overlay.getByTitle('查看本文术语和最近翻译').click();
  await expect.poll(() => overlay.locator('.document-translation').count()).toBeGreaterThanOrEqual(2);
  await overlay.getByTitle('返回翻译结果').click();
});

test('shows verified global terminology and opens its exact settings area', async ({}, testInfo) => {
  const worker = context.serviceWorkers()[0]!;
  const originalGlossary = await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: TestChromeStorageArea } };
    }).chrome;
    const stored = await api.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings ?? {};
    const glossary = Array.isArray(settings.academicGlossary)
      ? settings.academicGlossary as Array<{ source: string; target: string }>
      : [];
    await api.storage.local.set({
      extensionSettings: {
        ...settings,
        academicGlossary: [
          { source: 'consistent academic translation', target: '一致的学术翻译' },
          ...glossary.filter((term) => term.source !== 'consistent academic translation'),
        ],
      },
    });
    return glossary;
  });
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  let options: Page | undefined;
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    const returnToResult = overlay.getByTitle('返回翻译结果');
    if (await returnToResult.isVisible().catch(() => false)) await returnToResult.click();
    await clearBrowserSelection();
    const close = overlay.getByTitle('关闭');
    if (await close.isVisible().catch(() => false)) await close.click();
    await selectElementText('#global-term-source');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    const appliedTerms = overlay.locator('details.applied-terms');
    await expect(appliedTerms.locator(':scope > summary')).toContainText('已采用术语 1');
    await expect(appliedTerms.locator(':scope > summary')).toContainText('全局 1');
    await appliedTerms.locator(':scope > summary').click();
    const row = appliedTerms.locator('.applied-term-row');
    await expect(row).toContainText('consistent academic translation');
    await expect(row).toContainText('一致的学术翻译');
    const layout = await appliedTerms.evaluate((element) => {
      const action = element.querySelector<HTMLElement>('.applied-term-edit')!;
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        actionHeight: action.getBoundingClientRect().height,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('applied-terms-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('applied-terms-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const opened = context.waitForEvent('page');
    await row.getByTitle('在设置中调整全局术语 consistent academic translation').click();
    options = await opened;
    await options.waitForLoadState('domcontentloaded');
    await expect(options).toHaveURL(/focus=glossary#translation$/);
    await expect(options.locator('details').filter({ has: options.locator('#academic-glossary') }))
      .toHaveAttribute('open', '');
    await expect(options.locator('#academic-glossary')).toBeFocused();
    await expect(options.locator('#academic-glossary')).toHaveValue(
      /consistent academic translation = 一致的学术翻译/,
    );
    await options.close();
    options = undefined;
    await openTranslationMore(overlay);
    await overlay.getByRole('button', { name: '修正译文' }).click();
    await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' })
      .fill('这是一条不沿用当前固定术语的手动译文。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('details.applied-terms')).toHaveCount(0);
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('details.applied-terms > summary'))
      .toContainText('已采用术语 1');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  } finally {
    await options?.close();
    await worker.evaluate(async (glossary) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: TestChromeStorageArea } };
      }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), academicGlossary: glossary },
      });
    }, originalGlossary);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(originalViewport);
    await clearBrowserSelection();
  }
});

test('keeps missing configured terminology as a quiet local review', async ({}, testInfo) => {
  const worker = context.serviceWorkers()[0]!;
  const originalGlossary = await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: TestChromeStorageArea } };
    }).chrome;
    const stored = await api.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings ?? {};
    const glossary = Array.isArray(settings.academicGlossary)
      ? settings.academicGlossary as Array<{ source: string; target: string }>
      : [];
    await api.storage.local.set({
      extensionSettings: {
        ...settings,
        academicGlossary: [
          { source: 'technical term', target: '固定技术译法' },
          ...glossary.filter((term) => term.source !== 'technical term'),
        ],
      },
    });
    return glossary;
  });
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    const close = overlay.getByTitle('关闭');
    if (await close.isVisible().catch(() => false)) await close.click();
    const requestsBeforeTranslation = textRequests.length;
    await selectElementText('#term-review-source');
    await expect.poll(async () => ['trigger', 'card', 'sidebar'].includes(
      await overlay.getAttribute('data-pi-view') ?? '',
    )).toBe(true);
    if (await overlay.getAttribute('data-pi-view') === 'trigger') {
      await overlay.locator('.trigger').click();
    }
    if (await overlay.getAttribute('data-pi-view') !== 'sidebar') {
      await overlay.getByTitle('在页面侧栏中显示').click();
    }
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeTranslation);
    await expect(overlay.locator('.body')).toContainText('这种技术表达应保持稳定');
    const review = overlay.locator('details.glossary-review');
    await expect(review.locator(':scope > summary')).toContainText('术语待核对 1');
    await expect(review.locator(':scope > summary')).toContainText('全局 1');
    await expect(review).not.toHaveAttribute('open', '');
    await review.locator(':scope > summary').click();
    await expect(review.locator('.glossary-review-intro')).toContainText('同义表达也可能触发');
    const row = review.locator('.glossary-review-row');
    await expect(row).toContainText('technical term');
    await expect(row).toContainText('固定技术译法');
    const layout = await review.evaluate((element) => {
      const buttons = [...element.querySelectorAll<HTMLElement>('.applied-term-edit')];
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.buttonHeights.every((height) => height >= 32)).toBe(true);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('glossary-review-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('glossary-review-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    const documentButton = overlay.locator('.document-memory-action');
    await expect(documentButton).toHaveText('本文 · 待核对 1');
    await expect(documentButton).toHaveAttribute('title', '有 1 个术语待核对');
    await documentButton.click();
    const documentReview = overlay.locator('.document-term-review-section');
    await expect(documentReview.locator('.document-section-head')).toContainText('术语待核对1');
    await expect(documentReview.locator('.document-term-review-intro'))
      .toContainText('同义表达也可能触发');
    const documentReviewRow = documentReview.locator('.document-term-review-row');
    await expect(documentReviewRow).toContainText('technical term');
    await expect(documentReviewRow).toContainText('固定技术译法');
    await expect(documentReviewRow).toContainText('全局');
    const documentLayout = await documentReviewRow.evaluate((element) => {
      const pairs = element.querySelector<HTMLElement>('.document-term-review-pairs');
      const button = element.querySelector<HTMLElement>('.document-review-actions button');
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        pairsClientWidth: pairs?.clientWidth ?? 0,
        pairsScrollWidth: pairs?.scrollWidth ?? 0,
        buttonHeight: button?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(documentLayout.scrollWidth).toBeLessThanOrEqual(documentLayout.clientWidth + 1);
    expect(documentLayout.pairsScrollWidth)
      .toBeLessThanOrEqual(documentLayout.pairsClientWidth + 1);
    expect(documentLayout.buttonHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('document-term-review-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('document-term-review-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await documentReviewRow.getByRole('button', {
      name: '打开含 1 个待核对术语的译文',
    }).click();
    await expect(overlay.locator('.body')).toContainText('这种技术表达应保持稳定');
    await expect(review.locator(':scope > summary')).toContainText('术语待核对 1');
    await review.locator(':scope > summary').click();

    const requestsBeforeCorrection = textRequests.length;
    await row.getByTitle('本地修正术语 technical term').click();
    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await expect(editor).toBeFocused();
    await expect(overlay.locator('.revision-note')).toContainText(
      '请核对“technical term”的译法，并在需要时调整为“固定技术译法”',
    );
    await expect.poll(() => textRequests.length).toBe(requestsBeforeCorrection);
    await editor.fill('固定技术译法应保持稳定。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('details.glossary-review')).toHaveCount(0);
    await expect(overlay.locator('details.applied-terms > summary')).toContainText('已采用术语 1');
    expect(textRequests).toHaveLength(requestsBeforeCorrection);
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('details.glossary-review > summary')).toContainText('术语待核对 1');
    expect(textRequests).toHaveLength(requestsBeforeCorrection);
  } finally {
    await worker.evaluate(async (glossary) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: TestChromeStorageArea } };
      }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), academicGlossary: glossary },
      });
    }, originalGlossary);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(originalViewport);
    await clearBrowserSelection();
  }
});

test('skips sensitive form fields during continuous translation', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await page.locator('#payment').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, input.value.length);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.notice')).toContainText('已跳过敏感输入区域');
});

// Hold only the next local MathML reply. No translation or OCR request is added.
async function holdNextPanelMath(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    const scope = globalThis as any;
    const runtime = scope.chrome.runtime;
    const send = runtime.sendMessage.bind(runtime);
    scope.panelMathReady = false;
    runtime.sendMessage = async (message: any, ...args: any[]) => {
      if (message.type !== 'RENDER_LATEX_MATHML_BATCH') return send(message, ...args);
      runtime.sendMessage = send;
      const response = await send(message, ...args);
      scope.panelMathReady = true;
      await new Promise<void>(resolve => scope.releasePanelMath = resolve);
      return response;
    };
  });
}

async function panelLayoutFrames(panel: Page): Promise<void> {
  // Allow intermediate layout scroll events to run before releasing the reply.
  await panel.evaluate(async () => {
    for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function releasePanelMath(panel: Page): Promise<void> {
  await expect.poll(() => panel.evaluate(() => (globalThis as any).panelMathReady)).toBe(true);
  await panelLayoutFrames(panel);
  await panel.evaluate(() => (globalThis as any).releasePanelMath());
  await panelLayoutFrames(panel);
}

async function panelReadingGeometry(panel: Page) {
  return panel.evaluate(() => {
    const root = document.scrollingElement!;
    const result = document.querySelector('#result-section')!;
    const header = document.querySelector('.app-header')!;
    const history = document.querySelector<HTMLElement>('#web-history-navigation')!;
    const top = Math.min(root.scrollHeight - root.clientHeight,
      Math.max(0, root.scrollTop + result.getBoundingClientRect().top - header.getBoundingClientRect().bottom
        - (history.hidden ? 0 : history.getBoundingClientRect().height) - 8));
    const bottom = root.scrollHeight - root.clientHeight;
    return {top: root.scrollTop, bottom, start: top, gap: bottom - root.scrollTop,
      progress: (root.scrollTop - top) / Math.max(1, bottom - top)};
  });
}

async function setPanelReadingFraction(panel: Page, fraction: number): Promise<void> {
  const geometry = await panelReadingGeometry(panel);
  await panel.evaluate(top => {
    window.dispatchEvent(new WheelEvent('wheel', {deltaY: -120}));
    document.scrollingElement!.scrollTop = top;
  }, geometry.start + (geometry.bottom - geometry.start) * fraction);
  await panelLayoutFrames(panel);
}


async function delayedReadingBottom(panel: Page, info: import('@playwright/test').TestInfo) {
    if (await panel.locator('#formula-view').textContent() === '公式') {
      await openTranslationMore(panel);
      await panel.locator('#formula-view').click();
    }
    await expect(panel.locator('#translation-text .pi-math math')).not.toHaveCount(0);
    await panel.locator('#reading-bottom').evaluate((button: HTMLButtonElement) => button.click());
    await expect(panel.locator('#reading-progress')).toHaveText('底部');
    const requests = textRequests.length;
    const samples: unknown[] = [];
    for (const mode of ['full', 'aligned', 'full', 'aligned']) {
      await holdNextPanelMath(panel);
      await panel.locator(`#translation-view-${mode}`).evaluate((button: HTMLButtonElement) => button.click());
      await releasePanelMath(panel);
      samples.push({mode, ...await panelReadingGeometry(panel)});
      await expect(panel.locator('#reading-progress')).toHaveText('底部');
      expect((await panelReadingGeometry(panel)).gap).toBeLessThanOrEqual(1);
      if (samples.length <= 2) await panel.screenshot({path: info.outputPath(`delayed-bottom-${mode}-300.png`)});
    }
    await info.attach('delayed-view-reading-geometry', {body: JSON.stringify(samples, null, 2), contentType: 'application/json'});
    expect(textRequests).toHaveLength(requests);
}

async function delayedReadingInteraction(panel: Page) {
    await setPanelReadingFraction(panel, .45);
    const before = await panelReadingGeometry(panel);
    await holdNextPanelMath(panel);
    await panel.locator('#translation-view-full').evaluate((button: HTMLButtonElement) => button.click());
    await releasePanelMath(panel);
    expect(Math.abs((await panelReadingGeometry(panel)).progress - before.progress)).toBeLessThan(.015);

    await panel.locator('#reading-top').evaluate((button: HTMLButtonElement) => button.click());
    await holdNextPanelMath(panel);
    await panel.locator('#translation-view-aligned').evaluate((button: HTMLButtonElement) => button.click());
    await releasePanelMath(panel);
    await expect(panel.locator('#reading-progress')).toHaveText('顶部');
    expect(Math.abs((await panelReadingGeometry(panel)).top - (await panelReadingGeometry(panel)).start)).toBeLessThanOrEqual(1);

    await panel.locator('#reading-bottom').evaluate((button: HTMLButtonElement) => button.click());
    await holdNextPanelMath(panel);
    await panel.locator('#translation-view-full').evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => panel.evaluate(() => (globalThis as any).panelMathReady)).toBe(true);
    await panelLayoutFrames(panel);
    await setPanelReadingFraction(panel, .35);
    const manual = await panelReadingGeometry(panel);
    await releasePanelMath(panel);
    expect(Math.abs((await panelReadingGeometry(panel)).top - manual.top)).toBeLessThanOrEqual(1);
    await expect(panel.locator('#reading-progress')).not.toHaveText('底部');
}

async function delayedReadingDraft(panel: Page) {
    await panel.locator('#reading-bottom').evaluate((button: HTMLButtonElement) => button.click());
    await holdNextPanelMath(panel);
    await panel.locator('#translation-view-full').evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => panel.evaluate(() => (globalThis as any).panelMathReady)).toBe(true);
    await panelLayoutFrames(panel);
    await panel.locator('#translation-view-aligned').evaluate((button: HTMLButtonElement) => button.click());
    await panelLayoutFrames(panel);
    await releasePanelMath(panel);
    await expect(panel.locator('#translation-view-aligned')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('#reading-progress')).toHaveText('底部');

    await holdNextPanelMath(panel);
    await panel.locator('#translation-view-full').evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => panel.evaluate(() => (globalThis as any).panelMathReady)).toBe(true);
    await panelLayoutFrames(panel);
    const requests = textRequests.length;
    await openTranslationMore(panel);
    await panel.locator('#correct').click();
    const draft = panel.locator('.correction-text-part').first();
    await draft.fill('尚未保存的人工修正草稿，保留公式。');
    await draft.focus();
    const top = await panel.evaluate(() => document.scrollingElement!.scrollTop);
    await releasePanelMath(panel);
    await expect(draft).toHaveValue('尚未保存的人工修正草稿，保留公式。');
    await expect(draft).toBeFocused();
    expect(await panel.evaluate(() => document.scrollingElement!.scrollTop)).toBe(top);
    await expect(panel.locator('#reading-navigation')).toBeHidden();
    await panel.getByRole('button', {name: '取消', exact: true}).click();
    await expect(panel.locator('#translation-text')).toContainText('只有确实超出一屏的结果');
    await expect(panel.locator('#reading-progress')).toHaveText('底部');
    expect(textRequests).toHaveLength(requests);
}
