import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let context: BrowserContext;
let options: Page;
let userDataDirectory: string;

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
  const extensionId = new URL(serviceWorker.url()).host;
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

  const activeTextProfile = await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return stored.extensionSettings?.activeApiProfileId;
  });
  expect(activeTextProfile).toBe('text-api');
});
