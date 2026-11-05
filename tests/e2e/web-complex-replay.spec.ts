import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {context,expect,extensionId,installEdgeExtensionHooks,OVERLEAF_FIXTURE_URL,page,test,textRequests} from './support/edge-extension-fixture';

const replayBytes=readFileSync(process.env.PI_WEB_CORE_REPLAY??new URL('../fixtures/web-complex-sealed.json',import.meta.url));
const replay=JSON.parse(replayBytes.toString()),entry=replay.api.find((item:any)=>item.caseId==='mdn-sort-cross-code'&&item.status===200);
const source:string=replay.jobs.find((item:any)=>item.id===entry.caseId&&item.selection).selection.source;
const translation=JSON.parse(entry.providerContent).translation;
const endpoint='https://www.overleaf.com/pi-translator-e2e-api/**';
installEdgeExtensionHooks();
test.beforeAll(async()=>{
  await context.serviceWorkers()[0]!.evaluate(async()=>{
    const c=(globalThis as any).chrome,settings=(await c.storage.local.get('extensionSettings')).extensionSettings;
    await c.storage.local.set({extensionSettings:{...settings,enableSessionCache:false}});
  });
});

async function prepare(kind:'dynamic'|'paragraphs'){
  await page.goto(OVERLEAF_FIXTURE_URL);
  return page.evaluate(({source,kind})=>{
    const block=document.createElement('div');block.id='complex-probe';block.style.cssText='position:absolute;top:150px;left:32px;width:600px;max-width:calc(100vw - 64px);font:18px/1.8 Arial;background:white;color:black;z-index:5;user-select:text';
    if(kind==='paragraphs'){
      const split=source.indexOf(' ',Math.floor(source.length/2));
      for(const text of [source.slice(0,split),source.slice(split+1)]){const p=document.createElement('p');p.style.margin='0 0 16px';p.textContent=text;block.append(p)}
    }else{
      const cut=source.indexOf('sort()');block.append(source.slice(0,cut));
      const link=document.createElement('a');link.href='#probe-link';const code=document.createElement('code');code.textContent='sort()';link.append(code);block.append(link,source.slice(cut+6));
    }
    document.body.append(block);return block.innerText;
  },{source,kind});
}
async function nativeSelect(expected:string){
  const points=await page.locator('#complex-probe').evaluate(node=>{
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),texts:Text[]=[];
    while(walker.nextNode())if(walker.currentNode.textContent?.length)texts.push(walker.currentNode as Text);
    const start=document.createRange(),end=document.createRange(),first=texts[0]!,last=texts.at(-1)!;
    start.setStart(first,0);start.setEnd(first,1);end.setStart(last,last.length-1);end.setEnd(last,last.length);
    const a=start.getBoundingClientRect(),b=end.getBoundingClientRect();return {a:{x:a.left+.2,y:a.top+a.height/2},b:{x:b.right-.2,y:b.top+b.height/2}};
  });
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:24});await page.mouse.up();
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe(expected);
}

for(const kind of ['dynamic','paragraphs'] as const)test(`replays a sealed response after native selection of ${kind} content`,async({},info)=>{
  const requested:string[]=[];const expected=await prepare(kind),before=textRequests.length;
  expect(expected.replace(/\s+/gu,' ')).toBe(source.replace(/\s+/gu,' '));
  const handler=async(route:any)=>{
    const body=route.request().postDataJSON(),user=body.messages.findLast((item:any)=>item.role==='user');requested.push(JSON.parse(user.content).text);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:entry.providerContent},finish_reason:'stop'}]})});
  };
  await context.route(endpoint,handler);
  try{
    await nativeSelect(expected);const overlay=page.locator('#tex-selection-translator-root');await expect(overlay.locator('.trigger')).toBeVisible();await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toHaveText(translation);expect(requested).toEqual([expected.trim()]);
    await expect(overlay.locator('.copy-action')).toBeEnabled();
    await page.screenshot({path:info.outputPath(`${kind}.png`)});
    writeFileSync(info.outputPath('identity.json'),JSON.stringify({evidence:'Offline layout variant with native drag and sealed first response; not new public-site or model quality evidence',archiveSha256:createHash('sha256').update(replayBytes).digest('hex'),source:expected,requested,translation,newModelCalls:0},null,2));
    // This explicit replay handler bypasses the fixture's generic response recorder.
    expect(textRequests.length).toBe(before);
  }finally{await context.unroute(endpoint,handler)}
});

for(const action of ['stop','route'] as const)test(`rejects a waiting request's late result after ${action}`,async({},info)=>{
  const expected=await prepare('dynamic'),worker=context.serviceWorkers()[0]!;
  const historyBefore=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('translationHistoryByTab')).translationHistoryByTab);
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),start=new Promise<void>(resolve=>started=resolve),requests:string[]=[];
  const handler=async(route:any)=>{const body=route.request().postDataJSON(),user=body.messages.findLast((item:any)=>item.role==='user');requests.push(JSON.parse(user.content).text);started();await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:entry.providerContent}}]})}).catch(()=>undefined)};
  await context.route(endpoint,handler);
  try{
    await nativeSelect(expected);const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await start;
    await expect(overlay.locator('.stop-translation')).toBeEnabled();
    if(action==='stop'){await overlay.locator('.stop-translation').click();await expect(overlay.locator('.stopped-status')).toBeVisible()}
    else{await page.evaluate(()=>{history.pushState({},'', '/project/pi-translator-e2e?route=second');document.getElementById('complex-probe')!.textContent='The new route has different source text.';getSelection()?.removeAllRanges()});await page.waitForTimeout(150)}
    release();await page.waitForTimeout(350);
    expect(requests).toEqual([expected.trim()]);await expect(overlay.locator('.body')).toHaveCount(0);
    expect(await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.session.get('translationHistoryByTab')).translationHistoryByTab)).toEqual(historyBefore);
    writeFileSync(info.outputPath('waiting.json'),JSON.stringify({action,requests:requests.length,lateResultCommitted:false,newModelCalls:0},null,2));
  }finally{release();await context.unroute(endpoint,handler)}
});

test('keeps the newly selected source visible when an older request completes later',async({},info)=>{
  const expected=await prepare('dynamic'),nextEntry=replay.api.find((item:any)=>item.caseId==='mdn-sort-nonmutation'&&item.status===200);
  const nextSource=replay.jobs.find((item:any)=>item.id===nextEntry.caseId&&item.selection).selection.source;
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),start=new Promise<void>(resolve=>started=resolve),requests:string[]=[];
  const handler=async(route:any)=>{
    const body=route.request().postDataJSON(),user=body.messages.findLast((item:any)=>item.role==='user'),text=JSON.parse(user.content).text;requests.push(text);
    if(text===expected.trim()){started();await gate}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:text===expected.trim()?entry.providerContent:nextEntry.providerContent}}]})}).catch(()=>undefined);
  };
  await context.route(endpoint,handler);
  try{
    await nativeSelect(expected);const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await start;
    await page.locator('#complex-probe').evaluate((node,text)=>{node.textContent=text},nextSource);await nativeSelect(nextSource);await overlay.locator('.trigger').click();
    await expect(overlay.locator('.body')).toHaveText(JSON.parse(nextEntry.providerContent).translation);release();await page.waitForTimeout(350);
    await expect(overlay.locator('.body')).toHaveText(JSON.parse(nextEntry.providerContent).translation);expect(requests).toEqual([expected.trim(),nextSource]);
    await page.screenshot({path:info.outputPath('changed-selection.png')});
  }finally{release();await context.unroute(endpoint,handler)}
});
