import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OVERLEAF_FIXTURE_URL =
  'https://www.overleaf.com/project/pi-translator-e2e';

let context: BrowserContext;
let page: Page;
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

async function selectSourceText(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  const source = page.locator('#source');
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

async function clearBrowserSelection(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-e2e-'));
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
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  extensionId = new URL(serviceWorker.url()).host;

  const bootstrapPages = context.pages();
  const bootstrapPage = bootstrapPages[0] ?? await context.newPage();
  await bootstrapPage.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = bootstrapPage.locator('#onboarding-dialog');
  if (await onboarding.isVisible()) {
    await bootstrapPage.locator('#onboarding-skip').click();
  }
  await bootstrapPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        apiProfiles: [{
          id: 'default',
          name: 'E2E API',
          apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
          model: 'e2e-model',
        }],
        activeApiProfileId: 'default',
        apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
        model: 'e2e-model',
        onboardingCompleted: true,
      },
    });
    await extensionChrome.storage.session.set({
      apiKeysByProfile: { default: 'e2e-key' },
    });
  });
  await Promise.all(
    context.pages()
      .filter((tab) => tab !== bootstrapPage)
      .map((tab) => tab.close()),
  );
  page = await context.newPage();
  await bootstrapPage.close();
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              translation: '一致的学术翻译能够提升研究论文的可读性。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '一致的学术翻译能够提升研究论文的可读性。',
              }],
            }),
          },
        }],
      }),
    });
  });
  await page.route(OVERLEAF_FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <body style="font: 18px sans-serif; padding: 80px">
            <p id="source">A consistent academic translation improves the readability of research papers.</p>
            <input id="payment" type="text" autocomplete="cc-number" value="4111 1111 1111 1111" />
            <button id="blank" type="button">Clear selection</button>
          </body>
        </html>`,
    });
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('shows and hides the selection trigger with the browser selection', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');

  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('opens, drags, and dismisses a translation card', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');

  const card = overlay.locator('.card');
  const header = overlay.locator('.header');
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

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('updates the target language from the quick popup', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const targetLanguage = popup.locator('#target-language');
  await expect(targetLanguage).toHaveValue('zh-CN');
  await targetLanguage.selectOption('en');
  await expect(popup.locator('#status')).toContainText('目标语言已更新');
  await popup.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('#target-language')).toHaveValue('en');
  await reopened.close();
});

test('opens the full settings page in a browser tab', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const openSettings = popup.locator('#open-settings');
  await expect(openSettings).toBeVisible();

  const settingsPagePromise = context.waitForEvent('page');
  await openSettings.click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  const settingsUrl = new URL(settingsPage.url());
  expect(settingsUrl.protocol).toBe('chrome-extension:');
  expect(settingsUrl.host).toBe(extensionId);
  expect(settingsUrl.pathname).toBe('/options.html');

  await settingsPage.close();
  if (!popup.isClosed()) await popup.close();
});

test('opens the full settings page from the translation card menu', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.locator('details.more > summary').click();

  const settingsPagePromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '打开完整设置' }).click();
  const settingsPage = await settingsPagePromise;
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

test('pins continuous translation to a collapsible sidebar', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('固定到连续翻译侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await overlay.getByTitle('收起侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  await overlay.getByTitle('展开 Pi Translator 连续翻译侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
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

test('keeps advanced options collapsed until requested', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = options.locator('#onboarding-dialog');
  await expect(onboarding).not.toBeVisible();
  await expect(options.locator('[data-settings-section="connection"]')).toBeVisible();
  await expect(options.locator('[data-settings-section="results"]')).not.toBeVisible();
  await options.locator('[data-settings-target="results"]').click();
  await expect(options.locator('[data-settings-section="results"]')).toBeVisible();
  const advanced = options.locator('details.advanced-panel');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(options.locator('#context-mode')).toBeVisible();
  await expect(options.locator('#enable-streaming')).toBeVisible();
  await expect(options.locator('#protect-sensitive-fields')).toBeVisible();
  await options.locator('#alignment-default').check();
  await expect(options.locator('#save-state')).toContainText('未保存');
  await options.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.locator('[data-settings-target="support"]').click();
  const support = reopened.locator('details.support-disclosure');
  await expect(support).not.toHaveAttribute('open', '');
  await support.locator('summary').click();
  await reopened.locator('#restart-onboarding').click();
  await expect(reopened.locator('#onboarding-dialog')).toBeVisible();
  await reopened.close();
});
