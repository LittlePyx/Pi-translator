import { expect, test, chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
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
}

interface TestChromeApi {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
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
      ]);
    }, keys);
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
    const isMultiSentenceSelection = JSON.stringify(body).includes('First important sentence');
    const isDocumentTermSelection = JSON.stringify(body).includes('adaptive sensing');
    const isPdfOptimizerFallback = JSON.stringify(body).includes('Optimizer fallback fixture');
    const isTranslationRevision = JSON.stringify(body).includes('translationRevisionPreference');
    const isPartialRecoverySelection = JSON.stringify(body).includes(
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
            } : isDocumentTermSelection ? {
              translation: '自适应感知策略在该文档中保持稳定。',
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
            <p id="multi-source">First important sentence. Second supporting sentence.</p>
            <p id="term-source">The adaptive sensing policy is stable in this document.</p>
            <p id="term-followup">This adaptive sensing method remains consistent.</p>
            <p id="recovery-source">A configured API should resume this selected translation automatically.</p>
            <p id="partial-recovery-source">A recovery request may already contain a partial translation.</p>
            <p id="math-source">The objective
              <span class="katex" data-tex="\\mathcal{L}=\\sum_i(x_i-y_i)^2">ℒ = Σᵢ(xᵢ − yᵢ)²</span>
              is minimized during training.
            </p>
            <p id="rendered-only-math">The quantity ∑ᵢ xᵢ² ≥ 0 is nonnegative.</p>
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
    await page.bringToFront();
    const emptyState = sidePanel.locator('#empty-state');
    const emptyAction = sidePanel.locator('#empty-action');
    await expect(emptyState).toHaveAttribute('data-context', 'other');
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

    nativePdfPage = await context.newPage();
    await nativePdfPage.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await nativePdfPage.bringToFront();
    await expect(emptyState).toHaveAttribute('data-context', 'pdf');
    await expect(sidePanel.locator('#empty-title')).toHaveText('当前 PDF 已就绪');
    await expect(sidePanel.locator('#empty-description')).toContainText('选择文字后右键翻译');
    await expect(emptyAction).toHaveText('用 Pi 打开当前 PDF');
    await emptyAction.focus();
    await expect(emptyAction).toBeFocused();
  } finally {
    await nativePdfPage?.close();
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
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  if (!markerBox) return;
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
  const restoredMarkerBox = await restoredMarker.boundingBox();
  expect(restoredMarkerBox).not.toBeNull();
  if (!restoredMarkerBox) return;

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
  expect(compactControlHeights).toEqual([28, 28, 28, 26]);
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
  await expect(overlay.getByRole('button', { name: '撤销上次译文修正' }))
    .toBeFocused();

  const markerLayer = page.locator('#pi-translation-marker-layer');
  const marker = markerLayer.locator('.marker').first();
  await expect(marker).toBeVisible();
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  if (markerBox) {
    await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
    await expect(markerLayer.locator('.tooltip')).toContainText('用户手动修订后的学术译文。');
  }

  await overlay.locator('details.more > summary').click();
  await overlay.getByRole('button', { name: '让模型调整…' }).click();
  await overlay.getByRole('button', { name: '更忠实原文' }).click();
  await expect(overlay.locator('.body')).toContainText('更忠实地保留原文限定条件');
  await expect(overlay.locator('.version-counter')).toHaveText('v1/3');
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

  await overlay.getByText('＋ 固定术语（可选）').click();
  const sourceTerm = overlay.getByRole('textbox', { name: '原文术语' });
  const targetTerm = overlay.getByRole('textbox', { name: '固定译法' });
  await expect(sourceTerm).toBeVisible();
  await expect(targetTerm).toBeVisible();
  await overlay.getByRole('combobox', { name: '术语保存范围' }).selectOption('global');
  await overlay.getByRole('textbox', { name: '可编辑译文第 1 段' })
    .fill('显式术语修正后的译文。');

  const requestsBeforeSave = textRequests.length;
  await sourceTerm.fill('incomplete term');
  await overlay.getByRole('button', { name: '保存', exact: true }).click();
  await expect(overlay.locator('.revision-status'))
    .toContainText('请完整填写不含公式的简短术语和固定译法');
  expect(textRequests).toHaveLength(requestsBeforeSave);

  const uniqueSource = 'correction-only global phrase';
  const uniqueTarget = '仅供修正测试的全局译法';
  await sourceTerm.fill(uniqueSource);
  await targetTerm.fill(uniqueTarget);
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

test('keeps a newer translation when an old correction save is rejected', async () => {
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

  try {
    await overlay.getByRole('button', { name: '保存', exact: true }).click();
    await expect(overlay.locator('.revision-status'))
      .toContainText('当前译文已经变化，请重新打开修正');
    await expect(editor).toBeVisible();
    await overlay.getByRole('button', { name: '取消', exact: true }).click();
    await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  } finally {
    await worker.evaluate(async ({ key, original }) => {
      const api = (globalThis as typeof globalThis & {
        chrome: { storage: { session: { set(values: Record<string, unknown>): Promise<void> } } };
      }).chrome;
      await api.storage.session.set({ [key]: original });
    }, storedHead);
    if (await overlay.getByRole('button', { name: '取消', exact: true }).count()) {
      await overlay.getByRole('button', { name: '取消', exact: true }).click();
    }
    if (await overlay.getByTitle('关闭').count()) await overlay.getByTitle('关闭').click();
    await clearBrowserSelection();
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
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  if (!markerBox) throw new Error('Expected a visible source marker after retry.');
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
  )).toBe('0');
  await first.focus();
  await expect.poll(() => first.locator('.segment-actions').evaluate(
    (element) => getComputedStyle(element).opacity,
  )).toBe('1');
  const alignedControlHeights = await Promise.all([
    first.locator('.segment-correct'),
    first.locator('.segment-mark'),
  ].map((control) => control.evaluate((element) => element.getBoundingClientRect().height)));
  expect(alignedControlHeights).toEqual([28, 28]);
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
  expect(textRequests).toHaveLength(requestsBeforeCorrection);

  await overlay.getByRole('button', { name: '撤销上次译文修正' }).click();
  segments = overlay.locator('.segment');
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
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  if (!markerBox) return;
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
  await overlay.locator('.body').click();
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
  await overlay.getByTitle('固定到连续翻译侧栏').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');

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
    await overlay.getByTitle('固定到连续翻译侧栏').click();
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
    const markerBounds = await marker.boundingBox();
    expect(markerBounds).not.toBeNull();
    if (!markerBounds) return;
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
    const bounds = await firstMarker.boundingBox();
    expect(bounds).not.toBeNull();
    await reader.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);

    const overlay = reader.locator('#tex-selection-translator-root');
    await expect(overlay).toHaveAttribute('data-pi-view', 'card');
    await overlay.locator('details.more > summary').click();
    await overlay.getByRole('button', { name: '查看本文标记（100）' }).click();
    await expect(overlay.locator('.marker-note')).toHaveCount(100);
    await expect(overlay.locator('.marker-notes-toolbar')).toContainText('100 条');

    const lastMarker = overlay.locator('.marker-note').last();
    await expect(lastMarker).toContainText('第 100 页');
    await lastMarker.getByRole('button', { name: '跳转到原文' }).click();
    await expect(reader.locator('#page-number')).toHaveValue('100');
    await expect(reader.locator('.pdf-page[data-page-number="100"]'))
      .toHaveAttribute('data-rendered', 'ready');
    await expect(markerLayer.locator('.marker.focused')).toBeVisible();
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

  await overlay.getByTitle('固定到连续翻译侧栏').click();
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
  const sourceMarkerBox = await sourceMarker.boundingBox();
  expect(sourceMarkerBox).not.toBeNull();
  if (sourceMarkerBox) {
    await pdfPage.mouse.move(
      sourceMarkerBox.x + sourceMarkerBox.width / 2,
      sourceMarkerBox.y + sourceMarkerBox.height / 2,
    );
    const sourceTooltip = pdfPage.locator('#pi-translation-marker-layer .tooltip');
    await expect(sourceTooltip.locator('.tooltip-text'))
      .toHaveText('重新识别后修正的学术翻译结果。');
  }
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
  const markerBounds = await marker.boundingBox();
  expect(markerBounds).not.toBeNull();
  if (markerBounds) {
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
  }
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

test('shows a compact PDF region queue and lets waiting or active tasks be cancelled', async () => {
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

    await queueButton.click();
    const queuePanel = pdfPage.locator('#region-queue-panel');
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel.locator('.queue-item')).toHaveCount(2);
    await expect(queuePanel.locator('.queue-item').first()).toContainText('翻译中');
    await expect(queuePanel.locator('.queue-item').nth(1)).toContainText('等待中');
    await queuePanel.locator('.queue-item').nth(1).getByRole('button', { name: '取消' }).click();
    await expect(pdfPage.locator('#region-queue-count')).toHaveText('1');
    await queuePanel.locator('.queue-item').first().getByRole('button', { name: '取消' }).click();
    releaseResponse?.();
    await expect(queueButton).toBeHidden();
  } finally {
    releaseResponse?.();
    await context.unroute(apiPattern, delayedVisionHandler);
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

test('creates and adjusts a PDF image region with the keyboard and touch-safe mode', async () => {
  const pdfPage = await context.newPage();
  await pdfPage.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdfPage.locator('#file-input').setInputFiles({
    name: 'keyboard-region.pdf',
    mimeType: 'application/pdf',
    buffer: createRasterPdf(),
  });
  const firstPage = pdfPage.locator('.pdf-page').first();
  await expect(firstPage).toHaveAttribute('data-rendered', 'ready');
  const regionButton = pdfPage.locator('#region-translate');
  await regionButton.focus();
  await regionButton.press('Enter');
  const selection = firstPage.locator('.region-selection-box');
  await expect(selection).toBeFocused();
  await expect(firstPage.locator('.region-confirm')).toBeVisible();
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
  await expect(notice).toContainText('请选择 PDF 文件');
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
  expect(await sidePanel.locator('#stop-translation').evaluate(
    (element) => element.getBoundingClientRect().height,
  )).toBe(28);
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
  expect(contextLayout.buttonHeight).toBe(28);

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
  await expect(sidePanel.locator('#copy')).toHaveText('复制部分译文');
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  expect(await sidePanel.locator('#copy').evaluate(
    (element) => element.getBoundingClientRect().height,
  )).toBe(28);
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
  await sidePanel.locator('#correct').click();
  const nativeCorrection = sidePanel.getByRole('group', { name: '修正译文，公式已锁定' });
  await expect(nativeCorrection).toBeVisible();
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
  await nativeCorrection.getByText('＋ 固定术语（可选）').click();
  const nativeTermScope = nativeCorrection.getByLabel('术语保存范围');
  await nativeTermScope.selectOption('global');
  await expect(nativeTermScope).toHaveValue('global');
  await nativeCorrection.press('Escape');
  await expect(sidePanel.locator('#correct')).toBeFocused();
  await expect(sidePanel.locator('#copy')).toBeEnabled();
  await expect(sidePanel.locator('#translation-text .pi-math-scroll math')).toHaveCount(3);
  if (process.env.PI_VISUAL_QA) {
    await sidePanel.screenshot({ path: testInfo.outputPath('native-pdf-side-panel.png') });
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

test('clears native PDF side-panel actions as soon as the active tab changes', async () => {
  const sidePanel = await context.newPage();
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
    const pin = overlay.getByTitle('固定到连续翻译侧栏');
    await expect(pin).toHaveText('固定侧栏');
    await expect(overlay.locator('.loading-status')).toContainText('正在请求模型');
    await pin.click();
    await expect(overlay).toHaveAttribute('data-pi-view', 'sidebar');
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

test('pins continuous translation to a collapsible sidebar', async () => {
  await page.locator('#blank').focus();
  await selectElementText('#source');
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
    const pin = overlay.getByTitle('固定到连续翻译侧栏');
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
  await candidateRow.getByLabel('修改 adaptive sensing 的候选译法').fill('自适应感知方法');
  await candidateRow.getByTitle('保存修改并采用').click();
  await expect(overlay.locator('.document-section').filter({ hasText: '固定译法' }))
    .toContainText('自适应感知方法');
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
  expect(JSON.stringify(latestRequest)).toContain('自适应感知方法');
  await expect(overlay.locator('.body')).toContainText('自适应感知策略');
  await overlay.getByTitle('查看本文术语和最近翻译').click();
  await expect.poll(() => overlay.locator('.document-translation').count()).toBeGreaterThanOrEqual(2);
  await overlay.getByTitle('返回翻译结果').click();
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
  await onboardingPreset.selectOption('custom');
  await reopened.locator('#onboarding-next').click();
  await expect(reopened.locator('#onboarding-base-url-field')).toBeVisible();
  await expect(reopened.locator('#onboarding-base-url')).toHaveValue('');
  await expect(reopened.locator('#onboarding-model')).toHaveValue('');
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

  await options.locator('button[type="submit"]').click();
  await expect(options.locator('#status')).toContainText(
    '已自动启用 PDF 图像区域翻译',
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
  await expect(options.locator('#profile-role-status')).toContainText('PDF 图像');
  await expect(options.locator('#profile-role-status')).not.toContainText('文字翻译');

  await options.locator('button[type="submit"]').click();
  await expect(options.locator('#status')).toContainText('文字继续使用');
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
