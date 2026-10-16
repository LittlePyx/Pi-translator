/** Local PDF rendering benchmark; delay represents a simulated provider, never a network API. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readLocalPdfLayout } from '../tests/support/local-pdf-layout';
import { pdfDocumentTranslationSourceRegions } from '../core/pdf/document-translation';

const source = process.argv.find((arg) => /\.pdf$/iu.test(arg));
if (!source) throw new Error('Provide a local PDF path');
const prepared = await readLocalPdfLayout(source);
const regions = prepared.blocks.filter((block) => [4, 5].includes(block.pageNumber))
  .flatMap((block) => block.visualUnits?.map((unit) => unit.sourceRegions) ?? [pdfDocumentTranslationSourceRegions(block)])
  .slice(0, 8);
const output = path.resolve('output/pdf/capture-speed-2026-09-07');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'local-benchmark', configureServer(server) {
    server.middlewares.use('/benchmark', (_request, response) => {
      response.setHeader('Content-Type', 'text/html'); response.end('<html><body>Local capture benchmark</body></html>');
    });
  } }], optimizeDeps: { include: ['pdfjs-dist'] } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const bytes = [...await readFile(source)];
  await page.goto(`${server.resolvedUrls!.local[0]}benchmark`);
  const report = await page.evaluate(async ({ bytes, regions }) => {
    const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
    const pdfjs = await importModule('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const { capturePdfVisualRegions } = await importModule('/core/pdf/document-visual-capture.ts');
    const { PdfCapturePrefetch } = await importModule('/core/pdf/capture-prefetch.ts');
    const samples: object[] = [];
    let reference: string[] | undefined;
    // Alternate order to avoid reporting warm-up as the optimization benefit.
    for (const prefetch of [false, true, true, false]) {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
      const buffer = new PdfCapturePrefetch();
      const startedAt = performance.now();
      let captureWaitMs = 0, pageRenderMs = 0, cropEncodeMs = 0;
      const images: string[] = [];
      try {
        for (let index = 0; index < regions.length; index += 1) {
          const started = performance.now();
          const { value: capture } = await buffer.take(String(index), () => capturePdfVisualRegions(pdf, regions[index]));
          captureWaitMs += performance.now() - started;
          pageRenderMs += capture.pageRenderMs; cropEncodeMs += capture.cropEncodeMs;
          images.push(capture.imageDataUrl);
          if (prefetch && index + 1 < regions.length) {
            const nextIndex = index + 1;
            buffer.prepare(String(nextIndex), () => capturePdfVisualRegions(pdf, regions[nextIndex]));
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const identical = !reference || images.every((image, i) => image === reference![i]);
        if (!identical) throw new Error('Prefetch changed captured image bytes');
        reference ??= images;
        samples.push({ prefetch, regions: regions.length, simulatedRequestMs: 200,
          totalMs: performance.now() - startedAt, captureWaitMs, pageRenderMs, cropEncodeMs, identical });
      } finally { buffer.clear(); await pdf.destroy(); }
    }
    return { kind: 'local-capture-with-simulated-provider-delay', samples };
  }, { bytes, regions });
  await writeFile(path.join(output, 'benchmark.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await server.close(); }
