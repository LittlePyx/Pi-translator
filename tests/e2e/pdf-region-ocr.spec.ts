import type { Route } from '@playwright/test';
import {
  context,
  createRasterPdf,
  createTextPdf,
  expect,
  extensionId,
  installEdgeExtensionHooks,
  mockControl,
  OVERLEAF_FIXTURE_URL,
  page,
  test,
  textRequests,
  visionRequests,
  waitForVisibleBoundingBox,
  type TestChromeApi,
} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('translates a confirmed PDF image region without storing the screenshot', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'scanned-region.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await expect(firstPage).toHaveAttribute('data-has-text', 'false');
  const requestCount = visionRequests.length;
  const scanHint = pdfPage.locator('#notice');
  await expect(scanHint).toHaveClass(/transient/);
  await expect(scanHint).toHaveAttribute('data-tone', 'warning');
  await expect(scanHint).toHaveAttribute('role', 'status');
  await expect(scanHint).toHaveAttribute('aria-atomic', 'true');
  await expect(scanHint).toContainText('扫描版 PDF');
  const recognizePage = scanHint.getByRole('button', {
    name: '识别第 1 页并生成临时文字层',
  });
  await expect(recognizePage).toBeVisible();
  expect(await scanHint.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  expect(visionRequests).toHaveLength(requestCount);
  await pdfPage.setViewportSize({ width: 360, height: 700 });
  const scanHintLayout = await scanHint.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const action = element.querySelector<HTMLElement>('.notice-action');
    return {
      left: bounds.left,
      right: bounds.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      actionHeight: action?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(scanHintLayout.left).toBeGreaterThanOrEqual(13);
  expect(scanHintLayout.right).toBeLessThanOrEqual(347);
  expect(scanHintLayout.scrollWidth).toBe(scanHintLayout.clientWidth);
  expect(scanHintLayout.actionHeight).toBeGreaterThanOrEqual(28);
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-scan-hint-360-light.png') });
    await pdfPage.emulateMedia({ colorScheme: 'dark' });
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-scan-hint-360-dark.png') });
    await pdfPage.emulateMedia({ colorScheme: 'light' });
  }
  await pdfPage.setViewportSize({ width: 1280, height: 720 });

  await recognizePage.click();
  const suggestedRegion = firstPage.locator('.region-selection-box');
  await expect(suggestedRegion).toBeVisible();
  const [pageBounds, suggestedBounds] = await Promise.all([
    firstPage.boundingBox(),
    suggestedRegion.boundingBox(),
  ]);
  expect(pageBounds).not.toBeNull();
  expect(suggestedBounds).not.toBeNull();
  if (!pageBounds || !suggestedBounds) return;
  expect(suggestedBounds.width / pageBounds.width).toBeGreaterThan(0.93);
  expect(suggestedBounds.height / pageBounds.height).toBeGreaterThan(0.93);
  await expect(firstPage.locator('.region-confirm-note')).toContainText('仅发送本页选定区域');
  await firstPage.getByRole('button', { name: '取消' }).click();
  expect(visionRequests).toHaveLength(requestCount);

  const regionButton = pdfPage.locator('#region-translate');
  await regionButton.click();
  await expect(regionButton).toHaveAttribute('aria-pressed', 'true');
  const pageBox = await firstPage.boundingBox();
  expect(pageBox).not.toBeNull();
  if (!pageBox) return;
  await pdfPage.mouse.move(pageBox.x + 170, pageBox.y + 220);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(pageBox.x + Math.min(430, pageBox.width - 30), pageBox.y + 430, {
    steps: 8,
  });
  await pdfPage.mouse.up();

  await expect(firstPage.locator('.region-confirm')).toBeVisible();
  await expect(firstPage.locator('.region-confirm-note'))
    .toHaveText('优先本地提取文字，必要时仅发送此区域');
  expect(visionRequests).toHaveLength(requestCount);
  const selectionBox = firstPage.locator('.region-selection-box');
  const initialSelection = await selectionBox.boundingBox();
  expect(initialSelection).not.toBeNull();
  if (!initialSelection) return;
  await pdfPage.mouse.move(
    initialSelection.x + initialSelection.width / 2,
    initialSelection.y + initialSelection.height / 2,
  );
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(
    initialSelection.x + initialSelection.width / 2 + 24,
    initialSelection.y + initialSelection.height / 2 - 16,
    { steps: 4 },
  );
  await pdfPage.mouse.up();
  const movedSelection = await selectionBox.boundingBox();
  expect(movedSelection).not.toBeNull();
  if (!movedSelection) return;
  expect(movedSelection.x).toBeCloseTo(initialSelection.x + 24, 0);
  expect(movedSelection.y).toBeCloseTo(initialSelection.y - 16, 0);
  expect(movedSelection.width).toBeCloseTo(initialSelection.width, 0);
  expect(visionRequests).toHaveLength(requestCount);

  const southeastHandle = selectionBox.locator('[data-region-handle="se"]');
  const handleBox = await southeastHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (!handleBox) return;
  await pdfPage.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(
    handleBox.x + handleBox.width / 2 + 32,
    handleBox.y + handleBox.height / 2 + 24,
    { steps: 4 },
  );
  await pdfPage.mouse.up();
  const resizedSelection = await selectionBox.boundingBox();
  expect(resizedSelection).not.toBeNull();
  if (!resizedSelection) return;
  expect(resizedSelection.width).toBeGreaterThan(movedSelection.width + 25);
  expect(resizedSelection.height).toBeGreaterThan(movedSelection.height + 18);
  expect(visionRequests).toHaveLength(requestCount);

  const overlay = pdfPage.locator('#tex-selection-translator-root');
  mockControl.returnPendingVisionReviewOnce = true;
  await firstPage.locator('.region-confirm .confirm').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.error')).toHaveCount(0);
  await expect.poll(() => visionRequests.length).toBe(requestCount + 1);
  const request = visionRequests.at(-1) as {
    model?: string;
    messages?: Array<{ content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
  };
  expect(request.model).toBe('e2e-vision-model');
  const image = request.messages?.[0]?.content?.find((item) => item.type === 'image_url');
  expect(image?.image_url?.url).toMatch(/^data:image\/(?:png|jpeg);base64,/);
  const crop = await pdfPage.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl!;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const center = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
    ).data;
    return { width: canvas.width, height: canvas.height, center: [...center] };
  }, image?.image_url?.url);
  expect(crop.width).toBeGreaterThan(100);
  expect(crop.width).toBeLessThan(1_000);
  expect(crop.height).toBeGreaterThan(100);
  expect(crop.center.slice(0, 3)).not.toEqual([255, 255, 255]);

  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.source-badge')).toHaveText('图像识别');
  await expect(overlay.locator('.body')).toHaveText('图像区域的学术翻译结果。');
  await expect(overlay.locator('.recognized-source')).not.toHaveAttribute('open', '');
  await expect.poll(() => pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
    }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    return JSON.stringify(stored.documentTranslationMemoryV1 ?? {}).includes(
      'The formula subscript is not fully legible.',
    );
  })).toBe(true);
  const serializedPendingMemory = await pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
    }).chrome;
    return JSON.stringify(await api.storage.local.get('documentTranslationMemoryV1'));
  });
  expect(serializedPendingMemory).not.toContain('data:image/');
  expect(serializedPendingMemory).not.toContain(image?.image_url?.url?.slice(-80) ?? 'never-match');
  await overlay.getByRole('button', { name: '返回 PDF 原选区' }).click();
  await expect(firstPage.locator('.region-source-highlight')).toBeVisible();

  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.recognized-text')).toHaveText('Scanned academic source text.');
  const copySource = overlay.getByRole('button', { name: '复制原文' });
  await copySource.click();
  await expect(overlay.getByRole('button', { name: '已复制' })).toBeVisible();

  await overlay.locator('.mark-action').click();
  const sourceMarker = pdfPage.locator('#pi-translation-marker-layer .marker').first();
  await expect(sourceMarker).toBeVisible();

  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const documentButton = overlay.locator('.document-memory-action');
  await expect(documentButton).toHaveText('本文 · 待核对 1');
  await documentButton.click();
  const pendingSection = overlay.locator('.document-section').filter({ hasText: '待核对' });
  await expect(pendingSection).toBeVisible();
  await expect(pendingSection).toContainText('Scanned academic source text.');
  await expect(pendingSection.getByText('返回区域', { exact: true })).toBeVisible();
  await expect(pendingSection.getByText('打开结果', { exact: true })).toBeVisible();
  await expect(pendingSection.getByText('重新识别', { exact: true })).toBeVisible();
  await expect(pendingSection.getByText('已核对', { exact: true })).toBeVisible();

  mockControl.returnRevisedVisionResultOnce = true;
  await pendingSection.getByText('重新识别', { exact: true }).click();
  await expect.poll(() => visionRequests.length).toBe(requestCount + 2);
  await expect(overlay.locator('.body')).toHaveText('重新识别后修正的学术翻译结果。');
  const cleanDocumentButton = overlay.locator('.document-memory-action');
  await expect(cleanDocumentButton).toHaveText('本文');
  await cleanDocumentButton.click();
  await expect(overlay.locator('.document-section').filter({ hasText: '待核对' }))
    .toHaveCount(0);
  await overlay.getByTitle('返回翻译结果').click();
  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.recognized-text')).toHaveText('Re-recognized academic source text.');
  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
  await expect(sourceMarker).toBeVisible();
  const sourceMarkerBox = await waitForVisibleBoundingBox(
    sourceMarker,
    'the refreshed PDF source marker',
  );
  await pdfPage.mouse.move(
    sourceMarkerBox.x + sourceMarkerBox.width / 2,
    sourceMarkerBox.y + sourceMarkerBox.height / 2,
  );
  const sourceTooltip = pdfPage.locator('#pi-translation-marker-layer .tooltip');
  await expect(sourceTooltip.locator('.tooltip-text'))
    .toHaveText('重新识别后修正的学术翻译结果。');
  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '查看本文标记（1）' }).click();
  await expect(overlay.locator('.marker-note')).toHaveCount(1);
  await expect(overlay.locator('.marker-note-source'))
    .toHaveText('Re-recognized academic source text.');
  await expect(overlay.locator('.marker-note-target'))
    .toHaveText('重新识别后修正的学术翻译结果。');
  await overlay.getByRole('button', { name: '返回翻译结果' }).click();
  const repeatedRequest = visionRequests.at(-1) as {
    messages?: Array<{ content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
  };
  const repeatedImage = repeatedRequest.messages?.[0]?.content?.find(
    (item) => item.type === 'image_url',
  )?.image_url?.url;
  expect(repeatedImage).toBe(image?.image_url?.url);
  await overlay.locator('details.more > summary').click();
  await expect(overlay.getByRole('button', { name: '重新识别此区域' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '重新翻译' })).toHaveCount(0);
  await overlay.locator('details.more > summary').click();

  const rememberedImageTranslations = await pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
    }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    const memories = Object.values(
      (stored.documentTranslationMemoryV1 ?? {}) as Record<string, {
        recentTranslations?: Array<{ originalText?: string; translatedText?: string }>;
      }>,
    );
    const currentMemory = memories.find((memory) => (
      memory.recentTranslations?.some((entry) => (
        entry.originalText === 'Re-recognized academic source text.' &&
        entry.translatedText === '重新识别后修正的学术翻译结果。'
      ))
    ));
    return (currentMemory?.recentTranslations ?? []).filter((entry) => (
      entry.originalText === 'Scanned academic source text.' ||
      entry.originalText === 'Re-recognized academic source text.'
    ));
  });
  expect(rememberedImageTranslations).toEqual([expect.objectContaining({
    originalText: 'Re-recognized academic source text.',
    translatedText: '重新识别后修正的学术翻译结果。',
  })]);

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '调整原选区' }).click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  await expect(firstPage.locator('.region-selection-box')).toBeVisible();
  const restoredSelection = await firstPage.locator('.region-selection-box').boundingBox();
  const restoredPageBox = await firstPage.boundingBox();
  expect(restoredSelection).not.toBeNull();
  expect(restoredPageBox).not.toBeNull();
  if (!restoredSelection || !restoredPageBox) return;
  expect(restoredSelection.x - restoredPageBox.x).toBeCloseTo(
    resizedSelection.x - pageBox.x,
    0,
  );
  expect(restoredSelection.y - restoredPageBox.y).toBeCloseTo(
    resizedSelection.y - pageBox.y,
    0,
  );
  expect(restoredSelection.width).toBeCloseTo(resizedSelection.width, 0);
  expect(restoredSelection.height).toBeCloseTo(resizedSelection.height, 0);
  await firstPage.locator('.region-confirm .confirm').click();
  await expect(overlay.locator('.cache-badge')).toHaveText('会话缓存');
  await expect(overlay.locator('.meta')).not.toContainText(/(?:毫秒|秒)/);
  await expect(overlay.locator('.body')).toHaveText('重新识别后修正的学术翻译结果。');
  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.recognized-text')).toHaveText('Re-recognized academic source text.');
  await overlay.locator('.recognized-source summary').click();
  expect(visionRequests).toHaveLength(requestCount + 2);

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '调整原选区' }).click();
  const adjustedSelection = firstPage.locator('.region-selection-box');
  await expect(adjustedSelection).toBeVisible();
  await adjustedSelection.press('ArrowRight');
  await firstPage.locator('.region-confirm .confirm').click();
  await expect.poll(() => visionRequests.length).toBe(requestCount + 3);
  await expect(overlay.locator('.source-badge')).toHaveText('图像识别');

  await overlay.locator('.recognized-source summary').click();
  await overlay.getByRole('button', { name: '编辑后重译' }).click();
  let recognizedEditor = overlay.getByRole('textbox', { name: '编辑识别原文' });
  await expect(recognizedEditor).toHaveValue('Scanned academic source text.');
  await recognizedEditor.press('Escape');
  await expect(recognizedEditor).toBeHidden();
  await expect(overlay.locator('.recognized-source summary')).toBeFocused();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await overlay.locator('.recognized-source summary').click();
  await overlay.getByRole('button', { name: '编辑后重译' }).click();
  recognizedEditor = overlay.getByRole('textbox', { name: '编辑识别原文' });
  await recognizedEditor.fill('Corrected academic source text.');
  await overlay.getByRole('button', { name: '用修正文本重译' }).click();
  await expect(overlay.locator('.body')).toHaveText('一致的学术翻译能够提升研究论文的可读性。');
  await expect(overlay.locator('.source-badge')).toHaveText('文字提取');
  expect(visionRequests).toHaveLength(requestCount + 3);

  const serializedStorage = await pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: { get(key: null): Promise<Record<string, unknown>> };
          session: { get(key: null): Promise<Record<string, unknown>> };
        };
      };
    }).chrome;
    const [local, session] = await Promise.all([
      api.storage.local.get(null),
      api.storage.session.get(null),
    ]);
    return JSON.stringify({ local, session });
  });
  expect(serializedStorage).not.toContain('data:image/');
  expect(serializedStorage).not.toContain(image?.image_url?.url?.slice(-80) ?? 'never-match');
  await pdfPage.close();
});

test('creates a selectable temporary OCR layer for a confirmed scanned PDF page', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.addInitScript(() => {
    const runtime = (globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage: (message: unknown, ...args: unknown[]) => Promise<unknown>;
        };
      };
    }).chrome.runtime;
    const original = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (message: unknown, ...args: unknown[]) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'RECOGNIZE_PDF_PAGE'
      ) {
        return Promise.resolve({
          ok: true,
          data: {
            page: {
              pageNumber: 1,
              coordinateSystem: 'normalized-page',
              source: 'qwen-advanced-recognition',
              blocks: [
                {
                  id: 'e2e-ocr-line',
                  order: 0,
                  text: 'Selectable scanned academic sentence.',
                  confidence: 0.9,
                  confidenceSource: 'trusted-adapter',
                  kind: 'text',
                  rotationDegrees: 0,
                  box: { left: 0.1, top: 0.2, width: 0.7, height: 0.06 },
                },
                {
                  id: 'e2e-ocr-formula',
                  order: 1,
                  text: 'x = A y + lambda R(x)',
                  confidence: 0.9,
                  confidenceSource: 'trusted-adapter',
                  kind: 'formula',
                  rotationDegrees: 0,
                  box: { left: 0.2, top: 0.3, width: 0.4, height: 0.06 },
                },
                {
                  id: 'e2e-ocr-rotated',
                  order: 2,
                  text: 'Rotated margin note.',
                  confidence: 0.9,
                  confidenceSource: 'trusted-adapter',
                  kind: 'text',
                  rotationDegrees: 90,
                  box: { left: 0.02, top: 0.2, width: 0.04, height: 0.5 },
                },
              ],
            },
          },
        });
      }
      return original(message, ...args);
    };
  });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'scanned-ocr.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-has-text', 'false');
  await expect(pdfPage.getByRole('button', {
    name: '识别第 1 页并生成临时文字层',
  })).toBeVisible();
  const recognizeCurrentPage = pdfPage.locator('#recognize-page');
  await expect(recognizeCurrentPage).toBeVisible();
  await recognizeCurrentPage.click();
  await expect(firstPage.locator('.region-confirm-note')).toContainText('qwen3.5-ocr');
  await firstPage.getByRole('button', { name: '识别文字' }).click();
  const ocrLine = firstPage.locator('[data-pi-ocr-block="e2e-ocr-line"]');
  await expect(ocrLine).toHaveText('Selectable scanned academic sentence.');
  await expect(firstPage.locator('[data-pi-ocr-block="e2e-ocr-formula"]')).toHaveCount(0);
  await expect(firstPage.locator('[data-pi-ocr-block="e2e-ocr-rotated"]')).toHaveCount(0);
  await expect(firstPage).toHaveAttribute('data-has-text', 'true');
  await expect(pdfPage.locator('#notice')).toContainText('临时文字层');
  await expect(pdfPage.locator('#notice')).toHaveAttribute('data-tone', 'success');
  await ocrLine.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => pdfPage.evaluate(
    () => window.getSelection()?.toString().trim(),
  )).toBe('Selectable scanned academic sentence.');

  await pdfPage.locator('#document-stage').press('Control+f');
  const searchQuery = pdfPage.locator('#pdf-search-query');
  await searchQuery.fill('scanned academic');
  await expect(pdfPage.locator('#pdf-search-status')).toContainText('1 / 1');
  const ocrSearchResult = pdfPage.locator('#pdf-search-results .pdf-search-result');
  await expect(ocrSearchResult).toHaveCount(1);
  await expect(ocrSearchResult).toContainText('Selectable scanned academic sentence.');
  await expect(ocrSearchResult.locator('mark')).toHaveText('scanned academic');
  await expect(ocrLine).toHaveClass(/pi-pdf-search-current/);
  await searchQuery.press('Escape');

  await pdfPage.locator('#zoom-in').click();
  await expect(firstPage.locator('[data-pi-ocr-block="e2e-ocr-line"]'))
    .toHaveText('Selectable scanned academic sentence.');
  await expect(recognizeCurrentPage).toBeVisible();
  await recognizeCurrentPage.click();
  await expect(firstPage.locator('.region-confirm')).toBeVisible();
  await firstPage.getByRole('button', { name: '取消' }).click();
  await expect(firstPage.locator('.region-confirm')).toHaveCount(0);

  await pdfPage.locator('#file-input').setInputFiles({
    name: 'new-scanned.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const replacementPage = pdfPage.locator('.pdf-page').first();
  await expect(replacementPage).toHaveAttribute('data-rendered', 'ready');
  await expect(replacementPage.locator('[data-pi-ocr-block]')).toHaveCount(0);
  await expect(replacementPage).toHaveAttribute('data-has-text', 'false');
  await expect(recognizeCurrentPage).toBeVisible();
  await pdfPage.close();
});

test('uses reliable PDF text inside a box before falling back to vision and reuses it', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'smart-region.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Smart region text extraction.'),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textSpan = firstPage.locator('.textLayer span').filter({ hasText: 'Smart region text extraction.' });
  await expect(textSpan).toBeVisible();
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;
  const regionButton = pdfPage.locator('#region-translate');
  await regionButton.click();

  const drawAroundText = async (): Promise<void> => {
    const bounds = await textSpan.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await pdfPage.mouse.move(bounds.x - 5, bounds.y - 5);
    await pdfPage.mouse.down();
    await pdfPage.mouse.move(bounds.x + bounds.width + 5, bounds.y + bounds.height + 5, {
      steps: 5,
    });
    await pdfPage.mouse.up();
    await expect(firstPage.locator('.region-confirm')).toBeVisible();
    await firstPage.locator('.region-confirm .confirm').click();
  };

  await drawAroundText();
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.source-badge')).toHaveText('文字提取');
  await expect(overlay.locator('.recognized-source summary')).toHaveText('查看提取原文');
  await expect(overlay.locator('.body')).toHaveText('一致的学术翻译能够提升研究论文的可读性。');
  await expect.poll(() => textRequests.length).toBe(initialTextRequests + 1);
  expect(visionRequests).toHaveLength(initialVisionRequests);
  await overlay.getByRole('button', { name: '返回 PDF 原选区' }).click();
  await expect(firstPage.locator('.region-source-highlight')).toBeVisible();

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '调整原选区' }).click();
  await expect(firstPage.locator('.region-selection-box')).toBeVisible();
  await firstPage.locator('.region-confirm .confirm').click();
  await expect(overlay.locator('.cache-badge')).toHaveText('会话缓存');
  expect(textRequests).toHaveLength(initialTextRequests + 1);
  expect(visionRequests).toHaveLength(initialVisionRequests);

  await overlay.locator('.mark-action').click();
  const markerLayer = pdfPage.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await expect(marker).toBeVisible();
  const markerBounds = await waitForVisibleBoundingBox(marker, 'the PDF text-region marker');
  await pdfPage.evaluate(() => window.getSelection()?.removeAllRanges());
  await pdfPage.mouse.move(
    markerBounds.x + markerBounds.width / 2,
    markerBounds.y + markerBounds.height / 2,
  );
  await expect(markerLayer.locator('.tooltip')).toContainText('一致的学术翻译');
  await pdfPage.mouse.click(
    markerBounds.x + markerBounds.width / 2,
    markerBounds.y + markerBounds.height / 2,
  );
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  expect(await pdfPage.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await pdfPage.close();
});

test('automatically uses vision for selected PDF formulas and exposes their LaTeX', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'formula-selection.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Energy E = mc^2 is invariant.'),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textSpan = firstPage.locator('.textLayer span')
    .filter({ hasText: 'Energy E = mc^2 is invariant.' });
  await expect(textSpan).toBeVisible();
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;

  await textSpan.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();

  await expect.poll(() => visionRequests.length).toBe(initialVisionRequests + 1);
  expect(textRequests).toHaveLength(initialTextRequests);
  await expect(overlay.locator('.source-badge')).toHaveText('图像识别');
  await expect(overlay.locator('.body')).toContainText('能量关系式');
  await expect(overlay.locator('.body .pi-math-inline math')).toBeVisible();
  const formulaView = overlay.locator('.formula-view');
  await expect(formulaView).toHaveText('源码');
  await formulaView.click();
  await expect(overlay.locator('.body')).toHaveText('能量关系式 $E=mc^2$ 保持不变。');
  await expect(formulaView).toHaveText('公式');
  await expect(formulaView).toBeFocused();
  await formulaView.click();
  await expect(overlay.locator('.body .pi-math-inline math')).toBeVisible();
  await expect(formulaView).toBeFocused();
  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.recognized-text'))
    .toHaveText('Energy $E=mc^2$ is invariant.');
  await expect(overlay.locator('.formula-latex')).toHaveText('E=mc^2');
  await expect(overlay.getByRole('button', { name: '复制公式 LaTeX' })).toBeVisible();

  const request = JSON.stringify(visionRequests.at(-1));
  expect(request).toContain('Energy E = mc^2 is invariant.');

  const textRequestsBeforeCorrection = textRequests.length;
  const visionRequestsBeforeCorrection = visionRequests.length;
  await overlay.getByRole('button', { name: '修正译文' }).click();
  const correctionEditor = overlay.getByRole('group', {
    name: '修正译文，公式已锁定',
  });
  await expect(correctionEditor).toBeVisible();
  const lockedFormula = correctionEditor.getByLabel('受保护公式 1，不可编辑');
  await expect(lockedFormula).toHaveText('$E=mc^2$');
  await expect(lockedFormula).toHaveAttribute('aria-readonly', 'true');
  await expect(lockedFormula.locator('textarea,input,[contenteditable="true"]')).toHaveCount(0);
  const editableParts = correctionEditor.locator('.correction-text-part');
  await expect(editableParts).toHaveCount(2);
  await editableParts.nth(0).fill('修正后的能量关系式 ');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();

  await expect(overlay.locator('.body')).toContainText('修正后的能量关系式');
  await expect(overlay.locator('.body .pi-math-inline math')).toBeVisible();
  await overlay.locator('.formula-view').click();
  await expect(overlay.locator('.body'))
    .toHaveText('修正后的能量关系式 $E=mc^2$ 保持不变。');
  expect(textRequests).toHaveLength(textRequestsBeforeCorrection);
  expect(visionRequests).toHaveLength(visionRequestsBeforeCorrection);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  await expect(overlay.locator('.body')).toContainText('能量关系式');
  await expect(overlay.locator('.body')).not.toContainText('修正后的能量关系式');
  await overlay.locator('.formula-view').click();
  await expect(overlay.locator('.body')).toHaveText('能量关系式 $E=mc^2$ 保持不变。');
  expect(textRequests).toHaveLength(textRequestsBeforeCorrection);
  expect(visionRequests).toHaveLength(visionRequestsBeforeCorrection);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await pdfPage.evaluate(() => window.getSelection()?.removeAllRanges());
  await pdfPage.locator('#region-translate').click();
  const bounds = await textSpan.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await pdfPage.mouse.move(bounds.x - 6, bounds.y - 6);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(bounds.x + bounds.width + 6, bounds.y + bounds.height + 6, {
    steps: 5,
  });
  await pdfPage.mouse.up();
  await firstPage.locator('.region-confirm .confirm').click();
  await expect.poll(() => visionRequests.length).toBe(initialVisionRequests + 2);
  expect(textRequests).toHaveLength(initialTextRequests);
  await expect(overlay.locator('.source-badge')).toHaveText('图像识别');
  await overlay.locator('.recognized-source summary').click();
  await expect(overlay.locator('.formula-latex')).toHaveText('E=mc^2');
  await pdfPage.close();
});

test('never falls back to the text API when a Pi PDF formula screenshot is unavailable', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'formula-capture-required.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Energy E = mc^2 is invariant.'),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textSpan = firstPage.locator('.textLayer span')
    .filter({ hasText: 'Energy E = mc^2 is invariant.' });
  await expect(textSpan).toBeVisible();
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;

  await textSpan.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await firstPage.locator('canvas').evaluate((canvas) => canvas.remove());
  await overlay.locator('.trigger').click();

  await expect(overlay.locator('.error')).toContainText('本次没有降级到文字 API');
  expect(textRequests).toHaveLength(initialTextRequests);
  expect(visionRequests).toHaveLength(initialVisionRequests);
  await pdfPage.close();
});

test('canonicalizes over-escaped vision LaTeX before rendering and source display', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'escaped-formula.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf(String.raw`Escaped distribution Q_\Omega is invariant.`),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textSpan = firstPage.locator('.textLayer span')
    .filter({ hasText: 'Escaped distribution' });
  await expect(textSpan).toBeVisible();
  const initialVisionRequests = visionRequests.length;

  await textSpan.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();

  await expect.poll(() => visionRequests.length).toBe(initialVisionRequests + 1);
  await expect(overlay.locator('.uncertain-note')).toHaveCount(0);
  await expect(overlay.locator('.body .pi-math-inline math')).toHaveCount(2);
  await expect(overlay.locator('.body math [mathvariant="double-struck"]').first())
    .toHaveText('Q');

  await overlay.locator('.formula-view').click();
  const sourceText = await overlay.locator('.body').textContent() ?? '';
  expect(sourceText).toContain(String.raw`$\mathbb{Q}_\Omega$`);
  expect(sourceText).not.toContain(String.raw`$\\mathbb`);
  expect(sourceText).not.toContain('mathbbQ');

  await overlay.locator('.recognized-source summary').click();
  const formulaSource = await overlay.locator('.formula-latex').textContent() ?? '';
  expect(formulaSource).toContain(String.raw`\mathbb{Q}_\Omega`);
  expect(formulaSource).not.toContain(String.raw`\\mathbb`);
  await pdfPage.close();
});

test('normalizes optimizer limits when Pi PDF falls back to text translation', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'optimizer-fallback.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Optimizer fallback fixture.'),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const textSpan = firstPage.locator('.textLayer span')
    .filter({ hasText: 'Optimizer fallback fixture.' });
  await expect(textSpan).toBeVisible();
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;

  await textSpan.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();

  await expect.poll(() => textRequests.length).toBe(initialTextRequests + 1);
  expect(visionRequests).toHaveLength(initialVisionRequests);
  await expect(overlay.locator('.body .pi-math-scroll math munder')).toBeVisible();
  await expect(overlay.locator('.pi-equation-tag')).toHaveText('(12)');

  await overlay.locator('.pin-action').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.body .pi-math-scroll math munder')).toBeVisible();
  await pdfPage.close();
});

test('shows a compact PDF region queue and lets waiting or active tasks be cancelled', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const pdfPage = await context.newPage();
  const delayedVisionHandler = async (route: Route): Promise<void> => {
    await responseGate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: '延迟的图像翻译。',
          recognizedText: 'Delayed image text.',
          uncertainSpans: [],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, delayedVisionHandler);
  try {
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'queued-regions.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    const bounds = await firstPage.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await pdfPage.locator('#region-translate').click();

    const drawAndSend = async (left: number, top: number): Promise<void> => {
      await pdfPage.mouse.move(bounds.x + left, bounds.y + top);
      await pdfPage.mouse.down();
      await pdfPage.mouse.move(bounds.x + left + 170, bounds.y + top + 130, { steps: 5 });
      await pdfPage.mouse.up();
      await expect(firstPage.locator('.region-confirm')).toBeVisible();
      await firstPage.locator('.region-confirm .confirm').click();
    };

    await drawAndSend(70, 150);
    const queueButton = pdfPage.locator('#region-queue');
    await expect(queueButton).toBeVisible();
    await expect(pdfPage.locator('#region-queue-count')).toHaveText('1');
    await drawAndSend(300, 420);
    await expect(pdfPage.locator('#region-queue-count')).toHaveText('2');

    await pdfPage.setViewportSize({ width: 420, height: 700 });
    await queueButton.click();
    const queuePanel = pdfPage.locator('#region-queue-panel');
    await expect(queuePanel).toBeVisible();
    await expect(pdfPage.locator('#notice')).toBeHidden();
    await expect(queuePanel.locator('.queue-item')).toHaveCount(2);
    await expect(queuePanel.locator('.queue-item').first()).toContainText('翻译中');
    await expect(queuePanel.locator('.queue-item').nth(1)).toContainText('等待中');
    await expect(pdfPage.locator('.brand img')).toBeVisible();
    await expect(pdfPage.locator('#recognize-page')).toBeHidden();
    await expect(queueButton).toHaveAttribute('aria-controls', 'region-queue-panel');
    expect(await queueButton.evaluate((button) =>
      getComputedStyle(button, '::before').content)).toBe('"队"');
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-queue-420-light.png') });
      await pdfPage.emulateMedia({ colorScheme: 'dark' });
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-queue-420-dark.png') });
      await pdfPage.emulateMedia({ colorScheme: 'light' });
    }

    await pdfPage.setViewportSize({ width: 360, height: 700 });
    const narrowLayout = await pdfPage.locator('#pdf-toolbar').evaluate((toolbar) => {
      const panel = document.querySelector<HTMLElement>('#region-queue-panel');
      const brand = document.querySelector<HTMLElement>('.brand img');
      const cancel = panel?.querySelector<HTMLElement>('.queue-item button');
      return {
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        brandWidth: brand?.getBoundingClientRect().width ?? 0,
        panelLeft: panel?.getBoundingClientRect().left ?? 0,
        panelRight: panel?.getBoundingClientRect().right ?? Infinity,
        cancelHeight: cancel?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(narrowLayout.scrollWidth).toBe(narrowLayout.clientWidth);
    expect(narrowLayout.brandWidth).toBeGreaterThanOrEqual(24);
    expect(narrowLayout.panelLeft).toBeGreaterThanOrEqual(8);
    expect(narrowLayout.panelRight).toBeLessThanOrEqual(352);
    expect(narrowLayout.cancelHeight).toBeGreaterThanOrEqual(30);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-queue-360-light.png') });
    }
    await queuePanel.locator('.queue-item').nth(1).getByRole('button', { name: '取消' }).click();
    await expect(pdfPage.locator('#region-queue-count')).toHaveText('1');
    await expect(pdfPage.locator('#notice')).toBeHidden();
    await queuePanel.locator('.queue-item').first().getByRole('button', { name: '取消' }).click();
    releaseResponse?.();
    await expect(queueButton).toBeHidden();
    await expect(pdfPage.locator('#recognize-page')).toBeVisible();
    await expect(pdfPage.locator('#notice')).toContainText('正在取消当前框选翻译');
  } finally {
    releaseResponse?.();
    await context.unroute(apiPattern, delayedVisionHandler);
    await pdfPage.close();
  }
});

test('keeps dense narrow result metadata and view controls readable', async ({}, testInfo) => {
  const densePage = await context.newPage();
  const denseFixtureUrl = `${OVERLEAF_FIXTURE_URL}?dense-result-metadata=1`;
  const denseSource = [
    `Dense metadata first sentence ${'alpha '.repeat(680)}!`,
    `Dense metadata second sentence ${'beta '.repeat(420)}.`,
  ].join('\n\n');
  try {
    await densePage.setViewportSize({ width: 360, height: 700 });
    await densePage.route(denseFixtureUrl, async (route) => {
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>
          <p id="warmup">A consistent academic translation improves the readability of research papers.</p>
          <p id="dense-source"></p>
        </body></html>`,
      });
    });
    await densePage.goto(denseFixtureUrl);
    await densePage.locator('#dense-source').evaluate((element, text) => {
      element.textContent = text;
    }, denseSource);
    const selectText = async (selector: string): Promise<void> => {
      await densePage.locator(selector).evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
    };

    const overlay = densePage.locator('#tex-selection-translator-root');
    await selectText('#warmup');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.getByTitle('在页面侧栏中显示').click();

    await selectText('#dense-source');
    await expect(overlay.locator('.body')).toContainText('密集元信息在窄屏中保持清晰');
    await expect(overlay.locator('.meta')).toContainText('2 段');
    await expect(overlay.getByRole('group', { name: '译文显示方式' })).toBeVisible();
    await expect(overlay.locator('.formula-view')).toBeVisible();
    await overlay.locator('.meta').evaluate((meta) => {
      const context = document.createElement('span');
      context.className = 'cache-badge';
      context.textContent = '含上下文';
      meta.append(context);
    });
    await expect(overlay.locator('.meta')).toContainText('含上下文');
    const sourceHost = overlay.locator('.source-host');
    await expect(sourceHost).toHaveAttribute('title', 'www.overleaf.com');
    const longSourceHost =
      'extremely-long-research-document-origin-without-breakpoints.overleaf.example.test';
    await sourceHost.evaluate((element, value) => {
      element.textContent = value;
      element.setAttribute('title', value);
    }, longSourceHost);

    const layout = await overlay.locator('.result-topline').evaluate((topLine) => {
      const bounds = topLine.getBoundingClientRect();
      const meta = topLine.querySelector<HTMLElement>('.meta')!;
      const metaBounds = meta.getBoundingClientRect();
      const controls = topLine.querySelector<HTMLElement>('.result-view-controls')!;
      const controlBounds = controls.getBoundingClientRect();
      const host = topLine.querySelector<HTMLElement>('.source-host')!;
      return {
        clientWidth: topLine.clientWidth,
        scrollWidth: topLine.scrollWidth,
        topLineRight: bounds.right,
        metaBottom: metaBounds.bottom,
        controlsTop: controlBounds.top,
        controlsRight: controlBounds.right,
        controlHeights: [...controls.querySelectorAll<HTMLElement>('button')]
          .map((control) => control.getBoundingClientRect().height),
        hostClientWidth: host.clientWidth,
        hostScrollWidth: host.scrollWidth,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.controlsTop).toBeGreaterThanOrEqual(layout.metaBottom - 1);
    expect(layout.controlsRight).toBeLessThanOrEqual(layout.topLineRight + 1);
    expect(layout.controlHeights.every((height) => height >= 32)).toBe(true);
    expect(layout.hostScrollWidth).toBeGreaterThan(layout.hostClientWidth);

    const aligned = overlay.getByRole('button', { name: '显示逐句对照' });
    await aligned.click();
    const segments = overlay.locator('.segment');
    await expect(segments).toHaveCount(2);
    await expect(aligned).toBeFocused();
    await expect(overlay.locator('.segment-source-toggle')).toHaveCount(2);
    const firstSegment = segments.first();
    await expect(firstSegment.locator('.pi-math-display')).toBeVisible();
    const alignedLayout = await firstSegment.evaluate((segment) => {
      const surface = segment.closest<HTMLElement>('.surface')!;
      const source = segment.querySelector<HTMLElement>('.segment-source')!;
      const formula = segment.querySelector<HTMLElement>('.pi-math-scroll')
        ?? segment.querySelector<HTMLElement>('.pi-math-display')!;
      const actions = segment.querySelector<HTMLElement>('.segment-actions')!;
      const buttons = [...actions.querySelectorAll<HTMLElement>('button')];
      return {
        surfaceClientWidth: surface.clientWidth,
        surfaceScrollWidth: surface.scrollWidth,
        segmentClientWidth: segment.clientWidth,
        segmentScrollWidth: segment.scrollWidth,
        sourceClientHeight: source.clientHeight,
        sourceScrollHeight: source.scrollHeight,
        formulaClientWidth: formula.clientWidth,
        formulaScrollWidth: formula.scrollWidth,
        actionClientWidth: actions.clientWidth,
        actionScrollWidth: actions.scrollWidth,
        actionHeights: buttons.map((button) => button.getBoundingClientRect().height),
        actionTops: buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      };
    });
    expect(alignedLayout.surfaceScrollWidth).toBeLessThanOrEqual(
      alignedLayout.surfaceClientWidth + 1,
    );
    expect(alignedLayout.segmentScrollWidth).toBeLessThanOrEqual(
      alignedLayout.segmentClientWidth + 1,
    );
    expect(alignedLayout.sourceClientHeight).toBeLessThanOrEqual(80);
    expect(alignedLayout.sourceScrollHeight).toBeGreaterThan(alignedLayout.sourceClientHeight);
    expect(alignedLayout.formulaScrollWidth).toBeGreaterThanOrEqual(
      alignedLayout.formulaClientWidth,
    );
    await expect.poll(() => firstSegment.evaluate((segment) => {
      const formula = segment.querySelector<HTMLElement>('.pi-math-scroll')
        ?? segment.querySelector<HTMLElement>('.pi-math-display')!;
      return formula.scrollWidth > formula.clientWidth;
    })).toBe(true);
    expect(alignedLayout.actionScrollWidth).toBeLessThanOrEqual(alignedLayout.actionClientWidth + 1);
    expect(alignedLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    expect(new Set(alignedLayout.actionTops).size).toBe(1);
    if (process.env.PI_VISUAL_QA) {
      await densePage.screenshot({ path: testInfo.outputPath('aligned-long-source-360-light.png') });
      await densePage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await densePage.screenshot({ path: testInfo.outputPath('aligned-long-source-360-dark.png') });
      await densePage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }

    const sourceToggle = firstSegment.locator('.segment-source-toggle');
    await expect(sourceToggle).toHaveAttribute('aria-label', '展开完整原文');
    await sourceToggle.click();
    await expect(sourceToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sourceToggle).toHaveText('收起原文');
    await expect(sourceToggle).toBeFocused();
    const expandedSource = await firstSegment.locator('.segment-source').evaluate((source) => ({
      clientHeight: source.clientHeight,
      scrollHeight: source.scrollHeight,
    }));
    expect(expandedSource.clientHeight).toBeGreaterThan(alignedLayout.sourceClientHeight);
    expect(expandedSource.clientHeight).toBeLessThanOrEqual(181);
    expect(expandedSource.scrollHeight).toBeGreaterThan(expandedSource.clientHeight);
    await sourceToggle.click();
    await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sourceToggle).toHaveText('展开原文');
    await expect(sourceToggle).toBeFocused();

    const segmentCopy = firstSegment.getByRole('button', { name: '复制本句译文' });
    await segmentCopy.click();
    await expect(segmentCopy).toHaveText('已复制');
    await expect(segmentCopy).toBeFocused();
    const segmentCorrect = firstSegment.getByRole('button', { name: '只修正本句，不调用 API' });
    await segmentCorrect.click();
    const segmentEditor = firstSegment.getByRole('group', { name: /修正第 1 句/ });
    await expect(segmentEditor.getByLabel('受保护公式 1，不可编辑')).toBeVisible();
    const editorLayout = await firstSegment.evaluate((segment) => {
      const editor = segment.querySelector<HTMLElement>('.segment-correction')!;
      const actions = editor.querySelector<HTMLElement>('.segment-correction-actions')!;
      return {
        clientWidth: segment.clientWidth,
        scrollWidth: segment.scrollWidth,
        actionClientWidth: actions.clientWidth,
        actionScrollWidth: actions.scrollWidth,
        actionHeights: [...actions.querySelectorAll<HTMLElement>('button')]
          .map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(editorLayout.scrollWidth).toBeLessThanOrEqual(editorLayout.clientWidth + 1);
    expect(editorLayout.actionScrollWidth).toBeLessThanOrEqual(editorLayout.actionClientWidth + 1);
    expect(editorLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    await segmentEditor.locator('.correction-text-part').first().press('Escape');
    await expect(firstSegment.getByRole('button', { name: '只修正本句，不调用 API' }))
      .toBeFocused();

    let segmentMark = firstSegment.getByRole('button', { name: '轻标记本句' });
    await segmentMark.click();
    segmentMark = overlay.locator('.segment').first().getByRole('button', {
      name: '取消本句标记',
    });
    await expect(segmentMark).toHaveAttribute('aria-pressed', 'true');
    await expect(segmentMark).toBeFocused();

    const surface = overlay.locator('.surface');
    const resultScroll = overlay.locator('.result-scroll');
    await expect(resultScroll).toHaveAttribute('role', 'region');
    await expect(resultScroll).toHaveAttribute('aria-label', '译文内容');
    await expect(resultScroll).toHaveAttribute('tabindex', '0');
    const resultStructure = await surface.evaluate((element) => {
      const header = element.querySelector<HTMLElement>(':scope > .header')!;
      const scroll = element.querySelector<HTMLElement>(':scope > .result-scroll')!;
      const footer = element.querySelector<HTMLElement>(':scope > .result-footer')!;
      const surfaceBounds = element.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const scrollBounds = scroll.getBoundingClientRect();
      const footerBounds = footer.getBoundingClientRect();
      return {
        surfaceClientHeight: element.clientHeight,
        surfaceScrollHeight: element.scrollHeight,
        scrollClientHeight: scroll.clientHeight,
        scrollScrollHeight: scroll.scrollHeight,
        headerTop: headerBounds.top,
        scrollTop: scrollBounds.top,
        scrollBottom: scrollBounds.bottom,
        footerTop: footerBounds.top,
        surfaceTop: surfaceBounds.top,
        surfaceBottom: surfaceBounds.bottom,
      };
    });
    expect(resultStructure.surfaceScrollHeight).toBeLessThanOrEqual(
      resultStructure.surfaceClientHeight + 1,
    );
    expect(resultStructure.scrollScrollHeight).toBeGreaterThan(resultStructure.scrollClientHeight);
    expect(resultStructure.headerTop).toBeGreaterThanOrEqual(resultStructure.surfaceTop);
    expect(resultStructure.scrollTop).toBeGreaterThanOrEqual(resultStructure.headerTop);
    expect(resultStructure.footerTop).toBeGreaterThanOrEqual(resultStructure.scrollBottom - 1);
    expect(resultStructure.surfaceBottom).toBeGreaterThanOrEqual(resultStructure.footerTop);
    await expect(resultScroll.locator('.result-footer')).toHaveCount(0);
    const readingNavigation = overlay.getByRole('group', { name: '长译文阅读导航' });
    const readingProgress = readingNavigation.locator('.reading-progress');
    const readingTop = readingNavigation.getByRole('button', { name: '回到译文顶部（Home）' });
    const readingBottom = readingNavigation.getByRole('button', { name: '前往译文底部（End）' });
    await expect(readingNavigation).toBeVisible();
    await expect(readingProgress).toHaveAttribute('aria-label', /译文阅读进度 \d+%/u);
    const readingNavigationLayout = await overlay.locator('.result-footer').evaluate((footer) => ({
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
      buttonHeights: [...footer.querySelectorAll<HTMLElement>('.reading-jump')]
        .map((button) => button.getBoundingClientRect().height),
      childTops: [...footer.children]
        .filter((child) => (child as HTMLElement).offsetParent !== null)
        .map((child) => Math.round(child.getBoundingClientRect().top)),
    }));
    expect(readingNavigationLayout.scrollWidth)
      .toBeLessThanOrEqual(readingNavigationLayout.clientWidth + 1);
    expect(readingNavigationLayout.buttonHeights.every((height) => height >= 32)).toBe(true);
    expect(new Set(readingNavigationLayout.childTops).size).toBe(1);

    await readingBottom.click();
    await expect(readingBottom).toBeDisabled();
    await expect(readingTop).toBeFocused();
    await expect(readingProgress).toHaveText('底部');
    await expect.poll(() => resultScroll.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))).toBeLessThanOrEqual(1);
    await readingTop.click();
    await expect(readingTop).toBeDisabled();
    await expect(readingBottom).toBeFocused();
    await expect(readingProgress).toHaveText('顶部');
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop)).toBeLessThan(0.5);
    await resultScroll.focus();
    await resultScroll.press('End');
    await expect(readingProgress).toHaveText('底部');
    await resultScroll.press('Home');
    await expect(readingProgress).toHaveText('顶部');
    const fixedControlsBeforeScroll = await surface.evaluate((element) => {
      const header = element.querySelector<HTMLElement>(':scope > .header')!;
      const footer = element.querySelector<HTMLElement>(':scope > .result-footer')!;
      return {
        headerTop: header.getBoundingClientRect().top,
        footerTop: footer.getBoundingClientRect().top,
      };
    });
    await resultScroll.focus();
    await expect(resultScroll).toBeFocused();
    await resultScroll.press('PageDown');
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const fixedControlsAfterScroll = await surface.evaluate((element) => {
      const header = element.querySelector<HTMLElement>(':scope > .header')!;
      const footer = element.querySelector<HTMLElement>(':scope > .result-footer')!;
      return {
        headerTop: header.getBoundingClientRect().top,
        footerTop: footer.getBoundingClientRect().top,
      };
    });
    expect(fixedControlsAfterScroll.headerTop).toBeCloseTo(fixedControlsBeforeScroll.headerTop, 0);
    expect(fixedControlsAfterScroll.footerTop).toBeCloseTo(fixedControlsBeforeScroll.footerTop, 0);
    await expect(surface.getByRole('button', { name: '复制译文（保留标准 LaTeX）' }))
      .toBeVisible();
    const bottomVisibility = await resultScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      const lastSegment = element.querySelector<HTMLElement>('.segment:last-child')!;
      const scrollBounds = element.getBoundingClientRect();
      const segmentBounds = lastSegment.getBoundingClientRect();
      return {
        remainingScroll: element.scrollHeight - element.clientHeight - element.scrollTop,
        scrollBottom: scrollBounds.bottom,
        segmentBottom: segmentBounds.bottom,
      };
    });
    expect(bottomVisibility.remainingScroll).toBeLessThanOrEqual(1);
    expect(bottomVisibility.segmentBottom).toBeLessThanOrEqual(bottomVisibility.scrollBottom + 1);
    const scrollToSecondSegment = async (): Promise<number> => resultScroll.evaluate((element) => {
      const second = element.querySelectorAll<HTMLElement>('.segment')[1]!;
      const scrollBounds = element.getBoundingClientRect();
      const secondBounds = second.getBoundingClientRect();
      element.scrollTop += secondBounds.top - scrollBounds.top - 12;
      return element.scrollTop;
    });
    const alignedReadingPosition = await scrollToSecondSegment();
    expect(alignedReadingPosition).toBeGreaterThan(0);
    const fullView = overlay.getByRole('button', { name: '显示完整译文' });
    await fullView.evaluate((button: HTMLButtonElement) => button.click());
    await expect(overlay.locator('.body')).toBeVisible();
    await expect(resultScroll).toHaveAttribute('data-reading-key', /:full$/u);
    await aligned.evaluate((button: HTMLButtonElement) => button.click());
    await expect(segments).toHaveCount(2);
    await expect(resultScroll).toHaveAttribute('data-reading-key', /:aligned$/u);
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(alignedReadingPosition, 0);

    const olderHistory = overlay.getByTitle('上一条翻译（Alt+↑）');
    await olderHistory.click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    const newerHistory = overlay.getByTitle('下一条翻译（Alt+↓）');
    await newerHistory.click();
    await expect(segments).toHaveCount(2);
    await expect(aligned).toHaveAttribute('aria-pressed', 'true');
    await expect(resultScroll).toHaveAttribute('data-reading-key', /:aligned$/u);
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(alignedReadingPosition, 0);

    await overlay.getByTitle('收起侧栏').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await overlay.getByTitle('展开 Pi Translator 连续翻译侧栏').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(aligned).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(alignedReadingPosition, 0);

    const readingAnchorOffset = async (): Promise<number> => overlay.locator('.segment').first()
      .evaluate((segment) => {
        const scroll = segment.closest<HTMLElement>('.result-scroll')!;
        return segment.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
    await resultScroll.evaluate((element) => {
      element.scrollTop = Math.min(60, (element.scrollHeight - element.clientHeight) / 2);
    });
    const narrowAnchorOffset = await readingAnchorOffset();
    await densePage.setViewportSize({ width: 410, height: 700 });
    await expect.poll(readingAnchorOffset).toBeCloseTo(narrowAnchorOffset, 0);

    await densePage.setViewportSize({ width: 800, height: 700 });
    const resizer = overlay.locator('.sidebar-resizer');
    await expect(resizer).toBeVisible();
    await resultScroll.evaluate((element) => {
      element.scrollTop = Math.min(60, (element.scrollHeight - element.clientHeight) / 2);
    });
    const resizeAnchorOffset = await readingAnchorOffset();
    const sidebarWidthBefore = await surface.evaluate((element) => element.getBoundingClientRect().width);
    const resizerBox = await resizer.boundingBox();
    expect(resizerBox).not.toBeNull();
    if (resizerBox) {
      await densePage.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 80);
      await densePage.mouse.down();
      await densePage.mouse.move(resizerBox.x - 100, resizerBox.y + 80, { steps: 8 });
      await densePage.mouse.up();
    }
    await expect.poll(() => surface.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(sidebarWidthBefore + 80);
    await expect.poll(readingAnchorOffset).toBeCloseTo(resizeAnchorOffset, 0);
    await densePage.setViewportSize({ width: 360, height: 700 });
    await expect.poll(readingAnchorOffset).toBeCloseTo(resizeAnchorOffset, 0);
    await densePage.setViewportSize({ width: 320, height: 700 });
    const compactFooterLayout = await overlay.locator('.result-footer').evaluate((footer) => {
      const copy = footer.querySelector<HTMLElement>('.copy-action')!;
      const more = footer.querySelector<HTMLElement>('details.more')!;
      const reading = footer.querySelector<HTMLElement>('.result-reading-nav')!;
      return {
        clientWidth: footer.clientWidth,
        scrollWidth: footer.scrollWidth,
        copyTop: Math.round(copy.getBoundingClientRect().top),
        moreTop: Math.round(more.getBoundingClientRect().top),
        readingTop: Math.round(reading.getBoundingClientRect().top),
      };
    });
    expect(compactFooterLayout.scrollWidth).toBeLessThanOrEqual(compactFooterLayout.clientWidth + 1);
    expect(compactFooterLayout.moreTop).toBe(compactFooterLayout.copyTop);
    expect(compactFooterLayout.readingTop).toBeGreaterThan(compactFooterLayout.copyTop);
    await densePage.setViewportSize({ width: 360, height: 700 });
    await expect.poll(readingAnchorOffset).toBeCloseTo(resizeAnchorOffset, 0);

    const markScrollTop = await scrollToSecondSegment();
    expect(markScrollTop).toBeGreaterThan(0);
    let secondMark = overlay.locator('.segment').nth(1).getByRole('button', {
      name: '轻标记本句',
    });
    await secondMark.click();
    secondMark = overlay.locator('.segment').nth(1).getByRole('button', {
      name: '取消本句标记',
    });
    await expect(secondMark).toBeFocused();
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(markScrollTop, 0);
    const formula = overlay.locator('.formula-view');
    await formula.focus();
    const formulaScrollTop = await scrollToSecondSegment();
    await formula.press('Enter');
    await expect(formula).toHaveText('公式');
    await expect(formula).toBeFocused();
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(formulaScrollTop, 0);

    const secondCorrect = overlay.locator('.segment').nth(1).getByRole('button', {
      name: '只修正本句，不调用 API',
    });
    await scrollToSecondSegment();
    await secondCorrect.click();
    const secondEditor = overlay.locator('.segment').nth(1).getByRole('group', {
      name: /修正第 2 句/,
    });
    await expect(secondEditor).toBeVisible();
    const editorScrollTop = await resultScroll.evaluate((element) => element.scrollTop);
    expect(editorScrollTop).toBeGreaterThan(0);
    await secondEditor.locator('.correction-text-part').first().press('Escape');
    await expect(overlay.locator('.segment').nth(1).getByRole('button', {
      name: '只修正本句，不调用 API',
    })).toBeFocused();
    await expect.poll(() => resultScroll.evaluate((element, previousScrollTop) => (
      Math.abs(element.scrollTop - previousScrollTop) < 0.5
      || element.scrollHeight - element.clientHeight - element.scrollTop < 0.5
    ), editorScrollTop)).toBe(true);

    await scrollToSecondSegment();
    await overlay.locator('.segment').nth(1).getByRole('button', {
      name: '只修正本句，不调用 API',
    }).click();
    const savingEditor = overlay.locator('.segment').nth(1).getByRole('group', {
      name: /修正第 2 句/,
    });
    await savingEditor.locator('.correction-text-part').first()
      .fill('第二句修正完成后仍保持当前阅读位置，');
    const draftInput = savingEditor.locator('.correction-text-part').first();
    const saveSegment = savingEditor.locator('.segment-correction-save');
    const worker = context.serviceWorkers()[0]!;
    const storedHead = await worker.evaluate(async (pageUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: Record<string, unknown>): Promise<Array<{
            id?: number;
            url?: string;
          }>> };
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
      if (tab?.id === undefined) throw new Error('Could not find the dense result tab.');
      const key = `translationResultHead:${tab.id}`;
      const original = (await api.storage.session.get(key))[key] as {
        tabId: number;
        currentResultRequestId: string;
        rootRequestId: string;
        updatedAt: number;
      } | undefined;
      if (!original) throw new Error('The dense result has no translation head.');
      await api.storage.session.set({
        [key]: {
          ...original,
          currentResultRequestId: 'newer-result-for-segment-failure-e2e',
          updatedAt: Date.now(),
        },
      });
      return { key, original };
    }, densePage.url());
    try {
      await saveSegment.click();
      const failure = savingEditor.locator('.segment-correction-status');
      await expect(failure).toContainText('当前译文已经变化');
      await expect(failure).toHaveAttribute('role', 'alert');
      await expect(failure).toHaveClass(/is-error/);
      await expect(draftInput).toHaveValue('第二句修正完成后仍保持当前阅读位置，');
      await expect(draftInput).toBeEnabled();
      await expect(saveSegment).toHaveText('重试');
      await expect(saveSegment).toBeFocused();
      const failureLayout = await savingEditor.evaluate((editor) => {
        const scroll = editor.closest<HTMLElement>('.result-scroll')!;
        const status = editor.querySelector<HTMLElement>('.segment-correction-status')!;
        const scrollBounds = scroll.getBoundingClientRect();
        const statusBounds = status.getBoundingClientRect();
        return {
          scrollBottom: scrollBounds.bottom,
          statusBottom: statusBounds.bottom,
          actionHeights: [...editor.querySelectorAll<HTMLElement>(
            '.segment-correction-actions button',
          )].map((button) => button.getBoundingClientRect().height),
        };
      });
      expect(failureLayout.statusBottom).toBeLessThanOrEqual(failureLayout.scrollBottom);
      expect(failureLayout.actionHeights.every((height) => height >= 32)).toBe(true);
      await draftInput.fill('第二句修正完成后仍保持当前阅读位置，并可继续修改。');
      await expect(failure).toBeEmpty();
      await expect(failure).toHaveAttribute('role', 'status');
      await expect(saveSegment).toHaveText('保存');
    } finally {
      await worker.evaluate(async ({ key, original }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: {
            set(values: Record<string, unknown>): Promise<void>;
          } } };
        }).chrome;
        await api.storage.session.set({ [key]: original });
      }, storedHead);
    }
    const savingOffset = await overlay.locator('.segment').nth(1).evaluate((segment) => {
      const scroll = segment.closest<HTMLElement>('.result-scroll')!;
      return segment.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await saveSegment.click();
    const correctedSecond = overlay.locator('.segment').nth(1);
    await expect(correctedSecond.locator('.segment-target'))
      .toContainText('第二句修正完成后仍保持当前阅读位置');
    await expect(correctedSecond.getByRole('button', {
      name: '只修正本句，不调用 API',
    })).toBeFocused();
    const versionContext = overlay.locator('.version-context');
    await expect(versionContext).toContainText('修正本句');
    await expect(versionContext).toContainText('较上一版调整 1 句');
    await expect(overlay.locator('.segment').first())
      .not.toHaveAttribute('data-version-changed', 'true');
    await expect(correctedSecond).toHaveAttribute('data-version-changed', 'true');
    const versionContextLayout = await versionContext.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      height: element.getBoundingClientRect().height,
      buttonHeight: element.querySelector<HTMLElement>('.version-locate')
        ?.getBoundingClientRect().height,
    }));
    expect(versionContextLayout.scrollWidth).toBeLessThanOrEqual(versionContextLayout.clientWidth + 1);
    expect(versionContextLayout.height).toBeLessThanOrEqual(64);
    expect(versionContextLayout.buttonHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await densePage.screenshot({ path: testInfo.outputPath('version-change-aligned-360-light.png') });
      await densePage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await densePage.screenshot({ path: testInfo.outputPath('version-change-aligned-360-dark.png') });
      await densePage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    const savedPosition = await correctedSecond.evaluate((segment) => {
      const scroll = segment.closest<HTMLElement>('.result-scroll')!;
      return {
        offset: segment.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
        remainingScroll: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
      };
    });
    expect(
      Math.abs(savedPosition.offset - savingOffset) < 0.5
      || savedPosition.remainingScroll < 0.5,
    ).toBe(true);
    const savedVisibility = await correctedSecond.evaluate((segment) => {
      const scroll = segment.closest<HTMLElement>('.result-scroll')!;
      const target = segment.querySelector<HTMLElement>('.segment-target')!;
      const scrollBounds = scroll.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      return {
        contentTop: scrollBounds.top,
        contentBottom: scrollBounds.bottom,
        targetTop: targetBounds.top,
        targetBottom: targetBounds.bottom,
      };
    });
    expect(savedVisibility.targetTop).toBeGreaterThan(savedVisibility.contentTop);
    expect(savedVisibility.targetBottom).toBeLessThanOrEqual(savedVisibility.contentBottom);

    const correctedVersionPosition = await scrollToSecondSegment();
    const olderVersion = overlay.getByTitle('查看上一版译文');
    await olderVersion.click();
    await expect(overlay.locator('.version-counter')).toHaveText('v2/2');
    await expect(versionContext).toContainText('初始译文');
    await expect(versionContext).toContainText('后续版本调整 1 句');
    await expect(overlay.locator('.segment').nth(1))
      .toHaveAttribute('data-version-changed', 'true');
    await expect(overlay.locator('.segment').nth(1).locator('.segment-target'))
      .not.toContainText('第二句修正完成后仍保持当前阅读位置');
    await resultScroll.evaluate((element) => { element.scrollTop = 24; });
    const newerVersion = overlay.getByTitle('查看下一版译文');
    await newerVersion.click();
    await expect(overlay.locator('.version-counter')).toHaveText('v1/2');
    await expect(overlay.locator('.segment').nth(1).locator('.segment-target'))
      .toContainText('第二句修正完成后仍保持当前阅读位置');
    await expect(aligned).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => resultScroll.evaluate((element) => element.scrollTop))
      .toBeCloseTo(correctedVersionPosition, 0);

    const undoSegmentCorrection = overlay.getByRole('button', {
      name: '撤销上次译文修正',
    });
    await undoSegmentCorrection.click();
    const restoredSecond = overlay.locator('.segment').nth(1);
    await expect(versionContext).toContainText('撤销修改');
    await expect(restoredSecond.locator('.segment-target'))
      .not.toContainText('第二句修正完成后仍保持当前阅读位置');
    await expect(restoredSecond.getByRole('button', {
      name: '只修正本句，不调用 API',
    })).toBeFocused();
    const restoredVisibility = await restoredSecond.evaluate((segment) => {
      const scroll = segment.closest<HTMLElement>('.result-scroll')!;
      const target = segment.querySelector<HTMLElement>('.segment-target')!;
      const scrollBounds = scroll.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      return {
        contentTop: scrollBounds.top,
        contentBottom: scrollBounds.bottom,
        targetTop: targetBounds.top,
        targetBottom: targetBounds.bottom,
      };
    });
    expect(restoredVisibility.targetTop).toBeGreaterThan(restoredVisibility.contentTop);
    expect(restoredVisibility.targetBottom).toBeLessThanOrEqual(restoredVisibility.contentBottom);
    const full = overlay.getByRole('button', { name: '显示完整译文' });
    await full.click();
    await expect(overlay.locator('.body')).toBeVisible();
    await expect(full).toBeFocused();
    if (process.env.PI_VISUAL_QA) {
      await densePage.screenshot({ path: testInfo.outputPath('result-metadata-controls-360-light.png') });
      await densePage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await densePage.screenshot({ path: testInfo.outputPath('result-metadata-controls-360-dark.png') });
    }

    await overlay.locator('.meta').evaluate((meta) => {
      const latency = [...meta.querySelectorAll<HTMLElement>('.meta-dot')]
        .find((item) => /(?:毫秒|秒)$/u.test(item.textContent?.trim() ?? ''));
      latency?.remove();
      const cache = document.createElement('span');
      cache.className = 'cache-badge';
      cache.textContent = '会话缓存';
      meta.append(cache);
    });
    await expect(overlay.locator('.cache-badge').filter({ hasText: '会话缓存' })).toBeVisible();
    await expect(overlay.locator('.meta')).toContainText('2 段');
    const cachedLayout = await overlay.locator('.result-topline').evaluate((topLine) => ({
      clientWidth: topLine.clientWidth,
      scrollWidth: topLine.scrollWidth,
      controlHeights: [...topLine.querySelectorAll<HTMLElement>('.view-button')]
        .map((control) => control.getBoundingClientRect().height),
    }));
    expect(cachedLayout.scrollWidth).toBeLessThanOrEqual(cachedLayout.clientWidth + 1);
    expect(cachedLayout.controlHeights.every((height) => height >= 32)).toBe(true);
  } finally {
    await densePage.close();
  }
});

test('keeps narrow PDF translation states readable and touch-safe', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
  const longFormula = String.raw`\operatorname{ELBO}(\theta,\phi)=\mathbb{E}_{q_\phi(z\mid x)}[\log p_\theta(x,z)-\log q_\phi(z\mid x)]+\lambda\sum_{i=1}^{n}\lVert x_i-\hat{x}_i\rVert_2^2`;
  let releaseResult: (() => void) | undefined;
  const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
  let requestIndex = 0;
  const pdfPage = await context.newPage();
  const stateHandler = async (route: Route): Promise<void> => {
    requestIndex += 1;
    await resultGate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: `该目标 \\[${longFormula}\\] 在长文本条件下保持稳定。`,
          recognizedText: `The objective \\[${longFormula}\\] remains stable under long-form input.`,
          formulaLatex: [longFormula],
          uncertainSpans: [],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, stateHandler);
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'narrow-translation-states.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#fit-width').click();
    await expect.poll(() => firstPage.evaluate((element) =>
      element.getBoundingClientRect().width)).toBeLessThanOrEqual(332);

    const drawAndSend = async (left: number, top: number): Promise<void> => {
      if (await pdfPage.locator('#region-translate').getAttribute('aria-pressed') !== 'true') {
        await pdfPage.locator('#region-translate').click();
      }
      const bounds = await firstPage.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) return;
      await pdfPage.mouse.move(bounds.x + left, bounds.y + top);
      await pdfPage.mouse.down();
      await pdfPage.mouse.move(bounds.x + left + 150, bounds.y + top + 110, { steps: 5 });
      await pdfPage.mouse.up();
      await expect(firstPage.locator('.region-confirm')).toBeVisible();
      await firstPage.locator('.region-confirm .confirm').click();
    };

    await drawAndSend(55, 110);
    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.loading-status')).toBeVisible();
    await expect.poll(() => requestIndex).toBe(1);
    const loadingCard = await overlay.locator('.surface').evaluate((surface) => {
      const toolbar = document.querySelector<HTMLElement>('#pdf-toolbar');
      const controls = [...surface.querySelectorAll<HTMLElement>('.pin-action,.surface-close,.stop-translation')];
      const bounds = surface.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        toolbarBottom: toolbar?.getBoundingClientRect().bottom ?? 0,
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(loadingCard.bounds.left).toBeGreaterThanOrEqual(8);
    expect(loadingCard.bounds.right).toBeLessThanOrEqual(352);
    expect(loadingCard.bounds.top).toBeGreaterThanOrEqual(loadingCard.toolbarBottom + 8);
    expect(loadingCard.scrollWidth).toBeLessThanOrEqual(loadingCard.clientWidth + 1);
    expect(loadingCard.controlHeights.every((height) => height >= 32)).toBe(true);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-translation-loading-360-light.png') });
    }

    await overlay.locator('.pin-action').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const loadingSidebar = await overlay.locator('.surface').evaluate((surface) => {
      const bounds = surface.getBoundingClientRect();
      const title = surface.querySelector<HTMLElement>('.title-wrap')?.getBoundingClientRect();
      const tools = surface.querySelector<HTMLElement>('.header-tools')?.getBoundingClientRect();
      const controls = [...surface.querySelectorAll<HTMLElement>('.header-tools button,.stop-translation')];
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        titleRight: title?.right ?? 0,
        toolsLeft: tools?.left ?? Infinity,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(loadingSidebar.bounds.left).toBeGreaterThanOrEqual(8);
    expect(loadingSidebar.bounds.right).toBeLessThanOrEqual(352);
    expect(loadingSidebar.scrollWidth).toBeLessThanOrEqual(loadingSidebar.clientWidth + 1);
    expect(loadingSidebar.titleRight).toBeLessThanOrEqual(loadingSidebar.toolsLeft);
    expect(loadingSidebar.controlHeights.every((height) => height >= 32)).toBe(true);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-translation-sidebar-loading-360-light.png') });
    }

    releaseResult?.();
    await expect(overlay.locator('.body .pi-math-display')).toBeVisible();
    const formulaLayout = await overlay.locator('.surface').evaluate((surface) => {
      const formula = surface.querySelector<HTMLElement>('.pi-math-display');
      return {
        surfaceClientWidth: surface.clientWidth,
        surfaceScrollWidth: surface.scrollWidth,
        formulaClientWidth: formula?.clientWidth ?? 0,
        formulaScrollWidth: formula?.scrollWidth ?? 0,
      };
    });
    expect(formulaLayout.surfaceScrollWidth).toBeLessThanOrEqual(formulaLayout.surfaceClientWidth + 1);
    expect(formulaLayout.formulaScrollWidth).toBeGreaterThan(formulaLayout.formulaClientWidth);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-translation-sidebar-result-360-light.png') });
      await pdfPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-translation-sidebar-result-360-dark.png') });
      await pdfPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
  } finally {
    releaseResult?.();
    await context.unroute(apiPattern, stateHandler);
    await pdfPage.close();
  }
});

test('keeps narrow PDF translation errors readable and touch-safe', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'narrow-translation-error.pdf',
      mimeType: 'application/pdf',
      buffer: createTextPdf('Energy E = mc^2 is invariant.'),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#fit-width').click();
    const textSpan = firstPage.locator('.textLayer span')
      .filter({ hasText: 'Energy E = mc^2 is invariant.' });
    await expect(textSpan).toBeVisible();
    await textSpan.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await firstPage.locator('canvas').evaluate((canvas) => canvas.remove());
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.error')).toBeVisible();
    const errorCard = await overlay.locator('.surface').evaluate((surface) => ({
      bounds: surface.getBoundingClientRect().toJSON(),
      clientWidth: surface.clientWidth,
      scrollWidth: surface.scrollWidth,
      closeHeight: surface.querySelector<HTMLElement>('.surface-close')?.getBoundingClientRect().height ?? 0,
    }));
    expect(errorCard.bounds.left).toBeGreaterThanOrEqual(8);
    expect(errorCard.bounds.right).toBeLessThanOrEqual(352);
    expect(errorCard.scrollWidth).toBeLessThanOrEqual(errorCard.clientWidth + 1);
    expect(errorCard.closeHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-translation-error-360-light.png') });
    }
  } finally {
    await pdfPage.close();
  }
});

test('keeps narrow PDF document memory readable with long terms', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
  const longRecentSource = 'ExtremelyLongRecognizedAcademicSourceIdentifierWithoutNaturalBreakpoints remains stable throughout every hierarchically constrained reconstruction stage.';
  const longRecentTarget = '超长学术识别原文标识符在每个具有层级约束的多阶段重建任务中持续保持稳定，并严格维持一致的技术术语与推理边界。';
  const longMemoryVisionHandler = async (route: Route): Promise<void> => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: longRecentTarget,
          recognizedText: longRecentSource,
          formulaLatex: [],
          uncertainSpans: [],
        }) } }],
      }),
    });
  };
  await context.route(apiPattern, longMemoryVisionHandler);
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: `${'a'.repeat(120)}.pdf`,
      mimeType: 'application/pdf',
      buffer: createTextPdf('The adaptive sensing policy is stable in this document.'),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#fit-width').click();
    const textSpan = firstPage.locator('.textLayer span')
      .filter({ hasText: 'The adaptive sensing policy is stable in this document.' });
    await expect(textSpan).toBeVisible();
    await textSpan.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toBeVisible();
    await overlay.locator('.pin-action').click();
    await overlay.getByTitle('查看本文术语和最近翻译').click();
    await expect(overlay.locator('.document-meta')).toHaveText('PDF 文档 · 仅保存在本机');

    const recentTranslation = overlay.locator('.document-translation').first();
    await expect(recentTranslation.locator('.document-source'))
      .toHaveText(longRecentSource);
    await expect(recentTranslation.locator('.document-target'))
      .toHaveText(longRecentTarget);
    const recentLayout = await recentTranslation.evaluate((button) => {
      const target = button.querySelector<HTMLElement>('.document-target')!;
      const targetStyle = getComputedStyle(target);
      const bounds = button.getBoundingClientRect();
      const surfaceBounds = button.closest<HTMLElement>('.surface')!.getBoundingClientRect();
      return {
        insideSurface: bounds.left >= surfaceBounds.left && bounds.right <= surfaceBounds.right,
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        targetHeight: target.getBoundingClientRect().height,
        targetLineHeight: Number.parseFloat(targetStyle.lineHeight),
        fullTarget: target.textContent,
      };
    });
    expect(recentLayout.insideSurface).toBe(true);
    expect(recentLayout.scrollWidth).toBeLessThanOrEqual(recentLayout.clientWidth + 1);
    expect(recentLayout.targetHeight).toBeLessThanOrEqual(recentLayout.targetLineHeight * 2 + 1);
    expect(recentLayout.fullTarget).toBe(longRecentTarget);
    await recentTranslation.click();
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');
    await expect(overlay.locator('.copy-action')).toBeFocused();
    await overlay.getByTitle('查看本文术语和最近翻译').click();

    await overlay.getByTitle('添加本文术语').click();
    const longSource = 'AdaptiveSensingReconstructionObjectiveWithHierarchicalConstraints';
    await overlay.getByRole('textbox', { name: '原文术语' }).fill(longSource);
    await overlay.getByRole('textbox', { name: '固定译法' })
      .fill('具有层级约束的自适应感知重建目标固定译法');
    await overlay.getByTitle('保存本文术语').click();
    const longTermRow = overlay.locator('.document-row').filter({ hasText: longSource });
    await expect(longTermRow).toBeVisible();

    const memoryLayout = await overlay.locator('.surface').evaluate((surface) => {
      const meta = surface.querySelector<HTMLElement>('.document-meta');
      const rows = [...surface.querySelectorAll<HTMLElement>('.document-row')];
      const buttons = [...surface.querySelectorAll<HTMLElement>(
        '.document-row-actions button,.document-action,.document-clear',
      )];
      const bounds = surface.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        metaClientWidth: meta?.clientWidth ?? 0,
        metaScrollWidth: meta?.scrollWidth ?? 0,
        rowsInside: rows.every((row) => {
          const rowBounds = row.getBoundingClientRect();
          return rowBounds.left >= bounds.left && rowBounds.right <= bounds.right;
        }),
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-document-memory-360-light.png') });
      await pdfPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-document-memory-360-dark.png') });
      await pdfPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(memoryLayout.bounds.left).toBeGreaterThanOrEqual(8);
    expect(memoryLayout.bounds.right).toBeLessThanOrEqual(352);
    expect(memoryLayout.scrollWidth).toBeLessThanOrEqual(memoryLayout.clientWidth + 1);
    expect(memoryLayout.metaScrollWidth).toBeLessThanOrEqual(memoryLayout.metaClientWidth + 1);
    expect(memoryLayout.rowsInside).toBe(true);
    expect(memoryLayout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await longTermRow.getByTitle('编辑本文术语').click();
    const termEditor = overlay.locator('.document-edit');
    const sourceEditor = termEditor.getByRole('textbox', { name: '原文术语' });
    await expect(sourceEditor).toBeFocused();
    const editorLayout = await termEditor.evaluate((editor) => {
      const inputs = [...editor.querySelectorAll<HTMLElement>('input')];
      const buttons = [...editor.querySelectorAll<HTMLElement>('button')];
      return {
        inputTops: inputs.map((input) => input.getBoundingClientRect().top),
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(editorLayout.inputTops[1]).toBeGreaterThan(editorLayout.inputTops[0] ?? 0);
    expect(editorLayout.buttonHeights.every((height) => height >= 32)).toBe(true);
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-document-memory-editor-360-light.png') });
    }
    await sourceEditor.press('Escape');
    await expect(termEditor).toHaveCount(0);
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(longTermRow.getByTitle('编辑本文术语')).toBeFocused();

    await pdfPage.evaluate(() => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const sendMessage = extensionChrome.runtime.sendMessage.bind(extensionChrome.runtime);
      let failNextClear = true;
      extensionChrome.runtime.sendMessage = async (message: unknown) => {
        if (
          failNextClear &&
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'CLEAR_DOCUMENT_MEMORY'
        ) {
          failNextClear = false;
          return { ok: false, error: { message: '模拟清空失败' } };
        }
        return sendMessage(message);
      };
    });
    const clear = overlay.locator('.document-clear');
    await clear.click();
    await expect(clear).toHaveText('再次点击清空');
    await expect(clear).toHaveAttribute('data-confirm-clear', 'true');
    await expect(clear).toBeFocused();
    await overlay.getByTitle('返回翻译结果').focus();
    await expect(clear).toHaveText('清空本文记忆');
    await expect(clear).not.toHaveAttribute('data-confirm-clear', 'true');
    await clear.click();
    await clear.click();
    await expect(overlay.locator('.error')).toHaveText('模拟清空失败');
    await expect(clear).toHaveText('清空本文记忆');
    await expect(clear).toBeFocused();
    await expect(overlay.locator('.document-translation')).toHaveCount(1);
    await expect(longTermRow).toBeVisible();
    await clear.click();
    await clear.click();
    await expect(overlay.locator('.document-translation')).toHaveCount(0);
    await expect(overlay.locator('.document-row')).toHaveCount(0);
    await expect(overlay.locator('.document-clear')).toHaveCount(0);
    await expect(overlay.locator('.document-empty'))
      .toContainText(['确认术语后，后续译句会优先沿用这里的译法。', '本文完成的翻译会出现在这里。']);
    await expect(overlay.getByTitle('返回翻译结果')).toBeFocused();
  } finally {
    await context.unroute(apiPattern, longMemoryVisionHandler);
    await pdfPage.close();
  }
});

test('keeps narrow OCR review and source editing readable', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
  const longToken = 'ExtremelyLongRecognizedAcademicIdentifierWithoutNaturalBreakpointsForNarrowLayout';
  const longFormula = String.raw`\operatorname{ELBO}(\theta,\phi)=\mathbb{E}_{q_\phi(z\mid x)}[\log p_\theta(x,z)-\log q_\phi(z\mid x)]+\lambda\sum_{i=1}^{n}\lVert x_i-\hat{x}_i\rVert_2^2`;
  const pdfPage = await context.newPage();
  const longVisionHandler = async (route: Route): Promise<void> => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: `该识别结果包含长标识符 ${longToken} 与公式 \\[${longFormula}\\]。`,
          recognizedText: `${longToken} appears with \\[${longFormula}\\] in the scanned source.`,
          formulaLatex: [longFormula],
          uncertainSpans: ['The trailing identifier is not fully legible.'],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, longVisionHandler);
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'narrow-ocr-review.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#fit-width').click();
    await pdfPage.locator('#region-translate').click();
    const pageBounds = await firstPage.boundingBox();
    expect(pageBounds).not.toBeNull();
    if (!pageBounds) return;
    await pdfPage.mouse.move(pageBounds.x + 55, pageBounds.y + 105);
    await pdfPage.mouse.down();
    await pdfPage.mouse.move(pageBounds.x + 210, pageBounds.y + 225, { steps: 5 });
    await pdfPage.mouse.up();
    await expect(firstPage.locator('.region-confirm')).toBeVisible();
    await firstPage.locator('.region-confirm .confirm').click();

    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay.locator('.body .pi-math-display')).toBeVisible();
    await expect(overlay.locator('.uncertain-note')).toContainText('有 1 处内容无法完全确认');
    const summary = overlay.locator('.recognized-source summary');
    await summary.click();
    const sourceLayout = await overlay.locator('.surface').evaluate((surface) => {
      const summaryElement = surface.querySelector<HTMLElement>('.recognized-source summary');
      const source = surface.querySelector<HTMLElement>('.recognized-text');
      const formula = surface.querySelector<HTMLElement>('.formula-latex');
      const actions = [...surface.querySelectorAll<HTMLElement>('.recognized-actions button')];
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        summaryHeight: summaryElement?.getBoundingClientRect().height ?? 0,
        sourceClientWidth: source?.clientWidth ?? 0,
        sourceScrollWidth: source?.scrollWidth ?? 0,
        formulaClientWidth: formula?.clientWidth ?? 0,
        formulaScrollWidth: formula?.scrollWidth ?? 0,
        actionHeights: actions.map((action) => action.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-ocr-review-360-light.png') });
    }

    await overlay.getByRole('button', { name: '编辑后重译' }).click();
    const editor = overlay.getByRole('textbox', { name: '编辑识别原文' });
    await expect(editor).toBeFocused();
    await editor.fill(`Corrected ${longToken} with \\[${longFormula}\\].`);
    const editorLayout = await overlay.locator('.surface').evaluate((surface) => {
      const editorElement = surface.querySelector<HTMLElement>('.recognized-editor');
      const actions = [...surface.querySelectorAll<HTMLElement>('.recognized-actions button')];
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        editorRight: editorElement?.getBoundingClientRect().right ?? Infinity,
        surfaceRight: surface.getBoundingClientRect().right,
        actionHeights: actions.map((action) => action.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-ocr-editor-360-light.png') });
      await pdfPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-ocr-editor-360-dark.png') });
      await pdfPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(sourceLayout.scrollWidth).toBeLessThanOrEqual(sourceLayout.clientWidth + 1);
    expect(sourceLayout.summaryHeight).toBeGreaterThanOrEqual(32);
    expect(sourceLayout.sourceScrollWidth).toBeLessThanOrEqual(sourceLayout.sourceClientWidth + 1);
    expect(sourceLayout.formulaScrollWidth).toBeLessThanOrEqual(sourceLayout.formulaClientWidth + 1);
    expect(sourceLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    expect(editorLayout.scrollWidth).toBeLessThanOrEqual(editorLayout.clientWidth + 1);
    expect(editorLayout.editorRight).toBeLessThanOrEqual(editorLayout.surfaceRight);
    expect(editorLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    await expect(overlay.locator('.pin-action')).toHaveCount(0);

    await editor.press('Escape');
    await expect(overlay.getByRole('textbox', { name: '编辑识别原文' })).toHaveCount(0);
    await expect(summary).toBeFocused();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  } finally {
    await context.unroute(apiPattern, longVisionHandler);
    await pdfPage.close();
  }
});

test('keeps narrow pending OCR reviews actionable and reveals their regions', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-vision/**';
  const longSource = 'A very long scanned academic statement with '
    + 'ExtremelyLongUncertainIdentifierWithoutNaturalBreakpoints and an uncertain formula subscript.';
  const pdfPage = await context.newPage();
  const pendingReviewHandler = async (route: Route): Promise<void> => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: '这是一条需要人工核对的长图像识别结果。',
          recognizedText: longSource,
          formulaLatex: [String.raw`q_\phi(z\mid x)=\mathcal{N}(z;\mu_\phi(x),\sigma_\phi^2(x))`],
          uncertainSpans: [
            'The identifier may be incomplete.',
            'The formula subscript is not fully legible.',
          ],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, pendingReviewHandler);
  try {
    await pdfPage.setViewportSize({ width: 360, height: 700 });
    await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
    await pdfPage.locator('#file-input').setInputFiles({
      name: 'narrow-pending-review.pdf',
      mimeType: 'application/pdf',
      buffer: createRasterPdf(),
    });
    const firstPage = pdfPage.locator('.pdf-page').first();
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await pdfPage.locator('#fit-width').click();
    await pdfPage.locator('#region-translate').click();
    const pageBounds = await firstPage.boundingBox();
    expect(pageBounds).not.toBeNull();
    if (!pageBounds) return;
    await pdfPage.mouse.move(pageBounds.x + 55, pageBounds.y + 105);
    await pdfPage.mouse.down();
    await pdfPage.mouse.move(pageBounds.x + 225, pageBounds.y + 245, { steps: 5 });
    await pdfPage.mouse.up();
    await firstPage.locator('.region-confirm .confirm').click();

    const overlay = pdfPage.locator('#tex-selection-translator-root');
    await expect(overlay.locator('.uncertain-note')).toContainText('有 2 处内容无法完全确认');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const documentButton = overlay.locator('.document-memory-action');
    await expect(documentButton).toHaveText('本文 · 待核对 1');
    await documentButton.click();

    const pendingSection = overlay.locator('.document-review-section');
    const reviewRow = pendingSection.locator('.document-review-row');
    await expect(reviewRow).toContainText('2 处内容待核对');
    await expect(reviewRow).toContainText(longSource);
    const layout = await overlay.locator('.surface').evaluate((surface) => {
      const row = surface.querySelector<HTMLElement>('.document-review-row');
      const source = surface.querySelector<HTMLElement>('.document-review-source');
      const actions = surface.querySelector<HTMLElement>('.document-review-actions');
      const buttons = [...surface.querySelectorAll<HTMLElement>('.document-review-actions button')];
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        surfaceRight: surface.getBoundingClientRect().right,
        rowRight: row?.getBoundingClientRect().right ?? Infinity,
        sourceClientWidth: source?.clientWidth ?? 0,
        sourceScrollWidth: source?.scrollWidth ?? 0,
        actionsClientWidth: actions?.clientWidth ?? 0,
        actionsScrollWidth: actions?.scrollWidth ?? 0,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-pending-review-360-light.png') });
      await pdfPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-pending-review-360-dark.png') });
      await pdfPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.rowRight).toBeLessThanOrEqual(layout.surfaceRight);
    expect(layout.sourceScrollWidth).toBeLessThanOrEqual(layout.sourceClientWidth + 1);
    expect(layout.actionsScrollWidth).toBeLessThanOrEqual(layout.actionsClientWidth + 1);
    expect(layout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await reviewRow.getByRole('button', { name: '返回区域' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await expect(firstPage.locator('.region-source-highlight')).toBeVisible();
    if (process.env.PI_VISUAL_QA) {
      await pdfPage.screenshot({ path: testInfo.outputPath('pdf-pending-review-region-360-light.png') });
    }
    await overlay.getByRole('button', { name: '展开 Pi Translator 连续翻译侧栏' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(overlay.getByRole('button', { name: '返回翻译结果' })).toBeFocused();

    await overlay.locator('.document-review-row').getByRole('button', { name: '打开结果' }).click();
    await expect(overlay.locator('.body')).toHaveText('这是一条需要人工核对的长图像识别结果。');
    await overlay.locator('.document-memory-action').click();
    await overlay.locator('.document-review-row').getByRole('button', { name: '已核对' }).click();
    await expect(overlay.locator('.document-review-section')).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: '返回翻译结果' })).toBeFocused();
    await overlay.getByRole('button', { name: '返回翻译结果' }).click();
    await expect(overlay.locator('.document-memory-action')).toHaveText('本文');
  } finally {
    await context.unroute(apiPattern, pendingReviewHandler);
    await pdfPage.close();
  }
});

test('clears an unsent PDF image selection on Escape, zoom, and document replacement', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const fileInput = pdfPage.locator('#file-input');
  await fileInput.setInputFiles({
    name: 'selection-lifecycle.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  const regionButton = pdfPage.locator('#region-translate');
  const requestCount = visionRequests.length;

  const drawRegion = async (): Promise<void> => {
    await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
    await regionButton.click();
    const bounds = await firstPage.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await pdfPage.mouse.move(bounds.x + 160, bounds.y + 210);
    await pdfPage.mouse.down();
    await pdfPage.mouse.move(bounds.x + 390, bounds.y + 390, { steps: 5 });
    await pdfPage.mouse.up();
    await expect(firstPage.locator('.region-confirm')).toBeVisible();
    expect(visionRequests).toHaveLength(requestCount);
  };

  await drawRegion();
  await pdfPage.keyboard.press('Escape');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'true');
  await expect(firstPage.locator('.region-selection-box')).toHaveCount(0);
  await pdfPage.keyboard.press('Escape');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'false');
  await expect(firstPage.locator('.region-selection-box')).toHaveCount(0);
  expect(visionRequests).toHaveLength(requestCount);

  await drawRegion();
  await pdfPage.locator('#zoom-in').click();
  await expect(regionButton).toHaveAttribute('aria-pressed', 'false');
  await expect(firstPage.locator('.region-selection-box')).toHaveCount(0);
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  expect(visionRequests).toHaveLength(requestCount);

  await drawRegion();
  await fileInput.setInputFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  await expect(pdfPage.locator('#document-name')).toHaveText('replacement.pdf');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'false');
  await expect(firstPage.locator('.region-selection-box')).toHaveCount(0);
  expect(visionRequests).toHaveLength(requestCount);
  await pdfPage.close();
});

test('creates and adjusts a PDF image region with the keyboard and touch-safe mode', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.setViewportSize({ width: 360, height: 700 });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'keyboard-region.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  await pdfPage.locator('#fit-width').click();
  await expect.poll(() => firstPage.evaluate((element) =>
    element.getBoundingClientRect().width)).toBeLessThanOrEqual(332);
  const regionButton = pdfPage.locator('#region-translate');
  await regionButton.focus();
  await regionButton.press('Enter');
  const selection = firstPage.locator('.region-selection-box');
  await expect(selection).toBeFocused();
  const confirmation = firstPage.locator('.region-confirm');
  await expect(confirmation).toBeVisible();
  await expect(pdfPage.locator('#notice')).toBeHidden();
  const controls = await firstPage.evaluate((element) => {
    const pageBounds = element.getBoundingClientRect();
    const confirmationElement = element.querySelector<HTMLElement>('.region-confirm');
    const buttons = [...confirmationElement?.querySelectorAll<HTMLElement>('button') ?? []];
    const handles = [...element.querySelectorAll<HTMLElement>('.region-resize-handle')];
    return {
      page: pageBounds.toJSON(),
      confirmation: confirmationElement?.getBoundingClientRect().toJSON(),
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      handles: handles.map((handle) => handle.getBoundingClientRect().toJSON()),
    };
  });
  expect(controls.confirmation).toBeDefined();
  if (controls.confirmation) {
    expect(controls.confirmation.left).toBeGreaterThanOrEqual(controls.page.left);
    expect(controls.confirmation.right).toBeLessThanOrEqual(controls.page.right);
  }
  expect(controls.buttonHeights.every((height) => height >= 30)).toBe(true);
  expect(controls.handles.every((handle) => (
    handle.left >= controls.page.left &&
    handle.top >= controls.page.top &&
    handle.right <= controls.page.right &&
    handle.bottom <= controls.page.bottom
  ))).toBe(true);
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-region-controls-360-light.png') });
    await pdfPage.emulateMedia({ colorScheme: 'dark' });
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-region-controls-360-dark.png') });
    await pdfPage.emulateMedia({ colorScheme: 'light' });
  }
  expect(await firstPage.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
  const before = await selection.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;
  await selection.press('ArrowRight');
  const moved = await selection.boundingBox();
  expect(moved).not.toBeNull();
  if (!moved) return;
  expect(moved.x).toBeCloseTo(before.x + 6, 0);
  expect(moved.width).toBeCloseTo(before.width, 0);
  await selection.press('Shift+ArrowRight');
  const resized = await selection.boundingBox();
  expect(resized).not.toBeNull();
  if (!resized) return;
  expect(resized.width).toBeCloseTo(moved.width + 6, 0);
  const northWestHandle = selection.locator('.region-resize-handle.nw');
  const northWestBounds = await northWestHandle.boundingBox();
  expect(northWestBounds).not.toBeNull();
  if (!northWestBounds) return;
  await pdfPage.mouse.move(
    northWestBounds.x + northWestBounds.width / 2,
    northWestBounds.y + northWestBounds.height / 2,
  );
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(
    northWestBounds.x + northWestBounds.width / 2 + 8,
    northWestBounds.y + northWestBounds.height / 2 + 6,
    { steps: 3 },
  );
  await pdfPage.mouse.up();
  const pointerResized = await selection.boundingBox();
  expect(pointerResized).not.toBeNull();
  if (!pointerResized) return;
  expect(pointerResized.x).toBeCloseTo(resized.x + 8, 0);
  expect(pointerResized.y).toBeCloseTo(resized.y + 6, 0);
  expect(pointerResized.width).toBeCloseTo(resized.width - 8, 0);
  expect(pointerResized.height).toBeCloseTo(resized.height - 6, 0);
  await selection.press('Tab');
  await expect(firstPage.locator('.region-confirm .confirm')).toBeFocused();
  await pdfPage.keyboard.press('Escape');
  await expect(selection).toHaveCount(0);
  await expect(regionButton).toHaveAttribute('aria-pressed', 'true');
  await pdfPage.keyboard.press('Escape');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'false');
  await pdfPage.close();
});

test('scopes ergonomic PDF region shortcuts to the reading surface', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'region-shortcuts.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  const regionButton = pdfPage.locator('#region-translate');
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');

  const pageNumber = pdfPage.locator('#page-number');
  await pageNumber.focus();
  await pageNumber.press('r');
  await expect(regionButton).toHaveAttribute('data-region-mode', 'off');

  await firstPage.click({ position: { x: 20, y: 20 } });
  await pdfPage.keyboard.press('r');
  await expect(regionButton).toHaveAttribute('data-region-mode', 'single');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'false');
  await pdfPage.keyboard.press('Escape');
  await expect(regionButton).toHaveAttribute('data-region-mode', 'off');

  await pdfPage.keyboard.press('Shift+r');
  await expect(regionButton).toHaveAttribute('data-region-mode', 'continuous');
  await expect(regionButton).toHaveAttribute('aria-pressed', 'true');
  await pdfPage.keyboard.press('Shift+r');
  await expect(regionButton).toHaveAttribute('data-region-mode', 'off');
  await pdfPage.close();
});

test('drops a delayed image capture after the user opens another PDF', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    const pending: Array<() => void> = [];
    Object.defineProperty(window, '__releasePiCapture', {
      configurable: true,
      value: () => pending.splice(0).forEach((release) => release()),
    });
    HTMLCanvasElement.prototype.toBlob = function delayedToBlob(callback, type, quality) {
      original.call(this, (blob) => {
        pending.push(() => callback(blob));
      }, type, quality);
    };
  });
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const fileInput = pdfPage.locator('#file-input');
  await fileInput.setInputFiles({
    name: 'old-capture.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const pageBox = await firstPage.boundingBox();
  expect(pageBox).not.toBeNull();
  if (!pageBox) return;
  const requestCount = visionRequests.length;
  await pdfPage.locator('#region-translate').click();
  await pdfPage.mouse.move(pageBox.x + 170, pageBox.y + 220);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(pageBox.x + 420, pageBox.y + 420, { steps: 5 });
  await pdfPage.mouse.up();
  await firstPage.locator('.region-confirm .confirm').click();
  await expect(pdfPage.locator('#notice')).toContainText('正在检查框选内容');
  await expect(pdfPage.locator('#notice')).toHaveAttribute('data-tone', 'info');

  await fileInput.setInputFiles({
    name: 'new-document.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('New document remains active.'),
  });
  await expect(pdfPage.locator('#document-name')).toHaveText('new-document.pdf');
  await pdfPage.evaluate(() => {
    (window as typeof window & { __releasePiCapture?: () => void }).__releasePiCapture?.();
  });
  await pdfPage.waitForTimeout(150);
  expect(visionRequests).toHaveLength(requestCount);
  await expect(pdfPage.locator('#tex-selection-translator-root'))
    .toHaveAttribute('data-pi-view', 'hidden');
  await expect(pdfPage.locator('.pdf-page').first().locator('.textLayer'))
    .toContainText('New document remains active.');
  await pdfPage.close();
});

test('rejects a vision provider that echoes the captured PDF image', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'private-scan.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const pageBox = await firstPage.boundingBox();
  expect(pageBox).not.toBeNull();
  if (!pageBox) return;
  await pdfPage.locator('#region-translate').click();
  await pdfPage.mouse.move(pageBox.x + 170, pageBox.y + 220);
  await pdfPage.mouse.down();
  await pdfPage.mouse.move(pageBox.x + 430, pageBox.y + 430, { steps: 8 });
  await pdfPage.mouse.up();
  mockControl.echoVisionPayloadOnce = true;
  const requestIndex = visionRequests.length;
  await firstPage.locator('.region-confirm .confirm').click();
  const overlay = pdfPage.locator('#tex-selection-translator-root');
  await expect(overlay.locator('.error')).toBeVisible();
  const request = visionRequests[requestIndex] as {
    messages?: Array<{ content?: Array<{ type?: string; image_url?: { url?: string } }> }>;
  };
  const imageUrl = request.messages?.[0]?.content
    ?.find((item) => item.type === 'image_url')?.image_url?.url;
  const serializedStorage = await pdfPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: { get(key: null): Promise<Record<string, unknown>> };
          session: { get(key: null): Promise<Record<string, unknown>> };
        };
      };
    }).chrome;
    const [local, session] = await Promise.all([
      api.storage.local.get(null),
      api.storage.session.get(null),
    ]);
    return JSON.stringify({ local, session });
  });
  expect(serializedStorage).not.toContain('data:image/');
  expect(serializedStorage).not.toContain(imageUrl?.slice(-80) ?? 'never-match');
  await pdfPage.close();
});

test('keeps recoverable PDF warnings compact and document errors persistent', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  const fileInput = pdfPage.locator('#file-input');
  const notice = pdfPage.locator('#notice');

  await fileInput.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a PDF'),
  });
  await expect(notice).toContainText('“notes.txt”不是 PDF 文件');
  await expect(notice).toHaveClass(/transient/);
  await expect(notice).toHaveAttribute('data-tone', 'warning');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveAttribute('aria-live', 'polite');

  await fileInput.setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a valid PDF payload'),
  });
  await expect(notice).toContainText('无法打开 PDF');
  await expect(notice).not.toHaveClass(/transient/);
  await expect(notice).toHaveAttribute('data-tone', 'error');
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(notice).toHaveAttribute('aria-live', 'assertive');
  expect(await notice.evaluate((element) => parseFloat(getComputedStyle(element).borderLeftWidth)))
    .toBeGreaterThan(2.5);
  await pdfPage.close();
});
