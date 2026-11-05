import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { clickPdfReaderAction } from './support/translation-controls';
import {
  context, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests,
} from './support/edge-extension-fixture';

interface Sample {
  id: string; file: string; sha256: string; pages: number; jumpPages: number[];
  searchQuery: string | null;
}
interface Plan { samples: Sample[]; viewport: { width: number; height: number } }
const planFile = process.env.PI_PDF_READING_PLAN;
const planBytes = planFile ? readFileSync(planFile) : undefined;
const plan = planBytes ? JSON.parse(planBytes.toString()) as Plan : undefined;
const candidateBuild = process.env.PI_E2E_EXTENSION_PATH ? JSON.parse(readFileSync(`${process.env.PI_E2E_EXTENSION_PATH}/build-info.json`, 'utf8')) : undefined;
const planSha256 = planBytes ? createHash('sha256').update(planBytes).digest('hex') : undefined;
installEdgeExtensionHooks();
test.skip(!plan, 'Opt-in fixed local PDF reading benchmark; no model requests.');

test.beforeAll(async () => {
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    const scope = globalThis as any;
    const original = scope.fetch.bind(scope);
    scope.pdfReadingProviderAttempts = 0;
    scope.fetch = (...args: any[]) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
      if (/^https?:/u.test(url)) {
        scope.pdfReadingProviderAttempts++;
        throw new Error('External fetch blocked during PDF reading measurement');
      }
      return original(...args);
    };
  });
});

async function position(reader: Page) {
  return reader.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('#document-stage')!;
    const bounds = stage.getBoundingClientRect(), y = bounds.top + 12;
    const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')];
    const page = pages.find(node => { const r = node.getBoundingClientRect(); return r.top <= y && r.bottom >= y; }) ??
      pages.reduce((best, node) => {
        const distance = (p: HTMLElement) => { const r = p.getBoundingClientRect(); return Math.min(Math.abs(y-r.top), Math.abs(y-r.bottom)); };
        return distance(node) < distance(best) ? node : best;
      });
    const pageNumber = Number(page.dataset.pageNumber), rect = page.getBoundingClientRect();
    return { pageNumber, ratio: Math.max(0, Math.min(1, (bounds.top + 12 - rect.top) / rect.height)),
      scrollTop: stage.scrollTop, height: rect.height, canScroll: stage.scrollHeight > stage.clientHeight + 1 };
  });
}

async function jump(reader: Page, pageNumber: number) {
  const input = reader.locator('#page-number');
  await input.fill(String(pageNumber));
  await input.press('Enter');
  await expect(reader.locator(`.pdf-page[data-page-number="${pageNumber}"]`)).toHaveAttribute('data-rendered', 'ready', { timeout: 30_000 });
  await expect.poll(() => reader.locator('.pdf-page[data-rendered="queued"], .pdf-page[data-rendered="loading"]').count()).toBe(0);
  await expect.poll(() => reader.locator('.pdf-page[data-rendered]').count()).toBeLessThanOrEqual(5);
}

async function setMiddlePosition(reader: Page, pages: number) {
  const middle = Math.max(1, Math.ceil(pages / 2));
  await jump(reader, middle);
  await reader.locator(`.pdf-page[data-page-number="${middle}"]`).evaluate(page => {
    const stage = document.querySelector<HTMLElement>('#document-stage')!;
    stage.scrollTop += page.getBoundingClientRect().top - stage.getBoundingClientRect().top + page.getBoundingClientRect().height * .25 - 12;
  });
  await reader.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const sample of plan?.samples ?? [{ id: 'requires-plan' } as Sample]) {
  test(`measures fixed real paper reading: ${sample.id}`, async ({}, info) => {
    test.setTimeout(120_000);
    expect(createHash('sha256').update(readFileSync(sample.file)).digest('hex')).toBe(sample.sha256);
    const worker = context.serviceWorkers()[0]!;
    const callsBefore = textRequests.length + visionRequests.length;
    const issues: string[] = [];
    const measurements: Record<string, unknown> = { sample: sample.id, planSha256, candidateBuildId: candidateBuild?.buildId, sourceSha256: sample.sha256,
      evidence: 'Real PDF rendering in isolated Edge; external worker fetch blocked. No new model or OCR requests.', jumps: [] };
    const checkpoint = (stage: string) => { measurements.stage = stage; writeFileSync(info.outputPath('progress.json'), JSON.stringify(measurements, null, 2)); };
    let reader = await context.newPage();
    let cdp = await context.newCDPSession(reader);
    const memory = async () => ({
      heap: await cdp.send('Runtime.getHeapUsage'),
      dom: await reader.evaluate(() => {
        const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas')];
        return { nodes: document.getElementsByTagName('*').length,
          renderedPages: document.querySelectorAll('.pdf-page[data-rendered="ready"]').length,
          canvases: canvases.filter(canvas => canvas.width > 0).length,
          paintedCanvasRgbaBytes: canvases.filter(canvas => canvas.closest<HTMLElement>('.pdf-page')?.dataset.rendered === 'ready').reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0),
          canvasRgbaBytes: canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0),
          maxCanvasPixels: Math.max(0, ...canvases.map(canvas => canvas.width * canvas.height)) };
      }),
    });
    const open = async () => {
      await reader.setViewportSize(plan!.viewport);
      await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
      const start = performance.now();
      await reader.locator('#file-input').setInputFiles(sample.file);
      await expect(reader.locator('#page-count')).toHaveText(String(sample.pages));
      const currentPage = await reader.locator('#page-number').inputValue();
      await expect(reader.locator(`.pdf-page[data-page-number="${currentPage}"]`)).toHaveAttribute('data-rendered', 'ready', { timeout: 30_000 });
      return Math.round(performance.now() - start);
    };
    try {
      checkpoint('opening');
      measurements.openMs = await open();
      measurements.firstMemory = await memory();
      for (const pageNumber of sample.jumpPages) {
        checkpoint(`jump-${pageNumber}`);
        const start = performance.now();
        await jump(reader, pageNumber);
        (measurements.jumps as unknown[]).push({ pageNumber, readyMs: Math.round(performance.now() - start), memory: await memory() });
      }
      await setMiddlePosition(reader, sample.pages);
      checkpoint('wheel');
      await reader.locator('#document-stage').hover();
      await reader.evaluate(() => {
        const scope = globalThis as any; scope.pdfReadingFrameGaps = []; scope.pdfReadingObserveFrames = true;
        let previous: number | undefined;
        const frame = (now: number) => { if (previous !== undefined) scope.pdfReadingFrameGaps.push(now - previous); previous = now; if (scope.pdfReadingObserveFrames) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      });
      for (let step = 0; step < 12; step++) { await reader.mouse.wheel(0, step < 6 ? 180 : -180); await reader.waitForTimeout(80); }
      measurements.scrollFrames = await reader.evaluate(() => {
        const scope = globalThis as any; scope.pdfReadingObserveFrames = false;
        return { frameGapsMs: scope.pdfReadingFrameGaps, scrollTop: document.querySelector('#document-stage')!.scrollTop };
      });
      await setMiddlePosition(reader, sample.pages);
      checkpoint('zoom');
      const beforeZoom = await position(reader);
      const zoomStart = performance.now();
      await clickPdfReaderAction(reader, 'zoom-in');
      await expect(reader.locator('#zoom-value')).toHaveText('150%');
      await expect(reader.locator(`.pdf-page[data-page-number="${beforeZoom.pageNumber}"]`)).toHaveAttribute('data-rendered', 'ready');
      await clickPdfReaderAction(reader, 'zoom-out');
      await expect(reader.locator('#zoom-value')).toHaveText('125%');
      await expect(reader.locator(`.pdf-page[data-page-number="${beforeZoom.pageNumber}"]`)).toHaveAttribute('data-rendered', 'ready');
      const afterZoom = await position(reader);
      const zoomDriftPx = Math.abs(beforeZoom.ratio - afterZoom.ratio) * beforeZoom.height;
      measurements.zoom = { totalMs: Math.round(performance.now() - zoomStart), beforeZoom, afterZoom, zoomDriftPx };
      if (beforeZoom.canScroll && (beforeZoom.pageNumber !== afterZoom.pageNumber || zoomDriftPx > 8)) issues.push('zoom changed reading position');
      checkpoint('search');
      if (sample.searchQuery) {
        const origin = await position(reader);
        await clickPdfReaderAction(reader, 'open-search');
        const start = performance.now();
        await reader.locator('#pdf-search-query').fill(sample.searchQuery);
        await expect(reader.locator('#pdf-search-results .pdf-search-result').first()).toBeVisible({ timeout: 30_000 });
        await reader.locator('#pdf-search-results .pdf-search-result').first().click();
        const searchMs = Math.round(performance.now() - start);
        const destination = await position(reader);
        await reader.locator('#pdf-search-query').press('Escape');
        await expect(reader.locator('#pdf-search')).toBeHidden();
        const hasReturn = await reader.locator('#pdf-link-return').isVisible();
        let returned: Awaited<ReturnType<typeof position>> | undefined;
        if (hasReturn) { await reader.locator('#pdf-link-return').click(); returned = await position(reader); }
        else issues.push('source search has no return-to-reading control');
        if (returned && (returned.pageNumber !== origin.pageNumber || Math.abs(returned.scrollTop - origin.scrollTop) > 8)) issues.push('search return changed reading position');
        measurements.search = { query: sample.searchQuery, searchMs, origin, destination, hasReturn, returned };
      } else measurements.search = { applicable: false, reason: 'Image-only scan; no OCR requested.' };
      await setMiddlePosition(reader, sample.pages);
      checkpoint('resume');
      const beforeClose = await position(reader);
      const key = createHash('sha256').update(`pdf-content:${sample.sha256}`).digest('hex').slice(0, 32);
      await expect.poll(async () => worker.evaluate(async key => {
        const stored = await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1');
        return stored.piPdfReadingStatesV1?.[key]?.pageNumber;
      }, key)).toBe(beforeClose.pageNumber);
      await reader.screenshot({ path: info.outputPath('reading.png') });
      measurements.lastMemory = await memory();
      await reader.close({ runBeforeUnload: true });
      await expect.poll(() => reader.isClosed()).toBe(true);
      reader = await context.newPage(); cdp = await context.newCDPSession(reader);
      measurements.reopenMs = await open();
      const afterClose = await position(reader);
      const reopenDriftPx = Math.abs(afterClose.ratio - beforeClose.ratio) * beforeClose.height;
      measurements.resume = { beforeClose, afterClose, reopenDriftPx };
      if (beforeClose.canScroll && (beforeClose.pageNumber !== afterClose.pageNumber || reopenDriftPx > 8)) issues.push('reopen changed reading position');
      expect((measurements.lastMemory as Awaited<ReturnType<typeof memory>>).dom.maxCanvasPixels).toBeLessThanOrEqual(12_000_000);
      checkpoint('narrow');
      if (sample.id === 'long' || sample.id === 'columns') {
        await reader.setViewportSize({ width: 360, height: 780 });
        await reader.locator('#pdf-reader-menu > summary').click();
        await reader.locator('#fit-width').click();
        await reader.keyboard.press('Escape');
        await expect.poll(() => reader.locator('.pdf-page').first().evaluate(page => Math.abs(page.getBoundingClientRect().width - (document.querySelector<HTMLElement>('#document-stage')!.clientWidth - 30)))).toBeLessThanOrEqual(1);
        const current = await reader.locator('#page-number').inputValue();
        await expect(reader.locator(`.pdf-page[data-page-number="${current}"]`)).toHaveAttribute('data-rendered', 'ready');
        measurements.narrow = await reader.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth }));
        expect((measurements.narrow as { overflow: number }).overflow).toBeLessThanOrEqual(1);
        await reader.screenshot({ path: info.outputPath('reading-narrow.png') });
      }
      expect(textRequests.length + visionRequests.length).toBe(callsBefore);
      expect(await worker.evaluate(() => (globalThis as any).pdfReadingProviderAttempts)).toBe(0);
      expect(issues).toEqual([]);
    } finally {
      measurements.issues = issues;
      writeFileSync(info.outputPath('measurements.json'), JSON.stringify(measurements, null, 2));
      await reader.close();
    }
  });
}
