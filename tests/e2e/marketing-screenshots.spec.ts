import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

declare const chrome: typeof browser;

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FIXTURE_URL = 'https://www.overleaf.com/project/pi-translator-marketing';
const SCREENSHOT_DIRECTORY = path.resolve('store-assets/screenshots');

let context: BrowserContext;
let page: Page;
let userDataDirectory: string;
let extensionId: string;

function createScannedPaperPdf(): Buffer {
  const width = 306;
  const height = 396;
  const pixels = Buffer.alloc(width * height * 3, 247);
  const fill = (left: number, top: number, boxWidth: number, boxHeight: number, value: number) => {
    for (let y = top; y < Math.min(height, top + boxHeight); y += 1) {
      for (let x = left; x < Math.min(width, left + boxWidth); x += 1) {
        const offset = (y * width + x) * 3;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
      }
    }
  };
  fill(68, 34, 170, 5, 44);
  fill(95, 47, 116, 3, 105);
  fill(137, 75, 32, 4, 48);
  for (let line = 0; line < 9; line += 1) {
    fill(42, 92 + line * 9, line % 3 === 2 ? 198 : 222, 2, 80 + (line % 2) * 22);
  }
  fill(42, 194, 74, 4, 48);
  for (let line = 0; line < 13; line += 1) {
    fill(42, 211 + line * 9, line % 4 === 3 ? 176 : 222, 2, 84 + (line % 2) * 18);
  }
  const compressed = deflateSync(pixels);
  const pageContent = Buffer.from('q\n612 0 0 792 0 0 cm\n/Scan Do\nQ');
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
  chunks.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
  ));
  return Buffer.concat(chunks);
}

async function selectSourceText(): Promise<void> {
  await page.evaluate(() => {
    const source = document.querySelector('#source');
    if (!source) throw new Error('Marketing fixture source text is missing.');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-marketing-'));
  const extensionPath = path.resolve('.output/edge-mv3');
  context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: EDGE_EXECUTABLE,
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
  extensionId = new URL(serviceWorker.url()).host;

  const bootstrapPages = context.pages();
  const setup = bootstrapPages[0] ?? await context.newPage();
  await Promise.all(bootstrapPages.slice(1).map((tab) => tab.close()));
  await setup.goto(`chrome-extension://${extensionId}/options.html`);
  await setup.evaluate(async () => {
    await chrome.storage.local.set({
      extensionSettings: {
        schemaVersion: 8,
        provider: 'openai-compatible',
        apiBaseUrl: 'https://www.overleaf.com/pi-translator-api',
        model: 'marketing-demo-model',
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        style: 'academic',
        contentMode: 'auto',
        apiKeyStorage: 'session',
        showFloatingButtonOnOverleaf: true,
        hideFloatingButtonForTargetLanguage: true,
        generalPageMode: 'on-demand',
        siteAllowlist: [],
        enableContextMenu: true,
        rememberRecentTranslations: true,
        enableSessionCache: true,
        historyLimit: 5,
        sentenceAlignmentDefault: false,
        sidebarSide: 'right',
        sidebarWidth: 390,
        contextMode: 'off',
        enableStreaming: true,
        protectSensitiveFields: true,
        onboardingCompleted: true,
        academicGlossary: [
          { source: 'large language model', target: '大语言模型' },
          { source: 'knowledge distillation', target: '知识蒸馏' },
        ],
      },
    });
    await chrome.storage.session.set({ apiKey: 'marketing-demo-key' });
  });
  await context.route('https://www.overleaf.com/pi-translator-api/**', async (route) => {
    if (route.request().url().endsWith('/chat/completions')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translation: '一致的学术翻译能够提升研究论文的可读性。',
                  detectedLanguage: 'en',
                  warnings: [],
                  segments: [
                    {
                      id: 'C1S1',
                      translation: '一致的学术翻译能够提升研究论文的可读性。',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'marketing-demo-model' }] }),
    });
  });

  page = await context.newPage();
  await setup.close();
  await page.route(FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <style>
              * { box-sizing: border-box; }
              body { margin: 0; font-family: Inter, "Segoe UI", sans-serif; color: #1f2937; background: #eef1f4; }
              .topbar { height: 54px; padding: 0 26px; display: flex; align-items: center; justify-content: space-between; color: white; background: #176b45; }
              .brand { display: flex; align-items: center; gap: 13px; font-weight: 700; }
              .brand-mark { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: rgba(255,255,255,.18); }
              .project { font-size: 14px; opacity: .9; }
              .share { padding: 8px 14px; border: 1px solid rgba(255,255,255,.5); border-radius: 8px; font-size: 13px; }
              .workspace { height: calc(100vh - 54px); display: grid; grid-template-columns: 57% 43%; gap: 1px; background: #cfd5dc; }
              .editor { background: #fff; }
              .toolbar { height: 44px; padding: 0 18px; display: flex; align-items: center; gap: 18px; border-bottom: 1px solid #e5e7eb; color: #52606f; font-size: 13px; }
              .editor-body { display: grid; grid-template-columns: 48px 1fr; padding: 22px 28px 40px 0; font: 16px/1.8 "Cascadia Code", Consolas, monospace; }
              .lines { padding-right: 12px; text-align: right; color: #a0a8b3; user-select: none; }
              .code { color: #202936; }
              .command { color: #1669a8; }
              .comment { color: #749073; }
              #source { display: inline-block; margin: 6px 0; padding: 1px 0; }
              .pdf-pane { padding: 30px 34px; overflow: hidden; background: #dfe3e8; }
              .paper { min-height: 680px; padding: 58px 60px; background: #fff; box-shadow: 0 5px 18px rgba(15,23,42,.16); font-family: Georgia, serif; }
              .paper h1 { margin: 0 0 8px; text-align: center; font-size: 26px; }
              .authors { text-align: center; color: #64748b; font-size: 13px; }
              .abstract { margin-top: 34px; font-size: 13px; line-height: 1.65; text-align: justify; }
              .abstract strong { display: block; text-align: center; margin-bottom: 8px; }
              .paper h2 { margin: 30px 0 12px; font-size: 17px; }
              .paper p { font-size: 13px; line-height: 1.65; text-align: justify; }
            </style>
          </head>
          <body>
            <header class="topbar">
              <div class="brand">
                <span class="brand-mark">π</span>
                <span>Academic Translation Study</span>
                <span class="project">Research project</span>
              </div>
              <span class="share">Share</span>
            </header>
            <main class="workspace">
              <section class="editor">
                <div class="toolbar"><strong>main.tex</strong><span>Source</span><span>Review</span><span>History</span></div>
                <div class="editor-body">
                  <div class="lines">1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>10<br>11</div>
                  <div class="code">
                    <span class="command">\\documentclass</span>{article}<br>
                    <span class="command">\\usepackage</span>{amsmath}<br>
                    <span class="command">\\title</span>{Academic Translation Study}<br>
                    <span class="command">\\begin</span>{document}<br>
                    <span class="command">\\maketitle</span><br>
                    <span class="command">\\section</span>{Introduction}<br>
                    <span id="source">A consistent academic translation improves the readability of research papers.</span><br>
                    <span class="comment">% Preserve equations and citations</span><br>
                    We optimize <span class="command">$\\mathcal{L}_{total}$</span> following <span class="command">\\cite{smith2026}</span>.<br>
                    <span class="command">\\end</span>{document}
                  </div>
                </div>
              </section>
              <section class="pdf-pane">
                <article class="paper">
                  <h1>Academic Translation Study</h1>
                  <div class="authors">P&amp;I Lab · 2026</div>
                  <div class="abstract"><strong>Abstract</strong>A consistent academic translation improves the readability of research papers while preserving notation, citations, and domain terminology.</div>
                  <h2>1. Introduction</h2>
                  <p>Reliable terminology is essential when translating scientific manuscripts. Our workflow keeps equations and references intact.</p>
                </article>
              </section>
            </main>
          </body>
        </html>`,
    });
  });
  await page.goto(FIXTURE_URL);
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDirectory) await rm(userDataDirectory, { recursive: true, force: true });
});

test('captures the real translation overlay', async () => {
  await selectSourceText();
  const overlay = page.locator('#tex-selection-translator-root');
  await expect(overlay).toHaveAttribute('data-pi-view', 'trigger');
  await overlay.locator('.trigger').click();
  await expect(overlay).toHaveAttribute('data-pi-view', 'card');
  await expect(overlay.locator('.body')).toContainText('一致的学术翻译');
  const viewSwitch = overlay.locator('.view-switch');
  await expect(viewSwitch).toBeVisible();
  const switchBox = await viewSwitch.boundingBox();
  expect(switchBox?.width).toBeLessThan(85);
  expect(switchBox?.height).toBe(26);
  const copyBox = await overlay.locator('.copy-action').boundingBox();
  expect(copyBox?.width).toBeLessThan(50);
  expect(copyBox?.height).toBe(28);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIRECTORY, 'product-translation-1280x800.png'),
  });
});

test('captures the real settings page', async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator('#api-key-state')).toContainText('已保存 Key');
  await options.screenshot({
    path: path.join(SCREENSHOT_DIRECTORY, 'product-settings-1280x800.png'),
  });
  await options.close();
});

test('captures the real quick panel', async () => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 420, height: 560 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator('#target-language')).toHaveValue('zh-CN');
  await expect(popup.locator('#site-name')).toHaveText('www.overleaf.com');
  await popup.screenshot({
    path: path.join(SCREENSHOT_DIRECTORY, 'product-quick-panel-420x560.png'),
  });
  await popup.close();
});

test('captures scanned PDF region translation', async () => {
  const pdf = await context.newPage();
  await pdf.setViewportSize({ width: 1280, height: 800 });
  await pdf.goto(`chrome-extension://${extensionId}/pdf.html`);
  await pdf.locator('#file-input').setInputFiles({
    name: 'scanned-research-paper.pdf',
    mimeType: 'application/pdf',
    buffer: createScannedPaperPdf(),
  });
  const pageElement = pdf.locator('.pdf-page').first();
  await expect(pageElement).toHaveAttribute('data-rendered', 'ready');
  await expect(pageElement).toHaveAttribute('data-has-text', 'false');
  await expect(pdf.locator('#notice')).toHaveClass(/transient/);
  await expect(pdf.locator('#notice')).toContainText('扫描版 PDF');
  await pdf.locator('#region-translate').click();
  const box = await pageElement.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await pdf.mouse.move(box.x + 105, box.y + 160);
  await pdf.mouse.down();
  await pdf.mouse.move(box.x + Math.min(650, box.width - 40), box.y + 390, { steps: 10 });
  await pdf.mouse.up();
  await expect(pageElement.locator('.region-confirm')).toBeVisible();
  await pdf.screenshot({
    path: path.join(SCREENSHOT_DIRECTORY, 'product-pdf-region-1280x800.png'),
  });
  await pdf.close();
});
