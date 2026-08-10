import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let context: BrowserContext;
let options: Page;
let userDataDirectory: string;
let extensionId: string;

interface TestChromeStorageArea {
  get(key: string): Promise<Record<string, Record<string, unknown>>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface TestChromeApi {
  storage: {
    local: TestChromeStorageArea;
    session: Pick<TestChromeStorageArea, 'set'>;
  };
}

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-options-e2e-'));
  const extensionPath = path.resolve('.output/edge-mv3');
  context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: EDGE_EXECUTABLE,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
  extensionId = new URL(serviceWorker.url()).host;
  options = context.pages()[0] ?? await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  if (await options.locator('#onboarding-dialog').isVisible()) {
    await options.locator('#onboarding-skip').click();
  }
  await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        apiProfiles: [{
          id: 'text-api',
          name: 'DeepSeek 文字翻译',
          apiBaseUrl: 'https://api.deepseek.com',
          model: 'deepseek-chat',
        }],
        activeApiProfileId: 'text-api',
        visionApiProfileId: '',
        visionModel: '',
        apiBaseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        onboardingCompleted: true,
      },
    });
    await extensionChrome.storage.session.set({
      apiKeysByProfile: { 'text-api': 'e2e-key' },
    });
  });
  await options.reload();
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDirectory) await rm(userDataDirectory, { recursive: true, force: true });
});

test('offers a focused Qwen setup without replacing the text API', async () => {
  await expect(options.getByRole('heading', { name: '文字翻译 API（必需）' })).toBeVisible();
  await expect(options.locator('#vision-setup-status')).toContainText('不影响普通文字翻译');
  await expect(options.locator('#api-preset option[value="qwen"]')).toContainText('PDF 图像推荐');

  await options.locator('#setup-qwen').click();

  await expect(options.locator('#api-preset')).toHaveValue('qwen');
  await expect(options.locator('#api-base-url')).toHaveValue(
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  await expect(options.locator('#model')).toHaveValue('qwen3.7-plus');
  await expect(options.locator('#api-key')).toBeFocused();
  await expect(options.locator('#status')).toContainText('文字翻译仍使用“DeepSeek 文字翻译”');
  await expect(options.locator('#vision-setup-status')).toContainText('连接成功后会自动用于 PDF 图像');
  await expect(options.locator('#back-to-text-profile')).toBeVisible();

  await options.locator('#back-to-text-profile').click();
  await expect(options.locator('#api-profile')).toHaveValue('text-api');
  await expect(options.locator('#api-profile option')).toHaveCount(2);
  await expect(options.locator('#status')).toContainText('已返回文字 API“DeepSeek 文字翻译”');

  const activeTextProfile = await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return stored.extensionSettings?.activeApiProfileId;
  });
  expect(activeTextProfile).toBe('text-api');
});

test('keeps API readiness compact and deep-links the exact setting', async () => {
  const popup = await context.newPage();
  let focusedOptions: Page | undefined;
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const statusRow = popup.locator('.capability-status');
    const textStatus = popup.locator('#text-api-status');
    const visionStatus = popup.locator('#vision-api-status');

    await expect(statusRow).toBeVisible();
    await expect(textStatus).toContainText('文字翻译');
    await expect(visionStatus).toContainText('PDF 图像');
    await expect(visionStatus).toContainText('按需配置');
    expect(await statusRow.locator('.capability-item').count()).toBe(2);
    expect(await statusRow.evaluate((element) => element.getBoundingClientRect().height))
      .toBeLessThan(32);
    expect(await textStatus.evaluate((element) => getComputedStyle(element).borderRadius))
      .toBe('0px');

    const pauseSite = popup.locator('#pause-site');
    await expect(pauseSite).toHaveAttribute('aria-describedby', 'site-pause-help');
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

    const optionsPromise = context.waitForEvent('page');
    await textStatus.click();
    focusedOptions = await optionsPromise;
    await focusedOptions.waitForLoadState('domcontentloaded');
    await expect(focusedOptions.locator('#test-connection')).toBeFocused();
  } finally {
    if (focusedOptions && !focusedOptions.isClosed()) await focusedOptions.close();
    if (!popup.isClosed()) await popup.close();
  }
});

test('keeps settings interaction surfaces dark on hover and keyboard focus', async () => {
  await options.emulateMedia({ colorScheme: 'dark' });
  await options.reload();

  const backgroundAfter = async (
    selector: string,
    interaction: 'hover' | 'focus',
  ): Promise<string> => {
    const target = options.locator(selector);
    if (interaction === 'hover') await target.hover();
    else await target.focus();
    return target.evaluate((element) => getComputedStyle(element).backgroundColor);
  };

  await expect.poll(() => backgroundAfter('#api-preset', 'hover'))
    .toBe('rgb(32, 41, 56)');
  await expect.poll(() => backgroundAfter('#refresh-models', 'focus'))
    .toBe('rgb(32, 41, 56)');
  await expect.poll(() => backgroundAfter(
    '.settings-nav-item[data-settings-target="translation"]',
    'hover',
  )).toBe('rgb(22, 31, 44)');
  await expect.poll(() => backgroundAfter('#connection-advanced > summary', 'hover'))
    .toBe('rgb(23, 31, 44)');

  await options.emulateMedia({ colorScheme: 'light' });
});
