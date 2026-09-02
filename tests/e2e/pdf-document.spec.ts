import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  context,
  createCaptionedTableAndTextPdf,
  createFileDataTransfer,
  createLinkedPdf,
  createMultilineTextPdf,
  createMultiPageTextPdf,
  createOutlinedPdf,
  createRasterPdf,
  createTableTextPdf,
  createTextPdf,
  createTwoColumnTextPdf,
  createTwoPageTextPdf,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  mockControl,
  page,
  replaceStoredApiKeys,
  test,
  textRequests,
  visionRequests,
  waitForVisibleBoundingBox,
  type TestChromeApi,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('promotes the current PDF action in the quick popup', async () => {
  const sourceUrl = 'https://www.overleaf.com/popup-primary-action.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Contextual popup primary action.'),
    });
  });
  const nativePdfPage = await context.newPage();
  let popup: Page | undefined;
  try {
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await nativePdfPage.bringToFront();
    await popup.reload();

    const quickActions = popup.locator('#quick-actions');
    const openPdf = popup.locator('#open-pdf');
    const openSidebar = popup.locator('#open-sidebar');
    await expect(quickActions).toHaveAttribute('data-primary', 'pdf');
    await expect(quickActions.locator('button').first()).toHaveAttribute('id', 'open-pdf');
    await expect(openPdf).toHaveClass(/primary-action/);
    await expect(openPdf).toHaveText('用 Pi 打开当前 PDF');
    await expect(openSidebar).toHaveClass(/secondary-action/);
    await expect(openSidebar).toHaveText('打开翻译侧栏');
    await expect(popup.locator('#open-web-region')).toBeHidden();
    await expect(popup.locator('#open-settings')).toHaveText('完整设置');
    await expect(popup.locator('#site-control')).toBeHidden();
    const layout = await quickActions.evaluate((actions) => ({
      clientWidth: actions.clientWidth,
      scrollWidth: actions.scrollWidth,
      primaryWidth: actions.querySelector<HTMLElement>('.primary-action')
        ?.getBoundingClientRect().width,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.primaryWidth).toBeGreaterThanOrEqual(layout.clientWidth - 1);
  } finally {
    if (popup && !popup.isClosed()) await popup.close();
    await nativePdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('opens the full settings page in a browser tab', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const openSettings = popup.locator('#open-settings');
  await expect(openSettings).toBeVisible();

  const settingsPagePromise = context.waitForEvent('page');
  await openSettings.click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForURL(`chrome-extension://${extensionId}/options.html`);
  const settingsUrl = new URL(settingsPage.url());
  expect(settingsUrl.protocol).toBe('chrome-extension:');
  expect(settingsUrl.host).toBe(extensionId);
  expect(settingsUrl.pathname).toBe('/options.html');

  await settingsPage.close();
  if (!popup.isClosed()) await popup.close();
});

test('opens the PDF reader from the quick popup', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const pdfPagePromise = context.waitForEvent('page');
  await popup.locator('#open-pdf').click();
  const pdfPage = await pdfPagePromise;
  await pdfPage.waitForURL(`chrome-extension://${extensionId}/pdf.html`);
  expect(new URL(pdfPage.url()).pathname).toBe('/pdf.html');
  await expect(pdfPage.locator('#empty-state')).toBeVisible();
  await pdfPage.close();
  if (!popup.isClosed()) await popup.close();
});

test('loads the PDF runtime only after a document is opened', async () => {
  const pdfPage = await context.newPage();
  const coreRuntimeRequests: string[] = [];
  const runtimeRequests: string[] = [];
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await expect(pdfPage.locator('#empty-state')).toBeVisible();
  const startupResources = await pdfPage.evaluate(() => (
    performance.getEntriesByType('resource').map((entry) => entry.name)
  ));
  expect(runtimeRequests).toHaveLength(0);
  expect(startupResources.some((url) => url.includes('/chunks/pdf_viewer-'))).toBe(false);
  expect(startupResources.some((url) => url.includes('/assets/pdf.worker.'))).toBe(false);
  await pdfPage.route('**/chunks/pdf-*.js', async (route) => {
    coreRuntimeRequests.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await pdfPage.route('**/chunks/pdf_viewer-*.js', async (route) => {
    runtimeRequests.push(route.request().url());
    await route.continue();
  });

  await pdfPage.locator('#file-input').setInputFiles({
    name: 'lazy-runtime.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('The PDF runtime loads on demand.'),
  });
  await expect(pdfPage.locator('#loading')).toHaveAttribute('data-stage', 'runtime');
  await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
  await expect(pdfPage.locator('.textLayer')).toContainText('The PDF runtime loads on demand.');
  expect(coreRuntimeRequests).toHaveLength(1);
  expect(runtimeRequests).toHaveLength(1);
  await pdfPage.close();
});

test('previews and batch-translates a complete PDF in the reader panel', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 980, height: 720 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'full-document-translation.pdf',
      mimeType: 'application/pdf',
      buffer: createTwoPageTextPdf(
        'The first PDF page explains a reliable translation workflow.',
        'The second PDF page preserves the original document for comparison.',
      ),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    const requestsBeforePreview = textRequests.length;
    const visionRequestsBeforePreview = visionRequests.length;
    await pdfPage.locator('#translate-document').click();
    const panel = pdfPage.locator('#pdf-document-translation');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pdf-document-translation-mark img'))
      .toHaveAttribute('src', /brand\/pi_logo\.png$/);
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 2 段，等待确认');
    await expect(pdfPage.locator('#pdf-document-translation-progress')).toBeVisible();
    await expect(pdfPage.locator('#pdf-document-translation-progress'))
      .toHaveAttribute('aria-valuenow', '0');
    await expect(panel.locator('#pdf-document-translation-settings')).toHaveAttribute('open', '');
    expect(textRequests).toHaveLength(requestsBeforePreview);

    mockControl.omitNextDocumentBatchItem = true;
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 2/2');
    await expect(panel).toHaveAttribute('data-phase', 'complete');
    await expect(pdfPage.locator('#pdf-document-translation-progress'))
      .toHaveAttribute('aria-valuenow', '100');
    await expect(panel.locator('.pdf-document-translation-page')).toHaveCount(2);
    await expect(panel.locator('[data-translation-block]')).toHaveCount(2);
    await expect(panel.locator('[data-translation-block]').first()).toContainText('批量生成的学术译文');
    await expect(panel).toHaveAttribute('data-reading-mode', 'current');
    await expect(panel.locator('#pdf-document-translation-view-current'))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open', '');
    await expect(panel.locator('.pdf-document-translation-page:visible')).toHaveCount(1);
    await expect(panel.locator('.pdf-document-translation-page[data-page-number="1"]'))
      .toBeVisible();
    await expect(panel.locator('.pdf-document-translation-page[data-page-number="2"]'))
      .toBeHidden();
    const readingLayout = await panel.evaluate((element) => {
      const reader = element.querySelector<HTMLElement>('#pdf-document-translation-reader')!;
      return {
        panelHeight: element.clientHeight,
        readerHeight: reader.clientHeight,
        scrollWidth: reader.scrollWidth,
        clientWidth: reader.clientWidth,
      };
    });
    expect(readingLayout.readerHeight).toBeGreaterThan(readingLayout.panelHeight * .5);
    expect(readingLayout.scrollWidth).toBeLessThanOrEqual(readingLayout.clientWidth + 1);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await pdfPage.screenshot({
        path: testInfo.outputPath('pdf-full-document-translation-current-page.png'),
        fullPage: false,
      });
    }
    expect(visionRequests).toHaveLength(visionRequestsBeforePreview);
    const requestsBeforeCopy = textRequests.length;
    const visionRequestsBeforeCopy = visionRequests.length;
    await panel.locator('#pdf-document-translation-page-next').click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    await expect(panel.locator('#pdf-document-translation-page-status')).toHaveText('2 / 2');
    await expect(panel.locator('.pdf-document-translation-page[data-page-number="2"]'))
      .toBeVisible();
    await expect(panel.locator('.pdf-document-translation-page[data-page-number="1"]'))
      .toBeHidden();
    await panel.locator('#pdf-document-translation-page-previous').click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('1');
    await panel.locator('#pdf-document-translation-view-continuous').click();
    await expect(panel).toHaveAttribute('data-reading-mode', 'continuous');
    await expect(panel.locator('.pdf-document-translation-page:visible')).toHaveCount(2);
    await expect(panel.locator('.pdf-document-translation-page-navigation')).toBeHidden();
    expect(textRequests).toHaveLength(requestsBeforeCopy);
    expect(visionRequests).toHaveLength(visionRequestsBeforeCopy);
    await pdfPage.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __piCopiedText?: string };
      scope.__piCopiedText = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            scope.__piCopiedText = value;
          },
        },
      });
    });
    const copyMenu = panel.locator('#pdf-document-translation-copy-menu');
    await expect(copyMenu).toBeVisible();
    await copyMenu.locator(':scope > summary').click();
    await panel.locator('#pdf-document-translation-copy-translation').click();
    await expect(panel.locator('#pdf-document-translation-copy-feedback')).toContainText('2 段译文');
    const pureTranslation = await pdfPage.evaluate(() => (
      globalThis as typeof globalThis & { __piCopiedText?: string }
    ).__piCopiedText ?? '');
    expect(pureTranslation).toContain('批量生成的学术译文');
    expect(pureTranslation).not.toContain('The first PDF page explains');
    await copyMenu.locator(':scope > summary').click();
    await panel.locator('#pdf-document-translation-copy-bilingual').click();
    await expect(panel.locator('#pdf-document-translation-copy-feedback'))
      .toContainText('双语 Markdown');
    const bilingualMarkdown = await pdfPage.evaluate(() => (
      globalThis as typeof globalThis & { __piCopiedText?: string }
    ).__piCopiedText ?? '');
    expect(bilingualMarkdown).toContain('## 第 1 页');
    expect(bilingualMarkdown).toContain('The first PDF page explains');
    expect(bilingualMarkdown).toContain('> ');
    await copyMenu.locator(':scope > summary').click();
    const markdownDownloadPromise = pdfPage.waitForEvent('download');
    await panel.locator('#pdf-document-translation-download-translation').click();
    const markdownDownload = await markdownDownloadPromise;
    expect(markdownDownload.suggestedFilename()).toBe('pi-translator-pdf-translation.md');
    const markdownDownloadPath = await markdownDownload.path();
    expect(markdownDownloadPath).toBeTruthy();
    const downloadedMarkdown = (await readFile(markdownDownloadPath!, 'utf8')).replace(/^\uFEFF/u, '');
    expect(downloadedMarkdown).toContain('## 第 1 页');
    expect(downloadedMarkdown).toContain('批量生成的学术译文');
    expect(downloadedMarkdown).not.toContain('The first PDF page explains');
    expect(downloadedMarkdown).not.toContain('full-document-translation.pdf');
    await expect(panel.locator('#pdf-document-translation-copy-feedback'))
      .toContainText('已下载纯译文 Markdown');
    await copyMenu.locator(':scope > summary').click();
    const htmlDownloadPromise = pdfPage.waitForEvent('download');
    await panel.locator('#pdf-document-translation-download-html').click();
    const htmlDownload = await htmlDownloadPromise;
    expect(htmlDownload.suggestedFilename()).toBe('pi-translator-pdf-bilingual.html');
    const htmlDownloadPath = await htmlDownload.path();
    expect(htmlDownloadPath).toBeTruthy();
    const downloadedHtml = await readFile(htmlDownloadPath!, 'utf8');
    expect(downloadedHtml).toContain('data:image/jpeg;base64,');
    expect(downloadedHtml).toContain('原 PDF 第 1 页');
    expect(downloadedHtml).toContain('The first PDF page explains');
    expect(downloadedHtml).toContain('批量生成的学术译文');
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      const exportPreview = await context.newPage();
      await exportPreview.setViewportSize({ width: 1200, height: 800 });
      await exportPreview.setContent(downloadedHtml, { waitUntil: 'load' });
      await exportPreview.screenshot({
        path: testInfo.outputPath('pdf-bilingual-html.png'),
        fullPage: false,
      });
      await exportPreview.close();
    }
    await expect(panel.locator('#pdf-document-translation-copy-feedback'))
      .toContainText('带原页图的可打印 HTML');
    await copyMenu.locator(':scope > summary').click();
    const layoutPreviewPromise = context.waitForEvent('page');
    await panel.locator('#pdf-document-translation-print-layout').click();
    const layoutPreview = await layoutPreviewPromise;
    await expect(layoutPreview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true', {
      timeout: 20_000,
    });
    await expect(layoutPreview.locator('#pi-layout-print')).toHaveText('保存为 PDF…');
    await expect(layoutPreview.locator('[data-layout-source-page]')).toHaveCount(2);
    await expect(layoutPreview.locator('[data-layout-overlay]')).toHaveCount(2);
    await expect(layoutPreview.locator('[data-layout-source-page="1"] .pdf-layout-source'))
      .toHaveAttribute('src', /^data:image\/jpeg;base64,/u);
    await expect(layoutPreview.locator('[data-layout-source-page="1"] [data-layout-overlay]'))
      .toContainText('批量生成的学术译文');
    const layoutGeometry = await layoutPreview.locator('[data-layout-source-page="1"]')
      .evaluate((page) => {
        const overlay = page.querySelector<HTMLElement>('[data-layout-overlay]')!;
        const pageBounds = page.getBoundingClientRect();
        const overlayBounds = overlay.getBoundingClientRect();
        return {
          pageWidth: pageBounds.width,
          pageHeight: pageBounds.height,
          overlayInside: overlayBounds.left >= pageBounds.left &&
            overlayBounds.right <= pageBounds.right &&
            overlayBounds.top >= pageBounds.top &&
            overlayBounds.bottom <= pageBounds.bottom,
          fitted: overlay.dataset.layoutFitted,
        };
      });
    expect(layoutGeometry.pageWidth).toBeGreaterThan(500);
    expect(layoutGeometry.pageHeight).toBeGreaterThan(layoutGeometry.pageWidth);
    expect(layoutGeometry.overlayInside).toBe(true);
    expect(layoutGeometry.fitted).toBe('true');
    await layoutPreview.setViewportSize({ width: 360, height: 700 });
    const narrowLayout = await layoutPreview.locator('.pi-layout-toolbar').evaluate((toolbar) => {
      const button = toolbar.querySelector<HTMLElement>('#pi-layout-print')!;
      return {
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        buttonHeight: button.getBoundingClientRect().height,
      };
    });
    expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth + 1);
    expect(narrowLayout.buttonHeight).toBeGreaterThanOrEqual(36);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await layoutPreview.setViewportSize({ width: 980, height: 900 });
      await layoutPreview.screenshot({
        path: testInfo.outputPath('pdf-layout-translation-preview.png'),
        fullPage: false,
      });
      await layoutPreview.emulateMedia({ media: 'print' });
      await layoutPreview.locator('[data-layout-source-page="1"]').screenshot({
        path: testInfo.outputPath('pdf-layout-translation-print-page.png'),
      });
      await layoutPreview.emulateMedia({ media: 'screen' });
      await layoutPreview.setViewportSize({ width: 360, height: 700 });
      await layoutPreview.screenshot({
        path: testInfo.outputPath('pdf-layout-translation-preview-360.png'),
        fullPage: false,
      });
    }
    await layoutPreview.close();
    expect(textRequests.length).toBe(requestsBeforeCopy);
    expect(visionRequests.length).toBe(visionRequestsBeforeCopy);
    const firstTranslation = panel.locator(
      '.pdf-document-translation-page[data-page-number="1"] [data-source-anchor]',
    );
    const secondTranslation = panel.locator(
      '.pdf-document-translation-page[data-page-number="2"] [data-source-anchor]',
    );
    await expect(firstTranslation).toHaveCount(1);
    await expect(secondTranslation).toHaveCount(1);
    await secondTranslation.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    await expect(pdfPage.locator(
      '.pdf-page[data-page-number="2"] .region-source-highlight',
    )).toBeVisible();

    await firstTranslation.evaluate((block) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(block);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (block as HTMLElement).click();
    });
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    await pdfPage.waitForTimeout(180);
    await expect(pdfPage.locator('#tex-selection-translator-root').locator('.trigger-shell'))
      .toHaveCount(0);
    await pdfPage.evaluate(() => window.getSelection()?.removeAllRanges());
    await firstTranslation.press('Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('1');
    await expect(pdfPage.locator(
      '.pdf-page[data-page-number="1"] .region-source-highlight',
    )).toBeVisible();
    expect(textRequests).toHaveLength(requestsBeforePreview + 2);
    expect(await pdfPage.locator('#document-stage').evaluate((stage) => (
      getComputedStyle(stage).marginRight
    ))).not.toBe('0px');
    await panel.locator('#pdf-document-translation-view-current').click();
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await expect(panel.locator('.pdf-document-translation-page:visible')).toHaveCount(1);
    const narrowReaderLayout = await panel.locator('#pdf-document-translation-reader > header')
      .evaluate((header) => ({
        clientWidth: header.clientWidth,
        scrollWidth: header.scrollWidth,
        height: header.getBoundingClientRect().height,
      }));
    expect(narrowReaderLayout.scrollWidth).toBeLessThanOrEqual(narrowReaderLayout.clientWidth + 1);
    expect(narrowReaderLayout.height).toBeGreaterThanOrEqual(40);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await pdfPage.screenshot({
        path: testInfo.outputPath('pdf-full-document-translation.png'),
        fullPage: false,
      });
    }

    await pdfPage.locator('#pdf-document-translation-close').click();
    await expect(panel).toBeHidden();
  } finally {
    await pdfPage.close();
  }
});

test('uses one authorized vision model for every block in a PDF containing formulas', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.addInitScript(() => {
    const scope = globalThis as typeof globalThis & { __documentOcrRequests?: number };
    scope.__documentOcrRequests = 0;
    const runtime = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown, ...args: unknown[]): Promise<unknown> } };
    }).chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (message: unknown, ...args: unknown[]) => {
      if (
        message && typeof message === 'object' && 'type' in message &&
        message.type === 'RECOGNIZE_PDF_PAGE'
      ) {
        scope.__documentOcrRequests = (scope.__documentOcrRequests ?? 0) + 1;
        if (scope.__documentOcrRequests === 1) {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'OCR_INVALID_RESPONSE',
              message: 'Synthetic unreadable scan.',
              retryable: true,
            },
          });
        }
        return Promise.resolve({
          ok: true,
          data: {
            page: {
              pageNumber: 1,
              coordinateSystem: 'normalized-page',
              source: 'qwen-advanced-recognition',
              blocks: [
                {
                  id: 'document-ocr-text', order: 0,
                  text: 'Scanned full-document paragraph for translation.',
                  confidence: 0.93, confidenceSource: 'trusted-adapter', kind: 'text',
                  box: { left: .1, top: .18, width: .76, height: .06 },
                },
                {
                  id: 'document-ocr-formula', order: 1,
                  text: 'E=mc^2', confidence: 0.91,
                  confidenceSource: 'trusted-adapter', kind: 'formula',
                  box: { left: .2, top: .3, width: .28, height: .05 },
                },
              ],
            },
          },
        });
      }
      return original(message, ...args);
    };
  });
  const requestStart = textRequests.length;
  const visionRequestStart = visionRequests.length;
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'scanned-full-document.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    const panel = pdfPage.locator('#pdf-document-translation');
    const ocr = pdfPage.locator('#pdf-document-translation-ocr');
    const ocrAction = pdfPage.locator('#pdf-document-translation-ocr-action');
    await expect(panel).toBeVisible();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('没有读取到文字层');
    await expect(ocr).toBeVisible();
    await expect(pdfPage.locator('#pdf-document-translation-ocr-status'))
      .toContainText('将在开始后自动识别');
    await expect(ocrAction).toHaveText('识别 1 页');
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-toggle')).toBeChecked();
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-status'))
      .toContainText('1 个扫描页');
    await expect(pdfPage.locator('#pdf-document-translation-range')).toBeEnabled();
    expect(await pdfPage.evaluate(() => (
      globalThis as typeof globalThis & { __documentOcrRequests?: number }
    ).__documentOcrRequests)).toBe(0);
    expect(textRequests).toHaveLength(requestStart);

    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(ocr).toHaveAttribute('data-tone', 'error');
    await expect(pdfPage.locator('#pdf-document-translation-ocr-status'))
      .toContainText('1 页未识别');
    await expect(ocrAction).toHaveText('识别 1 页');
    expect(await pdfPage.evaluate(() => (
      globalThis as typeof globalThis & { __documentOcrRequests?: number }
    ).__documentOcrRequests)).toBe(1);
    expect(textRequests).toHaveLength(requestStart);

    await ocrAction.click();
    await expect(ocr).toBeHidden();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('扫描页已加入正文');
    await expect(pdfPage.locator('#pdf-document-translation-primary')).toBeEnabled();
    await expect(pdfPage.locator('[data-pi-ocr-block="document-ocr-text"]'))
      .toContainText('Scanned full-document paragraph');
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-status'))
      .toContainText('当前范围 2 段统一使用视觉模型');
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-status'))
      .toContainText('预计 2 次视觉请求');
    await expect(pdfPage.locator('#pdf-document-translation-primary'))
      .toHaveText('开始多模态全文翻译');
    const panelLayout = await panel.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(panelLayout.scrollWidth).toBeLessThanOrEqual(panelLayout.clientWidth + 1);

    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 2/2');
    expect(textRequests).toHaveLength(requestStart);
    expect(visionRequests).toHaveLength(visionRequestStart + 2);
    const unifiedVisionPrompts = visionRequests.slice(visionRequestStart).map((request) => (
      (request.messages as Array<{
        content?: Array<{ type?: string; text?: string }>;
      }> | undefined)?.[0]?.content?.find((item) => item.type === 'text')?.text ?? ''
    ));
    expect(unifiedVisionPrompts.join('\n')).toContain('Scanned full-document paragraph');
    expect(unifiedVisionPrompts.join('\n')).toContain('E=mc^2');
    expect(unifiedVisionPrompts.some((prompt) => prompt.includes('相邻段落上下文'))).toBe(true);
    expect(unifiedVisionPrompts[0]).toContain('下一连续块原文');
    expect(unifiedVisionPrompts[1]).toContain('上一连续块原文');
    await expect(panel.locator('[data-translation-mode="vision"]')).toHaveCount(2);
    const proseVisionLabel = await panel
      .locator('[data-translation-mode="vision"]:not([data-visual-role="formula"])')
      .evaluate((element) => getComputedStyle(element, '::before').content);
    expect(proseVisionLabel).not.toContain('多模态译文');
    await expect(panel.locator('[data-visual-role="formula"]')).toContainText('能量关系式');
    const requestsBeforeLayoutExport = {
      text: textRequests.length,
      vision: visionRequests.length,
    };
    await panel.locator('#pdf-document-translation-copy-menu > summary').click();
    const layoutPreviewPromise = context.waitForEvent('page');
    await panel.locator('#pdf-document-translation-print-layout').click();
    const layoutPreview = await layoutPreviewPromise;
    await expect(layoutPreview.locator('body')).toHaveAttribute('data-pi-layout-ready', 'true', {
      timeout: 20_000,
    });
    await expect(layoutPreview.locator('[data-layout-role="formula"]')).toHaveCount(1);
    await expect(layoutPreview.locator('[data-layout-role="formula"] math')).toBeVisible();
    await expect(layoutPreview.locator('[data-layout-role="formula"]'))
      .toContainText('能量关系式');
    expect(textRequests).toHaveLength(requestsBeforeLayoutExport.text);
    expect(visionRequests).toHaveLength(requestsBeforeLayoutExport.vision);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await layoutPreview.setViewportSize({ width: 980, height: 900 });
      await layoutPreview.screenshot({
        path: testInfo.outputPath('pdf-layout-translation-formula.png'),
        fullPage: false,
      });
      await layoutPreview.emulateMedia({ media: 'print' });
      await layoutPreview.locator('[data-layout-source-page="1"]').screenshot({
        path: testInfo.outputPath('pdf-layout-translation-formula-print-page.png'),
      });
      await layoutPreview.emulateMedia({ media: 'screen' });
    }
    await layoutPreview.close();
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await pdfPage.screenshot({
        path: testInfo.outputPath('pdf-full-document-ocr-360.png'),
        fullPage: false,
      });
    }
  } finally {
    await pdfPage.close();
  }
});

test('translates a captioned paper table as one visual object beside ordinary text', async () => {
  const pdfPage = await context.newPage();
  const lifecycle = await context.newCDPSession(pdfPage);
  const textRequestStart = textRequests.length;
  const visionRequestStart = visionRequests.length;
  let frozen = false;
  mockControl.heldVisionRequestGate = new Promise<void>((resolve) => {
    mockControl.releaseHeldVisionRequest = resolve;
  });
  mockControl.holdNextVisionRequest = true;
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'semantic-table-object.pdf',
      mimeType: 'application/pdf',
      buffer: createCaptionedTableAndTextPdf(
        'Table 1. Average PSNR comparison on Set11.',
        [
          ['Model', 'PSNR', 'Time'],
          ['ISTA-Net', '31.53', '0.039 s'],
          ['ISTA-Net+', '32.57', '0.047 s'],
        ],
        'The surrounding paragraph remains an ordinary text translation request.',
      ),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    const panel = pdfPage.locator('#pdf-document-translation');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 2 段，等待确认');
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-status'))
      .toContainText('1 个表格');
    await expect(pdfPage.locator('#pdf-document-translation-multimodal-status'))
      .toContainText('预计 1 次视觉请求');
    expect(textRequests).toHaveLength(textRequestStart);
    expect(visionRequests).toHaveLength(visionRequestStart);

    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect.poll(() => visionRequests.length).toBe(visionRequestStart + 1);
    await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
    frozen = true;
    mockControl.releaseHeldVisionRequest?.();
    mockControl.releaseHeldVisionRequest = undefined;
    await expect.poll(() => textRequests.length, { timeout: 20_000 }).toBe(textRequestStart + 1);
    await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
    frozen = false;
    await pdfPage.bringToFront();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 2/2');
    expect(textRequests).toHaveLength(textRequestStart + 1);
    expect(visionRequests).toHaveLength(visionRequestStart + 1);
    const prompt = (visionRequests.at(-1)?.messages as Array<{
      content?: Array<{ type?: string; text?: string }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'text')?.text ?? '';
    expect(prompt).toContain('完整表格');
    expect(prompt).toContain('Table 1. Average PSNR comparison on Set11.');

    const tableCard = panel.locator('[data-object-role="table"]');
    await expect(tableCard).toHaveCount(1);
    await expect(tableCard).toHaveAttribute('data-visual-role', 'table');
    await expect(tableCard.locator('table.pdf-document-table')).toHaveCount(1);
    await expect(tableCard.locator('thead')).toContainText('PSNR');
    await expect(tableCard.locator('tbody tr')).toHaveCount(2);
    const label = await tableCard.evaluate((element) => getComputedStyle(element, '::before').content);
    expect(label).toContain('表格');
    expect(label).not.toContain('多模态译文');
    await tableCard.click();
    const highlight = pdfPage.locator('.pdf-page[data-page-number="1"] .region-source-highlight');
    await expect(highlight).toBeVisible();
    const highlightBounds = await highlight.boundingBox();
    expect(highlightBounds?.width).toBeGreaterThan(350);
    expect(highlightBounds?.height).toBeGreaterThan(100);
  } finally {
    mockControl.releaseHeldVisionRequest?.();
    mockControl.releaseHeldVisionRequest = undefined;
    if (frozen) {
      await lifecycle.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
    }
    await pdfPage.close();
  }
});

test('continues a text-only PDF translation while the reader tab is frozen', async () => {
  const pdfPage = await context.newPage();
  const lifecycle = await context.newCDPSession(pdfPage);
  const textRequestStart = textRequests.length;
  const visionRequestStart = visionRequests.length;
  let frozen = false;
  mockControl.heldDocumentBatchRequestGate = new Promise<void>((resolve) => {
    mockControl.releaseHeldDocumentBatchRequest = resolve;
  });
  mockControl.holdNextDocumentBatchRequest = true;
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'background-text-translation.pdf',
      mimeType: 'application/pdf',
      buffer: createMultiPageTextPdf(Array.from({ length: 14 }, (_, index) => ({
        text: `Text-only background translation page ${index + 1} remains continuous.`,
      }))),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 14 段，等待确认');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect.poll(() => textRequests.length).toBe(textRequestStart + 1);

    await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
    frozen = true;
    mockControl.releaseHeldDocumentBatchRequest?.();
    mockControl.releaseHeldDocumentBatchRequest = undefined;

    await expect.poll(() => textRequests.length, { timeout: 20_000 })
      .toBe(textRequestStart + 3);
    expect(visionRequests).toHaveLength(visionRequestStart);

    await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
    frozen = false;
    await pdfPage.bringToFront();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 14/14', { timeout: 20_000 });
  } finally {
    mockControl.releaseHeldDocumentBatchRequest?.();
    mockControl.releaseHeldDocumentBatchRequest = undefined;
    if (frozen) {
      await lifecycle.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
    }
    await pdfPage.close();
  }
});

test('continues an authorized multimodal PDF translation while the reader tab is frozen', async () => {
  const pdfPage = await context.newPage();
  const visionRequestStart = visionRequests.length;
  const textRequestStart = textRequests.length;
  const lifecycle = await context.newCDPSession(pdfPage);
  let frozen = false;
  mockControl.heldVisionRequestGate = new Promise<void>((resolve) => {
    mockControl.releaseHeldVisionRequest = resolve;
  });
  mockControl.holdNextVisionRequest = true;
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'background-multimodal-translation.pdf',
      mimeType: 'application/pdf',
      buffer: createMultiPageTextPdf([
        { text: 'Energy E = mc^2 begins this three-page document.' },
        { text: 'The second page must translate without the reader tab running.' },
        { text: 'The third page proves that the background queue reaches completion.' },
      ]),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 3 段，等待确认');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect.poll(() => visionRequests.length).toBe(visionRequestStart + 1);
    expect(visionRequests).toHaveLength(visionRequestStart + 1);

    await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
    frozen = true;
    mockControl.releaseHeldVisionRequest?.();
    mockControl.releaseHeldVisionRequest = undefined;

    await expect.poll(() => visionRequests.length, { timeout: 20_000 })
      .toBe(visionRequestStart + 3);
    expect(textRequests).toHaveLength(textRequestStart);

    await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
    frozen = false;
    await pdfPage.bringToFront();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 3/3', { timeout: 20_000 });
    await expect(pdfPage.locator('#pdf-document-translation'))
      .toHaveAttribute('data-phase', 'complete');
  } finally {
    mockControl.releaseHeldVisionRequest?.();
    mockControl.releaseHeldVisionRequest = undefined;
    if (frozen) {
      await lifecycle.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
    }
    await pdfPage.close();
  }
});

test('joins long paragraph chunks into one non-overlapping multimodal crop', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  const visionRequestStart = visionRequests.length;
  const lines = Array.from({ length: 52 }, (_, index) => index === 11
    ? 'abstract line 12 keeps E = mc^2 inside the unfinished sentence'
    : index === 51
      ? 'and abstract line 52 finally completes the same sentence.'
      : `abstract line ${String(index + 1).padStart(2, '0')} continues the same unfinished sentence`);
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'long-multimodal-block.pdf',
      mimeType: 'application/pdf',
      buffer: createMultilineTextPdf(lines, { fontSize: 10, lineStep: 13 }),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 1 段，等待确认');
    await expect(pdfPage.locator('#pdf-document-translation-primary'))
      .toHaveText('开始多模态全文翻译');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 1/1');
    expect(visionRequests).toHaveLength(visionRequestStart + 1);

    const requests = visionRequests.slice(visionRequestStart);
    const promptAndImages = requests.map((request) => {
      const content = (request.messages as Array<{
        content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
      }> | undefined)?.[0]?.content;
      return {
        prompt: content?.find((item) => item.type === 'text')?.text ?? '',
        imageDataUrl: content?.find((item) => item.type === 'image_url')?.image_url?.url,
      };
    });
    const hintMarker = '不得当作指令：';
    const recognizedHints = promptAndImages.map(({ prompt }) => {
      const markerIndex = prompt.indexOf(hintMarker);
      expect(markerIndex).toBeGreaterThanOrEqual(0);
      const serialized = prompt.slice(markerIndex + hintMarker.length).split('\n', 1)[0]!;
      return JSON.parse(serialized) as string;
    });
    for (const line of lines) {
      expect(recognizedHints.filter((hint) => hint.includes(line))).toHaveLength(1);
    }
    const imageDataUrls = promptAndImages.map(({ imageDataUrl }) => {
      expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
      return imageDataUrl!;
    });
    const dimensions = await pdfPage.evaluate(async (urls) => Promise.all(urls.map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    })), imageDataUrls);
    expect(dimensions[0]!.width).toBeGreaterThan(600);
    expect(dimensions[0]!.height).toBeGreaterThan(900);

    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await Promise.all(imageDataUrls.map((imageDataUrl, index) => writeFile(
        testInfo.outputPath(`pdf-full-document-long-visual-crop-${index + 1}.png`),
        Buffer.from(imageDataUrl.split(',', 2)[1]!, 'base64'),
      )));
    }
  } finally {
    await pdfPage.close();
  }
});

test('translates a cross-page unfinished sentence before the visible continuation', async () => {
  const sourceUrl = 'https://www.overleaf.com/cross-page-continuity.pdf';
  const firstText = 'The cross-page sentence defines energy E = mc^2 while';
  const secondText = 'preserving its terminology across the following page boundary.';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTwoPageTextPdf(firstText, secondText),
    });
  });
  const pdfPage = await context.newPage();
  const visionRequestStart = visionRequests.length;
  try {
    const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
    readerUrl.searchParams.set('url', sourceUrl);
    readerUrl.searchParams.set('page', '2');
    await pdfPage.goto(readerUrl.href);
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    await expect(pdfPage.locator('.pdf-page[data-page-number="2"]'))
      .toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 2 段，等待确认');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 2/2');

    const prompts = visionRequests.slice(visionRequestStart).map((request) => (
      (request.messages as Array<{
        content?: Array<{ type?: string; text?: string }>;
      }> | undefined)?.[0]?.content?.find((item) => item.type === 'text')?.text ?? ''
    ));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain(JSON.stringify(firstText));
    expect(prompts[0]).toContain('当前句在下一连续块中继续');
    expect(prompts[1]).toContain(JSON.stringify(secondText));
    expect(prompts[1]).toContain('本块承接上一连续块中尚未结束的句子');
    expect(prompts[1]).toContain('上一连续块译文');
  } finally {
    await pdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('groups a full-width paragraph into one multimodal crop on a two-column PDF', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  const visionRequestStart = visionRequests.length;
  const leftLines = Array.from(
    { length: 7 },
    (_, index) => `Left column line ${index + 1} keeps its reading flow`,
  );
  const rightLines = Array.from(
    { length: 7 },
    (_, index) => `Right column line ${index + 1} keeps its reading flow`,
  );
  const fullWidthLines = [
    'The full-width conclusion starts as one continuous paragraph across the page.',
    'Its relation E = mc^2 stays with the surrounding explanation and evidence.',
    'The final full-width line completes the same paragraph without a duplicate crop.',
  ];
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'two-column-full-width-paragraph.pdf',
      mimeType: 'application/pdf',
      buffer: createTwoColumnTextPdf(leftLines, rightLines, fullWidthLines.map((text, index) => ({
        text,
        x: 54,
        y: 500 - index * 22,
      }))),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 3 段，等待确认');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 3/3');

    const requests = visionRequests.slice(visionRequestStart);
    expect(requests).toHaveLength(3);
    const fullWidthRequest = requests.at(-1)!;
    const content = (fullWidthRequest.messages as Array<{
      content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
    }> | undefined)?.[0]?.content;
    const prompt = content?.find((item) => item.type === 'text')?.text ?? '';
    expect(prompt).toContain(JSON.stringify(fullWidthLines.join(' ')));
    const imageDataUrl = content?.find((item) => item.type === 'image_url')?.image_url?.url;
    expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
    const dimensions = await pdfPage.evaluate(async (url) => {
      const image = new Image();
      image.src = url!;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, imageDataUrl);
    expect(dimensions.width).toBeGreaterThan(700);
    expect(dimensions.height).toBeGreaterThan(100);

    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await writeFile(
        testInfo.outputPath('pdf-two-column-full-width-visual-crop.png'),
        Buffer.from(imageDataUrl!.split(',', 2)[1]!, 'base64'),
      );
    }
  } finally {
    await pdfPage.close();
  }
});

test('joins a sentence that crosses columns and a full-width region into one visual card', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  const visionRequestStart = visionRequests.length;
  const leftLines = [
    'This paper develops ISTA reconstruction',
    'with interpretable optimization stages',
    'and learned nonlinear transforms',
    'to recover sparse natural images',
    'and retain measurement consistency',
    'with all parameters learned end to end',
    'and draws additional insights',
  ];
  const rightLines = [
    'using compression theory for this design',
    'through sparse natural image residuals',
    'that remain clear at every stage',
    'and preserve measurement constraints',
    'with one visual evidence path',
    'so no fragment is translated alone',
    'and the resulting enhanced version is dubbed',
  ];
  const fullWidthLines = [
    'ISTA-Net+, the resulting enhanced architecture, extends the original ISTA-Net to',
    'improve reconstruction accuracy while preserving E = mc^2 in the explanation.',
  ];
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'semantic-continuation-regions.pdf',
      mimeType: 'application/pdf',
      buffer: createTwoColumnTextPdf(
        leftLines,
        rightLines,
        fullWidthLines.map((text, index) => ({ text, x: 54, y: 500 - index * 22 })),
      ),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 1 段，等待确认');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 1/1');

    const requests = visionRequests.slice(visionRequestStart);
    expect(requests).toHaveLength(1);
    const content = (requests[0]!.messages as Array<{
      content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
    }> | undefined)?.[0]?.content;
    const prompt = content?.find((item) => item.type === 'text')?.text ?? '';
    expect(prompt).toContain(JSON.stringify(
      [...leftLines, ...rightLines, ...fullWidthLines].join(' '),
    ));
    expect(prompt).toContain('多个不相邻的紧凑裁剪区域按阅读顺序自上而下拼接');
    const imageDataUrl = content?.find((item) => item.type === 'image_url')?.image_url?.url;
    expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
    const dimensions = await pdfPage.evaluate(async (url) => {
      const image = new Image();
      image.src = url!;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, imageDataUrl);
    expect(dimensions.width).toBeGreaterThan(700);
    expect(dimensions.height).toBeGreaterThan(700);
    const cards = pdfPage.locator('#pdf-document-translation-pages [data-translation-block]');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAttribute('data-translation-mode', 'vision');
    await cards.click();
    const sourceHighlights = pdfPage.locator(
      '.pdf-page[data-page-number="1"] .region-source-highlight',
    );
    await expect(sourceHighlights).toHaveCount(3);
    const highlightTops = await sourceHighlights.evaluateAll((highlights) => (
      highlights.map((highlight) => highlight.getBoundingClientRect().top)
    ));
    expect(highlightTops).toEqual([...highlightTops].sort((left, right) => left - right));
    const highlightVisibility = await sourceHighlights.evaluateAll((highlights) => {
      const stage = document.querySelector<HTMLElement>('#document-stage')!.getBoundingClientRect();
      return highlights.map((highlight) => {
        const rect = highlight.getBoundingClientRect();
        return rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1;
      });
    });
    expect(highlightVisibility).toEqual([true, true, true]);

    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await writeFile(
        testInfo.outputPath('pdf-semantic-continuation-composite.png'),
        Buffer.from(imageDataUrl!.split(',', 2)[1]!, 'base64'),
      );
      await pdfPage.screenshot({
        path: testInfo.outputPath('pdf-semantic-continuation-result.png'),
        fullPage: false,
      });
    }
  } finally {
    await pdfPage.close();
  }
});

test('stops automatically authorized PDF full-document OCR', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.addInitScript(() => {
    const runtime = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown, ...args: unknown[]): Promise<unknown> } };
    }).chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (message: unknown, ...args: unknown[]) => {
      if (
        message && typeof message === 'object' && 'type' in message &&
        message.type === 'RECOGNIZE_PDF_PAGE'
      ) return new Promise(() => undefined);
      return original(message, ...args);
    };
  });
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'stoppable-scanned-document.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    const action = pdfPage.locator('#pdf-document-translation-ocr-action');
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(action).toHaveText('停止识别');
    await action.click();
    await expect(action).toHaveText('识别 1 页');
    await expect(pdfPage.locator('#pdf-document-translation-ocr-status'))
      .toContainText('识别已停止');
    await expect(pdfPage.locator('#pdf-document-translation-primary')).toBeDisabled();
  } finally {
    await pdfPage.close();
  }
});

test('restores explicitly retained PDF progress after session loss and translates only new paragraphs', async ({}, testInfo) => {
  const sourceUrl = 'https://www.overleaf.com/pdf-document-resume.pdf';
  let expandedDocument = false;
  const firstText = 'The resumable PDF begins with a stable first paragraph.';
  const secondText = 'The resumable PDF keeps a stable second paragraph.';
  const thirdText = 'A newly added PDF paragraph should be the only resumed request.';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createMultiPageTextPdf([
        { text: firstText },
        { text: secondText },
        ...(expandedDocument ? [{ text: thirdText }] : []),
      ]),
    });
  });
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  const firstReader = await context.newPage();
  const requestStart = textRequests.length;
  try {
    await firstReader.goto(readerUrl.href);
    await expect(firstReader.locator('#page-count')).toHaveText('2');
    await firstReader.locator('#translate-document').click();
    await expect(firstReader.locator('#pdf-document-translation-status'))
      .toContainText('已识别 2 段，等待确认');
    const retention = firstReader.locator('#pdf-document-translation-retention-toggle');
    await expect(retention).toBeVisible();
    await expect(firstReader.locator('#pdf-document-translation-retention-manage'))
      .toHaveText('管理');
    await expect(retention).not.toBeChecked();
    await retention.check();
    await expect(firstReader.locator('#pdf-document-translation-retention-status'))
      .toContainText('已保留到本机');
    const range = firstReader.locator('#pdf-document-translation-range');
    await range.selectOption('current');
    await expect(retention).toBeChecked();
    await range.selectOption('all');
    await expect(retention).toBeChecked();
    await firstReader.locator('#pdf-document-translation-primary').click();
    await expect(firstReader.locator('#pdf-document-translation-status'))
      .toContainText('已完成 2/2');
    expect(textRequests).toHaveLength(requestStart + 1);
    const serializedSession = await firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return JSON.stringify(await api.storage.session.get(
        'pdfDocumentTranslationSessionsV1',
      ));
    });
    expect(serializedSession).not.toContain(sourceUrl);
    expect(serializedSession).not.toContain(firstText);
    expect(serializedSession).not.toContain(secondText);
    const serializedLocal = await firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return JSON.stringify(await api.storage.local.get(
        'pdfDocumentTranslationRetainedV1',
      ));
    });
    expect(serializedLocal).not.toContain(sourceUrl);
    expect(serializedLocal).not.toContain(firstText);
    expect(serializedLocal).not.toContain(secondText);
    expect(serializedLocal).toContain('批量生成的学术译文');
    await firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { remove(key: string): Promise<void> } } };
      }).chrome;
      await api.storage.session.remove('pdfDocumentTranslationSessionsV1');
    });
  } finally {
    await firstReader.close();
  }

  expandedDocument = true;
  const restoredReader = await context.newPage();
  try {
    await restoredReader.setViewportSize({ width: 360, height: 700 });
    await restoredReader.goto(readerUrl.href);
    await expect(restoredReader.locator('#page-count')).toHaveText('3');
    await restoredReader.locator('#translate-document').click();
    const panel = restoredReader.locator('#pdf-document-translation');
    await expect(restoredReader.locator('#pdf-document-translation-status'))
      .toContainText('已从本机恢复 2/3 段，可继续翻译');
    await expect(restoredReader.locator('#pdf-document-translation-retention-toggle'))
      .toBeChecked();
    await expect(panel.locator('[data-status="done"]')).toHaveCount(2);
    expect(textRequests).toHaveLength(requestStart + 1);

    await restoredReader.locator('#pdf-document-translation-primary').click();
    await expect(restoredReader.locator('#pdf-document-translation-status'))
      .toContainText('已完成 3/3');
    expect(textRequests).toHaveLength(requestStart + 2);
    const resumedRequest = textRequests.at(-1)!;
    const resumedMessages = resumedRequest.messages as Array<{ role?: string; content?: string }>;
    const resumedContent = resumedMessages.find((message) => message.role === 'user')?.content;
    const resumedPayload = JSON.parse(resumedContent!) as {
      segments: Array<{ id: string; text: string }>;
    };
    expect(resumedPayload.segments.map((segment) => segment.text)).toEqual([thirdText]);

    const restart = restoredReader.locator('#pdf-document-translation-clear');
    await expect(restart).toHaveText('重新翻译');
    await restart.click();
    await expect(restoredReader.locator('#pdf-document-translation-status'))
      .toContainText('已完成 3/3');
    expect(textRequests).toHaveLength(requestStart + 3);
    const restartedRequest = textRequests.at(-1)!;
    const restartedMessages = restartedRequest.messages as Array<{ role?: string; content?: string }>;
    const restartedContent = restartedMessages.find((message) => message.role === 'user')?.content;
    const restartedPayload = JSON.parse(restartedContent!) as {
      segments: Array<{ id: string; text: string }>;
    };
    expect(restartedPayload.segments.map((segment) => segment.text))
      .toEqual([firstText, secondText, thirdText]);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await restoredReader.screenshot({
        path: testInfo.outputPath('pdf-full-document-retained-360.png'),
        fullPage: false,
      });
    }
    const restoredRetention = restoredReader.locator(
      '#pdf-document-translation-retention-toggle',
    );
    await panel.locator('#pdf-document-translation-settings > summary').click();
    await restoredRetention.uncheck();
    await expect(restoredReader.locator('#pdf-document-translation-retention-status'))
      .toContainText('本机保存已清除');
    const retainedAfterClear = await restoredReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return (await api.storage.local.get(
        'pdfDocumentTranslationRetainedV1',
      )).pdfDocumentTranslationRetainedV1;
    });
    expect(retainedAfterClear).toBeUndefined();
  } finally {
    await restoredReader.close();
    await context.unroute(sourceUrl);
  }
});

test('limits PDF document translation by pages and recognized back matter', async ({}, testInfo) => {
  const sourceUrl = 'https://www.overleaf.com/pdf-document-range.pdf';
  const bodyText = 'The main paper body remains inside the selected translation range.';
  const referenceText = '[1] A reference entry should be skipped when requested.';
  const appendixText = 'Appendix details remain translatable independently.';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createMultiPageTextPdf([
        { text: bodyText },
        { text: 'References' },
        { text: referenceText },
        { text: 'Appendix A: Proofs' },
        { text: appendixText },
      ]),
    });
  });
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  const pdfPage = await context.newPage();
  const requestStart = textRequests.length;
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(readerUrl.href);
    await expect(pdfPage.locator('#page-count')).toHaveText('5');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 5 段，等待确认');
    const range = pdfPage.locator('#pdf-document-translation-range');
    const customForm = pdfPage.locator('#pdf-document-translation-custom-range');
    const customPages = pdfPage.locator('#pdf-document-translation-custom-pages');
    const feedback = pdfPage.locator('#pdf-document-translation-range-feedback');
    const skipReferences = pdfPage.locator('#pdf-document-translation-skip-references');
    const skipAppendix = pdfPage.locator('#pdf-document-translation-skip-appendix');
    await expect(range).toBeEnabled();
    await expect(skipReferences).toBeEnabled();
    await expect(skipAppendix).toBeEnabled();
    expect(textRequests).toHaveLength(requestStart);

    await range.selectOption('custom');
    await expect(customForm).toBeVisible();
    const scopeLayout = await pdfPage.locator('.pdf-document-translation-scope')
      .evaluate((scope) => ({
        clientWidth: scope.clientWidth,
        scrollWidth: scope.scrollWidth,
      }));
    expect(scopeLayout.scrollWidth).toBeLessThanOrEqual(scopeLayout.clientWidth);
    await customPages.fill('0-2');
    await customForm.getByRole('button', { name: '应用' }).click();
    await expect(feedback).toContainText('页码必须在 1–5 之间');
    expect(textRequests).toHaveLength(requestStart);

    await customPages.fill('2-5');
    await customForm.getByRole('button', { name: '应用' }).click();
    await skipReferences.check();
    await expect(feedback).toContainText('2–5 页 · 2 页 / 2 段');
    await expect(feedback).toContainText('已跳过参考文献 2 段');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 2 段，等待确认');
    expect(textRequests).toHaveLength(requestStart);

    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 2/2');
    expect(textRequests).toHaveLength(requestStart + 1);
    const rangedRequest = textRequests.at(-1)!;
    const rangedMessages = rangedRequest.messages as Array<{ role?: string; content?: string }>;
    const rangedContent = rangedMessages.find((message) => message.role === 'user')?.content;
    const rangedPayload = JSON.parse(rangedContent!) as {
      segments: Array<{ id: string; text: string }>;
    };
    expect(rangedPayload.segments.map((segment) => segment.text)).toEqual([
      'Appendix A: Proofs',
      appendixText,
    ]);

    await pdfPage.locator('#pdf-document-translation-settings > summary').click();
    await range.selectOption('current');
    await expect(feedback).toContainText('第 1 页 · 1 页 / 1 段');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已暂停 · 0/1');
    expect(textRequests).toHaveLength(requestStart + 1);
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 1/1');
    expect(textRequests).toHaveLength(requestStart + 2);
    const currentRequest = textRequests.at(-1)!;
    const currentMessages = currentRequest.messages as Array<{ role?: string; content?: string }>;
    const currentContent = currentMessages.find((message) => message.role === 'user')?.content;
    const currentPayload = JSON.parse(currentContent!) as {
      segments: Array<{ id: string; text: string }>;
    };
    expect(currentPayload.segments.map((segment) => segment.text)).toEqual([bodyText]);

    await pdfPage.locator('#pdf-document-translation-settings > summary').click();
    await range.selectOption('all');
    await expect(feedback).toContainText('整篇文档 · 3 页 / 3 段');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已完成 3/3');
    await skipAppendix.check();
    await expect(feedback).toContainText('整篇文档 · 1 页 / 1 段');
    await expect(feedback).toContainText('已跳过参考文献 2 段、附录 2 段');
    expect(textRequests).toHaveLength(requestStart + 2);
    await pdfPage.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __piCopiedText?: string };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            scope.__piCopiedText = value;
          },
        },
      });
    });
    const scopedCopyMenu = pdfPage.locator('#pdf-document-translation-copy-menu');
    await scopedCopyMenu.locator(':scope > summary').click();
    await pdfPage.locator('#pdf-document-translation-copy-bilingual').click();
    await expect(pdfPage.locator('#pdf-document-translation-copy-feedback'))
      .toContainText('1 段 · 1 页');
    const scopedMarkdown = await pdfPage.evaluate(() => (
      globalThis as typeof globalThis & { __piCopiedText?: string }
    ).__piCopiedText ?? '');
    expect(scopedMarkdown).toContain(bodyText);
    expect(scopedMarkdown).not.toContain(referenceText);
    expect(scopedMarkdown).not.toContain(appendixText);
    expect(textRequests).toHaveLength(requestStart + 2);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await pdfPage.screenshot({
        path: testInfo.outputPath('pdf-full-document-translation-360.png'),
        fullPage: false,
      });
    }
  } finally {
    await pdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('orders a two-column PDF by reading column before full-document translation', async () => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'two-column-full-document.pdf',
      mimeType: 'application/pdf',
      buffer: createTwoColumnTextPdf(
        [
          'Left column opening sentence.',
          'Left column supporting evidence.',
          'Left column closing sentence.',
        ],
        [
          'Right column opening sentence.',
          'Right column supporting evidence.',
          'Right column closing sentence.',
        ],
        [{ text: 'Layout-aware paper title', x: 54, y: 752 }],
      ),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#translate-document').click();
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 3 段，等待确认');
    await expect(pdfPage.locator('#pdf-document-translation-note'))
      .toContainText('已按阅读顺序整理 1 页多栏正文');

    const requestStart = textRequests.length;
    await pdfPage.locator('#pdf-document-translation-primary').click();
    await expect(pdfPage.locator('#pdf-document-translation-status')).toContainText('已完成 3/3');
    expect(textRequests.length).toBe(requestStart + 1);
    const request = textRequests[requestStart]!;
    const messages = request.messages as Array<{ role?: string; content?: string }>;
    const userContent = messages.find((message) => message.role === 'user')?.content;
    expect(userContent).toBeTruthy();
    const payload = JSON.parse(userContent!) as {
      segments: Array<{ id: string; text: string }>;
    };
    expect(payload.segments.map((segment) => segment.id)).toEqual(['P1B1', 'P1B2', 'P1B3']);
    const source = payload.segments.map((segment) => segment.text).join('\n');
    expect(source.startsWith('Layout-aware paper title')).toBe(true);
    expect(source.indexOf('Left column closing sentence.'))
      .toBeLessThan(source.indexOf('Right column opening sentence.'));
  } finally {
    await pdfPage.close();
  }
});

test('uses the native PDF outline for compact chapter navigation', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 900, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'outlined-paper.pdf',
      mimeType: 'application/pdf',
      buffer: createOutlinedPdf(),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    const openOutline = pdfPage.locator('#open-outline');
    await expect(openOutline).toBeVisible();
    await expect(openOutline).toBeEnabled();
    await expect(pdfPage.locator('#pdf-navigation-outline-tab')).not.toHaveAttribute('hidden', '');
    await openOutline.click();

    const panel = pdfPage.locator('#pdf-outline');
    const tree = pdfPage.locator('#pdf-outline-tree');
    const actions = tree.locator('.pdf-outline-action');
    await expect(panel).toBeVisible();
    await openOutline.click();
    await expect(panel).toBeHidden();
    await openOutline.click();
    await expect(panel).toBeVisible();
    await expect(pdfPage.locator('#pdf-outline-status')).toHaveText('4 项');
    await expect(actions).toHaveCount(4);
    const introduction = actions.filter({ hasText: 'Introduction' });
    const methods = actions.filter({ hasText: 'Methods' });
    const experiment = actions.filter({ hasText: 'Detailed experiment' });
    const conclusion = actions.filter({ hasText: 'Conclusion' });
    await expect(introduction).toHaveAttribute('aria-current', 'location');
    await expect(methods).toHaveAttribute('aria-expanded', 'true');
    await expect(experiment).toHaveAttribute('aria-level', '2');

    await methods.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('3');
    await expect(methods).toHaveAttribute('aria-current', 'location');
    await tree.getByRole('button', { name: '收起 Methods' }).click();
    await expect(experiment).toBeHidden();
    await methods.focus();
    await methods.press('ArrowRight');
    await expect(methods).toHaveAttribute('aria-expanded', 'true');
    await methods.press('ArrowDown');
    await expect(experiment).toBeFocused();
    await experiment.press('Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('4');
    await expect(experiment).toHaveAttribute('aria-current', 'location');

    await experiment.press('Escape');
    await expect(panel).toBeHidden();
    await expect(openOutline).toBeFocused();
    await openOutline.click();
    await expect(panel).toBeVisible();
    await pdfPage.keyboard.press('Control+f');
    await expect(panel).toBeHidden();
    await expect(pdfPage.locator('#pdf-search-query')).toBeFocused();
    await pdfPage.locator('#pdf-search-query').press('Escape');
    await expect(openOutline).toBeFocused();

    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await openOutline.click();
    await expect(panel).toBeVisible();
    const compactLabel = await openOutline.evaluate((button) => (
      getComputedStyle(button, '::before').content
    ));
    expect(compactLabel).toBe('"导"');
    const [panelBounds, toolbarLayout] = await Promise.all([
      panel.boundingBox(),
      pdfPage.locator('#pdf-toolbar').evaluate((toolbar) => ({
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
      })),
    ]);
    expect(panelBounds).not.toBeNull();
    expect(panelBounds?.x).toBeGreaterThanOrEqual(0);
    expect((panelBounds?.x ?? 0) + (panelBounds?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(toolbarLayout.scrollWidth).toBe(toolbarLayout.clientWidth);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-outline.png') });
    }
    await conclusion.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('6');
    await expect(panel).toBeHidden();
  } finally {
    await pdfPage.close();
  }
});

test('opens safe PDF links, navigates internal references, and returns to the source', async ({}, testInfo) => {
  const externalUrl = 'https://www.overleaf.com/pi-pdf-external-reference';
  await context.route(externalUrl, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>External paper reference</title>',
    });
  });
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 900, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'linked-paper.pdf',
      mimeType: 'application/pdf',
      buffer: createLinkedPdf(),
    });
    const firstPage = pdfPage.locator('.pdf-page[data-page-number="1"]');
    const finalPage = pdfPage.locator('.pdf-page[data-page-number="4"]');
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await expect(firstPage).toHaveAttribute('data-link-count', '3');
    await expect(finalPage).not.toHaveAttribute('data-rendered', /.+/);
    const firstPageLinks = firstPage.locator('.pdf-link-layer a');
    await expect(firstPageLinks).toHaveCount(3);
    const serializedLinks = await firstPageLinks.evaluateAll((links) => links.map((link) => ({
      href: (link as HTMLAnchorElement).href,
      rel: (link as HTMLAnchorElement).rel,
      target: (link as HTMLAnchorElement).target,
    })));
    expect(JSON.stringify(serializedLinks)).not.toMatch(/javascript|payload\.exe|evil\.example/iu);

    const internal = firstPage.locator('.pdf-link-layer a[aria-label="跳转到第 4 页"]');
    const originalBounds = await internal.boundingBox();
    await internal.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('4');
    await expect(finalPage).toHaveAttribute('data-rendered', 'ready');
    await expect(finalPage).toHaveAttribute('data-link-count', '1');
    const returnButton = pdfPage.locator('#pdf-link-return');
    await expect(returnButton).toBeVisible();
    await expect(returnButton).toHaveText('← 返回第 1 页');
    await returnButton.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('1');
    await expect(returnButton).toBeHidden();

    const namedNext = firstPage.locator('.pdf-link-layer a[aria-label="跳转到第 2 页"]');
    await namedNext.focus();
    await namedNext.press('Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    await expect(returnButton).toHaveText('← 返回第 1 页');
    await expect(returnButton).toBeFocused();
    await returnButton.click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('1');

    const external = firstPage.locator('.pdf-link-layer a[data-pdf-link-kind="external"]');
    await expect(external).toHaveAttribute('target', '_blank');
    await expect(external).toHaveAttribute('rel', /noopener/);
    const externalPagePromise = context.waitForEvent('page');
    await external.click();
    const externalPage = await externalPagePromise;
    await externalPage.waitForURL(externalUrl);
    await expect(externalPage).toHaveTitle('External paper reference');
    await externalPage.close();

    await pdfPage.locator('#zoom-in').click();
    const zoomedInternal = firstPage.locator('.pdf-link-layer a[aria-label="跳转到第 4 页"]');
    await expect(zoomedInternal).toBeVisible();
    const zoomedBounds = await zoomedInternal.boundingBox();
    expect(zoomedBounds?.width).toBeGreaterThan(originalBounds?.width ?? 0);

    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await zoomedInternal.click();
    await expect(returnButton).toBeVisible();
    const returnBounds = await returnButton.boundingBox();
    expect(returnBounds).not.toBeNull();
    expect(returnBounds?.x).toBeGreaterThanOrEqual(0);
    expect((returnBounds?.x ?? 0) + (returnBounds?.width ?? 0)).toBeLessThanOrEqual(360);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-link-return-360.png') });
    }
  } finally {
    await pdfPage.close();
    await context.unroute(externalUrl);
  }
});

test('searches every text PDF page locally and navigates highlighted matches', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 900, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'searchable-long.pdf',
      mimeType: 'application/pdf',
      buffer: createMultiPageTextPdf(Array.from({ length: 12 }, (_, index) => ({
        text: [4, 11].includes(index + 1)
          ? `Page ${index + 1} contains the local Needle result.`
          : `Ordinary content on page ${index + 1}.`,
      }))),
    });
    await expect(pdfPage.locator('#page-count')).toHaveText('12');
    await expect(pdfPage.locator('#open-search')).toBeEnabled();
    await expect(pdfPage.locator('#open-outline')).toBeVisible();
    await pdfPage.locator('#open-outline').click();
    await expect(pdfPage.locator('#pdf-navigation-outline-tab')).toBeHidden();
    await expect(pdfPage.locator('#pdf-bookmarks')).toBeVisible();
    await expect(pdfPage.locator('#pdf-bookmark-add')).toBeEnabled();
    await pdfPage.locator('#pdf-outline-close').click();
    await expect(pdfPage.locator('.pdf-page[data-page-number="11"]'))
      .not.toHaveAttribute('data-rendered', /.+/);

    await pdfPage.locator('#document-stage').press('Control+f');
    const search = pdfPage.locator('#pdf-search');
    const query = pdfPage.locator('#pdf-search-query');
    await expect(search).toBeVisible();
    await expect(query).toBeFocused();
    await query.fill('needle');
    await expect(pdfPage.locator('#pdf-search-status')).toContainText('1 / 2');
    await expect(pdfPage.locator('#page-number')).toHaveValue('4');
    const results = pdfPage.locator('#pdf-search-results');
    const resultButtons = results.locator('.pdf-search-result');
    const resultsToggle = pdfPage.locator('#pdf-search-results-toggle');
    await expect(results).toBeVisible();
    await expect(resultButtons).toHaveCount(2);
    await expect(resultButtons.nth(0)).toContainText('第 4 页');
    await expect(resultButtons.nth(0).locator('mark')).toHaveText('Needle');
    await resultsToggle.click();
    await expect(results).toBeHidden();
    await expect(resultsToggle).toHaveAttribute('aria-expanded', 'false');
    await resultsToggle.click();
    await expect(results).toBeVisible();
    const pageFour = pdfPage.locator('.pdf-page[data-page-number="4"]');
    await expect(pageFour).toHaveAttribute('data-rendered', 'ready');
    await expect(pageFour.locator('.pi-pdf-search-current')).toContainText('Needle');

    await query.press('ArrowDown');
    await expect(resultButtons.nth(0)).toBeFocused();
    await resultButtons.nth(0).press('ArrowDown');
    await expect(pdfPage.locator('#page-number')).toHaveValue('11');
    const pageEleven = pdfPage.locator('.pdf-page[data-page-number="11"]');
    await expect(pageEleven).toHaveAttribute('data-rendered', 'ready');
    await expect(pageEleven.locator('.pi-pdf-search-current')).toContainText('Needle');
    await expect(resultButtons.nth(1)).toBeFocused();
    await expect(pdfPage.locator('#pdf-search-status')).toContainText('2 / 2');
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-search.png') });
    }

    await resultButtons.nth(0).click();
    await expect(pdfPage.locator('#page-number')).toHaveValue('4');
    await query.focus();
    await query.press('Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('11');
    await query.press('Shift+Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('4');
    await query.press('Escape');
    await expect(search).toBeHidden();
    await expect(pdfPage.locator('.pi-pdf-search-match')).toHaveCount(0);
    await expect(pdfPage.locator('#document-stage')).toBeFocused();

    await pdfPage.locator('#open-search').click();
    await expect(query).toHaveValue('needle');
    await expect(pdfPage.locator('#pdf-search-status')).toContainText('/ 2');
  } finally {
    await pdfPage.close();
  }
});

test('keeps scanned PDF search local and does not start OCR automatically', async () => {
  const pdfPage = await context.newPage();
  const visionRequestsBefore = visionRequests.length;
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'scan-search.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#document-stage').press('Control+f');
    await pdfPage.locator('#pdf-search-query').fill('needle');
    await expect(pdfPage.locator('#pdf-search-status'))
      .toHaveText('当前文档没有可搜索文字');
    expect(visionRequests).toHaveLength(visionRequestsBefore);
    await expect(pdfPage.locator('#recognize-page')).toBeVisible();
  } finally {
    await pdfPage.close();
  }
});

test('keeps dense PDF search previews bounded around the current result', async () => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'dense-search.pdf',
      mimeType: 'application/pdf',
      buffer: createMultilineTextPdf(Array.from(
        { length: 30 },
        (_, index) => [1, 2, 3, 4]
          .map((column) => `Needle ${index * 4 + column}`)
          .join(' | '),
      )),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await expect(pdfPage.locator('#open-search')).toBeEnabled();
    await pdfPage.locator('#document-stage').press('Control+f');
    await pdfPage.locator('#pdf-search-query').fill('needle');
    await expect(pdfPage.locator('#pdf-search-status')).toContainText('1 / 120');
    const results = pdfPage.locator('#pdf-search-results');
    const buttons = results.locator('.pdf-search-result');
    await expect(buttons).toHaveCount(80);
    await expect(results.locator('.pdf-search-results-range'))
      .toHaveText('显示第 1–80 项 · 共 120 项');

    await pdfPage.locator('#pdf-search-query').press('ArrowDown');
    await buttons.first().press('End');
    await expect(pdfPage.locator('#pdf-search-status')).toContainText('120 / 120');
    await expect(buttons).toHaveCount(80);
    await expect(results.locator('.pdf-search-results-range'))
      .toHaveText('显示第 41–120 项 · 共 120 项');
    await expect(results.locator('[data-search-result-index="119"]')).toBeFocused();
  } finally {
    await pdfPage.close();
  }
});

test('passes a PDF hash page through the background handoff', async () => {
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/popup.html`);
  const pdfPagePromise = context.waitForEvent('page');
  const response = await sender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    return api.runtime.sendMessage({
      type: 'OPEN_PDF_VIEWER',
      payload: { url: 'https://www.overleaf.com/handoff.pdf#page=9' },
    });
  });
  expect(response).toMatchObject({ ok: true, data: { opened: true } });
  const pdfPage = await pdfPagePromise;
  await pdfPage.waitForLoadState('domcontentloaded');
  const viewerUrl = new URL(pdfPage.url());
  expect(viewerUrl.searchParams.get('url'))
    .toBe('https://www.overleaf.com/handoff.pdf#page=9');
  expect(viewerUrl.searchParams.get('page')).toBe('9');
  const viewerTabId = await pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  const worker = context.serviceWorkers()[0];
  expect(viewerTabId).toBeDefined();
  expect(worker).toBeDefined();
  await expect.poll(() => worker!.evaluate(async (tabId) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { sidePanel: { getOptions(options: { tabId: number }): Promise<{ enabled?: boolean }> } };
    }).chrome;
    return (await api.sidePanel.getOptions({ tabId: tabId! })).enabled;
  }, viewerTabId)).toBe(false);
  await pdfPage.close();
  await sender.close();
});

test('opens an inherited PDF on its requested page and keeps that page while zooming', async () => {
  const sourceUrl = 'https://www.overleaf.com/two-page-reader.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: createTwoPageTextPdf('First page.', 'Inherited second page.'),
    });
  });
  const pdfPage = await context.newPage();
  try {
    const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
    readerUrl.searchParams.set('url', sourceUrl);
    readerUrl.searchParams.set('page', '2');
    await pdfPage.goto(readerUrl.href);
    await expect(pdfPage.locator('#page-count')).toHaveText('2');
    await expect(pdfPage.locator('#page-number')).toHaveValue('2');
    const secondPage = pdfPage.locator('.pdf-page[data-page-number="2"]');
    await expect(secondPage).toHaveAttribute('data-rendered', 'ready');
    await expect(secondPage.locator('.textLayer')).toContainText('Inherited second page.');
    const pageAnchor = async (): Promise<{ page: number; ratio: number }> => pdfPage.evaluate(() => {
      const stage = document.querySelector('#document-stage');
      const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')];
      if (!(stage instanceof HTMLElement)) return { page: 0, ratio: -1 };
      const anchor = stage.getBoundingClientRect().top + 12;
      const page = pages.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= anchor && rect.bottom >= anchor;
      });
      const closest = page ?? pages.reduce<HTMLElement | undefined>((best, candidate) => {
        if (!best) return candidate;
        const rect = candidate.getBoundingClientRect();
        const bestRect = best.getBoundingClientRect();
        const distance = Math.min(Math.abs(rect.top - anchor), Math.abs(rect.bottom - anchor));
        const bestDistance = Math.min(
          Math.abs(bestRect.top - anchor),
          Math.abs(bestRect.bottom - anchor),
        );
        return distance < bestDistance ? candidate : best;
      }, undefined);
      if (!closest) return { page: 0, ratio: -1 };
      const rect = closest.getBoundingClientRect();
      return {
        page: Number(closest.dataset.pageNumber),
        ratio: Math.max(0, Math.min(1, (anchor - rect.top) / rect.height)),
      };
    });
    expect((await pageAnchor()).page).toBe(2);
    await pdfPage.evaluate(() => {
      const stage = document.querySelector('#document-stage');
      const page = document.querySelector('.pdf-page[data-page-number="2"]');
      if (stage instanceof HTMLElement && page instanceof HTMLElement) {
        stage.scrollTop += page.offsetHeight * 0.3;
      }
    });
    const beforeZoom = await pageAnchor();
    expect(beforeZoom.page).toBe(2);

    await pdfPage.locator('#zoom-in').click();
    await expect(secondPage).toHaveAttribute('data-rendered', 'ready');
    await expect.poll(async () => (await pageAnchor()).page).toBe(2);
    await expect.poll(async () => Math.abs((await pageAnchor()).ratio - beforeZoom.ratio))
      .toBeLessThan(0.08);

    await pdfPage.locator('#fit-width').click();
    await expect.poll(async () => (await pageAnchor()).page).toBe(2);
    const stageWidth = await pdfPage.locator('#document-stage').evaluate((element) => element.clientWidth);
    await expect.poll(async () => secondPage.evaluate((element) => element.getBoundingClientRect().width))
      .toBeLessThanOrEqual(stageWidth - 20);

    await pdfPage.locator('#page-number').fill('1');
    await pdfPage.locator('#page-number').press('Enter');
    await expect(pdfPage.locator('#page-number')).toHaveValue('1');
    await expect(pdfPage.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
  } finally {
    await pdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('keeps only a nearby render window and re-renders mixed-size long PDF pages', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'mixed-long.pdf',
    mimeType: 'application/pdf',
    buffer: createMultiPageTextPdf(Array.from({ length: 12 }, (_, index) => ({
      text: `Mixed page ${index + 1}.`,
      width: index % 2 === 0 ? 612 : 792,
      height: index % 2 === 0 ? 792 : 612,
    }))),
  });
  await expect(pdfPage.locator('#page-count')).toHaveText('12');
  const pageInput = pdfPage.locator('#page-number');
  await pageInput.fill('9');
  await pageInput.press('Enter');
  const pageNine = pdfPage.locator('.pdf-page[data-page-number="9"]');
  await expect(pageNine).toHaveAttribute('data-rendered', 'ready');
  await expect(pageNine.locator('.textLayer')).toContainText('Mixed page 9.');
  await expect.poll(() => pdfPage.locator('.pdf-page[data-rendered]').count()).toBeLessThanOrEqual(5);

  const pageEight = pdfPage.locator('.pdf-page[data-page-number="8"]');
  await expect(pageEight).toHaveAttribute('data-rendered', 'ready');
  const [pageEightSize, pageNineSize] = await Promise.all([
    pageEight.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight })),
    pageNine.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight })),
  ]);
  expect(pageEightSize.width).toBeGreaterThan(pageNineSize.width);
  expect(pageEightSize.height).toBeLessThan(pageNineSize.height);

  await pageInput.fill('1');
  await pageInput.press('Enter');
  const pageOne = pdfPage.locator('.pdf-page[data-page-number="1"]');
  await expect(pageOne).toHaveAttribute('data-rendered', 'ready');
  await expect(pageOne.locator('.textLayer')).toContainText('Mixed page 1.');
  await expect.poll(() => pageNine.getAttribute('data-rendered')).toBeNull();
  expect(await pageNine.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBe(0);
  await pdfPage.close();
});

test('opens a local PDF and exposes selectable text to the translator', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.setViewportSize({ width: 900, height: 700 });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'selectable-paper.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Selectable PDF text for translation.'),
  });

  await expect(pdfPage.locator('#document-name')).toHaveText('selectable-paper.pdf');
  await expect(pdfPage.locator('#page-count')).toHaveText('1');
  await expect(pdfPage.locator('#page-number')).toHaveValue('1');
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await expect(pdfPage.locator('#choose-file')).toHaveText('更换 PDF');
  await expect(pdfPage.locator('#choose-file')).toHaveAttribute(
    'aria-label',
    '更换当前 PDF 文档',
  );
  await expect(firstPage.locator('.textLayer')).toContainText('Selectable PDF text for translation.');
  const canvasDensity = await firstPage.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.width / canvas.getBoundingClientRect().width;
  });
  expect(canvasDensity).toBeGreaterThanOrEqual(1.9);

  await firstPage.locator('.textLayer span').first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.body')).not.toBeEmpty();
  const [toolbarBox, cardBox] = await Promise.all([
    pdfPage.locator('#pdf-toolbar').boundingBox(),
    overlay.locator('.card').boundingBox(),
  ]);
  expect(toolbarBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  if (toolbarBox && cardBox) {
    expect(cardBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height + 10);
  }
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-reader.png') });
  }
  await pdfPage.close();
});

test('keeps the PDF toolbar clear and usable at narrow widths', async () => {
  const pdfPage = await context.newPage();
  const longName = [
    'A-very-long-academic-paper-title-with-supplementary-results',
    'and-appendices-2026.pdf',
  ].join('-');
  try {
    await pdfPage.setViewportSize({ width: 900, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: longName,
      mimeType: 'application/pdf',
      buffer: createTextPdf('Narrow PDF toolbar layout.'),
    });
    await expect(pdfPage.locator('.pdf-page').first()).toHaveAttribute('data-rendered', 'ready');
    await expect(pdfPage.locator('#document-name')).toHaveAttribute('title', longName);
    await expect(pdfPage.locator('.brand')).toHaveAttribute('title', longName);

    await pdfPage.setViewportSize({ width: 420, height: 700 });
    await expect(pdfPage.locator('.brand img')).toBeVisible();
    await expect(pdfPage.locator('.brand > span')).toBeHidden();
    const compactActions = await pdfPage.locator('.region-action').evaluateAll((buttons) =>
      buttons.map((button) => ({
        label: button.textContent?.trim(),
        compactLabel: getComputedStyle(button, '::before').content,
        fontSize: getComputedStyle(button).fontSize,
      })),
    );
    expect(compactActions).toEqual([
      { label: '识别本页', compactLabel: '"识"', fontSize: '0px' },
      { label: '框选翻译', compactLabel: '"框"', fontSize: '0px' },
    ]);
    const regionButton = pdfPage.locator('#region-translate');
    await regionButton.click();
    await expect(regionButton).toHaveAttribute('aria-pressed', 'true');
    expect(await regionButton.evaluate((button) =>
      getComputedStyle(button, '::before').content)).toBe('"框"');

    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await expect(pdfPage.locator('.zoom-controls output')).toBeHidden();
    const layout = await pdfPage.locator('#pdf-toolbar').evaluate((toolbar) => {
      const visibleChildren = [...toolbar.children]
        .filter((child) => child instanceof HTMLElement && getComputedStyle(child).display !== 'none');
      const toolbarBounds = toolbar.getBoundingClientRect();
      return {
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        childrenFit: visibleChildren.every((child) => {
          const bounds = child.getBoundingClientRect();
          return bounds.left >= toolbarBounds.left && bounds.right <= toolbarBounds.right;
        }),
      };
    });
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.childrenFit).toBe(true);
    const chooseFileBox = await pdfPage.locator('#choose-file').boundingBox();
    expect(chooseFileBox?.height).toBeLessThanOrEqual(32);

    await pdfPage.locator('#open-search').click();
    await pdfPage.locator('#pdf-search-query').fill('toolbar');
    await expect(pdfPage.locator('#pdf-search-results')).toBeVisible();
    const searchLayout = await pdfPage.locator('#pdf-search').evaluate((search) => {
      const bounds = search.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        scrollWidth: search.scrollWidth,
        clientWidth: search.clientWidth,
      };
    });
    expect(searchLayout.left).toBeGreaterThanOrEqual(0);
    expect(searchLayout.right).toBeLessThanOrEqual(360);
    expect(searchLayout.scrollWidth).toBe(searchLayout.clientWidth);
  } finally {
    await pdfPage.close();
  }
});

test('returns to the same Pi PDF selection after text API configuration recovery', async () => {
  const sourceText = 'Pi PDF recovery keeps this selection.';
  const pdfPage = await context.newPage();
  let options: Page | undefined;
  await replaceStoredApiKeys({ 'vision-e2e': 'e2e-vision-key' });
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'pi-pdf-recovery.pdf',
      mimeType: 'application/pdf',
      buffer: createTextPdf(sourceText),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await expect(firstPage.locator('.textLayer')).toContainText(sourceText);
    await firstPage.locator('.textLayer span').first().evaluate((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.error')).toContainText('API Key');

    const optionsPromise = context.waitForEvent('page');
    await overlay.getByRole('button', { name: '配置 API' }).click();
    options = await optionsPromise;
    await options.waitForLoadState('domcontentloaded');
    await expect(options.locator('#settings-recovery-title'))
      .toHaveText('完成文字 API 配置后继续');
    await expect(options.locator('#api-key')).toBeFocused();

    await options.locator('#api-key').fill('e2e-pi-pdf-recovery-key');
    await options.locator('#refresh-models').click();

    await expect(overlay.locator('.body')).toHaveText(
      '一致的学术翻译能够提升研究论文的可读性。',
    );
    await expect(options.locator('#settings-recovery-status'))
      .toContainText('已返回原页面并继续翻译');
    await expect(pdfPage.locator('#document-name')).toHaveText('pi-pdf-recovery.pdf');
    await expect(firstPage.locator('.textLayer')).toContainText(sourceText);
  } finally {
    await replaceStoredApiKeys({
      default: 'e2e-key',
      'vision-e2e': 'e2e-vision-key',
    });
    if (options && !options.isClosed()) await options.close();
    if (!pdfPage.isClosed()) await pdfPage.close();
  }
});

test('keeps the PDF selection sidebar and full-document panel mutually exclusive', async () => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 1200, height: 800 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'exclusive-pdf-sidebars.pdf',
      mimeType: 'application/pdf',
      buffer: createTextPdf(
        'A focused translation result remains available while document translation is previewed.',
      ),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    const textSpan = firstPage.locator('.textLayer span').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    const selectPdfText = async (): Promise<void> => {
      await textSpan.evaluate((span) => {
        const range = document.createRange();
        range.selectNodeContents(span);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
    };

    await selectPdfText();
    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const requestsAfterSelection = textRequests.length;

    const documentPanel = pdfPage.locator('#pdf-document-translation');
    await pdfPage.locator('#translate-document').click();
    await expect(documentPanel).toBeVisible();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 1 段，等待确认');
    expect(textRequests).toHaveLength(requestsAfterSelection);
    await expect.poll(() => pdfPage.locator('#document-stage').evaluate((stage) => ({
      selectionSidebar: stage.style.getPropertyValue('--pdf-sidebar-right'),
      documentSidebar: stage.style.getPropertyValue('--pdf-document-sidebar-right'),
    }))).toEqual({ selectionSidebar: '0px', documentSidebar: '390px' });

    await selectPdfText();
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(documentPanel).toBeVisible();
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(documentPanel).toBeHidden();
    await expect(pdfPage.locator('#translate-document')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => pdfPage.locator('#document-stage').evaluate((stage) => ({
      selectionSidebar: stage.style.getPropertyValue('--pdf-sidebar-right'),
      documentSidebar: stage.style.getPropertyValue('--pdf-document-sidebar-right'),
    }))).toEqual({ selectionSidebar: '410px', documentSidebar: '0px' });

    await pdfPage.locator('#translate-document').click();
    await expect(documentPanel).toBeVisible();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await expect(pdfPage.locator('#pdf-document-translation-status'))
      .toContainText('已识别 1 段，等待确认');
    expect(textRequests).toHaveLength(requestsAfterSelection);
  } finally {
    if (!pdfPage.isClosed()) await pdfPage.close();
  }
});

test('centers a fit-width PDF inside the space left by the translation sidebar', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.setViewportSize({ width: 1200, height: 800 });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'sidebar-layout.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Fit width follows the available PDF reading area.'),
  });
  const stage = pdfPage.locator('#document-stage');
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await pdfPage.locator('#fit-width').click();
  await expect.poll(() => firstPage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeGreaterThan(1100);

  await firstPage.locator('.textLayer span').first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.sidebar-region-action')).toHaveCount(0);

  await expect.poll(() => stage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeLessThan(850);
  await expect.poll(() => firstPage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeLessThan(780);
  await expect.poll(() => pdfPage.evaluate(() => {
    const stageElement = document.querySelector<HTMLElement>('#document-stage')!;
    const stageRect = stageElement.getBoundingClientRect();
    const pageRect = document.querySelector('.pdf-page')!.getBoundingClientRect();
    return Math.abs(
      (pageRect.left + pageRect.width / 2) - (stageRect.left + stageElement.clientWidth / 2),
    );
  })).toBeLessThan(3);
  await expect.poll(() => pdfPage.evaluate(() => {
    const stageElement = document.querySelector<HTMLElement>('#document-stage')!;
    const pageRect = document.querySelector('.pdf-page')!.getBoundingClientRect();
    return Math.abs(pageRect.width - (stageElement.clientWidth - 68));
  })).toBeLessThan(3);

  await overlay.getByTitle('收起侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  await expect.poll(() => stage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeGreaterThan(1150);
  await expect.poll(() => firstPage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeGreaterThan(1100);
  await expect.poll(() => pdfPage.evaluate(() => {
    const stageElement = document.querySelector<HTMLElement>('#document-stage')!;
    const stageRect = stageElement.getBoundingClientRect();
    const pageRect = document.querySelector('.pdf-page')!.getBoundingClientRect();
    return Math.abs(
      (pageRect.left + pageRect.width / 2) - (stageRect.left + stageElement.clientWidth / 2),
    );
  })).toBeLessThan(3);
  await pdfPage.close();
});

test('restores a PDF reading position, zoom, and fixed sidebar without storing its URL', async () => {
  const sourceUrl = 'https://www.overleaf.com/private-reading-state.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createTwoPageTextPdf('Reading state page one.', 'Reading state page two.'),
    });
  });
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  const firstReader = await context.newPage();
  try {
    await firstReader.goto(readerUrl.href);
    await expect(firstReader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    const pageInput = firstReader.locator('#page-number');
    await pageInput.fill('2');
    await pageInput.press('Enter');
    await expect(firstReader.locator('.pdf-page[data-page-number="2"]'))
      .toHaveAttribute('data-rendered', 'ready');
    await firstReader.locator('#zoom-in').click();
    await expect(firstReader.locator('#zoom-value')).toHaveText('150%');

    const secondPageText = firstReader.locator(
      '.pdf-page[data-page-number="2"] .textLayer span',
    ).first();
    await secondPageText.evaluate((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = firstReader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await firstReader.waitForTimeout(700);
  } finally {
    await firstReader.close();
  }

  const restoredReader = await context.newPage();
  try {
    await restoredReader.goto(readerUrl.href);
    await expect(restoredReader.locator('#document-name'))
      .toHaveText('private-reading-state.pdf');
    await expect(restoredReader.locator('#page-number')).toHaveValue('2');
    await expect(restoredReader.locator('#zoom-value')).toHaveText('150%');
    await expect(restoredReader.locator('#tex-selection-translator-root'))
      .toHaveAttribute('data-pi-view', 'sidebar');
    const serializedStorage = await restoredReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: null): Promise<Record<string, unknown>> } } };
      }).chrome;
      return JSON.stringify(await api.storage.local.get(null));
    });
    expect(serializedStorage).not.toContain('private-reading-state.pdf');
    expect(serializedStorage).not.toContain(sourceUrl);
  } finally {
    await restoredReader.close();
    await context.unroute(sourceUrl);
  }
});

test('saves editable PDF reading bookmarks locally by anonymous document identity', async ({}, testInfo) => {
  const sourceUrl = 'https://www.overleaf.com/private-reading-bookmarks.pdf';
  const otherSourceUrl = 'https://www.overleaf.com/other-reading-bookmarks.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createMultiPageTextPdf([
        { text: 'Private bookmark page one.' },
        { text: 'Private bookmark page two.' },
        { text: 'Private bookmark page three.' },
      ]),
    });
  });
  await context.route(otherSourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createTextPdf('A different document has no saved bookmark.'),
    });
  });
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  const firstReader = await context.newPage();
  try {
    await firstReader.goto(readerUrl.href);
    await expect(firstReader.locator('#page-count')).toHaveText('3');
    await firstReader.locator('#page-number').fill('2');
    await firstReader.locator('#page-number').press('Enter');
    await expect(firstReader.locator('#page-number')).toHaveValue('2');
    await firstReader.locator('#open-outline').click();
    await expect(firstReader.locator('#pdf-bookmarks')).toBeVisible();
    const add = firstReader.locator('#pdf-bookmark-add');
    await add.click();
    await expect(add).toHaveText('✓ 当前页已添加');
    await expect(add).toBeDisabled();
    const item = firstReader.locator('.pdf-bookmark-item');
    await expect(item).toHaveCount(1);
    await expect(item).toHaveClass(/is-current/);
    await item.locator('.pdf-bookmark-edit').click();
    await item.locator('input[aria-label="书签名称"]').fill('实验结果');
    await item.locator('textarea[aria-label="书签备注"]').fill('复查图 2 的对比结果');
    await item.locator('.pdf-bookmark-editor .save').click();
    await expect(item).toContainText('实验结果');
    await expect(item).toContainText('复查图 2 的对比结果');
    await firstReader.setViewportSize({ width: 360, height: 700 });
    const [panelBounds, toolbarLayout] = await Promise.all([
      firstReader.locator('#pdf-outline').boundingBox(),
      firstReader.locator('#pdf-toolbar').evaluate((toolbar) => ({
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
      })),
    ]);
    expect(panelBounds).not.toBeNull();
    expect(panelBounds?.x).toBeGreaterThanOrEqual(0);
    expect((panelBounds?.x ?? 0) + (panelBounds?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(toolbarLayout.scrollWidth).toBe(toolbarLayout.clientWidth);
    if (process.env.PI_VISUAL_QA) {
      await firstReader.screenshot({ path: testInfo.outputPath('pdf-bookmarks.png') });
    }
    await expect.poll(async () => firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.local.get('piPdfReadingBookmarksV1');
      return JSON.stringify(stored.piPdfReadingBookmarksV1 ?? {}).includes('实验结果');
    })).toBe(true);
    const serializedBookmarks = await firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return JSON.stringify((await api.storage.local.get('piPdfReadingBookmarksV1'))
        .piPdfReadingBookmarksV1 ?? {});
    });
    expect(serializedBookmarks).not.toContain('private-reading-bookmarks.pdf');
    expect(serializedBookmarks).not.toContain(sourceUrl);
    expect(serializedBookmarks).not.toContain('Private bookmark page two');
  } finally {
    await firstReader.close();
  }

  const restoredReader = await context.newPage();
  try {
    await restoredReader.goto(readerUrl.href);
    await restoredReader.locator('#open-outline').click();
    const restoredItem = restoredReader.locator('.pdf-bookmark-item');
    await expect(restoredItem).toHaveCount(1);
    await expect(restoredItem).toContainText('实验结果');
    await expect(restoredItem).toContainText('复查图 2 的对比结果');
    await restoredReader.locator('#page-number').fill('1');
    await restoredReader.locator('#page-number').press('Enter');
    await restoredItem.locator('.pdf-bookmark-jump').click();
    await expect(restoredReader.locator('#page-number')).toHaveValue('2');
    await restoredItem.locator('.pdf-bookmark-delete').click();
    await expect(restoredReader.locator('.pdf-bookmark-item')).toHaveCount(0);
  } finally {
    await restoredReader.close();
  }

  const otherReaderUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  otherReaderUrl.searchParams.set('url', otherSourceUrl);
  const otherReader = await context.newPage();
  try {
    await otherReader.goto(otherReaderUrl.href);
    await otherReader.locator('#open-outline').click();
    await expect(otherReader.locator('.pdf-bookmark-item')).toHaveCount(0);
  } finally {
    await otherReader.close();
    await context.unroute(sourceUrl);
    await context.unroute(otherSourceUrl);
  }
});

test('optionally restores and clears persistent Pi PDF translation markers', async () => {
  const sourceUrl = 'https://www.overleaf.com/persistent-translation-markers.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createTextPdf('Persistent PDF marker source sentence.'),
    });
  });
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  const firstReader = await context.newPage();
  try {
    await firstReader.goto(readerUrl.href);
    const text = firstReader.locator('.pdf-page[data-page-number="1"] .textLayer span').first();
    await expect(text).toBeVisible();
    await text.evaluate((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = firstReader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).not.toBeEmpty();
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '标记当前译句并保存' }).click();
    await expect(firstReader.locator('#pi-translation-marker-layer').locator('.marker').first())
      .toBeVisible();
    await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => firstReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.local.get('piPdfTranslationMarkersV1');
      return JSON.stringify(stored).includes('Persistent PDF marker source sentence.');
    })).toBe(true);
  } finally {
    await firstReader.close();
  }

  const restoredReader = await context.newPage();
  try {
    await restoredReader.goto(readerUrl.href);
    await expect(restoredReader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    const markerLayer = restoredReader.locator('#pi-translation-marker-layer');
    const marker = markerLayer.locator('.marker').first();
    await expect(marker).toBeVisible();
    const markerBounds = await waitForVisibleBoundingBox(marker, 'the restored PDF marker');
    await restoredReader.mouse.move(
      markerBounds.x + markerBounds.width / 2,
      markerBounds.y + markerBounds.height / 2,
    );
    await expect(markerLayer.locator('.tooltip'))
      .toContainText('一致的学术翻译能够提升研究论文的可读性。');
    await restoredReader.mouse.click(
      markerBounds.x + markerBounds.width / 2,
      markerBounds.y + markerBounds.height / 2,
    );
    const overlay = restoredReader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.locator('details.more > summary').click();
    await expect(overlay.getByRole('button', { name: '停止保存本文标记' })).toBeVisible();
    await overlay.getByRole('button', { name: '查看本文标记（1）' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const markerNote = overlay.locator('.marker-note').first();
    await expect(markerNote).toContainText('第 1 页');
    await expect(markerNote).toContainText('Persistent PDF marker source sentence.');
    await expect(markerNote).toContainText('一致的学术翻译能够提升研究论文的可读性。');
    await markerNote.getByRole('button', { name: '复制这条标记' }).click();
    await expect(markerNote.getByRole('button', { name: '复制这条标记' })).toHaveText('已复制');
    await markerNote.getByRole('button', { name: '跳转到原文' }).click();
    await expect(markerLayer.locator('.marker.focused')).toBeVisible();
    await markerNote.getByRole('button', { name: '删除这条标记' }).click();
    await expect(markerLayer.locator('.marker')).toHaveCount(1);
    await markerNote.getByRole('button', { name: '再次点击删除这条标记' }).click();
    await expect(overlay).toContainText('本文暂无标记');
    await expect(markerLayer.locator('.marker')).toHaveCount(0);

    const serializedStorage = await restoredReader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: { get(key: null): Promise<Record<string, unknown>> } } };
      }).chrome;
      return JSON.stringify(await api.storage.local.get(null));
    });
    expect(serializedStorage).not.toContain(sourceUrl);
  } finally {
    await restoredReader.close();
  }

  const clearedReader = await context.newPage();
  try {
    await clearedReader.goto(readerUrl.href);
    await expect(clearedReader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    await expect(clearedReader.locator('#pi-translation-marker-layer').locator('.marker'))
      .toHaveCount(0);
  } finally {
    await clearedReader.close();
    await context.unroute(sourceUrl);
  }
});

test('keeps 100 persistent markers responsive across a long lazily rendered PDF', async () => {
  const sourceUrl = 'https://www.overleaf.com/long-marker-stress.pdf';
  const pages = Array.from({ length: 100 }, (_, index) => ({
    text: `Unique persistent marker sentence on page ${index + 1}.`,
  }));
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createMultiPageTextPdf(pages),
    });
  });
  const identity = new URL(sourceUrl).href;
  const documentId = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  const markers = pages.map((entry, index) => ({
    markerId: `stress-marker-${index + 1}`,
    anchor: {
      kind: 'text-quote',
      pageNumber: index + 1,
      sourceText: entry.text,
      prefix: '',
      suffix: '',
    },
    content: {
      originalText: entry.text,
      translatedText: `第 ${index + 1} 页的压力测试译文。`,
      sourceTitle: 'long-marker-stress.pdf',
      pageNumber: index + 1,
    },
    createdAt: index + 1,
  }));
  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${extensionId}/popup.html`);
  await seed.evaluate(async ({ id, storedMarkers }) => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    await api.storage.local.set({
      piPdfTranslationMarkersV1: {
        [id]: { enabled: true, markers: storedMarkers, updatedAt: Date.now() },
      },
    });
  }, { id: documentId, storedMarkers: markers });
  await seed.close();

  const reader = await context.newPage();
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  try {
    await reader.goto(readerUrl.href);
    await expect(reader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    const markerLayer = reader.locator('#pi-translation-marker-layer');
    const firstMarker = markerLayer.locator('.marker').first();
    await expect(firstMarker).toBeVisible();
    const bounds = await waitForVisibleBoundingBox(firstMarker, 'the first persistent PDF marker');
    await reader.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

    const overlay = reader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '查看本文标记（100）' }).click();
    await expect(overlay.locator('.marker-note')).toHaveCount(100);
    await expect(overlay.locator('.marker-notes-toolbar')).toContainText('100 条');

    const lastMarker = overlay.locator('.marker-note').last();
    await expect(lastMarker).toContainText('第 100 页');
    await expect(lastMarker).toContainText('点击定位');
    await lastMarker.getByRole('button', { name: '跳转到原文' }).click();
    await expect(reader.locator('#page-number')).toHaveValue('100');
    await expect(reader.locator('.pdf-page[data-page-number="100"]'))
      .toHaveAttribute('data-rendered', 'ready');
    await expect(markerLayer.locator('.marker.focused')).toBeVisible();
    await expect(lastMarker).not.toContainText('点击定位');
    await expect.poll(() => reader.locator('.pdf-page[data-rendered="ready"]').count())
      .toBeLessThanOrEqual(5);
  } finally {
    await reader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      await api.storage.local.set({ piPdfTranslationMarkersV1: {} });
    }).catch(() => undefined);
    await reader.close();
    await context.unroute(sourceUrl);
  }
});

test('keeps narrow PDF marker notes readable and reveals the marked source', async ({}, testInfo) => {
  const sourceUrl = 'https://www.overleaf.com/narrow-marker-notes.pdf';
  const anchorText = 'Narrow PDF marker source sentence.';
  const sourceText = 'A narrow marker preserves an '
    + 'ExtremelyLongAcademicIdentifierWithoutNaturalBreakpoints for later review.';
  const translatedText = '这条较长的标记译文用于核对窄屏下的截断、复制、定位与删除焦点是否保持清晰。';
  const missingSourceText = 'The original sentence changed after this marker was saved.';
  const missingTranslatedText = '这条标记的原文位置已经变化，但仍应允许跳回原页并安全清理。';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      contentType: 'application/pdf',
      body: createTextPdf(anchorText),
    });
  });
  const identity = new URL(sourceUrl).href;
  const documentId = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${extensionId}/popup.html`);
  await seed.evaluate(async ({
    id,
    anchor,
    originalText,
    targetText,
    missingOriginalText,
    missingTargetText,
  }) => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    await api.storage.local.set({
      piPdfTranslationMarkersV1: {
        [id]: {
          enabled: true,
          markers: [
            {
              markerId: 'narrow-marker-note',
              anchor: {
                kind: 'text-quote',
                pageNumber: 1,
                sourceText: anchor,
                prefix: '',
                suffix: '',
              },
              content: {
                originalText,
                translatedText: targetText,
                sourceTitle: 'narrow-marker-notes.pdf',
                pageNumber: 1,
              },
              createdAt: 1,
            },
            {
              markerId: 'missing-marker-note',
              anchor: {
                kind: 'text-quote',
                pageNumber: 1,
                sourceText: 'This sentence no longer exists in the PDF.',
                prefix: '',
                suffix: '',
              },
              content: {
                originalText: missingOriginalText,
                translatedText: missingTargetText,
                sourceTitle: 'narrow-marker-notes.pdf',
                pageNumber: 1,
              },
              createdAt: 2,
            },
          ],
          updatedAt: Date.now(),
        },
      },
    });
  }, {
    id: documentId,
    anchor: anchorText,
    originalText: sourceText,
    targetText: translatedText,
    missingOriginalText: missingSourceText,
    missingTargetText: missingTranslatedText,
  });
  await seed.close();

  const reader = await context.newPage();
  const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
  readerUrl.searchParams.set('url', sourceUrl);
  try {
    await reader.setViewportSize({ width: 360, height: 700 });
    await reader.goto(readerUrl.href);
    await expect(reader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    const initialZoom = await reader.locator('#zoom-value').textContent();
    await reader.locator('#fit-width').click();
    await expect(reader.locator('#zoom-value')).not.toHaveText(initialZoom ?? '');
    await expect(reader.locator('.pdf-page[data-page-number="1"]'))
      .toHaveAttribute('data-rendered', 'ready');
    const markerLayer = reader.locator('#pi-translation-marker-layer');
    const sourceMarker = markerLayer.locator('.marker').first();
    await expect(sourceMarker).toBeVisible();
    const markerBounds = await waitForVisibleBoundingBox(
      sourceMarker,
      'the narrow PDF source marker',
    );
    await reader.mouse.click(
      markerBounds.x + Math.min(markerBounds.width / 2, 40),
      markerBounds.y + markerBounds.height / 2,
    );

    const overlay = reader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '查看本文标记（2）' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(overlay.locator('.marker-note')).toHaveCount(2);
    const markerNote = overlay.locator('.marker-note').filter({ hasText: sourceText });
    const missingMarkerNote = overlay.locator('.marker-note').filter({ hasText: missingSourceText });
    await expect(markerNote).toContainText(sourceText);
    await expect(markerNote).toContainText(translatedText);
    await expect(missingMarkerNote).toContainText('原文位置已变化');
    await expect(missingMarkerNote).toContainText(missingTranslatedText);
    const missingMarkerMain = missingMarkerNote.getByRole('button', {
      name: '原文位置已变化，仍可跳转到原页',
    });
    expect(await missingMarkerMain.evaluate((element) => getComputedStyle(element).cursor))
      .toBe('pointer');
    const layout = await overlay.locator('.surface').evaluate((surface) => {
      const toolbar = surface.querySelector<HTMLElement>('.marker-notes-toolbar');
      const note = surface.querySelector<HTMLElement>('.marker-note');
      const main = surface.querySelector<HTMLElement>('.marker-note-main');
      const buttons = [...surface.querySelectorAll<HTMLElement>('.marker-note-actions button')];
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        toolbarClientWidth: toolbar?.clientWidth ?? 0,
        toolbarScrollWidth: toolbar?.scrollWidth ?? 0,
        noteRight: note?.getBoundingClientRect().right ?? Infinity,
        surfaceRight: surface.getBoundingClientRect().right,
        mainClientWidth: main?.clientWidth ?? 0,
        mainScrollWidth: main?.scrollWidth ?? 0,
        buttonSizes: buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await reader.screenshot({ path: testInfo.outputPath('pdf-marker-notes-360-light.png') });
      await reader.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await reader.screenshot({ path: testInfo.outputPath('pdf-marker-notes-360-dark.png') });
      await reader.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.toolbarScrollWidth).toBeLessThanOrEqual(layout.toolbarClientWidth + 1);
    expect(layout.noteRight).toBeLessThanOrEqual(layout.surfaceRight);
    expect(layout.mainScrollWidth).toBeLessThanOrEqual(layout.mainClientWidth + 1);
    expect(layout.buttonSizes.every(({ width, height }) => width >= 32 && height >= 32)).toBe(true);

    const copy = markerNote.getByRole('button', { name: '复制这条标记' });
    await copy.click();
    await expect(copy).toHaveText('已复制');
    const copyAll = overlay.getByRole('button', { name: '复制本文标记为 Markdown' });
    await copyAll.click();
    await expect(copyAll).toHaveText('已复制 2 条');

    await markerNote.getByRole('button', { name: '跳转到原文' }).click();
    await expect(markerLayer.locator('.marker.focused')).toBeVisible();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    if (process.env.PI_VISUAL_QA) {
      await reader.screenshot({ path: testInfo.outputPath('pdf-marker-source-360-light.png') });
    }
    await overlay.getByRole('button', { name: '展开 Pi Translator 本文标记侧栏' }).click();
    await expect(overlay.getByRole('button', { name: '返回翻译结果' })).toBeFocused();
    const removeReady = overlay.locator('.marker-note').filter({ hasText: sourceText })
      .getByRole('button', { name: '删除这条标记' });
    await removeReady.click();
    const confirmRemove = overlay.locator('.marker-note').filter({ hasText: sourceText })
      .getByRole('button', { name: '再次点击删除这条标记' });
    await expect(confirmRemove).toHaveText('确认');
    if (process.env.PI_VISUAL_QA) {
      await reader.screenshot({ path: testInfo.outputPath('pdf-marker-delete-confirm-360-light.png') });
    }
    await expect(overlay.locator('.marker-note')).toHaveCount(2);
    await confirmRemove.click();
    await expect(overlay.locator('.marker-note')).toHaveCount(1);
    const remainingMarker = overlay.locator('.marker-note').filter({ hasText: missingSourceText });
    const remainingMarkerMain = remainingMarker.locator('.marker-note-main');
    await expect(remainingMarkerMain).toBeFocused();
    await expect(markerLayer.locator('.marker')).toHaveCount(0);

    await remainingMarkerMain.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await expect(reader.locator('#page-number')).toHaveValue('1');
    await overlay.getByRole('button', { name: '展开 Pi Translator 本文标记侧栏' }).click();
    await overlay.getByRole('button', { name: '返回翻译结果' }).click();

    const more = overlay.locator('details.more > summary');
    await more.click();
    const clear = overlay.getByRole('button', { name: '清除本文标记' });
    await clear.click();
    const confirmClear = overlay.getByRole('button', { name: '再次点击清除全部本文标记' });
    await expect(confirmClear).toHaveText('再次点击清除全部');
    if (process.env.PI_VISUAL_QA) {
      await reader.screenshot({ path: testInfo.outputPath('pdf-marker-clear-confirm-360-light.png') });
    }
    await expect(overlay.getByRole('button', { name: '查看本文标记（1）' })).toBeVisible();
    await confirmClear.click();
    await expect(more).toBeFocused();
    await more.click();
    await expect(overlay.getByRole('button', { name: '查看本文标记（1）' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: '清除本文标记' })).toHaveCount(0);
    await expect.poll(() => reader.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('piPdfTranslationMarkersV1');
      return JSON.stringify(stored.piPdfTranslationMarkersV1?.[id] ?? {}).includes(
        'missing-marker-note',
      );
    }, documentId)).toBe(false);
  } finally {
    await reader.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      await api.storage.local.set({ piPdfTranslationMarkersV1: {} });
    }).catch(() => undefined);
    await reader.close();
    await context.unroute(sourceUrl);
  }
});

test('protects and previews selections in a real two-column PDF', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const leftLines = [
    'Left column sentence one.',
    'Left column sentence two.',
    'Left column sentence three.',
  ];
  const rightLines = [
    'Right column sentence one.',
    'Right column sentence two.',
    'Right column sentence three.',
  ];
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'two-column-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createTwoColumnTextPdf(leftLines, rightLines),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const spans = firstPage.locator('.textLayer span');
  await expect(spans).toHaveCount(6);
  const points = await firstPage.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('.pdf-page .textLayer');
    const textSpans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const left = textSpans[0]?.getBoundingClientRect();
    const right = textSpans[4]?.getBoundingClientRect();
    if (!layer || !left || !right) throw new Error('Two-column PDF text geometry is missing');
    const layerBounds = layer.getBoundingClientRect();
    return {
      start: { x: left.left + 5, y: left.top + left.height / 2 },
      gutter: { x: (left.right + right.left) / 2, y: right.top + right.height / 2 },
      right: { x: right.left + Math.min(20, right.width / 2), y: right.top + right.height / 2 },
      layerWidth: layerBounds.width,
      geometry: textSpans.map((span) => {
        const bounds = span.getBoundingClientRect();
        return {
          text: span.textContent,
          left: Math.round(bounds.left - layerBounds.left),
          right: Math.round(bounds.right - layerBounds.left),
          top: Math.round(bounds.top - layerBounds.top),
          bottom: Math.round(bounds.bottom - layerBounds.top),
        };
      }),
    };
  });
  expect(points.layerWidth).toBeGreaterThan(500);

  const performCrossColumnGesture = (endPoint: { x: number; y: number }) => pdfPage.evaluate(({
    startPoint,
    endPoint: gestureEnd,
  }) => {
    const textSpans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const start = textSpans[0]?.firstChild;
    const end = textSpans[4]?.firstChild;
    if (!(start instanceof Text) || !(end instanceof Text)) {
      throw new Error('Two-column PDF text nodes are missing');
    }
    textSpans[0]!.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: startPoint.x,
      clientY: startPoint.y,
      isPrimary: true,
      pointerId: 41,
      pointerType: 'mouse',
    }));
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.data.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    textSpans[0]!.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: gestureEnd.x,
      clientY: gestureEnd.y,
      isPrimary: true,
      pointerId: 41,
      pointerType: 'mouse',
    }));
  }, { startPoint: points.start, endPoint });

  await performCrossColumnGesture(points.gutter);
  await expect.poll(() => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  )), { message: JSON.stringify(points.geometry) }).not.toContain('Right column');
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.selection-preview')).toBeVisible();
  await expect(overlay.locator('.selection-preview-text')).toContainText('Left column');
  await expect(overlay.locator('.selection-preview-warning')).toContainText('已保留左栏');
  await expect(pdfPage.locator('#notice')).toContainText('已保留起始栏内容');

  await performCrossColumnGesture(points.right);
  await expect.poll(() => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  ))).toContain('Right column sentence two.');
  await expect(overlay.locator('.selection-preview-warning')).toContainText('跨栏选区');
  await expect(overlay.locator('.selection-preview-warning')).toContainText('PDF 原始顺序');
  await expect(pdfPage.locator('#notice')).toContainText('请先核对选区预览');
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('two-column-selection-preview.png') });
  }
  await pdfPage.close();
});

test('opens and replaces local PDFs by dropping one file at a time', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.setViewportSize({ width: 360, height: 700 });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await expect(pdfPage.locator('#empty-state small')).toContainText('拖到此处');
  const dropOverlay = pdfPage.locator('#pdf-drop-overlay');
  await expect(dropOverlay).toBeHidden();

  const textTransfer = await pdfPage.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'ordinary text drag');
    return transfer;
  });
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: textTransfer });
  await expect(dropOverlay).toBeHidden();
  await textTransfer.dispose();

  const firstTransfer = await createFileDataTransfer(pdfPage, [{
    name: 'dropped-paper.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('First dropped PDF document.'),
  }]);
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: firstTransfer });
  await expect(dropOverlay).toBeVisible();
  await expect(pdfPage.locator('#pdf-drop-title')).toHaveText('松开以打开 PDF');
  await expect(dropOverlay).toHaveAttribute('data-tone', 'ready');
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-drop-empty-360-light.png') });
  }
  await pdfPage.dispatchEvent('body', 'dragleave', { dataTransfer: firstTransfer });
  await expect(dropOverlay).toBeHidden();
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: firstTransfer });
  await pdfPage.dispatchEvent('body', 'dragover', { dataTransfer: firstTransfer });
  await pdfPage.dispatchEvent('body', 'drop', { dataTransfer: firstTransfer });
  await firstTransfer.dispose();
  await expect(dropOverlay).toBeHidden();
  await expect(pdfPage.locator('#document-name')).toHaveText('dropped-paper.pdf');
  await expect(pdfPage.locator('.textLayer')).toContainText('First dropped PDF document.');

  const replacementTransfer = await createFileDataTransfer(pdfPage, [{
    name: 'replacement-paper.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Replacement PDF document.'),
  }]);
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: replacementTransfer });
  await expect(pdfPage.locator('#pdf-drop-title')).toHaveText('松开以更换当前 PDF');
  await pdfPage.dispatchEvent('body', 'drop', { dataTransfer: replacementTransfer });
  await replacementTransfer.dispose();
  await expect(pdfPage.locator('#document-name')).toHaveText('replacement-paper.pdf');
  await expect(pdfPage.locator('.textLayer')).toContainText('Replacement PDF document.');

  const invalidTransfer = await createFileDataTransfer(pdfPage, [{
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a PDF'),
  }]);
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: invalidTransfer });
  await expect(pdfPage.locator('#pdf-drop-title')).toHaveText('这里只能打开 PDF');
  await expect(dropOverlay).toHaveAttribute('data-tone', 'invalid');
  await pdfPage.dispatchEvent('body', 'drop', { dataTransfer: invalidTransfer });
  await invalidTransfer.dispose();
  await expect(pdfPage.locator('#notice')).toContainText('不是 PDF 文件');
  await expect(pdfPage.locator('#document-name')).toHaveText('replacement-paper.pdf');

  const multipleTransfer = await createFileDataTransfer(pdfPage, [{
    name: 'one.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('One.'),
  }, {
    name: 'two.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Two.'),
  }]);
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: multipleTransfer });
  await expect(pdfPage.locator('#pdf-drop-title')).toHaveText('一次只能打开一份 PDF');
  await pdfPage.dispatchEvent('body', 'drop', { dataTransfer: multipleTransfer });
  await multipleTransfer.dispose();
  await expect(pdfPage.locator('#notice')).toContainText('一次只能打开一份 PDF');
  await expect(pdfPage.locator('#document-name')).toHaveText('replacement-paper.pdf');

  const damagedTransfer = await createFileDataTransfer(pdfPage, [{
    name: 'damaged.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('renamed but not actually a PDF'),
  }]);
  await pdfPage.dispatchEvent('body', 'dragenter', { dataTransfer: damagedTransfer });
  await pdfPage.dispatchEvent('body', 'drop', { dataTransfer: damagedTransfer });
  await damagedTransfer.dispose();
  await expect(pdfPage.locator('#notice')).toContainText('可能已损坏');
  await expect(pdfPage.locator('#document-name')).toHaveText('replacement-paper.pdf');
  await expect(pdfPage.locator('.textLayer')).toContainText('Replacement PDF document.');

  await pdfPage.close();
});

test('retains an explicitly traversed spanning formula in a real two-column PDF', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const formula = 'Spanning equation: E = m c^2 + lambda ||x||^2 = 1. (1)';
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'two-column-spanning-formula.pdf',
    mimeType: 'application/pdf',
    buffer: createTwoColumnTextPdf(
      [
        'Left column sentence one.',
        'Left column sentence two.',
        'Left column sentence three.',
      ],
      [
        'Right column sentence one.',
        'Right column sentence two.',
        'Right column sentence three.',
      ],
      [{ text: formula, x: 120, y: 620 }],
    ),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await expect(firstPage.locator('.textLayer span')).toHaveCount(7);
  const points = await firstPage.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const left = spans.find((span) => span.textContent === 'Left column sentence one.');
    const right = spans.find((span) => span.textContent === 'Right column sentence one.');
    const spanning = spans.find((span) => span.textContent?.startsWith('Spanning equation:'));
    const leftBounds = left?.getBoundingClientRect();
    const rightBounds = right?.getBoundingClientRect();
    const spanningBounds = spanning?.getBoundingClientRect();
    if (!left || !right || !spanning || !leftBounds || !rightBounds || !spanningBounds) {
      throw new Error(`Spanning-formula PDF text geometry is missing: ${spans.map((span) => span.textContent).join(' | ')}`);
    }
    return {
      start: { x: leftBounds.left + 5, y: leftBounds.top + leftBounds.height / 2 },
      end: {
        x: (leftBounds.right + rightBounds.left) / 2,
        y: spanningBounds.top + spanningBounds.height / 2,
      },
      leftIndex: spans.indexOf(left),
      rightIndex: spans.indexOf(right),
      spanningIndex: spans.indexOf(spanning),
      spanningCrossesGutter: (
        spanningBounds.left < leftBounds.right && spanningBounds.right > rightBounds.left
      ),
    };
  });
  expect(points.spanningCrossesGutter).toBe(true);
  expect(points.leftIndex).toBeLessThan(points.spanningIndex);
  expect(points.spanningIndex).toBeLessThan(points.rightIndex);

  await pdfPage.evaluate(({ startPoint, endPoint }) => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const left = spans.find((span) => span.textContent === 'Left column sentence one.');
    const right = spans.find((span) => span.textContent === 'Right column sentence one.');
    const formulaSpan = spans.find((span) => span.textContent?.startsWith('Spanning equation:'));
    const start = left?.firstChild;
    const end = right?.firstChild;
    if (!(left instanceof HTMLElement) || !(formulaSpan instanceof HTMLElement) ||
      !(start instanceof Text) || !(end instanceof Text)) {
      throw new Error('Spanning-formula PDF text nodes are missing');
    }
    left.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: startPoint.x,
      clientY: startPoint.y,
      isPrimary: true,
      pointerId: 51,
      pointerType: 'mouse',
    }));
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.data.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    formulaSpan.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: endPoint.x,
      clientY: endPoint.y,
      isPrimary: true,
      pointerId: 51,
      pointerType: 'mouse',
    }));
  }, { startPoint: points.start, endPoint: points.end });

  await expect.poll(() => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  ))).toContain(formula);
  await expect.poll(() => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  ))).not.toContain('Right column');
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.selection-preview-text')).toContainText('Spanning equation');
  await expect(overlay.locator('.selection-preview-warning')).toContainText('横跨两栏的内容');
  await expect(pdfPage.locator('#notice')).toContainText('选中的通栏内容');
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('spanning-formula-selection-preview.png') });
  }
  await pdfPage.close();
});

test('detects a real PDF table and converts its text drag into an adjustable box', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'table-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createTableTextPdf([
      ['Method', 'Accuracy', 'Latency'],
      ['Baseline', '91.2%', '42 ms'],
      ['Pi model', '94.8%', '31 ms'],
    ]),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await expect.poll(() => firstPage.locator('.textLayer span').count()).toBeGreaterThanOrEqual(9);
  const points = await firstPage.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const first = spans.find((span) => span.textContent === 'Method');
    const last = spans.find((span) => span.textContent === '31 ms');
    const firstBounds = first?.getBoundingClientRect();
    const lastBounds = last?.getBoundingClientRect();
    if (!first || !last || !firstBounds || !lastBounds) {
      throw new Error(`PDF table cells are missing: ${spans.map((span) => span.textContent).join(' | ')}`);
    }
    return {
      start: { x: firstBounds.left + 2, y: firstBounds.top + firstBounds.height / 2 },
      end: { x: lastBounds.right - 2, y: lastBounds.top + lastBounds.height / 2 },
      firstIndex: spans.indexOf(first),
      lastIndex: spans.indexOf(last),
    };
  });
  expect(points.firstIndex).toBe(0);
  expect(points.lastIndex).toBeGreaterThan(points.firstIndex);

  await pdfPage.evaluate(({ startPoint, endPoint }) => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const first = spans.find((span) => span.textContent === 'Method');
    const last = spans.find((span) => span.textContent === '31 ms');
    const start = first?.firstChild;
    const end = last?.firstChild;
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement) ||
      !(start instanceof Text) || !(end instanceof Text)) {
      throw new Error('PDF table text nodes are missing');
    }
    first.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: startPoint.x,
      clientY: startPoint.y,
      isPrimary: true,
      pointerId: 61,
      pointerType: 'mouse',
    }));
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.data.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    last.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: endPoint.x,
      clientY: endPoint.y,
      isPrimary: true,
      pointerId: 61,
      pointerType: 'mouse',
    }));
  }, { startPoint: points.start, endPoint: points.end });

  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.selection-preview-warning'))
    .toContainText('表格或多列内容');
  await expect(pdfPage.locator('#notice')).toContainText('划词顺序可能不可靠');
  const useBox = overlay.getByRole('button', { name: '改用框选' });
  await expect(useBox).toBeVisible();
  await useBox.click();

  const region = firstPage.locator('.region-selection-box');
  const confirmation = firstPage.getByRole('group', { name: '框选翻译确认' });
  await expect(region).toBeVisible();
  await expect(region).toBeFocused();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  await expect(confirmation).toContainText('检测到表格或多列内容');
  await expect(confirmation.getByRole('button', { name: '发送并翻译' })).toBeVisible();
  await expect.poll(() => pdfPage.evaluate(() => window.getSelection()?.isCollapsed ?? true))
    .toBe(true);
  const regionBounds = await region.boundingBox();
  expect(regionBounds?.width ?? 0).toBeGreaterThan(300);
  expect(regionBounds?.height ?? 0).toBeGreaterThan(40);
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('table-selection-box-guidance.png') });
  }
  await pdfPage.close();
});

test('does not auto-send a detected PDF table from the continuous sidebar', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'table-sidebar-safety.pdf',
    mimeType: 'application/pdf',
    buffer: createTableTextPdf([
      ['Method', 'Accuracy', 'Latency'],
      ['Baseline', '91.2%', '42 ms'],
      ['Pi model', '94.8%', '31 ms'],
    ]),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await pdfPage.evaluate(() => {
    const cell = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')]
      .find((span) => span.textContent === 'Method');
    const text = cell?.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF table anchor cell is missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.trigger')).toBeVisible();
  await overlay.locator('.trigger').click();
  await expect(overlay.getByRole('button', { name: '在页面侧栏中显示' })).toBeVisible();
  await overlay.getByRole('button', { name: '在页面侧栏中显示' }).click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const requestsAfterPin = textRequests.length;

  const points = await firstPage.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const first = spans.find((span) => span.textContent === 'Method');
    const last = spans.find((span) => span.textContent === '31 ms');
    const firstBounds = first?.getBoundingClientRect();
    const lastBounds = last?.getBoundingClientRect();
    if (!firstBounds || !lastBounds) throw new Error('PDF table bounds are missing');
    return {
      start: { x: firstBounds.left + 2, y: firstBounds.top + firstBounds.height / 2 },
      end: { x: lastBounds.right - 2, y: lastBounds.top + lastBounds.height / 2 },
    };
  });
  await pdfPage.evaluate(({ startPoint, endPoint }) => {
    const spans = [...document.querySelectorAll<HTMLElement>('.pdf-page .textLayer span')];
    const first = spans.find((span) => span.textContent === 'Method');
    const last = spans.find((span) => span.textContent === '31 ms');
    const start = first?.firstChild;
    const end = last?.firstChild;
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement) ||
      !(start instanceof Text) || !(end instanceof Text)) {
      throw new Error('PDF table text nodes are missing');
    }
    first.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: startPoint.x,
      clientY: startPoint.y,
      isPrimary: true,
      pointerId: 62,
      pointerType: 'mouse',
    }));
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.data.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    last.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      clientX: endPoint.x,
      clientY: endPoint.y,
      isPrimary: true,
      pointerId: 62,
      pointerType: 'mouse',
    }));
  }, { startPoint: points.start, endPoint: points.end });

  await expect(pdfPage.locator('#notice')).toContainText('本次没有自动发送');
  await pdfPage.waitForTimeout(500);
  expect(textRequests).toHaveLength(requestsAfterPin);
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await pdfPage.close();
});

test('keeps PDF selection UI quiet until a native text-layer drag finishes', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'drag-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Native PDF drag selection remains under user control.'),
  });

  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textLayer = firstPage.locator('.textLayer');
  await expect(textLayer.locator('.endOfContent')).toHaveCount(1);
  const textSpan = textLayer.locator('span').first();
  const dragPoints = await textSpan.evaluate((span) => {
    const text = span.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF text span has no text node');
    const pointAt = (offset: number) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    };
    return { start: pointAt(2), end: pointAt(13) };
  });

  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await pdfPage.mouse.move(dragPoints.start.x, dragPoints.start.y);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 10 });
  await expect.poll(() => pdfPage.evaluate(() => window.getSelection()?.toString() ?? ''))
    .not.toBe('');
  await expect(textLayer).toHaveClass(/selecting/);
  await pdfPage.waitForTimeout(300);
  await expect(overlay).not.toHaveAttribute('data-pi-view', 'trigger');

  await pdfPage.mouse.up();
  await expect.poll(() => pdfPage.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('Native PDF drag');
  await expect(textLayer).not.toHaveClass(/selecting/);
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).not.toBeEmpty();
  const markAction = overlay.locator('.mark-action');
  await expect(markAction).toBeEnabled();
  await markAction.click();
  await expect(pdfPage.locator('#pi-translation-marker-layer .marker').first()).toBeVisible();
  expect(await pdfPage.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await pdfPage.close();
});

test('snaps a longer Pi PDF drag to one complete sentence', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const source = 'Previous sentence. Smart sentence selection follows the user drag. Final sentence.';
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'sentence-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf(source),
  });

  const textSpan = pdfPage.locator('.pdf-page').first().locator('.textLayer span').first();
  await expect(textSpan).toContainText(
    'Previous sentence. Smart sentence selection follows the user drag.',
  );
  const dragPoints = await textSpan.evaluate((span) => {
    const text = span.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF text span has no text node');
    const pointAt = (offset: number) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    };
    return { start: pointAt(23), end: pointAt(58) };
  });

  await pdfPage.mouse.move(dragPoints.start.x, dragPoints.start.y);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 12 });
  await pdfPage.mouse.up();
  await expect.poll(() => pdfPage.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('Smart sentence selection follows the user drag.');
  await pdfPage.close();
});

test('treats PDF visual line wraps as part of the same sentence', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const firstLine = 'This method reconstructs a scene from measurements';
  const secondLine = 'and remains stable under noise. Next sentence.';
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'visual-line-wrap.pdf',
    mimeType: 'application/pdf',
    buffer: createMultilineTextPdf([firstLine, secondLine]),
  });

  const spans = pdfPage.locator('.pdf-page').first().locator('.textLayer span');
  await expect(spans).toHaveCount(2);
  const dragPoints = await spans.first().evaluate((span) => {
    const text = span.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF text span has no text node');
    const pointAt = (offset: number) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    };
    return { start: pointAt(5), end: pointAt(text.data.length) };
  });

  await pdfPage.mouse.move(dragPoints.start.x, dragPoints.start.y);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(dragPoints.end.x, dragPoints.end.y, { steps: 12 });
  await pdfPage.mouse.up();
  await expect.poll(() => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  ))).toBe(`${firstLine} and remains stable under noise.`);
  await pdfPage.close();
});

test('keeps a partial punctuation-free PDF selection instead of expanding to the page', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const lines = Array.from({ length: 9 }, (_, index) => (
    `line ${index + 1} contains academic text without a terminal mark`
  ));
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'respect-raw-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createMultilineTextPdf(lines),
  });
  const spans = pdfPage.locator('.pdf-page').first().locator('.textLayer span');
  await expect(spans).toHaveCount(lines.length);
  const start = await spans.nth(3).evaluate((span) => {
    const text = span.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF text span has no text node');
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  });
  const end = await spans.nth(4).evaluate((span) => {
    const text = span.firstChild;
    if (!(text instanceof Text)) throw new Error('PDF text span has no text node');
    const range = document.createRange();
    range.setStart(text, 24);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  });
  await pdfPage.mouse.move(start.x, start.y);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(end.x, end.y, { steps: 12 });
  await pdfPage.mouse.up();
  const readSelection = () => pdfPage.evaluate(() => (
    window.getSelection()?.toString().replace(/\s+/gu, ' ').trim() ?? ''
  ));
  await expect.poll(readSelection).toContain('4 contains academic text');
  const selected = await readSelection();
  expect(selected).toContain('4 contains academic text');
  expect(selected).toContain('line 5');
  expect(selected).not.toContain('line 1');
  expect(selected).not.toContain('line 9');
  await pdfPage.close();
});

test('keeps a manually opened PDF when an older inherited request finishes later', async () => {
  const slowUrl = 'https://www.overleaf.com/slow-inherited.pdf';
  let releaseRoute: (() => void) | undefined;
  let markRequested: (() => void) | undefined;
  const routeRequested = new Promise<void>((resolve) => { markRequested = resolve; });
  const routeGate = new Promise<void>((resolve) => { releaseRoute = resolve; });
  await context.route(slowUrl, async (route) => {
    markRequested?.();
    await routeGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Older inherited document.'),
    }).catch(() => undefined);
  });
  const pdfPage = await context.newPage();
  try {
    const readerUrl = new URL(`chrome-extension://${extensionId}/pdf.html`);
    readerUrl.searchParams.set('url', slowUrl);
    await pdfPage.goto(readerUrl.href);
    await routeRequested;
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'latest-local.pdf',
      mimeType: 'application/pdf',
      buffer: createTextPdf('Latest local document.'),
    });
    await expect(pdfPage.locator('#document-name')).toHaveText('latest-local.pdf');
    releaseRoute?.();
    await pdfPage.waitForTimeout(250);
    await expect(pdfPage.locator('#document-name')).toHaveText('latest-local.pdf');
    await expect(pdfPage.locator('.pdf-page').first().locator('.textLayer'))
      .toContainText('Latest local document.');
    await expect(pdfPage.locator('#empty-state')).toBeHidden();
  } finally {
    releaseRoute?.();
    await pdfPage.close();
    await context.unroute(slowUrl);
  }
});
