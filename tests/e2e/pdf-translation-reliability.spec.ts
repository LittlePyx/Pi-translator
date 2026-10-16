import { readFile } from 'node:fs/promises';
import { context, createMultilineTextPdf, expect, extensionId, installEdgeExtensionHooks, test } from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const endpoint = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
const lines = [
  'The proposed method combines local observations with a global',
  'representation to predict outputs at previously unseen locations.',
  'We evaluate the energy E = mc^2 under the same conditions.',
];
const recognizedText = lines.join(' ').replace('E = mc^2', '$E=mc^2$');

for (const scenario of ['echo', 'short', 'mixed', 'truncated'] as const) {
  test(`keeps ${scenario} output explicitly unresolved through restore and export without automatic paid retries`, async ({}, info) => {
    const reader = await context.newPage(); let requests = 0;
    await reader.addInitScript(() => Object.defineProperty(File.prototype, 'lastModified', { get: () => 1_700_000_000_000 }));
    const candidate = scenario === 'echo' ? recognizedText : scenario === 'short' ? '模型如下。$E=mc^2$'
      : scenario === 'mixed' ? `该方法结合局部观测和全局表示进行预测。${recognizedText}`
        : '该方法结合局部观测和全局表示，预测此前未观测位置的输出。$E=mc^2$';
    await context.route(endpoint, async route => {
      requests++;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{
        finish_reason: scenario === 'truncated' ? 'length' : 'stop',
        message: { content: JSON.stringify({ recognizedText, translation: candidate, formulaLatex: ['E=mc^2'], uncertainSpans: [] }) },
      }] }) });
    });
    const file = { name: `演示文本-reliability-${scenario}.pdf`, mimeType: 'application/pdf',
      buffer: createMultilineTextPdf(lines, { fontSize: 12, lineStep: 17 }) };
    try {
      await reader.setViewportSize({ width: 1250, height: 920 });
      await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
      await reader.locator('#file-input').setInputFiles(file);
      await reader.locator('#translate-document').click();
      await reader.locator('#pdf-document-translation-primary').click();
      if (scenario === 'truncated') {
        await expect(reader.locator('#pdf-document-translation-status')).toContainText('输出长度上限');
        await expect(reader.locator('.pdf-document-translation-block[data-status="done"]')).toHaveCount(0);
      } else {
        const block = reader.locator(`.pdf-document-translation-block[data-translation-mode="${scenario === 'echo' ? 'preserved' : 'review'}"]`);
        await expect(block).toHaveCount(1);
        await expect(block).toContainText(scenario === 'echo' ? '与原文相同' : scenario === 'short' ? '正文译文较短' : '局部漏译');
        if (scenario !== 'echo') {
          await expect(block).toHaveAttribute('data-review-draft', '');
          await expect(block.locator('.pdf-formula-review-content')).toHaveText(candidate);
          await expect(block.locator('math')).toHaveCount(0);
        }
        await reader.reload(); await reader.locator('#file-input').setInputFiles(file);
        await reader.locator('#translate-document').click();
        await expect(block).toHaveCount(1);
        await expect(block).toContainText(scenario === 'echo' ? '与原文相同' : scenario === 'short' ? '正文译文较短' : '局部漏译');
        await reader.locator('#pdf-document-translation-copy-menu > summary').click();
        const downloaded = reader.waitForEvent('download');
        await reader.locator('#pdf-document-translation-download-translation').click();
        const download = await downloaded;
        const markdown = await readFile((await download.path())!, 'utf8');
        expect(markdown).toContain(scenario === 'echo' ? '本段保留原文' : '待核对译文（非最终结果）');
        if (scenario !== 'echo') expect(markdown).toContain(candidate);
        await reader.setViewportSize({ width: 360, height: 820 });
        await reader.locator('#pdf-document-translation-view-reading').click();
        await expect.poll(() => reader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await reader.screenshot({ path: info.outputPath(`${scenario}-360.png`) });
      }
      expect(requests).toBe(1);
    } finally { await reader.close(); await context.unroute(endpoint); }
  });
}
