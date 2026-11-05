import {test,expect,chromium,type BrowserContext} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTwoPageTextPdf} from './support/edge-extension-fixture';
import {executedExtensionBackground} from './support/executed-extension-source';

test('keeps an optional original across Edge restart and removes only the copy with undo',async({},info)=>{
  test.setTimeout(90000);
  const extension=process.env.PI_E2E_EXTENSION_PATH||path.resolve('.output/edge-mv3');
  const profile=await mkdtemp(path.join(tmpdir(),'pi-original-restart-')),pdf=createTwoPageTextPdf('An optional local original.','Notes and reading state remain on page two.');
  const fingerprint=createHash('sha256').update(pdf).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
  let context:BrowserContext|undefined;const providerAttempts:string[]=[];
  const launch=async()=>{
    context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:process.env.PI_E2E_HEADLESS==='1',viewport:{width:1150,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check']});
    context.setDefaultTimeout(12000);
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(()=>{const original=fetch.bind(globalThis);globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(/^https?:/.test(url))throw Error('No provider calls in original-file reading acceptance');return original(input,init)}});
    context.on('request',request=>{if(/chat\/completions|\/messages$|generateContent/.test(request.url()))providerAttempts.push(request.url())});
    const extensionId=new URL(worker.url()).host;
    expect(await executedExtensionBackground(context,extensionId)).toBe(createHash('sha256').update(await readFile(path.join(extension,'background.js'))).digest('hex'));
    await worker.evaluate(()=>((globalThis as any).chrome.storage.local.set({uiLanguagePreference:'zh-CN'})));
    return {worker,extensionId};
  };
  try{
    let {worker,extensionId}=await launch();const reader=await context!.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html`);
    await reader.locator('#file-input').setInputFiles({name:'Retained original.pdf',mimeType:'application/pdf',buffer:pdf});await expect(reader.locator('#page-count')).toHaveText('2');
    const copies=()=>reader.evaluate(()=>new Promise<any[]>((resolve,reject)=>{const open=indexedDB.open('pi-original-pdfs-v1',1);open.onsuccess=()=>{const db=open.result,r=db.transaction('metadata').objectStore('metadata').getAll();r.onsuccess=()=>{resolve(r.result);db.close()};r.onerror=()=>reject(r.error)}}));
    expect(await copies()).toEqual([]);await reader.locator('#pdf-reader-menu > summary').click();await reader.locator('#pdf-original-copy').click();await expect(reader.locator('#pdf-original-copy')).toHaveText('移除本机原文件副本');expect((await copies())[0]).toMatchObject({id,fingerprint,size:pdf.length});
    if(await reader.locator('#pdf-reader-menu').getAttribute('open')===null)await reader.locator('#pdf-reader-menu > summary').click();
    await reader.screenshot({path:info.outputPath('original-copy-menu.png')});
    await reader.locator('#pdf-reader-menu > summary').click();await reader.locator('#page-number').fill('2');await reader.locator('#page-number').press('Enter');
    await expect.poll(async()=>worker.evaluate(async id=>((await(globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1||{})[id]?.pageNumber,id)).toBe(2);
    const note={id:'preserved-note',kind:'highlight',sourceTitle:'Retained original.pdf',note:'人工笔记不能因移除副本而删除',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Notes and reading state remain on page two.',prefix:'',suffix:''},createdAt:1,updatedAt:2};
    await worker.evaluate(async({id,note})=>{await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[id]:{annotations:[note],updatedAt:2}}})},{id,note});
    await reader.screenshot({path:info.outputPath('optional-copy-saved.png')});await context!.close();context=undefined;
    ({worker,extensionId}=await launch());const options=await context!.newPage();await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const storageTab=options.locator('[data-settings-target=storage]');await expect(storageTab).toHaveAttribute('aria-controls','settings-storage');await expect(options.locator('#onboarding-dialog')).toBeVisible();await options.locator('#onboarding-skip').click();await expect(options.locator('#onboarding-dialog')).not.toBeVisible();await storageTab.click();const row=options.locator(`[data-recent-id="${id}"]`);await expect(row).toBeVisible();await expect(row).not.toContainText('需选择原 PDF');
    const [reopened]=await Promise.all([context!.waitForEvent('page'),row.locator('.library-open').click()]);await reopened.waitForLoadState('domcontentloaded');await expect(reopened.locator('#page-count')).toHaveText('2');await expect(reopened.locator('#page-number')).toHaveValue('2');
    const snapshot=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(['piPdfReadingAnnotationsV1','pdfDocumentTranslationRetainedV1','piPdfTranslationMarkersV1']));
    await reopened.locator('#pdf-reader-menu > summary').click();await reopened.locator('#pdf-original-copy').click();await expect(reopened.locator('#pdf-original-copy')).toHaveText('在本机保留原 PDF');
    expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(['piPdfReadingAnnotationsV1','pdfDocumentTranslationRetainedV1','piPdfTranslationMarkersV1']))).toEqual(snapshot);
    await reopened.locator('.pi-undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await expect(reopened.locator('#pdf-original-copy')).toHaveText('移除本机原文件副本');
    if(await reopened.locator('#pdf-reader-menu').getAttribute('open')===null)await reopened.locator('#pdf-reader-menu > summary').click();
    await reopened.locator('#pdf-original-copy').click();await expect(reopened.locator('#pdf-original-copy')).toHaveText('在本机保留原 PDF');await reopened.close();await options.reload();await expect(storageTab).toHaveAttribute('aria-controls','settings-storage');await storageTab.click();await expect(row).toContainText('需选择原 PDF');
    const [fallback]=await Promise.all([context!.waitForEvent('page'),row.locator('.library-open').click()]);await expect(fallback.getByRole('heading',{name:'选择原 PDF 继续阅读'})).toBeVisible();
    await fallback.locator('#file-input').setInputFiles({name:'Renamed same content.pdf',mimeType:'application/pdf',buffer:pdf});await expect(fallback.locator('#page-number')).toHaveValue('2');expect(await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(['piPdfReadingAnnotationsV1','pdfDocumentTranslationRetainedV1','piPdfTranslationMarkersV1']))).toEqual(snapshot);
    await fallback.screenshot({path:info.outputPath('copy-removed-notes-retained.png')});expect(providerAttempts).toEqual([]);
  }finally{await context?.close();const resolved=path.resolve(profile);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('pi-original-restart-'))throw Error('Unsafe isolated profile cleanup');await rm(resolved,{recursive:true,force:true})}
});
