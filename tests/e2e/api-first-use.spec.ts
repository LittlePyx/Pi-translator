import type { Request } from '@playwright/test';
import { context, expect, extensionId, installEdgeExtensionHooks, test } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('keeps the first selection made while the content script is initializing', async () => {
  const target = await context.newPage();
  const url = 'https://www.overleaf.com/project/pi-initial-selection';
  await target.route(url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
    <p id="first-source">A consistent academic translation improves the readability of research papers.</p>
    <script>
      const observer=new MutationObserver(()=>{
        if(!document.getElementById('tex-selection-translator-root'))return;
        const range=document.createRange();range.selectNodeContents(document.getElementById('first-source'));
        getSelection().removeAllRanges();getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));window.firstSelectionMade=true;observer.disconnect();
      });observer.observe(document.documentElement,{childList:true,subtree:true});
    </script></body></html>` }));
  try {
    await target.goto(url);
    await expect.poll(() => target.evaluate(() => (globalThis as any).firstSelectionMade)).toBe(true);
    const overlay = target.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  } finally { await target.close(); }
});

test('does not send a stored Key to an edited API endpoint during setup checks', async () => {
  let sent = 0;
  const base = 'https://www.overleaf.com/pi-translator-other-e2e-api';
  await context.route(`${base}/**`, async route => {
    sent++;
    await route.fulfill({ contentType: 'application/json', body: '{"data":[{"id":"e2e-model"}],"choices":[{"message":{"content":"你好"}}]}' });
  });
  const caller = await context.newPage();
  await caller.goto(`chrome-extension://${extensionId}/options.html`);
  try {
    await expect(caller.locator('#model')).toHaveValue('e2e-model');
    await caller.locator('#connection-more > summary').click();
    await caller.locator('#connection-advanced > summary').click();
    await caller.locator('#api-base-url').fill(base);
    await expect(caller.locator('#api-key-state')).toContainText('接口地址已更改');
    for (const type of ['LIST_API_MODELS', 'TEST_API_CONNECTION', 'TEST_VISION_CAPABILITY', 'DIAGNOSE_API']) {
      const response = await caller.evaluate(async ({ type, base }) => {
        const api = (globalThis as typeof globalThis & { chrome: { runtime: { sendMessage(message: unknown): Promise<{ ok: boolean; error?: { code: string } }> } } }).chrome;
        return api.runtime.sendMessage({ type, payload: { profileId: 'default', apiBaseUrl: base, model: 'e2e-model' } });
      }, { type, base });
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('NO_API_KEY');
    }
    expect(sent).toBe(0);
  } finally { await context.unroute(`${base}/**`); await caller.close(); }
});

async function openWizard() {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator('#api-profile option')).not.toHaveCount(0);
  await options.locator('[data-settings-target="support"]').click();
  const support = options.locator('details.support-disclosure').filter({ has: options.locator('#restart-onboarding') });
  await support.locator('summary').click();
  await options.locator('#restart-onboarding').click();
  await expect(options.locator('#onboarding-dialog')).toBeVisible();
  return options;
}

test('explains the Key issuer and allows an Alibaba region or workspace address', async () => {
  const options = await openWizard();
  try {
    await options.locator('#onboarding-next').click();
    await expect(options.locator('[data-onboarding-step="2"]')).toContainText('选择签发它的服务商');
    await options.locator('#onboarding-preset').selectOption('qwen');
    await expect(options.locator('#onboarding-base-url-field')).toBeVisible();
    await expect(options.locator('#onboarding-key-hint')).toContainText('地域');
    await options.locator('#onboarding-base-url').fill('https://example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
    await expect(options.locator('#onboarding-base-url')).toHaveValue(/ap-southeast-1/);
    await options.setViewportSize({ width: 360, height: 640 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await options.close(); }
});

test('finishes text setup with one sample and no image probes while preserving existing API keys', async () => {
  const options = await openWizard();
  const calls = { text: 0, image: 0 };
  const count = (request: Request) => {
    if (request.method() !== 'POST' || !request.url().includes('/pi-translator-e2e-api/')) return;
    const body = request.postDataJSON();
    const image = body.messages?.some((message: { content: unknown }) => Array.isArray(message.content) && message.content.some(item => item.type === 'image_url'));
    if (image) calls.image++; else calls.text++;
  };
  context.on('request', count);
  try {
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('e2e-new-text-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-model')).toHaveValue('e2e-model');
    await options.locator('#onboarding-test').click();
    await expect(options.locator('#onboarding-success')).toBeVisible();
    expect(calls).toEqual({ text: 1, image: 0 });
    const worker = context.serviceWorkers()[0]!;
    const oldKeyStillAvailable = await worker.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: { storage: { session: { get(key: string): Promise<Record<string, Record<string, string>>> } } } }).chrome;
      return (await api.storage.session.get('apiKeysByProfile')).apiKeysByProfile?.['vision-e2e'] === 'e2e-vision-key';
    });
    expect(oldKeyStillAvailable).toBe(true);
  } finally { context.off('request', count); await options.close(); }
});

test('keeps authentication failures on the credentials step instead of suggesting model selection', async () => {
  const options = await openWizard();
  const models = 'https://www.overleaf.com/pi-translator-e2e-api/models';
  await context.route(models, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Invalid API key"}}' }));
  try {
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('e2e-invalid-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-status')).toContainText('服务商');
    await expect(options.locator('#onboarding-key-error')).toContainText('签发');
    await expect(options.locator('#onboarding-api-key')).toHaveAttribute('aria-invalid','true');
    await expect(options.locator('[data-onboarding-step="2"]')).toBeVisible();
    await expect(options.locator('[data-onboarding-step="3"]')).toBeHidden();
    await options.locator('#onboarding-api-key').fill('corrected-key-draft');
    await expect(options.locator('#onboarding-key-error')).toBeHidden();
    await expect(options.locator('#onboarding-status')).toHaveText('');
    await expect(options.locator('#onboarding-api-key')).toHaveValue('corrected-key-draft');
  } finally { await context.unroute(models); await options.close(); }
});

test('allows a manually entered model when discovery is unsupported and saves the verified profile', async () => {
  const options = await openWizard();
  const models = 'https://www.overleaf.com/pi-translator-e2e-api/models';
  await context.route(models, route => route.fulfill({ status: 404, body: 'Not found' }));
  try {
    await options.locator('#onboarding-next').click();
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('e2e-manual-model-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('[data-onboarding-step="3"]')).toBeVisible();
    await expect(options.locator('#onboarding-status')).toContainText('未能读取模型列表');
    await options.locator('#onboarding-model').fill('e2e-model');
    await options.locator('#onboarding-test').click();
    await expect(options.locator('#onboarding-success')).toBeVisible();
  } finally { await context.unroute(models); await options.close(); }
});

test('offers manual validation and saves it when the settings model list is unavailable', async () => {
  const options = await context.newPage();
  const models = 'https://www.overleaf.com/pi-translator-e2e-api/models';
  await context.route(models, route => route.fulfill({ status: 404, body: 'Not found' }));
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect(options.locator('#connection-advanced')).toHaveAttribute('open', '');
    await expect(options.locator('#model')).toBeFocused();
    await expect(options.locator('#status')).toContainText('验证并保存当前模型');
    await options.locator('#model').fill('e2e-model-fast');
    await options.locator('#test-connection').click();
    await expect(options.locator('#status')).toContainText('连接成功并已保存');
    await options.reload();
    await expect(options.locator('#model')).toHaveValue('e2e-model-fast');
  } finally { await context.unroute(models); await options.close(); }
});
