import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Route} from '@playwright/test';
import {context,expect,extensionId,installEdgeExtensionHooks,test} from './support/edge-extension-fixture';
installEdgeExtensionHooks();
test.skip(process.env.PI_READING_STORAGE_FAULTS!=='1','Opt-in fault injection using saved actual translations.');
test.use({trace:'off'});
const folder=path.resolve('output/pdf/live-workflow-2026-10-15');
let fixtureSettings:any;
let actualCheckpoint:any;
test.beforeAll(async()=>{
  fixtureSettings=await context.serviceWorkers()[0]!.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  actualCheckpoint=JSON.parse(await readFile(process.env.PI_READING_ACTUAL_CHECKPOINT??path.join(folder,'runtime-checkpoint.json'),'utf8'));
});
for(const area of ['session','local','both'] as const){
  test(`preserves correction consistently when ${area} storage rejects a write`,async({},info)=>{
    const checkpoint=actualCheckpoint;
    const record=checkpoint.retained[0];if(!record)throw new Error('Actual translation checkpoint required.');
    const reader=await context.newPage();const worker=context.serviceWorkers()[0]!;
    const id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
    const source=path.join(folder,'source/conditional-neural-processes.pdf');
    await reader.addInitScript(()=>{
      const scope=globalThis as any,c=scope.chrome;scope.piStorageFault='';scope.piStorageFaultHits=0;
      for(const name of ['session','local']){
        const set=c.storage[name].set.bind(c.storage[name]);
        c.storage[name].set=(values:any,...rest:any[])=>{
          if((scope.piStorageFault===name||scope.piStorageFault==='both')&&('pdfDocumentTranslationSessionsV1' in values||'pdfDocumentTranslationRetainedV1' in values)){
            scope.piStorageFaultHits++;return Promise.reject(new Error('Injected storage quota failure'));
          }
          return set(values,...rest);
        };
      }
    });
    try{
      await worker.evaluate(async({record,settings})=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.session.clear();await c.storage.local.set({extensionSettings:settings,pdfDocumentTranslationRetainedV1:[record]})},{record,settings:fixtureSettings});
      await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles(source);
      await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase',/idle|preparing/u);
      const block=reader.locator('.pdf-paragraph-edit-action:enabled').first().locator('..');await block.hover();await block.locator('.pdf-paragraph-edit-action').click();
      const input=reader.locator('#pdf-paragraph-editor textarea').first();const old=await input.inputValue();const corrected='【保存异常验收】'+old;await input.fill(corrected);
      await reader.evaluate(area=>{(globalThis as any).piStorageFault=area},area);
      await reader.locator('#pdf-paragraph-editor-save').click();
      await expect.poll(()=>reader.evaluate(()=>(globalThis as any).piStorageFaultHits)).toBeGreaterThan(0);
      if(area==='both'){
        await expect(reader.locator('#pdf-paragraph-editor-status')).toContainText('保存失败');await expect(input).toHaveValue(corrected);await expect(block).not.toContainText('【保存异常验收】');
        await reader.evaluate(()=>{(globalThis as any).piStorageFault=''});await reader.locator('#pdf-paragraph-editor-save').click();
      }
      await expect(reader.locator('#pdf-paragraph-editor')).not.toBeVisible();await expect(block).toContainText('【保存异常验收】');
      if(area!=='both')await expect(reader.locator('#notice')).toContainText(area==='session'?'修正已保留到本机':'修正已保留在当前会话');
      if(area==='local')await expect(reader.locator('#pdf-document-translation-status')).toContainText('本机保存失败');
      if(area==='session')await expect(reader.locator('#pdf-document-translation-status')).toContainText('已保存到本机');
      await reader.evaluate(()=>{(globalThis as any).piStorageFault=''});
      const data=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{session:(await c.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1,local:(await c.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1}});
      await writeFile(info.outputPath('storage-outcome.json'),JSON.stringify({fault:area,evidence:'fault-injected storage; actual paper translation reused; no model calls',session:data.session,local:data.local},null,2));
      await reader.locator('#pdf-document-translation-view-compare').click();await reader.locator('#pdf-document-translation-close').click();
      await reader.reload();await reader.locator('#file-input').setInputFiles(source);await reader.locator('#translate-document').click();
      await expect(reader.locator('.pdf-document-translation-block').filter({hasText:'【保存异常验收】'})).toHaveCount(1);
      await reader.screenshot({path:info.outputPath('recovered-correction.png')});
    }finally{
      const state=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return{session:(await c.storage.session.get('pdfDocumentTranslationSessionsV1')).pdfDocumentTranslationSessionsV1,local:(await c.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1}}).catch(()=>undefined);
      await writeFile(info.outputPath('last-state.json'),JSON.stringify({fault:area,evidence:'offline storage fault injection using cached actual translations',editorStatus:await reader.locator('#pdf-paragraph-editor-status').textContent().catch(()=>null),state},null,2));
      await reader.screenshot({path:info.outputPath('last-ui.png')}).catch(()=>undefined);await reader.close();
    }
  });
}

for(const failure of ['network','rate-limit'] as const){
  test(`retains completed actual translations after an injected ${failure} error`,async({},info)=>{
    test.setTimeout(90_000);
    const checkpoint=actualCheckpoint;
    const original=checkpoint.retained[0];if(!original?.blocks.length)throw new Error('Actual results required.');
    const missing=original.blocks.find((block:any)=>block.signature===original.documentSignatures[0])??original.blocks[0];
    const record={...original,activity:'paused',blocks:original.blocks.filter((block:any)=>block.signature!==missing.signature)};
    const id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
    let attempts=0;const handler=async(route:Route)=>{
      if(route.request().method()!=='POST'||!route.request().url().includes('/chat/completions')||route.request().postData()?.includes('Read the four black characters')){await route.fallback();return;}
      attempts++;if(failure==='network')await route.abort('internetdisconnected');else await route.fulfill({status:429,headers:{'Retry-After':'0'},contentType:'application/json',body:JSON.stringify({error:{message:'Injected rate limit',type:'rate_limit_error'}})})
    };
    await context.route('https://www.overleaf.com/pi-translator-e2e-api/**',handler);await context.route('https://www.overleaf.com/pi-translator-e2e-vision/**',handler);
    const reader=await context.newPage();const worker=context.serviceWorkers()[0]!;
    try{
      await worker.evaluate(async({record,settings})=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.session.clear();await c.storage.local.set({extensionSettings:settings,pdfDocumentTranslationRetainedV1:[record]});await c.storage.session.set({apiKeysByProfile:{default:'fault-key','vision-e2e':'fault-key'}})},{record,settings:fixtureSettings});
      await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles(path.join(folder,'source/conditional-neural-processes.pdf'));
      await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','paused');
      await reader.locator('#pdf-document-translation-primary').click();await expect.poll(()=>attempts).toBeGreaterThan(0);
      await expect.poll(async()=>{
        const phase=await reader.locator('#pdf-document-translation').getAttribute('data-phase');
        const message=(await reader.locator('#pdf-document-translation-status').textContent())+' '+(await reader.locator('#notice').textContent());
        return !/running|preparing/u.test(phase??'')&&((await reader.locator('[data-status="error"]').count())>0||/失败|错误|网络|额度|频繁|限流|429|断开/u.test(message));
      },{timeout:60_000}).toBe(true);
      const status=await reader.locator('#pdf-document-translation-status').textContent();const errors=await reader.locator('[data-status="error"]').count();
      const local=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1);
      const saved=new Map(local[0].blocks.map((block:any)=>[block.signature,block]));for(const block of record.blocks)expect(saved.get(block.signature)).toEqual(block);
      expect(saved.has(missing.signature)).toBe(false);
      await reader.screenshot({path:info.outputPath('error-state.png')});await writeFile(info.outputPath('failure-report.json'),JSON.stringify({evidence:'injected browser network/API error, actual saved translations reused; no live model request',failure,attempts,status,errors,retainedBefore:record.blocks.length,retainedAfter:saved.size},null,2));
    }finally{
      await writeFile(info.outputPath('last-fault-state.json'),JSON.stringify({failure,attempts,phase:await reader.locator('#pdf-document-translation').getAttribute('data-phase').catch(()=>null),text:await reader.locator('#pdf-document-translation').textContent().catch(()=>null),notice:await reader.locator('#notice').textContent().catch(()=>null)},null,2));
      await reader.screenshot({path:info.outputPath('last-fault-ui.png')}).catch(()=>undefined);
      await reader.close();await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/**',handler);await context.unroute('https://www.overleaf.com/pi-translator-e2e-vision/**',handler)}
  });
}
