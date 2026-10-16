import type { Route } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { SourceEquation } from '../../core/translation/source-equations';
import { context, expect, extensionId, installEdgeExtensionHooks, test } from './support/edge-extension-fixture';
import { createNumberedPdf } from '../support/numbered-pdf';

installEdgeExtensionHooks();
const endpoint = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
const equations: Record<string, string> = {
  '1': String.raw`y=Ax,`,
  '2': String.raw`\hat{x}=\operatorname*{arg\,min}_x\frac12\|y-Ax\|_2^2+\lambda R(x),`,
  '3': String.raw`z_k=x_{k-1}+\rho A^\top(y-Ax_{k-1}),`,
  '4': String.raw`x_k=\operatorname*{arg\,min}_x\frac{1}{2\sigma^2}\|z_k-x\|_2^2+R(x),`,
  '12': String.raw`Q^h=FW_q^h,\quad Q^l=FW_q^l,`,
  '13': String.raw`K^h=FW_k^h,\quad K^l=\mathrm{AvgPool}(F)W_k^l,`,
  '14': String.raw`V^h=FW_v^h,\quad V^l=\mathrm{AvgPool}(F)W_v^l,`,
  '15': String.raw`\begin{aligned}\bar E_i^h&=\mathrm{softmax}(\frac{\bar Q_i^h\bar K_i^{h\top}}{\sqrt d})\bar V_i^h,\\\bar E_i^l&=\mathrm{softmax}(\frac{\bar Q_i^l\bar K_i^{l\top}}{\sqrt d})\bar V_i^l.\end{aligned}`,
  '16': String.raw`\mathrm{S-SA}(\mathbf F)=\mathrm{Concat}(\mathbf E^h\mathbf W_h,\mathbf E^l\mathbf W_l),`,
  '17': String.raw`\mathrm{C-SA}(F)=F*\mathrm{Sigmoid}(\mathrm{ReLU}(\mathrm{GAP}(F)W_1)W_2),`,
};

test('binds portable PDF equation labels without a local paper or model tags', async () => {
  const reader = await context.newPage();
  await reader.addInitScript(() => { Object.defineProperty(File.prototype, 'lastModified', { get: () => 1_700_000_000_000 }); });
  const sent: SourceEquation[] = [];
  const handle = async (route: Route) => {
    const input = route.request().postDataJSON();
    const prompt = input.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const line = prompt.split('\n').find((item) => item.startsWith('sourceEquations='));
    const rows: SourceEquation[] = line ? JSON.parse(line.slice('sourceEquations='.length)) : [];
    sent.push(...rows);
    const formulas = rows.map((row, index) => ({ id: `m${index + 1}`, latex: row.number === '1' ? 'x=y+z' : 'a=b+c', display: true, sourceEquationId: row.id }));
    const refs = formulas.map((item) => `{{${item.id}}}`).join('\n');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      formulaFormat: 'refs-v1', recognizedText: `The following equations define the updates.\n${refs}`,
      translation: `下列公式定义了两步更新，编号由本地原文提供。\n${refs}`,
      formulas: formulas.reverse(), uncertainSpans: [],
    }) } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'portable-numbering.pdf', mimeType: 'application/pdf',
      buffer: createNumberedPdf() });
    await reader.locator('#translate-document').click();
    expect(sent).toHaveLength(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
    await expect(reader.locator('.pi-equation-tag')).toHaveText(['(1)', '(2)']);
    expect(sent.map((row) => row.number)).toEqual(['1', '2']);
    await reader.reload();
    await reader.locator('#file-input').setInputFiles({ name: 'portable-numbering.pdf', mimeType: 'application/pdf',
      buffer: createNumberedPdf() });
    await reader.locator('#translate-document').click();
    await expect(reader.locator('.pi-equation-tag')).toHaveText(['(1)', '(2)']);
    expect(sent).toHaveLength(2);
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});

for (const conflict of [false, true]) {
test(`binds real HATNet source labels with tag-free simulated replies, conflict=${conflict}`, async ({}, testInfo) => {
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE, 'Local paper required; responses are simulated, never a real model call.');
  test.setTimeout(90_000);
  const reader = await context.newPage();
  await reader.addInitScript(() => { Object.defineProperty(File.prototype, 'lastModified', { get: () => 1_700_000_000_000 }); });
  let requests = 0;
  const sentRows: SourceEquation[] = [];
  const handle = async (route: Route) => {
    requests += 1;
    const input = route.request().postDataJSON();
    const prompt = input.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const line = prompt.split('\n').find((line) => line.startsWith('sourceEquations='));
    const rows = line ? JSON.parse(line.slice('sourceEquations='.length)) as SourceEquation[] : [];
    sentRows.push(...rows);
    const formulas = rows.length ? rows.filter((row) => conflict || row.number !== '4').flatMap((row) => (!conflict && row.number === '3' ? [
      `\\left\\{\\begin{aligned}${equations['3']}\\\\${equations['4']}\\end{aligned}\\right.`,
    ] : row.number === '15' ? [
      String.raw`\bar E_i^h=\mathrm{softmax}(\frac{\bar Q_i^h\bar K_i^{h\top}}{\sqrt d})\bar V_i^h,`,
      String.raw`\bar E_i^l=\mathrm{softmax}(\frac{\bar Q_i^l\bar K_i^{l\top}}{\sqrt d})\bar V_i^l.`,
    ] : [equations[row.number] ?? 'x=y']).map((latex) => ({ display: true, latex,
      sourceEquationId: conflict && row.number === '16' ? 'eq-p99-x1-y1' : row.id })))
      .map((entry, i) => ({ ...entry, id: `m${i + 1}` }))
      : [{ id: 'm1', display: false, latex: 'N' }];
    const refs = formulas.map((entry) => `{{${entry.id}}}`).join('\n');
    // Deliberately reverse the registry and omit EVERY tag. Template order and
    // source identities, not array positions, must determine visible numbers.
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      formulaFormat: 'refs-v1', formulas: formulas.reverse(), recognizedText: refs,
      translation: `本地演示译文：此处描述测量模型、迭代更新和不同尺度的注意力计算过程。测量结果经过梯度下降与可学习变换逐步重建，随后融合高频和低频特征，并对通道信息进行重校准。该文字仅用于检验公式编号、源行身份和布局，不代表真实模型的翻译质量。\n${refs}`, uncertainSpans: [],
    }) } }] }) });
  };
  await context.route(endpoint, handle);
  const file = { name: `hatnet-equation-binding-${conflict}.pdf`, mimeType: 'application/pdf', buffer: await readFile(process.env.PI_PDF_REGRESSION_SOURCE!) };
  try {
    await reader.setViewportSize({ width: 1520, height: 1040 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('2,4-5');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', { name: '应用' }).click();
    expect(requests).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', { timeout: 35_000 });
    await reader.locator('#pdf-document-translation-view-reading').click();
    const card = reader.locator('[data-translation-block="P2B1"]');
    await expect(card).toHaveAttribute('data-translation-mode', 'vision');
    await expect(card.locator('.pi-equation-tag')).toHaveText(['(1)', '(2)', '(3)', '(4)']);
    await expect(card.locator('.pdf-equation-row-group')).toHaveCount(1);
    await expect(card.locator('.pdf-equation-row-group .pi-equation-tag')).toHaveText(['(3)', '(4)']);
    const formula16 = reader.locator('[data-translation-block="P5B9"]');
    const formula15 = reader.locator('[data-source-equation-id]').filter({ has: reader.locator('.pi-equation-tag').filter({ hasText: '(15)' }) });
    await expect(formula15).toHaveCount(1);
    await expect(formula15.locator('annotation')).toContainText('gathered');
    await expect(formula15.locator('annotation')).toContainText(String.raw`\bar E_i^h`);
    await expect(formula15.locator('annotation')).toContainText(String.raw`\bar E_i^l`);
    await formula15.screenshot({ path: testInfo.outputPath('equation15-shared-number.png') });
    await expect(formula16).toHaveAttribute('data-translation-mode', conflict ? 'review' : 'vision');
    if (conflict) {
      await expect(formula16).toContainText('原文公式行无法对应');
      await expect(formula16.locator('details')).toHaveAttribute('open', '');
      await expect(formula16.locator('img')).toBeVisible();
      await expect(formula16.locator('.pi-equation-tag')).toHaveCount(0);
      await formula16.screenshot({ path: testInfo.outputPath('ambiguous-binding-original-fallback.png') });
    } else {
      await expect(formula16.locator('.pi-equation-tag')).toHaveText(['(16)']);
      await formula16.screenshot({ path: testInfo.outputPath('equation16-number-restored.png') });
    }
    await card.screenshot({ path: testInfo.outputPath('equations1-4-numbered.png') });
    const beforeLocal = requests;
    if (!conflict) {
      for (const format of ['translation', 'bilingual', 'html']) {
        await reader.locator('#pdf-document-translation-copy-menu > summary').click();
        const downloading = reader.waitForEvent('download');
        await reader.locator(`#pdf-document-translation-download-${format}`).click();
        const download = await downloading;
        const text = await readFile((await download.path())!, 'utf8');
        for (const number of ['1', '2', '3', '4', '15', '16']) expect(text).toContain(format === 'html' ? `(${number})` : `\\tag{${number}}`);
        if (format !== 'html') expect(text.match(/\\tag\{15\}/gu)).toHaveLength(1);
        await writeFile(testInfo.outputPath(`numbered-export.${format === 'html' ? 'html' : `${format}.md`}`), text);
      }
      await reader.locator('#pdf-document-translation-copy-menu > summary').click();
      const opened = context.waitForEvent('page');
      await reader.locator('#pdf-document-translation-print-layout').click();
      const preview = await opened;
      try {
        await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true');
        const page2 = preview.locator('[data-layout-translation-page="2"]');
        await expect(page2.locator('.pi-equation-tag')).toHaveText(['(1)', '(2)', '(3)', '(4)']);
        await page2.filter({ has: preview.locator('.pi-equation-tag') }).screenshot({ path: testInfo.outputPath('equations1-4-print-layout.png') });
        await preview.pdf({ path: testInfo.outputPath('numbered-print.pdf'), printBackground: true, preferCSSPageSize: true });
      } finally { await preview.close(); }
    }
    await reader.setViewportSize({ width: 680, height: 920 });
    await formula15.screenshot({ path: testInfo.outputPath('equation15-shared-number-narrow.png') });
    await card.screenshot({ path: testInfo.outputPath('equations1-4-narrow.png') });
    const placement = await card.locator('.pi-math-numbered').evaluateAll((nodes) => nodes.map((node) => {
      const math = node.querySelector('.pi-math-scroll')!.getBoundingClientRect(), tag = node.querySelector('.pi-equation-tag')!.getBoundingClientRect();
      return tag.left - math.right;
    }));
    expect(placement.every((gap) => gap >= 6)).toBe(true);
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await expect(card.locator('.pi-equation-tag')).toHaveText(['(1)', '(2)', '(3)', '(4)']);
    await expect(formula15).toHaveCount(1);
    expect(requests).toBe(beforeLocal);
    for (const number of ['1', '2', '3', '4', '12', '13', '14', '15', '16', '17']) expect(sentRows.filter((row) => row.number === number)).toHaveLength(1);
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});
}
