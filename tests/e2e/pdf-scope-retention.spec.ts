import {context, createMultiPageTextPdf, expect, extensionId, installEdgeExtensionHooks, test, textRequests} from './support/edge-extension-fixture';
import {openPdfTranslationOptions} from './support/pdf-controls';

installEdgeExtensionHooks();

test('restores the requested range and processing choices from local retention before resuming', async () => {
  const reader = await context.newPage();
  await reader.addInitScript(() => Object.defineProperty(File.prototype, 'lastModified', {get: () => 1700000000000}));
  const start = textRequests.length;
  const file = {name: '演示文本-恢复范围.pdf', mimeType: 'application/pdf', buffer: createMultiPageTextPdf([
    {text: 'The retained measurement budget is', top: 720},
    {text: 'kept fixed across experiments.'},
    {text: 'The second experiment is evaluated separately.'},
    {text: 'This unrelated page must stay outside the requested task.'},
  ])};
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('2-3');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', {name: '应用'}).click();
    await reader.locator('#pdf-document-translation-multimodal-toggle').uncheck();
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-budget-details > summary').click();
    await reader.locator('#pdf-document-request-limit').fill('1');
    await reader.locator('#pdf-document-trial > summary').click();
    await reader.locator('#pdf-document-trial-start').click();
    await expect(reader.locator('[data-translation-block][data-status="done"]')).toHaveCount(1);
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-translation-retention-toggle').check();
    await expect(reader.locator('#pdf-document-translation-retention-status')).toContainText('已保留到本机');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('请求上限');
    await reader.evaluate(async () => {await (globalThis as any).chrome.storage.session.remove('pdfDocumentTranslationSessionsV1')});
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'paused');
    await expect(reader.locator('#pdf-document-translation-range')).toHaveValue('custom');
    await expect(reader.locator('#pdf-document-translation-custom-pages')).toHaveValue('2,3');
    await expect(reader.locator('#pdf-document-translation-range-feedback')).toContainText('已自动补齐第 1 页续段');
    await expect(reader.locator('#pdf-document-translation-multimodal-toggle')).not.toBeChecked();
    await expect(reader.locator('#pdf-document-request-limit')).toHaveValue('1');
    expect(textRequests).toHaveLength(start + 1);
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-budget-details > summary').click();
    await reader.locator('#pdf-document-request-limit').fill('3');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
    expect(textRequests).toHaveLength(start + 2);
    const messages = textRequests.at(-1)!.messages as Array<{role: string; content: string}>;
    const payload = JSON.parse(messages.find(message => message.role === 'user')!.content);
    expect(payload.segments.map((segment: {text: string}) => segment.text)).toEqual(['The second experiment is evaluated separately.']);
  } finally {await reader.close()}
});
