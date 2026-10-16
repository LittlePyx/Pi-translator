import {context, createMultiPageTextPdf, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

for (const selectedPage of [1, 2]) {
  test(`automatically includes the other half of a prose sentence when selecting page ${selectedPage}`, async ({}, testInfo) => {
    const reader = await context.newPage();
    const textStart = textRequests.length, visionStart = visionRequests.length;
    const firstText = selectedPage === 1 ? 'The measurement budget is' : 'The sampling budget is';
    try {
      await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
      await reader.locator('#file-input').setInputFiles({name: '演示文本-跨页段落.pdf', mimeType: 'application/pdf', buffer: createMultiPageTextPdf([
        {text: firstText, top: 720},
        {text: 'kept fixed across experiments.'},
      ])});
      await reader.locator('#translate-document').click();
      await reader.locator('#pdf-document-translation-range').selectOption('custom');
      await reader.locator('#pdf-document-translation-custom-pages').fill(String(selectedPage));
      await reader.locator('#pdf-document-translation-custom-range').getByRole('button', {name: '应用'}).click();
      await expect(reader.locator('#pdf-document-translation-range-feedback')).toContainText(`已自动补齐第 ${3 - selectedPage} 页续段`);
      await expect(reader.locator('#pdf-document-translation-primary')).toBeEnabled();
      expect(textRequests).toHaveLength(textStart); expect(visionRequests).toHaveLength(visionStart);
      await reader.locator('#pdf-document-translation-primary').click();
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
      expect(textRequests).toHaveLength(textStart + 1); expect(visionRequests).toHaveLength(visionStart);
      const messages = textRequests.at(-1)!.messages as Array<{role: string; content: string}>;
      const payload = JSON.parse(messages.find(message => message.role === 'user')!.content);
      expect(payload.segments.map((segment: {text: string}) => segment.text)).toEqual([`${firstText} kept fixed across experiments.`]);
      await reader.locator('#pdf-document-translation-view-reading').click();
      await expect(reader.locator('[data-translation-block][data-status="done"]')).toHaveCount(1);
      await reader.screenshot({path: testInfo.outputPath(`auto-complete-from-page-${selectedPage}.png`)});
    } finally {await reader.close()}
  });
}
