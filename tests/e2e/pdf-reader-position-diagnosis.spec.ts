import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { clickPdfReaderAction } from './support/translation-controls';
import { context, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests } from './support/edge-extension-fixture';

const plan = process.env.PI_PDF_READING_PLAN ? JSON.parse(readFileSync(process.env.PI_PDF_READING_PLAN, 'utf8')) : undefined;
installEdgeExtensionHooks();
test.skip(!plan, 'Fixed local source plan required; no model requests.');

for (const scenario of [
  { id: 'columns', action: 'zoom', blurFirst: false },
  { id: 'columns', action: 'zoom', blurFirst: true },
  { id: 'columns', action: 'close', blurFirst: false },
  { id: 'columns', action: 'close', blurFirst: true },
  { id: 'scan', action: 'zoom', blurFirst: true },
  { id: 'scan', action: 'close', blurFirst: true },
  { id: 'columns', action: 'close', blurFirst: false, immediate: true },
  { id: 'columns', action: 'close', blurFirst: true, immediate: true },
]) test(`diagnoses page anchor ${scenario.id} ${scenario.action} blur=${scenario.blurFirst}${'immediate' in scenario ? ' immediate' : ''}`, async ({}, info) => {
  const source = plan.samples.find((s: any) => s.id === scenario.id);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async () => { await (globalThis as any).chrome.storage.local.set({ piPdfReadingStatesV1: {} }); });
  const events: unknown[] = [];
  const output: Record<string, unknown> = { ...scenario, sourceSha256: source.sha256, events };
  let reader = await context.newPage();
  await reader.setViewportSize(plan.viewport);
  await reader.exposeFunction('recordPdfAnchorEvent', (data: unknown) => { events.push(data); });
  const state = () => reader.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('#document-stage')!;
    return { scrollTop: stage.scrollTop, focus: (document.activeElement as HTMLElement)?.id,
      pageNumber: (document.querySelector('#page-number') as HTMLInputElement).value,
      pages: [...document.querySelectorAll<HTMLElement>('.pdf-page')].map(p => {
        const box = p.getBoundingClientRect(), area = stage.getBoundingClientRect();
        return { number: p.dataset.pageNumber, top: box.top - area.top, height: box.height,
          visible: Math.max(0, Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top)) };
      }).filter(p => p.visible > 0) };
  });
  const key = createHash('sha256').update(`pdf-content:${source.sha256}`).digest('hex').slice(0, 32);
  const stored = () => worker.evaluate(async key => (await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1?.[key], key);
  const open = async () => {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(source.file);
    await expect(reader.locator('#page-count')).toHaveText(String(source.pages));
    const current = await reader.locator('#page-number').inputValue();
    await expect(reader.locator(`.pdf-page[data-page-number="${current}"]`)).toHaveAttribute('data-rendered', 'ready');
  };
  try {
    await open();
    await reader.evaluate(() => {
      const input = document.querySelector('#page-number')!;
      for (const type of ['change', 'blur', 'keydown']) input.addEventListener(type, (event: Event) => {
        void (globalThis as any).recordPdfAnchorEvent({ type, key: (event as KeyboardEvent).key,
          scrollTop: document.querySelector('#document-stage')!.scrollTop,
          value: (input as HTMLInputElement).value });
      }, true);
    });
    const middle = Math.max(1, Math.ceil(source.pages / 2));
    await reader.locator('#page-number').fill(String(middle));
    await reader.locator('#page-number').press('Enter');
    await expect(reader.locator(`.pdf-page[data-page-number="${middle}"]`)).toHaveAttribute('data-rendered', 'ready');
    if (scenario.blurFirst) await reader.locator('#page-number').press('Tab');
    await reader.locator('#document-stage').hover();
    const initialScroll = await reader.locator('#document-stage').evaluate(stage => stage.scrollTop);
    await reader.mouse.wheel(0, 250);
    if ('immediate' in scenario) {
      await expect.poll(() => reader.locator('#document-stage').evaluate(stage => stage.scrollTop)).toBeGreaterThan(initialScroll + 100);
    } else await reader.waitForTimeout(500); // Observe one scroll and the existing 320 ms save debounce.
    output.before = await state(); output.storedBefore = await stored();
    if (scenario.action === 'zoom') {
      await clickPdfReaderAction(reader, 'zoom-in');
      await expect(reader.locator('#zoom-value')).toHaveText('150%');
      await expect(reader.locator('.pdf-page[data-rendered="ready"]').first()).toBeAttached();
      await clickPdfReaderAction(reader, 'zoom-out');
      await expect(reader.locator('#zoom-value')).toHaveText('125%');
      await reader.waitForTimeout(400);
      output.after = await state(); output.storedAfter = await stored();
    } else {
      await reader.close({ runBeforeUnload: true });
      await expect.poll(() => reader.isClosed()).toBe(true);
      output.storedAfterClose = await stored();
      reader = await context.newPage(); await reader.setViewportSize(plan.viewport);
      await open(); await reader.waitForTimeout(100);
      output.after = await state(); output.storedAfter = await stored();
    }
    expect(textRequests.length + visionRequests.length).toBe(0);
  } finally {
    writeFileSync(info.outputPath('diagnosis.json'), JSON.stringify(output, null, 2));
    await reader.close();
  }
});
