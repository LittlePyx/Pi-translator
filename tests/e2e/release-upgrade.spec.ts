import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

interface TestChromeApi {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: {
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
}

async function launchExtension(userDataDirectory: string): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const extensionPath = path.resolve('.output/edge-mv3');
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: EDGE_EXECUTABLE,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const serviceWorker = context.serviceWorkers()[0] ??
    await context.waitForEvent('serviceworker');
  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
  };
}

async function optionsPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage();
  const url = `chrome-extension://${extensionId}/options.html`;
  try {
    await page.goto(url);
  } catch (error) {
    const interruptedBySamePage = error instanceof Error &&
      error.message.includes('interrupted by another navigation') &&
      error.message.includes(url);
    if (!interruptedBySamePage) throw error;
    await page.waitForURL(url);
  }
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('upgrades legacy settings and keeps a persistent key after a real Edge restart', async () => {
  const userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-upgrade-'));
  let context: BrowserContext | undefined;
  try {
    const firstLaunch = await launchExtension(userDataDirectory);
    context = firstLaunch.context;
    const firstOptions = await optionsPage(context, firstLaunch.extensionId);
    await firstOptions.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      await api.storage.local.set({
        extensionSettings: {
          schemaVersion: 4,
          apiBaseUrl: 'https://legacy.example/v1',
          model: 'legacy-academic-model',
          sourceLanguage: 'en',
          targetLanguage: 'ja',
          style: 'literal',
          contentMode: 'latex',
          apiKeyStorage: 'local',
          generalPageMode: 'allowlist',
          siteAllowlist: ['arxiv.org', 'docs.example.org'],
          sidebarWidth: 999,
          pdfRegionShortcutKey: 'Q',
          onboardingCompleted: true,
        },
        deepseekApiKey: 'release-upgrade-test-key',
      });
    });
    await context.close();
    context = undefined;

    const restarted = await launchExtension(userDataDirectory);
    context = restarted.context;
    const restartedOptions = await optionsPage(context, restarted.extensionId);

    await expect(restartedOptions.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(restartedOptions.locator('#api-base-url'))
      .toHaveValue('https://legacy.example/v1');
    await expect(restartedOptions.locator('#model')).toHaveValue('legacy-academic-model');
    await expect(restartedOptions.locator('#target-language')).toHaveValue('ja');
    await expect(restartedOptions.locator('#general-page-mode')).toHaveValue('allowlist');
    await expect(restartedOptions.locator('#site-allowlist'))
      .toHaveValue('arxiv.org\ndocs.example.org');
    await expect(restartedOptions.locator('#pdf-region-shortcut-key')).toHaveValue('Q');
    await expect(restartedOptions.locator('#api-key-state')).toContainText('已保存 Key');

    const publicSettings = await restartedOptions.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      return api.runtime.sendMessage({ type: 'GET_PUBLIC_SETTINGS' });
    });
    expect(publicSettings).toMatchObject({
      ok: true,
      data: {
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        style: 'literal',
        contentMode: 'latex',
        generalPageMode: 'allowlist',
        siteAllowlist: ['arxiv.org', 'docs.example.org'],
        sidebarWidth: 640,
        pdfRegionShortcutKey: 'q',
      },
    });
  } finally {
    await context?.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
