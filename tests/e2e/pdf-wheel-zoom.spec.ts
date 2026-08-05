import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let context: BrowserContext;
let page: Page;
let userDataDirectory: string;
let extensionId: string;

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
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

async function dispatchWheel(
  targetSelector: string,
  options: { ctrlKey: boolean; deltaY: number },
): Promise<{ defaultPrevented: boolean; dispatchResult: boolean }> {
  return page.locator(targetSelector).evaluate((element, init) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: init.ctrlKey,
      deltaY: init.deltaY,
    });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  }, options);
}

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-pdf-wheel-zoom-'));
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
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  page = context.pages()[0] ?? await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await rm(userDataDirectory, { recursive: true, force: true });
});

test('keeps Ctrl wheel zoom inside the PDF document surface', async () => {
  await page.goto(`chrome-extension://${extensionId}/pdf.html`);
  await page.locator('#file-input').setInputFiles({
    name: 'wheel-zoom.pdf',
    mimeType: 'application/pdf',
    buffer: createTextPdf('PDF wheel zoom acceptance.'),
  });
  await expect(page.locator('.pdf-page')).toHaveAttribute('data-rendered', 'ready');
  await expect(page.locator('#zoom-value')).toHaveText('125%');

  const pdfGesture = await dispatchWheel('.pdf-page', { ctrlKey: true, deltaY: -100 });
  expect(pdfGesture).toEqual({ defaultPrevented: true, dispatchResult: false });
  await expect(page.locator('#zoom-value')).toHaveText('150%');
  await expect(page.locator('.pdf-page')).toHaveAttribute('data-rendered', 'ready');

  const plainWheel = await dispatchWheel('.pdf-page', { ctrlKey: false, deltaY: -100 });
  expect(plainWheel).toEqual({ defaultPrevented: false, dispatchResult: true });
  await page.waitForTimeout(120);
  await expect(page.locator('#zoom-value')).toHaveText('150%');

  const toolbarGesture = await dispatchWheel('#pdf-toolbar', { ctrlKey: true, deltaY: -100 });
  expect(toolbarGesture).toEqual({ defaultPrevented: false, dispatchResult: true });
  await page.waitForTimeout(120);
  await expect(page.locator('#zoom-value')).toHaveText('150%');
});
