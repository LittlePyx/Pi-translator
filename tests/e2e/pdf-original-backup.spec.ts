import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests,createTwoPageTextPdf} from './support/edge-extension-fixture';
import type {Page} from '@playwright/test';

installEdgeExtensionHooks();
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function source(label:string){const bytes=createTwoPageTextPdf(`${label}: the source stays intact.`,'Saved notes and page two remain available.');const fingerprint=hash(bytes),id=hash(`pdf-content:${fingerprint}`).slice(0,32);return {metadata:{id,fingerprint,name:`${label}.pdf`,size:bytes.length,savedAt:12},bytes:[...bytes]}}
const first=source('First paper'),second=source('Second paper'),third=source('Other paper');
const worker=()=>context.serviceWorkers()[0]!;
const snapshot=()=>worker().evaluate(async()=>{const data=await (globalThis as any).chrome.storage.local.get(null);delete data.piLibraryRecoveryV1;return data});
const journal=()=>worker().evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('piLibraryRecoveryV1')).piLibraryRecoveryV1);
async function originals(page:Page){return page.evaluate(()=>new Promise<any[]>((resolve,reject)=>{const request=indexedDB.open('pi-original-pdfs-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('metadata',{keyPath:'id'});request.result.createObjectStore('files')};request.onsuccess=()=>{const db=request.result,tx=db.transaction(['metadata','files']),meta=tx.objectStore('metadata').getAll(),files=tx.objectStore('files').getAll();tx.oncomplete=()=>{db.close();resolve(meta.result.map((item:any,index:number)=>({metadata:item,bytes:[...new Uint8Array(files.result[index])]})))};tx.onabort=()=>reject(tx.error)}}))}
async function seed(page:Page,records:ReturnType<typeof source>[]){await page.evaluate(records=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('pi-original-pdfs-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('metadata',{keyPath:'id'});request.result.createObjectStore('files')};request.onsuccess=()=>{const db=request.result,tx=db.transaction(['metadata','files'],'readwrite');tx.objectStore('metadata').clear();tx.objectStore('files').clear();for(const row of records){tx.objectStore('metadata').add(row.metadata);tx.objectStore('files').add(new Uint8Array(row.bytes).buffer,row.metadata.id)}tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}),records)}
async function options(){const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(page.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');return page}
async function exportBundle(page:Page,path:string){await page.locator('#library-storage-tools > summary').click();await page.locator('#library-backup-originals').check();await expect(page.locator('#library-backup-size')).toContainText('份原 PDF');await expect(page.locator('#export-library-backup')).toBeEnabled();const download=page.waitForEvent('download');await page.locator('#export-library-backup').click();const result=await download;expect(result.suggestedFilename()).toMatch(/\.pibackup$/);await result.saveAs(path);await expect(page.locator('#library-backup-progress-dialog')).not.toBeVisible();return readFile(path)}
async function load(page:Page,bytes:Buffer){await page.locator('#library-backup-input').setInputFiles({name:'papers.pibackup',mimeType:'application/octet-stream',buffer:bytes})}
async function preserve(run:(page:Page)=>Promise<void>){const previous=await snapshot(),page=await options(),calls=textRequests.length+visionRequests.length;try{await seed(page,[]);await run(page);expect(textRequests.length+visionRequests.length).toBe(calls)}finally{await seed(page,[]);await page.close();await worker().evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.local.set(previous)},previous)}}

test('backs up original bytes, previews without writes, preserves duplicates and reopens restored source at its reading position',async({},info)=>preserve(async page=>{
  await seed(page,[first,second]);
  const reader=await context.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles({name:first.metadata.name,mimeType:'application/pdf',buffer:Buffer.from(first.bytes)});await expect(reader.locator('#page-count')).toHaveText('2');await reader.locator('#page-number').fill('2');await reader.locator('#page-number').press('Enter');
  await expect.poll(async()=>worker().evaluate(async id=>((await(globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1||{})[id]?.pageNumber,first.metadata.id)).toBe(2);await reader.close();
  const note={id:'source-note',kind:'highlight',sourceTitle:first.metadata.name,note:'检查研究条件，保留人工笔记。',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Saved notes and page two remain available.',prefix:'',suffix:''},createdAt:1,updatedAt:2};
  await worker().evaluate(async({id,note})=>(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[id]:{annotations:[note],updatedAt:2}}}),{id:first.metadata.id,note});
  const bytes=await exportBundle(page,info.outputPath('papers.pibackup')),local=await snapshot(),old=await originals(page);
  await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();await expect(page.locator('#library-import-summary')).toContainText('已有 2 份');expect(await snapshot()).toEqual(local);expect(await originals(page)).toEqual(old);await page.locator('#library-import-cancel').click();expect(await originals(page)).toEqual(old);
  const kept={...first,metadata:{...first.metadata,name:'本机文件名.pdf',savedAt:123}};await seed(page,[kept]);
  await load(page,bytes);await expect(page.locator('#library-import-summary')).toContainText('新增 1 份 · 已有 1 份');await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-dialog')).not.toBeVisible();expect((await originals(page)).sort((a,b)=>a.metadata.id.localeCompare(b.metadata.id))).toEqual([kept,second].sort((a,b)=>a.metadata.id.localeCompare(b.metadata.id)));
  expect((await snapshot()).piPdfReadingAnnotationsV1).toEqual(local.piPdfReadingAnnotationsV1);expect((await snapshot()).piPdfReadingStatesV1).toEqual(local.piPdfReadingStatesV1);
  await page.reload();await expect(page.locator('#library-backup-originals')).not.toBeChecked();const row=page.locator(`[data-recent-id="${first.metadata.id}"]`);await expect(row).toBeVisible();const opened=context.waitForEvent('page');await row.locator('.library-open').click();const reopened=await opened;await expect(reopened.locator('#page-count')).toHaveText('2');await expect(reopened.locator('#page-number')).toHaveValue('2');await reopened.close();
}));

test('blocks damaged source data, stale original state and capacity overflow before changing either store',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('one-paper.pibackup'));await seed(page,[]);const local=await snapshot();const damaged=Buffer.from(bytes);damaged[damaged.length-1]=damaged[damaged.length-1]!^1;
  await load(page,damaged);await expect(page.locator('#retained-storage-action-status')).toContainText('校验失败');expect(await originals(page)).toEqual([]);expect(await snapshot()).toEqual(local);
  await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();await seed(page,[third]);await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('原 PDF 已变化');expect(await originals(page)).toEqual([third]);expect(await snapshot()).toEqual(local);await page.locator('#library-import-cancel').click();
  const many=Array.from({length:30},(_,i)=>source(`Retained ${i}`));await seed(page,many);const before=await originals(page);await load(page,bytes);await expect(page.locator('#retained-storage-action-status')).toContainText('超过 30 份或 200 MB');expect(await originals(page)).toEqual(before);expect(await snapshot()).toEqual(local);
}));

test('keeps original copies unchanged when library preview becomes stale',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('stale-library.pibackup'));await seed(page,[]);await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();
  await worker().evaluate(async()=>(globalThis as any).chrome.storage.local.set({retainedDocumentNamesV1:{new:'新名称'}}));const local=await snapshot();await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('文档库已变化');expect(await originals(page)).toEqual([]);expect(await snapshot()).toEqual(local);await page.locator('#library-import-cancel').click();
}));

test('rolls back newly added original copies if the library write fails',async({},info)=>preserve(async page=>{
  await seed(page,[first,second]);const bytes=await exportBundle(page,info.outputPath('rollback.pibackup'));await seed(page,[third]);await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();const local=await snapshot();
  await page.evaluate(()=>{const c=(globalThis as any).chrome,original=c.storage.local.set.bind(c.storage.local);c.storage.local.set=async(value:Record<string,unknown>)=>{if('pdfDocumentTranslationRetainedV1' in value)throw Error('Injected library storage failure');return original(value)}});
  await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('Injected library storage failure');expect(await originals(page)).toEqual([third]);expect(await snapshot()).toEqual(local);expect((await journal()).pending).toHaveLength(1);await page.locator('#library-import-cancel').click();
}));

test('aborts the whole PDF transaction on a write failure before writing the library',async({},info)=>preserve(async page=>{
  await seed(page,[first,second]);const bytes=await exportBundle(page,info.outputPath('quota.pibackup'));await seed(page,[third]);await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();const local=await snapshot();
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.add;let writes=0;IDBObjectStore.prototype.add=function(...args:Parameters<IDBObjectStore['add']>){if(this.name==='files'&&++writes===2){IDBObjectStore.prototype.add=original;throw new DOMException('Injected quota failure','QuotaExceededError')}return original.apply(this,args)}});
  await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('恢复原 PDF 失败');expect(await originals(page)).toEqual([third]);expect(await snapshot()).toEqual(local);expect((await journal()).pending).toHaveLength(1);await page.locator('#library-import-cancel').click();
}));

test('cancels export during source verification without downloading or modifying records',async()=>preserve(async page=>{
  await seed(page,[first]);const local=await snapshot(),copies=await originals(page);await page.locator('#library-storage-tools > summary').click();await page.locator('#library-backup-originals').check();await expect(page.locator('#export-library-backup')).toBeEnabled();
  await page.evaluate(()=>{const original=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args:Parameters<SubtleCrypto['digest']>)=>{crypto.subtle.digest=original;(globalThis as any).backupGateReached=true;await new Promise<void>(resolve=>(globalThis as any).releaseBackupGate=resolve);return original(...args)}});
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));await page.locator('#export-library-backup').click();await expect.poll(()=>page.evaluate(()=>(globalThis as any).backupGateReached)).toBe(true);await page.locator('#library-backup-progress-cancel').click();await page.evaluate(()=>(globalThis as any).releaseBackupGate());await expect(page.locator('#export-library-backup')).toBeEnabled();expect(downloads).toEqual([]);expect(await snapshot()).toEqual(local);expect(await originals(page)).toEqual(copies);
}));

for(const phase of ['initial','repreview'] as const)test(`cancels ${phase} import verification without changing either store`,async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath(`cancel-${phase}.pibackup`));await seed(page,[]);
  if(phase==='repreview'){
    await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();await worker().evaluate(async()=>(globalThis as any).chrome.storage.local.set({retainedDocumentNamesV1:{changed:'新的本机名称'}}));await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('文档库已变化');
  }
  const local=await snapshot();
  await page.evaluate(()=>{const original=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args:Parameters<SubtleCrypto['digest']>)=>{crypto.subtle.digest=original;(globalThis as any).backupGateReached=true;await new Promise<void>(resolve=>(globalThis as any).releaseBackupGate=resolve);return original(...args)}});
  if(phase==='initial')await load(page,bytes);else await page.locator('#library-import-confirm').click();
  await expect.poll(()=>page.evaluate(()=>(globalThis as any).backupGateReached)).toBe(true);await page.locator('#library-backup-progress-cancel').click();await page.evaluate(()=>(globalThis as any).releaseBackupGate());await expect(page.locator('#import-library-backup')).toBeEnabled();
  if(phase==='repreview'){await expect(page.locator('#library-import-confirm')).toBeEnabled();await page.locator('#library-import-cancel').click()}else await expect(page.locator('#library-import-dialog')).not.toBeVisible();
  expect(await originals(page)).toEqual([]);expect(await snapshot()).toEqual(local);
}));

test('shows optional file count and import preview in narrow English layout',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('english.pibackup'));await worker().evaluate(async()=>(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en'}));await page.reload();await page.setViewportSize({width:360,height:700});await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#library-storage-tools > summary').click();await expect(page.locator('#library-backup-originals')).not.toBeChecked();await page.locator('#library-backup-originals').check();await expect(page.locator('#library-backup-size')).toContainText('Original PDFs: 1');await page.screenshot({path:info.outputPath('optional-originals-360-en.png')});
  await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();await expect(page.locator('#library-import-summary')).toContainText('Original PDFs: 0 new');await expect(page.locator('#library-import-summary')).not.toContainText('0 documents');await expect(page.locator('#library-import-summary')).not.toContainText('0 conflicts');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:info.outputPath('original-preview-360-en.png')});await page.locator('#library-import-cancel').click();
}));


test('recovers safely after closing the importing window between original and library writes',async({},info)=>preserve(async page=>{
  await seed(page,[first]);
  const bytes=await exportBundle(page,info.outputPath('interrupted.pibackup'));
  await seed(page,[third]);
  const local=await snapshot();
  const importing=await options();
  await load(importing,bytes);await expect(importing.locator('#library-import-dialog')).toBeVisible();
  await importing.evaluate(()=>{const storage=(globalThis as any).chrome.storage.local,original=storage.set.bind(storage);storage.set=async(value:Record<string,unknown>)=>{if('pdfDocumentTranslationRetainedV1' in value){(globalThis as any).beforeLibraryCommit=true;await new Promise(()=>{})}return original(value)}});
  const resumed=await options();
  await importing.locator('#library-import-confirm').click();
  await expect.poll(()=>importing.evaluate(()=>(globalThis as any).beforeLibraryCommit)).toBe(true);
  expect((await journal()).pending).toHaveLength(1);
  expect(await journal()).toEqual({version:1,pending:[expect.stringMatching(/^[a-f0-9]{64}$/)]});
  try{
    await expect.poll(()=>resumed.evaluate(async()=>((await navigator.locks.query()).pending??[]).filter(lock=>lock.name==='pi-document-storage-v1').length)).toBeGreaterThan(0);
    await expect(resumed.locator('#library-recovery-hint')).not.toBeVisible();
    await importing.close();
    await expect(resumed.locator('#library-recovery-hint')).toBeVisible();
    expect((await originals(page)).map(item=>item.metadata.id).sort()).toEqual([first.metadata.id,third.metadata.id].sort());
    expect(await snapshot()).toEqual(local);
    const wrong=resumed.waitForEvent('filechooser');await resumed.locator('#library-recovery-continue').click();await (await wrong).setFiles({name:'different.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'pi-translator-document-library',version:1,documents:[]}))});
    await expect(resumed.locator('#retained-storage-action-status')).toContainText('请选择上次恢复使用的备份文件');
    await expect(resumed.locator('#library-recovery-hint')).toContainText('请选择上次恢复使用的备份文件');
    await expect(resumed.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(local);expect((await journal()).pending).toHaveLength(1);
    const choose=resumed.waitForEvent('filechooser');await resumed.locator('#library-recovery-continue').click();await (await choose).setFiles({name:'papers.pibackup',mimeType:'application/octet-stream',buffer:bytes});
    await expect(resumed.locator('#library-import-dialog')).toBeVisible();
    await expect(resumed.locator('#library-import-summary')).toContainText('已有 1 份');
    expect(await snapshot()).toEqual(local);
    await resumed.locator('#library-import-confirm').click();
    await expect(resumed.locator('#library-import-dialog')).not.toBeVisible();
    await expect(resumed.locator('#retained-storage-action-status')).toContainText('已有 1 份保持不变');
    await expect(resumed.locator('#library-recovery-hint')).not.toBeVisible();
    expect(await journal()).toBeUndefined();
    expect((await originals(page)).map(item=>item.metadata.id).sort()).toEqual([first.metadata.id,third.metadata.id].sort());
  }finally{if(!importing.isClosed())await importing.close();await resumed.close()}
}));


test('does not report interruption after the library commit even if the window closes before cleanup',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('committed.pibackup'));await seed(page,[third]);
  const importing=await options();await load(importing,bytes);await expect(importing.locator('#library-import-dialog')).toBeVisible();
  await importing.evaluate(()=>{const storage=(globalThis as any).chrome.storage.local,original=storage.remove.bind(storage);storage.remove=async(key:string|string[])=>{if(key==='piLibraryRecoveryV1'){(globalThis as any).beforeCleanup=true;await new Promise(()=>{})}return original(key)}});
  await importing.locator('#library-import-confirm').click();
  await expect.poll(()=>importing.evaluate(()=>(globalThis as any).beforeCleanup)).toBe(true);
  expect((await journal()).pending).toEqual([]);
  await importing.close();
  const reopened=await options();try{await expect(reopened.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');await expect(reopened.locator('#library-recovery-hint')).not.toBeVisible();expect((await originals(page)).map(item=>item.metadata.id).sort()).toEqual([first.metadata.id,third.metadata.id].sort())}finally{await reopened.close()}
}));

test('offers a recoverable hint after the journal is written but before any data is changed',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('before-originals.pibackup'));await seed(page,[third]);const local=await snapshot();
  const importing=await options();await load(importing,bytes);await expect(importing.locator('#library-import-dialog')).toBeVisible();
  await importing.evaluate(()=>{const storage=(globalThis as any).chrome.storage.local,original=storage.set.bind(storage);storage.set=async(value:Record<string,unknown>)=>{await original(value);if('piLibraryRecoveryV1' in value&&!('pdfDocumentTranslationRetainedV1' in value)){(globalThis as any).journalWritten=true;await new Promise(()=>{})}}});
  await importing.locator('#library-import-confirm').click();await expect.poll(()=>importing.evaluate(()=>(globalThis as any).journalWritten)).toBe(true);await importing.close();
  const reopened=await options();try{await expect(reopened.locator('#library-recovery-hint')).toBeVisible();expect(await snapshot()).toEqual(local);expect(await originals(page)).toEqual([third]);
    await reopened.locator('#library-recovery-dismiss').click();await expect(reopened.locator('#library-recovery-hint')).not.toBeVisible();expect((await journal()).pending).toHaveLength(1);
    await reopened.reload();await expect(reopened.locator('#library-recovery-hint')).toBeVisible();
  }finally{await reopened.close()}
}));


test('does not start restore when the recovery record cannot be written',async({},info)=>preserve(async page=>{
  await seed(page,[first]);const bytes=await exportBundle(page,info.outputPath('journal-failure.pibackup'));await seed(page,[third]);const local=await snapshot();
  await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();
  await page.evaluate(()=>{const storage=(globalThis as any).chrome.storage.local,original=storage.set.bind(storage);storage.set=async(value:Record<string,unknown>)=>{if('piLibraryRecoveryV1' in value&&!('pdfDocumentTranslationRetainedV1' in value))throw Error('Injected journal failure');return original(value)}});
  await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-status')).toContainText('Injected journal failure');
  expect(await journal()).toBeUndefined();expect(await snapshot()).toEqual(local);expect(await originals(page)).toEqual([third]);await page.locator('#library-import-cancel').click();
}));

for(const language of ['zh-CN','en'] as const)test(`shows the recovery hint without clipping in narrow ${language} layout`,async({},info)=>preserve(async page=>{
  await worker().evaluate(async language=>await (globalThis as any).chrome.storage.local.set({uiLanguagePreference:language,piLibraryRecoveryV1:{version:1,pending:['a'.repeat(64)]}}),language);
  await page.reload();await page.setViewportSize({width:300,height:620});await page.emulateMedia({colorScheme:'dark'});
  const hint=page.locator('#library-recovery-hint');await expect(hint).toBeVisible();await expect(hint).toContainText(language==='en'?'previous restore may be incomplete':'上次恢复可能未完成');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await expect(page.locator('#library-recovery-continue')).toBeEnabled();
  await expect.poll(()=>page.locator('#library-recovery-continue').evaluate(el=>{const c=getComputedStyle(el),rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number),lum=(v:number[])=>v.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i]!,0);const a=lum(rgb(c.color)),b=lum(rgb(c.backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})).toBeGreaterThan(4.5);
  const appearance=await page.locator('#library-recovery-continue').evaluate(el=>{const c=getComputedStyle(el);return {color:c.color,background:c.backgroundColor,opacity:c.opacity}});
  await info.attach('button-appearance',{body:JSON.stringify(appearance),contentType:'application/json'});
  await page.screenshot({path:info.outputPath(`recovery-${language}-300.png`)});
  for(const button of await hint.locator('button').all()){const box=await button.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(300)}
  await page.locator('#library-recovery-dismiss').click();await expect(hint).not.toBeVisible();
}));


test('preserves a different pending restore when another backup is imported',async({},info)=>preserve(async page=>{
  await seed(page,[first]);
  await worker().evaluate(async()=>(globalThis as any).chrome.storage.local.set({piLibraryRecoveryV1:{version:1,pending:['a'.repeat(64)]}}));
  await expect(page.locator('#library-recovery-hint')).toBeVisible();await page.locator('#library-recovery-dismiss').click();
  const bytes=await exportBundle(page,info.outputPath('another-backup.pibackup'));expect(bytes.includes(Buffer.from('piLibraryRecoveryV1'))).toBe(false);
  await seed(page,[third]);await load(page,bytes);await expect(page.locator('#library-import-dialog')).toBeVisible();await page.locator('#library-import-confirm').click();
  await expect(page.locator('#library-import-dialog')).not.toBeVisible();await expect(page.locator('#retained-storage-action-status')).toContainText('已恢复原 PDF');
  expect((await journal()).pending).toEqual(['a'.repeat(64)]);expect((await originals(page)).map(item=>item.metadata.id).sort()).toEqual([first.metadata.id,third.metadata.id].sort());
}));


test('continues any matching pending backup when several restores were interrupted',async()=>preserve(async page=>{
  const firstText=JSON.stringify({format:'pi-translator-document-library',version:1,documents:[],exportedAt:'first'}),secondText=JSON.stringify({format:'pi-translator-document-library',version:1,documents:[],exportedAt:'second'});
  const hashes=await page.evaluate(async texts=>Promise.all(texts.map(async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([text,false,[]]))))].map(v=>v.toString(16).padStart(2,'0')).join(''))),[firstText,secondText]);
  await worker().evaluate(async pending=>(globalThis as any).chrome.storage.local.set({piLibraryRecoveryV1:{version:1,pending}}),hashes);
  await expect(page.locator('#library-recovery-hint')).toBeVisible();const before=await snapshot();
  const choose=page.waitForEvent('filechooser');await page.locator('#library-recovery-continue').click();await (await choose).setFiles({name:'second.json',mimeType:'application/json',buffer:Buffer.from(secondText)});
  await expect(page.locator('#library-import-dialog')).toBeVisible();expect(await snapshot()).toEqual(before);expect((await journal()).pending).toEqual(hashes);
  await page.locator('#library-import-confirm').click();await expect(page.locator('#library-import-dialog')).not.toBeVisible();await expect(page.locator('#retained-storage-action-status')).toContainText('备份已合并');
  expect((await journal()).pending).toEqual([hashes[0]]);await expect(page.locator('#library-recovery-hint')).toBeVisible();
}));
