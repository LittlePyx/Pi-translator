import type { Page, Route } from '@playwright/test';
import {
  clearBrowserSelection,
  closeVisibleTranslationSurfaceForCleanup,
  context,
  createTextPdf,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  mockControl,
  OVERLEAF_FIXTURE_URL,
  page,
  replaceStoredApiKeys,
  selectElementText,
  selectSourceText,
  test,
  textRequests,
  visionRequests,
  waitForVisibleBoundingBox,
  type TestChromeApi,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('reports the shortcut actually assigned by Edge', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const commands = await worker!.evaluate(() => new Promise<Array<{
    name?: string;
    shortcut?: string;
  }>>((resolve) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { commands: { getAll(callback: (commands: Array<{
        name?: string;
        shortcut?: string;
      }>) => void): void } };
    }).chrome;
    api.commands.getAll(resolve);
  }));
  const translationCommand = commands.find((command) => command.name === 'translate-selection');
  expect(translationCommand).toBeDefined();

  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const onboarding = options.locator('#onboarding-dialog');
    if (await onboarding.isVisible()) await options.locator('#onboarding-skip').click();
    const chip = options.locator('#translation-shortcut-chip');
    if (translationCommand?.shortcut) {
      await expect(chip).toContainText(translationCommand.shortcut.replaceAll('+', ' + '));
      await expect(options.locator('#translation-shortcut-help'))
        .toContainText(translationCommand.shortcut.split('+')[0]!);
    } else {
      await expect(chip).toHaveText('翻译快捷键未设置');
      await expect(options.locator('#open-shortcuts')).toHaveText('设置快捷键');
    }
  } finally {
    await options.close();
  }

  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const readinessPanel = popup.locator('#readiness-panel');
    await expect(readinessPanel).not.toHaveAttribute('aria-busy', 'true');
    if (translationCommand?.shortcut) {
      await expect(readinessPanel).toHaveAttribute('data-state', 'ready');
      await expect(readinessPanel).toBeHidden();
      await expect(popup.locator('#readiness-issues')).toBeHidden();
    } else {
      await expect(readinessPanel).toHaveAttribute('data-state', 'issue');
      await expect(popup.locator('#readiness-issues')).toContainText('翻译快捷键尚未设置');
      await expect(readinessPanel.getByRole('button', { name: '设置快捷键' })).toBeVisible();
    }
  } finally {
    await popup.close();
  }
});

test('shows a compact contextual lookup for a short selection', async () => {
  const requestsBefore = textRequests.length;
  await selectElementText('#lookup-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();

  await expect(overlay.locator('.title')).toHaveText('简明释义');
  await expect(overlay.locator('.lexical-source')).toHaveText('continuity');
  await expect(overlay.locator('.lexical-meta')).toContainText('/ˌkɒntɪˈnjuːəti/');
  await expect(overlay.locator('.lexical-meta')).toContainText('noun');
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
  await expect(overlay.locator('.lexical-sense')).toContainText('连贯性');

  await overlay.getByRole('button', { name: '按普通译文方式查看' }).click();
  await expect(overlay.locator('.title')).toHaveText('翻译结果');
  await expect(overlay.locator('.body')).toHaveText('连续性');
  await overlay.getByRole('button', { name: '返回短词和短语释义' }).click();
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');

  expect(textRequests).toHaveLength(requestsBefore + 1);
  const request = JSON.stringify(textRequests.at(-1));
  expect(request).toContain('lookup_and_translate');
  expect(request).toContain('lookupMode');
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
});

test('deep-links recovery actions to API and PDF image settings', async () => {
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=api#connection`);
    await expect(options.locator('#api-key')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=api-model#connection`,
    );
    await expect(options.locator('#model')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=api-permission#connection`,
    );
    await expect(options.locator('#connection-advanced')).toHaveAttribute('open', '');
    await expect(options.locator('#test-connection')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=pages#pages`);
    await expect(options.locator('#settings-pages')).toBeVisible();
    await expect(options.locator('#general-page-mode')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=vision#connection`);
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open', '');
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#api-key')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-model#connection`,
    );
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#vision-model')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-permission#connection`,
    );
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#test-vision-capability')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-ocr#connection`,
    );
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open', '');
    await expect(options.locator('#setup-qwen')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=glossary#translation`);
    await expect(options.locator('details').filter({ has: options.locator('#academic-glossary') }))
      .toHaveAttribute('open', '');
    await expect(options.locator('#academic-glossary')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=support#support`);
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();

    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: false },
      });
    });
    await options.reload({ waitUntil: 'domcontentloaded' });
    await expect(options.locator('#onboarding-dialog')).toBeVisible();
    await options.locator('#onboarding-skip').click();
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();

    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: false },
      });
    });
    await options.reload({ waitUntil: 'domcontentloaded' });
    await expect(options.locator('#onboarding-dialog')).toBeVisible();
    await options.keyboard.press('Escape');
    await expect(options.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();
    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: true },
      });
    });
  } finally {
    if (!options.isClosed()) {
      await options.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
        const stored = await api.storage.local.get('extensionSettings');
        await api.storage.local.set({
          extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: true },
        });
      }).catch(() => undefined);
    }
    await options.close();
  }
});

test('returns to the original selection and resumes after a missing API key is configured', async () => {
  const sourceText = 'A configured API should resume this selected translation automatically.';
  await replaceStoredApiKeys({ 'vision-e2e': 'e2e-vision-key' });

  const requestsBefore = textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceText)
  )).length;
  await selectElementText('#recovery-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').focus();
  await overlay.locator('.trigger').press('Enter');
  await expect(overlay.locator('.error')).toContainText('API Key');
  await expect(overlay.getByRole('button', { name: '重试' })).toHaveCount(0);

  const optionsPromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '配置 API' }).click();
  const options = await optionsPromise;
  await options.waitForLoadState('domcontentloaded');
  await options.emulateMedia({ colorScheme: 'dark' });
  const recoveryBanner = options.locator('#settings-recovery-banner');
  await expect(recoveryBanner).toBeVisible();
  await expect(options.locator('#settings-recovery-title'))
    .toHaveText('完成文字 API 配置后继续');
  await expect(options.locator('#settings-recovery-status')).toHaveAttribute('role', 'status');
  await expect(options.locator('#settings-recovery-status')).toHaveAttribute('aria-live', 'polite');
  await expect(options.locator('#api-key')).toBeFocused();
  await expect.poll(() => recoveryBanner.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).not.toBe('rgb(255, 255, 255)');
  expect(options.url()).not.toContain(sourceText);

  // The opaque recovery token survives a settings-page reload in this tab,
  // while remaining absent from the visible URL.
  await options.reload({ waitUntil: 'domcontentloaded' });
  await expect(options.locator('#settings-recovery-banner')).toBeVisible();
  await expect(options.locator('#settings-recovery-title'))
    .toHaveText('完成文字 API 配置后继续');
  expect(options.url()).not.toContain('recovery=');

  await options.locator('#api-key').fill('e2e-recovery-key');
  await options.locator('#refresh-models').click();

  await expect(overlay.locator('.body')).toHaveText(
    '一致的学术翻译能够提升研究论文的可读性。',
  );
  await expect.poll(() => textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceText)
  )).length).toBe(requestsBefore + 1);
  await expect(options.locator('#settings-recovery-status'))
    .toContainText('已返回原页面并继续翻译');

  await options.close();
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
});

test('finishes first-time setup and resumes the first interrupted translation', async () => {
  const sourceText = 'First-time API setup should resume this interrupted translation.';
  const recoverySource = page.locator('#recovery-source');
  const originalSourceText = await recoverySource.textContent();
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const originalConfiguration = await worker!.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: {
        local: {
          get(key: string | string[]): Promise<Record<string, unknown>>;
          set(values: Record<string, unknown>): Promise<void>;
        };
        session: {
          get(key: string | string[]): Promise<Record<string, unknown>>;
          set(values: Record<string, unknown>): Promise<void>;
        };
      } };
    }).chrome;
    const [settings, localCredentials, sessionCredentials] = await Promise.all([
      api.storage.local.get('extensionSettings'),
      api.storage.local.get(['apiKeysByProfile', 'apiKey', 'deepseekApiKey']),
      api.storage.session.get(['apiKeysByProfile', 'apiKey', 'deepseekApiKey']),
    ]);
    await api.storage.local.set({
      extensionSettings: {
        ...(settings.extensionSettings as Record<string, unknown>),
        onboardingCompleted: false,
      },
    });
    return {
      settings: settings.extensionSettings,
      localCredentials,
      sessionCredentials,
    };
  });
  let options: Page | undefined;
  try {
    await replaceStoredApiKeys({ 'vision-e2e': 'e2e-vision-key' });
    await recoverySource.evaluate((element, text) => {
      element.textContent = text;
    }, sourceText);
    const requestsBefore = textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    )).length;
    await selectElementText('#recovery-source');
    const overlay = page.locator('#tex-selection-translator-root');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.error')).toContainText('API Key');
    expect(textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    ))).toHaveLength(requestsBefore);

    const optionsPromise = context.waitForEvent('page');
    await overlay.getByRole('button', { name: '配置 API' }).click();
    options = await optionsPromise;
    await options.waitForLoadState('domcontentloaded');
    const onboarding = options.locator('#onboarding-dialog');
    await expect(onboarding).toBeVisible();
    await expect(options.locator('#settings-recovery-banner')).toBeVisible();
    await expect(options.locator('#onboarding-preset')).toBeFocused();

    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-api-key')).toBeFocused();
    await options.locator('#onboarding-api-key').fill('e2e-first-translation-key');
    await options.locator('#onboarding-base-url').fill(
      'https://www.overleaf.com/pi-translator-e2e-api',
    );
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-model')).toBeFocused();
    await expect(options.locator('#onboarding-model')).toHaveValue('e2e-model');
    await options.locator('#onboarding-next').click();

    await expect(onboarding).not.toBeVisible();
    await expect(options.locator('#settings-recovery-status'))
      .toContainText('已返回原页面并继续翻译');
    await expect(overlay.locator('.body')).toHaveText(
      '一致的学术翻译能够提升研究论文的可读性。',
    );
    await expect.poll(() => textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    )).length).toBe(requestsBefore + 1);
  } finally {
    await options?.close().catch(() => undefined);
    await worker!.evaluate(async (snapshot) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: {
          local: {
            set(values: Record<string, unknown>): Promise<void>;
            remove(keys: string[]): Promise<void>;
          };
          session: {
            set(values: Record<string, unknown>): Promise<void>;
            remove(keys: string[]): Promise<void>;
          };
        } };
      }).chrome;
      const credentialKeys = ['apiKeysByProfile', 'apiKey', 'deepseekApiKey'];
      const definedEntries = (values: Record<string, unknown>) => Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      );
      await Promise.all([
        api.storage.local.set({ extensionSettings: snapshot.settings }),
        api.storage.local.remove(credentialKeys),
        api.storage.session.remove(credentialKeys),
      ]);
      await Promise.all([
        api.storage.local.set(definedEntries(snapshot.localCredentials)),
        api.storage.session.set(definedEntries(snapshot.sessionCredentials)),
      ]);
    }, originalConfiguration);
    await page.keyboard.press('Escape').catch(() => undefined);
    await clearBrowserSelection();
    await recoverySource.evaluate((element, text) => {
      element.textContent = text;
    }, originalSourceText);
  }
});

test('requires confirmation after partial output and does not automatically repeat the request', async () => {
  const sourceMarker = 'A recovery request may already contain a partial translation.';
  const sourceText = `${sourceMarker} `.repeat(130).trim();
  const matchingRequestCount = () => textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceMarker)
  )).length;
  const requestsBefore = matchingRequestCount();
  mockControl.failNextRecoveryRequestAfterPartial = true;
  mockControl.partialRecoveryFailureGate = new Promise<void>((resolve) => {
    mockControl.releasePartialRecoveryFailure = resolve;
  });

  await page.locator('#partial-recovery-source').evaluate((element, text) => {
    element.textContent = text;
  }, sourceText);
  await selectElementText('#partial-recovery-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').focus();
  await overlay.locator('.trigger').press('Enter');
  await expect.poll(matchingRequestCount).toBe(requestsBefore + 2);
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  mockControl.releasePartialRecoveryFailure?.();
  await expect(overlay.locator('.error')).toContainText('API');
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  await expect(overlay.getByRole('button', { name: '复制部分译文' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '检查 API 配置' })).toBeFocused();

  const optionsPromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '检查 API 配置' }).click();
  const options = await optionsPromise;
  await options.waitForLoadState('domcontentloaded');
  await expect(options.locator('#settings-recovery-banner')).toBeVisible();
  await expect(options.locator('#settings-recovery-description'))
    .toContainText('已经产生部分译文');

  await options.locator('#refresh-models').click();

  await expect(overlay.locator('.notice')).toContainText('已保留收到的部分译文');
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  await expect(overlay.getByRole('button', {
    name: '重新翻译（会再次请求 API）',
  })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '保留部分结果' })).toBeVisible();
  await page.waitForTimeout(250);
  expect(matchingRequestCount()).toBe(requestsBefore + 2);

  await overlay.getByRole('button', {
    name: '重新翻译（会再次请求 API）',
  }).click();
  await expect.poll(matchingRequestCount).toBe(requestsBefore + 3);
  await expect(overlay.locator('.body')).toContainText(
    '一致的学术翻译能够提升研究论文的可读性。',
  );

  await options.close();
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
  await page.locator('#partial-recovery-source').evaluate((element) => {
    element.textContent = 'A recovery request may already contain a partial translation.';
  });
});

test('pre-enables the browser side panel on supported webpages', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  await expect.poll(() => worker!.evaluate(async (targetUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
        sidePanel: {
          getOptions(options: { tabId: number }): Promise<{ enabled?: boolean }>;
        };
      };
    }).chrome;
    const tabs = await api.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === targetUrl);
    if (tab?.id === undefined) return undefined;
    return (await api.sidePanel.getOptions({ tabId: tab.id })).enabled;
  }, page.url())).toBe(true);
});

test('pre-enables the side panel before a native PDF context-menu gesture', async () => {
  // Deliberately use an origin outside manifest host_permissions. Before a
  // user gesture Edge hides this tab's URL from the extension, which is the
  // exact state used by the native PDF reader in real browsing sessions.
  const sourceUrl = 'https://pdf-without-host-access.example/pi-translator.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Native PDF side panel readiness test.'),
    });
  });
  const nativePdfPage = await context.newPage();
  try {
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    await expect.poll(() => worker!.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          sidePanel: {
            getOptions(options: { tabId: number }): Promise<{ enabled?: boolean; path?: string }>;
          };
        };
      }).chrome;
      const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) return undefined;
      return api.sidePanel.getOptions({ tabId: tab.id });
    })).toMatchObject({ enabled: true, path: 'sidepanel.html' });
  } finally {
    await nativePdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('makes the PDF side-panel empty state contextual and directly actionable', async () => {
  const sidePanel = await context.newPage();
  const neutralPage = await context.newPage();
  const sourceUrl = 'https://www.overleaf.com/pi-sidepanel-empty-context.pdf';
  let nativePdfPage: Page | undefined;
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Context-aware empty state.'),
    });
  });
  try {
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await neutralPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await neutralPage.bringToFront();
    const emptyState = sidePanel.locator('#empty-state');
    const emptyAction = sidePanel.locator('#empty-action');
    const webRegionAction = sidePanel.locator('#start-web-region');
    await expect(emptyState).toHaveAttribute('data-context', 'other');
    await expect(webRegionAction).toBeHidden();
    await expect(sidePanel.locator('#empty-title')).toHaveText('当前没有可翻译的 PDF');
    await expect(emptyAction).toHaveText('打开 Pi PDF 阅读器');
    await expect(emptyAction).toBeVisible();
    expect(await emptyAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);

    const readerPromise = context.waitForEvent('page');
    await emptyAction.click();
    const reader = await readerPromise;
    await reader.waitForURL((url) => url.pathname === '/pdf.html');
    await expect(reader.locator('#empty-state')).toBeVisible();
    await reader.close();

    await page.bringToFront();
    await expect(emptyState).toHaveAttribute('data-context', 'web');
    await expect(sidePanel.locator('#empty-title')).toHaveText('浏览器侧栏已就绪');
    await expect(sidePanel.locator('#empty-description')).toContainText('从顶部框选当前网页');
    await expect(emptyAction).toHaveText('改用网页浮动侧栏');
    await expect(webRegionAction).toBeVisible();
    await expect(webRegionAction).toHaveText('框选网页');
    expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);
    await sidePanel.evaluate(() => {
      const extensionChrome = (globalThis as typeof globalThis & {
        chrome: {
          permissions: {
            request(query: { origins: string[] }): Promise<boolean>;
          };
        };
      }).chrome;
      Object.defineProperty(extensionChrome.permissions, 'request', {
        configurable: true,
        value: async () => false,
      });
    });
    await webRegionAction.click();
    await expect(sidePanel.locator('#empty-status')).toContainText('未获得网页截图权限');
    await expect(webRegionAction).toContainText('重试框选');
    await expect(page.locator('#pi-web-region-selection-root')).toHaveCount(0);
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    const activeWebTabId = await worker!.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
        };
      }).chrome;
      return (await api.tabs.query({})).find((tab) => tab.url === targetUrl)?.id;
    }, page.url());
    expect(activeWebTabId).toEqual(expect.any(Number));
    await worker!.evaluate(async (tabId) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<unknown> } };
      }).chrome;
      await api.runtime.sendMessage({
        type: 'WEB_CAPTURE_PERMISSION_PANEL_OPENED',
        payload: { tabId },
      });
    }, activeWebTabId);
    await expect(sidePanel.locator('#start-web-region-label'))
      .toHaveText('允许截图并重试');
    await expect(sidePanel.locator('#empty-status')).toContainText('还差一步');
    await webRegionAction.click();
    await expect(sidePanel.locator('#empty-status')).toContainText('未获得网页截图权限');
    await expect(sidePanel.locator('#start-web-region-label')).toHaveText('重试授权');
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
      if (target?.id !== undefined) {
        await api.tabs.sendMessage(target.id, { type: 'BROWSER_SIDEBAR_CLOSED' });
      }
    }, page.url());

    nativePdfPage = await context.newPage();
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    await expect(emptyState).toHaveAttribute('data-context', 'pdf');
    await expect(sidePanel.locator('#empty-title')).toHaveText('当前 PDF 已就绪');
    await expect(sidePanel.locator('#empty-description')).toContainText('选择文字后右键翻译');
    await expect(emptyAction).toHaveText('用 Pi 打开当前 PDF');
    await expect(webRegionAction).toBeHidden();
    await emptyAction.focus();
    await expect(emptyAction).toBeFocused();
  } finally {
    await nativePdfPage?.close();
    await neutralPage.close();
    await sidePanel.close();
    await context.unroute(sourceUrl);
    await page.bringToFront();
  }
});

test('keeps the inline capture permission control inert outside a Pi recovery flow', async () => {
  const frameElement = page.locator('#untrusted-capture-permission-frame');
  try {
    await page.evaluate((src) => {
      const frame = document.createElement('iframe');
      frame.id = 'untrusted-capture-permission-frame';
      frame.src = src;
      document.body.append(frame);
    }, `chrome-extension://${extensionId}/web-capture-permission.html`);
    await expect(frameElement).toBeVisible();
    const handle = await frameElement.elementHandle();
    const permissionFrame = await handle?.contentFrame();
    expect(permissionFrame).toBeDefined();
    await expect(permissionFrame!.locator('#label'))
      .toHaveText('请从 Pi 框选入口重新操作');
    await expect(permissionFrame!.locator('#grant')).toBeDisabled();
  } finally {
    await frameElement.evaluate((frame) => frame.remove()).catch(() => undefined);
  }
});

test('shows and hides the selection trigger with the browser selection', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');

  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('dismisses one passive trigger and can pause the current site in place', async ({}, testInfo) => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  const triggerShell = overlay.locator('.trigger-shell');
  const trigger = overlay.getByRole('button', { name: '翻译选中的文本' });
  const dismiss = overlay.getByRole('button', { name: '隐藏本次划词提示' });
  expect(await dismiss.evaluate((button) => {
    const style = getComputedStyle(button);
    return { opacity: style.opacity, pointerEvents: style.pointerEvents };
  })).toEqual({ opacity: '0', pointerEvents: 'none' });
  await expect.poll(async () => {
    // Selection stabilization may replace the trigger once; re-hover the live
    // button so this assertion does not depend on the old node retaining :hover.
    await trigger.hover();
    return dismiss.evaluate((button) => getComputedStyle(button).opacity);
  }).toBe('1');
  await expect.poll(() => triggerShell.locator('img').evaluate((image) => (
    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  ))).toBe(true);
  if (process.env.PI_VISUAL_QA) {
    await page.screenshot({ path: testInfo.outputPath('selection-trigger-dismiss-light.png') });
    await triggerShell.screenshot({ path: testInfo.outputPath('selection-trigger-dismiss-detail.png') });
  }
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  await dismiss.click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'notice');
  await expect(overlay.locator('.selection-dismiss-notice')).toContainText('本次已隐藏');
  if (process.env.PI_VISUAL_QA) {
    await page.screenshot({ path: testInfo.outputPath('selection-dismiss-notice-light.png') });
  }
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(selectedText);
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(120);
  await expect(overlay).toHaveAttribute('data-pi-view', 'notice');

  await overlay.getByRole('button', { name: '暂停本网站自动划词' }).click();
  await expect(overlay.locator('.selection-dismiss-notice')).toContainText('已暂停本网站自动划词');
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden', { timeout: 3_000 });

  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();
    await expect(popup.locator('#pause-site')).toBeChecked();
    const sendToTarget = async (message: object): Promise<void> => {
      await popup.evaluate(async ({ targetUrl, targetMessage }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: {
            tabs: {
              query(query: object): Promise<Array<{ id?: number; url?: string }>>;
              sendMessage(tabId: number, message: object): Promise<unknown>;
            };
          };
        }).chrome;
        const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
        if (target?.id === undefined) throw new Error('Missing paused site tab.');
        await api.tabs.sendMessage(target.id, targetMessage);
      }, { targetUrl: page.url(), targetMessage: message });
    };

    await selectElementText('#global-term-source');
    await page.waitForTimeout(240);
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    const requestsBeforeExplicitTranslation = textRequests.length;
    await sendToTarget({ type: 'TRIGGER_TRANSLATE' });
    await expect.poll(() => textRequests.length).toBe(requestsBeforeExplicitTranslation + 1);
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();

    await selectElementText('#multi-source');
    const requestsBeforeFixedSidebar = textRequests.length;
    await sendToTarget({ type: 'OPEN_SIDEBAR' });
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect.poll(() => textRequests.length).toBe(requestsBeforeFixedSidebar + 1);
    await expect(overlay.locator('.body')).not.toBeEmpty();
    await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();

    await popup.locator('#pause-site').uncheck();
    await expect(popup.locator('#status')).toContainText('已恢复');
    await expect(popup.locator('#pause-site')).not.toBeChecked();
  } finally {
    if (!popup.isClosed()) {
      await page.bringToFront();
      await popup.reload();
      const pauseSite = popup.locator('#pause-site');
      if (await pauseSite.isChecked().catch(() => false)) await pauseSite.uncheck();
      await popup.close();
    }
    await clearBrowserSelection();
  }
});

test('adapts the translation surface to dark and light webpages', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await page.evaluate(() => {
    document.body.style.background = 'rgb(15, 23, 42)';
    document.body.style.color = 'rgb(241, 245, 249)';
  });
  await selectSourceText();
  await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.card')).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();

  await page.evaluate(() => {
    document.body.style.background = 'rgb(255, 255, 255)';
    document.body.style.color = 'rgb(17, 24, 39)';
  });
  await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
});

test('keeps first-result progress and copy feedback clear on a narrow card', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-api/**';
  const sourceText = 'A narrow first-result card should keep progress and copy actions stable.';
  const source = page.locator('#source');
  const originalSourceText = await source.textContent();
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const originalPageStyle = await page.evaluate(() => ({
    background: document.body.style.background,
    color: document.body.style.color,
  }));
  let releaseResult: (() => void) | undefined;
  const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
  const delayedHandler = async (route: Route): Promise<void> => {
    if (
      route.request().method() !== 'POST'
      || !route.request().postData()?.includes(sourceText)
    ) {
      await route.fallback();
      return;
    }
    await resultGate;
    await route.fallback();
  };
  await context.route(apiPattern, delayedHandler);
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await source.evaluate((element, text) => { element.textContent = text; }, sourceText);
    await selectElementText('#source');
    await overlay.locator('.trigger').focus();
    await overlay.locator('.trigger').press('Enter');

    const surface = overlay.locator('.surface');
    const loading = overlay.locator('.loading');
    await expect(surface).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('aria-live', 'polite');
    await expect(loading).toHaveAttribute('aria-atomic', 'true');
    await expect(overlay.locator('.stop-translation')).toBeVisible();
    await expect(overlay.locator('.stop-translation')).toBeFocused();
    const loadingLayout = await surface.evaluate((card) => {
      const loadingRow = card.querySelector<HTMLElement>('.loading')!;
      const stop = card.querySelector<HTMLElement>('.stop-translation')!;
      const cardRect = card.getBoundingClientRect();
      const stopRect = stop.getBoundingClientRect();
      return {
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
        loadingClientWidth: loadingRow.clientWidth,
        loadingScrollWidth: loadingRow.scrollWidth,
        stopRight: stopRect.right,
        cardRight: cardRect.right,
        stopHeight: stopRect.height,
      };
    });
    expect(loadingLayout.cardScrollWidth).toBeLessThanOrEqual(loadingLayout.cardClientWidth + 1);
    expect(loadingLayout.loadingScrollWidth)
      .toBeLessThanOrEqual(loadingLayout.loadingClientWidth + 1);
    expect(loadingLayout.stopRight).toBeLessThanOrEqual(loadingLayout.cardRight + 1);
    expect(loadingLayout.stopHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('first-result-loading-320-light.png') });
    }

    releaseResult?.();
    await expect(overlay.locator('.body'))
      .toHaveText('一致的学术翻译能够提升研究论文的可读性。');
    await expect(surface).not.toHaveAttribute('aria-busy', 'true');
    await expect(surface).toHaveAttribute('data-state', 'complete');
    await expect(overlay.locator('.result-feedback')).toHaveText('翻译完成，译文已显示');
    await expect(overlay.locator('.result-feedback')).toHaveAttribute('role', 'status');
    await expect(overlay.locator('.result-reading-nav')).toBeHidden();

    const copy = overlay.locator('.copy-action');
    await expect(copy).toHaveText('复制译文');
    await expect(copy).toBeFocused();
    const resultLayout = await surface.evaluate((card) => {
      const footer = card.querySelector<HTMLElement>('.footer')!;
      const copyAction = card.querySelector<HTMLElement>('.copy-action')!;
      return {
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
        footerClientWidth: footer.clientWidth,
        footerScrollWidth: footer.scrollWidth,
        footerHeight: footer.getBoundingClientRect().height,
        copyWidth: copyAction.getBoundingClientRect().width,
        actionHeights: [...footer.querySelectorAll<HTMLElement>('button')]
          .filter((button) => button.offsetParent !== null)
          .map((button) => button.getBoundingClientRect().height),
        copyBackground: getComputedStyle(copyAction).backgroundColor,
      };
    });
    expect(resultLayout.cardScrollWidth).toBeLessThanOrEqual(resultLayout.cardClientWidth + 1);
    expect(resultLayout.footerScrollWidth).toBeLessThanOrEqual(resultLayout.footerClientWidth + 1);
    expect(resultLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    expect(resultLayout.copyBackground).not.toBe('rgba(0, 0, 0, 0)');
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('first-result-complete-320-light.png') });
      await page.evaluate(() => {
        document.body.style.background = 'rgb(15, 23, 42)';
        document.body.style.color = 'rgb(241, 245, 249)';
      });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('first-result-complete-320-dark.png') });
    }

    await copy.click();
    await expect(copy).toHaveText('已复制');
    await expect(copy).toHaveAttribute('data-state', 'success');
    await expect(copy).toBeEnabled();
    await expect(copy).toBeFocused();
    await expect(overlay.locator('.copy-feedback')).toHaveText('译文已复制到剪贴板');
    await expect(overlay.locator('.copy-feedback')).toHaveAttribute('aria-live', 'polite');
    const copiedLayout = await surface.evaluate((card) => {
      const footer = card.querySelector<HTMLElement>('.footer')!;
      const copyAction = card.querySelector<HTMLElement>('.copy-action')!;
      return {
        footerHeight: footer.getBoundingClientRect().height,
        copyWidth: copyAction.getBoundingClientRect().width,
      };
    });
    expect(copiedLayout).toEqual({
      footerHeight: resultLayout.footerHeight,
      copyWidth: resultLayout.copyWidth,
    });
  } finally {
    releaseResult?.();
    await context.unroute(apiPattern, delayedHandler);
    await page.evaluate((style) => {
      document.body.style.background = style.background;
      document.body.style.color = style.color;
    }, originalPageStyle);
    await page.keyboard.press('Escape').catch(() => undefined);
    await clearBrowserSelection();
    await source.evaluate((element, text) => { element.textContent = text; }, originalSourceText);
    await page.setViewportSize(originalViewport);
  }
});

test('recovers embedded TeX from rendered web mathematics before translation', async () => {
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;
  await page.evaluate(() => {
    const source = document.querySelector('#math-source');
    if (!source) throw new Error('Missing rendered-math fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.slice(initialTextRequests).some((entry) =>
    JSON.stringify(entry).includes('⟦FULL1_'),
  )).toBe(true);
  const request = textRequests
    .slice(initialTextRequests)
    .map((entry) => JSON.stringify(entry))
    .find((entry) => entry.includes('⟦FULL1_')) ?? '';
  expect(request).toContain('⟦FULL1_');
  expect(request).not.toContain('ℒ = Σ');
  expect(visionRequests).toHaveLength(initialVisionRequests);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
});

test('falls back to selectable text when webpage screenshot permission is unavailable', async () => {
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;
  await page.evaluate(() => {
    const source = document.querySelector('#rendered-only-math');
    if (!source) throw new Error('Missing rendered-only math fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.length).toBeGreaterThan(initialTextRequests);
  expect(visionRequests).toHaveLength(initialVisionRequests);
  await expect(overlay.locator('.body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
});

test('opens, drags, and dismisses a translation card', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  // The loading surface is intentionally replaced by the result surface. Wait
  // for that transition before measuring the draggable elements, otherwise a
  // locator can be detached between toBeVisible() and boundingBox().
  await expect(overlay.locator('.body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');

  const card = overlay.locator('.card');
  const header = overlay.locator('.header');
  await expect(card).toBeVisible();
  await expect(header).toBeVisible();
  const before = await card.boundingBox();
  const handle = await header.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();
  if (!before || !handle) return;

  const deltaX = before.x > 150 ? -80 : 80;
  const deltaY = before.y > 150 ? -55 : 55;
  await page.mouse.move(handle.x + 30, handle.y + 14);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + 30 + deltaX,
    handle.y + 14 + deltaY,
    { steps: 6 },
  );
  await page.mouse.up();

  const after = await card.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? before.x) - before.x)).toBeGreaterThan(30);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('records content-free translation and render stage timings in session storage', async () => {
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { session: { remove(key: string): Promise<void> } } };
    }).chrome;
    await api.storage.session.remove('localPerformanceSamplesV1');
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
  const privateFixture = `Private performance fixture ${Date.now()}.`;
  await page.locator('#source').evaluate((element, value) => {
    element.textContent = value;
  }, privateFixture);
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).not.toBeEmpty();

  const readSamples = () => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: {
            get(key: string): Promise<Record<string, unknown>>;
          };
        };
      };
    }).chrome;
    const stored = await api.storage.session.get('localPerformanceSamplesV1');
    return stored.localPerformanceSamplesV1 as Array<{
      schemaVersion: number;
      operation: string;
      timings: Record<string, number>;
      errorCode?: string;
    }> | undefined;
  });
  await expect.poll(async () => {
    const samples = await readSamples();
    return [...new Set((samples ?? []).map((sample) => sample.operation))].sort();
  }).toEqual(['render-result', 'translate-text']);

  const samples = await readSamples();
  const translation = samples?.find((sample) => sample.operation === 'translate-text');
  const rendering = samples?.find((sample) => sample.operation === 'render-result');
  expect(translation?.timings).toEqual(expect.objectContaining({
    totalMs: expect.any(Number),
    preflightMs: expect.any(Number),
    providerMs: expect.any(Number),
    commitMs: expect.any(Number),
    maintenanceMs: expect.any(Number),
  }));
  expect(rendering?.timings).toEqual(expect.objectContaining({
    totalMs: expect.any(Number),
    textRenderMs: expect.any(Number),
    mathRenderMs: 0,
  }));
  const serialized = JSON.stringify(samples);
  expect(serialized).not.toContain(privateFixture);
  expect(serialized).not.toContain('e2e-key');
  expect(serialized).not.toContain('e2e-model');
  expect(serialized).not.toContain(OVERLEAF_FIXTURE_URL);

  await overlay.locator('.surface-close').click();
  await clearBrowserSelection();
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test('lightly marks translated source text and previews the translation on hover', async () => {
  const source = page.locator('#source');
  const originalMarkup = await source.evaluate((element) => element.innerHTML);
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  const mark = overlay.locator('.mark-action');
  await expect(mark).toHaveAttribute('aria-pressed', 'false');
  await mark.focus();
  await mark.press('Enter');
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay.locator('.mark-action')).toBeFocused();

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  expect(await source.evaluate((element) => element.innerHTML)).toBe(originalMarkup);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  const markerBox = await waitForVisibleBoundingBox(marker, 'the webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  const tooltip = markerLayer.locator('.tooltip');
  await expect(tooltip).toContainText('一致的学术翻译');
  const tooltipBefore = await tooltip.boundingBox();
  await page.mouse.move(markerBox.x + Math.max(2, markerBox.width - 4), markerBox.y + markerBox.height / 2);
  const tooltipAfter = await tooltip.boundingBox();
  expect(tooltipBefore).not.toBeNull();
  expect(tooltipAfter).not.toBeNull();
  if (tooltipBefore && tooltipAfter) {
    expect(tooltipAfter.x).toBeCloseTo(tooltipBefore.x, 0);
    expect(tooltipAfter.y).toBeCloseTo(tooltipBefore.y, 0);
  }
  await markerLayer.getByRole('button', { name: '取消标记' }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);

  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();
  const restoredMarker = markerLayer.locator('.marker').first();
  await expect(restoredMarker).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  const restoredMarkerBox = await waitForVisibleBoundingBox(
    restoredMarker,
    'the restored webpage source marker',
  );

  await page.mouse.click(
    restoredMarkerBox.x + restoredMarkerBox.width / 2,
    restoredMarkerBox.y + restoredMarkerBox.height / 2,
  );
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await overlay.locator('.pin-action').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await page.mouse.move(
    restoredMarkerBox.x + restoredMarkerBox.width / 2,
    restoredMarkerBox.y + restoredMarkerBox.height / 2,
  );
  await markerLayer.locator('.tooltip .unmark').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'false');
  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(1);
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
  const filter = overlay.locator('.mark-filter');
  await expect(filter).toBeVisible();
  await filter.click();
  await expect(overlay.locator('.mark-filter')).toHaveAttribute('aria-pressed', 'true');

  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await expect(overlay.locator('.mark-filter')).toHaveCount(0);
  expect(await source.evaluate((element) => element.innerHTML)).toBe(originalMarkup);
  await overlay.getByRole('button', { name: '关闭' }).click();
});

test('keeps translation correction compact, versioned, and synchronized with source marks', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) {
    await overlay.getByTitle('关闭').click();
  }
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();

  const copyAction = overlay.locator('.copy-action');
  await copyAction.click();
  await expect(copyAction).toHaveText('已复制');

  const more = overlay.locator('details.more');
  const moreSummary = more.locator('summary');
  const compactControlHeights = await Promise.all([
    copyAction,
    overlay.locator('.mark-action'),
    moreSummary,
    overlay.locator('.view-button').first(),
  ].map((control) => control.evaluate((element) => element.getBoundingClientRect().height)));
  expect(compactControlHeights).toEqual([32, 32, 32, 32]);
  await moreSummary.click();
  await expect(more).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(more).not.toHaveAttribute('open', '');
  await expect(moreSummary).toBeFocused();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');

  const correctionAction = overlay.getByRole('button', { name: '修正译文' });
  await correctionAction.click();
  let editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await expect(editor).toBeVisible();
  await editor.press('Escape');
  await expect(editor).toBeHidden();
  await expect(correctionAction).toBeFocused();

  await correctionAction.click();
  editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('用户手动修订后的学术译文。');
  const revisionScope = overlay.getByRole('combobox', { name: '修正译文的保存范围' });
  await expect(revisionScope).toHaveValue('current');
  await revisionScope.selectOption('document');
  const requestsBeforeManualSave = textRequests.length;
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('用户手动修订后的学术译文。');
  expect(textRequests).toHaveLength(requestsBeforeManualSave);
  await expect(overlay.locator('.version-counter')).toHaveText('v1/2');
  const versionContext = overlay.locator('.version-context');
  await expect(versionContext).toContainText('手动修改');
  await expect(versionContext).toContainText('本文记忆');
  await expect(versionContext).toContainText('较上一版调整全文');
  await expect(versionContext).toHaveAttribute(
    'aria-label',
    '手动修改，本文记忆，较上一版调整全文',
  );
  await expect(overlay.locator('.version-locate')).toHaveCount(0);
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' }))
    .toBeFocused();

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the corrected webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('用户手动修订后的学术译文。');

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '让模型调整…' }).click();
  await overlay.getByRole('button', { name: '更忠实原文' }).click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await expect(overlay.locator('.version-counter')).toHaveText('v1/3');
  await expect(versionContext).toContainText('更忠实');
  await expect(versionContext).toContainText('仅当前选择');
  await expect(versionContext).toContainText('较上一版调整全文');
  expect(JSON.stringify(textRequests.at(-1))).toContain('translationRevisionPreference');
  expect(JSON.stringify(textRequests.at(-1))).toContain('用户手动修订后的学术译文。');
  const worker = context.serviceWorkers()[0]!;
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    const memories = Object.values(
      (stored.documentTranslationMemoryV1 ?? {}) as Record<string, {
        recentTranslations?: Array<{ originalText?: string; translatedText?: string }>;
      }>,
    );
    return memories.flatMap((memory) => memory.recentTranslations ?? []).find(
      (entry) => entry.originalText ===
        'A consistent academic translation improves the readability of research papers.',
    )?.translatedText;
  })).toBe('用户手动修订后的学术译文。');

  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.locator('.body')).toHaveText('用户手动修订后的学术译文。');
  await expect(overlay.locator('.version-counter')).toHaveText('v2/3');
  await expect(versionContext).toContainText('手动修改');
  await expect(versionContext).toContainText('本文记忆');
  await overlay.getByTitle('查看下一版译文').click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await correctionAction.click();
  editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('临时焦点验证译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  const undoCorrection = overlay.getByRole('button', { name: '撤销上次译文修正' });
  await expect(undoCorrection).toBeFocused();
  await undoCorrection.click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await expect(versionContext).toContainText('撤销修改');
  await expect(correctionAction).toBeFocused();
  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('keeps correction terms explicit and rolls a global term back with the translation', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  const correction = overlay.getByRole('button', { name: '修正译文' });
  const correctionBox = await correction.boundingBox();
  expect(correctionBox).not.toBeNull();
  if (correctionBox) {
    expect(correctionBox.width).toBeLessThanOrEqual(52);
    expect(correctionBox.height).toBeLessThanOrEqual(32);
  }
  await correction.click();

  const scope = overlay.getByRole('combobox', { name: '修正译文的保存范围' });
  await expect(scope).toHaveValue('current');
  await expect(scope.locator('option')).toHaveText([
    '仅本次',
    '记住本文',
  ]);
  await expect(overlay.getByRole('textbox', { name: '原文术语' })).toBeHidden();
  await expect(overlay.getByRole('textbox', { name: '固定译法' })).toBeHidden();

  const termDisclosure = overlay.locator('details.correction-term-disclosure');
  const termSummary = termDisclosure.locator(':scope > summary');
  await termSummary.click();
  const sourceTerm = overlay.getByRole('textbox', { name: '原文术语' });
  const targetTerm = overlay.getByRole('textbox', { name: '固定译法' });
  await expect(sourceTerm).toBeVisible();
  await expect(targetTerm).toBeVisible();
  await overlay.getByRole('combobox', { name: '术语保存范围' }).selectOption('global');
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' })
    .fill('显式术语修正后的译文。');

  const requestsBeforeSave = textRequests.length;
  await sourceTerm.fill('incomplete term');
  await expect(termSummary).toHaveText('！固定术语待补充');
  await termSummary.click();
  await expect(termDisclosure).not.toHaveAttribute('open');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.revision-status'))
    .toContainText('请完整填写不含公式的简短术语和固定译法');
  await expect(termSummary).toHaveText('！固定术语需检查');
  await expect(termDisclosure).toHaveAttribute('open', '');
  await expect(targetTerm).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeSave);

  const uniqueSource = 'correction-only global phrase';
  const uniqueTarget = '仅供修正测试的全局译法';
  await sourceTerm.fill(uniqueSource);
  await targetTerm.fill(uniqueTarget);
  await expect(termSummary).toHaveText('✓ 已填写固定术语');
  await termSummary.click();
  await expect(termDisclosure).not.toHaveAttribute('open');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('显式术语修正后的译文。');
  expect(textRequests).toHaveLength(requestsBeforeSave);

  const worker = context.serviceWorkers()[0]!;
  const storedGlobalTarget = async (): Promise<string | undefined> => worker.evaluate(
    async (source) => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      const settings = stored.extensionSettings as {
        academicGlossary?: Array<{ source: string; target: string }>;
      } | undefined;
      return settings?.academicGlossary?.find((term) => term.source === source)?.target;
    },
    uniqueSource,
  );
  await expect.poll(storedGlobalTarget).toBe(uniqueTarget);

  const undo = overlay.getByRole('button', { name: '撤销上次译文修正' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toHaveCount(0);
  await expect.poll(storedGlobalTarget).toBeUndefined();
  expect(textRequests).toHaveLength(requestsBeforeSave);

  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('keeps narrow translation correction fields and actions visible', async ({}, testInfo) => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.getByRole('button', { name: '修正译文' }).click();

    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await expect(editor).toBeFocused();
    await expect(overlay.locator('.pin-action')).toHaveCount(0);
    await overlay.locator('.correction-save').click();
    await expect(overlay.locator('.revision-status')).toContainText('译文没有变化');
    await expect(overlay.locator('.revision-status')).toHaveAttribute('role', 'alert');
    await expect(editor).toHaveAttribute(
      'aria-describedby',
      /pi-translation-correction-note.*pi-translation-correction-status/,
    );
    await expect(editor).toBeFocused();
    await editor.fill('窄屏下需要保持清晰、完整并且可以直接保存的学术译文。');
    await expect(overlay.locator('.revision-status')).toBeEmpty();
    await expect(overlay.locator('.revision-status')).toHaveAttribute('role', 'status');
    await overlay.getByText('＋ 固定术语（可选）').click();
    const sourceTerm = overlay.getByRole('textbox', { name: '原文术语' });
    const targetTerm = overlay.getByRole('textbox', { name: '固定译法' });
    await sourceTerm.fill('AdaptiveSensingReconstructionObjectiveWithHierarchicalConstraints');
    await overlay.locator('.correction-save').click();
    const validation = overlay.locator('.revision-status');
    await expect(validation).toContainText('请完整填写不含公式的简短术语和固定译法');
    await expect(validation).toHaveAttribute('role', 'alert');
    await expect(targetTerm).toHaveAttribute('aria-invalid', 'true');
    await expect(targetTerm).toHaveAttribute(
      'aria-describedby',
      'pi-translation-correction-status',
    );
    await expect(targetTerm).toBeFocused();
    await targetTerm.fill('具有层级约束的自适应感知重建目标固定译法');
    await expect(targetTerm).not.toHaveAttribute('aria-invalid');
    await expect(validation).toBeEmpty();

    const correctionLayout = await overlay.locator('.surface').evaluate((surface) => {
      const inputs = [...surface.querySelectorAll<HTMLElement>('.correction-term-fields input')];
      const actions = surface.querySelector<HTMLElement>('.revision-actions');
      const buttons = [...actions?.querySelectorAll<HTMLElement>('button') ?? []];
      const bounds = surface.getBoundingClientRect();
      const actionBounds = actions?.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        inputTops: inputs.map((input) => input.getBoundingClientRect().top),
        actionBottom: actionBounds?.bottom ?? Infinity,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-correction-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('translation-correction-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(correctionLayout.bounds.left).toBeGreaterThanOrEqual(8);
    expect(correctionLayout.bounds.right).toBeLessThanOrEqual(352);
    expect(correctionLayout.scrollWidth).toBeLessThanOrEqual(correctionLayout.clientWidth + 1);
    expect(correctionLayout.inputTops[1]).toBeGreaterThan(correctionLayout.inputTops[0] ?? 0);
    expect(correctionLayout.actionBottom).toBeLessThanOrEqual(correctionLayout.bounds.bottom);
    expect(correctionLayout.buttonHeights.every((height) => height >= 32)).toBe(true);
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('keeps narrow model adjustment drafts visible and recoverable', async ({}, testInfo) => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

    const moreSummary = overlay.locator('details.more > summary');
    await moreSummary.click();
    const menu = overlay.locator('.menu');
    await expect(menu).toBeVisible();
    const menuLayout = await menu.evaluate((element) => {
      const surface = element.closest<HTMLElement>('.surface');
      const bounds = element.getBoundingClientRect();
      const surfaceBounds = surface?.getBoundingClientRect();
      const buttons = [...element.querySelectorAll<HTMLElement>('button')];
      return {
        bounds: bounds.toJSON(),
        surfaceBounds: surfaceBounds?.toJSON(),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-more-menu-360-light.png') });
    }
    expect(menuLayout.surfaceBounds).toBeDefined();
    if (menuLayout.surfaceBounds) {
      expect(menuLayout.bounds.left).toBeGreaterThanOrEqual(menuLayout.surfaceBounds.left);
      expect(menuLayout.bounds.right).toBeLessThanOrEqual(menuLayout.surfaceBounds.right);
    }
    expect(menuLayout.bounds.top).toBeGreaterThanOrEqual(8);
    expect(menuLayout.bounds.bottom).toBeLessThanOrEqual(692);
    expect(menuLayout.scrollHeight).toBeLessThanOrEqual(menuLayout.clientHeight + 2);
    expect(menuLayout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await overlay.getByRole('button', { name: '让模型调整…' }).click();
    await expect(overlay.getByText('模型调整会发送原文和当前译稿')).toBeVisible();
    await overlay.getByRole('button', { name: '自定义调整要求…' }).click();
    const customInput = overlay.getByRole('textbox', { name: '自定义调整要求' });
    await expect(customInput).toBeFocused();
    const customDraft = '保留限定条件和公式编号，并统一关键术语；语言保持正式、简洁，避免增加原文没有的结论。'.repeat(3);
    await customInput.fill(customDraft);
    await expect(overlay.locator('.revision-custom span')).toHaveText(`${customDraft.length}/500`);
    const adjustmentLayout = await overlay.locator('.surface').evaluate((surface) => {
      const custom = surface.querySelector<HTMLElement>('.revision-custom');
      const actions = surface.querySelector<HTMLElement>('.revision-actions');
      const controls = [...surface.querySelectorAll<HTMLElement>(
        '.revision-scope select,.revision-choice,.revision-custom button,.revision-actions button',
      )];
      const bounds = surface.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        customBottom: custom?.getBoundingClientRect().bottom ?? Infinity,
        actionsBottom: actions?.getBoundingClientRect().bottom ?? Infinity,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-model-adjustment-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('translation-model-adjustment-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(adjustmentLayout.bounds.left).toBeGreaterThanOrEqual(8);
    expect(adjustmentLayout.bounds.right).toBeLessThanOrEqual(352);
    expect(adjustmentLayout.scrollWidth).toBeLessThanOrEqual(adjustmentLayout.clientWidth + 1);
    expect(adjustmentLayout.customBottom).toBeLessThanOrEqual(adjustmentLayout.bounds.bottom);
    expect(adjustmentLayout.actionsBottom).toBeLessThanOrEqual(adjustmentLayout.bounds.bottom);
    expect(adjustmentLayout.controlHeights.every((height) => height >= 32)).toBe(true);
    await expect(overlay.locator('.pin-action')).toHaveCount(0);

    await customInput.press('Escape');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await expect(moreSummary).toBeFocused();
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('keeps a newer translation and recovers a rejected correction save', async () => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 360, height: 700 });
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.getByRole('button', { name: '修正译文' }).click();
  const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('不应覆盖较新结果的旧修正。');

  const worker = context.serviceWorkers()[0]!;
  const storedHead = await worker.evaluate(async (pageUrl) => {
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
    if (tab?.id === undefined) throw new Error('Could not find the translated page tab.');
    const key = `translationResultHead:${tab.id}`;
    const original = (await api.storage.session.get(key))[key] as {
      tabId: number;
      currentResultRequestId: string;
      rootRequestId: string;
      updatedAt: number;
    } | undefined;
    if (!original) throw new Error('The translated page has no result head.');
    await api.storage.session.set({
      [key]: {
        ...original,
        currentResultRequestId: 'newer-result-for-stale-correction-e2e',
        updatedAt: Date.now(),
      },
    });
    return { key, original };
  }, page.url());

  let headRestored = false;
  try {
    const save = overlay.locator('.correction-save');
    await save.click();
    const failure = overlay.locator('.revision-status');
    await expect(failure)
      .toContainText('当前译文已经变化，请重新打开修正');
    await expect(failure).toHaveAttribute('role', 'alert');
    await expect(failure).toHaveClass(/is-error/);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('不应覆盖较新结果的旧修正。');
    await expect(editor).toBeEnabled();
    await expect(save).toHaveText('重试');
    await expect(save).toBeFocused();
    const failureLayout = await overlay.locator('.surface').evaluate((surface) => {
      const status = surface.querySelector<HTMLElement>('.revision-status')!;
      const surfaceBounds = surface.getBoundingClientRect();
      return {
        surfaceBottom: surfaceBounds.bottom,
        statusBottom: status.getBoundingClientRect().bottom,
        buttonHeights: [...surface.querySelectorAll<HTMLElement>('.revision-actions button')]
          .map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(failureLayout.statusBottom).toBeLessThanOrEqual(failureLayout.surfaceBottom);
    expect(failureLayout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await worker.evaluate(async ({ key, original }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ [key]: original });
    }, storedHead);
    headRestored = true;
    await save.click();
    await expect(overlay.locator('.body')).toContainText('不应覆盖较新结果的旧修正');
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  } finally {
    if (!headRestored) {
      await worker.evaluate(async ({ key, original }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: {
            set(values: Record<string, unknown>): Promise<void>;
          } } };
        }).chrome;
        await api.storage.session.set({ [key]: original });
      }, storedHead);
    }
    if (await overlay.getByRole('button', { name: '取消', exact: true }).count()) {
      await overlay.getByRole('button', { name: '取消', exact: true }).click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('serializes concurrent correction commits and rejects an old undo receipt', async () => {
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await sender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  if (tabId === undefined) {
    await sender.close();
    return;
  }

  const headKey = `translationResultHead:${tabId}`;
  const baseResult = {
    requestId: 'concurrent-correction-base',
    originalText: 'Concurrent correction source text.',
    translatedText: 'Base translation.',
    warnings: [],
    completedAt: Date.now(),
    cached: false,
    latencyMs: 10,
  };

  try {
    await sender.evaluate(async ({ key, tab, result }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({
        [key]: {
          tabId: tab,
          currentResultRequestId: result.requestId,
          rootRequestId: result.requestId,
          updatedAt: Date.now(),
        },
      });
    }, { key: headKey, tab: tabId, result: baseResult });

    const concurrent = await sender.evaluate(async ({ result }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      const correction = (requestId: string, translatedText: string) => ({
        type: 'UPDATE_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: {
            ...result,
            requestId,
            translatedText,
            revision: {
              rootRequestId: result.requestId,
              kind: 'manual',
              label: 'Manual correction',
              scope: 'current',
            },
          },
          scope: 'current',
          previousTranslatedText: result.translatedText,
          baseRequestId: result.requestId,
        },
      });
      return Promise.all([
        api.runtime.sendMessage(correction('concurrent-correction-a', 'Correction A.')),
        api.runtime.sendMessage(correction('concurrent-correction-b', 'Correction B.')),
      ]);
    }, { result: baseResult }) as Array<{
      ok: boolean;
      data?: {
        result: typeof baseResult;
        correctionReceipt?: {
          baseRequestId: string;
          correctedRequestId: string;
          scope: 'current' | 'document';
          previousTranslation: string;
          correctedTranslation: string;
        };
      };
      error?: { code: string };
    }>;

    const succeeded = concurrent.filter((response) => response.ok);
    const rejected = concurrent.filter((response) => !response.ok);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error?.code).toBe('REQUEST_ABORTED');
    const firstCommit = succeeded[0]?.data;
    expect(firstCommit?.correctionReceipt).toBeDefined();
    if (!firstCommit?.correctionReceipt) throw new Error('Missing correction receipt.');

    const newest = await sender.evaluate(async ({ previous }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'UPDATE_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: {
            ...previous.result,
            requestId: 'newer-correction-after-race',
            translatedText: 'Newest correction.',
          },
          scope: 'current',
          previousTranslatedText: previous.result.translatedText,
          baseRequestId: previous.result.requestId,
        },
      });
    }, { previous: firstCommit }) as {
      ok: boolean;
      data?: { result: typeof baseResult };
      error?: { code: string };
    };
    expect(newest.ok).toBe(true);

    const staleUndo = await sender.evaluate(async ({ previous }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'UNDO_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: previous.result,
          receipt: previous.correctionReceipt,
        },
      });
    }, { previous: firstCommit }) as { ok: boolean; error?: { code: string } };
    expect(staleUndo.ok).toBe(false);
    expect(staleUndo.error?.code).toBe('REQUEST_ABORTED');

    const head = await sender.evaluate(async (key) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return (await api.storage.session.get(key))[key];
    }, headKey) as { currentResultRequestId?: string } | undefined;
    expect(head?.currentResultRequestId).toBe(newest.data?.result.requestId);
  } finally {
    await sender.evaluate(async ({ key, tab }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
              remove(key: string): Promise<void>;
            };
          };
        };
      }).chrome;
      const stored = await api.storage.session.get('translationHistoryByTab');
      const history = {
        ...((stored.translationHistoryByTab ?? {}) as Record<string, unknown>),
      };
      delete history[String(tab)];
      await Promise.all([
        api.storage.session.set({ translationHistoryByTab: history }),
        api.storage.session.remove(key),
      ]);
    }, { key: headKey, tab: tabId }).catch(() => undefined);
    await sender.close();
  }
});

test('rejects a correction whose result head disappeared without persisting side effects', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.locator('.close').count()) await overlay.locator('.close').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toBeVisible();

  await overlay.locator('.correction-action').click();
  const editor = overlay.locator('.correction-text-part').first();
  const rejectedTranslation = 'MISSING_HEAD_CORRECTION_SHOULD_NOT_PERSIST';
  const rejectedTermSource = 'missing-head-source-term';
  const rejectedTermTarget = 'missing-head-target-term';
  await editor.fill(rejectedTranslation);
  await overlay.locator('.revision-scope select').selectOption('document');
  await overlay.locator('details.correction-term-disclosure > summary').click();
  await overlay.locator('.correction-term-fields input').nth(0).fill(rejectedTermSource);
  await overlay.locator('.correction-term-fields input').nth(1).fill(rejectedTermTarget);

  const worker = context.serviceWorkers()[0]!;
  const removedHead = await worker.evaluate(async (pageUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: { query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
        storage: {
          session: {
            get(key: string): Promise<Record<string, unknown>>;
            remove(key: string): Promise<void>;
          };
        };
      };
    }).chrome;
    const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
    if (tab?.id === undefined) throw new Error('Could not find the translated page tab.');
    const key = `translationResultHead:${tab.id}`;
    const original = (await api.storage.session.get(key))[key];
    if (!original) throw new Error('The translated page has no result head.');
    await api.storage.session.remove(key);
    return { tabId: tab.id, key, original };
  }, page.url());

  try {
    await overlay.locator('.correction-save').click();
    const state = await worker.evaluate(async ({ tabId, key }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: { get(key: string): Promise<Record<string, unknown>> };
            session: { get(keys: string[]): Promise<Record<string, unknown>> };
          };
        };
      }).chrome;
      const [local, session] = await Promise.all([
        api.storage.local.get('documentTranslationMemoryV1'),
        api.storage.session.get([key, 'translationHistoryByTab']),
      ]);
      return {
        head: session[key],
        history: (session.translationHistoryByTab as Record<string, unknown[]> | undefined)?.[
          String(tabId)
        ],
        documentMemory: local.documentTranslationMemoryV1,
      };
    }, removedHead);
    expect(state.head).toBeUndefined();
    expect(JSON.stringify(state.history ?? null)).not.toContain(rejectedTranslation);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTranslation);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTermSource);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTermTarget);
    await expect(overlay.locator('.revision-status')).not.toHaveText('');
    await expect(editor).toBeVisible();
  } finally {
    await worker.evaluate(async ({ key, original }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ [key]: original });
    }, removedHead);
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.locator('.close').count()) await overlay.locator('.close').click();
    await clearBrowserSelection();
  }
});

test('adopts an older translation version without an API call and can undo it', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('第一版人工译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('第一版人工译文。');

  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('第二版人工译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('第二版人工译文。');
  const requestsBeforeAdoption = textRequests.length;

  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toHaveCount(0);
  await overlay.getByTitle('查看下一版译文').click();
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toBeVisible();
  await overlay.getByTitle('查看上一版译文').click();
  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '采用当前版本' }).click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  expect(textRequests).toHaveLength(requestsBeforeAdoption);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  await expect(overlay.locator('.body')).toHaveText('第二版人工译文。');
  expect(textRequests).toHaveLength(requestsBeforeAdoption);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('retries a failed model adjustment with the frozen draft and revision context', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();

  await overlay.getByRole('button', { name: '修正译文' }).click();
  const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('必须保留的人工术语修订。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('必须保留的人工术语修订。');

  mockControl.failNextRevisionRequest = true;
  const requestsBeforeFailedRevision = textRequests.length;
  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '让模型调整…' }).click();
  await overlay.getByRole('combobox', { name: '译文调整作用范围' })
    .selectOption('document');
  await overlay.getByRole('button', { name: '更自然简洁' }).click();
  await expect(overlay.locator('.error')).toContainText('API 拒绝了本次请求');
  expect(textRequests).toHaveLength(requestsBeforeFailedRevision + 1);
  const failedRequest = JSON.stringify(textRequests.at(-1));
  expect(failedRequest).toContain('translationRevisionPreference');
  expect(failedRequest).toContain('必须保留的人工术语修订。');

  await overlay.getByRole('button', { name: '重试' }).click();
  await expect(overlay.locator('.body')).toContainText('经用户调整后');
  expect(textRequests).toHaveLength(requestsBeforeFailedRevision + 2);
  const retriedRequest = JSON.stringify(textRequests.at(-1));
  expect(retriedRequest).toContain('translationRevisionPreference');
  expect(retriedRequest).toContain('必须保留的人工术语修订。');
  await expect(overlay.locator('.version-counter')).toHaveText('v1/3');

  const worker = context.serviceWorkers()[0]!;
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    const memories = Object.values(
      (stored.documentTranslationMemoryV1 ?? {}) as Record<string, {
        recentTranslations?: Array<{ originalText?: string; translatedText?: string }>;
      }>,
    );
    return memories.flatMap((memory) => memory.recentTranslations ?? []).find(
      (entry) => entry.originalText ===
        'A consistent academic translation improves the readability of research papers.',
    )?.translatedText;
  })).toBe('经用户调整后，更忠实地保留原文限定条件。');

  const marker = page.locator('#pi-translation-marker-layer .marker').first();
  await expect(marker).toBeVisible();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the retried webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(page.locator('#pi-translation-marker-layer .tooltip')).toContainText('经用户调整后');
  await overlay.locator('.mark-action').click();
  await expect(page.locator('#pi-translation-marker-layer .marker')).toHaveCount(0);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('corrects one aligned sentence locally without adding visible controls or API calls', async () => {
  await page.evaluate(() => {
    const source = document.querySelector('#multi-source');
    if (!source) throw new Error('Missing multi-sentence source fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toHaveText('第一句重要译文。第二句补充译文。');
  await overlay.getByRole('button', { name: '显示逐句对照' }).click();
  let segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  const first = segments.nth(0);
  await expect.poll(() => first.locator('.segment-actions').evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe('0.62');
  await first.focus();
  await expect.poll(() => first.locator('.segment-actions').evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe('1');
  const alignedControlHeights = await Promise.all([
    first.locator('.segment-correct'),
    first.locator('.segment-mark'),
  ].map((control) => control.evaluate((element) => element.getBoundingClientRect().height)));
  expect(alignedControlHeights).toEqual([32, 32]);
  const requestsBeforeCorrection = textRequests.length;
  await first.locator('.segment-correct').click();
  let sentenceEditor = first.getByRole('group', { name: /修正第 1 句/ });
  await expect(sentenceEditor).toBeVisible();
  await sentenceEditor.getByRole('textbox', { name: '可编辑本句译文第 1 段' })
    .press('Escape');
  await expect(sentenceEditor).toBeHidden();
  await expect(first.locator('.segment-correct')).toBeFocused();

  await first.locator('.segment-correct').click();
  sentenceEditor = first.getByRole('group', { name: /修正第 1 句/ });
  await sentenceEditor.getByRole('textbox', { name: '可编辑本句译文第 1 段' })
    .fill('人工修正后的第一句。');
  await sentenceEditor.getByRole('button', { name: '保存' }).click();

  segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0).locator('.segment-target')).toHaveText('人工修正后的第一句。');
  await expect(segments.nth(1).locator('.segment-target')).toHaveText('第二句补充译文。');
  await expect(segments.nth(0).locator('.segment-correct')).toBeFocused();
  const versionContext = overlay.locator('.version-context');
  await expect(versionContext).toContainText('修正本句');
  await expect(versionContext).toContainText('仅当前选择');
  await expect(versionContext).toContainText('较上一版调整 1 句');
  await expect(segments.nth(0)).toHaveAttribute('data-version-changed', 'true');
  await expect(segments.nth(1)).not.toHaveAttribute('data-version-changed', 'true');
  await overlay.getByRole('button', { name: '显示完整译文' }).click();
  await expect(overlay.locator('.segment')).toHaveCount(0);
  await overlay.getByRole('button', { name: '切换逐句对照并定位第一处版本改动' }).click();
  segments = overlay.locator('.segment');
  await expect(segments.nth(0)).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeCorrection);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  segments = overlay.locator('.segment');
  await expect(versionContext).toContainText('撤销修改');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0).locator('.segment-target')).toHaveText('第一句重要译文。');
  await expect(segments.nth(1).locator('.segment-target')).toHaveText('第二句补充译文。');
  await expect(segments.nth(0).locator('.segment-correct')).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeCorrection);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('marks one aligned sentence and copies marked notes as Markdown', async () => {
  await page.evaluate(() => {
    const source = document.querySelector('#multi-source');
    if (!source) throw new Error('Missing multi-sentence source fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toHaveText('第一句重要译文。第二句补充译文。');
  await overlay.getByRole('button', { name: '显示逐句对照' }).click();
  const segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0)).toContainText('First important sentence.');
  await expect(segments.nth(1)).toContainText('Second supporting sentence.');

  const firstMark = segments.nth(0).getByRole('button', { name: '轻标记本句' });
  await firstMark.click();
  await expect(segments.nth(0).getByRole('button', { name: '取消本句标记' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(segments.nth(1).getByRole('button', { name: '轻标记本句' }))
    .toHaveAttribute('aria-pressed', 'false');

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the aligned source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('第一句重要译文。');
  await expect(markerLayer.locator('.tooltip')).not.toContainText('第二句补充译文。');

  await page.mouse.click(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('手动修改后的完整双句译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(1);
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('第一句重要译文。');

  const moreMenu = overlay.locator('details.more');
  await moreMenu.locator(':scope > summary').click();
  await expect(moreMenu).toHaveAttribute('open', '');
  await overlay.locator('.result-scroll').click({ position: { x: 4, y: 4 } });
  await expect(moreMenu).not.toHaveAttribute('open', '');
  await moreMenu.locator(':scope > summary').click();
  const exportNotes = overlay.getByRole('button', { name: '复制标记笔记' });
  await exportNotes.click();
  await expect(overlay.getByRole('button', { name: '已复制 1 条标记' })).toBeVisible();

  await overlay.getByRole('button', { name: '关闭' }).click();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await markerLayer.getByRole('button', { name: '取消标记' }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
});

test('gives compact progress and success feedback when updating the target language', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const targetLanguage = popup.locator('#target-language');
  const status = popup.locator('#status');
  await expect(targetLanguage).toHaveValue('zh-CN');
  await targetLanguage.selectOption('en');
  await expect(status).toContainText('目标语言已更新');
  await expect(status).toHaveAttribute('data-tone', 'success');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(targetLanguage).toBeEnabled();
  expect(await status.evaluate((element) => {
    const marker = getComputedStyle(element, '::before');
    return { width: marker.width, height: marker.height, radius: marker.borderRadius };
  })).toEqual({ width: '5px', height: '5px', radius: '50%' });
  await expect(status).toHaveText('', { timeout: 4_000 });
  await expect(status).not.toHaveAttribute('data-tone', /.+/);
  await popup.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('#target-language')).toHaveValue('en');
  await reopened.close();
});

test('shows site pause controls only on supported webpages', async () => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();

    const siteControl = popup.locator('#site-control');
    const pauseSite = popup.locator('#pause-site');
    const quickActions = popup.locator('#quick-actions');
    await expect(siteControl).toBeVisible();
    await expect(popup.locator('#site-name')).toHaveText('www.overleaf.com');
    await expect(pauseSite).toBeEnabled();
    await expect(popup.locator('#api-profile-field')).toBeVisible();
    const fieldGap = await popup.evaluate(() => {
      const targetField = document.querySelector<HTMLElement>('label:has(#target-language)');
      const apiField = document.querySelector<HTMLElement>('#api-profile-field');
      if (!targetField || !apiField) return -1;
      return apiField.getBoundingClientRect().top - targetField.getBoundingClientRect().bottom;
    });
    expect(fieldGap).toBeGreaterThanOrEqual(11);
    await expect(quickActions).toHaveAttribute('data-primary', 'sidebar');
    await expect(quickActions.locator('button').first()).toHaveAttribute('id', 'open-sidebar');
    await expect(popup.locator('#open-sidebar')).toHaveClass(/primary-action/);
    await expect(popup.locator('#open-web-region')).toBeVisible();
    await expect(popup.locator('#open-web-region')).toHaveText('框选当前网页');
    await expect(popup.locator('#page-context')).toContainText('在 Overleaf 选中文字即可翻译');
    await expect(popup.locator('#open-pdf')).toHaveClass(/secondary-action/);
    const pauseSwitchStyle = await pauseSite.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        appearance: style.appearance,
        borderRadius: style.borderRadius,
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
      };
    });
    expect(pauseSwitchStyle).toEqual({
      appearance: 'none',
      borderRadius: '999px',
      height: 20,
      width: 34,
    });
  } finally {
    await popup.close();
  }
});

test('shows contextual guidance once and keeps dismissal local', async () => {
  const discoveryKeys = [
    'featureDiscoveryV1:completed:web-selection',
    'featureDiscoveryV1:completed:web-sidebar',
    'featureDiscoveryV1:completed:web-region',
    'featureDiscoveryV1:completed:overleaf-selection',
    'featureDiscoveryV1:completed:overleaf-region',
    'featureDiscoveryV1:completed:overleaf-pdf',
    'featureDiscoveryV1:completed:pdf-reader',
    'featureDiscoveryV1:completed:pdf-selection',
    'featureDiscoveryV1:completed:pdf-region',
    'featureDiscoveryV1:dismissed:web',
    'featureDiscoveryV1:dismissed:overleaf',
    'featureDiscoveryV1:dismissed:pdf',
  ];
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async (keys) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      await extensionChrome.storage.local.remove(keys);
    }, discoveryKeys);
    await page.bringToFront();
    await popup.reload();

    const guide = popup.locator('#feature-guide');
    await expect(guide).toBeVisible();
    await expect(popup.locator('#feature-guide-eyebrow')).toHaveText('当前页面 · Overleaf');
    await expect(popup.locator('#feature-guide-title')).toHaveText('编辑区和预览区，分别这样用');
    await expect(popup.locator('#feature-guide-steps .feature-guide-step')).toHaveCount(3);
    await expect(guide).toContainText('编辑区文字直接划选');
    await expect(guide).toContainText('预览中的复杂内容用框选');
    await expect(guide).toContainText('通读编译稿时使用 Pi PDF');
    const layout = await guide.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(layout.height).toBeLessThan(240);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

    await popup.locator('#feature-guide-dismiss').click();
    await expect(guide).toBeHidden();
    await expect(popup.locator('#feature-guide-toggle')).toBeVisible();
    const dismissed = await popup.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      return extensionChrome.storage.local.get('featureDiscoveryV1:dismissed:overleaf');
    });
    expect(dismissed['featureDiscoveryV1:dismissed:overleaf']).toBe(true);

    await page.bringToFront();
    await popup.reload();
    await expect(guide).toBeHidden();
    await popup.locator('#feature-guide-toggle').click();
    await expect(guide).toBeVisible();
  } finally {
    if (!popup.isClosed()) {
      await popup.evaluate(async (keys) => {
        const extensionChrome = (
          globalThis as typeof globalThis & { chrome: TestChromeApi }
        ).chrome;
        await extensionChrome.storage.local.remove(keys);
      }, discoveryKeys).catch(() => undefined);
      await popup.close();
    }
  }
});

test('routes confirmed webpage regions through multimodal capture without text fallback', async ({}, testInfo) => {
  async function startFromPopup(): Promise<void> {
    const popup = await context.newPage();
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.bringToFront();
      await popup.reload();
      await expect(popup.locator('#open-web-region')).toBeVisible();
      await popup.evaluate(() => {
        document.querySelector<HTMLButtonElement>('#open-web-region')?.click();
      });
      await expect(page.locator('#pi-web-region-selection-root')).toBeVisible();
    } finally {
      if (!popup.isClosed()) await popup.close();
    }
  }

  async function drawAround(selector: string, widthRatio = 1): Promise<void> {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x - 4, box.y - 4);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * widthRatio + 4,
      box.y + box.height + 4,
      { steps: 8 },
    );
    await page.mouse.up();
  }

  await closeVisibleTranslationSurfaceForCleanup();
  await clearBrowserSelection();
  const textBefore = textRequests.length;
  const visionBefore = visionRequests.length;
  await startFromPopup();
  const webRegion = page.locator('#pi-web-region-selection-root');
  await page.mouse.move(180, 180);
  const reticle = webRegion.locator('.reticle');
  await expect(reticle).toHaveCSS('opacity', '1');
  await expect(webRegion.locator('.stage')).toHaveCSS('cursor', 'none');
  await expect(reticle.locator('.reticle-dot')).toHaveCSS('background-color', 'rgb(101, 88, 217)');
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({ path: testInfo.outputPath('web-region-reticle.png') });
  }
  await drawAround('#math-source');
  await expect(reticle).toHaveCSS('opacity', '0');
  await expect(webRegion.locator('.status')).toContainText('使用多模态模型翻译');
  await expect(webRegion.locator('.privacy')).toContainText('只截取当前可见页中的框内区域');
  await expect(webRegion.locator('.confirm')).toHaveText('翻译框选内容');
  await expect(webRegion.locator('.mode')).toHaveCount(0);
  const originalRegionBounds = await webRegion.locator('.selection').boundingBox();
  expect(originalRegionBounds).not.toBeNull();
  await webRegion.locator('.confirm').click();
  await expect(webRegion).toHaveCount(0);
  expect(textRequests).toHaveLength(textBefore);

  const resultOverlay = page.locator('#tex-selection-translator-root');
  await expect(resultOverlay.locator('.error')).toContainText('截图权限');
  expect(visionRequests).toHaveLength(visionBefore);
  const permissionFrameElement = resultOverlay.locator('.capture-permission-frame');
  await expect(permissionFrameElement).toBeVisible();
  await expect(resultOverlay.locator('.capture-permission')).toContainText('首次使用需要一次截图授权');
  await expect(resultOverlay.getByRole('button', { name: '改用浏览器侧栏授权' }))
    .toBeVisible();
  await expect(resultOverlay.getByRole('button', { name: '调整区域' })).toBeVisible();
  await expect(resultOverlay.getByRole('button', { name: '重新框选' })).toBeVisible();
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({ path: testInfo.outputPath('inline-capture-permission.png') });
  }
  await expect.poll(() => page.frames().some((frame) => (
    new URL(frame.url()).pathname === '/web-capture-permission.html'
  ))).toBe(true);
  const permissionFrame = page.frames().find((frame) => (
    new URL(frame.url()).pathname === '/web-capture-permission.html'
  ));
  expect(permissionFrame).toBeDefined();
  expect(new URL(permissionFrame!.url()).protocol).toBe('chrome-extension:');
  await expect(permissionFrame!.locator('body')).toHaveAttribute('data-theme', 'light');
  expect(await permissionFrame!.evaluate(() => typeof (
    globalThis as typeof globalThis & {
      chrome?: { permissions?: { request?: unknown } };
    }
  ).chrome?.permissions?.request))
    .toBe('function');
  await permissionFrame!.evaluate(() => {
    const extensionChrome = (globalThis as typeof globalThis & {
      chrome: { permissions: object };
    }).chrome;
    Object.defineProperty(extensionChrome.permissions, 'request', {
      configurable: true,
      value: async () => false,
    });
  });
  await permissionFrame!.getByRole('button', { name: /允许截图并继续/ }).click();
  await expect(permissionFrame!.locator('#label')).toHaveText('未允许，点击重试');
  await expect(resultOverlay.locator('.error')).toContainText('截图权限');
  await permissionFrame!.evaluate(() => {
    const extensionChrome = (globalThis as typeof globalThis & {
      chrome: { permissions: object };
    }).chrome;
    Object.defineProperty(extensionChrome.permissions, 'request', {
      configurable: true,
      value: async () => true,
    });
  });
  await permissionFrame!.getByRole('button', { name: /未允许，点击重试/ })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const adjustedRegion = page.locator('#pi-web-region-selection-root');
  await expect(adjustedRegion.locator('.selection')).toBeVisible();
  await expect(adjustedRegion.locator('.selection')).toBeFocused();
  await expect(adjustedRegion.locator('.confirm')).toHaveText('翻译框选内容');
  const restoredRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(restoredRegionBounds).not.toBeNull();
  if (originalRegionBounds && restoredRegionBounds) {
    expect(restoredRegionBounds.x).toBeCloseTo(originalRegionBounds.x, 0);
    expect(restoredRegionBounds.y).toBeCloseTo(originalRegionBounds.y, 0);
    expect(restoredRegionBounds.width).toBeCloseTo(originalRegionBounds.width, 0);
    expect(restoredRegionBounds.height).toBeCloseTo(originalRegionBounds.height, 0);
  }
  expect(textRequests).toHaveLength(textBefore);
  await adjustedRegion.locator('.selection').press('ArrowRight');
  const movedRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(movedRegionBounds).not.toBeNull();
  if (restoredRegionBounds && movedRegionBounds) {
    expect(movedRegionBounds.x).toBeCloseTo(restoredRegionBounds.x + 6, 0);
    expect(movedRegionBounds.width).toBeCloseTo(restoredRegionBounds.width, 0);
  }
  await adjustedRegion.locator('.selection').press('Shift+ArrowRight');
  const resizedRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(resizedRegionBounds).not.toBeNull();
  if (movedRegionBounds && resizedRegionBounds) {
    expect(resizedRegionBounds.width).toBeCloseTo(movedRegionBounds.width + 6, 0);
  }
  expect(textRequests).toHaveLength(textBefore);
  await adjustedRegion.locator('.confirm').click();
  await expect(adjustedRegion).toHaveCount(0);
  await expect(resultOverlay.locator('.error')).toContainText('截图权限');
  expect(visionRequests).toHaveLength(visionBefore);
  expect(textRequests).toHaveLength(textBefore);

  await resultOverlay.getByRole('button', { name: '重新框选' }).click();
  const keyboardRegion = page.locator('#pi-web-region-selection-root');
  await expect(keyboardRegion.locator('.selection')).toBeHidden();
  expect(textRequests).toHaveLength(textBefore);
  await page.keyboard.press('Enter');
  await expect(keyboardRegion.locator('.selection')).toBeVisible();
  await expect(keyboardRegion.locator('.selection')).toBeFocused();
  const keyboardRegionBounds = await keyboardRegion.locator('.selection').boundingBox();
  expect(keyboardRegionBounds).not.toBeNull();
  await keyboardRegion.locator('.selection').press('Control+ArrowRight');
  const fineMovedRegionBounds = await keyboardRegion.locator('.selection').boundingBox();
  expect(fineMovedRegionBounds).not.toBeNull();
  if (keyboardRegionBounds && fineMovedRegionBounds) {
    expect(fineMovedRegionBounds.x).toBeCloseTo(keyboardRegionBounds.x + 1, 0);
  }
  expect(textRequests).toHaveLength(textBefore);
  await page.keyboard.press('Escape');
  await expect(keyboardRegion).toHaveCount(0);
  await closeVisibleTranslationSurfaceForCleanup();

  await page.locator('#payment').scrollIntoViewIfNeeded();
  await startFromPopup();
  await drawAround('#payment');
  const sensitiveRegion = page.locator('#pi-web-region-selection-root');
  await expect(sensitiveRegion.locator('.status')).toContainText('密码、验证码或支付字段');
  await expect(sensitiveRegion.locator('.confirm')).toBeDisabled();
  await sensitiveRegion.locator('.cancel').click();
  await expect(sensitiveRegion).toHaveCount(0);
});
