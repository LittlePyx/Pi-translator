import {writeFile} from 'node:fs/promises';
import {openPdfTranslationSettings} from './support/pdf-controls';
import {context, expect, extensionId, installEdgeExtensionHooks, test} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test.skip(process.env.PI_LIVE_FORMULA_DIAGNOSIS !== '1', 'Opt-in public-paper diagnosis only.');
test.use({trace: 'off'});
test('records actual replies for the known affiliation, grouped numbering and inline variable issues', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const apiKey = process.env.QWEN_API_KEY!, base = process.env.QWEN_BASE_URL!, model = process.env.QWEN_MODEL!, source = process.env.PI_PDF_REGRESSION_SOURCE!;
  if (!apiKey || !base || !model || !source) throw new Error('Missing live settings');
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(({base, apiKey}) => {
    const scope = globalThis as any;
    const original = scope.fetch.bind(scope);
    scope.fetch = async (...args: any[]) => {
      const response = await original(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
      if (url.startsWith(base.replace(/\/+$/u, '')) && url.includes('/chat/completions')) {
        void response.clone().text().then(async (body: string) => {
          const stored = await scope.chrome.storage.session.get('piLiveReplyDiagnosis');
          const replies = stored.piLiveReplyDiagnosis ?? [];
          replies.push({status: response.status, body: body.slice(0, 100_000).replaceAll(apiKey, '[redacted]')});
          await scope.chrome.storage.session.set({piLiveReplyDiagnosis: replies});
        });
      }
      return response;
    };
  }, {base, apiKey});
  const reader = await context.newPage();
  const stages: any[] = [];
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async ({base, apiKey, model}) => {
      const chrome = (globalThis as any).chrome;
      const stored = await chrome.storage.local.get('extensionSettings');
      await chrome.storage.local.set({extensionSettings: {...stored.extensionSettings, apiBaseUrl: base, model, visionModel: model,
        apiProfiles: [{id:'default', name:'真实排查', apiBaseUrl:base, model}, {id:'vision-e2e', name:'真实视觉排查', apiBaseUrl:base, model}]}});
      await chrome.storage.session.set({apiKeysByProfile:{default:apiKey,'vision-e2e':apiKey}});
    }, {base, apiKey, model});
    await reader.reload(); await reader.locator('#file-input').setInputFiles(source); await reader.locator('#translate-document').click();
    const candidates=([[1,'P1B5'],[2,'P2B1'],[5,'P5B12'],[3,'P3B20'],[6,'P6B8'],[7,'P7B11']] as const);
    const cases=candidates.filter(([,id])=>process.env.PI_LIVE_DIAGNOSIS_BLOCKS?process.env.PI_LIVE_DIAGNOSIS_BLOCKS.split(',').includes(id):['P1B5','P2B1','P5B12'].includes(id));
    if(!cases.length)throw new Error('No known diagnosis block selected');
    for (const [page, block] of cases) {
      await openPdfTranslationSettings(reader);
      await reader.locator('#pdf-document-translation-range').selectOption('custom');
      await reader.locator('#pdf-document-translation-custom-pages').fill(String(page));
      await reader.locator('#pdf-document-translation-custom-range').getByRole('button',{name:'应用'}).click();
      if (await reader.locator('#pdf-document-trial').getAttribute('open') === null) await reader.locator('#pdf-document-trial > summary').click();
      await reader.locator('#pdf-document-trial-block').selectOption(block);
      await reader.locator('#pdf-document-trial-start').click();
      await expect(reader.locator(`[data-translation-block="${block}"]`)).toHaveAttribute('data-status','done',{timeout:150_000});
      await expect.poll(async () => (await worker.evaluate(async () => ((await (globalThis as any).chrome.storage.session.get('piLiveReplyDiagnosis')).piLiveReplyDiagnosis ?? []).length))).toBe(stages.length+1);
      const saved = await reader.evaluate(async () => (await (globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1);
      stages.push({page, block, saved, status:await reader.locator('#pdf-document-translation-status').textContent()});
      await reader.screenshot({path:testInfo.outputPath(`${block}-actual.png`)});
      if(process.env.PI_LIVE_FORMULA_EXPECT_CLEAN==='1'){
        await expect(reader.locator('#pdf-document-translation-status')).not.toContainText('待核对');
        await expect(reader.locator(`[data-translation-block="${block}"] .pdf-formula-reference-review`)).toHaveCount(0);
        if(process.env.PI_LIVE_EXPECT_SOURCE_GROUP==='1'){
          expect(await reader.locator(`[data-translation-block="${block}"] .pdf-equation-row-group .pi-equation-tag`).allTextContents()).toEqual(['(10)','(11)']);
        }
        await reader.locator('#pdf-document-translation-view-reading').click();
        await reader.locator(`[data-translation-block="${block}"]`).screenshot({path:testInfo.outputPath(`${block}-clean.png`)});
      }
    }
  } finally {
    const replies = await worker.evaluate(async () => (await (globalThis as any).chrome.storage.session.get('piLiveReplyDiagnosis')).piLiveReplyDiagnosis).catch(()=>[]);
    await writeFile(testInfo.outputPath('actual-replies.json'),JSON.stringify({model, providerHost:new URL(base).hostname, stages, replies},null,2).replaceAll(apiKey,'[redacted]'));
    await reader.close();
  }
});
