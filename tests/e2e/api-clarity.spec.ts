import { context, expect, extensionId, installEdgeExtensionHooks, test, textRequests, visionRequests } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('keeps a single provider simple while preserving drafts and optional controls',async({ },info)=>{
  const worker=context.serviceWorkers()[0]!;
  const saved=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const options=await context.newPage();
  try{
    await worker.evaluate(async s=>{const profile=s.apiProfiles.find((item:any)=>item.id===s.activeApiProfileId);await (globalThis as any).chrome.storage.local.set({extensionSettings:{...s,apiProfiles:[profile],visionApiProfileId:'',visionModel:''}})},saved);
    await options.setViewportSize({width:360,height:700});
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#api-profile')).toHaveValue('default');
    await expect(options.locator('#api-profile')).toBeHidden();
    await expect(options.locator('#profile-menu > summary')).toHaveText('管理接口');
    await expect(options.locator('#text-connection-state')).toHaveText('已填写 · 未验证');
    await expect(options.locator('#connection-more')).not.toHaveAttribute('open');
    const calls=textRequests.length+visionRequests.length;
    await options.locator('#api-key').fill('unsaved-draft-key');
    await expect(options.locator('#text-connection-state')).toHaveText('有更改 · 未验证');
    await options.locator('#connection-more > summary').click();
    await options.locator('#connection-advanced > summary').click();
    await options.locator('#connection-more > summary').click();
    await expect(options.locator('#api-key')).toHaveValue('unsaved-draft-key');
    expect(textRequests.length+visionRequests.length).toBe(calls);
    expect(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await options.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await options.screenshot({path:info.outputPath('connection-360-light.png')});
    await options.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await options.screenshot({path:info.outputPath('connection-360-dark.png')});
  }finally{
    await options.close({runBeforeUnload:false});
    await worker.evaluate(async s=>(globalThis as any).chrome.storage.local.set({extensionSettings:s}),saved);
  }
});

test('identifies multiple profiles and refuses to discard an unsaved key on switch',async()=>{
  const options=await context.newPage();
  try{
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#api-profile')).toBeVisible();
    await expect(options.locator('#api-profile')).toHaveValue('default');
    await options.locator('#api-key').fill('unsaved-multi-profile-key');
    await options.locator('#api-profile').selectOption('vision-e2e');
    await expect(options.locator('#api-profile')).toHaveValue('default');
    await expect(options.locator('#api-key')).toHaveValue('unsaved-multi-profile-key');
    await expect(options.locator('#connection-feedback')).toContainText('未保存');
  }finally{await options.close({runBeforeUnload:false})}
});

test('marks an explicit connection test and invalidates the result when the model changes',async()=>{
  const options=await context.newPage();
  try{
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect(options.locator('#text-connection-state')).toHaveText('本次测试通过');
    await options.locator('#model').fill('new-model-draft');
    await expect(options.locator('#text-connection-state')).toHaveText('有更改 · 未验证');
    await expect(options.locator('#connection-summary')).toBeHidden();
  }finally{await options.close({runBeforeUnload:false})}
});

test('keeps the draft and reports a failed diagnostic rather than claiming success',async()=>{
  const worker=context.serviceWorkers()[0]!;
  const before=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const options=await context.newPage();
  try{
    await options.addInitScript(()=>{const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>message.type==='DIAGNOSE_API'?Promise.resolve({ok:true,data:{origin:'https://fixture.invalid',permissionGranted:true,authenticated:true,configuredModelAvailable:true,modelCount:1,chatCompletion:false,structuredOutput:false,sentenceAlignment:false,latencyMs:10,notes:[]}}):send(message,...args)});
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await options.locator('#api-key').fill('unsaved-diagnostic-key');
    await options.locator('#refresh-models').click();
    await expect(options.locator('#connection-feedback')).toContainText('测试未通过');
    await expect(options.locator('#text-connection-state')).toHaveText('未通过测试');
    await expect(options.locator('#api-key')).toHaveValue('unsaved-diagnostic-key');
    const after=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
    expect(after).toEqual(before);
  }finally{await options.close({runBeforeUnload:false})}
});

test('replaces a previous passing state when a later connection test fails',async({},info)=>{
  const options=await context.newPage();
  try{
    await options.addInitScript(()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>message.type==='LIST_API_MODELS'&&g.failModelList?Promise.resolve({ok:false,error:{code:'AUTH_FAILED',message:'offline failure',retryable:false}}):send(message,...args)});
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect(options.locator('#text-connection-state')).toHaveText('本次测试通过');
    await options.evaluate(()=>(globalThis as any).failModelList=true);
    await options.locator('#refresh-models').click();
    await expect(options.locator('#text-connection-state')).toHaveText('未通过测试');
    await expect(options.locator('#connection-feedback')).toContainText('Key');
    await expect(options.locator('#status')).toBeHidden();
    await options.setViewportSize({width:360,height:700});
    await options.locator('#connection-feedback').scrollIntoViewIfNeeded();
    await options.screenshot({path:info.outputPath('connection-error-light.png')});
    await options.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await options.screenshot({path:info.outputPath('connection-error-dark.png')});
    await options.locator('#api-key').fill('new-key-draft');
    await expect(options.locator('#connection-feedback')).toBeHidden();
    await expect(options.locator('#text-connection-state')).toHaveText('有更改 · 未验证');
    await expect(options.locator('#api-key')).toHaveValue('new-key-draft');
  }finally{await options.close({runBeforeUnload:false})}
});

test('keeps newer model input and blocks a second test while the first is pending',async()=>{
  const options=await context.newPage();
  try{
    await options.addInitScript(()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>message.type==='LIST_API_MODELS'?new Promise(resolve=>{g.listCalls=(g.listCalls??0)+1;g.releaseList=()=>resolve({ok:true,data:{models:['old-model']}})}):send(message,...args)});
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect.poll(()=>options.evaluate(()=>(globalThis as any).listCalls)).toBe(1);
    await expect(options.locator('#refresh-models')).toBeDisabled();
    await expect(options.locator('#connection-feedback')).toContainText('正在读取');
    await expect(options.locator('#connection-feedback')).toHaveAttribute('role','status');
    await options.locator('#model').fill('new-model-draft');
    await options.evaluate(()=>(globalThis as any).releaseList());
    await expect(options.locator('#text-connection-state')).toHaveText('有更改 · 未验证');
    await expect(options.locator('#model')).toHaveValue('new-model-draft');
    await expect(options.locator('#connection-feedback')).toContainText('变化');
    expect(await options.evaluate(()=>(globalThis as any).listCalls)).toBe(1);
  }finally{await options.close({runBeforeUnload:false})}
});

test('shows pending feedback near the action in English',async()=>{
  const worker=context.serviceWorkers()[0]!;
  const before=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('uiLanguagePreference')).uiLanguagePreference);
  const options=await context.newPage();
  try{
    await worker.evaluate(async()=>(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en'}));
    await options.addInitScript(()=>{const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);c.runtime.sendMessage=(message:any,...args:any[])=>message.type==='LIST_API_MODELS'?new Promise(resolve=>{g.listStarted=true;g.releaseList=()=>resolve({ok:false,error:{code:'NETWORK_ERROR',message:'offline fixture',retryable:false}})}):send(message,...args)});
    await options.goto(`chrome-extension://${extensionId}/options.html#connection`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('#refresh-models').click();
    await expect.poll(()=>options.evaluate(()=>(globalThis as any).listStarted)).toBe(true);
    await expect(options.locator('#connection-feedback')).toBeVisible();
    await expect(options.locator('#connection-feedback')).toHaveAttribute('role','status');
    await expect(options.locator('#status')).toBeHidden();
    await options.evaluate(()=>(globalThis as any).releaseList());
  }finally{
    await options.close({runBeforeUnload:false});
    await worker.evaluate(async value=>value===undefined?(globalThis as any).chrome.storage.local.remove('uiLanguagePreference'):(globalThis as any).chrome.storage.local.set({uiLanguagePreference:value}),before);
  }
});
