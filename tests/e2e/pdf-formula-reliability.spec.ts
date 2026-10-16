import {existsSync} from 'node:fs';
import {openPdfTranslationSettings} from './support/pdf-controls';
import {readFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const recorded='output/pdf/formula-reliability-2026-10-14/live-before/pdf-live-formula-diagnosis-89375--and-inline-variable-issues/parsed-replies.json';
test('replays actual replies locally with correct identifiers, independent labels and native font glyphs',async({},testInfo)=>{
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE||!existsSync(recorded),'Optional local paper and private recorded replies required. No external requests.');
  test.setTimeout(90_000);
  const replies=JSON.parse(await readFile(recorded,'utf8'));
  const reader=await context.newPage();let response:any,requests=0;
  const endpoint='https://www.overleaf.com/pi-translator-e2e-vision/**';
  await context.route(endpoint,async route=>{requests++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]})})});
  try{
    await reader.setViewportSize({width:1500,height:1040});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(process.env.PI_PDF_REGRESSION_SOURCE!);await reader.locator('#translate-document').click();
    for(const[page,id]of [[1,'P1B5'],[2,'P2B1'],[5,'P5B12']]as const){
      response=replies.find((entry:any)=>entry.block===id).record;
      await openPdfTranslationSettings(reader);
      await reader.locator('#pdf-document-translation-range').selectOption('custom');await reader.locator('#pdf-document-translation-custom-pages').fill(String(page));
      await reader.locator('#pdf-document-translation-custom-range').getByRole('button',{name:'应用'}).click();
      await reader.locator('#pdf-document-trial > summary').click();await reader.locator('#pdf-document-trial-block').selectOption(id);await reader.locator('#pdf-document-trial-start').click();
      const card=reader.locator(`[data-translation-block="${id}"]`);await expect(card).toHaveAttribute('data-status','done');
      await expect(card.locator('.pdf-formula-reference-review')).toHaveCount(0);
      if(id==='P1B5'){await expect(card).toContainText('¹西湖大学');await expect(card).toContainText('²浙江大学')}
      if(id==='P2B1'){
        expect(await card.locator('.pi-equation-tag').allTextContents()).toEqual(['(1)','(2)','(3)','(4)']);
        await expect(card.locator('math mi[mathvariant="bold-italic"]').first()).toHaveText('𝒚');
        await expect(card.locator('math mi[mathvariant="double-struck"]').first()).toHaveText('ℝ');
      }
      await card.scrollIntoViewIfNeeded();await card.screenshot({path:testInfo.outputPath(`${id}-replayed.png`)});
    }
    expect(requests).toBe(3);
    await reader.locator('#pdf-document-translation-copy-menu > summary').click();
    const download=reader.waitForEvent('download');await reader.locator('#pdf-document-translation-download-translation').click();
    const exported=await download;await exported.saveAs(testInfo.outputPath('replayed-formulas.md'));
    const markdown=await readFile(testInfo.outputPath('replayed-formulas.md'),'utf8');expect(markdown).toContain('$N$');expect(markdown).toContain('$pN$');
  }finally{await reader.close();await context.unroute(endpoint)}
});
