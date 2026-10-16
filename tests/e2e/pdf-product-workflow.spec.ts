import {openPdfTranslationOptions,openPdfTranslationSettings} from './support/pdf-controls';
import type {Route} from '@playwright/test';
import {context,createTwoPageTextPdf,createRasterPdf,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {createNumberedPdf} from '../support/numbered-pdf';
import {pdfReviewConfirmation} from '../../core/pdf/review-queue';
installEdgeExtensionHooks();

test('explains why a formula cannot be trial-translated in text-only mode without issuing a request',async()=>{
  const reader=await context.newPage();
  try{
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'formula-trial-mode.pdf',mimeType:'application/pdf',buffer:createNumberedPdf()});
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-multimodal-toggle').uncheck();
    await reader.locator('#pdf-document-trial > summary').click();
    const id=await reader.locator('#pdf-document-trial-block option').last().getAttribute('value');
    await reader.locator('#pdf-document-trial-block').selectOption(id!);
    await expect(reader.locator('#pdf-document-trial-start')).toBeDisabled();
    await expect(reader.locator('#pdf-document-trial-block')).toBeEnabled();
    await expect(reader.locator('#pdf-document-trial-note')).toContainText('纯文本模式会保留原文');
    expect(textRequests).toHaveLength(0);expect(visionRequests).toHaveLength(0);
  }finally{await reader.close()}
});

test('includes scanned-page OCR in the request limit and preserves its selectable result', async () => {
  const reader = await context.newPage();
  await reader.addInitScript(() => {
    const runtime = (globalThis as any).chrome.runtime;
    const send = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (message: any, ...args: unknown[]) => message?.type === 'RECOGNIZE_PDF_PAGE'
      ? Promise.resolve({ ok: true, data: { page: { pageNumber: 1, coordinateSystem: 'normalized-page', source: 'qwen-advanced-recognition', blocks: [{
        id: 'budget-ocr', order: 0, text: 'The scanned paragraph describes a controlled experiment.',
        confidence: .95, confidenceSource: 'trusted-adapter', kind: 'text', box: { left: .1, top: .2, width: .8, height: .08 },
      }] } } }) : send(message, ...args);
  });
  const before = textRequests.length;
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({ name: 'budget-scan.pdf', mimeType: 'application/pdf', buffer: createRasterPdf() });
    await reader.locator('#translate-document').click();
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('1');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'paused');
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('识别结果已保留');
    await expect(reader.locator('[data-pi-ocr-block="budget-ocr"]')).toHaveCount(1);
    expect(textRequests).toHaveLength(before);
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open');
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-request-limit').fill('3');
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase', 'complete');
    expect(textRequests).toHaveLength(before + 1);
  } finally { await reader.close(); }
});

for (const width of [360, 1300]) {
test(`tries one PDF paragraph, pauses at the request limit and reuses it when continuing, width=${width}`,async ({},testInfo)=>{
  const reader=await context.newPage();
  const captureState=async(state:string)=>{
    if(state==='complete')await expect(reader.locator('#pdf-document-translation-copy-feedback')).toBeEmpty();
    await reader.locator('.pdf-document-translation-title').click();
    for(const theme of ['light','dark'] as const){
      await reader.emulateMedia({colorScheme:theme});
      await expect(reader.locator('#pdf-document-translation-status')).toBeVisible();
      await expect.poll(()=>reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      await reader.screenshot({path:testInfo.outputPath(`state-${state}-${theme}.png`)});
    }
    await reader.emulateMedia({colorScheme:'light'});
  };
  const requests: string[][]=[];
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const handle=async (route:Route)=>{
    const body=route.request().postDataJSON();
    const user=JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content);
    requests.push(user.segments.map((item:{id:string})=>item.id));
    if (requests.length >= 2) await responseGate;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{content:JSON.stringify({
      translation:'这是完整的中文说明，用于验证试译后继续的操作。',detectedLanguage:'en',warnings:[],
      segments:user.segments.map((item:{id:string;text:string})=>({id:item.id,translation:item.text.includes('first paragraph')
        ? '第一段介绍了用于图像重建的实验方法。' : '第二段说明了评估设置和测量结果。'})),
    })}}]})});
  };
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/chat/completions',handle);
  try {
    await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.setViewportSize({width,height:1000});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'演示文本-全文翻译.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf(
      'The first paragraph describes image reconstruction.',
      'The second paragraph explains the evaluation settings.')});
    await reader.locator('#translate-document').click();
    expect(requests).toHaveLength(0);
    await expect(reader.locator('#pdf-document-translation-copy-menu')).toBeHidden();
    const setupBox=await reader.locator('#pdf-document-translation-settings').boundingBox();
    const startBox=await reader.locator('#pdf-document-translation-primary').boundingBox();
    expect(setupBox!.y+setupBox!.height).toBeLessThanOrEqual(startBox!.y);
    await captureState('ready');
    await openPdfTranslationOptions(reader);
    await reader.locator('#pdf-document-budget-details > summary').click();await reader.locator('#pdf-document-request-limit').fill('1');
    await reader.locator('#pdf-document-trial > summary').click();await reader.locator('#pdf-document-trial-start').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await expect(reader.locator('[data-translation-block][data-status="done"]')).toHaveCount(1);
    await expect(reader.locator('#pdf-document-translation-settings')).toBeHidden();
    await expect(reader.locator('#pdf-document-review')).toBeHidden();
    await expect(reader.locator('#pdf-document-trial')).toBeHidden();
    await captureState('paused');
    expect(requests).toHaveLength(1);
    await expect(reader.locator('#pdf-document-request-usage')).toContainText('30 tokens');
    const initial=requests[0]![0]!;
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('任务请求上限');
    expect(requests).toHaveLength(1);
    await openPdfTranslationSettings(reader);
    await reader.locator('#pdf-document-request-limit').fill('3');
    await reader.locator('#pdf-document-trial > summary').click();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','running');
    await expect.poll(() => requests.length).toBe(2);
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open');
    await expect(reader.locator('#pdf-document-request-limit')).toBeHidden();
    await expect(reader.locator('#pdf-document-trial')).toBeHidden();
    await expect(reader.locator('#pdf-document-translation-primary')).toHaveText('暂停');
    await expect(reader.locator('.pdf-document-translation-actions > button:visible')).toHaveText(['暂停','停止']);
    await expect(reader.locator('#pdf-document-translation-clear')).toBeHidden();
    await expect(reader.locator('#pdf-document-translation-copy-translation')).toBeHidden();
    await reader.locator('#pdf-document-translation-view-reading').click();
    await expect(reader.locator('body > .toolbar')).toBeHidden();
    await expect(reader.locator('.pdf-document-translation-view-switch button')).toHaveCount(2);
    expect((await reader.locator('#pdf-document-translation-reader').boundingBox())!.height).toBeGreaterThan(650);
    await captureState('running');
    await expect.poll(() => reader.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const menu=reader.locator('#pdf-document-translation-copy-menu');
    const more=menu.locator(':scope > summary');
    await expect(more).toHaveText('更多');
    await more.focus();await more.press('Enter');
    await expect(reader.locator('#pdf-document-translation-clear')).toBeVisible();
    await expect(reader.locator('#pdf-document-translation-copy-translation')).toBeVisible();
    const menuBox=await menu.locator(':scope > div').boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x+menuBox!.width).toBeLessThanOrEqual(width);
    await reader.screenshot({path:testInfo.outputPath('translation-more-light.png')});
    await reader.emulateMedia({colorScheme:'dark'});
    await reader.screenshot({path:testInfo.outputPath('translation-more-dark.png')});
    await reader.emulateMedia({colorScheme:'light'});
    if (width === 360) {
      await reader.setViewportSize({width,height:420});
      await reader.locator('#pdf-document-translation-clear').scrollIntoViewIfNeeded();
      const shortMenu=await menu.locator(':scope > div').boundingBox();
      expect(shortMenu!.y+shortMenu!.height).toBeLessThanOrEqual(420);
      await expect(reader.locator('#pdf-document-translation-clear')).toBeInViewport();
      await reader.screenshot({path:testInfo.outputPath('translation-more-short.png')});
      await reader.setViewportSize({width,height:1000});
    }
    await reader.locator('#pdf-document-translation-copy-translation').focus();
    await reader.locator('#pdf-document-translation-copy-translation').press('Escape');
    await expect(menu).not.toHaveAttribute('open');await expect(more).toBeFocused();
    await reader.mouse.move(0,0);
    await expect(reader.locator('#pdf-document-translation-primary')).toBeEnabled();
    await reader.screenshot({path:testInfo.outputPath('translation-running-light.png')});
    await reader.emulateMedia({colorScheme:'dark'});
    await expect(reader.locator('#pdf-document-translation-primary')).toBeEnabled();
    await reader.screenshot({path:testInfo.outputPath('translation-running-dark.png')});
    await reader.emulateMedia({colorScheme:'light'});
    await reader.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(globalThis as any).__piCopiedText=value}}}));
    await more.click();await reader.locator('#pdf-document-translation-copy-translation').click();
    await expect(reader.locator('#pdf-document-translation-copy-feedback')).toContainText('已复制 1 段译文');
    expect(await reader.evaluate(()=>(globalThis as any).__piCopiedText)).toContain('第一段介绍了用于图像重建的实验方法');
    await expect(menu).not.toHaveAttribute('open');
    expect(requests).toHaveLength(2);
    await more.click();
    await reader.locator('.pdf-document-translation-title').click();
    await expect(menu).not.toHaveAttribute('open');
    await openPdfTranslationSettings(reader);
    await expect(reader.locator('#pdf-document-request-limit')).toBeVisible();
    await reader.locator('#pdf-document-translation-settings > summary').click();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
    await expect(reader.locator('#pdf-document-trial')).toBeHidden();
    await expect(reader.locator('#pdf-document-review')).toBeHidden();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation-settings')).not.toHaveAttribute('open');
    await expect(reader.locator('#pdf-document-trial')).toBeHidden();
    await expect.poll(() => requests.length).toBe(3);
    releaseResponse();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect(reader.locator('[data-translation-block][data-status="done"]')).toHaveCount(2);
    // Pause aborts the pending request; resume sends that unfinished paragraph again.
    expect(requests).toHaveLength(3);
    expect(requests[1]).not.toContain(initial);
    expect(requests[2]).toEqual(requests[1]);
    await expect(reader.locator('#pdf-document-request-usage')).toContainText('60 tokens');
    await expect(reader.locator('#pdf-document-translation-settings')).toBeHidden();
    await expect(reader.locator('#pdf-document-translation-progress')).toBeHidden();
    await expect(reader.locator('#pdf-document-review')).toBeHidden();
    await expect(reader.locator('#pdf-document-trial')).toBeHidden();
    await expect(reader.locator('.pdf-document-translation-actions > button:visible')).toHaveCount(0);
    await captureState('complete');
    await reader.screenshot({path:testInfo.outputPath('trial-budget-complete.png')});
  } finally {releaseResponse();await reader.close();await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/chat/completions',handle);}
});
}

test('reviews preserved PDF results without clearing the model warning or sending requests',async ({},testInfo)=>{
  const reader=await context.newPage();
  await reader.addInitScript(()=>Object.defineProperty(File.prototype,'lastModified',{get:()=>1700000000000}));
  let requests=0;
  const handle=async(route:Route)=>{
    requests+=1;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({
      formulaFormat:'refs-v1',formulas:[{id:'m1',latex:'x=y',display:true,sourceEquationId:'eq-p99-x1-y1'}],
      recognizedText:'The following equations define the updates. {{m1}}',translation:'下列公式定义了两步更新，公式编号需要核对。{{m1}}',uncertainSpans:[],
    })}}]})});
  };
  await context.route('https://www.overleaf.com/pi-translator-e2e-vision/**',handle);
  const file={name:'review-queue.pdf',mimeType:'application/pdf',buffer:createNumberedPdf()};
  try {
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-primary').click();
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await reader.locator('#pdf-document-review > summary').click();
    await reader.locator('#pdf-document-review-filter').selectOption('formula');
    await expect(reader.locator('#pdf-document-review-list [data-review-block]').first()).toBeVisible();
    const before=requests;
    await reader.locator('#pdf-document-review-list').getByRole('button',{name:'标记已核对'}).first().click();
    await expect(reader.locator('#pdf-document-review-summary')).toContainText('1 段已人工核对');
    const stored = await reader.evaluate(async () => (globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1'));
    const blocks = stored.pdfDocumentTranslationSessionsV1.flatMap((item: any) => item.blocks);
    const acknowledged = blocks.find((item: any) => item.reviewConfirmation);
    expect(acknowledged).toBeDefined();
    expect(acknowledged.reviewConfirmation).toBe(pdfReviewConfirmation({ ...acknowledged, id: 'test', pageNumber: 1, status: 'done', included: true }));
    expect(requests).toBe(before);
    await expect(reader.locator('[data-translation-mode="review"]').first()).toBeVisible();
    await reader.reload();
    await reader.locator('#file-input').setInputFiles(file);
    await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-review-summary')).toContainText('1 段已人工核对');
    expect(requests).toBe(before);
    await reader.locator('#pdf-document-review > summary').click();
    await reader.screenshot({path:testInfo.outputPath('review-queue-restored.png')});
  } finally {await reader.close();await context.unroute('https://www.overleaf.com/pi-translator-e2e-vision/**',handle);}
});
