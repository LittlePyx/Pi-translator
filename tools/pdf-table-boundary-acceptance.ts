/** Local-only layout regression; never calls a translation provider.
 * vite-node tools/pdf-table-boundary-acceptance.ts -- <pdf-path> [--before]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { preparePdfDocumentTranslationPages, pdfDocumentTranslationSourceRegions,
  type PdfDocumentTranslationPageInput } from '../core/pdf/document-translation';

const source = process.argv.find((arg) => /\.pdf$/iu.test(arg));
if (!source) throw new Error('Pass a local PDF path.');
const stage = process.argv.includes('--before') ? 'before' : 'after';
const output = path.resolve('output/pdf/table-boundary-2026-09-04', stage);
await mkdir(output, { recursive: true });
const pdf = await getDocument({ data: new Uint8Array(await readFile(source)),
  standardFontDataUrl: `${path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/`,
}).promise;
const inputs: PdfDocumentTranslationPageInput[] = [];
try {
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
          width: Math.abs(item.width), height,
          descent: Math.max(0, -(content.styles[item.fontName]?.descent ?? 0)) * height }];
      }),
    });
  }
} finally { await pdf.destroy(); }
const prepared = preparePdfDocumentTranslationPages(inputs);
const targetPages = inputs.filter((input) => input.items.some((item) => /Conclusion/u.test(item.str)));
if (!targetPages.length) throw new Error('No conclusion page found.');
const blocks = prepared.blocks.filter((block) => targetPages.some((page) => page.pageNumber === block.pageNumber));
await writeFile(path.join(output, 'report.json'), JSON.stringify({ inputs: targetPages, blocks }, null, 2));
console.log(JSON.stringify(blocks.map((block) => ({ id: block.id, kind: block.kind ?? 'text',
  text: block.text, anchor: block.sourceAnchor })), null, 2));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const surface = await browser.newPage({ viewport: { width: 1500, height: 2100 } });
  for (const target of targetPages) {
    const prefix = path.join(output, `page-${target.pageNumber}`);
    await promisify(execFile)('pdftoppm', ['-f', String(target.pageNumber), '-l', String(target.pageNumber),
      '-r', '160', '-png', '-singlefile', source, prefix], { windowsHide: true });
    const dataUrl = `data:image/png;base64,${(await readFile(`${prefix}.png`)).toString('base64')}`;
    await surface.setContent('<html><body style="margin:0"><canvas></canvas></body></html>');
    await surface.evaluate(async ({ dataUrl, regions }) => {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const canvas = document.querySelector('canvas')!;
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0); ctx.lineWidth = 2;
      for (const block of regions) {
        ctx.strokeStyle = block.kind === 'table' ? '#6b4eff' : '#00844a';
        ctx.fillStyle = ctx.strokeStyle; ctx.font = '15px Arial';
        for (const { sourceAnchor: a } of block.regions) {
          ctx.strokeRect(a.leftRatio * img.width, a.topRatio * img.height, a.widthRatio * img.width, a.heightRatio * img.height);
          ctx.fillText(`${block.id} ${block.kind ?? 'text'}`, a.leftRatio * img.width, a.topRatio * img.height - 4);
        }
      }
    }, { dataUrl, regions: blocks.filter((block) => block.pageNumber === target.pageNumber)
      .map((block) => ({ id: block.id, kind: block.kind, regions: pdfDocumentTranslationSourceRegions(block) })) });
    await surface.locator('canvas').screenshot({ path: `${prefix}-anchors.png` });
  }
} finally { await browser.close(); }
