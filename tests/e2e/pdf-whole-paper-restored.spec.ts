import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const artifact=process.env.PI_ACCEPTANCE_SNAPSHOT??'output/pdf/formula-reliability-2026-10-14/completed-continuation-snapshot.json';

test('restores every actual paper result and checks all numbers and exports without any model requests',async({},testInfo)=>{
  test.skip(!process.env.PI_PDF_REGRESSION_SOURCE||!existsSync(artifact),'Optional local paper and recorded actual acceptance result required.');
  test.setTimeout(150_000);
  const recorded=JSON.parse(await readFile(artifact,'utf8'));
  const requestStart={text:textRequests.length,vision:visionRequests.length};
  const reader=await context.newPage();
  try{
    await reader.setViewportSize({width:1500,height:1040});
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.evaluate(async({model,sessions})=>{
      const chrome=(globalThis as any).chrome,stored=await chrome.storage.local.get('extensionSettings');
      const apiBaseUrl='https://www.overleaf.com/pi-translator-e2e-vision';
      await chrome.storage.local.set({extensionSettings:{...stored.extensionSettings,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',
        apiProfiles:[{id:'default',name:'已保存实际结果',apiBaseUrl,model},{id:'vision-e2e',name:'离线查看',apiBaseUrl,model}]}});
      await chrome.storage.session.set({pdfDocumentTranslationSessionsV1:sessions});
    },{model:recorded.model,sessions:recorded.sessions});
    await reader.reload();await reader.locator('#file-input').setInputFiles(process.env.PI_PDF_REGRESSION_SOURCE!);
    await reader.locator('#translate-document').click();
    await expect(reader.locator('#pdf-document-translation-status')).toContainText('已恢复');
    // Current restoration reconstructs preserved references locally. Older
    // snapshots may still need Start to finalize that policy; neither path
    // should request the already translated paragraphs again.
    if (await reader.locator('#pdf-document-translation').getAttribute('data-phase') !== 'complete') {
      await reader.locator('#pdf-document-translation-primary').click();
    }
    await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
    await expect(reader.locator('#pdf-document-translation-status')).toContainText(`${recorded.sourceCount??176}/${recorded.sourceCount??176}`);
    await expect(reader.locator('#pdf-document-translation-status')).not.toContainText('待核对');
    await expect(reader.locator('#pdf-document-translation-status')).not.toContainText('保留原文');
    await reader.locator('#pdf-document-translation-view-reading').click();
    const numbers=Array.from({length:17},(_,i)=>String(i+1));
    expect((await reader.locator('.pi-equation-tag').allTextContents()).map(value=>value.replace(/[()]/gu,'')).sort((a,b)=>Number(a)-Number(b))).toEqual(numbers);
    expect(await reader.locator('[data-translation-block="P3B20"] .pdf-equation-row-group .pi-equation-tag').allTextContents()).toEqual(['(10)','(11)']);
    await expect(reader.locator('.pdf-formula-reference-review')).toHaveCount(0);
    await reader.screenshot({path:testInfo.outputPath('whole-paper-reading.png')});
    for(const id of ['P1B5','P2B1','P3B20','P5B12','P6B2']){
      const card=reader.locator(`[data-translation-block="${id}"]`);
      await expect(card).toHaveAttribute('data-status','done');
      await card.scrollIntoViewIfNeeded();await card.screenshot({path:testInfo.outputPath(`${id}-whole-result.png`)});
      if(['P2B1','P3B20'].includes(id)&&await card.locator('.pdf-equation-row-group').count())await card.locator('.pdf-equation-row-group').last().screenshot({path:testInfo.outputPath(`${id}-independent-labels.png`)});
    }
    await expect(reader.locator('[data-translation-block="P1B5"]')).toContainText('¹西湖大学');
    expect(await reader.locator('[data-translation-block="P5B12"] .pi-equation-tag').allTextContents()).toEqual(['(17)']);
    await expect(reader.locator('[data-translation-block="P2B1"] math mi[mathvariant="double-struck"]').first()).toHaveText('ℝ');
    const menu=reader.locator('#pdf-document-translation-copy-menu > summary');await menu.click();
    const mdDownload=reader.waitForEvent('download');await reader.locator('#pdf-document-translation-download-translation').click();
    await(await mdDownload).saveAs(testInfo.outputPath('whole-paper-translation.md'));
    const markdown=await readFile(testInfo.outputPath('whole-paper-translation.md'),'utf8');
    expect([...markdown.matchAll(/\\tag\{(\d+)\}/gu)].map(match=>match[1]).sort((a,b)=>Number(a)-Number(b))).toEqual(numbers);
    expect(markdown).toContain(String.raw`\boldsymbol{y}`);expect(markdown).toContain(String.raw`\mathbb{R}`);
    if(await reader.locator('#pdf-document-translation-copy-menu').getAttribute('open')===null)await menu.click();
    const htmlDownload=reader.waitForEvent('download',{timeout:90_000});await reader.locator('#pdf-document-translation-download-html').click();
    await(await htmlDownload).saveAs(testInfo.outputPath('whole-paper-with-source.html'));
    const html=await readFile(testInfo.outputPath('whole-paper-with-source.html'),'utf8');
    expect(html).toContain('ℝ');expect(html).toContain('西湖大学');
    expect(textRequests).toHaveLength(requestStart.text);expect(visionRequests).toHaveLength(requestStart.vision);
    const report={model:recorded.model,providerHost:recorded.providerHost,phase:'complete',finalStatus:await reader.locator('#pdf-document-translation-status').textContent(),
      resume:{provenance:recorded.provenance,changes:recorded.changes},finalSnapshot:await reader.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1),
      cards:await reader.locator('[data-translation-block]').evaluateAll(elements=>elements.map(element=>({id:(element as HTMLElement).dataset.translationBlock,status:(element as HTMLElement).dataset.status}))),
      evidence:'Offline restoration of actual model results; zero new model requests. Whole native run and one targeted prompt-fix response recorded separately.'};
    await writeFile(testInfo.outputPath('whole-paper-report.json'),JSON.stringify(report,null,2));
  }finally{await reader.close()}
});
