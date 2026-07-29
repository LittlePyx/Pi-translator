import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OVERLEAF_FIXTURE_URL =
  'https://www.overleaf.com/project/pi-translator-e2e';

let context: BrowserContext;
let page: Page;
let userDataDirectory: string;
let extensionId: string;
const visionRequests: Array<Record<string, unknown>> = [];
let echoVisionPayloadOnce = false;

interface TestChromeStorageArea {
  get(key: string): Promise<Record<string, Record<string, unknown>>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface TestChromeApi {
  storage: {
    local: TestChromeStorageArea;
    session: Pick<TestChromeStorageArea, 'set'>;
  };
}

function createTextPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

function createTwoPageTextPdf(firstText: string, secondText: string): Buffer {
  const content = (text: string) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  };
  const firstStream = content(firstText);
  const secondStream = content(secondText);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(firstStream)} >>\nstream\n${firstStream}\nendstream`,
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

function createRasterPdf(): Buffer {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const dark = ((x < width / 2) !== (y < height / 2));
      pixels[offset] = dark ? 45 : 220;
      pixels[offset + 1] = dark ? 66 : 228;
      pixels[offset + 2] = dark ? 96 : 239;
    }
  }
  const compressed = deflateSync(pixels);
  const pageContent = Buffer.from('q\n400 0 0 400 100 250 cm\n/Scan Do\nQ');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${pageContent.length} >>\nstream\n`),
      pageContent,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const serialized = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(serialized);
    length += serialized.length;
  });
  const xrefOffset = length;
  const xref = Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
  chunks.push(xref);
  return Buffer.concat(chunks);
}

async function selectSourceText(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  const source = page.locator('#source');
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

async function clearBrowserSelection(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-e2e-'));
  const extensionPath = path.resolve('.output/edge-mv3');
  context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: EDGE_EXECUTABLE,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  extensionId = new URL(serviceWorker.url()).host;

  const bootstrapPages = context.pages();
  const bootstrapPage = bootstrapPages[0] ?? await context.newPage();
  await bootstrapPage.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = bootstrapPage.locator('#onboarding-dialog');
  if (await onboarding.isVisible()) {
    await bootstrapPage.locator('#onboarding-skip').click();
  }
  await bootstrapPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        apiProfiles: [{
          id: 'default',
          name: 'E2E API',
          apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
          model: 'e2e-model',
        }, {
          id: 'vision-e2e',
          name: 'E2E Vision API',
          apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-vision',
          model: 'e2e-vision-model',
        }],
        activeApiProfileId: 'default',
        visionApiProfileId: 'vision-e2e',
        visionModel: 'e2e-vision-model',
        apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
        model: 'e2e-model',
        onboardingCompleted: true,
      },
    });
    await extensionChrome.storage.session.set({
      apiKeysByProfile: { default: 'e2e-key', 'vision-e2e': 'e2e-vision-key' },
    });
  });
  await Promise.all(
    context.pages()
      .filter((tab) => tab !== bootstrapPage)
      .map((tab) => tab.close()),
  );
  page = await context.newPage();
  await bootstrapPage.close();
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              translation: '一致的学术翻译能够提升研究论文的可读性。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '一致的学术翻译能够提升研究论文的可读性。',
              }],
            }),
          },
        }],
      }),
    });
  });
  await context.route('https://www.overleaf.com/pi-translator-e2e-vision/**', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    visionRequests.push(body);
    const requestImage = (body.messages as Array<{
      content?: Array<{ type?: string; image_url?: { url?: string } }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'image_url')?.image_url?.url;
    const shouldEcho = echoVisionPayloadOnce;
    echoVisionPayloadOnce = false;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              translation: '图像区域的学术翻译结果。',
              recognizedText: shouldEcho ? requestImage : 'Scanned academic source text.',
              uncertainSpans: [],
            }),
          },
        }],
      }),
    });
  });
  await page.route(OVERLEAF_FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <body style="font: 18px sans-serif; padding: 80px">
            <p id="source">A consistent academic translation improves the readability of research papers.</p>
            <input id="payment" type="text" autocomplete="cc-number" value="4111 1111 1111 1111" />
            <button id="blank" type="button">Clear selection</button>
          </body>
        </html>`,
    });
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('exposes the native Edge side panel API to the service worker', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const availability = await worker!.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      browser?: { sidePanel?: unknown };
      chrome?: { sidePanel?: unknown };
    };
    return {
      browserNamespace: Boolean(scope.browser),
      browserSidePanel: Boolean(scope.browser?.sidePanel),
      chromeSidePanel: Boolean(scope.chrome?.sidePanel),
    };
  });
  expect(availability.chromeSidePanel || availability.browserSidePanel).toBe(true);
});

test('keeps the native PDF side panel disabled on unrelated webpages', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  await expect.poll(() => worker!.evaluate(async (targetUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
        sidePanel: {
          getOptions(options: { tabId: number }): Promise<{ enabled?: boolean }>;
        };
      };
    }).chrome;
    const tabs = await api.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === targetUrl);
    if (tab?.id === undefined) return undefined;
    return (await api.sidePanel.getOptions({ tabId: tab.id })).enabled;
  }, page.url())).toBe(false);
});

test('shows and hides the selection trigger with the browser selection', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');

  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('opens, drags, and dismisses a translation card', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');

  const card = overlay.locator('.card');
  const header = overlay.locator('.header');
  await expect(card).toBeVisible();
  await expect(header).toBeVisible();
  const before = await card.boundingBox();
  const handle = await header.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();
  if (!before || !handle) return;

  const deltaX = before.x > 150 ? -80 : 80;
  const deltaY = before.y > 150 ? -55 : 55;
  await page.mouse.move(handle.x + 30, handle.y + 14);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + 30 + deltaX,
    handle.y + 14 + deltaY,
    { steps: 6 },
  );
  await page.mouse.up();

  const after = await card.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? before.x) - before.x)).toBeGreaterThan(30);

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('updates the target language from the quick popup', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const targetLanguage = popup.locator('#target-language');
  await expect(targetLanguage).toHaveValue('zh-CN');
  await targetLanguage.selectOption('en');
  await expect(popup.locator('#status')).toContainText('目标语言已更新');
  await popup.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('#target-language')).toHaveValue('en');
  await reopened.close();
});

test('opens the full settings page in a browser tab', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const openSettings = popup.locator('#open-settings');
  await expect(openSettings).toBeVisible();

  const settingsPagePromise = context.waitForEvent('page');
  await openSettings.click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
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
  await pdfPage.waitForLoadState('domcontentloaded');
  expect(new URL(pdfPage.url()).pathname).toBe('/pdf.html');
  await expect(pdfPage.locator('#empty-state')).toBeVisible();
  await pdfPage.close();
  if (!popup.isClosed()) await popup.close();
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
    await expect(pdfPage.locator('#page-count')).toHaveText('2 页');
    const secondPage = pdfPage.locator('.pdf-page[data-page-number="2"]');
    await expect(secondPage).toHaveAttribute('data-rendered', 'ready');
    await expect(secondPage.locator('.textLayer')).toContainText('Inherited second page.');
    const distanceFromTop = async (): Promise<number> => pdfPage.evaluate(() => {
      const stage = document.querySelector('#document-stage');
      const page = document.querySelector('.pdf-page[data-page-number="2"]');
      if (!(stage instanceof HTMLElement) || !(page instanceof HTMLElement)) return Infinity;
      return Math.abs(page.getBoundingClientRect().top - stage.getBoundingClientRect().top);
    });
    expect(await distanceFromTop()).toBeLessThan(80);

    await pdfPage.locator('#zoom-in').click();
    await expect(secondPage).toHaveAttribute('data-rendered', 'ready');
    await expect.poll(distanceFromTop).toBeLessThan(80);
  } finally {
    await pdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('opens a local PDF and exposes selectable text to the translator', async ({}, testInfo) => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'selectable-paper.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('Selectable PDF text for translation.'),
  });

  await expect(pdfPage.locator('#document-name')).toHaveText('selectable-paper.pdf');
  await expect(pdfPage.locator('#page-count')).toHaveText('1 页');
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
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
  if (process.env.PI_VISUAL_QA) {
    await pdfPage.screenshot({ path: testInfo.outputPath('pdf-reader.png') });
  }
  await pdfPage.close();
});

test('translates a confirmed PDF image region without storing the screenshot', async () => {
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
  await expect(scanHint).toContainText('扫描版 PDF');
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
  await expect(firstPage.locator('.region-confirm-note')).toHaveText('仅此区域会发送至视觉 API');
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
  await firstPage.locator('.region-confirm .confirm').click();
  await expect(pdfPage.locator('#notice')).toBeHidden();
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
  echoVisionPayloadOnce = true;
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

test('renders streaming native PDF translations in the Edge side panel UI', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(sidePanel.locator('#empty-state')).toBeVisible();
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  await messageSender.waitForTimeout(150);

  const baseSession = {
    tabId,
    requestId: 'pdf-side-panel-e2e',
    sourceText: 'Streaming translations should remain beside the native PDF reader.',
    pageUrl: 'https://www.overleaf.com/native-reader.pdf',
    pageNumber: 6,
    sourceLabel: 'native-reader.pdf',
    status: 'translating',
    startedAt: Date.now(),
    partialText: '流式译文应当',
    completedChunks: 0,
    totalChunks: 1,
  } as const;
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: session,
    });
  }, baseSession);

  await expect(sidePanel.locator('#session')).toBeVisible();
  await expect(sidePanel.locator('#source-label')).toHaveText('native-reader.pdf');
  await expect(sidePanel.locator('#translation-state')).toHaveText('正在流式接收');
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#open-pi-reader')).toHaveText('用 Pi 打开');
  await expect(sidePanel.locator('#reader-hint-text')).toContainText('第 6 页');

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        partialText: '流式译文应当显示在原生 PDF 阅读器旁边。',
        result: {
          requestId: session.requestId,
          originalText: session.sourceText,
          translatedText: '流式译文应当显示在原生 PDF 阅读器旁边。',
          warnings: [],
          latencyMs: 850,
        },
      },
    });
  }, baseSession);
  await expect(sidePanel.locator('#translation-text'))
    .toHaveText('流式译文应当显示在原生 PDF 阅读器旁边。');
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  const inheritedReaderPromise = context.waitForEvent('page');
  await sidePanel.locator('#open-pi-reader').click();
  const inheritedReader = await inheritedReaderPromise;
  await inheritedReader.waitForLoadState('domcontentloaded');
  const inheritedUrl = new URL(inheritedReader.url());
  expect(inheritedUrl.pathname).toBe('/pdf.html');
  expect(inheritedUrl.searchParams.get('url'))
    .toBe('https://www.overleaf.com/native-reader.pdf');
  expect(inheritedUrl.searchParams.get('page')).toBe('6');
  await inheritedReader.close();
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.setViewportSize({ width: 390, height: 820 });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel.png') });
  }
  await messageSender.close();
  await sidePanel.close();
});

test('opens the full settings page from the translation card menu', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.locator('details.more > summary').click();

  const settingsPagePromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '完整设置' }).click();
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  const settingsUrl = new URL(settingsPage.url());
  expect(settingsUrl.protocol).toBe('chrome-extension:');
  expect(settingsUrl.host).toBe(extensionId);
  expect(settingsUrl.pathname).toBe('/options.html');
  await settingsPage.close();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  await clearBrowserSelection();
});

test('pins continuous translation to a collapsible sidebar', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('固定到连续翻译侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const moreMenu = overlay.locator('details.more');
  await moreMenu.locator('summary').click();
  const menu = overlay.locator('.menu');
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText('收藏当前译文');
  await expect(menu).not.toContainText('导出当前会话为 Markdown');
  await expect(menu).not.toContainText('复制原文与译文');
  await expect(menu).not.toContainText('翻译风格');
  await expect(menu).not.toContainText('应用并重新翻译');
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (menuBox && viewport) {
    expect(menuBox.y).toBeGreaterThanOrEqual(8);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 8);
  }
  await page.locator('#blank').click();
  await expect(moreMenu).not.toHaveAttribute('open', '');
  await overlay.getByTitle('收起侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  await overlay.getByTitle('展开 Pi Translator 连续翻译侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
});

test('skips sensitive form fields during continuous translation', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await page.locator('#payment').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, input.value.length);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.notice')).toContainText('已跳过敏感输入区域');
});

test('keeps advanced options collapsed until requested', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = options.locator('#onboarding-dialog');
  await expect(onboarding).not.toBeVisible();
  await expect(options.locator('[data-settings-section="connection"]')).toBeVisible();
  await expect(options.locator('[data-settings-section="results"]')).not.toBeVisible();
  await options.locator('[data-settings-target="results"]').click();
  await expect(options.locator('[data-settings-section="results"]')).toBeVisible();
  const advanced = options.locator('details.advanced-panel');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(options.locator('#context-mode')).toBeVisible();
  await expect(options.locator('#enable-streaming')).toBeVisible();
  await expect(options.locator('#protect-sensitive-fields')).toBeVisible();
  await options.locator('#alignment-default').check();
  await expect(options.locator('#save-state')).toContainText('未保存');
  await options.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.locator('[data-settings-target="support"]').click();
  const support = reopened.locator('details.support-disclosure');
  await expect(support).not.toHaveAttribute('open', '');
  await support.locator('summary').click();
  await reopened.locator('#restart-onboarding').click();
  await expect(reopened.locator('#onboarding-dialog')).toBeVisible();
  const onboardingPreset = reopened.locator('#onboarding-preset');
  await expect(onboardingPreset.locator('option[value="custom"]')).toHaveText(
    '自定义 OpenAI 兼容 API',
  );
  await onboardingPreset.selectOption('deepseek');
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue(
    'https://api.deepseek.com',
  );
  await onboardingPreset.selectOption('custom');
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue('');
  await expect(reopened.locator('#onboarding-model')).toHaveValue('');
  await reopened.close();
});
