import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const recording='output/pdf/formula-reliability-2026-10-14/brace-final-actual/pdf-live-formula-diagnosis-89375--and-inline-variable-issues/parsed-replies.json';

test('restores the missing brace from local font evidence when replaying the exact independent-row response',async({},testInfo)=>{
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE||!existsSync(recording),'Optional local paper and recorded real reply required. No external calls.');
  test.setTimeout(90_000);
  const response=JSON.parse(await readFile(recording,'utf8'))[0].record;
  expect(response.formulas.filter((formula:any)=>formula.display)).toHaveLength(2);
  const reader=await context.newPage();let requests=0;
  const endpoint='https://www.overleaf.com/pi-translator-e2e-vision/**';
  await context.route(endpoint,async route=>{requests++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]})})});
  try{
    await reader.setViewportSize({width:1500,height:1040});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles(process.env.PI_PDF_REGRESSION_SOURCE!);await reader.locator('#translate-document').click();
    await reader.locator('#pdf-document-translation-range').selectOption('custom');await reader.locator('#pdf-document-translation-custom-pages').fill('3');
    await reader.locator('#pdf-document-translation-custom-range').getByRole('button',{name:'应用'}).click();
    await reader.locator('#pdf-document-trial > summary').click();await reader.locator('#pdf-document-trial-block').selectOption('P3B20');await reader.locator('#pdf-document-trial-start').click();
    const card=reader.locator('[data-translation-block="P3B20"]');
    await expect(card).toHaveAttribute('data-status','done');await expect(card.locator('.pdf-formula-reference-review')).toHaveCount(0);
    const group=card.locator('.pdf-equation-row-group');
    expect(await group.locator('.pi-equation-tag').allTextContents()).toEqual(['(10)','(11)']);
    expect(requests).toBe(1);
    await reader.locator('#pdf-document-translation-view-reading').click();
    await group.screenshot({path:testInfo.outputPath('restored-brace-10-11.png')});
    await reader.setViewportSize({width:390,height:844});await group.screenshot({path:testInfo.outputPath('restored-brace-narrow.png')});
    expect(await group.locator('.pi-equation-tag').allTextContents()).toEqual(['(10)','(11)']);
    await reader.setViewportSize({width:1500,height:1040});
    const saved=await reader.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1);
    const doc=saved.flatMap((session:any)=>session.blocks).find((block:any)=>block.formulaDocument?.formulas.some((formula:any)=>formula.equationNumber==='10')).formulaDocument;
    expect(doc.formulas.filter((formula:any)=>formula.display).map((formula:any)=>formula.latex)).toEqual(response.formulas.filter((formula:any)=>formula.display).map((formula:any)=>formula.latex));
    await writeFile(testInfo.outputPath('brace-recovery-evidence.json'),JSON.stringify({evidence:'Exact actual independent-row response replayed locally; local source font data restores brace; zero external model calls.',formulas:doc.formulas.filter((formula:any)=>formula.display)},null,2));
  }finally{await reader.close();await context.unroute(endpoint)}
});
