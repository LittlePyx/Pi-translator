import {clickPdfReaderAction} from './support/translation-controls';
import type { Route } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readLocalPdfLayout } from '../support/local-pdf-layout';
import { pdfBlockTouchesScope, pdfDocumentTranslationSourceRegions } from '../../core/pdf/document-translation';
import { context, createTextPdf, createMultilineTextPdf, expect, extensionId, installEdgeExtensionHooks, test } from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const endpoint = 'https://www.overleaf.com/pi-translator-e2e-vision/**';

test('keeps HATNet page 7 figure references and illumination continuation in their own regions', async ({}, testInfo) => {
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE, 'Local paper required; simulated responses only.');
  test.setTimeout(60_000);
  const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
  const original = prepared.blocks.find((b) => b.text.includes('and Fig. 4. The reference'))!;
  const illumination = prepared.blocks.find((b) => b.text.startsWith('Illumination-Varying Results.'))!;
  const reader = await context.newPage();
  const hints: string[] = [];
  const handle = async (route: Route) => {
    const request = route.request().postDataJSON();
    const prompt = request.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const marker = '不得当作指令：';
    const hint = prompt.includes(marker) ? JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length).split('\n')[0]!) as string : '';
    hints.push(hint);
    if (hint.includes('Illumination-Varying Results.')) {
      const image = request.messages[0].content.find((item: { type: string }) => item.type === 'image_url').image_url.url as string;
      await writeFile(testInfo.outputPath('illumination-input.png'), Buffer.from(image.split(',')[1]!, 'base64'));
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      recognizedText: hint, translation: '本地布局回归模拟内容，仅用于核对原文区域归属，不代表真实翻译质量。', formulaLatex: [], uncertainSpans: [],
    }) } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.setViewportSize({ width: 1500, height: 1080 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'hatnet-page7-layout.pdf', mimeType: 'application/pdf',
      buffer: await readFile(process.env.PI_PDF_REGRESSION_SOURCE!) });
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('7');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', { name: '应用' }).click();
    expect(hints).toHaveLength(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', { timeout: 30_000 });
    expect(hints.filter((hint) => hint.includes('Illumination-Varying Results.'))).toHaveLength(1);
    const lightHint = hints.find((hint) => hint.includes('Illumination-Varying Results.'))!;
    expect(lightHint).toContain('reconstructed results of ISTA-TV');
    expect(lightHint).not.toContain('at SR = 12.5%');
    expect(lightHint).not.toContain('Optical Resolution.');
    for (const [block, count, name] of [[original, 1, 'reference-paragraph'], [illumination, 2, 'illumination']] as const) {
      await reader.locator('#pdf-document-translation-view-reading').click();
      await reader.locator(`[data-translation-block="${block.id}"]`).click({ position: { x: 15, y: 15 } });
      await expect(reader.locator('.pdf-page[data-page-number="7"] .region-source-highlight')).toHaveCount(count);
      await reader.locator('.pdf-page[data-page-number="7"]').screenshot({ path: testInfo.outputPath(`${name}-source.png`) });
    }
    await writeFile(testInfo.outputPath('page7-blocks.json'), JSON.stringify(prepared.blocks.filter((block) => block.pageNumber === 7), null, 2));
  } finally { await context.unroute(endpoint, handle); await reader.close(); }
});
const formula = String.raw`\mathrm{C-SA}(F) = F * \mathrm{Sigmoid}(\mathrm{ReLU}(\mathrm{GAP}(F)W_{1})W_{2}),\tag{17}`;

test('retains a short equation 15 introduction and records completeness review', async ({}, testInfo) => {
  const reader = await context.newPage();
  let requests = 0;
  let repairRequests = 0;
  const handle = async (route: Route) => {
    if (!Array.isArray(route.request().postDataJSON().messages[0].content)) {
      repairRequests += 1;
      await route.fulfill({ status: 422, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Local regression: prose repair rejected.' } }) });
      return;
    }
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ formulaFormat: 'refs-v1',
        recognizedText: 'For each head, the high-frequency output is calculated by {{m1}}.',
        translation: '计算如下：{{m1}}', uncertainSpans: [],
        formulas: [{ id: 'm1', display: true, uncertain: false,
          latex: String.raw`E=\mathrm{softmax}(QK/\sqrt{d})V\tag{15}` }],
      }),
    } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'short-equation15.pdf', mimeType: 'application/pdf',
      buffer: createMultilineTextPdf(['For each head, the high-frequency output is calculated by:',
        'E = softmax(QK/d)V (15)'], { fontSize: 12, lineStep: 17 }) });
    await reader.locator('#translate-document').click();
    expect(requests).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();
    const block = reader.locator('.pdf-document-translation-block[data-translation-mode="review"]');
    await expect(block).toHaveCount(1);
    await expect(block).toContainText('计算如下');
    await expect(block).toContainText('正文译文较短');
    await expect(block.locator('.pi-equation-tag')).toHaveText('(15)');
    await expect(block.locator('.pdf-formula-review-content')).not.toContainText('For each head');
    await block.screenshot({ path: testInfo.outputPath('short-equation15-retained.png') });
    expect(requests).toBe(1);
    expect(repairRequests).toBe(1);
  } finally { await context.unroute(endpoint, handle); await reader.close(); }
});

function formulaRegistryFixture(review: boolean) {
  // Local fixture only, not an actual model response. Preserve the source's
  // repeated h in the two sets and superscript W in the following prose.
  const latex = [String.raw`\mathbf{E}^h\in\mathbb{R}^{H\times W\times C_1}`, String.raw`\mathbf{E}^l\in\mathbb{R}^{H\times W\times C_2}`,
    String.raw`\{\bar{\mathbf{E}}_i^h\}_{i=1}^{m}`, String.raw`\{\bar{\mathbf{E}}_i^h\}_{i=1}^{m}`,
    String.raw`\mathbf{E}^h\in\mathbb{R}^{H\times W\times C_1}`, String.raw`\mathbf{E}^l\in\mathbb{R}^{H\times W\times C_2}`,
    String.raw`\mathrm{S-SA}(\mathbf{F})=\mathrm{Concat}(\mathbf{E}^h\mathbf{W}_h,\mathbf{E}^l\mathbf{W}_l)\tag{16}`,
    String.raw`\mathbf{W}^h\in\mathbb{R}^{C_1\times C_1}`, String.raw`\mathbf{W}^l\in\mathbb{R}^{C_2\times C_2}`,
    String.raw`\mathrm{Concat}`];
  return { formulaFormat: 'refs-v1', formulas: latex.map((latex, index) => ({
    id: `m${index + 1}`, latex, display: index === 6, uncertain: review && index === 8,
  })), recognizedText: 'High-frequency feature {{m1}} and low-frequency feature {{m2}} can be obtained by reshaping and concatenating {{m3}} and {{m4}} separately. Fuse {{m5}} and {{m6}}: {{m7}}. Matrices {{m8}} and {{m9}} are learnable; {{m10}} denotes concatenation.',
  translation: '通过分别对 {{m3}} 和 {{m4}} 进行重塑和拼接，得到高频特征 {{m1}} 和低频特征 {{m2}}。最终输出由 {{m5}} 和 {{m6}} 融合得到：{{m7}}。其中 {{m8}} 和 {{m9}} 是可学习的投影矩阵，{{m10}} 表示通道拼接。', uncertainSpans: [] };
}

for (const draft of [false, true]) {
test(`retains ${draft ? 'draft' : 'prose'} with local formula review, exports it, restores it, and retries only on click`, async ({}, testInfo) => {
  const reader = await context.newPage();
  // Browser-created test file payloads otherwise get a new timestamp on every
  // upload, unlike reopening the same real file from disk.
  await reader.addInitScript(() => {
    Object.defineProperty(File.prototype, 'lastModified', { get: () => 1_700_000_000_000 });
  });
  let requests = 0;
  const prose = '高频与低频特征分别经过投影后融合，得到最终输出。';
  const candidate = `${prose}${draft ? '高频特征 Eh ∈ RH×W×C1，通道收缩参数为 β。' : ''}\\[x=y\\]\\[z=w\\]其中两个矩阵是可学习的投影矩阵。`;
  const handle = async (route: Route) => {
    requests += 1;
    if (requests === 2) {
      await route.fulfill({ status: 401, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Local regression: retry rejected.' } }) });
      return;
    }
    const recovered = requests > 1;
    const recoveredLatex = String.raw`x=y\tag{16}`;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ recognizedText: recovered ? `\\[${recoveredLatex}\\]` : draft ? String.raw`\[u=v\]` : String.raw`\[x=y\]`,
        translation: recovered ? `${prose}\\[${recoveredLatex}\\]` : candidate,
        formulaLatex: [recovered ? recoveredLatex : 'x=y'], uncertainSpans: [] }),
    } }] }) });
  };
  await context.route(endpoint, handle);
  const file = { name: `formula-review-${draft ? 'draft' : 'prose'}.pdf`, mimeType: 'application/pdf', buffer: createMultilineTextPdf([
    'As a result, the final output is obtained as:',
    'S-SA(F) = Concat(EhWh, ElWl), (16)',
    'where the projection matrices are learnable.',
  ], { fontSize: 12, lineStep: 17 }) };
  try {
    await reader.setViewportSize({ width: 1400, height: 920 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    expect(requests).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();
    const block = reader.locator('.pdf-document-translation-block[data-translation-mode="review"]');
    await expect(block).toHaveCount(1);
    await expect(block).toContainText(prose);
    await expect(block).toContainText(draft ? '待核对译文' : '公式待核对');
    if (draft) {
      await expect(block).toHaveAttribute('data-review-draft', '');
      await expect(block.locator('.pdf-formula-review-content')).toHaveText(candidate);
    }
    await expect(block.locator('.pi-math')).toHaveCount(draft ? 0 : 1);
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('1 段译文待核对');
    const countBeforeLocalActions = requests;
    await expect(block.locator('details')).toHaveAttribute('open', '');
    await expect(block.locator('img')).toBeVisible();
    await expect.poll(() => block.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await reader.screenshot({ path: testInfo.outputPath('formula-review-expanded.png') });
    for (const format of ['translation', 'bilingual', 'html']) {
      await reader.locator('#pdf-document-translation-copy-menu > summary').click();
      const downloading = reader.waitForEvent('download');
      await reader.locator(`#pdf-document-translation-download-${format}`).click();
      const downloaded = await downloading;
      const content = await readFile((await downloaded.path())!, 'utf8');
      expect(content).toContain(prose);
      expect(content).toContain(draft ? '待核对译文（非最终结果）' : '公式待核对');
      if (draft) {
        expect(content).toContain('z=w');
        if (format === 'html') expect(content).not.toContain('class="pi-math ');
      } else expect(content).not.toContain('z=w');
      if (format === 'bilingual') expect(content).toMatch(/!\[原 PDF 第 1 页含公式原文截图\]\(data:image\//u);
    }
    if (draft) {
      await reader.locator('#pdf-document-translation-copy-menu > summary').click();
      const opened = context.waitForEvent('page');
      await reader.locator('#pdf-document-translation-print-layout').click();
      const preview = await opened;
      try {
        await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true');
        const translationPage = preview.locator('[data-layout-translation-page="1"]');
        await expect(translationPage).toContainText('待核对译文（非最终结果）');
        await expect(translationPage).toContainText(prose);
        await expect(translationPage.locator('.pi-math')).toHaveCount(0);
        await translationPage.screenshot({ path: testInfo.outputPath('formula-review-draft-print.png') });
      } finally { await preview.close(); }
    }
    expect(requests).toBe(countBeforeLocalActions);
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await expect(block).toContainText(prose);
    await expect(block).toContainText(draft ? '待核对译文' : '公式待核对');
    if (draft) await expect(block).toHaveAttribute('data-review-draft', '');
    expect(requests).toBe(countBeforeLocalActions);
    await reader.setViewportSize({ width: 680, height: 820 });
    await reader.locator('#pdf-document-translation-view-reading').click();
    await reader.screenshot({ path: testInfo.outputPath('formula-review-narrow.png') });
    await block.getByRole('button', { name: '重试本段' }).click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('本段重试未完成');
    await expect(block).toContainText(prose);
    expect(requests).toBe(countBeforeLocalActions + 1);
    await block.getByRole('button', { name: '重试本段' }).click();
    const success = reader.locator('.pdf-document-translation-block[data-translation-mode="vision"]');
    await expect(success).toContainText(prose);
    await expect(success.locator('.pi-math')).toHaveCount(1);
    await expect(success).not.toContainText('公式待核对');
    await expect(success).not.toHaveAttribute('data-review-draft');
    expect(requests).toBe(countBeforeLocalActions + 2);
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});
}

for (const review of [false, true]) {
test(`renders ten registry formulas with review=${review}, survives restore and exports`, async ({}, testInfo) => {
  const reader = await context.newPage();
  await reader.addInitScript(() => Object.defineProperty(File.prototype, 'lastModified', { get: () => 1_700_000_000_001 }));
  let requests = 0;
  const handle = async (route: Route) => {
    requests += 1;
    const prompt = route.request().postDataJSON().messages[0].content[1].text as string;
    expect(prompt).toContain('refs-v1');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(formulaRegistryFixture(review && requests === 1)),
    } }] }) });
  };
  await context.route(endpoint, handle);
  const file = { name: `formula-registry-${review}.pdf`, mimeType: 'application/pdf', buffer: createMultilineTextPdf([
    'As a result, high and low frequency features are fused:',
    'S-SA(F) = Concat(EhWh, ElWl), (16)',
    'where the projection matrices are learnable.',
  ], { fontSize: 12, lineStep: 17 }) };
  try {
    await reader.setViewportSize({ width: 1400, height: 920 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    expect(requests).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();
    const block = reader.locator('.pdf-document-translation-block[data-formula-document]');
    const mathCount = review ? 9 : 10;
    await expect(block).toHaveCount(1);
    await expect(block.locator('math')).toHaveCount(mathCount);
    await expect(block.locator('.pi-math-display')).toHaveCount(1);
    await expect(block.locator('.pi-math-inline')).toHaveCount(mathCount - 1);
    await expect(block.locator('.pi-equation-tag')).toHaveText('(16)');
    await expect(block).not.toContainText('公式见原文');
    await expect(block).not.toContainText('{{m');
    if (review) {
      await expect(block.locator('.pdf-formula-reference-review')).toHaveCount(1);
      await expect(block.locator('img')).toBeVisible();
      await block.locator('summary').click();
      await block.locator('.pdf-formula-reference-review').click();
      await expect(block.locator('img')).toBeVisible();
    }
    await reader.screenshot({ path: testInfo.outputPath(`registry-${review}-wide.png`) });
    for (const format of ['translation', 'bilingual', 'html']) {
      await reader.locator('#pdf-document-translation-copy-menu > summary').click();
      const downloading = reader.waitForEvent('download');
      await reader.locator(`#pdf-document-translation-download-${format}`).click();
      const content = await readFile((await (await downloading).path())!, 'utf8');
      expect(content).not.toContain('{{m');
      expect(content).not.toContain('公式见原文');
      expect(content).toContain('投影矩阵');
      if (format === 'html') expect(content.match(/<math\b/gu)).toHaveLength(mathCount);
      else expect(content).toContain('\\tag{16}');
      if (review) expect(content).toContain('公式待核对');
    }
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();
    const opened = context.waitForEvent('page');
    await reader.locator('#pdf-document-translation-print-layout').click();
    const preview = await opened;
    try {
      await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true');
      await expect(preview.locator('[data-layout-translation-page] math')).toHaveCount(mathCount);
      await preview.locator('[data-layout-translation-page]').first().screenshot({ path: testInfo.outputPath(`registry-${review}-print.png`) });
    } finally { await preview.close(); }
    expect(requests).toBe(1);
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await expect(block.locator('math')).toHaveCount(mathCount);
    expect(requests).toBe(1);
    await reader.setViewportSize({ width: 680, height: 850 });
    await reader.locator('#pdf-document-translation-view-reading').click();
    await reader.screenshot({ path: testInfo.outputPath(`registry-${review}-narrow.png`) });
    if (review) {
      await block.getByRole('button', { name: '重试本段' }).click();
      await expect(block.locator('math')).toHaveCount(10);
      await expect(block.locator('.pdf-formula-reference-review')).toHaveCount(0);
      expect(requests).toBe(2);
    }
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});
}

test('renders equation 17 exactly once with its number aligned on the right', async ({}, testInfo) => {
  const reader = await context.newPage();
  let requests = 0;
  const handle = async (route: Route) => {
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ recognizedText: `\\[${formula}\\]`,
        translation: 'C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (17)',
        formulaLatex: [formula], uncertainSpans: [] }),
    } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.setViewportSize({ width: 1500, height: 900 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'equation17.pdf', mimeType: 'application/pdf',
      buffer: createTextPdf('C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (17)') });
    await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await reader.locator('#translate-document').click();
    expect(requests).toBe(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('已完成 1/1');
    const block = reader.locator('.pdf-document-translation-block[data-status="done"]');
    await expect(block.locator('.pi-math')).toHaveCount(1);
    await expect(block.locator('.pi-equation-tag')).toHaveText('(17)');
    expect(await block.evaluate((element) => Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim())).toBe('');
    await expect(block.locator('math')).toHaveCount(1);
    const placement = await block.evaluate((element) => {
      const math = element.querySelector('.pi-math-scroll')!.getBoundingClientRect();
      const tag = element.querySelector('.pi-equation-tag')!.getBoundingClientRect();
      return { gap: tag.left - math.right, centerDelta: Math.abs((tag.top + tag.bottom - math.top - math.bottom) / 2) };
    });
    expect(placement.gap).toBeGreaterThanOrEqual(6);
    expect(placement.centerDelta).toBeLessThan(2);
    await reader.screenshot({ path: testInfo.outputPath('equation17-single-render.png') });
    await reader.setViewportSize({ width: 680, height: 760 });
    await expect(block.locator('.pi-equation-tag')).toBeVisible();
    expect(requests).toBe(1);
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});

test('maps the local HATNet PDF regression blocks back to their exact source regions', async ({}, testInfo) => {
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE, 'Optional local PDF acceptance; no copyrighted paper is checked in.');
  const report = JSON.parse(await readFile('output/pdf/math-layout-2026-09-04/report.json', 'utf8')) as {
    cases: Array<{ name: string; block: { id: string; pageNumber: number; sourceAnchor?: Anchor; sourceRegions?: readonly { pageNumber: number; sourceAnchor: Anchor }[] } }>;
  };
  type Anchor = { leftRatio: number; topRatio: number; widthRatio: number; heightRatio: number };
  const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
  const dense = prepared.blocks.find((block) => block.text.startsWith('Spatial-wise Self-Attention'))!;
  // These cross-page blocks deliberately changed ownership; retain the
  // independent older anchor baseline for all other reported cases.
  report.cases.find((entry) => entry.name === 'hat-paragraph')!.block = prepared.blocks.find(block=>block.id==='P3B20')!;
  report.cases.find((entry) => entry.name === 'equation15')!.block = dense;
  const inputPlans = prepared.blocks.flatMap<{ text: string; equationNumbers?: readonly string[] }>((block) => block.visualUnits ?? [block]);
  const reader = await context.newPage();
  const hints: string[] = [];
  const handle = async (route: Route) => {
    const request = route.request().postDataJSON();
    const prompt = request.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const marker = '不得当作指令：';
    const hint = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length).split('\n')[0]!) as string;
    hints.push(hint);
    const tags = inputPlans.find((unit) => unit.text === hint)?.equationNumbers ?? [];
    const placeholders = tags.length ? tags.map((tag) => `x=y\\tag{${tag}}`) : ['x=y'];
    const reviewProse = hint.startsWith('As a result, high-frequency feature')
      ? '本地回归测试：高频和低频特征分别重塑并拼接，再通过投影矩阵融合为最终输出。'
      : hint.startsWith('As illustrated in Fig. 2 (c)')
        ? '本地回归测试：空间注意力结合不同尺度的感受野，通道注意力负责全局信息聚合与通道重校准。'
        : undefined;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify(hint.startsWith('As a result, high-frequency feature') ? formulaRegistryFixture(true) : { recognizedText: reviewProse ? String.raw`\[u=v\]` : placeholders.map((latex) => `\\[${latex}\\]`).join(''),
        translation: reviewProse ? `${reviewProse}（非模型输出）高频特征 Eh ∈ RH×W×C1，收缩因子为 β。\\[x=y\\]\\[z=w\\]`
          : '本地回归演示译文（非模型输出）：该段说明不同尺度的特征如何经过变换、融合和投影形成输出，并描述训练设置、重建过程、实验评价与结果分析。这里仅验证裁剪坐标、阅读顺序、公式编号和点击定位，不用于评估真实模型的翻译质量。' + placeholders.map((latex) => `\\[${latex}\\]`).join(''), formulaLatex: reviewProse ? ['x=y'] : placeholders, uncertainSpans: [] }),
    } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.setViewportSize({ width: 1640, height: 1040 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(process.env.PI_PDF_REGRESSION_SOURCE!);
    await expect(reader.locator('#page-count')).toHaveText('11');
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('3-5');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', { name: '应用' }).click();
    expect(hints).toHaveLength(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', { timeout: 30_000 });
    expect(hints.filter((hint) => /p\s*=\s*4/u.test(hint))).toHaveLength(1);
    for (const number of [15, 16, 17]) expect(hints.filter((hint) => hint.includes(`(${number})`))).toHaveLength(1);
    await expect(reader.locator('.pdf-document-translation-block[data-object-role="table"]')).toHaveCount(0);
    await expect(reader.locator('.pdf-document-translation-block[data-translation-mode="review"]')).toHaveCount(2);
    await expect(reader.locator('.pdf-document-translation-block[data-review-draft]')).toHaveCount(1);
    await expect(reader.locator('[data-translation-block="P5B9"] .pi-math')).toHaveCount(9);
    await expect(reader.locator('.pdf-document-translation-block[data-review-draft] .pi-math')).toHaveCount(0);
    for (const entry of report.cases) {
      await reader.locator('#pdf-document-translation-view-reading').click();
      const card = reader.locator(`[data-translation-block="${entry.block.id}"]`);
      // Expanded source images are inside interactive details, not the link.
      if (await card.locator('.pdf-formula-review-content').count()) {
        await card.locator('.pdf-formula-review-content').click({ position: { x: 20, y: 10 } });
      } else await card.click();
      const regions = entry.block.sourceRegions ?? [{ pageNumber: entry.block.pageNumber, sourceAnchor: entry.block.sourceAnchor! }];
      for (const pageNumber of new Set(regions.map((r) => r.pageNumber))) {
      const pageRegions = regions.filter((r) => r.pageNumber === pageNumber);
      const sourcePage = reader.locator(`.pdf-page[data-page-number="${pageNumber}"]`);
      const highlights = sourcePage.locator('.region-source-highlight');
      await expect(highlights).toHaveCount(pageRegions.length);
      const actual = await sourcePage.evaluate((element) => {
        const parent = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('.region-source-highlight')).map((highlight) => {
          const rect = highlight.getBoundingClientRect();
          return { leftRatio: (rect.left - parent.left) / parent.width, topRatio: (rect.top - parent.top) / parent.height,
            widthRatio: rect.width / parent.width, heightRatio: rect.height / parent.height };
        });
      });
      for (const [index, expected] of pageRegions.entries()) for (const key of ['leftRatio', 'topRatio', 'widthRatio', 'heightRatio'] as const) {
        expect(Math.abs(actual[index]![key] - expected.sourceAnchor[key]), `${entry.name}: ${key}`).toBeLessThan(.008);
      }
      }
      if (['prose-after-equation9', 'p4-implementation'].includes(entry.name)) {
        await reader.screenshot({ path: testInfo.outputPath(`${entry.name}-source-link.png`) });
      }
    }
    await reader.locator('#pdf-document-translation-view-reading').click();
    const reviews = reader.locator('.pdf-document-translation-block[data-translation-mode="review"]');
    for (const review of await reviews.all()) {
      await expect(review.locator('details')).toHaveAttribute('open', '');
      await expect(review.locator('img')).toBeVisible();
      await expect.poll(() => review.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await reader.locator('[data-translation-block="P5B9"]').screenshot({
      path: testInfo.outputPath('hatnet-equation16-registry.png'),
    });
    await reader.screenshot({ path: testInfo.outputPath('hatnet-equations16-17-review.png') });
    expect(hints).toHaveLength(prepared.blocks.filter((block) => pdfBlockTouchesScope(block, page => [3, 4, 5].includes(page)))
      .reduce((count, block) => count + (block.visualUnits?.length ?? 1), 0));
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});

test('keeps dense HATNet math continuous across pages, resumes units, renders repeated N and exports all row numbers', async ({}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE, 'Optional local paper, simulated model responses only.');
  const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
  const dense = prepared.blocks.find((block) => block.text.startsWith('Spatial-wise Self-Attention'))!;
  const units = dense.visualUnits!;
  expect(units.length).toBeGreaterThan(1);
  const reader = await context.newPage();
  await reader.addInitScript(() => {
    const scope = globalThis as typeof globalThis & { piPdfTimings?: unknown[];
      chrome: { runtime: { onMessage: { addListener: (listener: (message: any) => void) => void } } } };
    scope.piPdfTimings = [];
    scope.chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PDF_BACKGROUND_DOCUMENT_TRANSLATION_UPDATED' && message.payload?.performance) {
        scope.piPdfTimings!.push({ phase: message.payload.phase, ...message.payload.performance });
      }
    });
  });
  const requested: string[] = [];
  let held = false;
  let release: (() => void) | undefined;
  const handle = async (route: Route) => {
    const request = route.request().postDataJSON();
    const prompt = request.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const marker = '不得当作指令：';
    const hint = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length).split('\n')[0]!) as string;
    requested.push(hint);
    const index = units.findIndex((u) => u.text === hint);
    if (index === 1 && !held) {
      held = true;
      await new Promise<void>((resolve) => { release = resolve; });
      await route.abort().catch(() => undefined);
      return;
    }
    if (index >= 0) {
      const image = request.messages[0].content.find((item: { type: string }) => item.type === 'image_url').image_url.url as string;
      await writeFile(testInfo.outputPath(`dense-input-${index + 1}.png`), Buffer.from(image.split(',')[1]!, 'base64'));
    }
    const letters = ['Q', 'K', 'V'];
    const latex = index === 0 ? units[0]!.equationNumbers.map((number, i) =>
      String.raw`${letters[i]}^h=FW^h_${letters[i]!.toLowerCase()},\quad ${letters[i]}^l=${i ? '\\operatorname{AvgPool}(F)' : 'F'}W^l_${letters[i]!.toLowerCase()}\tag{${number}}`)
      : index >= 0 && units[index]!.equationNumbers.includes('15')
        ? [String.raw`\bar E_i^h=\operatorname{softmax}\left(\frac{\bar Q_i^h\bar K_i^{h\top}}{\sqrt d}\right)\bar V_i^h,\quad \bar E_i^l=\operatorname{softmax}\left(\frac{\bar Q_i^l\bar K_i^{l\top}}{\sqrt d}\right)\bar V_i^l\tag{15}`]
        : ['N'];
    const refs = latex.map((_, i) => `{{m${i + 1}}}`).join(' ');
    const source = index === 0 ? String.raw`Input dimension R^{H \times W \times C}. The queries, keys and values follow: ${refs}`
      : index >= 0 && !units[index]!.equationNumbers.length ? 'Window {{m1}} and window {{m1}} are partitioned.' : `Output ${refs}`;
    const translation = index === 0 ? String.raw`本地模拟响应（非真实模型）：输入维度 R^{H \times W \times C}，查询、键和值分别为：${refs}`
      : index >= 0 && !units[index]!.equationNumbers.length ? '本地模拟响应：高频窗口大小为 {{m1}}，低频键和值的窗口大小也为 {{m1}}，随后划分为多个头。'
        : `本地模拟响应：注意力输出由下式计算。${refs}`;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      formulaFormat: 'refs-v1', recognizedText: source, translation, formulas: latex.map((value, i) =>
        ({ id: `m${i + 1}`, latex: value, display: value !== 'N', uncertain: false })), uncertainSpans: [],
    }) } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.setViewportSize({ width: 1500, height: 980 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'hatnet-dense-units.pdf', mimeType: 'application/pdf',
      buffer: await readFile(process.env.PI_PDF_REGRESSION_SOURCE!) });
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    const range = reader.locator('#pdf-document-translation-custom-pages');
    const apply = reader.locator('#pdf-document-translation-custom-range').getByRole('button', { name: '应用' });
    await range.fill('5'); await apply.click();
    await expect(reader.locator('#pdf-document-translation-primary')).toBeEnabled();
    await expect(reader.locator('#pdf-document-translation-range-feedback')).toContainText('已自动补齐第 4 页续段');
    expect(requested).toHaveLength(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'paused');
    release?.();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', { timeout: 30_000 });
    expect(requested.filter((hint) => hint === units[0]!.text)).toHaveLength(1);
    expect(requested.filter((hint) => hint === units[1]!.text)).toHaveLength(2);
    const timings = await reader.evaluate(() => (globalThis as typeof globalThis & {
      piPdfTimings: { phase: string; prefetched: number; captures: number; captureWaitMs: number }[];
    }).piPdfTimings);
    const finished = timings.filter((sample) => sample.phase === 'complete').at(-1);
    expect(finished?.prefetched).toBeGreaterThan(0);
    expect(finished?.captures).toBeGreaterThanOrEqual(units.length);
    await writeFile(testInfo.outputPath('capture-timings.json'), JSON.stringify(timings, null, 2));
    const card = reader.locator(`[data-translation-block="${dense.id}"]`);
    await reader.locator('#pdf-document-translation-view-reading').click();
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-translation-mode', 'vision');
    await expect(card).not.toContainText('待核对');
    const plain = await card.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[data-formula-id]').forEach((node) => node.remove());
      return copy.textContent;
    });
    expect(plain).not.toContain(String.raw`R^{H`);
    const ns = card.locator('[data-formula-id]').filter({ has: reader.locator('math annotation').filter({ hasText: /^N$/u }) });
    await expect(ns).toHaveCount(2);
    const occurrences = await ns.evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.formulaOccurrence));
    expect(new Set(occurrences).size).toBe(2);
    for (const number of ['12', '13', '14', '15']) await expect(card.locator('.pi-equation-tag').filter({ hasText: `(${number})` })).toHaveCount(1);
    await card.screenshot({ path: testInfo.outputPath('dense-continuous-translation.png') });
    // Explicitly exercise the delayed fit-width rebuild while returning from
    // reading mode. Highlighting old page nodes must not lose either source.
    await reader.locator('#pdf-document-translation-view-compare').click();
    await clickPdfReaderAction(reader,'fit-width');
    await reader.locator('#pdf-document-translation-view-reading').click();
    await card.click({ position: { x: 15, y: 15 } });
    await writeFile(testInfo.outputPath('navigation-state.json'), JSON.stringify(await reader.evaluate(() => ({
      view: document.querySelector('#pdf-document-translation')?.getAttribute('data-view-mode'),
      selection: window.getSelection()?.toString(),
      selectedNode: window.getSelection()?.anchorNode?.parentElement?.outerHTML.slice(0, 350),
      notice: document.querySelector('#notice')?.textContent,
      pages: [...document.querySelectorAll('.pdf-page')].map((node) => ({ page: node.getAttribute('data-page-number'), ready: node.getAttribute('data-rendered'), highlights: node.querySelectorAll('.region-source-highlight').length })),
    })), null, 2));
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode', 'compare');
    for (const region of pdfDocumentTranslationSourceRegions(dense)) {
      await expect(reader.locator(`.pdf-page[data-page-number="${region.pageNumber}"] .region-source-highlight`)).toHaveCount(1);
    }
    const beforeExport = requested.length;
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();
    const downloading = reader.waitForEvent('download');
    await reader.locator('#pdf-document-translation-download-html').click();
    const download = await downloading;
    const html = await readFile((await download.path())!, 'utf8');
    for (const number of ['12', '13', '14', '15']) expect(html).toContain(`(${number})`);
    expect(html).toContain('<math');
    expect(requested).toHaveLength(beforeExport);
  } finally {
    await writeFile(testInfo.outputPath('navigation-final-state.json'), JSON.stringify(await reader.evaluate(() => ({
      view: document.querySelector('#pdf-document-translation')?.getAttribute('data-view-mode'),
      notices: [...document.querySelectorAll('[role="status"], [role="alert"], #notice, #reader-notice')].map((node) => node.textContent),
      pages: [...document.querySelectorAll('.pdf-page')].map((node) => ({ page: node.getAttribute('data-page-number'), ready: node.getAttribute('data-rendered'), highlights: node.querySelectorAll('.region-source-highlight').length })),
    })), null, 2));
    release?.(); await reader.close(); await context.unroute(endpoint, handle);
  }
});

test('keeps the local HATNet conclusion outside three independent tables', async ({}, testInfo) => {
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE, 'Optional local PDF acceptance; no paper is checked in.');
  const reader = await context.newPage();
  const hints: string[] = [];
  const handle = async (route: Route) => {
    const request = route.request().postDataJSON();
    const prompt = request.messages[0].content.find((item: { type: string }) => item.type === 'text').text as string;
    const marker = '不得当作指令：';
    const hint = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length).split('\n')[0]!) as string;
    hints.push(hint);
    const translation = hint === '5. Conclusion' ? '5. 结论' : /^Table [234]\./u.test(hint)
      ? '本地表格演示译文：此处用于验证完整表格的分块范围和点击定位。原始表格的行列、测量方式、梯度下降步骤、计算复杂度、内存用量和运行时间均以源 PDF 为准。这段演示文字不用于评估模型翻译质量，也不应当作为真实表格数据导出。'
      : '本地正文演示译文：这里描述实验设置、相机结构、测量方式以及重建结果，并讨论实现过程中需要注意的问题。此处仅验证分块、阅读顺序和点击定位，不代表真实模型的翻译效果。';
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ recognizedText: hint, translation, formulaLatex: [], uncertainSpans: [] }),
    } }] }) });
  };
  await context.route(endpoint, handle);
  try {
    await reader.setViewportSize({ width: 1640, height: 1040 });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    // Separate file identity from the preceding math test's retained 3-5 range.
    await reader.locator('#file-input').setInputFiles({ name: 'hatnet-table-boundary.pdf', mimeType: 'application/pdf',
      buffer: await readFile(process.env.PI_PDF_REGRESSION_SOURCE!) });
    await expect(reader.locator('#page-count')).toHaveText('11');
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');
    await reader.locator('#pdf-document-translation-custom-pages').fill('8');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button', { name: '应用' }).click();
    expect(hints).toHaveLength(0);
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete', { timeout: 30_000 });
    const tableCards = reader.locator('.pdf-document-translation-block[data-object-role="table"]');
    await expect(tableCards).toHaveCount(3);
    for (const number of [2, 3, 4]) {
      const owned = hints.filter((hint) => hint.includes(`Table ${number}.`));
      expect(owned).toHaveLength(1);
      expect(owned[0]).toMatch(new RegExp(`^Table ${number}\\.`));
      expect(owned[0]).not.toContain('5. Conclusion');
      expect(owned[0]!.match(/Table [234]\./gu)).toHaveLength(1);
    }
    expect(hints.filter((hint) => hint === '5. Conclusion')).toHaveLength(1);
    expect(hints.filter((hint) => hint.startsWith('Towards real-world SPI cameras'))).toHaveLength(1);
    const sourcePage = reader.locator('.pdf-page[data-page-number="8"]');
    const boxes: Array<{ top: number; bottom: number }> = [];
    for (const card of await tableCards.all()) {
      await reader.locator('#pdf-document-translation-view-reading').click();
      await card.click();
      const highlight = sourcePage.locator('.region-source-highlight');
      await expect(highlight).toHaveCount(1);
      const box = await highlight.evaluate((element) => {
        const parent = element.closest('.pdf-page')!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { top: (rect.top - parent.top) / parent.height, bottom: (rect.bottom - parent.top) / parent.height };
      });
      boxes.push(box);
    }
    expect(boxes[0]!.bottom).toBeLessThanOrEqual(boxes[1]!.top + .002);
    expect(boxes[1]!.bottom).toBeLessThanOrEqual(boxes[2]!.top + .002);
    const headingTop = await sourcePage.locator('.textLayer span').filter({ hasText: /^5\. Conclusion$/u })
      .evaluate((element) => {
        const parent = element.closest('.pdf-page')!.getBoundingClientRect();
        return (element.getBoundingClientRect().top - parent.top) / parent.height;
      });
    expect(boxes[2]!.bottom).toBeLessThan(headingTop);
    await reader.screenshot({ path: testInfo.outputPath('hatnet-table4-source.png') });
    const conclusion = reader.locator('.pdf-document-translation-block').filter({ hasText: /^5\. 结论/u });
    await expect(conclusion).toHaveCount(1);
    expect(await conclusion.evaluate(element=>{
      const copy=element.cloneNode(true) as HTMLElement;copy.querySelectorAll('button').forEach(button=>button.remove());return copy.textContent?.trim();
    })).toBe('5. 结论');
    await expect(conclusion).not.toHaveAttribute('data-object-role', 'table');
    await reader.locator('#pdf-document-translation-view-reading').click();
    await conclusion.click();
    const conclusionBox = await sourcePage.locator('.region-source-highlight').evaluate((element) => {
      const parent = element.closest('.pdf-page')!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return { top: (rect.top - parent.top) / parent.height, bottom: (rect.bottom - parent.top) / parent.height };
    });
    expect(conclusionBox.top).toBeGreaterThan(boxes[2]!.bottom);
    expect(conclusionBox.bottom - conclusionBox.top).toBeLessThan(.035);
    await reader.screenshot({ path: testInfo.outputPath('hatnet-conclusion-source.png') });
    expect(hints).toHaveLength(10);
  } finally { await reader.close(); await context.unroute(endpoint, handle); }
});
