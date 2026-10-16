/** Local HATNet regression runner. The PDF and results are never committed.
 * Usage: vite-node tools/pdf-math-regression-acceptance.ts -- <pdf-path> [--live]
 * --live explicitly sends seven problem regions to the configured QWEN endpoint.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { preparePdfDocumentTranslationPages, pdfDocumentTranslationSourceRegions,
  type PdfDocumentTranslationPageInput } from '../core/pdf/document-translation';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';
import type { ProviderImageTranslationResult } from '../core/translation/types';

const sourcePath = process.argv.find((argument) => /\.pdf$/iu.test(argument));
if (!sourcePath) throw new Error('Pass the local HATNet PDF path.');
const output = path.resolve('output/pdf/math-layout-2026-09-04');
await mkdir(output, { recursive: true });
const pdf = await getDocument({
  data: new Uint8Array(await readFile(sourcePath)),
  standardFontDataUrl: `${path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/`,
}).promise;
const inputs: PdfDocumentTranslationPageInput[] = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  inputs.push({ pageNumber, pageWidth: viewport.width, pageHeight: viewport.height,
    items: content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return [];
      const baseline = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const height = Math.max(Math.abs(item.height), Math.hypot(item.transform[2], item.transform[3]));
      return [{ str: item.str, hasEOL: item.hasEOL, left: baseline[0], top: baseline[1] - height,
        width: Math.abs(item.width), height, descent: Math.max(0, -(content.styles[item.fontName]?.descent ?? 0)) * height }];
    }),
  });
}
await pdf.destroy();
const prepared = preparePdfDocumentTranslationPages(inputs);
const blocks = prepared.blocks.filter((block) => [3, 4, 5].includes(block.pageNumber));
const overlaps: object[] = [];
for (let i = 0; i < blocks.length; i += 1) for (const other of blocks.slice(i + 1)) {
  const first = blocks[i]!;
  if (first.pageNumber !== other.pageNumber) continue;
  for (const a of pdfDocumentTranslationSourceRegions(first)) for (const b of pdfDocumentTranslationSourceRegions(other)) {
    const aa = a.sourceAnchor; const bb = b.sourceAnchor;
    const width = Math.max(0, Math.min(aa.leftRatio + aa.widthRatio, bb.leftRatio + bb.widthRatio) - Math.max(aa.leftRatio, bb.leftRatio));
    const height = Math.max(0, Math.min(aa.topRatio + aa.heightRatio, bb.topRatio + bb.heightRatio) - Math.max(aa.topRatio, bb.topRatio));
    const fraction = width * height / Math.min(aa.widthRatio * aa.heightRatio, bb.widthRatio * bb.heightRatio);
    if (fraction > .01) overlaps.push({ first: first.id, other: other.id, fraction });
  }
}
const cases = [
  { name: 'nested-roots-and-argmin', page: 3, pattern: /In SPI paradigm/u },
  { name: 'prose-after-equation9', page: 3, pattern: /Eq\. \(8\) is a tensor gradient/u },
  { name: 'hat-paragraph', page: 4, pattern: /denoiser with learnable parameters/u },
  { name: 'equation15', page: 5, pattern: /\(15\)/u },
  { name: 'equation16', page: 5, pattern: /\(16\)/u },
  { name: 'equation17', page: 5, pattern: /\(17\)/u },
  { name: 'p4-implementation', page: 5, pattern: /In the proposed HATNet/u },
].map((entry) => ({ ...entry, block: blocks.find((block) => block.pageNumber === entry.page && entry.pattern.test(block.text))! }));
const checks = {
  allTargetsFound: cases.every((entry) => entry.block),
  noTableOrCodeOnPage5: !blocks.some((block) => block.pageNumber === 5 && ['table', 'code'].includes(block.kind ?? '')),
  noOrphanRoots: !blocks.some((block) => /^\s*√[\s√]*$/u.test(block.text)),
  p4OneOwner: blocks.filter((block) => /p\s*=\s*4/u.test(block.text)).length === 1,
  bodyDoesNotStartWithArgminVariable: /^Eq\. \(8\)/u.test(cases[1]?.block?.text ?? ''),
  noOverlappingTranslationCrops: overlaps.length === 0,
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 2100 } });
const report: { checks: typeof checks; overlaps: object[]; cases: object[] } = { checks, overlaps, cases: [] };
try {
  const pageImages = new Map<number, string>();
  for (const pageNumber of [3, 4, 5]) {
    const prefix = path.join(output, `source-page-${pageNumber}`);
    await promisify(execFile)('pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-r', '160', '-png', '-singlefile', sourcePath, prefix], { windowsHide: true });
    const dataUrl = `data:image/png;base64,${(await readFile(`${prefix}.png`)).toString('base64')}`;
    pageImages.set(pageNumber, dataUrl);
    await page.setContent('<html><body style="margin:0"><canvas></canvas></body></html>');
    await page.evaluate(async ({ dataUrl, blocks }) => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const canvas = document.querySelector('canvas')!; canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); ctx.lineWidth = 2;
      for (const [index, block] of blocks.entries()) {
        ctx.strokeStyle = `hsl(${index * 71 % 360} 70% 45%)`;
        for (const { sourceAnchor: a } of block.regions) {
          ctx.strokeRect(a.leftRatio * image.width, a.topRatio * image.height, a.widthRatio * image.width, a.heightRatio * image.height);
          ctx.font = '13px Arial'; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(block.id, a.leftRatio * image.width, a.topRatio * image.height - 3);
        }
      }
    }, { dataUrl, blocks: blocks.filter((block) => block.pageNumber === pageNumber).map((block) => ({ id: block.id, regions: pdfDocumentTranslationSourceRegions(block) })) });
    await page.locator('canvas').screenshot({ path: path.join(output, `page-${pageNumber}-anchors.png`) });
  }
  const live = process.argv.includes('--live');
  if (live && !Object.values(checks).every(Boolean)) throw new Error('Local layout checks must pass before sending images.');
  const translator = new OpenAiCompatibleTranslator();
  for (const entry of cases) {
    if (!entry.block) continue;
    const crop = await page.evaluate(async ({ dataUrl, regions }) => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const rects = regions.map(({ sourceAnchor: a }) => ({ x: Math.floor(a.leftRatio * image.width), y: Math.floor(a.topRatio * image.height), width: Math.ceil(a.widthRatio * image.width), height: Math.ceil(a.heightRatio * image.height) }));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(...rects.map((r) => r.width)); canvas.height = rects.reduce((sum, r) => sum + r.height, 0) + (rects.length - 1) * 8;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      let top = 0; for (const r of rects) { ctx.drawImage(image, r.x, r.y, r.width, r.height, 0, top, r.width, r.height); top += r.height + 8; }
      return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    }, { dataUrl: pageImages.get(entry.page)!, regions: pdfDocumentTranslationSourceRegions(entry.block) });
    await writeFile(path.join(output, `${entry.name}-crop.png`), Buffer.from(crop.dataUrl.split(',')[1]!, 'base64'));
    let result: ProviderImageTranslationResult | undefined;
    let error: string | undefined;
    const started = performance.now();
    if (live) {
      const apiKey = process.env.QWEN_API_KEY?.trim(); const apiBaseUrl = process.env.QWEN_BASE_URL?.trim(); const model = process.env.QWEN_MODEL?.trim();
      if (!apiKey || !apiBaseUrl || !model) throw new Error('Configure QWEN_API_KEY, QWEN_BASE_URL, QWEN_MODEL for --live.');
      try {
        result = await translator.translateImageRegion({ imageDataUrl: crop.dataUrl, imageWidth: crop.width, imageHeight: crop.height,
          recognizedTextHint: entry.block.text, visualPurpose: 'formula' },
        { model, sourceLanguage: 'auto', targetLanguage: 'zh-CN', style: 'academic' },
        { apiKey, apiBaseUrl }, AbortSignal.timeout(150_000));
      } catch (caught) { error = caught instanceof Error ? caught.name : 'Translation failed'; }
    }
    const expectedNumber = /^equation(\d+)$/u.exec(entry.name)?.[1];
    const liveChecks = live ? {
      responseReceived: Boolean(result),
      noStructuralReview: Boolean(result && !result.formulaNeedsReview && !result.uncertainSpans.length),
      containsTranslation: Boolean(result && /\p{Script=Han}/u.test(result.translatedText)),
      equationNumberExactlyOnce: !expectedNumber ||
        (result?.translatedText.match(new RegExp(String.raw`\\tag\s*\{${expectedNumber}\}`, 'gu'))?.length === 1),
      p4ExactlyOnce: entry.name !== 'p4-implementation' || (result?.translatedText.match(/p\s*=\s*4/gu)?.length === 1),
    } : undefined;
    if (liveChecks && !Object.values(liveChecks).every(Boolean)) process.exitCode = 1;
    report.cases.push({ name: entry.name, block: entry.block, ...(live ? { totalMs: Math.round(performance.now() - started), result, error, liveChecks } : {}) });
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ case: entry.name, live, completed: Boolean(result), error, liveChecks }));
  }
  console.log(JSON.stringify({ checks, overlaps, output }));
} finally { await browser.close(); }
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
