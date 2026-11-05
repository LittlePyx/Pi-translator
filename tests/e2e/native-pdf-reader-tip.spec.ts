import {context, expect, extensionId, installEdgeExtensionHooks, test, textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('offers a dismissible native PDF reader tip without disturbing translations', async ({}, info) => {
  const worker=context.serviceWorkers()[0]!;
  const keys=['nativePdfReaderGuideDismissedV1','featureDiscoveryV1:completed:pdf-reader'];
  const before=await worker.evaluate(async keys=>await (globalThis as any).chrome.storage.local.get(keys),keys);
  const panel=await context.newPage(), sender=await context.newPage();
  try {
    await worker.evaluate(async keys=>await (globalThis as any).chrome.storage.local.remove(keys),keys);
    await panel.setViewportSize({width:360,height:760});
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId=await sender.evaluate(async()=> (await (globalThis as any).chrome.tabs.getCurrent()).id);
    const session={tabId,requestId:'reader-tip-demo',sourceText:'A passage to read.',pageUrl:'https://www.overleaf.com/example.pdf',pageNumber:3,sourceLabel:'example.pdf',status:'complete',startedAt:Date.now(),result:{requestId:'reader-tip-demo',originalText:'A passage to read.',translatedText:'一段阅读材料。',warnings:[],latencyMs:10}};
    const send=(payload:object=session)=>sender.evaluate(async item=>await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload:item}),payload);
    const requestsBefore=textRequests.length;
    await send({...session,status:'translating',result:undefined});await expect(panel.locator('#native-pdf-reader-tip')).toBeHidden();
    await send();
    const tip=panel.locator('#native-pdf-reader-tip'), action=panel.locator('#pdf-reader-guide-action');
    await expect(tip).toBeVisible();await expect(tip).toContainText('划词、笔记与原文对照');await expect(action).toHaveText('用 Pi 打开 PDF');
    await expect(panel.locator('#translation-text')).toContainText('一段阅读材料');
    await panel.screenshot({path:info.outputPath('tip-light.png')});
    await panel.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await panel.screenshot({path:info.outputPath('tip-dark.png')});
    await panel.setViewportSize({width:360,height:420});await expect(tip).toBeHidden();await expect(action).toBeVisible();
    await panel.setViewportSize({width:360,height:760});await tip.getByRole('button',{name:'不再显示阅读器提示'}).click();
    await expect(tip).toBeHidden();await expect(action).toBeFocused();await expect(panel.locator('#translation-text')).toContainText('一段阅读材料');
    await expect.poll(()=>worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('nativePdfReaderGuideDismissedV1')).nativePdfReaderGuideDismissedV1)).toBe(true);
    await send();await expect(tip).toBeHidden();await panel.reload();await send();await expect(action).toBeVisible();await expect(panel.locator('#translation-text')).toContainText('一段阅读材料');await expect(tip).toBeHidden();
    await worker.evaluate(async()=>{await (globalThis as any).chrome.storage.local.remove('nativePdfReaderGuideDismissedV1');await (globalThis as any).chrome.storage.local.set({'featureDiscoveryV1:completed:pdf-reader':true})});
    await panel.reload();await send();await expect(tip).toBeHidden();await expect(action).toBeVisible();expect(textRequests.length).toBe(requestsBefore);
  } finally {
    await panel.close();await sender.close();
    await worker.evaluate(async({keys,before})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);if(Object.keys(before).length)await s.set(before)},{keys,before});
  }
});

test('localizes the native PDF reader tip in English', async () => {
  const worker=context.serviceWorkers()[0]!;
  const keys=['uiLanguagePreference','nativePdfReaderGuideDismissedV1','featureDiscoveryV1:completed:pdf-reader'];
  const before=await worker.evaluate(async keys=>await (globalThis as any).chrome.storage.local.get(keys),keys);
  const panel=await context.newPage(), sender=await context.newPage();
  try {
    await worker.evaluate(async keys=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set({uiLanguagePreference:'en'})},keys);
    await panel.setViewportSize({width:360,height:760});await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId=await sender.evaluate(async()=> (await (globalThis as any).chrome.tabs.getCurrent()).id);
    await sender.evaluate(async tabId=>await (globalThis as any).chrome.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload:{tabId,requestId:'english-tip',sourceText:'A passage.',pageUrl:'https://www.overleaf.com/example.pdf',sourceLabel:'example.pdf',status:'complete',startedAt:Date.now(),result:{requestId:'english-tip',originalText:'A passage.',translatedText:'A translation.',warnings:[],latencyMs:10}}}),tabId);
    const tip=panel.locator('#native-pdf-reader-tip');await expect(tip).toBeVisible();await expect(tip).toContainText('Pi Reader brings selection translation');
    await expect(tip.getByRole('button',{name:"Don't show this reader tip again"})).toBeVisible();
    expect(await panel.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  } finally {
    await panel.close();await sender.close();await worker.evaluate(async({keys,before})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);if(Object.keys(before).length)await s.set(before)},{keys,before});
  }
});
