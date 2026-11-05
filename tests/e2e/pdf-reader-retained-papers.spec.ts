import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { context, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests } from './support/edge-extension-fixture';

const file = process.env.PI_PDF_READING_REPLAY;
const input = file ? readFileSync(file) : undefined;
const replay = input ? JSON.parse(input.toString()) : undefined;
installEdgeExtensionHooks();
test.skip(!replay, 'Opt-in existing real translations; no new model requests.');

test('keeps actual old translations, formulas and corrections while reopening and navigating retained papers', async ({}, info) => {
  test.setTimeout(120_000);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(async records => {
    const scope = globalThis as any, original = scope.fetch.bind(scope);
    scope.retainedReadingProviderAttempts = 0;
    scope.retainedReadingSaves = [];
    scope.chrome.runtime.onMessage.addListener((message: any) => {
      if (message?.type === 'SAVE_PDF_READING_STATE') scope.retainedReadingSaves.push(message.payload);
    });
    scope.fetch = (...args: any[]) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
      if (/^https?:/u.test(url)) { scope.retainedReadingProviderAttempts++; throw new Error('Provider blocked during historical replay'); }
      return original(...args);
    };
    await scope.chrome.storage.local.set({ pdfDocumentTranslationRetainedV1: records });
  }, replay.records);
  const positions: unknown[] = [];
  for (const record of replay.records) {
    const id = JSON.stringify(['pdf', record.documentKey, record.targetLanguage, record.sourceLanguage, record.style, record.contentMode]);
    const url = `chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(id)}`;
    let reader = await context.newPage();
    const position = () => reader.locator('#pdf-document-translation-pages').evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      const block = [...panel.querySelectorAll<HTMLElement>('[data-reading-signature]')].find(node => {
        const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top + 4 && rect.height > 0;
      });
      return { signature: block?.dataset.readingSignature, offset: block ? bounds.top - block.getBoundingClientRect().top : 0, scrollTop: panel.scrollTop,
        blockHeight: block?.getBoundingClientRect().height, fonts: document.fonts.status };
    });
    const open = async () => {
      await reader.setViewportSize({ width: 1100, height: 850 });
      await reader.goto(url);
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
      await expect(reader.locator('[data-translation-block]')).toHaveCount(record.blocks.length);
    };
    try {
      await open();
      const blocks = reader.locator('[data-reading-signature]');
      await blocks.nth(Math.floor(record.blocks.length / 2)).evaluate(node => {
        const panel = node.closest('#pdf-document-translation-pages')!;
        panel.scrollTop += node.getBoundingClientRect().top - panel.getBoundingClientRect().top + Math.min(50, node.getBoundingClientRect().height * .25);
      });
      await reader.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const before = await position();
      await reader.close({ runBeforeUnload: true });
      await expect.poll(() => reader.isClosed()).toBe(true);
      writeFileSync(info.outputPath(`save-diagnosis-${positions.length + 1}.json`), JSON.stringify(await worker.evaluate(async () => ({
        messages: (globalThis as any).retainedReadingSaves,
        states: (await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1,
      })), null, 2));
      const key = createHash('sha256').update(`pdf-content:${record.sourceFingerprint}`).digest('hex').slice(0, 32);
      await expect.poll(() => worker.evaluate(async key => (await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1?.[key]?.translation?.signature, key)).toBe(before.signature);
      reader = await context.newPage();
      await open();
      writeFileSync(info.outputPath(`opened-${positions.length + 1}.json`), JSON.stringify({documentKey: record.documentKey, before, reopened: await position()}, null, 2));
      await expect.poll(async () => (await position()).signature).toBe(before.signature);
      const immediate = await position();
      await reader.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const after = await position();
      writeFileSync(info.outputPath(`position-${positions.length + 1}.json`), JSON.stringify({documentKey: record.documentKey, before, immediate, after}, null, 2));
      expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(8);
      const references = reader.locator('.pdf-research-reference');
      const referenceCount = await references.count();
      if (referenceCount) {
        const reference = references.first();
        await reference.scrollIntoViewIfNeeded();
        const origin = await position();
        await reference.click();
        await expect(reader.locator('#pdf-research-return')).toBeVisible();
        await reader.locator('#pdf-research-return').click();
        expect(Math.abs((await position()).scrollTop - origin.scrollTop)).toBeLessThanOrEqual(1);
      }
      positions.push({ documentKey: record.documentKey, blocks: record.blocks.length, before, after, referenceCount });
      await reader.screenshot({ path: info.outputPath(`retained-${positions.length}.png`) });
    } finally { await reader.close(); }
  }
  const retained = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1);
  expect(retained).toEqual(replay.records);
  expect(textRequests.length + visionRequests.length).toBe(0);
  expect(await worker.evaluate(() => (globalThis as any).retainedReadingProviderAttempts)).toBe(0);
  writeFileSync(info.outputPath('retained-replay.json'), JSON.stringify({ inputSha256: createHash('sha256').update(input!).digest('hex'), positions, unchanged: true, newModelRequests: 0 }, null, 2));
});
