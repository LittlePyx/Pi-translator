import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type JSHandle,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { createHash } from 'node:crypto';
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
const textRequests: Array<Record<string, unknown>> = [];
let echoVisionPayloadOnce = false;
let failNextRevisionRequest = false;
let returnRevisedVisionResultOnce = false;
let returnPendingVisionReviewOnce = false;
let failNextRecoveryRequestAfterPartial = false;
let partialRecoveryRequestIndex = 0;
let releasePartialRecoveryFailure: (() => void) | undefined;
let partialRecoveryFailureGate: Promise<void> = Promise.resolve();

interface TestChromeStorageArea {
  get(key: string): Promise<Record<string, Record<string, unknown>>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface TestChromeApi {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: TestChromeStorageArea;
    session: Pick<TestChromeStorageArea, 'set' | 'remove'>;
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

function createMultilineTextPdf(lines: string[]): Buffer {
  const commands = lines.map((line, index) => {
    const escaped = line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `${index ? '0 -24 Td\n' : ''}(${escaped}) Tj`;
  }).join('\n');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n${commands}\nET`;
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
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

async function createFileDataTransfer(
  targetPage: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
): Promise<JSHandle<DataTransfer>> {
  return targetPage.evaluateHandle((payloads) => {
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], payload.name, {
        type: payload.mimeType,
        lastModified: 1_780_000_000_000,
      }));
    }
    return transfer;
  }, files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.buffer.toString('base64'),
  })));
}

function createTwoColumnTextPdf(
  leftLines: string[],
  rightLines: string[],
  spanningLines: Array<{ text: string; x: number; y: number }> = [],
): Buffer {
  const command = (text: string, x: number, y: number) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 11 Tf\n${x} ${y} Td\n(${escaped}) Tj\nET`;
  };
  const stream = [
    ...leftLines.map((line, index) => command(line, 54, 700 - index * 22)),
    ...spanningLines.map((line) => command(line.text, line.x, line.y)),
    ...rightLines.map((line, index) => command(line, 330, 700 - index * 22)),
  ].join('\n');
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
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

function createTableTextPdf(rows: string[][]): Buffer {
  const columnEdges = [64, 224, 384, 548];
  const tableTop = 716;
  const rowHeight = 38;
  const command = (text: string, x: number, y: number) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 12 Tf\n${x} ${y} Td\n(${escaped}) Tj\nET`;
  };
  const grid = [
    'q',
    '0.65 w',
    ...Array.from({ length: rows.length + 1 }, (_, index) => {
      const y = tableTop - index * rowHeight;
      return `${columnEdges[0]} ${y} m ${columnEdges.at(-1)} ${y} l S`;
    }),
    ...columnEdges.map((x) => (
      `${x} ${tableTop} m ${x} ${tableTop - rows.length * rowHeight} l S`
    )),
    'Q',
  ];
  const cells = rows.flatMap((row, rowIndex) => row.map((text, columnIndex) => command(
    text,
    columnEdges[columnIndex]! + 10,
    tableTop - rowIndex * rowHeight - 24,
  )));
  const stream = [...grid, ...cells].join('\n');
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

function createMultiPageTextPdf(
  pages: Array<{ text: string; width?: number; height?: number }>,
): Buffer {
  const pageCount = pages.length;
  const fontObject = 3 + pageCount;
  const firstContentObject = fontObject + 1;
  const pageObjects = pages.map((page, index) => {
    const width = page.width ?? 612;
    const height = page.height ?? 792;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`;
  });
  const streams = pages.map((page) => {
    const escaped = page.text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    const stream = `BT\n/F1 18 Tf\n72 ${(page.height ?? 792) - 72} Td\n(${escaped}) Tj\nET`;
    return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  const kids = pages.map((_, index) => `${3 + index} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
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

async function closeVisibleTranslationSurfaceForCleanup(): Promise<void> {
  await page.locator('#tex-selection-translator-root .surface-close').evaluateAll((buttons) => {
    const visibleButton = buttons.find(
      (button) => (button as HTMLElement).getClientRects().length > 0,
    );
    (visibleButton as HTMLButtonElement | undefined)?.click();
  });
}

async function selectElementText(selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`Missing selection target: ${targetSelector}`);
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, selector);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

async function waitForVisibleBoundingBox(
  locator: Locator,
  description: string,
): Promise<NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>> {
  let resolved: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect.poll(async () => {
    const candidate = await locator.boundingBox().catch(() => null);
    if (candidate && candidate.width > 0 && candidate.height > 0) resolved = candidate;
    return resolved !== null;
  }, { message: `Expected a visible bounding box for ${description}.` }).toBe(true);
  if (!resolved) throw new Error(`Expected a visible bounding box for ${description}.`);
  return resolved;
}

async function replaceStoredApiKeys(keys: Record<string, string>): Promise<void> {
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.evaluate(async (nextKeys) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      await Promise.all([
        extensionChrome.storage.session.set({ apiKeysByProfile: nextKeys }),
        extensionChrome.storage.local.set({ apiKeysByProfile: {} }),
        extensionChrome.storage.session.remove(['apiKey', 'deepseekApiKey']),
        extensionChrome.storage.local.remove(['apiKey', 'deepseekApiKey']),
      ]);
    }, keys);
  } finally {
    await extensionPage.close();
  }
}

async function setStoredSidebarMode(mode: 'floating' | 'browser'): Promise<void> {
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.evaluate(async (nextMode) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      await extensionChrome.storage.local.set({
        extensionSettings: {
          ...(stored.extensionSettings ?? {}),
          sidebarMode: nextMode,
        },
      });
    }, mode);
  } finally {
    await extensionPage.close();
  }
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
  await expect(bootstrapPage.locator('#api-profile option')).not.toHaveCount(0);
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
    if (route.request().method() === 'GET' && route.request().url().endsWith('/models')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'e2e-model' }, { id: 'e2e-model-fast' }] }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const imageMessageContent = (body.messages as Array<{
      content?: string | Array<{ type?: string; text?: string }>;
    }> | undefined)?.find((message) => Array.isArray(message.content) &&
      message.content.some((item) => item.type === 'image_url'))?.content;
    const imagePrompt = Array.isArray(imageMessageContent)
      ? imageMessageContent.find((item) => item.type === 'text')?.text ?? ''
      : '';
    const isVisionProbe = imagePrompt.includes('Read the four black characters');
    const isImageTranslation = Array.isArray(imageMessageContent) && !isVisionProbe;
    const serializedBody = JSON.stringify(body);
    const userMessageContent = (body.messages as Array<{
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
    }> | undefined)?.find((message) => message.role === 'user' &&
      typeof message.content === 'string')?.content;
    let requestedText = '';
    if (typeof userMessageContent === 'string') {
      try {
        const payload = JSON.parse(userMessageContent) as { text?: unknown };
        if (typeof payload.text === 'string') requestedText = payload.text;
      } catch {
        requestedText = userMessageContent;
      }
    }
    const isMultiSentenceSelection = requestedText.includes('First important sentence');
    const isBrowserLongSelection = requestedText.includes(
      'A long browser side panel result should keep its reading position.',
    );
    const isDenseMetadataSelection = requestedText.includes('Dense metadata');
    const isGlobalTermSelection = requestedText.includes('benefits every reader');
    const isGlossaryReviewSelection = requestedText.includes('should remain stable');
    const isLexicalLookupSelection = requestedText.includes('continuity');
    const isDocumentTermSelection = requestedText.includes('The adaptive sensing policy') ||
      requestedText.includes('This adaptive sensing method');
    const isPdfOptimizerFallback = requestedText.includes('Optimizer fallback fixture');
    const isTranslationRevision = serializedBody.includes('translationRevisionPreference');
    const isPartialRecoverySelection = requestedText.includes(
      'A recovery request may already contain a partial translation.',
    );
    if (!isVisionProbe && !isImageTranslation) textRequests.push(body);
    if (isPartialRecoverySelection && failNextRecoveryRequestAfterPartial) {
      partialRecoveryRequestIndex += 1;
      if (partialRecoveryRequestIndex === 1) {
        const content = JSON.stringify({
          translation: '已收到的部分译文。',
          detectedLanguage: 'en',
          warnings: [],
          segments: [],
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content } }] }),
        });
        return;
      }
      await partialRecoveryFailureGate;
      failNextRecoveryRequestAfterPartial = false;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: 'Synthetic authentication failure after partial output.',
            type: 'authentication_error',
          },
        }),
      });
      return;
    }
    if (isTranslationRevision && failNextRevisionRequest) {
      failNextRevisionRequest = false;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Synthetic revision failure.', type: 'invalid_request_error' },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isVisionProbe ? 'K7M2' : JSON.stringify(isImageTranslation ? {
              translation: '自动识别并翻译的图像区域。',
              recognizedText: 'Automatically recognized image text.',
              uncertainSpans: [],
            } : isTranslationRevision ? {
              translation: '经用户调整后，更忠实地保留原文限定条件。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isPdfOptimizerFallback ? {
              translation: String.raw`优化目标为 \[Q^{\Pi^*}=\operatorname{argmin}P\in P(V,\Omega)\left\{KL(P\Vert Q)\right\},\tag{12}\]`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isDenseMetadataSelection ? {
              translation: String.raw`密集元信息在窄屏中保持清晰，\[\operatorname{ELBO}(\theta,\phi)=\mathbb{E}_{q_\phi(z\mid x)}[\log p_\theta(x,z)-\log q_\phi(z\mid x)]+\lambda\sum_{i=1}^{n}\lVert x_i-\hat{x}_i\rVert_2^2+\gamma\prod_{j=1}^{m}\frac{p_\theta(y_j\mid z)}{q_\phi(z\mid x_j)}+\eta\sum_{k=1}^{r}\left\lVert A_kx-b_k\right\rVert_F^2\tag{12}\] 也可切换。`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isBrowserLongSelection ? {
              translation: [
                '浏览器侧栏中的长译文会保留当前阅读位置；即使内容包含多个较长段落，用户也可以在结果顶部与底部之间快速移动，而不会影响原网页中的阅读上下文。阅读过程中可以继续核对原文、辨认段落边界，并在需要时复制已经完成的内容，侧栏不会因为一次轻微滚动就擅自跳回末尾。',
                String.raw`视图切换时仍会保持公式 \(E=mc^2\) 及其周围文字的相对位置；全文、逐句对照和公式源码均使用同一份已完成结果，不会再次调用翻译接口。即使数学渲染改变了段落高度，阅读位置也会根据当前结果重新校准，使公式之前和之后的说明仍然处于相近的视野范围内。`,
                '从较早的历史译文返回后，侧栏会恢复这条长译文上次停留的位置；新的网页划词结果则从译文开头开始显示，让连续阅读、比较和复制保持清楚而连贯。只有确实超出一屏的结果才显示紧凑的阅读导航，较短的单句与词语翻译仍保持原本简洁的操作区。',
              ].join('\n\n'),
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '浏览器侧栏中的长译文会保留当前阅读位置；即使内容包含多个较长段落，用户也可以在结果顶部与底部之间快速移动，而不会影响原网页中的阅读上下文。阅读过程中可以继续核对原文、辨认段落边界，并在需要时复制已经完成的内容，侧栏不会因为一次轻微滚动就擅自跳回末尾。',
              }, {
                id: 'C1S2',
                translation: String.raw`视图切换时仍会保持公式 \(E=mc^2\) 及其周围文字的相对位置；全文、逐句对照和公式源码均使用同一份已完成结果，不会再次调用翻译接口。即使数学渲染改变了段落高度，阅读位置也会根据当前结果重新校准，使公式之前和之后的说明仍然处于相近的视野范围内。`,
              }, {
                id: 'C1S3',
                translation: '从较早的历史译文返回后，侧栏会恢复这条长译文上次停留的位置；新的网页划词结果则从译文开头开始显示，让连续阅读、比较和复制保持清楚而连贯。只有确实超出一屏的结果才显示紧凑的阅读导航，较短的单句与词语翻译仍保持原本简洁的操作区。',
              }],
            } : isMultiSentenceSelection ? {
              translation: '第一句重要译文。第二句补充译文。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '第一句重要译文。',
              }, {
                id: 'C1S2',
                translation: '第二句补充译文。',
              }],
            } : isGlobalTermSelection ? {
              translation: '一致的学术翻译能够提升研究论文的可读性。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isGlossaryReviewSelection ? {
              translation: '这种技术表达应保持稳定。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isLexicalLookupSelection ? {
              translation: '连续性',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
              lookup: {
                pronunciation: '/ˌkɒntɪˈnjuːəti/',
                partOfSpeech: 'noun',
                senses: [
                  { partOfSpeech: 'noun', meaning: '连续性' },
                  { partOfSpeech: 'noun', meaning: '连贯性' },
                ],
              },
            } : isDocumentTermSelection ? {
              translation: '自适应感知策略在该文档中保持稳定，并在具有层级约束的多阶段重建任务中持续保持一致的技术术语与推理边界。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
              termCandidates: [{
                source: 'adaptive sensing',
                target: '自适应感知',
              }],
            } : {
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
      content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'image_url')?.image_url?.url;
    const imagePrompt = (body.messages as Array<{
      content?: Array<{ type?: string; text?: string }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'text')?.text ?? '';
    const isEnergyFormula = imagePrompt.includes('Energy E = mc^2');
    const isEscapedFormula = imagePrompt.includes('Escaped distribution');
    const isRenderedFormula = imagePrompt.includes('∑ᵢ xᵢ²');
    const formulaLatex = isEscapedFormula
      ? String.raw`\\mathbb{Q}_\\Omega\\`
      : isEnergyFormula
      ? 'E=mc^2'
      : isRenderedFormula
        ? '\\sum_i x_i^2 \\ge 0'
        : undefined;
    const shouldEcho = echoVisionPayloadOnce;
    echoVisionPayloadOnce = false;
    const shouldReturnRevisedRecognition = returnRevisedVisionResultOnce;
    returnRevisedVisionResultOnce = false;
    const shouldReturnPendingReview = returnPendingVisionReviewOnce;
    returnPendingVisionReviewOnce = false;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              translation: isEscapedFormula
                ? String.raw`退出分布 $\\mathbb{Q}_\\Omega\\$ 与目标匹配，另有 $mathbbQ_\\Omega$。`
                : isEnergyFormula
                ? '能量关系式 $E=mc^2$ 保持不变。'
                : isRenderedFormula
                  ? '该量满足 $\\sum_i x_i^2 \\ge 0$。'
                  : shouldReturnRevisedRecognition
                    ? '重新识别后修正的学术翻译结果。'
                  : '图像区域的学术翻译结果。',
              recognizedText: shouldEcho
                ? requestImage
                : isEscapedFormula
                  ? String.raw`Escaped distribution $\\mathbb{Q}_\\Omega\\$ is invariant, plus $mathbbQ_\\Omega$.`
                  : isEnergyFormula
                  ? 'Energy $E=mc^2$ is invariant.'
                  : isRenderedFormula
                    ? 'The quantity $\\sum_i x_i^2 \\ge 0$ is nonnegative.'
                    : shouldReturnRevisedRecognition
                      ? 'Re-recognized academic source text.'
                      : 'Scanned academic source text.',
              formulaLatex: formulaLatex ? [formulaLatex] : [],
              uncertainSpans: shouldReturnPendingReview
                ? ['The formula subscript is not fully legible.']
                : [],
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
          <head><title>Pi Translator E2E Paper</title></head>
          <body style="font: 18px sans-serif; padding: 80px">
            <p id="source">A consistent academic translation improves the readability of research papers.</p>
            <p id="global-term-source">A consistent academic translation benefits every reader.</p>
            <p id="term-review-source">A technical term should remain stable.</p>
            <p id="lookup-source">continuity</p>
            <p id="multi-source">First important sentence. Second supporting sentence.</p>
            <p id="browser-history-source">A browser side panel keeps recent translations easy to revisit.</p>
            <p id="browser-long-source">A long browser side panel result should keep its reading position. Einstein's energy relation may appear as a rendered formula while the view changes. Returning from an older translation should restore the previous place.</p>
            <p id="term-source">The adaptive sensing policy is stable in this document.</p>
            <p id="term-followup">This adaptive sensing method remains consistent.</p>
            <p id="recovery-source">A configured API should resume this selected translation automatically.</p>
            <p id="partial-recovery-source">A recovery request may already contain a partial translation.</p>
            <p id="math-source">The objective
              <span class="katex" data-tex="\\mathcal{L}=\\sum_i(x_i-y_i)^2">ℒ = Σᵢ(xᵢ − yᵢ)²</span>
              is minimized during training.
            </p>
            <p id="rendered-only-math">The quantity ∑ᵢ xᵢ² ≥ 0 is nonnegative.</p>
            <div id="visual-region" aria-label="Synthetic chart without DOM text" style="width: 360px; height: 140px; border: 1px solid #94a3b8; background: linear-gradient(135deg, #dbeafe 0 33%, #818cf8 33% 66%, #1e3a8a 66%);"></div>
            <div style="margin-top: 48px">
              <pre><code id="code-source">const translated = items.map((item) =&gt; translate(item));</code></pre>
              <p id="mixed-code-source">Run <code>npm run build:edge</code> after updating the extension source.</p>
              <div class="cm-editor"><div class="cm-content">
                <p id="overleaf-editor-prose">Natural-language prose inside the Overleaf editor remains translatable.</p>
                <p id="latex-structure">\\begin{equation} E = mc^2 \\end{equation}</p>
              </div></div>
              <div class="xterm"><span id="terminal-source">The development server is waiting for another command.</span></div>
            </div>
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

test.afterEach(() => {
  echoVisionPayloadOnce = false;
  failNextRevisionRequest = false;
  returnRevisedVisionResultOnce = false;
  returnPendingVisionReviewOnce = false;
  failNextRecoveryRequestAfterPartial = false;
  partialRecoveryRequestIndex = 0;
  releasePartialRecoveryFailure?.();
  releasePartialRecoveryFailure = undefined;
  partialRecoveryFailureGate = Promise.resolve();
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

test('keeps passive code browsing quiet while continuous and explicit translation remain available', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await clearBrowserSelection();
  const close = overlay.locator('.surface-close');
  if (await close.isVisible().catch(() => false)) await close.click();

  for (const selector of ['#code-source', '#terminal-source', '#latex-structure']) {
    await selectElementText(selector);
    await page.waitForTimeout(240);
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  }

  await selectElementText('#overleaf-editor-prose');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const requestsBeforePassiveSidebarSelection = textRequests.length;
  await selectElementText('#code-source');
  await expect.poll(() => textRequests.length).toBe(requestsBeforePassiveSidebarSelection + 1);
  await expect(overlay.locator('.body')).not.toBeEmpty();
  const requestsBeforeMixedSidebarSelection = textRequests.length;
  await selectElementText('#mixed-code-source');
  await expect.poll(() => textRequests.length).toBe(requestsBeforeMixedSidebarSelection + 1);
  await expect(overlay.locator('.body')).not.toBeEmpty();
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');

  await selectElementText('#code-source');
  await page.waitForTimeout(240);
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  const sender = await context.newPage();
  try {
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    await sender.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          };
        };
      }).chrome;
      const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
      if (target?.id === undefined) throw new Error('Missing target tab for explicit translation.');
      await api.tabs.sendMessage(target.id, { type: 'TRIGGER_TRANSLATE' });
    }, page.url());
  } finally {
    await sender.close();
  }
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.body')).not.toBeEmpty();
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('reports the shortcut actually assigned by Edge', async () => {
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const commands = await worker!.evaluate(() => new Promise<Array<{
    name?: string;
    shortcut?: string;
  }>>((resolve) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { commands: { getAll(callback: (commands: Array<{
        name?: string;
        shortcut?: string;
      }>) => void): void } };
    }).chrome;
    api.commands.getAll(resolve);
  }));
  const translationCommand = commands.find((command) => command.name === 'translate-selection');
  expect(translationCommand).toBeDefined();

  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const onboarding = options.locator('#onboarding-dialog');
    if (await onboarding.isVisible()) await options.locator('#onboarding-skip').click();
    const chip = options.locator('#translation-shortcut-chip');
    if (translationCommand?.shortcut) {
      await expect(chip).toContainText(translationCommand.shortcut.replaceAll('+', ' + '));
      await expect(options.locator('#translation-shortcut-help'))
        .toContainText(translationCommand.shortcut.split('+')[0]!);
    } else {
      await expect(chip).toHaveText('翻译快捷键未设置');
      await expect(options.locator('#open-shortcuts')).toHaveText('设置快捷键');
    }
  } finally {
    await options.close();
  }

  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const readinessPanel = popup.locator('#readiness-panel');
    await expect(readinessPanel).not.toHaveAttribute('aria-busy', 'true');
    if (translationCommand?.shortcut) {
      await expect(readinessPanel).toHaveAttribute('data-state', 'ready');
      await expect(readinessPanel).toBeHidden();
      await expect(popup.locator('#readiness-issues')).toBeHidden();
    } else {
      await expect(readinessPanel).toHaveAttribute('data-state', 'issue');
      await expect(popup.locator('#readiness-issues')).toContainText('翻译快捷键尚未设置');
      await expect(readinessPanel.getByRole('button', { name: '设置快捷键' })).toBeVisible();
    }
  } finally {
    await popup.close();
  }
});

test('shows a compact contextual lookup for a short selection', async () => {
  const requestsBefore = textRequests.length;
  await selectElementText('#lookup-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();

  await expect(overlay.locator('.title')).toHaveText('简明释义');
  await expect(overlay.locator('.lexical-source')).toHaveText('continuity');
  await expect(overlay.locator('.lexical-meta')).toContainText('/ˌkɒntɪˈnjuːəti/');
  await expect(overlay.locator('.lexical-meta')).toContainText('noun');
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');
  await expect(overlay.locator('.lexical-sense')).toContainText('连贯性');

  await overlay.getByRole('button', { name: '按普通译文方式查看' }).click();
  await expect(overlay.locator('.title')).toHaveText('翻译结果');
  await expect(overlay.locator('.body')).toHaveText('连续性');
  await overlay.getByRole('button', { name: '返回短词和短语释义' }).click();
  await expect(overlay.locator('.lexical-meaning')).toHaveText('连续性');

  expect(textRequests).toHaveLength(requestsBefore + 1);
  const request = JSON.stringify(textRequests.at(-1));
  expect(request).toContain('lookup_and_translate');
  expect(request).toContain('lookupMode');
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
});

test('deep-links recovery actions to API and PDF image settings', async () => {
  const options = await context.newPage();
  try {
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=api#connection`);
    await expect(options.locator('#api-key')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=api-model#connection`,
    );
    await expect(options.locator('#model')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=api-permission#connection`,
    );
    await expect(options.locator('#connection-advanced')).toHaveAttribute('open', '');
    await expect(options.locator('#test-connection')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=pages#pages`);
    await expect(options.locator('#settings-pages')).toBeVisible();
    await expect(options.locator('#general-page-mode')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=vision#connection`);
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open', '');
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#api-key')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-model#connection`,
    );
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#vision-model')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-permission#connection`,
    );
    await expect(options.locator('#api-profile')).toHaveValue('vision-e2e');
    await expect(options.locator('#test-vision-capability')).toBeFocused();
    await options.goto(
      `chrome-extension://${extensionId}/options.html?focus=vision-ocr#connection`,
    );
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open', '');
    await expect(options.locator('#setup-qwen')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=glossary#translation`);
    await expect(options.locator('details').filter({ has: options.locator('#academic-glossary') }))
      .toHaveAttribute('open', '');
    await expect(options.locator('#academic-glossary')).toBeFocused();
    await options.goto(`chrome-extension://${extensionId}/options.html?focus=support#support`);
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();

    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: false },
      });
    });
    await options.reload({ waitUntil: 'domcontentloaded' });
    await expect(options.locator('#onboarding-dialog')).toBeVisible();
    await options.locator('#onboarding-skip').click();
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();

    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: false },
      });
    });
    await options.reload({ waitUntil: 'domcontentloaded' });
    await expect(options.locator('#onboarding-dialog')).toBeVisible();
    await options.keyboard.press('Escape');
    await expect(options.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(options.locator('details.support-disclosure')).toHaveAttribute('open', '');
    await expect(options.locator('#copy-diagnostic-report')).toBeFocused();
    await options.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: true },
      });
    });
  } finally {
    if (!options.isClosed()) {
      await options.evaluate(async () => {
        const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
        const stored = await api.storage.local.get('extensionSettings');
        await api.storage.local.set({
          extensionSettings: { ...(stored.extensionSettings ?? {}), onboardingCompleted: true },
        });
      }).catch(() => undefined);
    }
    await options.close();
  }
});

test('returns to the original selection and resumes after a missing API key is configured', async () => {
  const sourceText = 'A configured API should resume this selected translation automatically.';
  await replaceStoredApiKeys({ 'vision-e2e': 'e2e-vision-key' });

  const requestsBefore = textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceText)
  )).length;
  await selectElementText('#recovery-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').focus();
  await overlay.locator('.trigger').press('Enter');
  await expect(overlay.locator('.error')).toContainText('API Key');
  await expect(overlay.getByRole('button', { name: '重试' })).toHaveCount(0);

  const optionsPromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '配置 API' }).click();
  const options = await optionsPromise;
  await options.waitForLoadState('domcontentloaded');
  await options.emulateMedia({ colorScheme: 'dark' });
  const recoveryBanner = options.locator('#settings-recovery-banner');
  await expect(recoveryBanner).toBeVisible();
  await expect(options.locator('#settings-recovery-title'))
    .toHaveText('完成文字 API 配置后继续');
  await expect(options.locator('#settings-recovery-status')).toHaveAttribute('role', 'status');
  await expect(options.locator('#settings-recovery-status')).toHaveAttribute('aria-live', 'polite');
  await expect(options.locator('#api-key')).toBeFocused();
  await expect.poll(() => recoveryBanner.evaluate((element) => (
    getComputedStyle(element).backgroundColor
  ))).not.toBe('rgb(255, 255, 255)');
  expect(options.url()).not.toContain(sourceText);

  // The opaque recovery token survives a settings-page reload in this tab,
  // while remaining absent from the visible URL.
  await options.reload({ waitUntil: 'domcontentloaded' });
  await expect(options.locator('#settings-recovery-banner')).toBeVisible();
  await expect(options.locator('#settings-recovery-title'))
    .toHaveText('完成文字 API 配置后继续');
  expect(options.url()).not.toContain('recovery=');

  await options.locator('#api-key').fill('e2e-recovery-key');
  await options.locator('#refresh-models').click();

  await expect(overlay.locator('.body')).toHaveText(
    '一致的学术翻译能够提升研究论文的可读性。',
  );
  await expect.poll(() => textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceText)
  )).length).toBe(requestsBefore + 1);
  await expect(options.locator('#settings-recovery-status'))
    .toContainText('已返回原页面并继续翻译');

  await options.close();
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
});

test('finishes first-time setup and resumes the first interrupted translation', async () => {
  const sourceText = 'First-time API setup should resume this interrupted translation.';
  const recoverySource = page.locator('#recovery-source');
  const originalSourceText = await recoverySource.textContent();
  const worker = context.serviceWorkers()[0];
  expect(worker).toBeDefined();
  const originalConfiguration = await worker!.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: {
        local: {
          get(key: string | string[]): Promise<Record<string, unknown>>;
          set(values: Record<string, unknown>): Promise<void>;
        };
        session: {
          get(key: string | string[]): Promise<Record<string, unknown>>;
          set(values: Record<string, unknown>): Promise<void>;
        };
      } };
    }).chrome;
    const [settings, localCredentials, sessionCredentials] = await Promise.all([
      api.storage.local.get('extensionSettings'),
      api.storage.local.get(['apiKeysByProfile', 'apiKey', 'deepseekApiKey']),
      api.storage.session.get(['apiKeysByProfile', 'apiKey', 'deepseekApiKey']),
    ]);
    await api.storage.local.set({
      extensionSettings: {
        ...(settings.extensionSettings as Record<string, unknown>),
        onboardingCompleted: false,
      },
    });
    return {
      settings: settings.extensionSettings,
      localCredentials,
      sessionCredentials,
    };
  });
  let options: Page | undefined;
  try {
    await replaceStoredApiKeys({ 'vision-e2e': 'e2e-vision-key' });
    await recoverySource.evaluate((element, text) => {
      element.textContent = text;
    }, sourceText);
    const requestsBefore = textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    )).length;
    await selectElementText('#recovery-source');
    const overlay = page.locator('#tex-selection-translator-root');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.error')).toContainText('API Key');
    expect(textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    ))).toHaveLength(requestsBefore);

    const optionsPromise = context.waitForEvent('page');
    await overlay.getByRole('button', { name: '配置 API' }).click();
    options = await optionsPromise;
    await options.waitForLoadState('domcontentloaded');
    const onboarding = options.locator('#onboarding-dialog');
    await expect(onboarding).toBeVisible();
    await expect(options.locator('#settings-recovery-banner')).toBeVisible();
    await expect(options.locator('#onboarding-preset')).toBeFocused();

    await options.locator('#onboarding-preset').selectOption('custom');
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-api-key')).toBeFocused();
    await options.locator('#onboarding-api-key').fill('e2e-first-translation-key');
    await options.locator('#onboarding-base-url').fill(
      'https://www.overleaf.com/pi-translator-e2e-api',
    );
    await options.locator('#onboarding-next').click();
    await expect(options.locator('#onboarding-model')).toBeFocused();
    await expect(options.locator('#onboarding-model')).toHaveValue('e2e-model');
    await options.locator('#onboarding-next').click();

    await expect(onboarding).not.toBeVisible();
    await expect(options.locator('#settings-recovery-status'))
      .toContainText('已返回原页面并继续翻译');
    await expect(overlay.locator('.body')).toHaveText(
      '一致的学术翻译能够提升研究论文的可读性。',
    );
    await expect.poll(() => textRequests.filter((request) => (
      JSON.stringify(request).includes(sourceText)
    )).length).toBe(requestsBefore + 1);
  } finally {
    await options?.close().catch(() => undefined);
    await worker!.evaluate(async (snapshot) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: {
          local: {
            set(values: Record<string, unknown>): Promise<void>;
            remove(keys: string[]): Promise<void>;
          };
          session: {
            set(values: Record<string, unknown>): Promise<void>;
            remove(keys: string[]): Promise<void>;
          };
        } };
      }).chrome;
      const credentialKeys = ['apiKeysByProfile', 'apiKey', 'deepseekApiKey'];
      const definedEntries = (values: Record<string, unknown>) => Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      );
      await Promise.all([
        api.storage.local.set({ extensionSettings: snapshot.settings }),
        api.storage.local.remove(credentialKeys),
        api.storage.session.remove(credentialKeys),
      ]);
      await Promise.all([
        api.storage.local.set(definedEntries(snapshot.localCredentials)),
        api.storage.session.set(definedEntries(snapshot.sessionCredentials)),
      ]);
    }, originalConfiguration);
    await page.keyboard.press('Escape').catch(() => undefined);
    await clearBrowserSelection();
    await recoverySource.evaluate((element, text) => {
      element.textContent = text;
    }, originalSourceText);
  }
});

test('requires confirmation after partial output and does not automatically repeat the request', async () => {
  const sourceMarker = 'A recovery request may already contain a partial translation.';
  const sourceText = `${sourceMarker} `.repeat(130).trim();
  const matchingRequestCount = () => textRequests.filter((request) => (
    JSON.stringify(request).includes(sourceMarker)
  )).length;
  const requestsBefore = matchingRequestCount();
  failNextRecoveryRequestAfterPartial = true;
  partialRecoveryFailureGate = new Promise<void>((resolve) => {
    releasePartialRecoveryFailure = resolve;
  });

  await page.locator('#partial-recovery-source').evaluate((element, text) => {
    element.textContent = text;
  }, sourceText);
  await selectElementText('#partial-recovery-source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').focus();
  await overlay.locator('.trigger').press('Enter');
  await expect.poll(matchingRequestCount).toBe(requestsBefore + 2);
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  releasePartialRecoveryFailure?.();
  await expect(overlay.locator('.error')).toContainText('API');
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  await expect(overlay.getByRole('button', { name: '复制部分译文' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '检查 API 配置' })).toBeFocused();

  const optionsPromise = context.waitForEvent('page');
  await overlay.getByRole('button', { name: '检查 API 配置' }).click();
  const options = await optionsPromise;
  await options.waitForLoadState('domcontentloaded');
  await expect(options.locator('#settings-recovery-banner')).toBeVisible();
  await expect(options.locator('#settings-recovery-description'))
    .toContainText('已经产生部分译文');

  await options.locator('#refresh-models').click();

  await expect(overlay.locator('.notice')).toContainText('已保留收到的部分译文');
  await expect(overlay.locator('.stream-preview')).toContainText('已收到的部分译文');
  await expect(overlay.getByRole('button', {
    name: '重新翻译（会再次请求 API）',
  })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '保留部分结果' })).toBeVisible();
  await page.waitForTimeout(250);
  expect(matchingRequestCount()).toBe(requestsBefore + 2);

  await overlay.getByRole('button', {
    name: '重新翻译（会再次请求 API）',
  }).click();
  await expect.poll(matchingRequestCount).toBe(requestsBefore + 3);
  await expect(overlay.locator('.body')).toContainText(
    '一致的学术翻译能够提升研究论文的可读性。',
  );

  await options.close();
  await page.keyboard.press('Escape');
  await clearBrowserSelection();
  await page.locator('#partial-recovery-source').evaluate((element) => {
    element.textContent = 'A recovery request may already contain a partial translation.';
  });
});

test('pre-enables the browser side panel on supported webpages', async () => {
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
  }, page.url())).toBe(true);
});

test('pre-enables the side panel before a native PDF context-menu gesture', async () => {
  // Deliberately use an origin outside manifest host_permissions. Before a
  // user gesture Edge hides this tab's URL from the extension, which is the
  // exact state used by the native PDF reader in real browsing sessions.
  const sourceUrl = 'https://pdf-without-host-access.example/pi-translator.pdf';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Native PDF side panel readiness test.'),
    });
  });
  const nativePdfPage = await context.newPage();
  try {
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    await expect.poll(() => worker!.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: object): Promise<Array<{ id?: number; url?: string }>> };
          sidePanel: {
            getOptions(options: { tabId: number }): Promise<{ enabled?: boolean; path?: string }>;
          };
        };
      }).chrome;
      const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined) return undefined;
      return api.sidePanel.getOptions({ tabId: tab.id });
    })).toMatchObject({ enabled: true, path: 'sidepanel.html' });
  } finally {
    await nativePdfPage.close();
    await context.unroute(sourceUrl);
  }
});

test('makes the PDF side-panel empty state contextual and directly actionable', async () => {
  const sidePanel = await context.newPage();
  const neutralPage = await context.newPage();
  const sourceUrl = 'https://www.overleaf.com/pi-sidepanel-empty-context.pdf';
  let nativePdfPage: Page | undefined;
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf('Context-aware empty state.'),
    });
  });
  try {
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await neutralPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await neutralPage.bringToFront();
    const emptyState = sidePanel.locator('#empty-state');
    const emptyAction = sidePanel.locator('#empty-action');
    const webRegionAction = sidePanel.locator('#start-web-region');
    await expect(emptyState).toHaveAttribute('data-context', 'other');
    await expect(webRegionAction).toBeHidden();
    await expect(sidePanel.locator('#empty-title')).toHaveText('当前没有可翻译的 PDF');
    await expect(emptyAction).toHaveText('打开 Pi PDF 阅读器');
    await expect(emptyAction).toBeVisible();
    expect(await emptyAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);

    const readerPromise = context.waitForEvent('page');
    await emptyAction.click();
    const reader = await readerPromise;
    await reader.waitForURL((url) => url.pathname === '/pdf.html');
    await expect(reader.locator('#empty-state')).toBeVisible();
    await reader.close();

    await page.bringToFront();
    await expect(emptyState).toHaveAttribute('data-context', 'web');
    await expect(sidePanel.locator('#empty-title')).toHaveText('浏览器侧栏已就绪');
    await expect(sidePanel.locator('#empty-description')).toContainText('从顶部框选当前网页');
    await expect(emptyAction).toHaveText('改用网页浮动侧栏');
    await expect(webRegionAction).toBeVisible();
    await expect(webRegionAction).toHaveText('框选网页');
    expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);
    await webRegionAction.click();
    await expect(page.locator('#pi-web-region-selection-root')).toBeVisible();
    await page.bringToFront();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pi-web-region-selection-root')).toHaveCount(0);
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    await worker!.evaluate(async (targetUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            query(query: object): Promise<Array<{ id?: number; url?: string }>>;
            sendMessage(tabId: number, message: object): Promise<unknown>;
          };
        };
      }).chrome;
      const target = (await api.tabs.query({})).find((tab) => tab.url === targetUrl);
      if (target?.id !== undefined) {
        await api.tabs.sendMessage(target.id, { type: 'BROWSER_SIDEBAR_CLOSED' });
      }
    }, page.url());

    nativePdfPage = await context.newPage();
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    await expect(emptyState).toHaveAttribute('data-context', 'pdf');
    await expect(sidePanel.locator('#empty-title')).toHaveText('当前 PDF 已就绪');
    await expect(sidePanel.locator('#empty-description')).toContainText('选择文字后右键翻译');
    await expect(emptyAction).toHaveText('用 Pi 打开当前 PDF');
    await expect(webRegionAction).toBeHidden();
    await emptyAction.focus();
    await expect(emptyAction).toBeFocused();
  } finally {
    await nativePdfPage?.close();
    await neutralPage.close();
    await sidePanel.close();
    await context.unroute(sourceUrl);
    await page.bringToFront();
  }
});

test('shows and hides the selection trigger with the browser selection', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');

  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('adapts the translation surface to dark and light webpages', async () => {
  const overlay = page.locator('#tex-selection-translator-root');
  await page.evaluate(() => {
    document.body.style.background = 'rgb(15, 23, 42)';
    document.body.style.color = 'rgb(241, 245, 249)';
  });
  await selectSourceText();
  await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.card')).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();

  await page.evaluate(() => {
    document.body.style.background = 'rgb(255, 255, 255)';
    document.body.style.color = 'rgb(17, 24, 39)';
  });
  await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
});

test('keeps first-result progress and copy feedback clear on a narrow card', async ({}, testInfo) => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-api/**';
  const sourceText = 'A narrow first-result card should keep progress and copy actions stable.';
  const source = page.locator('#source');
  const originalSourceText = await source.textContent();
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const originalPageStyle = await page.evaluate(() => ({
    background: document.body.style.background,
    color: document.body.style.color,
  }));
  let releaseResult: (() => void) | undefined;
  const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
  const delayedHandler = async (route: Route): Promise<void> => {
    if (
      route.request().method() !== 'POST'
      || !route.request().postData()?.includes(sourceText)
    ) {
      await route.fallback();
      return;
    }
    await resultGate;
    await route.fallback();
  };
  await context.route(apiPattern, delayedHandler);
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await source.evaluate((element, text) => { element.textContent = text; }, sourceText);
    await selectElementText('#source');
    await overlay.locator('.trigger').focus();
    await overlay.locator('.trigger').press('Enter');

    const surface = overlay.locator('.surface');
    const loading = overlay.locator('.loading');
    await expect(surface).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('aria-live', 'polite');
    await expect(loading).toHaveAttribute('aria-atomic', 'true');
    await expect(overlay.locator('.stop-translation')).toBeVisible();
    await expect(overlay.locator('.stop-translation')).toBeFocused();
    const loadingLayout = await surface.evaluate((card) => {
      const loadingRow = card.querySelector<HTMLElement>('.loading')!;
      const stop = card.querySelector<HTMLElement>('.stop-translation')!;
      const cardRect = card.getBoundingClientRect();
      const stopRect = stop.getBoundingClientRect();
      return {
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
        loadingClientWidth: loadingRow.clientWidth,
        loadingScrollWidth: loadingRow.scrollWidth,
        stopRight: stopRect.right,
        cardRight: cardRect.right,
        stopHeight: stopRect.height,
      };
    });
    expect(loadingLayout.cardScrollWidth).toBeLessThanOrEqual(loadingLayout.cardClientWidth + 1);
    expect(loadingLayout.loadingScrollWidth)
      .toBeLessThanOrEqual(loadingLayout.loadingClientWidth + 1);
    expect(loadingLayout.stopRight).toBeLessThanOrEqual(loadingLayout.cardRight + 1);
    expect(loadingLayout.stopHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('first-result-loading-320-light.png') });
    }

    releaseResult?.();
    await expect(overlay.locator('.body'))
      .toHaveText('一致的学术翻译能够提升研究论文的可读性。');
    await expect(surface).not.toHaveAttribute('aria-busy', 'true');
    await expect(surface).toHaveAttribute('data-state', 'complete');
    await expect(overlay.locator('.result-feedback')).toHaveText('翻译完成，译文已显示');
    await expect(overlay.locator('.result-feedback')).toHaveAttribute('role', 'status');
    await expect(overlay.locator('.result-reading-nav')).toBeHidden();

    const copy = overlay.locator('.copy-action');
    await expect(copy).toHaveText('复制译文');
    await expect(copy).toBeFocused();
    const resultLayout = await surface.evaluate((card) => {
      const footer = card.querySelector<HTMLElement>('.footer')!;
      const copyAction = card.querySelector<HTMLElement>('.copy-action')!;
      return {
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
        footerClientWidth: footer.clientWidth,
        footerScrollWidth: footer.scrollWidth,
        footerHeight: footer.getBoundingClientRect().height,
        copyWidth: copyAction.getBoundingClientRect().width,
        actionHeights: [...footer.querySelectorAll<HTMLElement>('button')]
          .filter((button) => button.offsetParent !== null)
          .map((button) => button.getBoundingClientRect().height),
        copyBackground: getComputedStyle(copyAction).backgroundColor,
      };
    });
    expect(resultLayout.cardScrollWidth).toBeLessThanOrEqual(resultLayout.cardClientWidth + 1);
    expect(resultLayout.footerScrollWidth).toBeLessThanOrEqual(resultLayout.footerClientWidth + 1);
    expect(resultLayout.actionHeights.every((height) => height >= 32)).toBe(true);
    expect(resultLayout.copyBackground).not.toBe('rgba(0, 0, 0, 0)');
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('first-result-complete-320-light.png') });
      await page.evaluate(() => {
        document.body.style.background = 'rgb(15, 23, 42)';
        document.body.style.color = 'rgb(241, 245, 249)';
      });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('first-result-complete-320-dark.png') });
    }

    await copy.click();
    await expect(copy).toHaveText('已复制');
    await expect(copy).toHaveAttribute('data-state', 'success');
    await expect(copy).toBeEnabled();
    await expect(copy).toBeFocused();
    await expect(overlay.locator('.copy-feedback')).toHaveText('译文已复制到剪贴板');
    await expect(overlay.locator('.copy-feedback')).toHaveAttribute('aria-live', 'polite');
    const copiedLayout = await surface.evaluate((card) => {
      const footer = card.querySelector<HTMLElement>('.footer')!;
      const copyAction = card.querySelector<HTMLElement>('.copy-action')!;
      return {
        footerHeight: footer.getBoundingClientRect().height,
        copyWidth: copyAction.getBoundingClientRect().width,
      };
    });
    expect(copiedLayout).toEqual({
      footerHeight: resultLayout.footerHeight,
      copyWidth: resultLayout.copyWidth,
    });
  } finally {
    releaseResult?.();
    await context.unroute(apiPattern, delayedHandler);
    await page.evaluate((style) => {
      document.body.style.background = style.background;
      document.body.style.color = style.color;
    }, originalPageStyle);
    await page.keyboard.press('Escape').catch(() => undefined);
    await clearBrowserSelection();
    await source.evaluate((element, text) => { element.textContent = text; }, originalSourceText);
    await page.setViewportSize(originalViewport);
  }
});

test('recovers embedded TeX from rendered web mathematics before translation', async () => {
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;
  await page.evaluate(() => {
    const source = document.querySelector('#math-source');
    if (!source) throw new Error('Missing rendered-math fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.slice(initialTextRequests).some((entry) =>
    JSON.stringify(entry).includes('⟦FULL1_'),
  )).toBe(true);
  const request = textRequests
    .slice(initialTextRequests)
    .map((entry) => JSON.stringify(entry))
    .find((entry) => entry.includes('⟦FULL1_')) ?? '';
  expect(request).toContain('⟦FULL1_');
  expect(request).not.toContain('ℒ = Σ');
  expect(visionRequests).toHaveLength(initialVisionRequests);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
});

test('falls back to selectable text when webpage screenshot permission is unavailable', async () => {
  const initialTextRequests = textRequests.length;
  const initialVisionRequests = visionRequests.length;
  await page.evaluate(() => {
    const source = document.querySelector('#rendered-only-math');
    if (!source) throw new Error('Missing rendered-only math fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect.poll(() => textRequests.length).toBeGreaterThan(initialTextRequests);
  expect(visionRequests).toHaveLength(initialVisionRequests);
  await expect(overlay.locator('.body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
});

test('opens, drags, and dismisses a translation card', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  // The loading surface is intentionally replaced by the result surface. Wait
  // for that transition before measuring the draggable elements, otherwise a
  // locator can be detached between toBeVisible() and boundingBox().
  await expect(overlay.locator('.body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');

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

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
});

test('records content-free translation and render stage timings in session storage', async () => {
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { session: { remove(key: string): Promise<void> } } };
    }).chrome;
    await api.storage.session.remove('localPerformanceSamplesV1');
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
  const privateFixture = `Private performance fixture ${Date.now()}.`;
  await page.locator('#source').evaluate((element, value) => {
    element.textContent = value;
  }, privateFixture);
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).not.toBeEmpty();

  const readSamples = () => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: {
            get(key: string): Promise<Record<string, unknown>>;
          };
        };
      };
    }).chrome;
    const stored = await api.storage.session.get('localPerformanceSamplesV1');
    return stored.localPerformanceSamplesV1 as Array<{
      schemaVersion: number;
      operation: string;
      timings: Record<string, number>;
      errorCode?: string;
    }> | undefined;
  });
  await expect.poll(async () => {
    const samples = await readSamples();
    return [...new Set((samples ?? []).map((sample) => sample.operation))].sort();
  }).toEqual(['render-result', 'translate-text']);

  const samples = await readSamples();
  const translation = samples?.find((sample) => sample.operation === 'translate-text');
  const rendering = samples?.find((sample) => sample.operation === 'render-result');
  expect(translation?.timings).toEqual(expect.objectContaining({
    totalMs: expect.any(Number),
    preflightMs: expect.any(Number),
    providerMs: expect.any(Number),
    commitMs: expect.any(Number),
    maintenanceMs: expect.any(Number),
  }));
  expect(rendering?.timings).toEqual(expect.objectContaining({
    totalMs: expect.any(Number),
    textRenderMs: expect.any(Number),
    mathRenderMs: 0,
  }));
  const serialized = JSON.stringify(samples);
  expect(serialized).not.toContain(privateFixture);
  expect(serialized).not.toContain('e2e-key');
  expect(serialized).not.toContain('e2e-model');
  expect(serialized).not.toContain(OVERLEAF_FIXTURE_URL);

  await overlay.locator('.surface-close').click();
  await clearBrowserSelection();
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test('lightly marks translated source text and previews the translation on hover', async () => {
  const source = page.locator('#source');
  const originalMarkup = await source.evaluate((element) => element.innerHTML);
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  const mark = overlay.locator('.mark-action');
  await expect(mark).toHaveAttribute('aria-pressed', 'false');
  await mark.focus();
  await mark.press('Enter');
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay.locator('.mark-action')).toBeFocused();

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  expect(await source.evaluate((element) => element.innerHTML)).toBe(originalMarkup);

  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  const markerBox = await waitForVisibleBoundingBox(marker, 'the webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  const tooltip = markerLayer.locator('.tooltip');
  await expect(tooltip).toContainText('一致的学术翻译');
  const tooltipBefore = await tooltip.boundingBox();
  await page.mouse.move(markerBox.x + Math.max(2, markerBox.width - 4), markerBox.y + markerBox.height / 2);
  const tooltipAfter = await tooltip.boundingBox();
  expect(tooltipBefore).not.toBeNull();
  expect(tooltipAfter).not.toBeNull();
  if (tooltipBefore && tooltipAfter) {
    expect(tooltipAfter.x).toBeCloseTo(tooltipBefore.x, 0);
    expect(tooltipAfter.y).toBeCloseTo(tooltipBefore.y, 0);
  }
  await markerLayer.getByRole('button', { name: '取消标记' }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);

  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();
  const restoredMarker = markerLayer.locator('.marker').first();
  await expect(restoredMarker).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  const restoredMarkerBox = await waitForVisibleBoundingBox(
    restoredMarker,
    'the restored webpage source marker',
  );

  await page.mouse.click(
    restoredMarkerBox.x + restoredMarkerBox.width / 2,
    restoredMarkerBox.y + restoredMarkerBox.height / 2,
  );
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await overlay.locator('.pin-action').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await page.mouse.move(
    restoredMarkerBox.x + restoredMarkerBox.width / 2,
    restoredMarkerBox.y + restoredMarkerBox.height / 2,
  );
  await markerLayer.locator('.tooltip .unmark').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'false');
  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(1);
  await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed', 'true');
  const filter = overlay.locator('.mark-filter');
  await expect(filter).toBeVisible();
  await filter.click();
  await expect(overlay.locator('.mark-filter')).toHaveAttribute('aria-pressed', 'true');

  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await expect(overlay.locator('.mark-filter')).toHaveCount(0);
  expect(await source.evaluate((element) => element.innerHTML)).toBe(originalMarkup);
  await overlay.getByRole('button', { name: '关闭' }).click();
});

test('keeps translation correction compact, versioned, and synchronized with source marks', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) {
    await overlay.getByTitle('关闭').click();
  }
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();

  const copyAction = overlay.locator('.copy-action');
  await copyAction.click();
  await expect(copyAction).toHaveText('已复制');

  const more = overlay.locator('details.more');
  const moreSummary = more.locator('summary');
  const compactControlHeights = await Promise.all([
    copyAction,
    overlay.locator('.mark-action'),
    moreSummary,
    overlay.locator('.view-button').first(),
  ].map((control) => control.evaluate((element) => element.getBoundingClientRect().height)));
  expect(compactControlHeights).toEqual([32, 32, 32, 32]);
  await moreSummary.click();
  await expect(more).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(more).not.toHaveAttribute('open', '');
  await expect(moreSummary).toBeFocused();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');

  const correctionAction = overlay.getByRole('button', { name: '修正译文' });
  await correctionAction.click();
  let editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await expect(editor).toBeVisible();
  await editor.press('Escape');
  await expect(editor).toBeHidden();
  await expect(correctionAction).toBeFocused();

  await correctionAction.click();
  editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('用户手动修订后的学术译文。');
  const revisionScope = overlay.getByRole('combobox', { name: '修正译文的保存范围' });
  await expect(revisionScope).toHaveValue('current');
  await revisionScope.selectOption('document');
  const requestsBeforeManualSave = textRequests.length;
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('用户手动修订后的学术译文。');
  expect(textRequests).toHaveLength(requestsBeforeManualSave);
  await expect(overlay.locator('.version-counter')).toHaveText('v1/2');
  const versionContext = overlay.locator('.version-context');
  await expect(versionContext).toContainText('手动修改');
  await expect(versionContext).toContainText('本文记忆');
  await expect(versionContext).toContainText('较上一版调整全文');
  await expect(versionContext).toHaveAttribute(
    'aria-label',
    '手动修改，本文记忆，较上一版调整全文',
  );
  await expect(overlay.locator('.version-locate')).toHaveCount(0);
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' }))
    .toBeFocused();

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the corrected webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('用户手动修订后的学术译文。');

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '让模型调整…' }).click();
  await overlay.getByRole('button', { name: '更忠实原文' }).click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await expect(overlay.locator('.version-counter')).toHaveText('v1/3');
  await expect(versionContext).toContainText('更忠实');
  await expect(versionContext).toContainText('仅当前选择');
  await expect(versionContext).toContainText('较上一版调整全文');
  expect(JSON.stringify(textRequests.at(-1))).toContain('translationRevisionPreference');
  expect(JSON.stringify(textRequests.at(-1))).toContain('用户手动修订后的学术译文。');
  const worker = context.serviceWorkers()[0]!;
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    const memories = Object.values(
      (stored.documentTranslationMemoryV1 ?? {}) as Record<string, {
        recentTranslations?: Array<{ originalText?: string; translatedText?: string }>;
      }>,
    );
    return memories.flatMap((memory) => memory.recentTranslations ?? []).find(
      (entry) => entry.originalText ===
        'A consistent academic translation improves the readability of research papers.',
    )?.translatedText;
  })).toBe('用户手动修订后的学术译文。');

  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.locator('.body')).toHaveText('用户手动修订后的学术译文。');
  await expect(overlay.locator('.version-counter')).toHaveText('v2/3');
  await expect(versionContext).toContainText('手动修改');
  await expect(versionContext).toContainText('本文记忆');
  await overlay.getByTitle('查看下一版译文').click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await correctionAction.click();
  editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('临时焦点验证译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  const undoCorrection = overlay.getByRole('button', { name: '撤销上次译文修正' });
  await expect(undoCorrection).toBeFocused();
  await undoCorrection.click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await expect(versionContext).toContainText('撤销修改');
  await expect(correctionAction).toBeFocused();
  await overlay.locator('.mark-action').click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('keeps correction terms explicit and rolls a global term back with the translation', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  const correction = overlay.getByRole('button', { name: '修正译文' });
  const correctionBox = await correction.boundingBox();
  expect(correctionBox).not.toBeNull();
  if (correctionBox) {
    expect(correctionBox.width).toBeLessThanOrEqual(52);
    expect(correctionBox.height).toBeLessThanOrEqual(32);
  }
  await correction.click();

  const scope = overlay.getByRole('combobox', { name: '修正译文的保存范围' });
  await expect(scope).toHaveValue('current');
  await expect(scope.locator('option')).toHaveText([
    '仅本次',
    '记住本文',
  ]);
  await expect(overlay.getByRole('textbox', { name: '原文术语' })).toBeHidden();
  await expect(overlay.getByRole('textbox', { name: '固定译法' })).toBeHidden();

  const termDisclosure = overlay.locator('details.correction-term-disclosure');
  const termSummary = termDisclosure.locator(':scope > summary');
  await termSummary.click();
  const sourceTerm = overlay.getByRole('textbox', { name: '原文术语' });
  const targetTerm = overlay.getByRole('textbox', { name: '固定译法' });
  await expect(sourceTerm).toBeVisible();
  await expect(targetTerm).toBeVisible();
  await overlay.getByRole('combobox', { name: '术语保存范围' }).selectOption('global');
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' })
    .fill('显式术语修正后的译文。');

  const requestsBeforeSave = textRequests.length;
  await sourceTerm.fill('incomplete term');
  await expect(termSummary).toHaveText('！固定术语待补充');
  await termSummary.click();
  await expect(termDisclosure).not.toHaveAttribute('open');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.revision-status'))
    .toContainText('请完整填写不含公式的简短术语和固定译法');
  await expect(termSummary).toHaveText('！固定术语需检查');
  await expect(termDisclosure).toHaveAttribute('open', '');
  await expect(targetTerm).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeSave);

  const uniqueSource = 'correction-only global phrase';
  const uniqueTarget = '仅供修正测试的全局译法';
  await sourceTerm.fill(uniqueSource);
  await targetTerm.fill(uniqueTarget);
  await expect(termSummary).toHaveText('✓ 已填写固定术语');
  await termSummary.click();
  await expect(termDisclosure).not.toHaveAttribute('open');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('显式术语修正后的译文。');
  expect(textRequests).toHaveLength(requestsBeforeSave);

  const worker = context.serviceWorkers()[0]!;
  const storedGlobalTarget = async (): Promise<string | undefined> => worker.evaluate(
    async (source) => {
      const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      const settings = stored.extensionSettings as {
        academicGlossary?: Array<{ source: string; target: string }>;
      } | undefined;
      return settings?.academicGlossary?.find((term) => term.source === source)?.target;
    },
    uniqueSource,
  );
  await expect.poll(storedGlobalTarget).toBe(uniqueTarget);

  const undo = overlay.getByRole('button', { name: '撤销上次译文修正' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toHaveCount(0);
  await expect.poll(storedGlobalTarget).toBeUndefined();
  expect(textRequests).toHaveLength(requestsBeforeSave);

  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('keeps narrow translation correction fields and actions visible', async ({}, testInfo) => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.getByRole('button', { name: '修正译文' }).click();

    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await expect(editor).toBeFocused();
    await expect(overlay.locator('.pin-action')).toHaveCount(0);
    await overlay.locator('.correction-save').click();
    await expect(overlay.locator('.revision-status')).toContainText('译文没有变化');
    await expect(overlay.locator('.revision-status')).toHaveAttribute('role', 'alert');
    await expect(editor).toHaveAttribute(
      'aria-describedby',
      /pi-translation-correction-note.*pi-translation-correction-status/,
    );
    await expect(editor).toBeFocused();
    await editor.fill('窄屏下需要保持清晰、完整并且可以直接保存的学术译文。');
    await expect(overlay.locator('.revision-status')).toBeEmpty();
    await expect(overlay.locator('.revision-status')).toHaveAttribute('role', 'status');
    await overlay.getByText('＋ 固定术语（可选）').click();
    const sourceTerm = overlay.getByRole('textbox', { name: '原文术语' });
    const targetTerm = overlay.getByRole('textbox', { name: '固定译法' });
    await sourceTerm.fill('AdaptiveSensingReconstructionObjectiveWithHierarchicalConstraints');
    await overlay.locator('.correction-save').click();
    const validation = overlay.locator('.revision-status');
    await expect(validation).toContainText('请完整填写不含公式的简短术语和固定译法');
    await expect(validation).toHaveAttribute('role', 'alert');
    await expect(targetTerm).toHaveAttribute('aria-invalid', 'true');
    await expect(targetTerm).toHaveAttribute(
      'aria-describedby',
      'pi-translation-correction-status',
    );
    await expect(targetTerm).toBeFocused();
    await targetTerm.fill('具有层级约束的自适应感知重建目标固定译法');
    await expect(targetTerm).not.toHaveAttribute('aria-invalid');
    await expect(validation).toBeEmpty();

    const correctionLayout = await overlay.locator('.surface').evaluate((surface) => {
      const inputs = [...surface.querySelectorAll<HTMLElement>('.correction-term-fields input')];
      const actions = surface.querySelector<HTMLElement>('.revision-actions');
      const buttons = [...actions?.querySelectorAll<HTMLElement>('button') ?? []];
      const bounds = surface.getBoundingClientRect();
      const actionBounds = actions?.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        inputTops: inputs.map((input) => input.getBoundingClientRect().top),
        actionBottom: actionBounds?.bottom ?? Infinity,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-correction-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('translation-correction-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(correctionLayout.bounds.left).toBeGreaterThanOrEqual(8);
    expect(correctionLayout.bounds.right).toBeLessThanOrEqual(352);
    expect(correctionLayout.scrollWidth).toBeLessThanOrEqual(correctionLayout.clientWidth + 1);
    expect(correctionLayout.inputTops[1]).toBeGreaterThan(correctionLayout.inputTops[0] ?? 0);
    expect(correctionLayout.actionBottom).toBeLessThanOrEqual(correctionLayout.bounds.bottom);
    expect(correctionLayout.buttonHeights.every((height) => height >= 32)).toBe(true);
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('keeps narrow model adjustment drafts visible and recoverable', async ({}, testInfo) => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

    const moreSummary = overlay.locator('details.more > summary');
    await moreSummary.click();
    const menu = overlay.locator('.menu');
    await expect(menu).toBeVisible();
    const menuLayout = await menu.evaluate((element) => {
      const surface = element.closest<HTMLElement>('.surface');
      const bounds = element.getBoundingClientRect();
      const surfaceBounds = surface?.getBoundingClientRect();
      const buttons = [...element.querySelectorAll<HTMLElement>('button')];
      return {
        bounds: bounds.toJSON(),
        surfaceBounds: surfaceBounds?.toJSON(),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-more-menu-360-light.png') });
    }
    expect(menuLayout.surfaceBounds).toBeDefined();
    if (menuLayout.surfaceBounds) {
      expect(menuLayout.bounds.left).toBeGreaterThanOrEqual(menuLayout.surfaceBounds.left);
      expect(menuLayout.bounds.right).toBeLessThanOrEqual(menuLayout.surfaceBounds.right);
    }
    expect(menuLayout.bounds.top).toBeGreaterThanOrEqual(8);
    expect(menuLayout.bounds.bottom).toBeLessThanOrEqual(692);
    expect(menuLayout.scrollHeight).toBeLessThanOrEqual(menuLayout.clientHeight + 2);
    expect(menuLayout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await overlay.getByRole('button', { name: '让模型调整…' }).click();
    await expect(overlay.getByText('模型调整会发送原文和当前译稿')).toBeVisible();
    await overlay.getByRole('button', { name: '自定义调整要求…' }).click();
    const customInput = overlay.getByRole('textbox', { name: '自定义调整要求' });
    await expect(customInput).toBeFocused();
    const customDraft = '保留限定条件和公式编号，并统一关键术语；语言保持正式、简洁，避免增加原文没有的结论。'.repeat(3);
    await customInput.fill(customDraft);
    await expect(overlay.locator('.revision-custom span')).toHaveText(`${customDraft.length}/500`);
    const adjustmentLayout = await overlay.locator('.surface').evaluate((surface) => {
      const custom = surface.querySelector<HTMLElement>('.revision-custom');
      const actions = surface.querySelector<HTMLElement>('.revision-actions');
      const controls = [...surface.querySelectorAll<HTMLElement>(
        '.revision-scope select,.revision-choice,.revision-custom button,.revision-actions button',
      )];
      const bounds = surface.getBoundingClientRect();
      return {
        bounds: bounds.toJSON(),
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        customBottom: custom?.getBoundingClientRect().bottom ?? Infinity,
        actionsBottom: actions?.getBoundingClientRect().bottom ?? Infinity,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('translation-model-adjustment-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('translation-model-adjustment-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }
    expect(adjustmentLayout.bounds.left).toBeGreaterThanOrEqual(8);
    expect(adjustmentLayout.bounds.right).toBeLessThanOrEqual(352);
    expect(adjustmentLayout.scrollWidth).toBeLessThanOrEqual(adjustmentLayout.clientWidth + 1);
    expect(adjustmentLayout.customBottom).toBeLessThanOrEqual(adjustmentLayout.bounds.bottom);
    expect(adjustmentLayout.actionsBottom).toBeLessThanOrEqual(adjustmentLayout.bounds.bottom);
    expect(adjustmentLayout.controlHeights.every((height) => height >= 32)).toBe(true);
    await expect(overlay.locator('.pin-action')).toHaveCount(0);

    await customInput.press('Escape');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await expect(moreSummary).toBeFocused();
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('keeps a newer translation and recovers a rejected correction save', async () => {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 360, height: 700 });
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.getByRole('button', { name: '修正译文' }).click();
  const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('不应覆盖较新结果的旧修正。');

  const worker = context.serviceWorkers()[0]!;
  const storedHead = await worker.evaluate(async (pageUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: { query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
        storage: {
          session: {
            get(key: string): Promise<Record<string, unknown>>;
            set(values: Record<string, unknown>): Promise<void>;
          };
        };
      };
    }).chrome;
    const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
    if (tab?.id === undefined) throw new Error('Could not find the translated page tab.');
    const key = `translationResultHead:${tab.id}`;
    const original = (await api.storage.session.get(key))[key] as {
      tabId: number;
      currentResultRequestId: string;
      rootRequestId: string;
      updatedAt: number;
    } | undefined;
    if (!original) throw new Error('The translated page has no result head.');
    await api.storage.session.set({
      [key]: {
        ...original,
        currentResultRequestId: 'newer-result-for-stale-correction-e2e',
        updatedAt: Date.now(),
      },
    });
    return { key, original };
  }, page.url());

  let headRestored = false;
  try {
    const save = overlay.locator('.correction-save');
    await save.click();
    const failure = overlay.locator('.revision-status');
    await expect(failure)
      .toContainText('当前译文已经变化，请重新打开修正');
    await expect(failure).toHaveAttribute('role', 'alert');
    await expect(failure).toHaveClass(/is-error/);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue('不应覆盖较新结果的旧修正。');
    await expect(editor).toBeEnabled();
    await expect(save).toHaveText('重试');
    await expect(save).toBeFocused();
    const failureLayout = await overlay.locator('.surface').evaluate((surface) => {
      const status = surface.querySelector<HTMLElement>('.revision-status')!;
      const surfaceBounds = surface.getBoundingClientRect();
      return {
        surfaceBottom: surfaceBounds.bottom,
        statusBottom: status.getBoundingClientRect().bottom,
        buttonHeights: [...surface.querySelectorAll<HTMLElement>('.revision-actions button')]
          .map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(failureLayout.statusBottom).toBeLessThanOrEqual(failureLayout.surfaceBottom);
    expect(failureLayout.buttonHeights.every((height) => height >= 32)).toBe(true);

    await worker.evaluate(async ({ key, original }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ [key]: original });
    }, storedHead);
    headRestored = true;
    await save.click();
    await expect(overlay.locator('.body')).toContainText('不应覆盖较新结果的旧修正');
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  } finally {
    if (!headRestored) {
      await worker.evaluate(async ({ key, original }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: {
            set(values: Record<string, unknown>): Promise<void>;
          } } };
        }).chrome;
        await api.storage.session.set({ [key]: original });
      }, storedHead);
    }
    if (await overlay.getByRole('button', { name: '取消', exact: true }).count()) {
      await overlay.getByRole('button', { name: '取消', exact: true }).click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
    await page.setViewportSize(originalViewport);
  }
});

test('serializes concurrent correction commits and rejects an old undo receipt', async () => {
  const sender = await context.newPage();
  await sender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await sender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  if (tabId === undefined) {
    await sender.close();
    return;
  }

  const headKey = `translationResultHead:${tabId}`;
  const baseResult = {
    requestId: 'concurrent-correction-base',
    originalText: 'Concurrent correction source text.',
    translatedText: 'Base translation.',
    warnings: [],
    completedAt: Date.now(),
    cached: false,
    latencyMs: 10,
  };

  try {
    await sender.evaluate(async ({ key, tab, result }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({
        [key]: {
          tabId: tab,
          currentResultRequestId: result.requestId,
          rootRequestId: result.requestId,
          updatedAt: Date.now(),
        },
      });
    }, { key: headKey, tab: tabId, result: baseResult });

    const concurrent = await sender.evaluate(async ({ result }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      const correction = (requestId: string, translatedText: string) => ({
        type: 'UPDATE_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: {
            ...result,
            requestId,
            translatedText,
            revision: {
              rootRequestId: result.requestId,
              kind: 'manual',
              label: 'Manual correction',
              scope: 'current',
            },
          },
          scope: 'current',
          previousTranslatedText: result.translatedText,
          baseRequestId: result.requestId,
        },
      });
      return Promise.all([
        api.runtime.sendMessage(correction('concurrent-correction-a', 'Correction A.')),
        api.runtime.sendMessage(correction('concurrent-correction-b', 'Correction B.')),
      ]);
    }, { result: baseResult }) as Array<{
      ok: boolean;
      data?: {
        result: typeof baseResult;
        correctionReceipt?: {
          baseRequestId: string;
          correctedRequestId: string;
          scope: 'current' | 'document';
          previousTranslation: string;
          correctedTranslation: string;
        };
      };
      error?: { code: string };
    }>;

    const succeeded = concurrent.filter((response) => response.ok);
    const rejected = concurrent.filter((response) => !response.ok);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error?.code).toBe('REQUEST_ABORTED');
    const firstCommit = succeeded[0]?.data;
    expect(firstCommit?.correctionReceipt).toBeDefined();
    if (!firstCommit?.correctionReceipt) throw new Error('Missing correction receipt.');

    const newest = await sender.evaluate(async ({ previous }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'UPDATE_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: {
            ...previous.result,
            requestId: 'newer-correction-after-race',
            translatedText: 'Newest correction.',
          },
          scope: 'current',
          previousTranslatedText: previous.result.translatedText,
          baseRequestId: previous.result.requestId,
        },
      });
    }, { previous: firstCommit }) as {
      ok: boolean;
      data?: { result: typeof baseResult };
      error?: { code: string };
    };
    expect(newest.ok).toBe(true);

    const staleUndo = await sender.evaluate(async ({ previous }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      return api.runtime.sendMessage({
        type: 'UNDO_TRANSLATION_RESULT',
        payload: {
          pageUrl: 'https://example.com/concurrent-correction',
          result: previous.result,
          receipt: previous.correctionReceipt,
        },
      });
    }, { previous: firstCommit }) as { ok: boolean; error?: { code: string } };
    expect(staleUndo.ok).toBe(false);
    expect(staleUndo.error?.code).toBe('REQUEST_ABORTED');

    const head = await sender.evaluate(async (key) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };
      }).chrome;
      return (await api.storage.session.get(key))[key];
    }, headKey) as { currentResultRequestId?: string } | undefined;
    expect(head?.currentResultRequestId).toBe(newest.data?.result.requestId);
  } finally {
    await sender.evaluate(async ({ key, tab }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
              remove(key: string): Promise<void>;
            };
          };
        };
      }).chrome;
      const stored = await api.storage.session.get('translationHistoryByTab');
      const history = {
        ...((stored.translationHistoryByTab ?? {}) as Record<string, unknown>),
      };
      delete history[String(tab)];
      await Promise.all([
        api.storage.session.set({ translationHistoryByTab: history }),
        api.storage.session.remove(key),
      ]);
    }, { key: headKey, tab: tabId }).catch(() => undefined);
    await sender.close();
  }
});

test('rejects a correction whose result head disappeared without persisting side effects', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.locator('.close').count()) await overlay.locator('.close').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toBeVisible();

  await overlay.locator('.correction-action').click();
  const editor = overlay.locator('.correction-text-part').first();
  const rejectedTranslation = 'MISSING_HEAD_CORRECTION_SHOULD_NOT_PERSIST';
  const rejectedTermSource = 'missing-head-source-term';
  const rejectedTermTarget = 'missing-head-target-term';
  await editor.fill(rejectedTranslation);
  await overlay.locator('.revision-scope select').selectOption('document');
  await overlay.locator('details.correction-term-disclosure > summary').click();
  await overlay.locator('.correction-term-fields input').nth(0).fill(rejectedTermSource);
  await overlay.locator('.correction-term-fields input').nth(1).fill(rejectedTermTarget);

  const worker = context.serviceWorkers()[0]!;
  const removedHead = await worker.evaluate(async (pageUrl) => {
    const api = (globalThis as typeof globalThis & {
      chrome: {
        tabs: { query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
        storage: {
          session: {
            get(key: string): Promise<Record<string, unknown>>;
            remove(key: string): Promise<void>;
          };
        };
      };
    }).chrome;
    const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
    if (tab?.id === undefined) throw new Error('Could not find the translated page tab.');
    const key = `translationResultHead:${tab.id}`;
    const original = (await api.storage.session.get(key))[key];
    if (!original) throw new Error('The translated page has no result head.');
    await api.storage.session.remove(key);
    return { tabId: tab.id, key, original };
  }, page.url());

  try {
    await overlay.locator('.correction-save').click();
    const state = await worker.evaluate(async ({ tabId, key }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: { get(key: string): Promise<Record<string, unknown>> };
            session: { get(keys: string[]): Promise<Record<string, unknown>> };
          };
        };
      }).chrome;
      const [local, session] = await Promise.all([
        api.storage.local.get('documentTranslationMemoryV1'),
        api.storage.session.get([key, 'translationHistoryByTab']),
      ]);
      return {
        head: session[key],
        history: (session.translationHistoryByTab as Record<string, unknown[]> | undefined)?.[
          String(tabId)
        ],
        documentMemory: local.documentTranslationMemoryV1,
      };
    }, removedHead);
    expect(state.head).toBeUndefined();
    expect(JSON.stringify(state.history ?? null)).not.toContain(rejectedTranslation);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTranslation);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTermSource);
    expect(JSON.stringify(state.documentMemory ?? null)).not.toContain(rejectedTermTarget);
    await expect(overlay.locator('.revision-status')).not.toHaveText('');
    await expect(editor).toBeVisible();
  } finally {
    await worker.evaluate(async ({ key, original }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ [key]: original });
    }, removedHead);
    if (await overlay.locator('.correction-cancel').count()) {
      await overlay.locator('.correction-cancel').click();
    }
    if (await overlay.locator('.close').count()) await overlay.locator('.close').click();
    await clearBrowserSelection();
  }
});

test('adopts an older translation version without an API call and can undo it', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('第一版人工译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('第一版人工译文。');

  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('第二版人工译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('第二版人工译文。');
  const requestsBeforeAdoption = textRequests.length;

  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toHaveCount(0);
  await overlay.getByTitle('查看下一版译文').click();
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' })).toBeVisible();
  await overlay.getByTitle('查看上一版译文').click();
  await overlay.getByTitle('查看上一版译文').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '采用当前版本' }).click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  expect(textRequests).toHaveLength(requestsBeforeAdoption);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  await expect(overlay.locator('.body')).toHaveText('第二版人工译文。');
  expect(textRequests).toHaveLength(requestsBeforeAdoption);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('retries a failed model adjustment with the frozen draft and revision context', async () => {
  await clearBrowserSelection();
  const overlay = page.locator('#tex-selection-translator-root');
  if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
  await selectSourceText();
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  await overlay.locator('.mark-action').click();

  await overlay.getByRole('button', { name: '修正译文' }).click();
  const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
  await editor.fill('必须保留的人工术语修订。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.body')).toHaveText('必须保留的人工术语修订。');

  failNextRevisionRequest = true;
  const requestsBeforeFailedRevision = textRequests.length;
  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '让模型调整…' }).click();
  await overlay.getByRole('combobox', { name: '译文调整作用范围' })
    .selectOption('document');
  await overlay.getByRole('button', { name: '更自然简洁' }).click();
  await expect(overlay.locator('.error')).toContainText('API 拒绝了本次请求');
  expect(textRequests).toHaveLength(requestsBeforeFailedRevision + 1);
  const failedRequest = JSON.stringify(textRequests.at(-1));
  expect(failedRequest).toContain('translationRevisionPreference');
  expect(failedRequest).toContain('必须保留的人工术语修订。');

  await overlay.getByRole('button', { name: '重试' }).click();
  await expect(overlay.locator('.body')).toContainText('经用户调整后');
  expect(textRequests).toHaveLength(requestsBeforeFailedRevision + 2);
  const retriedRequest = JSON.stringify(textRequests.at(-1));
  expect(retriedRequest).toContain('translationRevisionPreference');
  expect(retriedRequest).toContain('必须保留的人工术语修订。');
  await expect(overlay.locator('.version-counter')).toHaveText('v1/3');

  const worker = context.serviceWorkers()[0]!;
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome;
    const stored = await api.storage.local.get('documentTranslationMemoryV1');
    const memories = Object.values(
      (stored.documentTranslationMemoryV1 ?? {}) as Record<string, {
        recentTranslations?: Array<{ originalText?: string; translatedText?: string }>;
      }>,
    );
    return memories.flatMap((memory) => memory.recentTranslations ?? []).find(
      (entry) => entry.originalText ===
        'A consistent academic translation improves the readability of research papers.',
    )?.translatedText;
  })).toBe('经用户调整后，更忠实地保留原文限定条件。');

  const marker = page.locator('#pi-translation-marker-layer .marker').first();
  await expect(marker).toBeVisible();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the retried webpage source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(page.locator('#pi-translation-marker-layer .tooltip')).toContainText('经用户调整后');
  await overlay.locator('.mark-action').click();
  await expect(page.locator('#pi-translation-marker-layer .marker')).toHaveCount(0);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('corrects one aligned sentence locally without adding visible controls or API calls', async () => {
  await page.evaluate(() => {
    const source = document.querySelector('#multi-source');
    if (!source) throw new Error('Missing multi-sentence source fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toHaveText('第一句重要译文。第二句补充译文。');
  await overlay.getByRole('button', { name: '显示逐句对照' }).click();
  let segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  const first = segments.nth(0);
  await expect.poll(() => first.locator('.segment-actions').evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe('0.62');
  await first.focus();
  await expect.poll(() => first.locator('.segment-actions').evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe('1');
  const alignedControlHeights = await Promise.all([
    first.locator('.segment-correct'),
    first.locator('.segment-mark'),
  ].map((control) => control.evaluate((element) => element.getBoundingClientRect().height)));
  expect(alignedControlHeights).toEqual([32, 32]);
  const requestsBeforeCorrection = textRequests.length;
  await first.locator('.segment-correct').click();
  let sentenceEditor = first.getByRole('group', { name: /修正第 1 句/ });
  await expect(sentenceEditor).toBeVisible();
  await sentenceEditor.getByRole('textbox', { name: '可编辑本句译文第 1 段' })
    .press('Escape');
  await expect(sentenceEditor).toBeHidden();
  await expect(first.locator('.segment-correct')).toBeFocused();

  await first.locator('.segment-correct').click();
  sentenceEditor = first.getByRole('group', { name: /修正第 1 句/ });
  await sentenceEditor.getByRole('textbox', { name: '可编辑本句译文第 1 段' })
    .fill('人工修正后的第一句。');
  await sentenceEditor.getByRole('button', { name: '保存' }).click();

  segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0).locator('.segment-target')).toHaveText('人工修正后的第一句。');
  await expect(segments.nth(1).locator('.segment-target')).toHaveText('第二句补充译文。');
  await expect(segments.nth(0).locator('.segment-correct')).toBeFocused();
  const versionContext = overlay.locator('.version-context');
  await expect(versionContext).toContainText('修正本句');
  await expect(versionContext).toContainText('仅当前选择');
  await expect(versionContext).toContainText('较上一版调整 1 句');
  await expect(segments.nth(0)).toHaveAttribute('data-version-changed', 'true');
  await expect(segments.nth(1)).not.toHaveAttribute('data-version-changed', 'true');
  await overlay.getByRole('button', { name: '显示完整译文' }).click();
  await expect(overlay.locator('.segment')).toHaveCount(0);
  await overlay.getByRole('button', { name: '切换逐句对照并定位第一处版本改动' }).click();
  segments = overlay.locator('.segment');
  await expect(segments.nth(0)).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeCorrection);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  segments = overlay.locator('.segment');
  await expect(versionContext).toContainText('撤销修改');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0).locator('.segment-target')).toHaveText('第一句重要译文。');
  await expect(segments.nth(1).locator('.segment-target')).toHaveText('第二句补充译文。');
  await expect(segments.nth(0).locator('.segment-correct')).toBeFocused();
  expect(textRequests).toHaveLength(requestsBeforeCorrection);
  await overlay.getByTitle('关闭').click();
  await clearBrowserSelection();
});

test('marks one aligned sentence and copies marked notes as Markdown', async () => {
  await page.evaluate(() => {
    const source = document.querySelector('#multi-source');
    if (!source) throw new Error('Missing multi-sentence source fixture.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay.locator('.body')).toHaveText('第一句重要译文。第二句补充译文。');
  await overlay.getByRole('button', { name: '显示逐句对照' }).click();
  const segments = overlay.locator('.segment');
  await expect(segments).toHaveCount(2);
  await expect(segments.nth(0)).toContainText('First important sentence.');
  await expect(segments.nth(1)).toContainText('Second supporting sentence.');

  const firstMark = segments.nth(0).getByRole('button', { name: '轻标记本句' });
  await firstMark.click();
  await expect(segments.nth(0).getByRole('button', { name: '取消本句标记' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(segments.nth(1).getByRole('button', { name: '轻标记本句' }))
    .toHaveAttribute('aria-pressed', 'false');

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  await overlay.getByRole('button', { name: '关闭' }).click();
  await clearBrowserSelection();
  const markerBox = await waitForVisibleBoundingBox(marker, 'the aligned source marker');
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('第一句重要译文。');
  await expect(markerLayer.locator('.tooltip')).not.toContainText('第二句补充译文。');

  await page.mouse.click(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByRole('button', { name: '修正译文' }).click();
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' }).fill('手动修改后的完整双句译文。');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(1);
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await expect(markerLayer.locator('.tooltip')).toContainText('第一句重要译文。');

  const moreMenu = overlay.locator('details.more');
  await moreMenu.locator(':scope > summary').click();
  await expect(moreMenu).toHaveAttribute('open', '');
  await overlay.locator('.result-scroll').click({ position: { x: 4, y: 4 } });
  await expect(moreMenu).not.toHaveAttribute('open', '');
  await moreMenu.locator(':scope > summary').click();
  const exportNotes = overlay.getByRole('button', { name: '复制标记笔记' });
  await exportNotes.click();
  await expect(overlay.getByRole('button', { name: '已复制 1 条标记' })).toBeVisible();

  await overlay.getByRole('button', { name: '关闭' }).click();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
  await markerLayer.getByRole('button', { name: '取消标记' }).click();
  await expect(markerLayer.locator('.marker')).toHaveCount(0);
});

test('gives compact progress and success feedback when updating the target language', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const targetLanguage = popup.locator('#target-language');
  const status = popup.locator('#status');
  await expect(targetLanguage).toHaveValue('zh-CN');
  await targetLanguage.selectOption('en');
  await expect(status).toContainText('目标语言已更新');
  await expect(status).toHaveAttribute('data-tone', 'success');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(targetLanguage).toBeEnabled();
  expect(await status.evaluate((element) => {
    const marker = getComputedStyle(element, '::before');
    return { width: marker.width, height: marker.height, radius: marker.borderRadius };
  })).toEqual({ width: '5px', height: '5px', radius: '50%' });
  await expect(status).toHaveText('', { timeout: 4_000 });
  await expect(status).not.toHaveAttribute('data-tone', /.+/);
  await popup.close();

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('#target-language')).toHaveValue('en');
  await reopened.close();
});

test('shows site pause controls only on supported webpages', async () => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    await popup.reload();

    const siteControl = popup.locator('#site-control');
    const pauseSite = popup.locator('#pause-site');
    const quickActions = popup.locator('#quick-actions');
    await expect(siteControl).toBeVisible();
    await expect(popup.locator('#site-name')).toHaveText('www.overleaf.com');
    await expect(pauseSite).toBeEnabled();
    await expect(popup.locator('#api-profile-field')).toBeVisible();
    const fieldGap = await popup.evaluate(() => {
      const targetField = document.querySelector<HTMLElement>('label:has(#target-language)');
      const apiField = document.querySelector<HTMLElement>('#api-profile-field');
      if (!targetField || !apiField) return -1;
      return apiField.getBoundingClientRect().top - targetField.getBoundingClientRect().bottom;
    });
    expect(fieldGap).toBeGreaterThanOrEqual(11);
    await expect(quickActions).toHaveAttribute('data-primary', 'sidebar');
    await expect(quickActions.locator('button').first()).toHaveAttribute('id', 'open-sidebar');
    await expect(popup.locator('#open-sidebar')).toHaveClass(/primary-action/);
    await expect(popup.locator('#open-web-region')).toBeVisible();
    await expect(popup.locator('#open-web-region')).toHaveText('框选当前网页');
    await expect(popup.locator('#page-context')).toContainText('在 Overleaf 选中文字即可翻译');
    await expect(popup.locator('#open-pdf')).toHaveClass(/secondary-action/);
    const pauseSwitchStyle = await pauseSite.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        appearance: style.appearance,
        borderRadius: style.borderRadius,
        height: element.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width,
      };
    });
    expect(pauseSwitchStyle).toEqual({
      appearance: 'none',
      borderRadius: '999px',
      height: 20,
      width: 34,
    });
  } finally {
    await popup.close();
  }
});

test('frames webpage regions with local text first and screenshot only when needed', async () => {
  async function startFromPopup(): Promise<void> {
    const popup = await context.newPage();
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.bringToFront();
      await popup.reload();
      await expect(popup.locator('#open-web-region')).toBeVisible();
      await popup.evaluate(() => {
        document.querySelector<HTMLButtonElement>('#open-web-region')?.click();
      });
      await expect(page.locator('#pi-web-region-selection-root')).toBeVisible();
    } finally {
      if (!popup.isClosed()) await popup.close();
    }
  }

  async function drawAround(selector: string, widthRatio = 1): Promise<void> {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.move(box.x - 4, box.y - 4);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * widthRatio + 4,
      box.y + box.height + 4,
      { steps: 8 },
    );
    await page.mouse.up();
  }

  await closeVisibleTranslationSurfaceForCleanup();
  await clearBrowserSelection();
  const textBefore = textRequests.length;
  const visionBeforeText = visionRequests.length;
  await startFromPopup();
  await drawAround('#source', 0.55);
  const textRegion = page.locator('#pi-web-region-selection-root');
  await expect(textRegion.locator('.status')).toContainText('已在本地提取文字');
  await expect(textRegion.locator('.privacy')).toContainText('不上传网页截图');
  await expect(textRegion.locator('.confirm')).toHaveText('翻译文字');
  await textRegion.locator('.mode').click();
  await expect(textRegion.locator('.privacy')).toContainText('发送给已配置的图像接口');
  await expect(textRegion.locator('.confirm')).toHaveText('翻译截图');
  await textRegion.locator('.mode').click();
  await expect(textRegion.locator('.confirm')).toHaveText('翻译文字');
  const originalRegionBounds = await textRegion.locator('.selection').boundingBox();
  expect(originalRegionBounds).not.toBeNull();
  await textRegion.locator('.confirm').click();
  await expect(textRegion).toHaveCount(0);
  await expect(page.locator('#tex-selection-translator-root .body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');
  expect(textRequests).toHaveLength(textBefore + 1);
  const selectedRegionPayload = JSON.parse(String(
    (textRequests.at(-1)?.messages as Array<{ role?: string; content?: string }> | undefined)
      ?.find((message) => message.role === 'user')?.content,
  )) as { text?: string };
  expect(selectedRegionPayload.text).toContain('A consistent academic translation');
  expect(selectedRegionPayload.text).not.toContain('research papers');
  expect(visionRequests).toHaveLength(visionBeforeText);

  const resultOverlay = page.locator('#tex-selection-translator-root');
  await resultOverlay.locator('details.more > summary').click();
  await expect(resultOverlay.getByRole('button', { name: '调整区域' })).toBeVisible();
  await expect(resultOverlay.getByRole('button', { name: '重新框选' })).toBeVisible();
  await resultOverlay.getByRole('button', { name: '调整区域' }).click();
  const adjustedRegion = page.locator('#pi-web-region-selection-root');
  await expect(adjustedRegion.locator('.selection')).toBeVisible();
  await expect(adjustedRegion.locator('.selection')).toBeFocused();
  await expect(adjustedRegion.locator('.confirm')).toHaveText('翻译文字');
  const restoredRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(restoredRegionBounds).not.toBeNull();
  if (originalRegionBounds && restoredRegionBounds) {
    expect(restoredRegionBounds.x).toBeCloseTo(originalRegionBounds.x, 0);
    expect(restoredRegionBounds.y).toBeCloseTo(originalRegionBounds.y, 0);
    expect(restoredRegionBounds.width).toBeCloseTo(originalRegionBounds.width, 0);
    expect(restoredRegionBounds.height).toBeCloseTo(originalRegionBounds.height, 0);
  }
  expect(textRequests).toHaveLength(textBefore + 1);
  await adjustedRegion.locator('.selection').press('ArrowRight');
  const movedRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(movedRegionBounds).not.toBeNull();
  if (restoredRegionBounds && movedRegionBounds) {
    expect(movedRegionBounds.x).toBeCloseTo(restoredRegionBounds.x + 6, 0);
    expect(movedRegionBounds.width).toBeCloseTo(restoredRegionBounds.width, 0);
  }
  await adjustedRegion.locator('.selection').press('Shift+ArrowRight');
  const resizedRegionBounds = await adjustedRegion.locator('.selection').boundingBox();
  expect(resizedRegionBounds).not.toBeNull();
  if (movedRegionBounds && resizedRegionBounds) {
    expect(resizedRegionBounds.width).toBeCloseTo(movedRegionBounds.width + 6, 0);
  }
  expect(textRequests).toHaveLength(textBefore + 1);
  await adjustedRegion.locator('.confirm').click();
  await expect.poll(() => textRequests.length).toBe(textBefore + 2);
  await expect(resultOverlay.locator('.body'))
    .toHaveText('一致的学术翻译能够提升研究论文的可读性。');

  await resultOverlay.locator('details.more > summary').click();
  await resultOverlay.getByRole('button', { name: '重新框选' }).click();
  const keyboardRegion = page.locator('#pi-web-region-selection-root');
  await expect(keyboardRegion.locator('.selection')).toBeHidden();
  expect(textRequests).toHaveLength(textBefore + 2);
  await page.keyboard.press('Enter');
  await expect(keyboardRegion.locator('.selection')).toBeVisible();
  await expect(keyboardRegion.locator('.selection')).toBeFocused();
  const keyboardRegionBounds = await keyboardRegion.locator('.selection').boundingBox();
  expect(keyboardRegionBounds).not.toBeNull();
  await keyboardRegion.locator('.selection').press('Control+ArrowRight');
  const fineMovedRegionBounds = await keyboardRegion.locator('.selection').boundingBox();
  expect(fineMovedRegionBounds).not.toBeNull();
  if (keyboardRegionBounds && fineMovedRegionBounds) {
    expect(fineMovedRegionBounds.x).toBeCloseTo(keyboardRegionBounds.x + 1, 0);
  }
  expect(textRequests).toHaveLength(textBefore + 2);
  await page.keyboard.press('Escape');
  await expect(keyboardRegion).toHaveCount(0);
  await closeVisibleTranslationSurfaceForCleanup();

  const visionBeforeImage = visionRequests.length;
  await page.locator('#visual-region').scrollIntoViewIfNeeded();
  await startFromPopup();
  await drawAround('#visual-region');
  const imageRegion = page.locator('#pi-web-region-selection-root');
  await expect(imageRegion.locator('.status')).toContainText('没有可靠的可编辑文字');
  await expect(imageRegion.locator('.privacy')).toContainText('只截取当前可见页中的框内区域');
  await expect(imageRegion.locator('.confirm')).toHaveText('翻译截图');
  await imageRegion.locator('.confirm').click();
  await expect(imageRegion).toHaveCount(0);
  // A Playwright-opened extension page does not grant activeTab the way the
  // real toolbar popup does. The integration test therefore verifies the
  // explicit capture failure path; viewport mapping and image translation
  // are covered independently by unit and PDF image tests.
  await expect(page.locator('#tex-selection-translator-root .error'))
    .toContainText('没有成功截取这个网页区域');
  const captureFailure = page.locator('#tex-selection-translator-root');
  await expect(captureFailure.getByRole('button', { name: '调整区域' })).toBeVisible();
  await expect(captureFailure.getByRole('button', { name: '重新框选' })).toBeVisible();
  await captureFailure.getByRole('button', { name: '调整区域' }).click();
  const restoredImageRegion = page.locator('#pi-web-region-selection-root');
  await expect(restoredImageRegion.locator('.selection')).toBeVisible();
  await expect(restoredImageRegion.locator('.confirm')).toHaveText('翻译截图');
  expect(visionRequests).toHaveLength(visionBeforeImage);
  await restoredImageRegion.locator('.cancel').click();
  await expect(restoredImageRegion).toHaveCount(0);
  await closeVisibleTranslationSurfaceForCleanup();

  await page.locator('#payment').scrollIntoViewIfNeeded();
  await startFromPopup();
  await drawAround('#payment');
  const sensitiveRegion = page.locator('#pi-web-region-selection-root');
  await expect(sensitiveRegion.locator('.status')).toContainText('密码、验证码或支付字段');
  await expect(sensitiveRegion.locator('.confirm')).toBeDisabled();
  await sensitiveRegion.locator('.cancel').click();
  await expect(sensitiveRegion).toHaveCount(0);
});

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
    await reader.locator('#fit-width').click();
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
  returnPendingVisionReviewOnce = true;
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

  returnRevisedVisionResultOnce = true;
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
    expect(alignedLayout.formulaScrollWidth).toBeGreaterThan(alignedLayout.formulaClientWidth);
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
    progressStage: 'provider',
    completedChunks: 0,
    totalChunks: 1,
    providerContext: {
      role: 'vision',
      profileName: 'Qwen formula',
      model: 'qwen-vision-test-model',
    },
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
  await expect(sidePanel.locator('#translation-state')).toContainText('正在请求模型');
  await expect(sidePanel.locator('#translation-text')).toBeEmpty();
  await expect(sidePanel.locator('#session-actions')).toBeHidden();
  const streamingSession = {
    ...baseSession,
    partialText: '流式译文应当',
  } as const;
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: session,
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state')).toContainText('正在接收译文');
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#stop-translation')).toBeVisible();
  const stopButtonHeight = await sidePanel.locator('#stop-translation').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(stopButtonHeight).toBeGreaterThanOrEqual(32);
  expect(stopButtonHeight).toBeLessThanOrEqual(33);
  await expect(sidePanel.locator('#correct')).toBeHidden();
  await expect(sidePanel.locator('#correction-undo')).toBeHidden();
  await expect(sidePanel.locator('#open-pi-reader')).toHaveText('用 Pi 打开');
  await expect(sidePanel.locator('#reader-hint-text')).toBeVisible();
  await expect(sidePanel.locator('#reader-hint-text')).toContainText('未提供选区图像');
  await expect(sidePanel.locator('#reader-hint-text')).toContainText('第 6 页');
  const contextLayout = await sidePanel.locator('.session-context').evaluate((context) => ({
    height: context.getBoundingClientRect().height,
    buttonHeight: context.querySelector('button')?.getBoundingClientRect().height,
  }));
  expect(contextLayout.height).toBeLessThanOrEqual(51);
  expect(contextLayout.buttonHeight).toBeGreaterThanOrEqual(32);
  expect(contextLayout.buttonHeight).toBeLessThanOrEqual(33);

  const sendStreamingPartial = async (partialText: string) => messageSender.evaluate(
    async ({ session, partial }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
      }).chrome;
      await api.runtime.sendMessage({
        type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
        payload: { ...session, partialText: partial },
      });
    },
    { session: streamingSession, partial: partialText },
  );
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
  });
  const followedPartial = Array.from(
    { length: 24 },
    (_, index) => `流式段落 ${index + 1}：最新译文应在读者停留末尾时保持可见。`,
  ).join('\n');
  await sendStreamingPartial(followedPartial);
  await expect(sidePanel.locator('#translation-text')).toContainText('流式段落 24');
  await expect.poll(() => sidePanel.evaluate(
    () => document.scrollingElement?.scrollTop ?? 0,
  )).toBeGreaterThan(0);
  expect(await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (!scrollRoot) return Number.POSITIVE_INFINITY;
    return scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
  })).toBeLessThanOrEqual(1);

  await sidePanel.evaluate(() => { if (document.scrollingElement) document.scrollingElement.scrollTop = 0; });
  const pausedPartial = `${followedPartial}\n${Array.from(
    { length: 8 },
    (_, index) => `后续段落 ${index + 1}：向上阅读后不应被自动拉回底部。`,
  ).join('\n')}`;
  await sendStreamingPartial(pausedPartial);
  await expect(sidePanel.locator('#translation-text')).toContainText('后续段落 8');
  await sidePanel.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await sidePanel.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0);
  await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
  });

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'error',
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Synthetic stream interruption.',
          retryable: false,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('翻译中断 · 已保留部分译文');
  await expect(sidePanel.locator('#stop-translation')).toBeHidden();
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#error-message')).toContainText('响应超时');
  await expect(sidePanel.locator('#retry')).toBeVisible();
  await expect(sidePanel.locator('#session-actions')).toBeVisible();
  await expect(sidePanel.locator('#copy')).toHaveText('复制部分译文');
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  expect(await sidePanel.evaluate(() => {
    const scrollRoot = document.scrollingElement;
    if (!scrollRoot) return Number.POSITIVE_INFINITY;
    return scrollRoot.scrollHeight - scrollRoot.clientHeight - scrollRoot.scrollTop;
  })).toBeLessThanOrEqual(1);
  const partialCopyButtonHeight = await sidePanel.locator('#copy').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(partialCopyButtonHeight).toBeGreaterThanOrEqual(32);
  expect(partialCopyButtonHeight).toBeLessThanOrEqual(33);
  const footerHeightBeforeCopy = await sidePanel.locator('footer').evaluate(
    (footer) => footer.getBoundingClientRect().height,
  );
  await sidePanel.locator('#copy').click();
  await expect(sidePanel.locator('#copy')).toHaveText('已复制');
  await expect(sidePanel.locator('#copy')).toHaveAttribute('data-state', 'success');
  await expect(sidePanel.locator('#copy-feedback')).toHaveText('译文已复制到剪贴板');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  expect(await sidePanel.locator('footer').evaluate(
    (footer) => footer.getBoundingClientRect().height,
  )).toBe(footerHeightBeforeCopy);

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'error',
        error: {
          code: 'REQUEST_ABORTED',
          message: '翻译已停止。',
          retryable: false,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('已停止 · 已保留部分译文');
  await expect(sidePanel.locator('#translation-text')).toHaveText('流式译文应当');
  await expect(sidePanel.locator('#error-message')).toBeHidden();
  await expect(sidePanel.locator('#error-actions')).toBeHidden();
  await expect(sidePanel.locator('#retry')).toBeHidden();
  await expect(sidePanel.locator('#copy')).toHaveText('复制部分译文');
  await expect(sidePanel.locator('#copy')).toBeEnabled();

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
          translatedText: '流式译文应当显示在原生 PDF 阅读器旁边，其中 $E=mc^2$。',
          warnings: [],
          latencyMs: 850,
        },
      },
    });
  }, streamingSession);
  await expect(sidePanel.locator('#translation-text'))
    .toContainText('流式译文应当显示在原生 PDF 阅读器旁边');
  await expect(sidePanel.locator('#translation-view-switch')).toBeHidden();
  await expect(sidePanel.locator('#translation-state'))
    .toHaveText('850 毫秒');
  await expect(sidePanel.locator('#correct')).toBeVisible();
  await expect(sidePanel.locator('#correction-undo')).toBeHidden();
  await expect(sidePanel.locator('#translation-text .pi-math-inline math')).toBeVisible();
  await expect(sidePanel.locator('#formula-view')).toHaveText('源码');
  await sidePanel.locator('#formula-view').click();
  await expect(sidePanel.locator('#translation-text'))
    .toHaveText('流式译文应当显示在原生 PDF 阅读器旁边，其中 $E=mc^2$。');
  await expect(sidePanel.locator('#formula-view')).toHaveText('公式');
  await sidePanel.locator('#formula-view').click();
  // Exercise the same constrained width as Edge's native side panel. The
  // formula itself may scroll, but its equation number must remain in the
  // numbered row instead of wrapping below the expression.
  await sidePanel.setViewportSize({ width: 390, height: 820 });
  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        result: {
          requestId: session.requestId,
          originalText: session.sourceText,
          translatedText: [
            '**h-Transform**',
            '\\[Q^{\\Pi^*}(dZ)=\\pi^*(Z_\\tau)Q(dZ),\\tag{8}\\]',
            '**命题 2.8**',
            '\\[Q^{\\Pi^*}=\\operatorname{argmin}P\\in P(V,\\Omega) \\left\\{KL(P\\Vert Q):=E_P\\left[\\log \\frac{dP}{dQ}(Z_\\tau)\\right]\\right\\},\\quad \\mathrm{s.t.}\\ P_\\Omega=\\Pi^*,\\tag{12}\\]',
            '\\[KL(P\\Vert Q^{\\Pi^*})=KL(P\\Vert Q)-E_P[\\log\\pi^*(Z_\\tau)],\\tag{13}\\]',
            ...Array.from(
              { length: 18 },
              (_, index) => `补充说明 ${index + 1}：长译文阅读时，常用操作应始终保持可达。`,
            ),
          ].join('\\n'),
          warnings: [],
          latencyMs: 850,
        },
      },
    });
  }, baseSession);
  await expect(sidePanel.locator('#translation-text .pi-math-scroll math')).toHaveCount(3);
  await expect(sidePanel.locator('#translation-text strong')).toHaveText([
    'h-Transform',
    '命题 2.8',
  ]);
  await expect(sidePanel.locator('#translation-text .pi-equation-tag')).toHaveText([
    '(8)',
    '(12)',
    '(13)',
  ]);
  const optimizerEquation = sidePanel
    .locator('#translation-text .pi-math-display.pi-math-numbered')
    .nth(1);
  const optimizerScroll = optimizerEquation.locator('.pi-math-scroll');
  const optimizerTag = optimizerEquation.locator('.pi-equation-tag');
  await expect(optimizerScroll.locator('math munder')).toBeVisible();
  await expect(optimizerTag).toBeVisible();
  const optimizerLayout = await optimizerEquation.evaluate((equation) => {
    const scroll = equation.querySelector<HTMLElement>('.pi-math-scroll');
    const tag = equation.querySelector<HTMLElement>('.pi-equation-tag');
    if (!scroll || !tag) return undefined;
    const scrollRect = scroll.getBoundingClientRect();
    const tagBeforeScroll = tag.getBoundingClientRect();
    scroll.scrollLeft = scroll.scrollWidth;
    const tagAfterScroll = tag.getBoundingClientRect();
    const scrolledDistance = scroll.scrollLeft;
    scroll.scrollLeft = 0;
    return {
      overflowX: getComputedStyle(scroll).overflowX,
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      scrollLeft: scrolledDistance,
      verticalOverlap: Math.min(scrollRect.bottom, tagBeforeScroll.bottom)
        - Math.max(scrollRect.top, tagBeforeScroll.top),
      tagLeftBeforeScroll: tagBeforeScroll.left,
      tagLeftAfterScroll: tagAfterScroll.left,
      tagRight: tagAfterScroll.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(optimizerLayout).toBeDefined();
  expect(optimizerLayout!.overflowX).toMatch(/auto|scroll/);
  expect(optimizerLayout!.scrollWidth).toBeGreaterThan(optimizerLayout!.clientWidth + 1);
  expect(optimizerLayout!.scrollLeft).toBeGreaterThan(0);
  expect(optimizerLayout!.verticalOverlap).toBeGreaterThan(0);
  expect(Math.abs(
    optimizerLayout!.tagLeftAfterScroll - optimizerLayout!.tagLeftBeforeScroll,
  )).toBeLessThan(1);
  expect(optimizerLayout!.tagRight).toBeLessThanOrEqual(optimizerLayout!.viewportWidth + 1);
  await sidePanel.evaluate(() => window.scrollTo(0, 0));
  const stickyActionLayout = await sidePanel.locator('#session-actions').evaluate((footer) => {
    const rect = footer.getBoundingClientRect();
    return {
      position: getComputedStyle(footer).position,
      bottom: rect.bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(stickyActionLayout.position).toBe('sticky');
  expect(stickyActionLayout.pageScrollHeight).toBeGreaterThan(stickyActionLayout.viewportHeight + 1);
  expect(stickyActionLayout.bottom).toBeLessThanOrEqual(stickyActionLayout.viewportHeight + 1);
  expect(stickyActionLayout.bottom).toBeGreaterThan(stickyActionLayout.viewportHeight - 2);
  await sidePanel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const actionEndLayout = await sidePanel.evaluate(() => ({
    translationBottom: document.querySelector('#translation-text')?.getBoundingClientRect().bottom,
    footerTop: document.querySelector('#session-actions')?.getBoundingClientRect().top,
  }));
  expect(actionEndLayout.translationBottom).toBeDefined();
  expect(actionEndLayout.footerTop).toBeDefined();
  expect(actionEndLayout.translationBottom!).toBeLessThanOrEqual(actionEndLayout.footerTop! + 1);
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  const completedActionStyles = await sidePanel.locator('footer').evaluate((footer) => {
    const copyAction = footer.querySelector<HTMLElement>('#copy');
    const correctionAction = footer.querySelector<HTMLElement>('#correct');
    if (!copyAction || !correctionAction) return undefined;
    return {
      copyBackground: getComputedStyle(copyAction).backgroundColor,
      correctionBackground: getComputedStyle(correctionAction).backgroundColor,
    };
  });
  expect(completedActionStyles).toBeDefined();
  expect(completedActionStyles!.copyBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(completedActionStyles!.correctionBackground).toBe('rgba(0, 0, 0, 0)');
  await sidePanel.locator('#copy').click();
  await expect(sidePanel.locator('#copy')).toHaveText('已复制');
  await expect(sidePanel.locator('#copy-feedback')).toHaveText('译文已复制到剪贴板');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  const sessionContextLayout = await sidePanel.locator('.session-context').evaluate((context) => {
    const rect = context.getBoundingClientRect();
    return {
      clientWidth: context.clientWidth,
      scrollWidth: context.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(sessionContextLayout.scrollWidth)
    .toBeLessThanOrEqual(sessionContextLayout.clientWidth + 1);
  expect(sessionContextLayout.left).toBeGreaterThanOrEqual(-1);
  expect(sessionContextLayout.right)
    .toBeLessThanOrEqual(sessionContextLayout.viewportWidth + 1);
  const footerLayout = await sidePanel.locator('footer').evaluate((footer) => {
    const rect = footer.getBoundingClientRect();
    return {
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(footerLayout.scrollWidth).toBeLessThanOrEqual(footerLayout.clientWidth + 1);
  expect(footerLayout.left).toBeGreaterThanOrEqual(-1);
  expect(footerLayout.right).toBeLessThanOrEqual(footerLayout.viewportWidth + 1);
  expect(footerLayout.pageScrollWidth).toBeLessThanOrEqual(footerLayout.viewportWidth + 1);
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.locator('#correct').click();
  const nativeCorrection = sidePanel.getByRole('group', { name: '修正译文，公式已锁定' });
  await expect(nativeCorrection).toBeVisible();
  await expect(sidePanel.locator('#session-actions')).toBeHidden();
  const correctionTextPartLayout = await nativeCorrection.locator('.correction-text-part')
    .evaluateAll((inputs) => inputs.map((input) => {
      const field = input as HTMLTextAreaElement;
      return {
        clientHeight: field.clientHeight,
        scrollHeight: field.scrollHeight,
        fieldSizing: getComputedStyle(field).getPropertyValue('field-sizing'),
      };
    }));
  expect(correctionTextPartLayout.length).toBeGreaterThan(1);
  const firstCorrectionTextPart = correctionTextPartLayout.at(0)!;
  const lastCorrectionTextPart = correctionTextPartLayout.at(-1)!;
  expect(firstCorrectionTextPart.clientHeight).toBeLessThanOrEqual(80);
  expect(lastCorrectionTextPart.fieldSizing).toBe('content');
  expect(lastCorrectionTextPart.clientHeight).toBeGreaterThan(120);
  expect(lastCorrectionTextPart.clientHeight).toBeLessThanOrEqual(152);
  expect(lastCorrectionTextPart.scrollHeight).toBeGreaterThan(lastCorrectionTextPart.clientHeight);
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toContainText('Q^{\\Pi^*}');
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toHaveAttribute('aria-readonly', 'true');
  await expect(nativeCorrection.getByLabel('受保护公式 1，不可编辑'))
    .toHaveAttribute('role', 'textbox');
  await expect(sidePanel.locator('#copy')).toBeDisabled();
  const correctionScope = nativeCorrection.getByLabel('修正译文的保存范围');
  await correctionScope.focus();
  await correctionScope.press('ArrowDown');
  await expect(correctionScope).toHaveValue('document');
  await expect(correctionScope).toBeFocused();
  await expect(nativeCorrection.getByLabel('原文术语')).toBeHidden();
  const nativeTermDisclosure = nativeCorrection.locator('details.correction-term-disclosure');
  const nativeTermSummary = nativeTermDisclosure.locator(':scope > summary');
  await nativeTermSummary.click();
  const nativeSourceTerm = nativeCorrection.getByLabel('原文术语');
  const nativeTargetTerm = nativeCorrection.getByLabel('固定译法');
  const nativeTermScope = nativeCorrection.getByLabel('术语保存范围');
  await nativeTermScope.selectOption('global');
  await expect(nativeTermScope).toHaveValue('global');
  const nativeEditor = nativeCorrection.getByLabel('可编辑译文第 1 段');
  await nativeEditor.fill('修正后的原生 PDF 译文标题。');
  await nativeSourceTerm.fill('native PDF');
  await expect(nativeTermSummary).toHaveText('！固定术语待补充');
  await nativeTermSummary.click();
  await expect(nativeTermDisclosure).not.toHaveAttribute('open', '');
  const nativeCorrectionSave = nativeCorrection.getByRole('button', { name: '保存', exact: true });
  await nativeCorrectionSave.click();
  const nativeCorrectionFeedback = nativeCorrection.locator('.correction-feedback');
  await expect(nativeCorrectionFeedback)
    .toContainText('请完整填写不含公式的简短术语和固定译法');
  await expect(nativeCorrectionFeedback).toHaveAttribute('role', 'alert');
  await expect(nativeTermDisclosure).toHaveAttribute('open', '');
  await expect(nativeTargetTerm).toHaveAttribute('aria-invalid', 'true');
  await expect(nativeTargetTerm).toHaveAttribute(
    'aria-describedby',
    'pi-pdf-side-panel-correction-status',
  );
  await expect(nativeTargetTerm).toBeFocused();
  const correctionFailureLayout = await nativeCorrection.evaluate((editor) => {
    const actions = editor.querySelector<HTMLElement>('.correction-actions')!;
    const feedback = editor.querySelector<HTMLElement>('.correction-feedback')!;
    const target = editor.querySelector<HTMLInputElement>('[aria-label="固定译法"]')!;
    const actionRect = actions.getBoundingClientRect();
    return {
      actionHeight: actionRect.height,
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      feedbackBottom: feedback.getBoundingClientRect().bottom,
      targetBottom: target.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(correctionFailureLayout.actionBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.viewportHeight + 1);
  expect(correctionFailureLayout.feedbackBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.actionBottom);
  expect(correctionFailureLayout.targetBottom)
    .toBeLessThanOrEqual(correctionFailureLayout.actionTop - 7);
  expect(correctionFailureLayout.pageScrollWidth)
    .toBeLessThanOrEqual(correctionFailureLayout.viewportWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await nativeTargetTerm.fill('原生 PDF');
  await expect(nativeCorrectionFeedback).toBeEmpty();
  await expect(nativeTargetTerm).not.toHaveAttribute('aria-invalid');
  await expect(nativeTermSummary).toHaveText('✓ 已填写固定术语');
  const nativeCorrectionActionLayout = await nativeCorrection.locator('.correction-actions')
    .evaluate((actions) => {
      const rect = actions.getBoundingClientRect();
      return {
        position: getComputedStyle(actions).position,
        bottom: rect.bottom,
        viewportHeight: document.documentElement.clientHeight,
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
  expect(nativeCorrectionActionLayout.position).toBe('fixed');
  expect(nativeCorrectionActionLayout.bottom)
    .toBeGreaterThan(nativeCorrectionActionLayout.viewportHeight - 2);
  expect(nativeCorrectionActionLayout.bottom)
    .toBeLessThanOrEqual(nativeCorrectionActionLayout.viewportHeight + 1);
  expect(nativeCorrectionActionLayout.pageScrollWidth)
    .toBeLessThanOrEqual(nativeCorrectionActionLayout.viewportWidth + 1);
  await expect.poll(() => nativeTargetTerm.evaluate((field) => {
    const actions = document.querySelector<HTMLElement>('.correction-actions');
    if (!actions) return false;
    return field.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top - 7;
  })).toBe(true);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-correction-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await nativeTermSummary.click();
  await nativeCorrectionSave.click();
  await expect(nativeCorrectionFeedback).toContainText('当前 PDF 或译文已经变化');
  await expect(nativeCorrectionFeedback).toHaveAttribute('role', 'alert');
  const correctionRetry = nativeCorrection.getByRole('button', { name: '重试' });
  await expect(correctionRetry).toBeFocused();
  await expect(nativeEditor).toBeEnabled();
  await expect(nativeEditor).toHaveValue('修正后的原生 PDF 译文标题。');
  const saveFailureLayout = await nativeCorrection.evaluate((editor) => {
    const actions = editor.querySelector<HTMLElement>('.correction-actions')!;
    const feedback = editor.querySelector<HTMLElement>('.correction-feedback')!;
    const retry = [...actions.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '重试')!;
    const actionRect = actions.getBoundingClientRect();
    return {
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      feedbackBottom: feedback.getBoundingClientRect().bottom,
      retryTop: retry.getBoundingClientRect().top,
      retryBottom: retry.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(saveFailureLayout.actionTop).toBeGreaterThanOrEqual(0);
  expect(saveFailureLayout.actionBottom).toBeLessThanOrEqual(saveFailureLayout.viewportHeight + 1);
  expect(saveFailureLayout.feedbackBottom).toBeLessThanOrEqual(saveFailureLayout.actionBottom);
  expect(saveFailureLayout.retryTop).toBeGreaterThanOrEqual(saveFailureLayout.actionTop);
  expect(saveFailureLayout.retryBottom).toBeLessThanOrEqual(saveFailureLayout.actionBottom);
  expect(saveFailureLayout.pageScrollWidth).toBeLessThanOrEqual(saveFailureLayout.viewportWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-save-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-save-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await nativeEditor.fill('再次调整后的原生 PDF 译文标题。');
  await expect(nativeCorrectionFeedback).toBeEmpty();
  await expect(nativeCorrection.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await nativeCorrection.press('Escape');
  await expect(sidePanel.locator('#correct')).toBeFocused();
  await expect(sidePanel.locator('#session-actions')).toBeVisible();
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  await expect(sidePanel.locator('#translation-text .pi-math-scroll math')).toHaveCount(3);

  await messageSender.evaluate(async (session) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        ...session,
        status: 'complete',
        partialText: '已修正的原生 PDF 译文。',
        result: {
          requestId: 'native-pdf-corrected-e2e',
          originalText: session.sourceText,
          translatedText: '已修正的原生 PDF 译文。',
          warnings: [],
          latencyMs: 0,
          revision: {
            rootRequestId: session.requestId,
            kind: 'manual',
            label: '手动修改',
            scope: 'current',
          },
        },
        correctionReceipt: {
          baseRequestId: session.requestId,
          correctedRequestId: 'native-pdf-corrected-e2e',
          scope: 'current',
          previousTranslation: '修正前的原生 PDF 译文。',
          correctedTranslation: '已修正的原生 PDF 译文。',
        },
      },
    });
  }, baseSession);
  await expect(sidePanel.locator('#correction-undo')).toBeVisible();
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.locator('#undo-correction').click();
  await expect(sidePanel.locator('#correction-undo'))
    .toContainText('没有可撤销的 PDF 译文修正');
  await expect(sidePanel.locator('#correction-undo')).toHaveAttribute('role', 'alert');
  await expect(sidePanel.locator('#status')).toBeEmpty();
  await expect(sidePanel.locator('#undo-correction')).toHaveText('重试');
  await expect(sidePanel.locator('#undo-correction')).toBeFocused();
  const undoFailureLayout = await sidePanel.locator('#session-actions').evaluate((footer) => {
    const footerRect = footer.getBoundingClientRect();
    const retryButton = footer.querySelector<HTMLElement>('#undo-correction')!;
    const message = footer.querySelector<HTMLElement>('#correction-undo-message')!;
    return {
      footerTop: footerRect.top,
      footerBottom: footerRect.bottom,
      retryTop: retryButton.getBoundingClientRect().top,
      retryBottom: retryButton.getBoundingClientRect().bottom,
      messageBottom: message.getBoundingClientRect().bottom,
      viewportHeight: document.documentElement.clientHeight,
      clientWidth: footer.clientWidth,
      scrollWidth: footer.scrollWidth,
    };
  });
  expect(undoFailureLayout.footerTop).toBeGreaterThanOrEqual(0);
  expect(undoFailureLayout.footerBottom).toBeLessThanOrEqual(undoFailureLayout.viewportHeight + 1);
  expect(undoFailureLayout.retryTop).toBeGreaterThanOrEqual(undoFailureLayout.footerTop);
  expect(undoFailureLayout.retryBottom).toBeLessThanOrEqual(undoFailureLayout.footerBottom);
  expect(undoFailureLayout.messageBottom).toBeLessThanOrEqual(undoFailureLayout.footerBottom);
  expect(undoFailureLayout.scrollWidth).toBeLessThanOrEqual(undoFailureLayout.clientWidth + 1);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-undo-error-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-undo-error-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  const inheritedReaderPromise = context.waitForEvent('page');
  await sidePanel.locator('#open-pi-reader').click();
  const inheritedReader = await inheritedReaderPromise;
  await inheritedReader.waitForURL((url) => url.pathname === '/pdf.html');
  await inheritedReader.waitForLoadState('domcontentloaded');
  const inheritedUrl = new URL(inheritedReader.url());
  expect(inheritedUrl.pathname).toBe('/pdf.html');
  expect(inheritedUrl.searchParams.get('url'))
    .toBe('https://www.overleaf.com/native-reader.pdf');
  expect(inheritedUrl.searchParams.get('page')).toBe('6');
  await inheritedReader.close();
  await messageSender.close();
  await sidePanel.close();
});

test('keeps long native PDF source text compact and expandable', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.setViewportSize({ width: 360, height: 820 });
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();

  const longSource = Array.from(
    { length: 24 },
    (_, index) => `Long academic source sentence ${index + 1} keeps the translation below easy to reach.`,
  ).join(' ');
  const baseSession = {
    tabId,
    requestId: 'long-source-disclosure-e2e',
    sourceText: longSource,
    pageUrl: 'https://www.overleaf.com/long-source.pdf',
    sourceLabel: 'long-source.pdf',
    status: 'complete',
    startedAt: Date.now(),
    result: {
      requestId: 'long-source-disclosure-e2e',
      originalText: longSource,
      translatedText: '长原文不会遮挡这段译文。',
      warnings: [],
      latencyMs: 420,
    },
  } as const;
  const sendSession = async (session: unknown) => messageSender.evaluate(async (payload) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload,
    });
  }, session);

  await sendSession(baseSession);
  const sourceToggle = sidePanel.locator('#source-toggle');
  const sourceText = sidePanel.locator('#source-text');
  await expect(sourceToggle).toBeVisible();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sourceToggle).toHaveAttribute('aria-controls', 'source-text');
  const collapsedLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    lineHeight: parseFloat(getComputedStyle(source).lineHeight),
    overflowY: getComputedStyle(source).overflowY,
  }));
  expect(collapsedLayout.scrollHeight).toBeGreaterThan(collapsedLayout.clientHeight + 1);
  expect(collapsedLayout.clientHeight).toBeLessThanOrEqual(collapsedLayout.lineHeight * 3 + 1);
  expect(collapsedLayout.overflowY).toBe('hidden');
  const sourceToggleHeight = await sourceToggle.evaluate((button) => button.getBoundingClientRect().height);
  expect(sourceToggleHeight).toBeGreaterThanOrEqual(32);
  expect(sourceToggleHeight).toBeLessThanOrEqual(33);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-collapsed.png') });
  }

  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('收起');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'true');
  const expandedLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    overflowY: getComputedStyle(source).overflowY,
    translationHeadingTop: document.querySelector('.result-section .section-heading')
      ?.getBoundingClientRect().top,
    viewportHeight: document.documentElement.clientHeight,
  }));
  expect(expandedLayout.clientHeight).toBeGreaterThan(collapsedLayout.clientHeight + 20);
  expect(expandedLayout.scrollHeight).toBeGreaterThan(expandedLayout.clientHeight + 1);
  expect(expandedLayout.overflowY).toBe('auto');
  expect(expandedLayout.translationHeadingTop).toBeDefined();
  expect(expandedLayout.translationHeadingTop!)
    .toBeLessThan(expandedLayout.viewportHeight - 20);
  await expect(sourceToggle).toBeFocused();
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-expanded.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-expanded-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }

  await sidePanel.setViewportSize({ width: 360, height: 420 });
  const shortViewportLayout = await sourceText.evaluate((source) => ({
    clientHeight: source.clientHeight,
    scrollHeight: source.scrollHeight,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    translationHeadingBottom: document.querySelector('.result-section .section-heading')
      ?.getBoundingClientRect().bottom,
    translationTextTop: document.querySelector('#translation-text')?.getBoundingClientRect().top,
    footerTop: document.querySelector('#session-actions')?.getBoundingClientRect().top,
  }));
  expect(shortViewportLayout.clientHeight)
    .toBeLessThanOrEqual(Math.max(88, shortViewportLayout.viewportHeight * 0.22) + 1);
  expect(shortViewportLayout.scrollHeight).toBeGreaterThan(shortViewportLayout.clientHeight + 1);
  expect(shortViewportLayout.pageScrollWidth).toBeLessThanOrEqual(shortViewportLayout.viewportWidth + 1);
  expect(shortViewportLayout.translationHeadingBottom).toBeDefined();
  expect(shortViewportLayout.footerTop).toBeDefined();
  expect(shortViewportLayout.translationHeadingBottom!)
    .toBeLessThanOrEqual(shortViewportLayout.footerTop! - 8);
  expect(shortViewportLayout.translationTextTop).toBeDefined();
  expect(shortViewportLayout.translationTextTop!)
    .toBeLessThanOrEqual(shortViewportLayout.footerTop! - 14);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-long-source-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }
  await sourceText.hover();
  await sidePanel.mouse.wheel(0, 5_000);
  await expect.poll(() => sourceText.evaluate(
    (source) => source.scrollHeight - source.clientHeight - source.scrollTop,
  )).toBeLessThanOrEqual(1);
  await sidePanel.mouse.wheel(0, 600);
  await expect.poll(() => sidePanel.evaluate(
    () => document.scrollingElement?.scrollTop ?? 0,
  )).toBeGreaterThan(0);
  await sidePanel.evaluate(() => window.scrollTo(0, 0));

  await sourceText.evaluate((source) => { source.scrollTop = source.scrollHeight; });
  expect(await sourceText.evaluate((source) => source.scrollTop)).toBeGreaterThan(0);
  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await sourceText.evaluate((source) => source.scrollTop)).toBe(0);
  await sourceToggle.click();
  await expect(sourceToggle).toHaveText('收起');

  await sendSession({
    ...baseSession,
    result: { ...baseSession.result, latencyMs: 460 },
  });
  await expect(sourceToggle).toHaveText('收起');
  await expect(sourceText).toHaveClass(/expanded/);

  const nextRequestId = 'long-source-disclosure-next-e2e';
  await sendSession({
    ...baseSession,
    requestId: nextRequestId,
    startedAt: baseSession.startedAt + 1,
    result: { ...baseSession.result, requestId: nextRequestId },
  });
  await expect(sourceToggle).toBeVisible();
  await expect(sourceToggle).toHaveText('展开');
  await expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');

  const shortRequestId = 'short-source-disclosure-e2e';
  await sendSession({
    ...baseSession,
    requestId: shortRequestId,
    sourceText: 'Short source text.',
    startedAt: baseSession.startedAt + 2,
    result: {
      ...baseSession.result,
      requestId: shortRequestId,
      originalText: 'Short source text.',
    },
  });
  await sidePanel.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(sourceToggle).toBeHidden();
  expect(await sourceText.evaluate((source) => source.scrollHeight <= source.clientHeight + 1)).toBe(true);

  await messageSender.close();
  await sidePanel.close();
});

test('clears native PDF side-panel actions as soon as the active tab changes', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  await sidePanel.setViewportSize({ width: 360, height: 420 });
  await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const messageSender = await context.newPage();
  await messageSender.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await messageSender.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { tabs: { getCurrent(): Promise<{ id?: number }> } };
    }).chrome;
    return (await api.tabs.getCurrent()).id;
  });
  expect(tabId).toBeDefined();
  await messageSender.evaluate(async (sessionTabId) => {
    const api = (globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    }).chrome;
    await api.runtime.sendMessage({
      type: 'PDF_SIDE_PANEL_SESSION_UPDATED',
      payload: {
        tabId: sessionTabId,
        requestId: 'activation-race-session',
        sourceText: 'Text from the previously active PDF.',
        pageUrl: 'edge://pdf',
        sourceLabel: 'previous.pdf',
        status: 'error',
        startedAt: Date.now(),
        providerContext: {
          role: 'text',
          profileName: 'DeepSeek text',
          model: 'deepseek-test-model',
        },
        error: { code: 'NETWORK_ERROR', message: 'Retry me.', retryable: true },
      },
    });
  }, tabId);
  await expect(sidePanel.locator('#session')).toBeVisible();
  await expect(sidePanel.locator('#retry')).toBeVisible();
  await expect(sidePanel.locator('#reader-hint-text')).toBeHidden();
  await expect(sidePanel.locator('#pdf-access-alert')).toBeVisible();
  await expect(sidePanel.locator('#open-pi-reader')).toHaveText('解决 PDF 读取权限');
  await expect(sidePanel.locator('#translation-text'))
    .toContainText('本次使用：文字 API「DeepSeek text」 · deepseek-test-model');
  const accessAlert = sidePanel.locator('#pdf-access-alert');
  const accessLayout = await accessAlert.evaluate((alert) => ({
    clientWidth: alert.clientWidth,
    scrollWidth: alert.scrollWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    actionHeights: [...alert.querySelectorAll<HTMLElement>('.access-actions button')]
      .map((button) => button.getBoundingClientRect().height),
  }));
  expect(accessLayout.scrollWidth).toBeLessThanOrEqual(accessLayout.clientWidth + 1);
  expect(accessLayout.pageScrollWidth).toBeLessThanOrEqual(accessLayout.viewportWidth + 1);
  expect(accessLayout.actionHeights).toHaveLength(2);
  expect(accessLayout.actionHeights.every((height) => height >= 32)).toBe(true);
  const retryPdfAccess = accessAlert.getByRole('button', { name: '重新检测' });
  await retryPdfAccess.focus();
  await expect(retryPdfAccess).toBeFocused();
  const focusedRecoveryLayout = await retryPdfAccess.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: document.documentElement.clientHeight,
    };
  });
  expect(focusedRecoveryLayout.top).toBeGreaterThanOrEqual(0);
  expect(focusedRecoveryLayout.bottom).toBeLessThanOrEqual(focusedRecoveryLayout.viewportHeight);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-access-recovery-360x420.png') });
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-access-recovery-360x420-dark.png') });
    await sidePanel.emulateMedia({ colorScheme: 'light' });
  }

  const nextTab = await context.newPage();
  await nextTab.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(sidePanel.locator('#empty-state')).toBeVisible();
  await expect(sidePanel.locator('#session')).toBeHidden();

  await nextTab.close();
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
  await settingsPage.waitForURL((url) => (
    url.protocol === 'chrome-extension:' && url.pathname === '/options.html'
  ));
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

test('stops a streaming translation without discarding received output', async () => {
  const apiPattern = 'https://www.overleaf.com/pi-translator-e2e-api/**';
  let releaseFirst: (() => void) | undefined;
  let releaseSecond: (() => void) | undefined;
  let releaseRemaining: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const remainingGate = new Promise<void>((resolve) => { releaseRemaining = resolve; });
  let requestIndex = 0;
  const streamingHandler = async (route: Route): Promise<void> => {
    requestIndex += 1;
    await (requestIndex === 1 ? firstGate : requestIndex === 2 ? secondGate : remainingGate);
    if (requestIndex === 1) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            translation: '已经返回的第一段译文。\n'.repeat(80),
            detectedLanguage: 'en',
            warnings: [],
            segments: [],
          }) } }],
        }),
      }).catch(() => undefined);
      return;
    }
    if (requestIndex === 2) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            translation: '已经返回的第二段译文。\n'.repeat(80),
            detectedLanguage: 'en',
            warnings: [],
            segments: [],
          }) } }],
        }),
      }).catch(() => undefined);
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          translation: '后续译文。',
          detectedLanguage: 'en',
          warnings: [],
          segments: [],
        }) } }],
      }),
    }).catch(() => undefined);
  };
  await context.route(apiPattern, streamingHandler);
  try {
    await page.locator('#source').evaluate((element) => {
      element.textContent = 'A long academic sentence for streaming translation. '.repeat(250);
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const overlay = page.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.getByTitle('停止并关闭')).toBeVisible();
    await expect(overlay.getByRole('button', { name: '停止翻译并保留已收到的译文' }))
      .toBeVisible();
    const pin = overlay.getByTitle('在页面侧栏中显示');
    await expect(pin).toHaveText('页面侧栏');
    await expect(overlay.locator('.loading-status')).toContainText('正在请求模型');
    await pin.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect(overlay.locator('.sidebar-region-action')).toContainText('框选网页');
    await expect(overlay.locator('.progress')).toBeVisible();
    await expect(overlay.locator('.loading-status')).toContainText('正在请求模型');

    releaseFirst?.();
    await expect.poll(() => requestIndex).toBeGreaterThanOrEqual(2);
    await expect(overlay.locator('.loading-status')).toContainText('正在接收译文');
    const streamPreview = overlay.locator('.stream-preview');
    await expect(streamPreview).toContainText('已经返回的第一段译文。');
    await expect.poll(() => streamPreview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await streamPreview.evaluate((element) => { element.scrollTop = 0; });

    releaseSecond?.();
    await expect.poll(() => requestIndex).toBeGreaterThanOrEqual(3);
    await expect(streamPreview).toContainText('已经返回的第二段译文。');
    await expect.poll(() => streamPreview.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(overlay.locator('.progress')).toBeVisible();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const stop = overlay.getByRole('button', {
      name: '停止翻译并保留已收到的译文',
    });
    await stop.focus();
    await stop.press('Enter');
    await expect(overlay.locator('.stopped-status'))
      .toHaveText('已停止 · 已保留部分译文');
    await expect(overlay.locator('.stream-preview')).toContainText('已经返回的第一段译文。');
    await expect(overlay.locator('.stream-preview')).toContainText('已经返回的第二段译文。');
    const copyPartial = overlay.getByRole('button', { name: '复制部分译文' });
    await expect(copyPartial).toBeVisible();
    await expect(copyPartial).toBeFocused();
    await expect(overlay.getByRole('button', { name: '重试' })).toHaveCount(0);
    await expect(overlay.locator('.stop-translation')).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(requestIndex).toBe(3);
    await expect(overlay.locator('.stopped-status'))
      .toHaveText('已停止 · 已保留部分译文');
  } finally {
    releaseFirst?.();
    releaseSecond?.();
    releaseRemaining?.();
    await context.unroute(apiPattern, streamingHandler);
    const overlay = page.locator('#tex-selection-translator-root');
    if (await overlay.locator('.surface-close').count()) {
      await overlay.locator('.surface-close').click();
    }
    await page.locator('#source').evaluate((element) => {
      element.textContent = 'A consistent academic translation improves the readability of research papers.';
    });
    await clearBrowserSelection();
  }
});

test('pins continuous translation to a collapsible sidebar', async ({}, testInfo) => {
  await page.locator('#blank').focus();
  await selectElementText('#source');
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await overlay.getByTitle('在页面侧栏中显示').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  const webRegionAction = overlay.getByRole('button', {
    name: '框选当前网页中的文字、公式、图表或图像',
  });
  await expect(webRegionAction).toBeVisible();
  await expect(webRegionAction).toContainText('框选网页');
  await expect(webRegionAction).toContainText('文字 · 公式 · 图表');
  expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(33);
  if (process.env.PI_VISUAL_ARTIFACTS === '1') {
    await page.screenshot({
      path: testInfo.outputPath('web-floating-sidebar-region-action.png'),
    });
  }
  const requestsBeforeRegionSelection = textRequests.length;
  await webRegionAction.click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
  const webRegion = page.locator('#pi-web-region-selection-root');
  await expect(webRegion).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(webRegion).toHaveCount(0);
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.sidebar-region-action')).toBeVisible();
  expect(textRequests).toHaveLength(requestsBeforeRegionSelection);
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
  const collapse = overlay.getByTitle('收起侧栏');
  await collapse.focus();
  await collapse.press('Enter');
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
  const expand = overlay.getByTitle('展开 Pi Translator 连续翻译侧栏');
  await expect(expand).toBeFocused();
  await expand.press('Enter');
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.getByTitle('收起侧栏')).toBeFocused();
  await overlay.getByTitle('关闭').click();
  await expect(page.locator('#blank')).toBeFocused();
  await clearBrowserSelection();
});

test('moves webpage continuous translation into browser-owned side-panel space', async ({}, testInfo) => {
  const sidePanel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  let originalSentenceAlignmentDefault: boolean | undefined;
  try {
    await page.bringToFront();
    await selectElementText('#source');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    const requestsBeforeSwitch = textRequests.length;

    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '在浏览器侧栏中显示' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    await page.waitForTimeout(250);
    expect(textRequests).toHaveLength(requestsBeforeSwitch);

    await sidePanel.setViewportSize({ width: 390, height: 760 });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await expect(sidePanel.locator('#session')).toBeVisible();
    await expect(sidePanel.locator('#app-subtitle')).toHaveText('网页划词翻译');
    await expect(sidePanel.locator('#source-kind-label')).toHaveText('当前网页');
    await expect(sidePanel.locator('#source-label')).toHaveText('www.overleaf.com');
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    await expect(sidePanel.locator('#open-pi-reader')).toHaveText('改用浮动侧栏');
    const webRegionAction = sidePanel.getByRole('button', { name: '框选网页', exact: true });
    await expect(webRegionAction).toBeVisible();
    expect(await webRegionAction.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(31);
    const storedModeAfterTemporaryOpen = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      return stored.extensionSettings?.sidebarMode;
    });
    expect(storedModeAfterTemporaryOpen).toBe('floating');
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-390-light.png'),
        fullPage: true,
      });
    }

    const requestsBeforeContinuousSelection = textRequests.length;
    await selectElementText('#multi-source');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeContinuousSelection);
    await expect(sidePanel.locator('#source-text')).toContainText('First important sentence');
    await expect(sidePanel.locator('#translation-text')).toContainText('第一句重要译文');

    const translationView = sidePanel.getByRole('group', { name: '译文显示方式' });
    const fullView = sidePanel.getByRole('button', { name: '显示完整译文' });
    const alignedView = sidePanel.getByRole('button', { name: '显示逐句对照' });
    await expect(translationView).toBeVisible();
    await expect(fullView).toHaveAttribute('aria-pressed', 'true');
    const requestsBeforeViewSwitch = textRequests.length;
    await alignedView.focus();
    await alignedView.press('Enter');
    await expect(alignedView).toBeFocused();
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    const alignedSegments = sidePanel.locator('.aligned-segment');
    await expect(alignedSegments).toHaveCount(2);
    await expect(alignedSegments.first().locator('.aligned-segment-source'))
      .toHaveText('First important sentence.');
    await expect(alignedSegments.first().locator('.aligned-segment-target'))
      .toContainText('第一句重要译文');
    await fullView.focus();
    await fullView.press('Enter');
    await expect(fullView).toBeFocused();
    await expect(fullView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeVisible();
    await expect(alignedSegments).toHaveCount(0);
    await alignedView.focus();
    await alignedView.press('Enter');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    await expect(alignedSegments).toHaveCount(2);
    expect(textRequests).toHaveLength(requestsBeforeViewSwitch);

    await sidePanel.setViewportSize({ width: 300, height: 720 });
    const alignedLayout = await sidePanel.locator('#translation-text').evaluate((result) => {
      const first = result.querySelector<HTMLElement>('.aligned-segment')!;
      const controls = [...document.querySelectorAll<HTMLElement>('#translation-view-switch button')];
      const header = document.querySelector<HTMLElement>('.app-header')!;
      const regionAction = document.querySelector<HTMLElement>('#start-web-region')!;
      return {
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        headerClientWidth: header.clientWidth,
        headerScrollWidth: header.scrollWidth,
        regionActionHeight: regionAction.getBoundingClientRect().height,
        resultClientWidth: result.clientWidth,
        resultScrollWidth: result.scrollWidth,
        segmentClientWidth: first.clientWidth,
        segmentScrollWidth: first.scrollWidth,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(alignedLayout.pageScrollWidth).toBeLessThanOrEqual(alignedLayout.pageClientWidth + 1);
    expect(alignedLayout.headerScrollWidth).toBeLessThanOrEqual(alignedLayout.headerClientWidth + 1);
    expect(alignedLayout.regionActionHeight).toBeGreaterThanOrEqual(31);
    expect(alignedLayout.resultScrollWidth).toBeLessThanOrEqual(alignedLayout.resultClientWidth + 1);
    expect(alignedLayout.segmentScrollWidth).toBeLessThanOrEqual(alignedLayout.segmentClientWidth + 1);
    expect(alignedLayout.controlHeights.every((height) => height >= 28)).toBe(true);
    await sidePanel.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => alignedSegments.first().evaluate((segment) => ({
      source: getComputedStyle(segment.querySelector<HTMLElement>('.aligned-segment-source')!).color,
      target: getComputedStyle(segment.querySelector<HTMLElement>('.aligned-segment-target')!).color,
    }))).toEqual({ source: 'rgb(167, 176, 191)', target: 'rgb(241, 244, 248)' });
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-aligned-300-dark.png'),
        fullPage: true,
      });
    }
    await sidePanel.emulateMedia({ colorScheme: 'light' });
    await sidePanel.setViewportSize({ width: 390, height: 760 });

    const browserHistory = sidePanel.locator('#web-history-navigation');
    const browserHistoryCounter = sidePanel.locator('#web-history-counter');
    const olderTranslation = sidePanel.getByRole('button', { name: '上一条译文' });
    const newerTranslation = sidePanel.getByRole('button', { name: '下一条译文' });
    await expect(browserHistory).toBeVisible();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [2-5]$/u);
    await expect(olderTranslation).toBeEnabled();
    await expect(newerTranslation).toBeDisabled();
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-history-390-light.png'),
        fullPage: true,
      });
    }
    const requestsBeforeHistoryNavigation = textRequests.length;
    await olderTranslation.click();
    await expect(browserHistoryCounter).toHaveText(/^2 \/ [2-5]$/u);
    await expect(sidePanel.locator('#source-text')).toContainText(
      'A consistent academic translation',
    );
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(1);
    expect(textRequests).toHaveLength(requestsBeforeHistoryNavigation);
    await newerTranslation.click();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [2-5]$/u);
    await expect(sidePanel.locator('#translation-text')).toContainText('第一句重要译文');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(2);

    await olderTranslation.click();
    await selectElementText('#browser-history-source');
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(alignedSegments).toHaveCount(1);
    await expect(browserHistory).toBeVisible();
    await expect(browserHistoryCounter).toHaveText(/^1 \/ [3-5]$/u);
    await expect(newerTranslation).toBeDisabled();

    const requestsBeforeCorrectionOpen = textRequests.length;
    await sidePanel.locator('#correct').click();
    await expect(sidePanel.getByRole('group', { name: '修正译文，公式已锁定' })).toBeVisible();
    await expect(translationView).toBeHidden();
    await expect(sidePanel.locator('#source-section')).toBeVisible();
    await sidePanel.getByRole('button', { name: '取消', exact: true }).click();
    await expect(alignedView).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('#source-section')).toBeHidden();
    expect(textRequests).toHaveLength(requestsBeforeCorrectionOpen);

    await sidePanel.setViewportSize({ width: 300, height: 420 });
    originalSentenceAlignmentDefault = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      const previous = stored.extensionSettings?.sentenceAlignmentDefault === true;
      await extensionChrome.storage.local.set({
        extensionSettings: {
          ...(stored.extensionSettings ?? {}),
          sentenceAlignmentDefault: true,
        },
      });
      return previous;
    });
    await sidePanel.locator('#open-pi-reader').evaluate((button: HTMLButtonElement) => button.click());
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '在浏览器侧栏中显示' }).click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    const requestsBeforeLongResult = textRequests.length;
    await selectElementText('#browser-long-source');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeLongResult);
    await expect(sidePanel.locator('#source-text')).toContainText('A long browser side panel result');
    await expect(sidePanel.locator('#translation-text')).toContainText('只有确实超出一屏的结果');
    await expect(translationView).toBeVisible();
    const readingNavigation = sidePanel.getByRole('group', { name: '长译文阅读导航' });
    const readingProgress = sidePanel.locator('#reading-progress');
    const readingTop = sidePanel.getByRole('button', { name: '回到译文顶部' });
    const readingBottom = sidePanel.getByRole('button', { name: '前往译文底部' });
    await expect(readingNavigation).toBeVisible();
    await expect(readingProgress).toHaveText('顶部');
    await expect(readingTop).toBeDisabled();
    await expect(readingBottom).toBeEnabled();
    const newResultStart = await sidePanel.locator('#result-section').evaluate((result) => ({
      resultTop: result.getBoundingClientRect().top,
      headerBottom: document.querySelector<HTMLElement>('.app-header')!.getBoundingClientRect().bottom,
      historyHeight: document.querySelector<HTMLElement>('#web-history-navigation')!
        .getBoundingClientRect().height,
    }));
    expect(Math.abs(
      newResultStart.resultTop
      - newResultStart.headerBottom
      - newResultStart.historyHeight
      - 8,
    )).toBeLessThanOrEqual(1);
    if (process.env.PI_VISUAL_ARTIFACTS === '1') {
      await sidePanel.screenshot({
        path: testInfo.outputPath('web-browser-sidebar-reading-300-light.png'),
      });
    }

    const requestsBeforeReadingNavigation = textRequests.length;
    await readingBottom.click();
    await expect(readingProgress).toHaveText('底部');
    await expect(readingBottom).toBeDisabled();
    const longResultBottom = await sidePanel.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(longResultBottom).toBeGreaterThan(0);
    const stickyHistoryPosition = await browserHistory.evaluate((history) => ({
      historyTop: history.getBoundingClientRect().top,
      headerBottom: document.querySelector<HTMLElement>('.app-header')!.getBoundingClientRect().bottom,
    }));
    expect(Math.abs(stickyHistoryPosition.historyTop - stickyHistoryPosition.headerBottom))
      .toBeLessThanOrEqual(1);

    await olderTranslation.click();
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(readingNavigation).toBeHidden();
    await newerTranslation.click();
    await expect(sidePanel.locator('#source-text')).toContainText('A long browser side panel result');
    await expect(readingNavigation).toBeVisible();
    await expect(readingProgress).toHaveText('底部');
    await expect.poll(() => sidePanel.evaluate(
      () => document.scrollingElement?.scrollTop ?? 0,
    )).toBeGreaterThanOrEqual(longResultBottom - 2);

    await fullView.evaluate((button: HTMLButtonElement) => button.click());
    await expect(readingProgress).toHaveText('底部');
    const formulaView = sidePanel.locator('#formula-view');
    await expect(formulaView).toHaveText('源码');
    await formulaView.evaluate((button: HTMLButtonElement) => button.click());
    await expect(formulaView).toHaveText('公式');
    await expect(readingProgress).toHaveText('底部');
    await alignedView.evaluate((button: HTMLButtonElement) => button.click());
    await expect(readingProgress).toHaveText('底部');
    expect(textRequests).toHaveLength(requestsBeforeReadingNavigation);

    await readingTop.focus();
    await readingTop.press('Home');
    await expect(readingProgress).toHaveText('顶部');
    await expect(readingBottom).toBeFocused();
    await readingBottom.press('End');
    await expect(readingProgress).toHaveText('底部');
    await expect(readingTop).toBeFocused();
    const requestsBeforeCleanupSelection = textRequests.length;
    await selectElementText('#source');
    await expect(sidePanel.locator('#source-text')).toContainText(
      'A consistent academic translation',
    );
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    expect(textRequests.length - requestsBeforeCleanupSelection).toBeLessThanOrEqual(1);
    await sidePanel.setViewportSize({ width: 390, height: 760 });

    await sidePanel.locator('#open-pi-reader').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    const options = await context.newPage();
    try {
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#sidebar-mode')).toHaveValue('floating');
    } finally {
      await options.close();
    }
  } finally {
    await page.bringToFront();
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
    if (originalSentenceAlignmentDefault !== undefined && !sidePanel.isClosed()) {
      await sidePanel.evaluate(async (enabled) => {
        const extensionChrome = (
          globalThis as typeof globalThis & { chrome: TestChromeApi }
        ).chrome;
        const stored = await extensionChrome.storage.local.get('extensionSettings');
        await extensionChrome.storage.local.set({
          extensionSettings: {
            ...(stored.extensionSettings ?? {}),
            sentenceAlignmentDefault: enabled,
          },
        });
      }, originalSentenceAlignmentDefault).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    await closeVisibleTranslationSurfaceForCleanup();
    await clearBrowserSelection();
    await page.reload();
    await sidePanel.close();
  }
});

test('uses the preferred browser side panel from the result primary action', async () => {
  const sidePanel = await context.newPage();
  const overlay = page.locator('#tex-selection-translator-root');
  let browserSidebarOpened = false;
  try {
    await setStoredSidebarMode('browser');
    const options = await context.newPage();
    try {
      await options.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(options.locator('#sidebar-mode')).toHaveValue('browser');
    } finally {
      await options.close();
    }
    const popup = await context.newPage();
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await expect(popup.locator('#open-sidebar')).toHaveText('在浏览器侧栏中翻译');
    } finally {
      await popup.close();
    }
    await page.bringToFront();
    await selectElementText('#browser-history-source');
    await overlay.locator('.trigger').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');

    const primaryAction = overlay.getByRole('button', { name: '在浏览器侧栏中显示' });
    await expect(primaryAction).toBeVisible();
    await overlay.locator('details.more > summary').click();
    await expect(overlay.getByRole('button', { name: '在页面侧栏中显示' })).toBeVisible();
    await expect(overlay.locator('.menu').getByRole('button', { name: '在浏览器侧栏中显示' }))
      .toHaveCount(0);
    await overlay.locator('details.more > summary').click();

    const requestsBeforeOpen = textRequests.length;
    await primaryAction.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'hidden');
    expect(textRequests).toHaveLength(requestsBeforeOpen);

    await sidePanel.setViewportSize({ width: 390, height: 720 });
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.bringToFront();
    await expect(sidePanel.locator('#session')).toBeVisible();
    browserSidebarOpened = true;
    await expect(sidePanel.locator('#source-text')).toContainText('A browser side panel');
    await expect(sidePanel.locator('#translation-text')).toContainText('一致的学术翻译');
    const storedMode = await sidePanel.evaluate(async () => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      return stored.extensionSettings?.sidebarMode;
    });
    expect(storedMode).toBe('browser');
  } finally {
    if (browserSidebarOpened && !sidePanel.isClosed()) {
      await sidePanel.locator('#open-pi-reader').click();
      await page.bringToFront();
      await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    }
    await sidePanel.close();
    await setStoredSidebarMode('floating');
    await page.bringToFront();
    if (await overlay.locator('.surface-close').count()) {
      await overlay.locator('.surface-close').click();
    }
    await clearBrowserSelection();
  }
});

test('keeps narrow sidebar history navigation bounded and recoverable', async ({}, testInfo) => {
  const historyPage = await context.newPage();
  const historyFixtureUrl = `${OVERLEAF_FIXTURE_URL}?history-navigation=1`;
  try {
    await historyPage.setViewportSize({ width: 360, height: 700 });
    await historyPage.route(historyFixtureUrl, async (route) => {
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>
          <p id="history-one">A consistent academic translation improves the readability of research papers.</p>
          <p id="history-two">First important sentence. Second supporting sentence.</p>
          <p id="history-three">The adaptive sensing policy is stable in this document.</p>
        </body></html>`,
      });
    });
    await historyPage.goto(historyFixtureUrl);
    const selectText = async (selector: string): Promise<void> => {
      await historyPage.locator(selector).evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
    };
    const overlay = historyPage.locator('#tex-selection-translator-root');
    await selectText('#history-one');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await selectText('#history-two');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await selectText('#history-three');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');

    const counter = overlay.locator('.history-counter');
    const older = overlay.getByTitle('上一条翻译（Alt+↑）');
    const newer = overlay.getByTitle('下一条翻译（Alt+↓）');
    await expect(counter).toHaveText('1/3');
    await expect(counter).toHaveAttribute('aria-label', '第 1 条，共 3 条');
    await expect(older).toBeEnabled();
    await expect(newer).toBeDisabled();
    const navigationLayout = await overlay.locator('.surface').evaluate((surface) => {
      const tools = surface.querySelector<HTMLElement>('.header-tools')!;
      const surfaceBounds = surface.getBoundingClientRect();
      const toolsBounds = tools.getBoundingClientRect();
      const controls = [...tools.querySelectorAll<HTMLElement>('button')];
      return {
        surfaceLeft: surfaceBounds.left,
        surfaceRight: surfaceBounds.right,
        scrollWidth: surface.scrollWidth,
        clientWidth: surface.clientWidth,
        toolsLeft: toolsBounds.left,
        toolsRight: toolsBounds.right,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
      };
    });
    expect(navigationLayout.surfaceLeft).toBeGreaterThanOrEqual(8);
    expect(navigationLayout.surfaceRight).toBeLessThanOrEqual(352);
    expect(navigationLayout.scrollWidth).toBeLessThanOrEqual(navigationLayout.clientWidth + 1);
    expect(navigationLayout.toolsLeft).toBeGreaterThanOrEqual(navigationLayout.surfaceLeft);
    expect(navigationLayout.toolsRight).toBeLessThanOrEqual(navigationLayout.surfaceRight);
    expect(navigationLayout.controlHeights.every((height) => height >= 32)).toBe(true);

    await expect(counter).toHaveAttribute('title', '查看和搜索翻译历史（Alt+/）');
    await counter.click();
    const historySearch = overlay.getByRole('searchbox', { name: '搜索翻译历史' });
    const historySummary = overlay.locator('.history-summary');
    const historyItems = overlay.locator('.history-item');
    await expect(overlay.locator('.history-surface')).toBeVisible();
    await expect(historySearch).toBeFocused();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await expect(historyItems).toHaveCount(3);
    await expect(historyItems.first()).toHaveAttribute('aria-current', 'true');
    const historySearchLayout = await overlay.locator('.history-surface').evaluate((surface) => {
      const input = surface.querySelector<HTMLInputElement>('.history-search-field')!;
      const list = surface.querySelector<HTMLElement>('.history-list')!;
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        inputHeight: input.getBoundingClientRect().height,
        listHeight: list.getBoundingClientRect().height,
      };
    });
    expect(historySearchLayout.scrollWidth).toBeLessThanOrEqual(historySearchLayout.clientWidth + 1);
    expect(historySearchLayout.inputHeight).toBeGreaterThanOrEqual(32);
    expect(historySearchLayout.listHeight).toBeGreaterThan(120);
    if (process.env.PI_VISUAL_QA) {
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-history-search-360-light.png') });
      await historyPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-history-search-360-dark.png') });
      await historyPage.emulateMedia({ colorScheme: 'light' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'light');
    }

    await historySearch.fill('supporting');
    await expect(historySummary).toHaveText('1 条匹配');
    await expect(historyItems).toHaveCount(1);
    await expect(historyItems.first()).toContainText('Second supporting sentence');
    await historySearch.press('ArrowDown');
    await expect(historyItems.first()).toBeFocused();
    await historyItems.first().press('Enter');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await expect(counter).toHaveText('2/3');
    await expect(counter).toBeFocused();

    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await expect(historySearch).toHaveValue('supporting');
    await overlay.getByRole('button', { name: '清空历史搜索' }).click();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await historySearch.fill('not-in-history');
    await expect(historySummary).toHaveText('0 条匹配');
    await expect(overlay.locator('.history-empty')).toContainText('没有匹配的历史翻译');
    await overlay.getByRole('button', { name: '清除搜索和标记筛选' }).click();
    await expect(historySearch).toHaveValue('');
    await expect(historyItems).toHaveCount(3);
    await historySearch.press('ArrowDown');
    await expect(historyItems.first()).toBeFocused();
    await historyItems.first().press('ArrowDown');
    await expect(historyItems.nth(1)).toBeFocused();
    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await historyItems.first().click();
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');
    await expect(counter).toHaveText('1/3');
    await historyPage.keyboard.press('Alt+/');
    await expect(historySearch).toBeFocused();
    await historyPage.keyboard.press('Escape');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');
    await expect(counter).toBeFocused();

    await overlay.getByTitle('收起侧栏').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar-collapsed');
    await overlay.getByTitle('展开 Pi Translator 连续翻译侧栏').click();
    await expect(counter).toHaveText('1/3');
    await expect(overlay.locator('.body')).toContainText('一致的技术术语与推理边界');

    await overlay.getByTitle('查看本文术语和最近翻译').click();
    await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
    await overlay.getByTitle('返回翻译结果').click();
    await expect(counter).toHaveText('1/3');

    await older.focus();
    await older.click();
    await expect(counter).toHaveText('2/3');
    await expect(overlay.locator('.body')).toContainText('第一句重要译文');
    await expect(older).toBeFocused();
    await older.click();
    await expect(counter).toHaveText('3/3');
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    await expect(older).toBeDisabled();
    await expect(newer).toBeFocused();
    await newer.click();
    await expect(counter).toHaveText('2/3');
    await expect(newer).toBeFocused();
    await newer.click();
    await expect(counter).toHaveText('1/3');
    await expect(newer).toBeDisabled();
    await expect(older).toBeFocused();

    await historyPage.keyboard.press('Alt+ArrowUp');
    await expect(counter).toHaveText('2/3');
    await expect(older).toBeFocused();

    await historyPage.keyboard.press('Alt+ArrowDown');
    await expect(counter).toHaveText('1/3');
    await overlay.locator('.mark-action').click();
    await expect(overlay.locator('.mark-filter')).toBeVisible();
    await counter.click();
    const markedHistoryFilter = overlay.getByRole('button', { name: '仅显示已标记翻译' });
    await expect(markedHistoryFilter).toBeVisible();
    await markedHistoryFilter.click();
    await expect(historySummary).toHaveText('1 条匹配');
    await expect(historyItems).toHaveCount(1);
    await expect(historyItems.first()).toHaveAttribute('aria-current', 'true');
    await markedHistoryFilter.click();
    await expect(historySummary).toHaveText('3 条历史翻译');
    await historyPage.keyboard.press('Escape');
    await overlay.getByRole('button', { name: '修正译文' }).click();
    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await editor.fill('窄屏多控件组合下仍然清晰可读的用户修订译文。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('.history-counter')).toHaveText('1/3');
    await expect(overlay.locator('.version-counter')).toHaveText('v1/2');
    await expect(overlay.getByRole('group', { name: '翻译历史导航' })).toBeVisible();
    await expect(overlay.getByRole('group', { name: '译文版本导航' })).toBeVisible();
    await expect(overlay.locator('.mark-filter')).toBeVisible();
    await expect(overlay.locator('.document-memory-action')).toBeVisible();
    const denseLayout = await overlay.locator('.surface').evaluate((surface) => {
      const header = surface.querySelector<HTMLElement>('.header')!;
      const tools = surface.querySelector<HTMLElement>('.header-tools')!;
      const title = surface.querySelector<HTMLElement>('.title-wrap')!;
      const surfaceBounds = surface.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const toolsBounds = tools.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      return {
        clientWidth: surface.clientWidth,
        scrollWidth: surface.scrollWidth,
        surfaceRight: surfaceBounds.right,
        headerHeight: headerBounds.height,
        toolsRight: toolsBounds.right,
        titleVisible: titleBounds.width > 0 && titleBounds.height > 0,
        historyTop: tools.querySelector<HTMLElement>('.history-navigation')
          ?.getBoundingClientRect().top,
        versionTop: tools.querySelector<HTMLElement>('.version-navigation')
          ?.getBoundingClientRect().top,
      };
    });
    expect(denseLayout.scrollWidth).toBeLessThanOrEqual(denseLayout.clientWidth + 1);
    expect(denseLayout.toolsRight).toBeLessThanOrEqual(denseLayout.surfaceRight);
    expect(denseLayout.headerHeight).toBeLessThanOrEqual(70);
    expect(denseLayout.titleVisible).toBe(false);
    expect(denseLayout.versionTop).toBeGreaterThan(denseLayout.historyTop ?? 0);
    const footer = overlay.locator('.footer');
    const undo = overlay.getByRole('button', { name: '撤销上次译文修正' });
    const mark = overlay.locator('.mark-action');
    const more = overlay.locator('details.more > summary');
    await expect(undo).toBeFocused();
    const footerLayout = await footer.evaluate((element) => {
      const controls = [...element.querySelectorAll<HTMLElement>(
        ':scope > button,:scope > .correction-undo > button,:scope > details.more > summary',
      )];
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        controlHeights: controls.map((control) => control.getBoundingClientRect().height),
        controlTops: controls.map((control) => Math.round(control.getBoundingClientRect().top)),
      };
    });
    expect(footerLayout.scrollWidth).toBeLessThanOrEqual(footerLayout.clientWidth + 1);
    expect(footerLayout.controlHeights.every((height) => height >= 32)).toBe(true);
    expect(new Set(footerLayout.controlTops).size).toBe(1);
    await historyPage.keyboard.press('Tab');
    await expect(mark).toBeFocused();
    await historyPage.keyboard.press('Tab');
    await expect(more).toBeFocused();
    const copy = overlay.locator('.copy-action');
    await copy.click();
    await expect(copy).toHaveText('已复制');
    await expect(copy).toBeFocused();
    if (process.env.PI_VISUAL_QA) {
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-dense-navigation-360-light.png') });
      await historyPage.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await historyPage.screenshot({ path: testInfo.outputPath('sidebar-dense-navigation-360-dark.png') });
    }

    const worker = context.serviceWorkers()[0]!;
    const replacedHead = await worker.evaluate(async (pageUrl) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          tabs: { query(query: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
      if (tab?.id === undefined) throw new Error('Could not find the narrow history test tab.');
      const key = `translationResultHead:${tab.id}`;
      const original = (await api.storage.session.get(key))[key] as Record<string, unknown> | undefined;
      if (!original) throw new Error('The narrow history test tab has no result head.');
      await api.storage.session.set({
        [key]: { ...original, currentResultRequestId: 'synthetic-newer-result' },
      });
      return { key, original };
    }, historyFixtureUrl);
    const undoStatus = overlay.locator('.correction-undo');
    try {
      await undo.click();
      await expect(undoStatus).toHaveAttribute('role', 'alert');
      await expect(undoStatus).toHaveClass(/is-error/);
      await expect(undo).toBeEnabled();
      await expect(undo).toHaveText('重试');
      await expect(undo).toBeFocused();
      const undoFailure = '模拟撤销失败：当前译文版本已经在另一处发生变化，请重新检查后再试。ExtremelyLongUndoFailureIdentifierWithoutNaturalBreakpoints';
      await undoStatus.locator('.correction-undo-message').evaluate((element, message) => {
        element.textContent = message;
      }, undoFailure);
      const failureLayout = await footer.evaluate((element) => {
        const footerBounds = element.getBoundingClientRect();
        const copyBounds = element.querySelector<HTMLElement>('.copy-action')!.getBoundingClientRect();
        const statusBounds = element.querySelector<HTMLElement>('.correction-undo')!.getBoundingClientRect();
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          statusInside: statusBounds.left >= footerBounds.left && statusBounds.right <= footerBounds.right,
          statusBelowActions: statusBounds.top > copyBounds.top,
        };
      });
      expect(failureLayout.scrollWidth).toBeLessThanOrEqual(failureLayout.clientWidth + 1);
      expect(failureLayout.statusInside).toBe(true);
      expect(failureLayout.statusBelowActions).toBe(true);
      if (process.env.PI_VISUAL_QA) {
        await historyPage.screenshot({ path: testInfo.outputPath('sidebar-undo-failure-360-dark.png') });
      }
    } finally {
      await worker.evaluate(async ({ key, original }) => {
        const api = (globalThis as typeof globalThis & {
          chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
        }).chrome;
        await api.storage.session.set({ [key]: original });
      }, replacedHead);
    }
    await undo.click();
    await expect(undoStatus).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: '修正译文' })).toBeFocused();
  } finally {
    await historyPage.close();
  }
});

test('keeps document terminology behind a compact sidebar drawer', async () => {
  const initialRequests = textRequests.length;
  await page.locator('#term-source').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const overlay = page.locator('#tex-selection-translator-root');
  await expect.poll(async () => ['trigger', 'card', 'sidebar'].includes(
    await overlay.getAttribute('data-pi-view') ?? '',
  )).toBe(true);
  if (await overlay.getAttribute('data-pi-view') === 'trigger') {
    await overlay.locator('.trigger').click();
  }
  if (await overlay.getAttribute('data-pi-view') !== 'sidebar') {
    const pin = overlay.getByTitle('在页面侧栏中显示');
    await expect(pin).toBeVisible();
    await pin.click();
  }
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  await expect(overlay.locator('.body')).toContainText('自适应感知策略');
  await expect(overlay.getByTitle('查看本文术语和最近翻译')).toHaveText('本文');
  await overlay.getByTitle('查看本文术语和最近翻译').click();
  await expect(overlay.locator('.document-meta')).toContainText('仅保存在本机');
  await expect(overlay.locator('.document-section').filter({ hasText: '待确认术语' }))
    .toBeVisible();
  await expect(overlay.locator('.document-row').filter({ hasText: 'adaptive sensing' })).toBeVisible();
  const candidateRow = overlay.locator('.document-row').filter({ hasText: 'adaptive sensing' });
  await candidateRow.getByText('修改').click();
  const candidateEditor = candidateRow.getByLabel('修改 adaptive sensing 的候选译法');
  await expect(candidateEditor).toBeFocused();
  await candidateEditor.press('Escape');
  await expect(candidateRow.getByTitle('修改候选译法后采用')).toBeFocused();
  await candidateRow.getByText('修改').click();
  await candidateRow.getByLabel('修改 adaptive sensing 的候选译法').fill('自适应感知策略');
  await candidateRow.getByTitle('保存修改并采用').click();
  await expect(overlay.locator('.document-section').filter({ hasText: '固定译法' }))
    .toContainText('自适应感知策略');
  await overlay.getByTitle('返回翻译结果').click();

  await page.locator('#term-followup').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect.poll(() => textRequests.length).toBeGreaterThan(initialRequests + 1);
  const latestRequest = textRequests.at(-1);
  expect(JSON.stringify(latestRequest)).toContain('adaptive sensing');
  expect(JSON.stringify(latestRequest)).toContain('自适应感知策略');
  await expect(overlay.locator('.body')).toContainText('自适应感知策略');
  const appliedTerms = overlay.locator('details.applied-terms');
  await expect(appliedTerms.locator(':scope > summary')).toContainText('已采用术语 1');
  await expect(appliedTerms.locator(':scope > summary')).toContainText('本文 1');
  await appliedTerms.locator(':scope > summary').click();
  const appliedRow = appliedTerms.locator('.applied-term-row');
  await expect(appliedRow).toContainText('adaptive sensing');
  await expect(appliedRow).toContainText('自适应感知策略');
  await expect(appliedRow.locator('.applied-term-scope')).toHaveText('本文');
  await appliedRow.getByTitle('调整本文术语 adaptive sensing').click();
  const focusedTerm = overlay.getByRole('textbox', { name: '固定译法' });
  await expect(focusedTerm).toBeFocused();
  await expect(focusedTerm).toHaveValue('自适应感知策略');
  await overlay.getByTitle('取消编辑本文术语').click();
  await overlay.getByTitle('返回翻译结果').click();
  await overlay.getByTitle('查看本文术语和最近翻译').click();
  await expect.poll(() => overlay.locator('.document-translation').count()).toBeGreaterThanOrEqual(2);
  await overlay.getByTitle('返回翻译结果').click();
});

test('shows verified global terminology and opens its exact settings area', async ({}, testInfo) => {
  const worker = context.serviceWorkers()[0]!;
  const originalGlossary = await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: TestChromeStorageArea } };
    }).chrome;
    const stored = await api.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings ?? {};
    const glossary = Array.isArray(settings.academicGlossary)
      ? settings.academicGlossary as Array<{ source: string; target: string }>
      : [];
    await api.storage.local.set({
      extensionSettings: {
        ...settings,
        academicGlossary: [
          { source: 'consistent academic translation', target: '一致的学术翻译' },
          ...glossary.filter((term) => term.source !== 'consistent academic translation'),
        ],
      },
    });
    return glossary;
  });
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  let options: Page | undefined;
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    const returnToResult = overlay.getByTitle('返回翻译结果');
    if (await returnToResult.isVisible().catch(() => false)) await returnToResult.click();
    await clearBrowserSelection();
    const close = overlay.getByTitle('关闭');
    if (await close.isVisible().catch(() => false)) await close.click();
    await selectElementText('#global-term-source');
    await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
    await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
    const appliedTerms = overlay.locator('details.applied-terms');
    await expect(appliedTerms.locator(':scope > summary')).toContainText('已采用术语 1');
    await expect(appliedTerms.locator(':scope > summary')).toContainText('全局 1');
    await appliedTerms.locator(':scope > summary').click();
    const row = appliedTerms.locator('.applied-term-row');
    await expect(row).toContainText('consistent academic translation');
    await expect(row).toContainText('一致的学术翻译');
    const layout = await appliedTerms.evaluate((element) => {
      const action = element.querySelector<HTMLElement>('.applied-term-edit')!;
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        actionHeight: action.getBoundingClientRect().height,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('applied-terms-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('applied-terms-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const opened = context.waitForEvent('page');
    await row.getByTitle('在设置中调整全局术语 consistent academic translation').click();
    options = await opened;
    await options.waitForLoadState('domcontentloaded');
    await expect(options).toHaveURL(/focus=glossary#translation$/);
    await expect(options.locator('details').filter({ has: options.locator('#academic-glossary') }))
      .toHaveAttribute('open', '');
    await expect(options.locator('#academic-glossary')).toBeFocused();
    await expect(options.locator('#academic-glossary')).toHaveValue(
      /consistent academic translation = 一致的学术翻译/,
    );
    await options.close();
    options = undefined;
    await overlay.getByRole('button', { name: '修正译文' }).click();
    await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' })
      .fill('这是一条不沿用当前固定术语的手动译文。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('details.applied-terms')).toHaveCount(0);
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('details.applied-terms > summary'))
      .toContainText('已采用术语 1');
    await overlay.getByTitle('在页面侧栏中显示').click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
  } finally {
    await options?.close();
    await worker.evaluate(async (glossary) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: TestChromeStorageArea } };
      }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), academicGlossary: glossary },
      });
    }, originalGlossary);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(originalViewport);
    await clearBrowserSelection();
  }
});

test('keeps missing configured terminology as a quiet local review', async ({}, testInfo) => {
  const worker = context.serviceWorkers()[0]!;
  const originalGlossary = await worker.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      chrome: { storage: { local: TestChromeStorageArea } };
    }).chrome;
    const stored = await api.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings ?? {};
    const glossary = Array.isArray(settings.academicGlossary)
      ? settings.academicGlossary as Array<{ source: string; target: string }>
      : [];
    await api.storage.local.set({
      extensionSettings: {
        ...settings,
        academicGlossary: [
          { source: 'technical term', target: '固定技术译法' },
          ...glossary.filter((term) => term.source !== 'technical term'),
        ],
      },
    });
    return glossary;
  });
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const overlay = page.locator('#tex-selection-translator-root');
  try {
    await page.setViewportSize({ width: 360, height: 700 });
    await clearBrowserSelection();
    const close = overlay.getByTitle('关闭');
    if (await close.isVisible().catch(() => false)) await close.click();
    const requestsBeforeTranslation = textRequests.length;
    await selectElementText('#term-review-source');
    await expect.poll(async () => ['trigger', 'card', 'sidebar'].includes(
      await overlay.getAttribute('data-pi-view') ?? '',
    )).toBe(true);
    if (await overlay.getAttribute('data-pi-view') === 'trigger') {
      await overlay.locator('.trigger').click();
    }
    if (await overlay.getAttribute('data-pi-view') !== 'sidebar') {
      await overlay.getByTitle('在页面侧栏中显示').click();
    }
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
    await expect.poll(() => textRequests.length).toBeGreaterThan(requestsBeforeTranslation);
    await expect(overlay.locator('.body')).toContainText('这种技术表达应保持稳定');
    const review = overlay.locator('details.glossary-review');
    await expect(review.locator(':scope > summary')).toContainText('术语待核对 1');
    await expect(review.locator(':scope > summary')).toContainText('全局 1');
    await expect(review).not.toHaveAttribute('open', '');
    await review.locator(':scope > summary').click();
    await expect(review.locator('.glossary-review-intro')).toContainText('同义表达也可能触发');
    const row = review.locator('.glossary-review-row');
    await expect(row).toContainText('technical term');
    await expect(row).toContainText('固定技术译法');
    const layout = await review.evaluate((element) => {
      const buttons = [...element.querySelectorAll<HTMLElement>('.applied-term-edit')];
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.buttonHeights.every((height) => height >= 32)).toBe(true);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('glossary-review-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('glossary-review-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }

    const documentButton = overlay.locator('.document-memory-action');
    await expect(documentButton).toHaveText('本文 · 待核对 1');
    await expect(documentButton).toHaveAttribute('title', '有 1 个术语待核对');
    await documentButton.click();
    const documentReview = overlay.locator('.document-term-review-section');
    await expect(documentReview.locator('.document-section-head')).toContainText('术语待核对1');
    await expect(documentReview.locator('.document-term-review-intro'))
      .toContainText('同义表达也可能触发');
    const documentReviewRow = documentReview.locator('.document-term-review-row');
    await expect(documentReviewRow).toContainText('technical term');
    await expect(documentReviewRow).toContainText('固定技术译法');
    await expect(documentReviewRow).toContainText('全局');
    const documentLayout = await documentReviewRow.evaluate((element) => {
      const pairs = element.querySelector<HTMLElement>('.document-term-review-pairs');
      const button = element.querySelector<HTMLElement>('.document-review-actions button');
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        pairsClientWidth: pairs?.clientWidth ?? 0,
        pairsScrollWidth: pairs?.scrollWidth ?? 0,
        buttonHeight: button?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(documentLayout.scrollWidth).toBeLessThanOrEqual(documentLayout.clientWidth + 1);
    expect(documentLayout.pairsScrollWidth)
      .toBeLessThanOrEqual(documentLayout.pairsClientWidth + 1);
    expect(documentLayout.buttonHeight).toBeGreaterThanOrEqual(32);
    if (process.env.PI_VISUAL_QA) {
      await page.screenshot({ path: testInfo.outputPath('document-term-review-360-light.png') });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(overlay).toHaveAttribute('data-pi-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath('document-term-review-360-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await documentReviewRow.getByRole('button', {
      name: '打开含 1 个待核对术语的译文',
    }).click();
    await expect(overlay.locator('.body')).toContainText('这种技术表达应保持稳定');
    await expect(review.locator(':scope > summary')).toContainText('术语待核对 1');
    await review.locator(':scope > summary').click();

    const requestsBeforeCorrection = textRequests.length;
    await row.getByTitle('本地修正术语 technical term').click();
    const editor = overlay.getByRole('textbox', { name: '可编辑译文第 1 段' });
    await expect(editor).toBeFocused();
    await expect(overlay.locator('.revision-note')).toContainText(
      '请核对“technical term”的译法，并在需要时调整为“固定技术译法”',
    );
    await expect.poll(() => textRequests.length).toBe(requestsBeforeCorrection);
    await editor.fill('固定技术译法应保持稳定。');
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('details.glossary-review')).toHaveCount(0);
    await expect(overlay.locator('details.applied-terms > summary')).toContainText('已采用术语 1');
    expect(textRequests).toHaveLength(requestsBeforeCorrection);
    await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
    await expect(overlay.locator('details.glossary-review > summary')).toContainText('术语待核对 1');
    expect(textRequests).toHaveLength(requestsBeforeCorrection);
  } finally {
    await worker.evaluate(async (glossary) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { local: TestChromeStorageArea } };
      }).chrome;
      const stored = await api.storage.local.get('extensionSettings');
      await api.storage.local.set({
        extensionSettings: { ...(stored.extensionSettings ?? {}), academicGlossary: glossary },
      });
    }, originalGlossary);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(originalViewport);
    await clearBrowserSelection();
  }
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

test('keeps advanced options collapsed until requested', async ({}, testInfo) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const onboarding = options.locator('#onboarding-dialog');
  await expect(onboarding).not.toBeVisible();
  await expect(options.locator('[data-settings-section="connection"]')).toBeVisible();
  await expect(options.locator('[data-settings-section="results"]')).not.toBeVisible();
  await expect(options.locator('.connection-step')).toHaveCount(3);
  await expect(options.locator('.connection-step').nth(0)).toContainText('服务商');
  await expect(options.locator('.connection-step').nth(1)).toContainText('API Key');
  await expect(options.locator('.connection-step').nth(2)).toContainText('连接并保存');
  await expect(options.locator('#connection-advanced #test-connection')).toHaveCount(1);
  await expect(options.locator('#vision-setup-guide')).not.toBeVisible();
  await options.locator('#vision-setup-details > summary').click();
  await expect(options.locator('#vision-setup-guide')).toBeVisible();
  await options.locator('#vision-setup-details > summary').click();
  const providerSelect = options.locator('#api-preset');
  await expect(providerSelect.locator('option').first()).toHaveAttribute('value', 'deepseek');
  await expect(providerSelect.locator('option').last()).toHaveAttribute('value', 'custom');
  await options.locator('#refresh-models').click();
  await expect(options.locator('#status')).toContainText('自动配置完成');
  await expect(options.locator('#status')).toContainText('已保存');
  await expect(options.locator('#save-state')).toContainText('所有设置已保存');
  await expect(options.locator('#save-button')).toBeDisabled();
  await expect(options.locator('#save-button')).toHaveText('已保存');
  await expect(options.locator('#model-list option')).toHaveCount(2);
  await expect(options.locator('#connection-summary')).toBeVisible();
  await expect(options.locator('#connection-text-status')).toContainText('e2e-model');
  const connectionTab = options.locator('[data-settings-target="connection"]');
  await connectionTab.focus();
  await connectionTab.press('ArrowRight');
  await expect(options.locator('[data-settings-section="translation"]')).toBeVisible();
  await expect(options.locator('[data-settings-target="translation"]')).toHaveAttribute(
    'tabindex',
    '0',
  );
  await options.locator('[data-settings-target="results"]').click();
  await expect(options.locator('[data-settings-section="results"]')).toBeVisible();
  await expect(options.locator('#auto-render-latex')).toBeChecked();
  const advanced = options.locator('details.advanced-panel');
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.locator('summary').click();
  await expect(options.locator('#context-mode')).toBeVisible();
  await expect(options.locator('#enable-streaming')).toBeVisible();
  await expect(options.locator('#protect-sensitive-fields')).toBeVisible();
  await expect(options.locator('#pdf-keyboard-shortcuts')).toBeChecked();
  await expect(options.locator('#pdf-region-shortcut-key')).toHaveValue('R');
  await options.locator('#pdf-keyboard-shortcuts').uncheck();
  await expect(options.locator('#pdf-region-shortcut-key')).toBeDisabled();
  await options.locator('#alignment-default').check();
  await expect(options.locator('#save-state')).toContainText('未保存');
  await expect(options.locator('#save-button')).toBeEnabled();
  await expect(options.locator('#save-button')).toHaveText('保存更改');
  await options.close();

  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 360, height: 620 });
  await reopened.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.locator('[data-settings-target="support"]').click();
  const support = reopened.locator('details.support-disclosure');
  await expect(support).not.toHaveAttribute('open', '');
  await support.locator('summary').click();
  await reopened.locator('#restart-onboarding').click();
  await expect(reopened.locator('#onboarding-dialog')).toBeVisible();
  const onboardingPreset = reopened.locator('#onboarding-preset');
  await expect(onboardingPreset).toBeFocused();
  await expect(onboardingPreset.locator('option')).toHaveCount(5);
  await expect(onboardingPreset.locator('option').first()).toHaveAttribute('value', 'deepseek');
  await expect(onboardingPreset.locator('option').last()).toHaveAttribute('value', 'custom');
  await expect(onboardingPreset.locator('option[value="custom"]')).toHaveText(
    '自定义 OpenAI 兼容 API',
  );
  await onboardingPreset.selectOption('deepseek');
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue(
    'https://api.deepseek.com',
  );
  await expect(reopened.locator('#onboarding-base-url-field')).toBeHidden();
  const onboardingProviderLayout = await reopened.locator('#onboarding-dialog')
    .evaluate((dialog) => {
      const actions = dialog.querySelector<HTMLElement>('.onboarding-actions')!;
      const next = dialog.querySelector<HTMLElement>('#onboarding-next')!;
      const dialogRect = dialog.getBoundingClientRect();
      return {
        dialogLeft: dialogRect.left,
        dialogRight: dialogRect.right,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        actionWidth: actions.clientWidth,
        nextWidth: next.getBoundingClientRect().width,
        overflowingElements: [dialog as HTMLElement, ...dialog.querySelectorAll<HTMLElement>('*')]
          .filter((element) => !element.hidden && element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            selector: element.id ? `#${element.id}` : element.className || element.tagName,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          })),
      };
    });
  expect(onboardingProviderLayout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(onboardingProviderLayout.dialogRight)
    .toBeLessThanOrEqual(onboardingProviderLayout.pageClientWidth + 1);
  expect(onboardingProviderLayout.pageScrollWidth)
    .toBeLessThanOrEqual(onboardingProviderLayout.pageClientWidth + 1);
  expect(onboardingProviderLayout.overflowingElements).toEqual([]);
  expect(onboardingProviderLayout.nextWidth)
    .toBeGreaterThanOrEqual(onboardingProviderLayout.actionWidth - 1);
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-provider-360-light.png') });
    await reopened.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => onboardingPreset.evaluate((select) => ({
      appearance: getComputedStyle(select).appearance,
      background: getComputedStyle(select).backgroundColor,
      color: getComputedStyle(select).color,
    }))).toEqual({
      appearance: 'none',
      background: 'rgb(23, 31, 44)',
      color: 'rgb(237, 242, 248)',
    });
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-provider-360-dark.png') });
    await reopened.emulateMedia({ colorScheme: 'light' });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-api-key')).toBeFocused();
  await expect(reopened.locator('#onboarding-back')).toBeVisible();
  await expect(reopened.locator('#onboarding-open-key-page')).toBeVisible();
  await expect(reopened.locator('#onboarding-open-key-page')).toHaveAttribute(
    'data-key-url',
    'https://platform.deepseek.com/api_keys',
  );
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-key-360-light.png') });
  }
  await reopened.locator('#onboarding-back').click();
  await expect(onboardingPreset).toBeFocused();
  await onboardingPreset.selectOption('custom');
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-api-key')).toBeFocused();
  await expect(reopened.locator('#onboarding-base-url-field')).toBeVisible();
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue('');
  await expect(reopened.locator('#onboarding-model')).toHaveValue('');
  await reopened.locator('#onboarding-api-key').fill('e2e-onboarding-key');
  await reopened.locator('#onboarding-base-url').fill(
    'https://www.overleaf.com/pi-translator-e2e-api',
  );
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-model')).toBeFocused();
  await expect(reopened.locator('#onboarding-model')).toHaveValue('e2e-model');
  await expect(reopened.locator('#onboarding-status')).toContainText('连接成功');
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-model-360-light.png') });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-success')).toBeVisible();
  await expect(reopened.locator('#onboarding-title')).toHaveText('Pi Translator 已就绪');
  await expect(reopened.locator('#onboarding-sample-source')).toHaveText(
    'Pi Translator makes multilingual reading easier.',
  );
  await expect(reopened.locator('#onboarding-sample-translation')).not.toBeEmpty();
  await expect(reopened.locator('.onboarding-paths > div')).toHaveCount(3);
  await expect(reopened.locator('#onboarding-next')).toHaveText('完成');
  if (process.env.PI_VISUAL_QA) {
    await reopened.screenshot({ path: testInfo.outputPath('onboarding-success-360-light.png') });
  }
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-dialog')).not.toBeVisible();
  await reopened.close();
});

test('automatically binds a visual-capable active API when settings are saved', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        activeApiProfileId: 'default',
        visionApiProfileId: '',
        visionModel: '',
      },
    });
  });
  await options.reload();
  await expect(options.locator('#vision-api-profile')).toHaveValue('');

  await options.locator('[data-settings-target="translation"]').click();
  await options.locator('#target-language').selectOption('ja');
  await expect(options.locator('#save-button')).toBeEnabled();
  await options.locator('button[type="submit"]').click();
  await expect(options.locator('#status')).toContainText(
    '已自动启用图像区域翻译',
  );
  await expect(options.locator('#vision-api-profile')).toHaveValue('default');
  await expect(options.locator('#vision-model')).toHaveValue('e2e-model');
  await expect.poll(() => options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return stored.extensionSettings?.visionApiProfileId;
  })).toBe('default');
  await options.close();
});

test('keeps the text API active while a second profile is configured for PDF images', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const profileIds = await options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    const settings = stored.extensionSettings as {
      apiProfiles: Array<{ id: string; name: string; apiBaseUrl: string; model: string }>;
    };
    const textProfile = settings.apiProfiles[0]!;
    const visionProfile = {
      ...textProfile,
      id: 'e2e-vision-profile',
      name: 'Qwen 视觉测试',
    };
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...stored.extensionSettings,
        apiProfiles: [textProfile, visionProfile],
        activeApiProfileId: textProfile.id,
        visionApiProfileId: '',
        visionModel: '',
      },
    });
    return { text: textProfile.id, vision: visionProfile.id };
  });
  await options.reload();
  await expect(options.locator('#profile-role-status')).toContainText('文字翻译');

  await options.locator('#api-profile').selectOption(profileIds.vision);
  await expect(options.locator('#profile-role-status')).toContainText('尚未分配');
  await expect(options.locator('#use-text-profile')).toBeVisible();
  await options.locator('#api-key').fill('e2e-review-key');
  await options.locator('#refresh-models').click();
  await expect(options.locator('#status')).toContainText('文字继续使用');
  await expect(options.locator('#profile-role-status')).toContainText('图像翻译');
  await expect(options.locator('#profile-role-status')).not.toContainText('文字翻译');

  await expect(options.locator('#save-button')).toBeDisabled();
  await expect.poll(() => options.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return {
      text: stored.extensionSettings?.activeApiProfileId,
      vision: stored.extensionSettings?.visionApiProfileId,
    };
  })).toEqual(profileIds);
  await options.close();
});

test('uses and remembers a visual-capable active API on the first image translation', async () => {
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
  const response = await extensionPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    const configurationRevision = crypto.randomUUID();
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        activeApiProfileId: 'default',
        visionApiProfileId: '',
        visionModel: '',
      },
      configurationRevision: {
        id: configurationRevision,
        committedAt: Date.now(),
        invalidatesTranslationState: true,
      },
    });
    const sessionStorage = (extensionChrome.storage as unknown as {
      session: { get(key: string): Promise<Record<string, unknown>> };
    }).session;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const applied = await sessionStorage.get('appliedConfigurationRevision');
      if (applied.appliedConfigurationRevision === configurationRevision) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10));
      if (attempt === 79) throw new Error('Configuration revision was not applied.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#111';
    context.fillRect(3, 3, 10, 10);
    return extensionChrome.runtime.sendMessage({
      type: 'TRANSLATE_IMAGE_REGION',
      payload: {
        requestId: crypto.randomUUID(),
        imageDataUrl: canvas.toDataURL('image/png'),
        imageWidth: 16,
        imageHeight: 16,
        pageUrl: 'https://www.overleaf.com/project/auto-vision-e2e',
        targetLanguage: '简体中文',
        sourceLanguage: 'auto',
        style: 'academic',
      },
    });
  }) as { ok?: boolean };
  expect(response.ok).toBe(true);
  await expect.poll(() => extensionPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    return {
      profileId: stored.extensionSettings?.visionApiProfileId,
      model: stored.extensionSettings?.visionModel,
    };
  })).toEqual({ profileId: 'default', model: 'e2e-model' });
  await extensionPage.close();
});

test('persists and undoes a native PDF correction through the real background session', async () => {
  const sourceUrl = 'https://www.overleaf.com/native-correction-success.pdf';
  const source = 'A durable correction should survive a background restart.';
  const originalTranslation = '原始 PDF 译文保留公式 $E=mc^2$。';
  const correctedTextPart = '修正后的 PDF 译文仍保留公式 ';
  await context.route(sourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: createTextPdf(source),
    });
  });
  const sidePanel = await context.newPage();
  const nativePdfPage = await context.newPage();
  try {
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    const tabId = await worker!.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        chrome: { tabs: { query(query: object): Promise<Array<{ id?: number }>> } };
      }).chrome;
      return (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    });
    expect(tabId).toBeDefined();
    const baseResultRequestId = 'native-correction-base-result-e2e';
    const sessionRequestId = 'native-correction-session-e2e';
    await sidePanel.evaluate(async ({ id, pageUrl, sourceText, translation, resultRequestId, requestId }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: {
          storage: {
            session: {
              get(key: string): Promise<Record<string, unknown>>;
              set(values: Record<string, unknown>): Promise<void>;
            };
          };
        };
      }).chrome;
      const stored = await api.storage.session.get('pdfSidePanelSessionsByTab');
      const sessions = stored.pdfSidePanelSessionsByTab &&
        typeof stored.pdfSidePanelSessionsByTab === 'object'
        ? stored.pdfSidePanelSessionsByTab as Record<string, unknown>
        : {};
      await api.storage.session.set({
        pdfSidePanelSessionsByTab: {
          ...sessions,
          [String(id)]: {
            tabId: id,
            requestId,
            sourceText,
            pageUrl,
            sourceLabel: 'native-correction-success.pdf',
            status: 'complete',
            startedAt: Date.now(),
            partialText: translation,
            result: {
              requestId: resultRequestId,
              originalText: sourceText,
              translatedText: translation,
              warnings: [],
              latencyMs: 640,
            },
          },
        },
        [`translationResultHead:${id}`]: {
          tabId: id,
          currentResultRequestId: resultRequestId,
          rootRequestId: resultRequestId,
          updatedAt: Date.now(),
        },
      });
    }, {
      id: tabId!,
      pageUrl: sourceUrl,
      sourceText: source,
      translation: originalTranslation,
      resultRequestId: baseResultRequestId,
      requestId: sessionRequestId,
    });

    const restartBackground = async (): Promise<void> => {
      const cdp = await context.newCDPSession(sidePanel);
      const workerVersions = new Map<string, {
        versionId: string;
        scriptURL: string;
        runningStatus: 'stopped' | 'starting' | 'running' | 'stopping';
      }>();
      cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
        versions.forEach((version) => workerVersions.set(version.versionId, version));
      });
      try {
        await cdp.send('ServiceWorker.enable');
        await expect.poll(() => Array.from(workerVersions.values()).find((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
        ))?.runningStatus).toBe('running');
        const activeVersion = Array.from(workerVersions.values()).find((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
          && version.runningStatus === 'running'
        ));
        expect(activeVersion).toBeDefined();
        await cdp.send('ServiceWorker.stopWorker', { versionId: activeVersion!.versionId });
        await expect.poll(() => workerVersions.get(activeVersion!.versionId)?.runningStatus)
          .toBe('stopped');
        const response = await sidePanel.evaluate(async (id) => {
          const api = (globalThis as typeof globalThis & {
            chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
          }).chrome;
          return api.runtime.sendMessage({
            type: 'GET_PDF_SIDE_PANEL_SESSION',
            payload: { tabId: id },
          });
        }, tabId!);
        await expect.poll(() => Array.from(workerVersions.values()).some((version) => (
          version.scriptURL.startsWith(`chrome-extension://${extensionId}/`)
          && version.runningStatus === 'running'
        ))).toBe(true);
        expect(response).toMatchObject({ ok: true });
      } finally {
        await cdp.detach();
      }
    };

    await restartBackground();
    await expect(sidePanel.locator('#session')).toBeVisible();
    await expect(sidePanel.locator('#translation-text')).toContainText('原始 PDF 译文保留公式');
    await sidePanel.locator('#correct').click();
    const correction = sidePanel.getByRole('group', { name: '修正译文，公式已锁定' });
    await correction.getByLabel('可编辑译文第 1 段').fill(correctedTextPart);
    await correction.getByRole('button', { name: '保存', exact: true }).click();
    await expect(sidePanel.locator('#translation-text')).toContainText('修正后的 PDF 译文仍保留公式');
    await expect(sidePanel.locator('#translation-text')).toContainText('E=mc2');
    await expect(sidePanel.locator('#correction-undo')).toBeVisible();
    await expect(sidePanel.locator('#undo-correction')).toBeFocused();

    const correctedSession = await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(keys: string[]): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get([
        'pdfSidePanelSessionsByTab',
        `translationResultHead:${id}`,
      ]);
      const sessions = stored.pdfSidePanelSessionsByTab as Record<string, unknown>;
      return {
        session: sessions[String(id)],
        head: stored[`translationResultHead:${id}`],
      };
    }, tabId!);
    expect(correctedSession).toMatchObject({
      session: {
        status: 'complete',
        partialText: `${correctedTextPart}$E=mc^2$。`,
        correctionReceipt: {
          baseRequestId: baseResultRequestId,
          previousTranslation: originalTranslation,
        },
      },
      head: { tabId },
    });
    const correctedRequestId = (
      correctedSession.session as { result: { requestId: string } }
    ).result.requestId;
    expect((correctedSession.head as { currentResultRequestId: string }).currentResultRequestId)
      .toBe(correctedRequestId);

    await restartBackground();
    await sidePanel.reload({ waitUntil: 'domcontentloaded' });
    await expect(sidePanel.locator('#translation-text')).toContainText('修正后的 PDF 译文仍保留公式');
    await expect(sidePanel.locator('#correction-undo')).toBeVisible();
    await sidePanel.locator('#undo-correction').click();
    await expect(sidePanel.locator('#translation-text')).toContainText('原始 PDF 译文保留公式');
    await expect(sidePanel.locator('#correction-undo')).toBeHidden();
    await expect(sidePanel.locator('#correct')).toBeFocused();

    const restoredSession = await sidePanel.evaluate(async (id) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { get(keys: string[]): Promise<Record<string, unknown>> } } };
      }).chrome;
      const stored = await api.storage.session.get([
        'pdfSidePanelSessionsByTab',
        `translationResultHead:${id}`,
      ]);
      const sessions = stored.pdfSidePanelSessionsByTab as Record<string, unknown>;
      return {
        session: sessions[String(id)],
        head: stored[`translationResultHead:${id}`],
      };
    }, tabId!);
    expect(restoredSession).toMatchObject({
      session: {
        status: 'complete',
        partialText: originalTranslation,
        result: { translatedText: originalTranslation },
      },
      head: { tabId },
    });
    expect(restoredSession.session).not.toHaveProperty('correctionReceipt');
    expect((restoredSession.head as { currentResultRequestId: string }).currentResultRequestId)
      .not.toBe(correctedRequestId);
  } finally {
    await nativePdfPage.close().catch(() => undefined);
    await sidePanel.close().catch(() => undefined);
    await context.unroute(sourceUrl).catch(() => undefined);
  }
});
