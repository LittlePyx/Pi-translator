import { context, expect, extensionId, installEdgeExtensionHooks, test } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('filters provider-returned model families without changing the saved model or old data', async ({}, testInfo) => {
  const models = ['e2e-model', 'openai/gpt-6-astra', 'anthropic/claude-opus-5-5', 'google/gemini-3.8-flash',
    'qwen3.8-max', 'deepseek-v4-pro-0813', 'kimi-k3', 'glm-5.3', 'MiniMax-M3', 'mistral-large',
    'llama-4', 'grok-4', 'text-embedding-v3', 'gpt-image-1'];
  const url = 'https://www.overleaf.com/pi-translator-e2e-api/models';
  await context.route(url, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: models.map(id => ({ id })) }) }));
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect(options.locator('#model-catalog-status')).toContainText('12 个文字候选');
    await expect(options.locator('#status')).toContainText('保存');
    const before = await options.evaluate(async () => (globalThis as any).chrome.storage.local.get(null));
    await expect(options.locator('#save-button')).toBeDisabled();
    await options.screenshot({ path: testInfo.outputPath('model-catalog-desktop.png'), fullPage: true });
    await options.setViewportSize({ width: 360, height: 760 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await options.screenshot({ path: testInfo.outputPath('model-catalog-mobile.png'), fullPage: true });
    await options.locator('#model-family').selectOption('gpt');
    expect(await options.locator('#model-list option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value)))
      .toEqual(['openai/gpt-6-astra']);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#model-family').selectOption('claude');
    expect(await options.locator('#model-list option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value)))
      .toEqual(['anthropic/claude-opus-5-5']);
    expect(await options.evaluate(async () => (globalThis as any).chrome.storage.local.get(null))).toEqual(before);
    await expect(options.locator('#save-button')).toBeDisabled();
    await options.locator('#model').fill('private-future-model');
    await expect(options.locator('#model')).toHaveValue('private-future-model');
    await options.locator('#api-preset').selectOption('openai');
    await expect(options.locator('#model-list option')).toHaveCount(0);
    await expect(options.locator('#model-family')).toBeHidden();
    await expect(options.locator('#model')).toHaveValue('');
    await expect(options.locator('#api-key')).toHaveValue('');
    expect(await options.evaluate(async () => (globalThis as any).chrome.storage.local.get(null))).toEqual(before);
    await options.setViewportSize({ width: 360, height: 760 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.unroute(url); await options.close(); }
});

test('offers GPT, Claude and Gemini in first setup and clears the previous provider catalog', async ({}, testInfo) => {
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('#api-profile option')).not.toHaveCount(0);
    await options.locator('[data-settings-target="support"]').click();
    await options.locator('details.support-disclosure').filter({ has: options.locator('#restart-onboarding') }).locator('summary').click();
    await options.locator('#restart-onboarding').click();
    await options.locator('#onboarding-next').click();
    for (const preset of ['openai', 'anthropic', 'gemini']) {
      await options.locator('#onboarding-preset').selectOption(preset);
      await expect(options.locator('#onboarding-api-key')).toHaveValue('');
      await expect(options.locator('#onboarding-model')).toHaveValue('');
      await expect(options.locator('#onboarding-model-list option')).toHaveCount(0);
    }
    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-api-key').fill('e2e-only-key');
    await options.locator('#onboarding-base-url').fill('https://www.overleaf.com/pi-translator-e2e-api');
    const url = 'https://www.overleaf.com/pi-translator-e2e-api/models';
    await context.route(url, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'e2e-model' }, { id: 'openai/gpt-6-astra' }, { id: 'qwen3.8-max' }] }) }));
    try {
      await options.locator('#onboarding-next').click();
      await expect(options.locator('#onboarding-model-family')).toBeVisible();
      await options.locator('#onboarding-model-family').selectOption('gpt');
      expect(await options.locator('#onboarding-model-list option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value)))
        .toEqual(['openai/gpt-6-astra']);
      await options.setViewportSize({ width: 360, height: 760 });
      expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await options.screenshot({ path: testInfo.outputPath('onboarding-catalog-mobile.png'), fullPage: true });
    } finally { await context.unroute(url); }
  } finally { await options.close(); }
});
