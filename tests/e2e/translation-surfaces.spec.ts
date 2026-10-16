import {openTranslationMore} from './support/translation-controls';
import type { Route } from '@playwright/test';
import {
  clearBrowserSelection,
  context,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  page,
  selectElementText,
  selectSourceText,
  test,
  textRequests,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('renders streaming native PDF translations in the Edge side panel UI', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(sidePanel.locator('#empty-state')).toBeVisible();
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  await messageSender.waitForTimeout(150);

  const baseSession = {
    tabId,
    targetLanguage: 'zh-CN',
    requestId: 'pdf-side-panel-e2e',
    sourceText: 'Streaming translations should remain beside the native PDF reader.',
    pageUrl: 'https://www.overleaf.com/native-reader.pdf',
    pageNumber: 6,
    sourceLabel: 'native-reader.pdf',
    status: 'translating',
    startedAt: Date.now(),
    progressStage: 'provider',
    completedChunks: 0,
    totalChunks: 1,
    providerContext: {
      role: 'vision',
      profileName: 'Qwen formula',
      model: 'qwen-vision-test-model',
    },
  } as const;
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: session,
    });
  }, baseSession);

  await expect(sidePanel.locator('#session')).toBeVisible();
  await expect(sidePanel.locator('#source-label')).toHaveText('native-reader.pdf');
  await expect(sidePanel.locator('#translation-state')).toContainText('正在请求模型');
  await expect(sidePanel.getByLabel('目标语言')).toHaveValue('zh-CN');
  await expect(sidePanel.getByLabel('目标语言')).toBeDisabled();
  await expect(sidePanel.locator('#translation-text')).toBeEmpty();
  await expect(sidePanel.locator('#session-actions')).toBeHidden();
  const streamingSession = {
    ...baseSession,
    partialText: '流式译文应当',
  } as const;
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: session,
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state')).toContainText('正在接收译文');
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#stop-translation')).toBeVisible();
  const stopButtonHeight = await sidePanel.locator('#stop-translation').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(stopButtonHeight).toBeGreaterThanOrEqual(32);
  expect(stopButtonHeight).toBeLessThanOrEqual(33);
  await expect(sidePanel.locator('#correct')).toBeHidden();
  await expect(sidePanel.locator('#correction-undo')).toBeHidden();
  await expect(sidePanel.locator('#open-pi-reader')).toHaveText('用 Pi 打开');
  await expect(sidePanel.locator('#reader-hint-text')).toBeVisible();
  await expect(sidePanel.locator('#reader-hint-text')).toContainText('未提供选区图像');
  await expect(sidePanel.locator('#reader-hint-text')).toContainText('第 6 页');
  const contextLayout = await sidePanel.locator('.session-context').evaluate((context) => ({
    height: context.getBoundingClientRect().height,
    buttonCount: context.querySelectorAll('button').length,
  }));
  expect(contextLayout.height).toBeLessThanOrEqual(51);
  expect(contextLayout.buttonCount).toBe(0);
  await openTranslationMore(sidePanel);
  await expect(sidePanel.locator('#open-pi-reader')).toBeVisible();
  await sidePanel.keyboard.press('Escape');

  const sendStreamingPartial = async (partialText: string) => messageSender.evaluate(
    async ({ session, partial }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      await api.runtime.sendMessage({
        type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
        payload: { ...session, partialText: partial },
      });
    },
    { session: streamingSession, partial: partialText },
  );
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
  });
  const followedPartial = Array.from(
    { length: 24 },
    (_, index) => `流式段落 ${index + 1}：最新译文应在读者停留末尾时保持可见。`,
  ).join('\n');
  await sendStreamingPartial(followedPartial);
  await expect(sidePanel.locator('#translation-text')).toContainText('流式段落 24');
  await expect.poll(() => sidePanel.evaluate(
    () => document.scrollingElement?.scrollTop ?? 0,
  )).toBeGreaterThan(0);
  expect(await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (!scrollRoot) return Number.POSITIVE_INFINITY;
    return scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
  })).toBeLessThanOrEqual(1);

  await sidePanel.evaluate(() => { if (document.scrollingElement) document.scrollingElement.scrollTop = 0; });
  const pausedPartial = `${followedPartial}\n${Array.from(
    { length: 8 },
    (_, index) => `后续段落 ${index + 1}：向上阅读后不应被自动拉回底部。`,
  ).join('\n')}`;
  await sendStreamingPartial(pausedPartial);
  await expect(sidePanel.locator('#translation-text')).toContainText('后续段落 8');
  await sidePanel.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await sidePanel.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);
  await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
  });

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'error',
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Synthetic stream interruption.',
          retryable: false,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('翻译中断 · 已保留部分译文');
  await expect(sidePanel.locator('#stop-translation')).toBeHidden();
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#error-message')).toContainText('响应超时');
  await expect(sidePanel.locator('#retry')).toBeVisible();
  await expect(sidePanel.locator('#session-actions')).toBeVisible();
  await expect(sidePanel.locator('#copy')).toHaveText('复制部分译文');
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  expect(await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (!scrollRoot) return Number.POSITIVE_INFINITY;
    return scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
  })).toBeLessThanOrEqual(1);
  const partialCopyButtonHeight = await sidePanel.locator('#copy').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(partialCopyButtonHeight).toBeGreaterThanOrEqual(32);
  expect(partialCopyButtonHeight).toBeLessThanOrEqual(33);
  const footerHeightBeforeCopy = await sidePanel.locator('footer').evaluate(
    (footer) => footer.getBoundingClientRect().height,
  );
  await sidePanel.locator('#copy').click();
  await expect(sidePanel.locator('#copy')).toHaveText('已复制');
  await expect(sidePanel.locator('#copy')).toHaveAttribute('data-state', 'success');
  await expect(sidePanel.locator('#copy-feedback')).toHaveText('译文已复制到剪贴板');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  expect(await sidePanel.locator('footer').evaluate(
    (footer) => footer.getBoundingClientRect().height,
  )).toBe(footerHeightBeforeCopy);

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'error',
        error: {
          code: 'REQUEST_ABORTED',
          message: '翻译已停止。',
          retryable: false,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('已停止 · 已保留部分译文');
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#error-message')).toBeHidden();
  await expect(sidePanel.locator('#error-actions')).toBeHidden();
  await expect(sidePanel.locator('#retry')).toBeHidden();
  await expect(sidePanel.locator('#copy')).toHaveText('复制部分译文');
  await expect(sidePanel.locator('#copy')).toBeEnabled();

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        partialText: '流式译文应当显示在原生 PDF 阅读器旁边。',
        result: {
          requestId: session.requestId,
          originalText: session.sourceText,
          translatedText: '流式译文应当显示在原生 PDF 阅读器旁边，其中 $E=mc^2$。',
          warnings: [],
          latencyMs: 850,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-text'))
    .toContainText('流式译文应当显示在原生 PDF 阅读器旁边');
  await expect(sidePanel.locator('#translation-view-switch')).toBeHidden();
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('850 毫秒');
  await expect(sidePanel.locator('#correct')).toBeHidden();
  await openTranslationMore(sidePanel);
  await expect(sidePanel.locator('#correct')).toBeVisible();
  await expect(sidePanel.getByLabel('目标语言')).toBeEnabled();
  await expect(sidePanel.locator('#correction-undo')).toBeHidden();
  await expect(sidePanel.locator('#translation-text .pi-math-inline math')).toBeVisible();
  await expect(sidePanel.locator('#formula-view')).toHaveText('源码');
  await openTranslationMore(sidePanel);
  await sidePanel.locator('#formula-view').click();
  await expect(sidePanel.locator('#translation-text'))
    .toHaveText('流式译文应当显示在原生 PDF 阅读器旁边，其中 $E=mc^2$。');
  await expect(sidePanel.locator('#formula-view')).toHaveText('公式');
  await openTranslationMore(sidePanel);
  await sidePanel.locator('#formula-view').click();
  // Exercise the same constrained width as Edge's native side panel. The
  // formula itself may scroll, but its equation number must remain in the
  // numbered row instead of wrapping below the expression.
  await sidePanel.setViewportSize({ width: 390, height: 820 });
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        result: {
          requestId: session.requestId,
          originalText: session.sourceText,
          translatedText: [
            '**h-Transform**',
            '\\[Q^{\\Pi^*}(dZ)=\\pi^*(Z_\\tau)Q(dZ),\\tag{8}\\]',
            '**命题 2.8**',
            '\\[Q^{\\Pi^*}=\\operatorname{argmin}P\\in P(V,\\Omega) \\left\\{KL(P\\Vert Q):=E_P\\left[\\log \\frac{dP}{dQ}(Z_\\tau)\\right]\\right\\},\\quad \\mathrm{s.t.}\\ P_\\Omega=\\Pi^*,\\tag{12}\\]',
            '\\[KL(P\\Vert Q^{\\Pi^*})=KL(P\\Vert Q)-E_P[\\log\\pi^*(Z_\\tau)],\\tag{13}\\]',
            ...Array.from(
              { length: 18 },
              (_, index) => `补充说明 ${index + 1}：长译文阅读时，常用操作应始终保持可达。`,
            ),
          ].join('\\n'),
          warnings: [],
          latencyMs: 850,
        },
      },
    });
  }, baseSession);
  await expect(sidePanel.locator('#translation-text .pi-math-scroll math')).toHaveCount(3);
  await expect(sidePanel.locator('#translation-text strong')).toHaveText([
    'h-Transform',
    '命题 2.8',
  ]);
  await expect(sidePanel.locator('#translation-text .pi-equation-tag')).toHaveText([
    '(8)',
    '(12)',
    '(13)',
  ]);
  const optimizerEquation = sidePanel
    .locator('#translation-text .pi-math-display.pi-math-numbered')
    .nth(1);
  const optimizerScroll = optimizerEquation.locator('.pi-math-scroll');
  const optimizerTag = optimizerEquation.locator('.pi-equation-tag');
  await expect(optimizerScroll.locator('math munder')).toBeVisible();
  await expect(optimizerTag).toBeVisible();
  const optimizerLayout = await optimizerEquation.evaluate((equation) => {
    const scroll = equation.querySelector<HTMLElement>('.pi-math-scroll');
    const tag = equation.querySelector<HTMLElement>('.pi-equation-tag');
    if (!scroll || !tag) return undefined;
    const scrollRect = scroll.getBoundingClientRect();
    const tagBeforeScroll = tag.getBoundingClientRect();
    scroll.scrollLeft = scroll.scrollWidth;
    const tagAfterScroll = tag.getBoundingClientRect();
    const scrolledDistance = scroll.scrollLeft;
    scroll.scrollLeft = 0;
    return {
      overflowX: getComputedStyle(scroll).overflowX,
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      scrollLeft: scrolledDistance,
      verticalOverlap: Math.min(scrollRect.bottom, tagBeforeScroll.bottom)
        - Math.max(scrollRect.top, tagBeforeScroll.top),
      tagLeftBeforeScroll: tagBeforeScroll.left,
      tagLeftAfterScroll: tagAfterScroll.left,
      tagRight: tagAfterScroll.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(optimizerLayout).toBeDefined();
  expect(optimizerLayout!.overflowX).toMatch(/auto|scroll/);
  expect(optimizerLayout!.scrollWidth).toBeGreaterThan(optimizerLayout!.clientWidth + 1);
  expect(optimizerLayout!.scrollLeft).toBeGreaterThan(0);
  expect(optimizerLayout!.verticalOverlap).toBeGreaterThan(0);
  expect(Math.abs(
    optimizerLayout!.tagLeftAfterScroll - optimizerLayout!.tagLeftBeforeScroll,
  )).toBeLessThan(1);
  expect(optimizerLayout!.tagRight).toBeLessThanOrEqual(optimizerLayout!.viewportWidth + 1);
  await sidePanel.evaluate(() => window.scrollTo(0, 0));
  const stickyActionLayout = await sidePanel.locator('#session-actions').evaluate((footer) => {
    const rect = footer.getBoundingClientRect();
    return {
      position: getComputedStyle(footer).position,
      bottom: rect.bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(stickyActionLayout.position).toBe('sticky');
  expect(stickyActionLayout.pageScrollHeight).toBeGreaterThan(stickyActionLayout.viewportHeight + 1);
  expect(stickyActionLayout.bottom).toBeLessThanOrEqual(stickyActionLayout.viewportHeight + 1);
  expect(stickyActionLayout.bottom).toBeGreaterThan(stickyActionLayout.viewportHeight - 2);
  await sidePanel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const actionEndLayout = await sidePanel.evaluate(() => ({
    translationBottom: document.querySelector('#translation-text')?.getBoundingClientRect().bottom,
    footerTop: document.querySelector('#session-actions')?.getBoundingClientRect().top,
  }));
  expect(actionEndLayout.translationBottom).toBeDefined();
  expect(actionEndLayout.footerTop).toBeDefined();
  expect(actionEndLayout.translationBottom!).toBeLessThanOrEqual(actionEndLayout.footerTop! + 1);
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  const completedActionStyles = await sidePanel.locator('footer').evaluate((footer) => {
    const copyAction = footer.querySelector<HTMLElement>('#copy');
    const correctionAction = footer.querySelector<HTMLElement>('#correct');
    if (!copyAction || !correctionAction) return undefined;
    return {
      copyBackground: getComputedStyle(copyAction).backgroundColor,
      correctionBackground: getComputedStyle(correctionAction).backgroundColor,
    };
  });
  expect(completedActionStyles).toBeDefined();
  expect(completedActionStyles!.copyBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(completedActionStyles!.correctionBackground).toBe('rgba(0, 0, 0, 0)');
  await sidePanel.locator('#copy').click();
  await expect(sidePanel.locator('#copy')).toHaveText('已复制');
  await expect(sidePanel.locator('#copy-feedback')).toHaveText('译文已复制到剪贴板');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  const sessionContextLayout = await sidePanel.locator('.session-context').evaluate((context) => {
    const rect = context.getBoundingClientRect();
    return {
      clientWidth: context.clientWidth,
      scrollWidth: context.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(sessionContextLayout.scrollWidth)
    .toBeLessThanOrEqual(sessionContextLayout.clientWidth + 1);
  expect(sessionContextLayout.left).toBeGreaterThanOrEqual(-1);
  expect(sessionContextLayout.right)
    .toBeLessThanOrEqual(sessionContextLayout.viewportWidth + 1);
  const footerLayout = await sidePanel.locator('footer').evaluate((footer) => {
    const rect = footer.getBoundingClientRect();
    return {
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(footerLayout.scrollWidth).toBeLessThanOrEqual(footerLayout.clientWidth + 1);
  expect(footerLayout.left).toBeGreaterThanOrEqual(-1);
  expect(footerLayout.right).toBeLessThanOrEqual(footerLayout.viewportWidth + 1);
  expect(footerLayout.pageScrollWidth).toBeLessThanOrEqual(footerLayout.viewportWidth + 1);
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await openTranslationMore(sidePanel);
  await sidePanel.locator('#correct').click();
  const nativeCorrection = sidePanel.getByRole('group', { name: '修正译文，公式已锁定' });
  await expect(nativeCorrection).toBeVisible();
  await expect(sidePanel.locator('#session-actions')).toBeHidden();
  const correctionTextPartLayout = await nativeCorrection.locator('.correction-text-part')
    .evaluateAll((inputs) => inputs.map((input) => {
      const field = input as HTMLTextAreaElement;
      return {
        clientHeight: field.clientHeight,
        scrollHeight: field.scrollHeight,
        fieldSizing: getComputedStyle(field).getPropertyValue('field-sizing'),
      };
    }));
  expect(correctionTextPartLayout.length).toBeGreaterThan(1);
  const firstCorrectionTextPart = correctionTextPartLayout.at(0)!;
  const lastCorrectionTextPart = correctionTextPartLayout.at(-1)!;
  expect(firstCorrectionTextPart.clientHeight).toBeLessThanOrEqual(80);
  expect(lastCorrectionTextPart.fieldSizing).toBe('content');
  expect(lastCorrectionTextPart.clientHeight).toBeGreaterThan(120);
  expect(lastCorrectionTextPart.clientHeight).toBeLessThanOrEqual(152);
  expect(lastCorrectionTextPart.scrollHeight).toBeGreaterThan(lastCorrectionTextPart.clientHeight);
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toContainText('Q^{\\Pi^*}');
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toHaveAttribute('aria-readonly', 'true');
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toHaveAttribute('role', 'textbox');
  await expect(sidePanel.locator('#copy')).toBeDisabled();
  const correctionScope = nativeCorrection.getByLabel('修正译文的保存范围');
  await correctionScope.focus();
  await correctionScope.press('ArrowDown');
  await expect(correctionScope).toHaveValue('document');
  await expect(correctionScope).toBeFocused();
  await expect(nativeCorrection.getByLabel('原文术语')).toBeHidden();
  const nativeTermDisclosure = nativeCorrection.locator('details.correction-term-disclosure');
  const nativeTermSummary = nativeTermDisclosure.locator(':scope > summary');
  await nativeTermSummary.click();
  const nativeSourceTerm = nativeCorrection.getByLabel('原文术语');
  const nativeTargetTerm = nativeCorrection.getByLabel('固定译法');
  const nativeTermScope = nativeCorrection.getByLabel('术语保存范围');
  await nativeTermScope.selectOption('global');
  await expect(nativeTermScope).toHaveValue('global');
  const nativeEditor = nativeCorrection.getByLabel('可编辑译文第 1 段');
  await nativeEditor.fill('修正后的原生 PDF 译文标题。');
  await nativeSourceTerm.fill('native PDF');
  await expect(nativeTermSummary).toHaveText('！固定术语待补充');
  await nativeTermSummary.click();
  await expect(nativeTermDisclosure).not.toHaveAttribute('open', '');
  const nativeCorrectionSave = nativeCorrection.getByRole('button', { name: '保存', exact: true });
  await nativeCorrectionSave.click();
  const nativeCorrectionFeedback = nativeCorrection.locator('.correction-feedback');
  await expect(nativeCorrectionFeedback)
    .toContainText('请完整填写不含公式的简短术语和固定译法');
  await expect(nativeCorrectionFeedback).toHaveAttribute('role', 'alert');
  await expect(nativeTermDisclosure).toHaveAttribute('open', '');
  await expect(nativeTargetTerm).toHaveAttribute('aria-invalid', 'true');
  await expect(nativeTargetTerm).toHaveAttribute(
    'aria-describedby',
    'pi-pdf-side-panel-correction-status',
  );
  await expect(nativeTargetTerm).toBeFocused();
  const correctionFailureLayout = await nativeCorrection.evaluate((editor) => {
    const actions = editor.querySelector<HTMLElement>('.correction-actions')!;
    const feedback = editor.querySelector<HTMLElement>('.correction-feedback')!;
    const target = editor.querySelector<HTMLInputElement>('[aria-label="固定译法"]')!;
    const actionRect = actions.getBoundingClientRect();
    return {
      actionHeight: actionRect.height,
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      feedbackBottom: feedback.getBoundingClientRect().bottom,
      targetBottom: target.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(correctionFailureLayout.actionBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.viewportHeight + 1);
  expect(correctionFailureLayout.feedbackBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.actionBottom);
  expect(correctionFailureLayout.targetBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.actionTop - 7);
  expect(correctionFailureLayout.pageScrollWidth)
    .toBeLessThanOrEqual(correctionFailureLayout.viewportWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await nativeTargetTerm.fill('原生 PDF');
  await expect(nativeCorrectionFeedback).toBeEmpty();
  await expect(nativeTargetTerm).not.toHaveAttribute('aria-invalid');
  await expect(nativeTermSummary).toHaveText('✓ 已填写固定术语');
  const nativeCorrectionActionLayout = await nativeCorrection.locator('.correction-actions')
    .evaluate((actions) => {
      const rect = actions.getBoundingClientRect();
      return {
        position: getComputedStyle(actions).position,
        bottom: rect.bottom,
        viewportHeight: document.documentElement.clientHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
  expect(nativeCorrectionActionLayout.position).toBe('fixed');
  expect(nativeCorrectionActionLayout.bottom)
    .toBeGreaterThan(nativeCorrectionActionLayout.viewportHeight - 2);
  expect(nativeCorrectionActionLayout.bottom)
    .toBeLessThanOrEqual(nativeCorrectionActionLayout.viewportHeight + 1);
  expect(nativeCorrectionActionLayout.pageScrollWidth)
    .toBeLessThanOrEqual(nativeCorrectionActionLayout.viewportWidth + 1);
  await expect.poll(() => nativeTargetTerm.evaluate((field) => {
    const actions = document.querySelector<HTMLElement>('.correction-actions');
    if (!actions) return false;
    return field.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top - 7;
  })).toBe(true);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await nativeTermSummary.click();
  await nativeCorrectionSave.click();
  await expect(nativeCorrectionFeedback).toContainText('当前 PDF 或译文已经变化');
  await expect(nativeCorrectionFeedback).toHaveAttribute('role', 'alert');
  const correctionRetry = nativeCorrection.getByRole('button', { name: '重试' });
  await expect(correctionRetry).toBeFocused();
  await expect(nativeEditor).toBeEnabled();
  await expect(nativeEditor).toHaveValue('修正后的原生 PDF 译文标题。');
  const saveFailureLayout = await nativeCorrection.evaluate((editor) => {
    const actions = editor.querySelector<HTMLElement>('.correction-actions')!;
    const feedback = editor.querySelector<HTMLElement>('.correction-feedback')!;
    const retry = [...actions.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '重试')!;
    const actionRect = actions.getBoundingClientRect();
    return {
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      feedbackBottom: feedback.getBoundingClientRect().bottom,
      retryTop: retry.getBoundingClientRect().top,
      retryBottom: retry.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(saveFailureLayout.actionTop).toBeGreaterThanOrEqual(0);
  expect(saveFailureLayout.actionBottom).toBeLessThanOrEqual(saveFailureLayout.viewportHeight + 1);
  expect(saveFailureLayout.feedbackBottom).toBeLessThanOrEqual(saveFailureLayout.actionBottom);
  expect(saveFailureLayout.retryTop).toBeGreaterThanOrEqual(saveFailureLayout.actionTop);
  expect(saveFailureLayout.retryBottom).toBeLessThanOrEqual(saveFailureLayout.actionBottom);
  expect(saveFailureLayout.pageScrollWidth).toBeLessThanOrEqual(saveFailureLayout.viewportWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-save-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-save-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await nativeEditor.fill('再次调整后的原生 PDF 译文标题。');
  await expect(nativeCorrectionFeedback).toBeEmpty();
  await expect(nativeCorrection.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await nativeCorrection.press('Escape');
  await expect(sidePanel.locator('#panel-more > summary')).toBeFocused();
  await expect(sidePanel.locator('#session-actions')).toBeVisible();
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  await expect(sidePanel.locator('#translation-text .pi-math-scroll math')).toHaveCount(3);

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        partialText: '已修正的原生 PDF 译文。',
        result: {
          requestId: 'native-pdf-corrected-e2e',
          originalText: session.sourceText,
          translatedText: '已修正的原生 PDF 译文。',
          warnings: [],
          latencyMs: 0,
          revision: {
            rootRequestId: session.requestId,
            kind: 'manual',
            label: '手动修改',
            scope: 'current',
          },
        },
        correctionReceipt: {
          baseRequestId: session.requestId,
          correctedRequestId: 'native-pdf-corrected-e2e',
          scope: 'current',
          previousTranslation: '修正前的原生 PDF 译文。',
          correctedTranslation: '已修正的原生 PDF 译文。',
        },
      },
    });
  }, baseSession);
  await expect(sidePanel.locator('#correction-undo')).toBeVisible();
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.locator('#undo-correction').click();
  await expect(sidePanel.locator('#correction-undo'))
    .toContainText('没有可撤销的 PDF 译文修正');
  await expect(sidePanel.locator('#correction-undo')).toHaveAttribute('role', 'alert');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  await expect(sidePanel.locator('#undo-correction')).toHaveText('重试');
  await expect(sidePanel.locator('#undo-correction')).toBeFocused();
  const undoFailureLayout = await sidePanel.locator('#session-actions').evaluate((footer) => {
    const footerRect = footer.getBoundingClientRect();
    const retryButton = footer.querySelector<HTMLElement>('#undo-correction')!;
    const message = footer.querySelector<HTMLElement>('#correction-undo-message')!;
    return {
      footerTop: footerRect.top,
      footerBottom: footerRect.bottom,
      retryTop: retryButton.getBoundingClientRect().top,
      retryBottom: retryButton.getBoundingClientRect().bottom,
      messageBottom: message.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
    };
  });
  expect(undoFailureLayout.footerTop).toBeGreaterThanOrEqual(0);
  expect(undoFailureLayout.footerBottom).toBeLessThanOrEqual(undoFailureLayout.viewportHeight + 1);
  expect(undoFailureLayout.retryTop).toBeGreaterThanOrEqual(undoFailureLayout.footerTop);
  expect(undoFailureLayout.retryBottom).toBeLessThanOrEqual(undoFailureLayout.footerBottom);
  expect(undoFailureLayout.messageBottom).toBeLessThanOrEqual(undoFailureLayout.footerBottom);
  expect(undoFailureLayout.scrollWidth).toBeLessThanOrEqual(undoFailureLayout.clientWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-undo-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-undo-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  const inheritedReaderPromise = context.waitForEvent('page');
  await openTranslationMore(sidePanel);
  await sidePanel.locator('#open-pi-reader').click();
  const inheritedReader = await inheritedReaderPromise;
  await inheritedReader.waitForURL((url) => url.pathname === '/pdf.html');
  await inheritedReader.waitForLoadState('domcontentloaded');
  const inheritedUrl = new URL(inheritedReader.url());
  expect(inheritedUrl.pathname).toBe('/pdf.html');
  expect(inheritedUrl.searchParams.get('url'))
    .toBe('https://www.overleaf.com/native-reader.pdf');
  expect(inheritedUrl.searchParams.get('page')).toBe('6');
  await inheritedReader.close();
  await messageSender.close();
  await sidePanel.close();
});

test('keeps long native PDF source text compact and expandable', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();

  const longSource = Array.from(
    { length: 24 },
    (_, index) => `Long academic source sentence ${index + 1} keeps the translation below easy to reach.`,
  ).join(' ');
  const baseSession = {
    tabId,
    requestId: 'long-source-disclosure-e2e',
    sourceText: longSource,
    pageUrl: 'https://www.overleaf.com/long-source.pdf',
    sourceLabel: 'long-source.pdf',
    status: 'complete',
    startedAt: Date.now(),
    result: {
      requestId: 'long-source-disclosure-e2e',
      originalText: longSource,
      translatedText: '长原文不会遮挡这段译文。',
      warnings: [],
      latencyMs: 420,
    },
  } as const;
  const sendSession = async (session: unknown) => messageSender.evaluate(async (payload) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload,
    });
  }, session);

  await sendSession(baseSession);
  const sourceToggle = sidePanel.locator('#source-toggle');
  const sourceText = sidePanel.locator('#source-text');
  await expect(sourceToggle).toBeVisible();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sourceToggle).toHaveAttribute('aria-controls', 'source-text');
  const collapsedLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    lineHeight: parseFloat(getComputedStyle(source).lineHeight),
    overflowY: getComputedStyle(source).overflowY,
  }));
  expect(collapsedLayout.scrollHeight).toBeGreaterThan(collapsedLayout.clientHeight + 1);
  expect(collapsedLayout.clientHeight).toBeLessThanOrEqual(collapsedLayout.lineHeight * 3 + 1);
  expect(collapsedLayout.overflowY).toBe('hidden');
  const sourceToggleHeight = await sourceToggle.evaluate((button) => button.getBoundingClientRect().height);
  expect(sourceToggleHeight).toBeGreaterThanOrEqual(32);
  expect(sourceToggleHeight).toBeLessThanOrEqual(33);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-collapsed.png') });
  }

  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('收起');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'true');
  const expandedLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    overflowY: getComputedStyle(source).overflowY,
    translationHeadingTop: document.querySelector('.result-section .section-heading')
      ?.getBoundingClientRect().top,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(expandedLayout.clientHeight).toBeGreaterThan(collapsedLayout.clientHeight + 20);
  expect(expandedLayout.scrollHeight).toBeGreaterThan(expandedLayout.clientHeight + 1);
  expect(expandedLayout.overflowY).toBe('auto');
  expect(expandedLayout.translationHeadingTop).toBeDefined();
  expect(expandedLayout.translationHeadingTop!)
    .toBeLessThan(expandedLayout.viewportHeight - 20);
  await expect(sourceToggle).toBeFocused();
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-expanded.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-expanded-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }

  await sidePanel.setViewportSize({ width: 360, height: 420 });
  const shortViewportLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    translationHeadingBottom: document.querySelector('.result-section .section-heading')
      ?.getBoundingClientRect().bottom,
    translationTextTop: document.querySelector('#translation-text')?.getBoundingClientRect().top,
    footerTop: document.querySelector('#session-actions')?.getBoundingClientRect().top,
  }));
  expect(shortViewportLayout.clientHeight)
    .toBeLessThanOrEqual(Math.max(88, shortViewportLayout.viewportHeight * 0.22) + 1);
  expect(shortViewportLayout.scrollHeight).toBeGreaterThan(shortViewportLayout.clientHeight + 1);
  expect(shortViewportLayout.pageScrollWidth).toBeLessThanOrEqual(shortViewportLayout.viewportWidth + 1);
  expect(shortViewportLayout.translationHeadingBottom).toBeDefined();
  expect(shortViewportLayout.footerTop).toBeDefined();
  expect(shortViewportLayout.translationHeadingBottom!)
    .toBeLessThanOrEqual(shortViewportLayout.footerTop! - 8);
  expect(shortViewportLayout.translationTextTop).toBeDefined();
  // Windows Edge can place text on a half-pixel; preserve the intended gap
  // while allowing one pixel of platform-specific font rounding.
  expect(shortViewportLayout.translationTextTop!)
    .toBeLessThanOrEqual(shortViewportLayout.footerTop! - 13);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sourceText.hover();
  await sidePanel.mouse.wheel(0, 5_000);
  await expect.poll(() => sourceText.evaluate(
    (source) => source.scrollHeight - source.clientHeight - source.scrollTop,
  )).toBeLessThanOrEqual(1);
  await sidePanel.mouse.wheel(0, 600);
  await expect.poll(() => sidePanel.evaluate(
    () => document.scrollingElement?.scrollTop ?? 0,
  )).toBeGreaterThan(0);
  await sidePanel.evaluate(() => window.scrollTo(0, 0));

  await sourceText.evaluate((source) => { source.scrollTop = source.scrollHeight; });
  expect(await sourceText.evaluate((source) => source.scrollTop)).toBeGreaterThan(0);
  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await sourceText.evaluate((source) => source.scrollTop)).toBe(0);
  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('收起');

  await sendSession({
    ...baseSession,
    result: { ...baseSession.result, latencyMs: 460 },
  });
  await expect(sourceToggle).toHaveText('收起');
  await expect(sourceText).toHaveClass(/expanded/);

  const nextRequestId = 'long-source-disclosure-next-e2e';
  await sendSession({
    ...baseSession,
    requestId: nextRequestId,
    startedAt: baseSession.startedAt + 1,
    result: { ...baseSession.result, requestId: nextRequestId },
  });
  await expect(sourceToggle).toBeVisible();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');

  const shortRequestId = 'short-source-disclosure-e2e';
  await sendSession({
    ...baseSession,
    requestId: shortRequestId,
    sourceText: 'Short source text.',
    startedAt: baseSession.startedAt + 2,
    result: {
      ...baseSession.result,
      requestId: shortRequestId,
      originalText: 'Short source text.',
    },
  });
  await sidePanel.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(sourceToggle).toBeHidden();
  expect(await sourceText.evaluate((source) => source.scrollHeight <= source.clientHeight + 1)).toBe(true);

  await messageSender.close();
  await sidePanel.close();
});

test('clears native PDF side-panel actions as soon as the active tab changes', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  await messageSender.evaluate(async (sessionTabId) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        tabId: sessionTabId,
        requestId: 'activation-race-session',
        sourceText: 'Text from the previously active PDF.',
        pageUrl: 'edge://pdf',
        sourceLabel: 'previous.pdf',
        status: 'error',
        startedAt: Date.now(),
        providerContext: {
          role: 'text',
          profileName: 'DeepSeek text',
          model: 'deepseek-test-model',
        },
        error: { code: 'NETWORK_ERROR', message: 'Retry me.', retryable: true },
      },
    });
  }, tabId);
  await expect(sidePanel.locator('#session')).toBeVisible();
  await expect(sidePanel.locator('#retry')).toBeVisible();
  await expect(sidePanel.locator('#reader-hint-text')).toBeHidden();
  await expect(sidePanel.locator('#pdf-access-alert')).toBeVisible();
  await expect(sidePanel.locator('#open-pi-reader')).toHaveText('解决 PDF 读取权限');
  await expect(sidePanel.locator('#translation-text'))
    .toContainText('本次使用：文字 API「DeepSeek text」 · deepseek-test-model');
  const accessAlert = sidePanel.locator('#pdf-access-alert');
  const accessLayout = await accessAlert.evaluate((alert) => ({
    clientWidth: alert.clientWidth,
    scrollWidth: alert.scrollWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    actionHeights: [...alert.querySelectorAll<HTMLElement>('.access-actions button')]
      .map((button) => button.getBoundingClientRect().height),
  }));
  expect(accessLayout.scrollWidth).toBeLessThanOrEqual(accessLayout.clientWidth + 1);
  expect(accessLayout.pageScrollWidth).toBeLessThanOrEqual(accessLayout.viewportWidth + 1);
  expect(accessLayout.actionHeights).toHaveLength(2);
  expect(accessLayout.actionHeights.every((height) => height >= 32)).toBe(true);
  const retryPdfAccess = accessAlert.getByRole('button', { name: '重新检测' });
  await retryPdfAccess.focus();
  await expect(retryPdfAccess).toBeFocused();
  const focusedRecoveryLayout = await retryPdfAccess.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: document.documentElement.clientHeight,
    };
  });
  expect(focusedRecoveryLayout.top).toBeGreaterThanOrEqual(0);
  expect(focusedRecoveryLayout.bottom).toBeLessThanOrEqual(focusedRecoveryLayout.viewportHeight);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-access-recovery-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-access-recovery-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }

  const nextTab = await context.newPage();
  await nextTab.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(sidePanel.locator('#empty-state')).toBeVisible();
  await expect(sidePanel.locator('#session')).toBeHidden();

  await nextTab.close();
  await messageSender.close();
  await sidePanel.close();
});

test('opens the full settings page from the translation card menu', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.locator('details.more > summary').click();

  const settingsPagePromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '完整设置' }).click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForURL((url) => (
    url.protocol === 'chrome-extension:' && url.pathname === '/options.html'
  ));
  await settingsPage.waitForLoadState('domcontentloaded');
  const settingsUrl = new URL(settingsPage.url());
  expect(settingsUrl.protocol).toBe('chrome-extension:');
  expect(settingsUrl.host).toBe(extensionId);
  expect(settingsUrl.pathname).toBe('/options.html');
  await settingsPage.close();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  await clearBrowserSelection();
});

test('stops a streaming translation without discarding received output', async () => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-api/**';
  let releaseFirst: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  let releaseRemaining: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const remainingGate = new Promise<void>((resolve) => { releaseRemaining = resolve; });
  let requestIndex = 0;
  const streamingHandler = async (route: Route): Promise<void> => {
    requestIndex += 1;
    await (requestIndex === 1 ? firstGate : requestIndex === 2 ? secondGate : remainingGate);
    if (requestIndex === 1) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            translation: '已经返回的第一段译文。\n'.repeat(80),
            detectedLanguage: 'en',
            warnings: [],
            segments: [],
          }) } }],
        }),
      }).catch(() => undefined);
      return;
    }
    if (requestIndex === 2) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            translation: '已经返回的第二段译文。\n'.repeat(80),
            detectedLanguage: 'en',
            warnings: [],
            segments: [],
          }) } }],
        }),
      }).catch(() => undefined);
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: '后续译文。',
          detectedLanguage: 'en',
          warnings: [],
          segments: [],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, streamingHandler);
  try {
    await page.locator('#source').evaluate((element) => {
      element.textContent = 'A long academic sentence for streaming translation. '.repeat(250);
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = page.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.getByTitle('停止并关闭')).toBeVisible();
    await expect(overlay.getByRole('button', { name: '停止翻译并保留已收到的译文' }))
      .toBeVisible();
    const pin = overlay.getByTitle('在页面侧栏中显示');
    await expect(pin).toHaveText('页面侧栏');
    await expect(overlay.locator('.loading-status')).toContainText('正在请求模型');
    await pin.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(overlay.locator('.sidebar-region-action')).toContainText('框选网页');
    await expect(overlay.locator('.progress')).toBeVisible();
    await expect(overlay.locator('.loading-status')).toContainText('正在请求模型');

    releaseFirst?.();
    await expect.poll(() => requestIndex).toBeGreaterThanOrEqual(2);
    await expect(overlay.locator('.loading-status')).toContainText('正在接收译文');
    const streamPreview = overlay.locator('.stream-preview');
    await expect(streamPreview).toContainText('已经返回的第一段译文。');
    await expect.poll(() => streamPreview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await streamPreview.evaluate((element) => { element.scrollTop = 0; });

    releaseSecond?.();
    await expect.poll(() => requestIndex).toBeGreaterThanOrEqual(3);
    await expect(streamPreview).toContainText('已经返回的第二段译文。');
    await expect.poll(() => streamPreview.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(overlay.locator('.progress')).toBeVisible();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const stop = overlay.getByRole('button', {
      name: '停止翻译并保留已收到的译文',
    });
    await stop.focus();
    await stop.press('Enter');
    await expect(overlay.locator('.stopped-status'))
      .toHaveText('已停止 · 已保留部分译文');
    await expect(overlay.locator('.stream-preview')).toContainText('已经返回的第一段译文。');
    await expect(overlay.locator('.stream-preview')).toContainText('已经返回的第二段译文。');
    const copyPartial = overlay.getByRole('button', { name: '复制部分译文' });
    await expect(copyPartial).toBeVisible();
    await expect(copyPartial).toBeFocused();
    await expect(overlay.getByRole('button', { name: '重试' })).toHaveCount(0);
    await expect(overlay.locator('.stop-translation')).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(requestIndex).toBe(3);
    await expect(overlay.locator('.stopped-status'))
      .toHaveText('已停止 · 已保留部分译文');
  } finally {
    releaseFirst?.();
    releaseSecond?.();
    releaseRemaining?.();
    await context.unroute(apiPattern, streamingHandler);
    const overlay = page.locator('#tex-selection-translator-root');
    if (await overlay.locator('.surface-close').count()) {
      await overlay.locator('.surface-close').click();
    }
    await page.locator('#source').evaluate((element) => {
      element.textContent = 'A consistent academic translation improves the readability of research papers.';
    });
    await clearBrowserSelection();
  }
});

test('pins continuous translation to a collapsible sidebar', async ({}, testInfo) => {
  const obstructionHintStorageKey = 'sidebarObstructionHintDismissedHostsV1';
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  await worker!.evaluate(async (storageKey) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: { remove(key: string): Promise<void> } } };
    }).chrome;
    await api.storage.local.remove(storageKey);
  }, obstructionHintStorageKey);
  await page.reload();
  await expect(page.locator('#tex-selection-translator-root')).toBeAttached();
  // Await translator initialization and start this scene with the browser sidebar closed.
  // Selecting immediately after reload can precede the asynchronous listener setup.
  await worker!.evaluate(async (url) => {
    const api=(globalThis as any).chrome;
    const tab=(await api.tabs.query({url}))[0];
    await api.tabs.sendMessage(tab.id,{type:'BROWSER_SIDEBAR_CLOSED'});
  },page.url());
  await page.locator('#blank').focus();
  await selectElementText('#source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const obstructionHint = overlay.locator('.sidebar-obstruction-hint');
  await expect(obstructionHint).toContainText('网页内容可能被侧栏遮住');
  await expect(obstructionHint.getByRole('button', { name: '改用浏览器侧栏' })).toBeVisible();
  await expect(obstructionHint.getByRole('button', { name: /继续使用/ })).toBeVisible();
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('web-floating-sidebar-obstruction-hint.png'),
    });
  }
  await obstructionHint.getByRole('button', { name: /继续使用/ }).click();
  await expect(obstructionHint).toHaveCount(0);
  await expect.poll(() => worker!.evaluate(async (storageKey) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
      };
    }).chrome;
    const stored = await api.storage.local.get(storageKey);
    return stored[storageKey];
  }, obstructionHintStorageKey)).toContain('www.overleaf.com');
  const pauseContinuousTranslation = overlay.getByRole('button', {
    name: '暂停当前标签页的自动连续翻译',
  });
  await expect(pauseContinuousTranslation).toHaveText('自动翻译中');
  await expect(pauseContinuousTranslation).toHaveAttribute('aria-pressed', 'false');
  await pauseContinuousTranslation.click();
  const resumeContinuousTranslation = overlay.getByRole('button', {
    name: '继续当前标签页的自动连续翻译',
  });
  await expect(resumeContinuousTranslation).toHaveText('已暂停');
  await expect(resumeContinuousTranslation).toHaveAttribute('aria-pressed', 'true');
  const requestsBeforePausedSelection = textRequests.length;
  await selectElementText('#global-term-source');
  await page.waitForTimeout(450);
  expect(textRequests).toHaveLength(requestsBeforePausedSelection);
  await worker!.evaluate(async (targetUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: {
          query(query: object): Promise<Array<{ id?: number; url?: string }>>;
          sendMessage(tabId: number, message: object): Promise<unknown>;
        };
      };
    }).chrome;
    const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
    if (target?.id === undefined) throw new Error('Missing active web test tab.');
    await api.tabs.sendMessage(target.id, { type: 'TRIGGER_TRANSLATE' });
  }, page.url());
  await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforePausedSelection);
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  const requestsBeforeSecondPausedSelection = textRequests.length;
  await selectElementText('#term-review-source');
  await page.waitForTimeout(450);
  expect(textRequests).toHaveLength(requestsBeforeSecondPausedSelection);
  await overlay.getByRole('button', {
    name: '继续当前标签页的自动连续翻译',
  }).click();
  await expect(overlay.getByRole('button', {
    name: '暂停当前标签页的自动连续翻译',
  })).toHaveText('自动翻译中');
  await openTranslationMore(overlay);
  const webRegionAction = overlay.getByRole('button', {
    name: '框选当前网页中的文字、公式、图表或图像',
  });
  await expect(webRegionAction).toBeVisible();
  await expect(webRegionAction).toContainText('框选网页');
  await expect(webRegionAction).toHaveAttribute('title','框选当前网页中的文字、公式、图表或图像');
  expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(33);
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('web-floating-sidebar-region-action.png'),
    });
  }
  const requestsBeforeRegionSelection = textRequests.length;
  await webRegionAction.click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.error')).toHaveCount(0);
  await expect(overlay.locator('.capture-permission')).toContainText(
    '首次框选需要一次截图授权',
  );
  await expect(overlay.locator('.capture-permission')).toContainText(
    '允许后立即进入框选',
  );
  await expect(overlay.locator('.sidebar-region-action')).toHaveCount(0);
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('web-floating-sidebar-permission-preflight.png'),
    });
  }
  const preflightFrameElement = overlay.locator('.capture-permission-frame');
  const preflightFrameHandle = await preflightFrameElement.elementHandle();
  const preflightFrame = await preflightFrameHandle?.contentFrame();
  expect(preflightFrame).toBeDefined();
  await expect(preflightFrame!.locator('#label')).toHaveText('允许截图并开始框选');
  expect(new URL(preflightFrame!.url()).searchParams.get('intent')).toBe('start');
  await preflightFrame!.evaluate(() => {
    const extensionChrome = (globalThis as typeof globalThis & {
      chrome: { permissions: object };
    }).chrome;
    Object.defineProperty(extensionChrome.permissions, 'request', {
      configurable: true,
      value: async () => false,
    });
  });
  await preflightFrame!.getByRole('button', { name: /允许截图并开始框选/ }).click();
  await expect(preflightFrame!.locator('#label')).toHaveText('未允许，点击重试');
  await expect(page.locator('#pi-web-region-selection-root')).toHaveCount(0);
  await preflightFrame!.evaluate(() => {
    const extensionChrome = (globalThis as typeof globalThis & {
      chrome: { permissions: object };
    }).chrome;
    Object.defineProperty(extensionChrome.permissions, 'request', {
      configurable: true,
      value: async () => true,
    });
  });
  await preflightFrame!.getByRole('button', { name: /未允许，点击重试/ })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const webRegion = page.locator('#pi-web-region-selection-root');
  await expect(webRegion).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(webRegion).toHaveCount(0);
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await openTranslationMore(overlay);
  await expect(overlay.locator('.sidebar-region-action')).toBeVisible();
  expect(textRequests).toHaveLength(requestsBeforeRegionSelection);
  await worker!.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __piOriginalPermissionsContains?: (query: { origins?: string[] }) => Promise<boolean>;
      chrome: {
        permissions: {
          contains(query: { origins?: string[] }): Promise<boolean>;
        };
      };
    };
    const permissions = scope.chrome.permissions;
    scope.__piOriginalPermissionsContains ??= permissions.contains.bind(permissions);
    Object.defineProperty(permissions, 'contains', {
      configurable: true,
      value: async (query: { origins?: string[] }) => (
        query.origins?.includes('<all_urls>')
          ? true
          : scope.__piOriginalPermissionsContains!(query)
      ),
    });
  });
  try {
    await overlay.locator('.sidebar-region-action').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await expect(webRegion).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(webRegion).toHaveCount(0);
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  } finally {
    await worker!.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __piOriginalPermissionsContains?: (query: { origins?: string[] }) => Promise<boolean>;
        chrome: { permissions: object };
      };
      if (!scope.__piOriginalPermissionsContains) return;
      Object.defineProperty(scope.chrome.permissions, 'contains', {
        configurable: true,
        value: scope.__piOriginalPermissionsContains,
      });
      delete scope.__piOriginalPermissionsContains;
    });
  }
  const moreMenu = overlay.locator('details.more');
  await moreMenu.locator('summary').click();
  const menu = overlay.locator('.menu');
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText('收藏当前译文');
  await expect(menu).not.toContainText('导出当前会话为 Markdown');
  await expect(menu).not.toContainText('复制原文与译文');
  await expect(menu).not.toContainText('翻译风格');
  await expect(menu).not.toContainText('应用并重新翻译');
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (menuBox && viewport) {
    expect(menuBox.y).toBeGreaterThanOrEqual(8);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 8);
  }
  await page.locator('#blank').click();
  await expect(moreMenu).not.toHaveAttribute('open', '');
  const collapse = overlay.getByTitle('收起侧栏');
  await collapse.focus();
  await collapse.press('Enter');
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  const expand = overlay.getByTitle('展开 Pi Translator 连续翻译侧栏');
  await expect(expand).toBeFocused();
  await expand.press('Enter');
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.getByTitle('收起侧栏')).toBeFocused();
  await worker!.evaluate(async (targetUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: {
          query(query: object): Promise<Array<{ id?: number; url?: string }>>;
          sendMessage(tabId: number, message: object): Promise<unknown>;
        };
      };
    }).chrome;
    const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
    if (target?.id === undefined) throw new Error('Missing active web test tab.');
    await api.tabs.sendMessage(target.id, { type: 'START_WEB_REGION_SELECTION' });
  }, page.url());
  const formulaBox = await page.locator('#math-source').boundingBox();
  expect(formulaBox).not.toBeNull();
  if (formulaBox) {
    await page.mouse.move(formulaBox.x - 4, formulaBox.y - 4);
    await page.mouse.down();
    await page.mouse.move(
      formulaBox.x + formulaBox.width + 4,
      formulaBox.y + formulaBox.height + 4,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  const sidebarRegion = page.locator('#pi-web-region-selection-root');
  await sidebarRegion.locator('.confirm').click();
  await expect(sidebarRegion).toHaveCount(0);
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.capture-permission-frame')).toBeVisible();
  await expect(overlay.locator('.capture-permission')).toContainText('授权后自动恢复刚才的框选');
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('web-floating-sidebar-inline-permission.png'),
    });
  }
  await overlay.getByTitle('关闭').click();
  await expect(page.locator('#blank')).toBeFocused();
  await clearBrowserSelection();
  await worker!.evaluate(async (storageKey) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: { remove(key: string): Promise<void> } } };
    }).chrome;
    await api.storage.local.remove(storageKey);
  }, obstructionHintStorageKey);
  await page.reload();
  await expect.poll(async () => {
    await worker!.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          };
        };
      }).chrome;
      const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
      if (target?.id === undefined) throw new Error('Missing active web test tab.');
      await api.tabs.sendMessage(target.id, { type: 'OPEN_SIDEBAR' });
    }, page.url()).catch(() => undefined);
    return overlay.getAttribute('data-pi-view');
  }).toBe('sidebar');
  const idleObstructionHint = overlay.locator('.sidebar-obstruction-hint');
  await expect(idleObstructionHint).toContainText('浏览器侧栏不会覆盖页面');
  await worker!.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __piOriginalSidePanelOpen?: (options: { tabId: number }) => Promise<void>;
      chrome: {
        sidePanel: {
          open(options: { tabId: number }): Promise<void>;
        };
      };
    };
    const sidePanel = scope.chrome.sidePanel;
    scope.__piOriginalSidePanelOpen ??= sidePanel.open.bind(sidePanel);
    Object.defineProperty(sidePanel, 'open', {
      configurable: true,
      value: async () => undefined,
    });
  });
  try {
    await idleObstructionHint.getByRole('button', { name: '改用浏览器侧栏' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await expect.poll(() => worker!.evaluate(async (storageKey) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: { local: { get(key: string): Promise<Record<string, unknown>> } };
        };
      }).chrome;
      const stored = await api.storage.local.get(storageKey);
      return stored[storageKey];
    }, obstructionHintStorageKey)).toContain('www.overleaf.com');
    expect(await worker!.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: { local: { get(key: string): Promise<Record<string, Record<string, unknown>>> } };
        };
      }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      return stored.extensionSettings?.sidebarMode;
    })).toBe('floating');
  } finally {
    await worker!.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __piOriginalSidePanelOpen?: (options: { tabId: number }) => Promise<void>;
        chrome: { sidePanel: object };
      };
      if (!scope.__piOriginalSidePanelOpen) return;
      Object.defineProperty(scope.chrome.sidePanel, 'open', {
        configurable: true,
        value: scope.__piOriginalSidePanelOpen,
      });
      delete scope.__piOriginalSidePanelOpen;
    });
  }
  await page.reload();
});
