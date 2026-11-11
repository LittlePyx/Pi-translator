import {context,extensionId,installEdgeExtensionHooks,test,expect,textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('first-use purpose stays in the guide and saves only an explicitly enabled field',async({},info)=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage();
 const saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;const s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,onboardingCompleted:false,purposePreferences:{purposes:['daily'],researchField:'existing'}}});return s});
 try{
  await options.setViewportSize({width:360,height:700});await options.goto(`chrome-extension://${extensionId}/options.html`);
  const dialog=options.locator('#onboarding-dialog');await expect(dialog).toBeVisible();if (!await options.locator('#onboarding-purpose').evaluate(el => (el as HTMLDetailsElement).open)) await options.locator('#onboarding-purpose > summary').click();
  await expect(dialog).toBeVisible();await expect(options.locator('[name="onboarding-purpose-choice"][value="daily"]')).toBeChecked();
  await options.locator('[name="onboarding-purpose-choice"][value="research"]').check();await options.locator('#onboarding-research-field').fill('统计学');
  await expect(options.locator('#onboarding-field-translation')).not.toBeChecked();await options.locator('#onboarding-field-translation').check();
  expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await options.locator('#onboarding-field-translation').scrollIntoViewIfNeeded();await options.screenshot({path:info.outputPath('field-onboarding-360.png')});
  const count=textRequests.length;await options.locator('#onboarding-skip').click();await expect(dialog).toBeHidden();
  const after=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  expect(after.purposePreferences).toEqual({purposes:['daily','research'],researchField:'统计学',useFieldInTranslation:true});expect(after.apiProfiles).toEqual(saved.apiProfiles);expect(textRequests.length).toBe(count);
 }finally{await options.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});

test('field opt-in changes mocked translation requests and cache identity',async()=>{
 const worker=context.serviceWorkers()[0]!,reader=await context.newPage();
 const saved=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
 const setField=async(enabled:boolean)=>worker.evaluate(async enabled=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,enableSessionCache:true,purposePreferences:{purposes:['research'],researchField:'统计学',...(enabled?{useFieldInTranslation:true}:{})}}})},enabled);
 const send=async(id:string)=>reader.evaluate(async id=>(globalThis as any).chrome.runtime.sendMessage({type:'TRANSLATE_SELECTION',payload:{requestId:id,text:'The kernel describes the sample distribution.',pageUrl:'https://www.overleaf.com/field-preference-test',targetLanguage:'zh-CN',sourceLanguage:'en',style:'academic',contentMode:'plain'}}),id);
 try{
  await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await setField(false);const start=textRequests.length;
  expect((await send('field-off')).ok).toBe(true);expect(textRequests.length).toBe(start+1);expect(JSON.stringify(textRequests.at(-1))).not.toContain('统计学');
  await setField(true);expect((await send('field-on')).ok).toBe(true);expect(textRequests.length).toBe(start+2);
  const body=textRequests.at(-1) as any,user=body.messages.find((message:any)=>message.role==='user');expect(JSON.parse(user.content).researchField).toBe('统计学');expect(body.messages[0].content).toContain('confirmed glossary mappings');
  await setField(false);expect((await send('field-off-again')).ok).toBe(true);expect(textRequests.length).toBe(start+2);
 }finally{await reader.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});

test('first-use concurrent preference change preserves both the other window and the local draft',async()=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage(),saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,onboardingCompleted:false,purposePreferences:{purposes:['research'],researchField:'原有领域'}}});return s});
 try{
  await options.goto(`chrome-extension://${extensionId}/options.html`);if (!await options.locator('#onboarding-purpose').evaluate(el => (el as HTMLDetailsElement).open)) await options.locator('#onboarding-purpose > summary').click();await options.locator('#onboarding-research-field').fill('本地未保存领域');await options.locator('#onboarding-field-translation').check();
  await worker.evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,purposePreferences:{purposes:['research'],researchField:'另一窗口领域'}}})});
  await options.locator('#onboarding-skip').click();await expect(options.locator('#onboarding-status')).toContainText('另一窗口');await expect(options.locator('#onboarding-research-field')).toHaveValue('本地未保存领域');await expect(options.locator('#onboarding-field-translation')).toBeChecked();
  const after=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);expect(after.purposePreferences.researchField).toBe('另一窗口领域');expect(after.onboardingCompleted).toBe(false);
 }finally{await options.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});

test('existing field remains local until enabled and saved in translation preferences',async()=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage(),saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,onboardingCompleted:true,purposePreferences:{purposes:['research'],researchField:'材料科学'}}});return s});
 try{
  await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await options.locator('#purpose-preferences > summary').click();await expect(options.locator('#purpose-research-field')).toHaveValue('材料科学');await expect(options.locator('#purpose-field-translation')).not.toBeChecked();
  const count=textRequests.length;await options.locator('#purpose-field-translation').check();await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();
  const after=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);expect(after.purposePreferences).toEqual({purposes:['research'],researchField:'材料科学',useFieldInTranslation:true});expect(textRequests.length).toBe(count);
 }finally{await options.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});

test('image translation uses the field only after opt-in',async()=>{
 const {visionRequests}=await import('./support/edge-extension-fixture');
 const worker=context.serviceWorkers()[0]!,reader=await context.newPage(),saved=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
 const send=async(id:string)=>reader.evaluate(async id=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const c=canvas.getContext('2d')!;c.fillStyle='#fff';c.fillRect(0,0,16,16);c.fillStyle='#000';c.fillRect(3,3,10,10);return (globalThis as any).chrome.runtime.sendMessage({type:'TRANSLATE_IMAGE_REGION',payload:{requestId:id,imageDataUrl:canvas.toDataURL('image/png'),imageWidth:16,imageHeight:16,pageUrl:'https://www.overleaf.com/field-image',targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',bypassCache:true}})},id);
 try{
  await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await worker.evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,purposePreferences:{purposes:['research'],researchField:'海洋工程'}}})});
  const start=visionRequests.length;expect((await send('image-field-off')).ok).toBe(true);expect(visionRequests.length).toBe(start+1);expect(JSON.stringify(visionRequests.at(-1))).not.toContain('海洋工程');
  await worker.evaluate(async()=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({extensionSettings:{...s,purposePreferences:{...s.purposePreferences,useFieldInTranslation:true}}})});expect((await send('image-field-on')).ok).toBe(true);expect(visionRequests.length).toBe(start+2);expect(JSON.stringify(visionRequests.at(-1))).toContain('海洋工程');
 }finally{await reader.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});
