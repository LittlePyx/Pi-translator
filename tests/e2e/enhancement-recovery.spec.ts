import { context, createRasterPdf, expect, extensionId, installEdgeExtensionHooks, page, test, visionRequests } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('returns to the PDF region after enhancement setup and waits for confirmation', async () => {
  const worker=context.serviceWorkers()[0]!;
  const original=await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  const reader=await context.newPage();
  let options: Awaited<ReturnType<typeof context.newPage>> | undefined;
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,visionApiProfileId:'',visionModel:''}}),original);
    await reader.addInitScript(()=>{
      const g=globalThis as any,c=g.chrome,send=c.runtime.sendMessage.bind(c.runtime);let first=true;g.regionCalls=0;
      c.runtime.sendMessage=(message:any,...args:any[])=>{
        if(message.type==='TRANSLATE_IMAGE_REGION')g.regionCalls++;
        if(first&&message.type==='TRANSLATE_IMAGE_REGION'){
          first=false;return Promise.resolve({ok:false,error:{code:'VISION_NOT_CONFIGURED',message:'offline fixture',retryable:false}});
        }
        return send(message,...args);
      };
    });
    await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:createRasterPdf()});
    const first=reader.locator('.pdf-page').first();
    await expect(first).toHaveAttribute('data-rendered','ready');
    await reader.locator('#region-translate').click();
    const box=await first.boundingBox();
    expect(box).not.toBeNull();
    if(!box)throw new Error('PDF page missing');
    await reader.mouse.move(box.x+100,box.y+100);
    await reader.mouse.down();
    await reader.mouse.move(box.x+300,box.y+280,{steps:6});
    await reader.mouse.up();
    const callsBefore=visionRequests.length;
    await first.locator('.region-confirm button').filter({hasText:'翻译'}).click();
    const overlay=reader.locator('#tex-selection-translator-root');
    await expect(overlay.locator('.error')).toContainText('公式与图像增强');
    expect(visionRequests.length).toBe(callsBefore);
    const opened=context.waitForEvent('page');
    await overlay.getByRole('button',{name:'设置公式与图像增强'}).click();
    options=await opened;
    await expect(options.locator('#settings-recovery-banner')).toBeVisible();
    await expect(options.locator('#vision-setup-details')).toHaveAttribute('open','');
    await options.locator('#vision-api-profile').selectOption('default');
    await options.locator('#test-vision-capability').click();
    await expect(options.locator('#vision-test-status')).toContainText('视觉能力可用');
    await expect(options.locator('#settings-recovery-status')).toContainText('确认');
    await expect(overlay.getByRole('button',{name:'重新翻译（会再次请求 API）'})).toBeVisible();
    const afterTest=visionRequests.length;
    await reader.waitForTimeout(300);
    expect(visionRequests.length).toBe(afterTest);
    expect(await reader.evaluate(()=>(globalThis as any).regionCalls)).toBe(1);
    await overlay.getByRole('button',{name:'重新翻译（会再次请求 API）'}).click();
    await expect.poll(()=>reader.evaluate(()=>(globalThis as any).regionCalls)).toBe(2);
    await expect(overlay).toContainText('自动识别并翻译的图像区域');
  } finally {
    if(options)await options.close({runBeforeUnload:false});
    await reader.close({runBeforeUnload:false});
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),original);
  }
});

test('returns to the webpage region and asks before resending', async () => {
  const worker=context.serviceWorkers()[0]!;
  const original=await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  let options: Awaited<ReturnType<typeof context.newPage>> | undefined;
  try {
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:{...settings,visionApiProfileId:'',visionModel:''}}),original);
    await page.bringToFront();
    await worker.evaluate(async()=>{
      const c=(globalThis as any).chrome,tabs=await c.tabs.query({active:true,currentWindow:true}),tabId=tabs[0].id;
      await c.scripting.executeScript({target:{tabId},func:()=>{
        const c=(globalThis as any).chrome,send=c.runtime.sendMessage.bind(c.runtime);let first=true;
        document.documentElement.dataset.piRegionTestCalls='0';
        c.runtime.sendMessage=(message:any,...args:any[])=>{
          if(message.type==='CAPTURE_VISIBLE_TAB'){
            const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;
            return Promise.resolve({ok:true,data:{imageDataUrl:canvas.toDataURL('image/png')}});
          }
          if(message.type==='TRANSLATE_IMAGE_REGION'){
            document.documentElement.dataset.piRegionTestCalls=String(Number(document.documentElement.dataset.piRegionTestCalls)+1);
            if(first){first=false;return Promise.resolve({ok:false,error:{code:'VISION_NOT_CONFIGURED',message:'offline fixture',retryable:false}})}
          }
          return send(message,...args);
        };
      }});
      await c.tabs.sendMessage(tabId,{type:'START_WEB_REGION_SELECTION'});
    });
    const region=page.locator('#pi-web-region-selection-root');
    await expect(region).toBeVisible();
    const box=await page.locator('#math-source').boundingBox();
    if(!box)throw new Error('Fixture text missing');
    await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+box.width,box.y+Math.max(box.height,32),{steps:6});await page.mouse.up();
    await region.locator('.confirm').click();
    const overlay=page.locator('#tex-selection-translator-root');
    await expect(overlay.locator('.error')).toContainText('公式与图像增强');
    const opened=context.waitForEvent('page');
    await overlay.getByRole('button',{name:'设置公式与图像增强'}).click();
    options=await opened;
    await expect(options.locator('#settings-recovery-banner')).toBeVisible();
    await options.locator('#vision-api-profile').selectOption('default');
    await options.locator('#test-vision-capability').click();
    await expect(options.locator('#settings-recovery-status')).toContainText('确认');
    await expect(overlay.getByRole('button',{name:'重新翻译（会再次请求 API）'})).toBeVisible();
    expect(await page.locator('html').getAttribute('data-pi-region-test-calls')).toBe('1');
    await overlay.getByRole('button',{name:'重新翻译（会再次请求 API）'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-pi-region-test-calls','2');
    await expect(overlay).toContainText('自动识别并翻译的图像区域');
  } finally {
    if(options)await options.close({runBeforeUnload:false});
    await page.reload();
    await worker.evaluate(async settings => (globalThis as any).chrome.storage.local.set({extensionSettings:settings}),original);
  }
});
