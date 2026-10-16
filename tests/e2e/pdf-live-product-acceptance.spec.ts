import {openPdfTranslationOptions,openPdfTranslationSettings} from './support/pdf-controls';
import {readFile, writeFile} from 'node:fs/promises';
import {context, expect, extensionId, installEdgeExtensionHooks, test} from './support/edge-extension-fixture';

// Opt-in only. Credentials use isolated session storage, never local storage or traces.
// The opt-in test package grants only the configured API host in its manifest.
// Session credentials are used only in the isolated profile; traces stay off.
installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_PRODUCT_ACCEPTANCE !== '1', 'Explicit live acceptance required.');
test.use({trace: 'off'});

test('accepts a real paper through trial, interruption, retention, library and source excerpts', async ({}, testInfo) => {
  test.setTimeout(480_000);
  const apiKey = process.env.QWEN_API_KEY?.trim();
  const base = process.env.QWEN_BASE_URL?.trim();
  const model = process.env.QWEN_MODEL?.trim();
  const source = process.env.PI_PDF_REGRESSION_SOURCE;
  if (!apiKey || !base || !model || !source) throw new Error('Live acceptance configuration is incomplete.');
  const endpoint = new URL(`${base.replace(/\/+$/u, '')}/chat/completions`);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Invalid live endpoint.');
  const report: Record<string, unknown> = {model, providerHost: endpoint.hostname, pageRange: '5 with locally resolved adjoining source regions', requestLimit: 20,
    evidence: 'real public PDF; extension directly uses Qwen with session-only credentials',
    boundary: 'The isolated test package pregrants the API host; first-time host permission is checked separately.'};
  const reader = await context.newPage();
  const options = await context.newPage();
  await reader.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {value: async (text: string) => {(globalThis as any).__liveClipboard = text;}, configurable: true});
  });
  try {
    await reader.setViewportSize({width: 1420, height: 1000});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async ({base, model, apiKey}) => {
      const chrome = (globalThis as any).chrome;
      const stored = await chrome.storage.local.get('extensionSettings');
      await chrome.storage.local.set({extensionSettings: {...stored.extensionSettings,
        apiProfiles: [{id: 'default', name: 'Qwen 真实验收', apiBaseUrl: base, model}, {id: 'vision-e2e', name: 'Qwen 真实视觉验收', apiBaseUrl: base, model}],
        apiBaseUrl: base, model, visionModel: model}});
      await chrome.storage.session.set({apiKeysByProfile: {default: apiKey, 'vision-e2e': apiKey}});
    }, {base, model, apiKey});
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(source);
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('5');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', {name: '应用'}).click();
    await expect(reader.locator('#pdf-document-translation-range-feedback')).toContainText('已自动补齐第 4 页续段');
    await expect(reader.locator('#pdf-document-translation-multimodal-toggle')).toBeChecked();
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-budget-details > summary').click();
    await reader.locator('#pdf-document-request-limit').fill('1');
    await reader.locator('#pdf-document-trial > summary').click();
    await reader.locator('#pdf-document-trial-block').selectOption('P5B18');
    await reader.locator('#pdf-document-trial-start').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'paused', {timeout: 180_000});
    await expect(reader.locator('[data-translation-block="P5B18"]')).toHaveAttribute('data-status', 'done');
    report.trialSnapshot = await reader.evaluate(async () => (await (globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1);
    await reader.screenshot({path: testInfo.outputPath('real-trial.png')});
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('请求上限', {timeout: 180_000});
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-translation-retention-toggle').check();
    await reader.screenshot({path: testInfo.outputPath('real-interrupted.png')});
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(source);
    await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'paused');
    await expect(reader.locator('#pdf-document-translation-range')).toHaveValue('custom');
    await expect(reader.locator('#pdf-document-translation-custom-pages')).toHaveValue('5');
    await expect(reader.locator('#pdf-document-translation-range-feedback')).toContainText('已自动补齐第 4 页续段');
    await openPdfTranslationSettings(reader);
    await openPdfTranslationOptions(reader);
    if (await reader.locator('#pdf-document-budget-details').getAttribute('open') === null) await reader.locator('#pdf-document-budget-details > summary').click();
    await reader.locator('#pdf-document-request-limit').fill('20');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', {timeout: 240_000});
    await reader.locator('#pdf-document-translation-view-compare').click();
    await reader.screenshot({path: testInfo.outputPath('real-bilingual.png')});
    await reader.locator('#pdf-document-translation-view-reading').click();
    await reader.screenshot({path: testInfo.outputPath('real-reading.png')});
    report.blocks = await reader.evaluate(async () => {
      const stored = await (globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1');
      return stored.pdfDocumentTranslationSessionsV1?.flatMap((session: any) => session.blocks.map((block: any) => ({
        page: block.pageNumber, status: block.status, translatedText: block.translatedText,
        formulaReviewMessage: block.formulaReviewMessage, visualFallbackMessage: block.visualFallbackMessage,
        formulaDocument: block.formulaDocument,
      })));
    });
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const row = options.locator('#retained-document-library .library-entry').first();
    await expect(row).toBeVisible();
    await row.locator('.library-menu > summary').click();
    await row.getByRole('button', {name: '重命名', exact: true}).click();
    await row.getByRole('textbox').fill('HATNet · 真实验收');
    await row.getByRole('button', {name: '保存名称'}).click();
    await expect(row.locator('.library-title')).toHaveText('HATNet · 真实验收');
    await row.locator('.library-menu > summary').click();
    const download = options.waitForEvent('download');
    await row.getByRole('button', {name: '导出 Markdown'}).click();
    const exported = await download;
    await exported.saveAs(testInfo.outputPath('real-retained-translation.md'));
    const markdown = await readFile(testInfo.outputPath('real-retained-translation.md'), 'utf8');
    expect(markdown).toMatch(/\p{Script=Han}/u);
    await options.screenshot({path: testInfo.outputPath('real-library.png')});
    report.libraryExported = true;
    report.usage = await reader.locator('#pdf-document-request-usage').textContent();
    await reader.locator('#pdf-document-translation-close').click();
    await reader.locator('#page-number').fill('5'); await reader.locator('#page-number').press('Enter');
    const span = reader.locator('.pdf-page[data-page-number="5"] .textLayer span').filter({hasText: 'In the proposed HATNet'}).first();
    await expect(span).toBeVisible();
    await span.evaluate(element => {const selection = getSelection()!;const range = document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));});
    const overlay = reader.locator('#tex-selection-translator-root');
    await overlay.locator('.trigger').click();
    await expect(overlay.getByRole('button', {name: '标记原文，悬停查看译文'})).toBeEnabled({timeout: 60_000});
    await overlay.getByRole('button', {name: '标记原文，悬停查看译文'}).click();
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', {name: '查看本文标记（1）'}).click();
    await overlay.locator('.marker-note-more > summary').click();
    await overlay.getByRole('button', {name: '编辑这条标记的出处和笔记'}).click();
    await overlay.getByRole('textbox', {name: '来源链接（可选）'}).fill('https://openaccess.thecvf.com/content/CVPR2024/papers/Qu_Dual-Scale_Transformer_for_Large-Scale_Single-Pixel_Imaging_CVPR_2024_paper.pdf');
    await overlay.getByRole('button', {name: '保存这条标记的出处和笔记'}).click();
    await overlay.getByRole('button', {name: '复制这条标记'}).click();
    const excerpt = await reader.evaluate(() => (globalThis as any).__liveClipboard as string);
    expect(excerpt).toContain('openaccess.thecvf.com'); expect(excerpt).toContain('5'); expect(excerpt).toMatch(/\p{Script=Han}/u);
    await writeFile(testInfo.outputPath('real-source-excerpt.md'), excerpt);
    report.excerptCopied = true;
  } finally {
    report.finalSnapshot = await reader.evaluate(async () => (await (globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1).catch(() => undefined);
    report.finalStatus = await reader.locator('#pdf-document-translation-status').textContent().catch(() => 'page closed');
    await writeFile(testInfo.outputPath('live-report.json'), JSON.stringify(report, null, 2).replaceAll(apiKey, '[redacted]'));
    await reader.close(); await options.close();
  }
});
