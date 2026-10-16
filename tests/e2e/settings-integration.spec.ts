import {openTranslationMore} from './support/translation-controls';
import {
  context,
  createTextPdf,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  page,
  test,
  textRequests,
  type TestChromeApi,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('keeps advanced options collapsed until requested', async ({}, testInfo) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = options.locator('#onboarding-dialog');
  await expect(onboarding).not.toBeVisible();
  await expect(options.locator('[data-settings-section="connection"]')).toBeVisible();
  await expect(options.locator('[data-settings-section="results"]')).not.toBeVisible();
  await expect(options.locator('.connection-step')).toHaveCount(3);
  await expect(options.locator('.connection-step').nth(0)).toContainText('服务商');
  await expect(options.locator('.connection-step').nth(1)).toContainText('API Key');
  await expect(options.locator('.connection-step').nth(2)).toContainText('连接并保存');
  await expect(options.locator('#connection-advanced #test-connection')).toHaveCount(1);
  await expect(options.locator('#vision-setup-guide')).not.toBeVisible();
  await options.locator('#vision-setup-details > summary').click();
  await expect(options.locator('#vision-setup-guide')).toBeVisible();
  await options.locator('#vision-setup-details > summary').click();
  const providerSelect = options.locator('#api-preset');
  await expect(providerSelect.locator('option').first()).toHaveAttribute('value', 'deepseek');
  await expect(providerSelect.locator('option').last()).toHaveAttribute('value', 'custom');
  await options.locator('#refresh-models').click();
  await expect(options.locator('#status')).toContainText('自动配置完成');
  await expect(options.locator('#status')).toContainText('已保存');
  await expect(options.locator('#save-state')).toContainText('所有设置已保存');
  await expect(options.locator('#save-button')).toBeDisabled();
  await expect(options.locator('#save-button')).toHaveText('已保存');
  await expect(options.locator('#model-list option')).toHaveCount(2);
  await expect(options.locator('#connection-summary')).toBeVisible();
  await expect(options.locator('#connection-text-status')).toContainText('e2e-model');
  const connectionTab = options.locator('[data-settings-target="connection"]');
  await connectionTab.focus();
  await connectionTab.press('ArrowRight');
  await expect(options.locator('[data-settings-section="translation"]')).toBeVisible();
  await expect(options.locator('[data-settings-target="translation"]')).toHaveAttribute(
    'tabindex',
    '0',
  );
  await options.locator('[data-settings-target="results"]').click();
  await expect(options.locator('[data-settings-section="results"]')).toBeVisible();
  await expect(options.locator('#auto-render-latex')).toBeChecked();
  const advanced = options.locator('details.advanced-panel');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(options.locator('#context-mode')).toBeVisible();
  await expect(options.locator('#enable-streaming')).toBeVisible();
  await expect(options.locator('#protect-sensitive-fields')).toBeVisible();
  await expect(options.locator('#pdf-keyboard-shortcuts')).toBeChecked();
  await expect(options.locator('#pdf-region-shortcut-key')).toHaveValue('R');
  await options.locator('#pdf-keyboard-shortcuts').uncheck();
  await expect(options.locator('#pdf-region-shortcut-key')).toBeDisabled();
  await options.locator('#alignment-default').check();
  await expect(options.locator('#save-state')).toContainText('未保存');
  await expect(options.locator('#save-button')).toBeEnabled();
  await expect(options.locator('#save-button')).toHaveText('保存更改');
  await options.close();

  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 360, height: 620 });
  await reopened.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.locator('[data-settings-target="support"]').click();
  const support = reopened.locator('details.support-disclosure').filter({has:reopened.locator('#copy-diagnostic-report')});
  await expect(reopened.locator('details.support-disclosure').filter({has:reopened.locator('#extension-version')})).not.toHaveAttribute('open','');
  await expect(support).not.toHaveAttribute('open', '');
  await support.locator('summary').click();
  await reopened.locator('#restart-onboarding').click();
  await expect(reopened.locator('#onboarding-dialog')).toBeVisible();
  const onboardingPreset = reopened.locator('#onboarding-preset');
  await expect(onboardingPreset).toBeFocused();
  await expect(onboardingPreset.locator('option')).toHaveCount(5);
  await expect(onboardingPreset.locator('option').first()).toHaveAttribute('value', 'deepseek');
  await expect(onboardingPreset.locator('option').last()).toHaveAttribute('value', 'custom');
  await expect(onboardingPreset.locator('option[value="custom"]')).toHaveText(
    '自定义 OpenAI 兼容 API',
  );
  await onboardingPreset.selectOption('deepseek');
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue(
    'https://api.deepseek.com',
  );
  await expect(reopened.locator('#onboarding-base-url-field')).toBeHidden();
  const onboardingProviderLayout = await reopened.locator('#onboarding-dialog')
    .evaluate((dialog) => {
      const actions = dialog.querySelector<HTMLElement>('.onboarding-actions')!;
      const next = dialog.querySelector<HTMLElement>('#onboarding-next')!;
      const dialogRect = dialog.getBoundingClientRect();
      return {
        dialogLeft: dialogRect.left,
        dialogRight: dialogRect.right,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        actionWidth: actions.clientWidth,
        nextWidth: next.getBoundingClientRect().width,
        overflowingElements: [dialog as HTMLElement, ...dialog.querySelectorAll<HTMLElement>('*')]
          .filter((element) => !element.hidden && element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            selector: element.id ? `#${element.id}` : element.className || element.tagName,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
      };
    });
  expect(onboardingProviderLayout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(onboardingProviderLayout.dialogRight)
    .toBeLessThanOrEqual(onboardingProviderLayout.pageClientWidth + 1);
  expect(onboardingProviderLayout.pageScrollWidth)
    .toBeLessThanOrEqual(onboardingProviderLayout.pageClientWidth + 1);
  expect(onboardingProviderLayout.overflowingElements).toEqual([]);
  expect(onboardingProviderLayout.nextWidth)
    .toBeGreaterThanOrEqual(onboardingProviderLayout.actionWidth - 1);
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-provider-360-light.png') });
    await reopened.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => onboardingPreset.evaluate((select) => ({
      appearance: getComputedStyle(select).appearance,
      background: getComputedStyle(select).backgroundColor,
      color: getComputedStyle(select).color,
    }))).toEqual({
      appearance: 'none',
      background: 'rgb(23, 31, 44)',
      color: 'rgb(237, 242, 248)',
    });
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-provider-360-dark.png') });
    await reopened.emulateMedia({ colorScheme: 'light' });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-api-key')).toBeFocused();
  await expect(reopened.locator('#onboarding-back')).toBeVisible();
  await expect(reopened.locator('#onboarding-open-key-page')).toBeVisible();
  await expect(reopened.locator('#onboarding-open-key-page')).toHaveAttribute(
    'data-key-url',
    'https://platform.deepseek.com/api_keys',
  );
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-key-360-light.png') });
  }
  await reopened.locator('#onboarding-back').click();
  await expect(onboardingPreset).toBeFocused();
  await onboardingPreset.selectOption('custom');
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-api-key')).toBeFocused();
  await expect(reopened.locator('#onboarding-base-url-field')).toBeVisible();
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue('');
  await expect(reopened.locator('#onboarding-model')).toHaveValue('');
  await reopened.locator('#onboarding-api-key').fill('e2e-onboarding-key');
  await reopened.locator('#onboarding-base-url').fill(
    'https://www.overleaf.com/pi-translator-e2e-api',
  );
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-model')).toBeFocused();
  await expect(reopened.locator('#onboarding-model')).toHaveValue('e2e-model');
  await expect(reopened.locator('#onboarding-status')).toContainText('连接成功');
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-model-360-light.png') });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-success')).toBeVisible();
  await expect(reopened.locator('#onboarding-title')).toHaveText('Pi Translator 已就绪');
  await expect(reopened.locator('#onboarding-sample-source')).toHaveText(
    'Pi Translator makes multilingual reading easier.',
  );
  await expect(reopened.locator('#onboarding-sample-translation')).not.toBeEmpty();
  await expect(reopened.locator('.onboarding-paths > div')).toHaveCount(3);
  await expect(reopened.locator('#onboarding-next')).toHaveText('完成');
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-success-360-light.png') });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.close();
});

test('automatically binds a visual-capable active API when settings are saved', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        activeApiProfileId: 'default',
        visionApiProfileId: '',
        visionModel: '',
      },
    });
  });
  await options.reload();
  await expect(options.locator('#vision-api-profile')).toHaveValue('');

  await options.locator('[data-settings-target="translation"]').click();
  await options.locator('#target-language').selectOption('ja');
  await expect(options.locator('#save-button')).toBeEnabled();
  await options.locator('button[type="submit"]').click();
  await expect(options.locator('#status')).toContainText(
    '已自动启用图像区域翻译',
  );
  await expect(options.locator('#vision-api-profile')).toHaveValue('default');
  await expect(options.locator('#vision-model')).toHaveValue('e2e-model');
  await expect.poll(() => options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return stored.extensionSettings?.visionApiProfileId;
  })).toBe('default');
  await options.close();
});

test('keeps the text API active while a second profile is configured for PDF images', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const profileIds = await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings as {
      apiProfiles: Array<{ id: string; name: string; apiBaseUrl: string; model: string }>;
    };
    const textProfile = settings.apiProfiles[0]!;
    const visionProfile = {
      ...textProfile,
      id: 'e2e-vision-profile',
      name: 'Qwen 视觉测试',
    };
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...stored.extensionSettings,
        apiProfiles: [textProfile, visionProfile],
        activeApiProfileId: textProfile.id,
        visionApiProfileId: '',
        visionModel: '',
      },
    });
    return { text: textProfile.id, vision: visionProfile.id };
  });
  await options.reload();
  await expect(options.locator('#profile-role-status')).toContainText('文字翻译');

  await options.locator('#api-profile').selectOption(profileIds.vision);
  await expect(options.locator('#profile-role-status')).toContainText('尚未分配');
  await expect(options.locator('#use-text-profile')).toBeVisible();
  await options.locator('#api-key').fill('e2e-review-key');
  await options.locator('#refresh-models').click();
  await expect(options.locator('#status')).toContainText('文字继续使用');
  await expect(options.locator('#profile-role-status')).toContainText('图像翻译');
  await expect(options.locator('#profile-role-status')).not.toContainText('文字翻译');

  await expect(options.locator('#save-button')).toBeDisabled();
  await expect.poll(() => options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return {
      text: stored.extensionSettings?.activeApiProfileId,
      vision: stored.extensionSettings?.visionApiProfileId,
    };
  })).toEqual(profileIds);
  await options.close();
});

test('uses and remembers a visual-capable active API on the first image translation', async () => {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
  const response = await extensionPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    const configurationRevision = crypto.randomUUID();
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        activeApiProfileId: 'default',
        visionApiProfileId: '',
        visionModel: '',
      },
      configurationRevision: {
        id: configurationRevision,
        committedAt: Date.now(),
        invalidatesTranslationState: true,
      },
    });
    const sessionStorage = (extensionChrome.storage as unknown as {
      session: { get(key: string): Promise<Record<string, unknown>> };
    }).session;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const applied = await sessionStorage.get('appliedConfigurationRevision');
      if (applied.appliedConfigurationRevision === configurationRevision) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      if (attempt === 79) throw new Error('Configuration revision was not applied.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#111';
    context.fillRect(3, 3, 10, 10);
    return extensionChrome.runtime.sendMessage({
      type: 'TRANSLATE_IMAGE_REGION',
      payload: {
        requestId: crypto.randomUUID(),
        imageDataUrl: canvas.toDataURL('image/png'),
        imageWidth: 16,
        imageHeight: 16,
        pageUrl: 'https://www.overleaf.com/project/auto-vision-e2e',
        targetLanguage: '简体中文',
        sourceLanguage: 'auto',
        style: 'academic',
      },
    });
  }) as { ok?: boolean };
  expect(response.ok).toBe(true);
  await expect.poll(() => extensionPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return {
      profileId: stored.extensionSettings?.visionApiProfileId,
      model: stored.extensionSettings?.visionModel,
    };
  })).toEqual({ profileId: 'default', model: 'e2e-model' });
  await extensionPage.close();
});

test('persists and undoes a native PDF correction through the real background session', async ({}, testInfo) => {
  const sourceUrl = 'https://www.overleaf.com/native-correction-success.pdf';
  const source = 'A durable correction should survive a background restart.';
  const originalTranslation = '原始 PDF 译文保留公式 $E=mc^2$。';
  const correctedTextPart = '修正后的 PDF 译文仍保留公式 ';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf(source),
    });
  });
  const sidePanel = await context.newPage();
  const nativePdfPage = await context.newPage();
  try {
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    const tabId = await worker!.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { query(query: object): Promise<Array<{ id?: number }>> } };
      }).chrome;
      return (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    });
    expect(tabId).toBeDefined();
    const baseResultRequestId = 'native-correction-base-result-e2e';
    const sessionRequestId = 'native-correction-session-e2e';
    await sidePanel.evaluate(async ({ id, pageUrl, sourceText, translation, resultRequestId, requestId }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      const stored = await api.storage.session.get('pdfSidePanelSessionsByTab');
      const sessions = stored.pdfSidePanelSessionsByTab &&
        typeof stored.pdfSidePanelSessionsByTab === 'object'
        ? stored.pdfSidePanelSessionsByTab as Record<string, unknown>
        : {};
      await api.storage.session.set({
        pdfSidePanelSessionsByTab: {
          ...sessions,
          [String(id)]: {
            tabId: id,
            targetLanguage: 'zh-CN',
            requestId,
            sourceText,
            pageUrl,
            sourceLabel: 'native-correction-success.pdf',
            status: 'complete',
            startedAt: Date.now(),
            partialText: translation,
            result: {
              requestId: resultRequestId,
              originalText: sourceText,
              translatedText: translation,
              targetLanguage: 'zh-CN',
              warnings: [],
              latencyMs: 640,
            },
          },
        },
        [`translationResultHead:${id}`]: {
          tabId: id,
          currentResultRequestId: resultRequestId,
          rootRequestId: resultRequestId,
          updatedAt: Date.now(),
        },
      });
    }, {
      id: tabId!,
      pageUrl: sourceUrl,
      sourceText: source,
      translation: originalTranslation,
      resultRequestId: baseResultRequestId,
      requestId: sessionRequestId,
    });

    let restartCount = 0;
    const restartBackground = async (): Promise<void> => {
      const cdp = await context.newCDPSession(sidePanel);
      const stoppedVersions = new Set<string>();
      const lifecycle: Array<{ versionId: string; status: string }> = [];
      const workerVersions = new Map<string, {
        versionId: string;
        scriptURL: string;
        runningStatus: 'stopped' | 'starting' | 'running' | 'stopping';
      }>();
      cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        versions.forEach((version) => {
          workerVersions.set(version.versionId, version);
          lifecycle.push({ versionId: version.versionId, status: version.runningStatus });
          if (version.runningStatus === 'stopped') stoppedVersions.add(version.versionId);
        });
      });
      try {
        await cdp.send('ServiceWorker.enable');
        await expect.poll(() => Array.from(workerVersions.values()).find((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
        ))?.runningStatus).toBe('running');
        const activeVersion = Array.from(workerVersions.values()).find((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
          && version.runningStatus === 'running'
        ));
        expect(activeVersion).toBeDefined();
        stoppedVersions.delete(activeVersion!.versionId);
        await cdp.send('ServiceWorker.stopWorker', { versionId: activeVersion!.versionId });
        // An extension event may restart the worker before the next poll. Keep
        // proof of the actual stopped event instead of losing it to the latest state.
        await expect.poll(() => stoppedVersions.has(activeVersion!.versionId)).toBe(true);
        const response = await sidePanel.evaluate(async (id) => {
          const api = (globalThis as typeof globalThis & {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }).chrome;
          return api.runtime.sendMessage({
            type: 'GET_PDF_SIDE_PANEL_SESSION',
            payload: { tabId: id },
          });
        }, tabId!);
        await expect.poll(() => Array.from(workerVersions.values()).some((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
          && version.runningStatus === 'running'
        ))).toBe(true);
        expect(response).toMatchObject({ ok: true });
      } finally {
        await testInfo.attach(`background-lifecycle-${++restartCount}`, {
          body: JSON.stringify(lifecycle, null, 2), contentType: 'application/json',
        });
        await cdp.detach();
      }
    };

    await restartBackground();
    await expect(sidePanel.locator('#session')).toBeVisible();
    await expect(sidePanel.locator('#translation-text')).toContainText('原始 PDF 译文保留公式');
    await openTranslationMore(sidePanel);
    await sidePanel.locator('#correct').click();
    const correction = sidePanel.getByRole('group', { name: '修正译文，公式已锁定' });
    await correction.getByLabel('可编辑译文第 1 段').fill(correctedTextPart);
    await correction.getByRole('button', { name: '保存', exact: true }).click();
    await expect(sidePanel.locator('#translation-text')).toContainText('修正后的 PDF 译文仍保留公式');
    await expect(sidePanel.locator('#translation-text')).toContainText('E=mc2');
    await expect(sidePanel.locator('#correction-undo')).toBeVisible();
    await expect(sidePanel.locator('#undo-correction')).toBeFocused();

    const correctedSession = await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(keys: string[]): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get([
        'pdfSidePanelSessionsByTab',
        `translationResultHead:${id}`,
      ]);
      const sessions = stored.pdfSidePanelSessionsByTab as Record<string, unknown>;
      return {
        session: sessions[String(id)],
        head: stored[`translationResultHead:${id}`],
      };
    }, tabId!);
    expect(correctedSession).toMatchObject({
      session: {
        status: 'complete',
        partialText: `${correctedTextPart}$E=mc^2$。`,
        correctionReceipt: {
          baseRequestId: baseResultRequestId,
          previousTranslation: originalTranslation,
        },
      },
      head: { tabId },
    });
    const correctedRequestId = (
      correctedSession.session as { result: { requestId: string } }
    ).result.requestId;
    expect((correctedSession.head as { currentResultRequestId: string }).currentResultRequestId)
      .toBe(correctedRequestId);

    await restartBackground();
    await sidePanel.reload({ waitUntil: 'domcontentloaded' });
    await expect(sidePanel.locator('#translation-text')).toContainText('修正后的 PDF 译文仍保留公式');
    await expect(sidePanel.locator('#correction-undo')).toBeVisible();
    await sidePanel.locator('#undo-correction').click();
    await expect(sidePanel.locator('#translation-text')).toContainText('原始 PDF 译文保留公式');
    await expect(sidePanel.locator('#correction-undo')).toBeHidden();
    await expect(sidePanel.locator('#panel-more > summary')).toBeFocused();

    const restoredSession = await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(keys: string[]): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get([
        'pdfSidePanelSessionsByTab',
        `translationResultHead:${id}`,
      ]);
      const sessions = stored.pdfSidePanelSessionsByTab as Record<string, unknown>;
      return {
        session: sessions[String(id)],
        head: stored[`translationResultHead:${id}`],
      };
    }, tabId!);
    expect(restoredSession).toMatchObject({
      session: {
        status: 'complete',
        partialText: originalTranslation,
        result: { translatedText: originalTranslation },
      },
      head: { tabId },
    });
    expect(restoredSession.session).not.toHaveProperty('correctionReceipt');
    expect((restoredSession.head as { currentResultRequestId: string }).currentResultRequestId)
      .not.toBe(correctedRequestId);

    const requestsBeforeLanguageChange = textRequests.length;
    const nativeTargetLanguage = sidePanel.getByLabel('目标语言');
    await expect(nativeTargetLanguage).toHaveValue('zh-CN');
    await nativeTargetLanguage.selectOption('en');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeLanguageChange);
    await expect(nativeTargetLanguage).toHaveValue('en');
    await expect(nativeTargetLanguage).toBeEnabled();
    expect(JSON.stringify(textRequests.at(-1))).toContain('to en');
    expect(await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get('pdfSidePanelSessionsByTab');
      const sessions = stored.pdfSidePanelSessionsByTab as Record<
        string,
        { targetLanguage?: string; result?: { targetLanguage?: string } }
      >;
      return {
        session: sessions[String(id)]?.targetLanguage,
        result: sessions[String(id)]?.result?.targetLanguage,
      };
    }, tabId!)).toEqual({ session: 'en', result: 'en' });

    await restartBackground();
    await sidePanel.reload({ waitUntil: 'domcontentloaded' });
    await expect(nativeTargetLanguage).toHaveValue('en');
  } finally {
    await nativePdfPage.close().catch(() => undefined);
    await sidePanel.close().catch(() => undefined);
    await context.unroute(sourceUrl).catch(() => undefined);
  }
});
