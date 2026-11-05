import {context,page,extensionId,installEdgeExtensionHooks,selectElementText,test,expect} from './support/edge-extension-fixture';
installEdgeExtensionHooks();

test('marks the exact visible quote when the selected DOM range also contains a hidden SVG title',async()=>{
 const worker=context.serviceWorkers()[0]!;
 const quote='A visible research paragraph describes recurrent neural networks.';
 await context.route('https://www.overleaf.com/pi-translator-e2e-api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({translation:'可见的科研段落描述循环神经网络。',detectedLanguage:'en',warnings:[],termCandidates:[]})},finish_reason:'stop'}]})}));
 await page.evaluate(quote=>{document.body.insertAdjacentHTML('afterbegin','<div id="selected-research">\n <p id="visible-research"></p><svg><title>rnn-hidden-title</title></svg></div>');document.querySelector('#visible-research')!.textContent=quote},quote);
 await selectElementText('#selected-research');
 await page.evaluate(()=>getSelection()!.getRangeAt(0).setStart(document.querySelector('#visible-research')!.firstChild!,0));
 expect(await page.evaluate(()=>getSelection()!.toString())).not.toContain('rnn-hidden-title');
 expect(await page.evaluate(()=>getSelection()!.getRangeAt(0).toString())).toContain('rnn-hidden-title');
 const host=page.locator('#tex-selection-translator-root');await host.locator('.trigger').click();await expect(host.locator('.copy-action:not(:disabled)')).toBeVisible();await host.locator('.mark-action').click();await expect(host.locator('.mark-action')).toHaveAttribute('aria-pressed','true');
 await host.locator('details.more > summary').click();await host.getByRole('button',{name:/查看本文标记/}).click();const row=host.locator('.marker-note');await row.locator('.marker-note-more > summary').click();await row.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();
 const records=await worker.evaluate(async()=>Object.values((await(globalThis as any).chrome.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1??{}).flat() as any[]);
 expect(records).toHaveLength(1);expect(records[0].anchor.sourceText).toBe(quote);expect(records[0].content.originalText).toBe(quote);
});
