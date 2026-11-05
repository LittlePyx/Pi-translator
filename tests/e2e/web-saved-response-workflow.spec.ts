import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {context,expect,extensionId,installEdgeExtensionHooks,page,selectElementText,test} from './support/edge-extension-fixture';

const input=process.env.PI_WEB_CORE_REPLAY;
const bytes=input?readFileSync(input):undefined;
const replay=bytes?JSON.parse(bytes.toString()):undefined;
installEdgeExtensionHooks();
test.skip(!replay,'Set PI_WEB_CORE_REPLAY to the sealed six first responses.');
const notes:Record<string,string>={
  'mdn-sort-cross-code':'阅读笔记：排序会修改原数组，留意方法名和返回值。',
  'mdn-sort-nonmutation':'阅读笔记：需要保留原数组时，选择不原位修改的排序方法。',
  'react-snapshot-term':'阅读笔记：状态快照描述当前渲染所使用的状态。',
  'react-negation':'阅读笔记：区分状态变量更新和当前渲染中的旧值。',
  'python-binary-fractions':'阅读笔记：二进制浮点无法精确表示所有十进制小数。',
  'python-approximation-term':'阅读笔记：近似值需要结合表示误差理解。',
};

// Observe only the extension's existing isolated world. No clipboard permission is granted.
async function captureCopy(expected:string){
  const session=await context.newCDPSession(page),worlds:any[]=[];
  session.on('Runtime.executionContextCreated',event=>worlds.push(event.context));
  await session.send('Runtime.enable');
  const frame=(await session.send('Page.getFrameTree')).frameTree.frame.id;
  const matches=worlds.filter(world=>world.auxData?.frameId===frame&&!world.auxData?.isDefault&&
    [world.origin,world.name].some(value=>value===`chrome-extension://${extensionId}`||value===extensionId));
  expect(matches).toHaveLength(1);
  const evaluate=async(expression:string)=>{
    const response=await session.send('Runtime.evaluate',{contextId:matches[0].id,expression,returnByValue:true,awaitPromise:true});
    expect(response.exceptionDetails).toBeUndefined();return response.result.value;
  };
  try{
    await evaluate(`(()=>{globalThis.piReleaseCopy={descriptor:Object.getOwnPropertyDescriptor(navigator,'clipboard'),values:[]};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>piReleaseCopy.values.push(text)}})})()`);
    const copy=page.locator('#tex-selection-translator-root .copy-action');await copy.click();
    await expect(copy).toHaveAttribute('data-state','success');
    expect(await evaluate('piReleaseCopy.values')).toEqual([expected]);
  }finally{
    await evaluate(`(()=>{if(piReleaseCopy.descriptor)Object.defineProperty(navigator,'clipboard',piReleaseCopy.descriptor);else delete navigator.clipboard;delete globalThis.piReleaseCopy})()`);
    await session.detach();
  }
}

test('closes copy, readable note, search and source return for all six sealed first responses',async({},info)=>{
  test.setTimeout(180_000);
  const entries=replay.api.filter((entry:any)=>entry.status===200);expect(entries).toHaveLength(6);
  const worker=context.serviceWorkers()[0]!,options=await context.newPage(),results:any[]=[];
  const snapshot=()=>worker.evaluate(async()=>(globalThis as any).chrome.storage.local.get('piWebExcerptsV1'));
  let attempts=0,active:any;
  const fulfill=async(route:any)=>{
    attempts++;
    const request=route.request().postDataJSON();
    const sources=request.messages.map((message:any)=>{try{return JSON.parse(message.content).text}catch{return undefined}}).filter((value:any)=>typeof value==='string');
    expect(sources).toEqual([active.requestSource]);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:active.providerContent}}]})});
  };
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/**',fulfill);
  try{
    for(const entry of entries){
      const source=replay.jobs.find((item:any)=>item.id===entry.caseId&&item.selection)?.selection.source;
      expect(source).toBeTruthy();expect(notes[entry.caseId]).toBeTruthy();
      const requestSources=entry.request.messages.map((message:any)=>{try{return JSON.parse(message.content).text}catch{return undefined}}).filter((value:any)=>typeof value==='string');
      expect(requestSources).toHaveLength(1);
      active={...entry,source,requestSource:requestSources[0]};const response=JSON.parse(entry.providerContent),before=await snapshot(),beforeCount=attempts;
      await page.bringToFront();await page.locator('#source').evaluate((node,text)=>{node.textContent=text},source);
      const sourceHtml=await page.evaluate(()=>{const copy=document.documentElement.cloneNode(true) as Element;copy.querySelector('#tex-selection-translator-root')?.remove();copy.querySelector('#pi-translation-marker-layer')?.remove();return '<!doctype html>'+copy.outerHTML});
      await selectElementText('#source');const overlay=page.locator('#tex-selection-translator-root');
      await overlay.locator('.trigger').click();await expect(overlay.locator('.copy-action')).toBeEnabled();
      await expect(overlay.locator('.lexical-meaning,.body').first()).toHaveText(response.translation);
      await captureCopy(response.translation);
      await overlay.locator('.mark-action').click();await expect(overlay.locator('.mark-action')).toHaveAttribute('aria-pressed','true');
      await overlay.locator('details.more > summary').click();await overlay.getByRole('button',{name:/查看本文标记/}).click();
      const row=overlay.locator('.marker-note').filter({hasText:source.trim().slice(0,28)});await expect(row).toHaveCount(1);
      await row.locator('.marker-note-more > summary').click();await row.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();
      await expect(row.locator('button[aria-label="保存或取消保存这条网页摘录"]')).toHaveText('取消本机保存');
      await row.locator('.marker-note-more > summary').click();await row.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();
      await overlay.getByRole('textbox',{name:'个人笔记（可选）'}).fill(notes[entry.caseId]!);
      await overlay.getByRole('button',{name:'保存这条标记的出处和笔记'}).click();
      await expect(overlay.locator('.excerpt-citation-editor')).toHaveCount(0);
      await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
      await options.locator('#retained-library-search').fill(notes[entry.caseId]!);
      const result=options.locator('[data-source-kind="excerpt"]');await expect(result).toHaveCount(1);
      await result.locator('.library-select').click();const detail=options.locator('#library-detail');
      await expect(detail.locator('.library-personal-note')).toHaveText(notes[entry.caseId]!);await expect(detail).toContainText(response.translation);
      const href=await detail.locator('.library-source-open').getAttribute('href');expect(href).toContain('/project/pi-translator-e2e#pi-excerpt=');
      const sourceRoute=async(route:any)=>route.fulfill({contentType:'text/html',body:sourceHtml});
      await context.route('https://www.overleaf.com/project/pi-translator-e2e',sourceRoute);
      // This replay verifies a separately reopened document; normal-click reuse
      // and draft protection are covered by reading-navigation.spec.ts.
      const opening=context.waitForEvent('page');await detail.locator('.library-source-open').click({modifiers:['Control']});const returned=await opening;
      try{
        await returned.bringToFront();
        await returned.waitForLoadState('domcontentloaded');
        await expect(returned).toHaveURL(new RegExp('pi-translator-e2e#pi-excerpt='));
        await expect(returned.locator('#source')).toHaveText(source);
        await expect(returned.locator('#pi-translation-marker-layer .marker').first()).toBeVisible();
        await expect.poll(()=>returned.locator('#source').evaluate(node=>{const rect=node.getBoundingClientRect();return rect.bottom>0&&rect.top<innerHeight})).toBe(true);
        await returned.screenshot({path:info.outputPath(`${entry.caseId}-returned-source.png`)});
      }finally{await returned.close();await context.unroute('https://www.overleaf.com/project/pi-translator-e2e',sourceRoute)}
      const after=await snapshot(),old=Object.values(before.piWebExcerptsV1??{}).flat() as any[],all=Object.values(after.piWebExcerptsV1??{}).flat() as any[];
      for(const item of old)expect(all.find(value=>value.markerId===item.markerId)).toEqual(item);
      const saved=all.find(item=>item.content.note===notes[entry.caseId]);expect(saved.content.translatedText).toBe(response.translation);expect(saved.content.originalText).toBe(active.requestSource);
      expect(attempts-beforeCount).toBe(1);
      results.push({caseId:entry.caseId,markerId:saved.markerId,source,translation:response.translation,note:notes[entry.caseId],sourceHref:href,copy:'mocked exact clipboard payload',oldSavedRecordsUnchanged:true,replays:1});
      await options.screenshot({path:info.outputPath(`${entry.caseId}-saved-note.png`)});
      await page.bringToFront();await overlay.getByRole('button',{name:'返回翻译结果',exact:true}).click();await overlay.getByRole('button',{name:'关闭',exact:true}).click();
      await page.evaluate(()=>{getSelection()?.removeAllRanges();document.dispatchEvent(new Event('selectionchange'))});
    }
    expect(attempts).toBe(6);
    writeFileSync(info.outputPath('saved-response-workflow.json'),JSON.stringify({kind:'Offline fixture workflow with exact sealed source/responses; not live public-page or new model acceptance',inputSha256:createHash('sha256').update(bytes!).digest('hex'),newModelRequests:0,results},null,2));
  }finally{await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/**',fulfill);await options.close()}
});
