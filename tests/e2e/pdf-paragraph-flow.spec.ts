import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {context, createMultilineTextPdf, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionBlockSignature, pdfDocumentTranslationSessionDocumentKey, pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';

installEdgeExtensionHooks();
test.use({trace: 'off'});

async function restore(reader: Page, record: any, file: string | {name: string; mimeType: string; buffer: Buffer}) {
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async record => {
    const storage = (globalThis as any).chrome.storage;
    await storage.session.clear();
    await storage.local.set({pdfDocumentTranslationRetainedV1: [record]});
  }, record);
  const id = JSON.stringify(['pdf', record.documentKey, record.targetLanguage, record.sourceLanguage, record.style, record.contentMode]);
  await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);
  await reader.locator('#file-input').setInputFiles(file);
  await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
}

async function exportLayout(reader: Page): Promise<Page> {
  const menu = reader.locator('#pdf-document-translation-copy-menu');
  if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click();
  const popup = context.waitForEvent('page');
  await reader.locator('#pdf-document-translation-print-layout').click();
  const preview = await popup;
  await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true', {timeout: 90_000});
  return preview;
}

async function expectNoClipping(preview: Page) {
  const overflow = await preview.locator('[data-layout-translation-page]').evaluateAll(elements => elements
    .filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
    .map(el => el.getAttribute('data-layout-translation-page')));
  expect(overflow).toEqual([]);
}

test('continues an oversized numbered list between complete items instead of clipping it', async ({}, info) => {
  test.setTimeout(90_000);
  const lines = Array.from({length: 12}, (_, i) => `${i + 1}. A numbered claim is complete.`);
  const buffer = createMultilineTextPdf(lines, {fontSize: 10, lineStep: 16});
  const signatures = lines.map(text => pdfDocumentTranslationSessionBlockSignature(1, text, 0));
  const paragraph = '这是一段用于分页验收的演示文本，说明编号列表在内容较长时应按完整条目跨页排列，并保持正常字号、阅读顺序与段落边界。';
  const record = {documentKey: pdfDocumentTranslationSessionDocumentKey('long-list-layout-fixture'),
    targetLanguage: 'zh-CN', sourceLanguage: 'auto', style: 'academic', contentMode: 'auto',
    behaviorKey: pdfDocumentTranslationSessionBehaviorKey('mock'),
    sourceFingerprint: createHash('sha256').update(buffer).digest('hex'),
    documentSignatures: signatures, activity: 'complete', updatedAt: Date.now(),
    blocks: signatures.map((signature, i) => ({signature, translatedText: `${i + 1}. ${paragraph.repeat(5)}式 $O(n+m)$。`}))};
  const reader = await context.newPage(); let preview: Page | undefined;
  try {
    await restore(reader, record, {name: '演示文本-长列表.pdf', mimeType: 'application/pdf', buffer});
    await expect(reader.locator('.pdf-document-translation-block')).toHaveCount(12);
    preview = await exportLayout(reader);
    await expect(preview.locator('[data-layout-block-id]')).toHaveCount(12);
    expect(await preview.locator('[data-layout-translation-page]').count()).toBeGreaterThan(1);
    await expectNoClipping(preview);
    await expect(preview.locator('.pi-math-inline')).toHaveCount(12);
    expect(await preview.locator('.pi-math-inline').evaluateAll(elements => elements.every(el => getComputedStyle(el).textIndent === '0px'))).toBe(true);
    expect(await preview.locator('[data-layout-block-id]').evaluateAll(elements => elements.map(el => el.textContent!.trim().match(/^\d+/u)![0]))).toEqual(lines.map((_, i) => String(i + 1)));
    await preview.screenshot({path: info.outputPath('long-list-pagination.png')});
    expect(textRequests.length + visionRequests.length).toBe(0);
  } finally {await preview?.close(); await reader.close();}
});

test('keeps a section hierarchy with its following paragraph through correction and every export', async ({}, info) => {
  test.setTimeout(90_000);
  const lines = ['The opening paragraph describes the experiment.', '3. Related research', '3.1. Gaussian Processes',
    'The next paragraph explains related methods.', '1. A CNP is permutation invariant.'];
  const buffer = createMultilineTextPdf(lines, {fontSize: 10, lineStep: 24});
  const signatures = lines.map(text => pdfDocumentTranslationSessionBlockSignature(1, text, 0));
  const sentence = '实验正文描述了数据、模型与评价过程。';
  const targets = [sentence.repeat(60), '3. 相关研究', '3.1. 高斯过程', sentence.repeat(30), '1. CNP 具有置换不变性。'];
  const record = {documentKey: pdfDocumentTranslationSessionDocumentKey('section-layout-fixture'),
    targetLanguage: 'zh-CN', sourceLanguage: 'auto', style: 'academic', contentMode: 'auto',
    behaviorKey: pdfDocumentTranslationSessionBehaviorKey('mock'),
    sourceFingerprint: createHash('sha256').update(buffer).digest('hex'), documentSignatures: signatures,
    activity: 'complete', updatedAt: Date.now(), blocks: signatures.map((signature, i) => ({signature, translatedText: targets[i]}))};
  const reader = await context.newPage(); let preview: Page | undefined;
  try {
    await reader.setViewportSize({width: 1200, height: 900});
    await restore(reader, record, {name: '演示文本-标题层级.pdf', mimeType: 'application/pdf', buffer});
    await reader.locator('#pdf-document-translation-view-reading').click();
    const chapter = reader.locator('[data-heading-level="1"]');
    await expect(chapter.locator('h2')).toHaveText('3. 相关研究');
    await expect(reader.locator('[data-heading-level="2"] h3')).toHaveText('3.1. 高斯过程');
    await expect(reader.locator('[data-list-item][data-heading-level]')).toHaveCount(0);
    await chapter.scrollIntoViewIfNeeded(); await chapter.hover(); await chapter.locator('.pdf-paragraph-edit-action').click();
    await reader.locator('#pdf-paragraph-editor textarea').first().fill('3. 相关研究（修订）');
    await reader.locator('#pdf-paragraph-editor-save').click();
    await expect(chapter.locator('h2')).toHaveText('3. 相关研究（修订）');
    await reader.setViewportSize({width: 300, height: 600});
    await chapter.scrollIntoViewIfNeeded();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await reader.screenshot({path: info.outputPath('heading-reading-narrow.png')});
    await reader.setViewportSize({width: 1200, height: 900});
    for (const [action, name] of [['pdf-document-translation-download-translation', 'translation.md'], ['pdf-document-translation-download-html', 'bilingual.html']]) {
      const menu = reader.locator('#pdf-document-translation-copy-menu');
      if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click();
      const pending = reader.waitForEvent('download'); await reader.locator(`#${action}`).click();
      await (await pending).saveAs(info.outputPath(name!));
      const text = await readFile(info.outputPath(name!), 'utf8');
      expect(text).toContain(name!.endsWith('.md') ? '### 3. 相关研究（修订）' : '<h2 class="document-section-title">3. 相关研究（修订）</h2>');
      if (name!.endsWith('.html')) expect(text).toContain('<h3 class="document-section-title">3.1. Gaussian Processes</h3>');
    }
    preview = await exportLayout(reader);
    await expectNoClipping(preview);
    const lead = preview.locator('[data-layout-block-id="P1B2"]');
    const sectionPage = await lead.evaluate(el => el.closest('[data-layout-translation-page]')!.getAttribute('data-layout-translation-sequence'));
    for (const id of ['P1B3', 'P1B4']) expect(await preview.locator(`[data-layout-block-id="${id}"]`).evaluate(el => el.closest('[data-layout-translation-page]')!.getAttribute('data-layout-translation-sequence'))).toBe(sectionPage);
    expect(sectionPage).not.toBeNull(); // The complete section lead moved off the nearly full first page.
    await expect(preview.locator('[data-layout-list] [data-heading-level]')).toHaveCount(0);
    await preview.locator('[data-layout-translation-page]').last().screenshot({path: info.outputPath('heading-print.png')});
    expect(textRequests.length + visionRequests.length).toBe(0);
  } finally {await preview?.close(); await reader.close();}
});

test('reads and exports the complete CNP list without fragment labels or lost formulas', async ({}, info) => {
  test.skip(process.env.PI_CNP_PARAGRAPH_REPLAY !== '1', 'Local public-paper layout replay; no new model requests.');
  test.setTimeout(180_000);
  const checkpoint = JSON.parse(await readFile(path.resolve('output/pdf/paragraph-flow-2026-10-15/layout-replay-checkpoint.json'), 'utf8'));
  const root = path.resolve(process.env.PI_PDF_PRESENTATION_OUTPUT ?? 'output/pdf/paragraph-flow-2026-10-15');
  await mkdir(root, {recursive: true});
  const record = checkpoint.retained[0];
  const reader = await context.newPage(); let preview: Page | undefined;
  try {
    await reader.setViewportSize({width: 1350, height: 960});
    await reader.emulateMedia({reducedMotion: 'reduce'});
    await restore(reader, record, path.resolve('output/pdf/live-workflow-2026-10-15/source/conditional-neural-processes.pdf'));
    await expect(reader.locator('.pdf-document-translation-block')).toHaveCount(129);
    const first = reader.locator('[data-translation-block="P3B18"]');
    await expect(first).toContainText('CNP 是函数上的条件分布');
    await expect(first).toContainText('经验条件分布');
    await expect(first).toHaveAttribute('data-list-item', '');
    await expect(reader.locator('[data-translation-block="P3B19"]')).toHaveCount(0);
    await reader.locator('#pdf-document-translation-view-reading').click();
    await expect(reader.locator('[data-translation-block="P3B23"] > h2')).toHaveText('3. 相关研究');
    await expect(reader.locator('[data-translation-block="P3B24"] > h3')).toHaveText('3.1. 高斯过程');
    await expect(reader.locator('[data-translation-block="P5B9"] > h4')).toBeVisible();
    await expect(first.locator('h2,h3,h4')).toHaveCount(0);
    await reader.locator('[data-translation-block="P3B23"]').scrollIntoViewIfNeeded();
    await reader.screenshot({path: info.outputPath('cnp-heading-reading.png')});
    await first.scrollIntoViewIfNeeded();
    await reader.screenshot({path: info.outputPath('cnp-reading.png')});
    await reader.setViewportSize({width: 360, height: 800});
    await first.scrollIntoViewIfNeeded();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await reader.screenshot({path: info.outputPath('cnp-reading-narrow.png')});
    await reader.setViewportSize({width: 1350, height: 960});
    preview = await exportLayout(reader);
    await expect(preview.locator('[data-layout-block-id]')).toHaveCount(129);
    await expect(preview.locator('[data-layout-source-page]')).toHaveCount(10);
    const group = preview.locator('[data-layout-list]').filter({has: preview.locator('[data-layout-block-id="P3B18"]')});
    await expect(group.locator('[data-layout-block-id]')).toHaveCount(3);
    await expect(group.locator('strong,small')).toHaveCount(0);
    await expect(group).toContainText('经验条件分布');
    const style = await group.locator('article').first().evaluate(el => ({
      border: getComputedStyle(el).borderLeftWidth, font: parseFloat(getComputedStyle(el).fontSize), margin: parseFloat(getComputedStyle(el).marginBottom),
    }));
    expect(style.border).toBe('0px'); expect(style.font).toBeGreaterThanOrEqual(14); expect(style.margin).toBeLessThan(8);
    expect(await group.locator('.pi-math-inline').evaluateAll(elements => elements.map(el => getComputedStyle(el).textIndent))).toEqual(
      Array(await group.locator('.pi-math-inline').count()).fill('0px'));
    await group.screenshot({path: info.outputPath('cnp-list-after.png')});
    const chapter = preview.locator('[data-layout-block-id="P3B23"]');
    await expect(chapter.locator('h2')).toHaveText('3. 相关研究');
    await expect(preview.locator('[data-layout-block-id="P3B24"] h3')).toHaveText('3.1. 高斯过程');
    const headingClip = await preview.locator('[data-layout-block-id="P3B23"], [data-layout-block-id="P3B24"], [data-layout-block-id="P3B25"]').evaluateAll(elements => {
      const boxes = elements.map(el => el.getBoundingClientRect());
      const x = Math.min(...boxes.map(r => r.left)), y = Math.min(...boxes.map(r => r.top));
      return {x: x + scrollX, y: y + scrollY, width: Math.max(...boxes.map(r => r.right)) - x, height: Math.max(...boxes.map(r => r.bottom)) - y};
    });
    await preview.screenshot({path: path.join(root, '标题层级-修正后.png'), fullPage: true, clip: headingClip});
    await preview.emulateMedia({media: 'print'});
    await expectNoClipping(preview);
    for (const number of ['1', '2', '3', '4']) await expect(preview.locator('.pi-equation-tag').filter({hasText: new RegExp(`^\\(${number}\\)$`, 'u')})).toHaveCount(1);
    const annotations = await preview.locator('math annotation').allTextContents();
    expect(annotations.some(text => text.includes('mathbb{R}'))).toBe(true);
    expect(annotations.some(text => text.includes('mathcal{L}'))).toBe(true);
    await writeFile(path.join(root, '原页对照-段落修正.html'), await preview.content());
    const client = await context.newCDPSession(preview);
    const pdf = await client.send('Page.printToPDF', {printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false});
    await writeFile(path.join(root, '原页对照-段落修正.pdf'), Buffer.from(pdf.data, 'base64'));
    await writeFile(path.join(root, '段落列表-修正后.png'), await group.screenshot());
    expect(textRequests.length + visionRequests.length).toBe(0);
    await writeFile(info.outputPath('layout-review.json'), JSON.stringify({evidence: checkpoint.evidence, blocks: 129,
      sourcePages: 10, translationPages: await preview.locator('[data-layout-translation-page]').count(),
      listItems: 3, noClipping: true, equationNumbers: ['1', '2', '3', '4'], fontsRetained: true, modelRequests: 0}, null, 2));
  } finally {await preview?.close(); await reader.close();}
});
