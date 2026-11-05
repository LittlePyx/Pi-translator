import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {executedExtensionBackground} from './support/executed-extension-source';

// Opt-in: run against immutable release ZIPs, never a daily browser profile.
const packageZip = process.env.PI_RELEASE_PACKAGE_ZIP;
const fixturePath = process.env.PI_RELEASE_STORAGE_FIXTURE;
const targetVersion=JSON.parse(readFileSync(path.resolve('package.json'),'utf8')).version as string;
const baselineVersion=process.env.PI_RELEASE_BASELINE_VERSION??'0.16.0';
const baselines = [
  ['archived', process.env.PI_RELEASE_ARCHIVED_BASELINE_ZIP ?? process.env.PI_RELEASE_PUBLISHED_BASELINE_ZIP,baselineVersion],
  ['development', process.env.PI_RELEASE_DEVELOPMENT_BASELINE_ZIP,baselineVersion],
  ['recent',process.env.PI_RELEASE_RECENT_BASELINE_ZIP,'0.17.0'],
] as const;
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function removeTemporaryRoot(root:string){
  if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('pi-release-'))throw new Error('Unexpected temporary installation path.');
  await rm(root,{recursive:true,force:true});
}

async function extract(zip: string, destination: string, root: string) {
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Installation directory must be inside the test temporary root.');
  }
  // Validate entry names before tar extracts the explicitly supplied package.
  const entries = execFileSync('tar', ['-tf', path.resolve(zip)], { encoding: 'utf8' });
  for (const entry of entries.trim().split(/\r?\n/)) {
    if (/^[A-Za-z]:/.test(entry) || path.isAbsolute(entry) || entry.replaceAll('\\', '/').split('/').includes('..')) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  execFileSync('tar', ['-xf', path.resolve(zip), '-C', destination]);
  return JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
}

async function launch(profile: string, install: string) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: edge,
    locale:'zh-CN',
    headless: process.env.PI_E2E_HEADLESS==='1',
    args: [`--disable-extensions-except=${install}`, `--load-extension=${install}`,
      '--no-first-run', '--no-default-browser-check'],
  });
  context.setDefaultTimeout(15_000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'zh-CN'})});
  const extensionId = new URL(worker.url()).host;
  expect(await executedExtensionBackground(context,extensionId)).toBe(createHash('sha256').update(await readFile(path.join(install,'background.js'))).digest('hex'));
  // Block and count all outbound HTTP(S), including service-worker fetches.
  let networkAttempts = 0;
  await context.route(/^https?:/, route => { networkAttempts++; return route.abort(); });
  await worker.evaluate(() => {
    const g = globalThis as any, original = g.fetch.bind(g);
    g.releaseNetworkAttempts = 0;
    g.fetch = (...args: any[]) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
      if (/^https?:/i.test(url)) {
        g.releaseNetworkAttempts++;
        throw new Error('Network blocked during saved-data release acceptance');
      }
      return original(...args);
    };
  });
  const page = await context.newPage();
  const url = `chrome-extension://${extensionId}/options.html`;
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  return { context, worker, page, extensionId,
    attempts: async () => networkAttempts + await worker.evaluate(() => (globalThis as any).releaseNetworkAttempts) };
}

async function restoreBackupInFreshProfile(root:string,install:string,backup:any,info:import('@playwright/test').TestInfo){
  const restored=await launch(path.join(root,'restore-profile'),install);
  try{
    await expect(restored.page.locator('#onboarding-dialog')).toBeVisible();await restored.page.locator('#onboarding-skip').click();
    await expect(restored.page.locator('#status')).toContainText('已进入完整设置');
    await restored.page.locator('[data-settings-target="storage"]').click();
    await expect(restored.page.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');
    await restored.page.locator('#library-storage-tools > summary').click();
    const snapshot=()=>restored.worker.evaluate(async()=>(globalThis as any).chrome.storage.local.get(null));
    const before=await snapshot(),file={name:`restored-v${backup.version}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))};
    await restored.page.locator('#library-backup-input').setInputFiles(file);
    await expect(restored.page.locator('#library-import-dialog')).toBeVisible();
    await expect(restored.page.locator('#library-import-summary')).toContainText(`最近阅读 ${Object.keys(backup.recentDocuments).length} 份`);
    if(backup.version===7)await expect(restored.page.locator('#library-import-summary')).toContainText(`最近列表名称与移除设置 ${Object.keys(backup.recentReadingOverrides).length} 份`);
    expect(await snapshot()).toEqual(before);
    await restored.page.locator('#library-import-cancel').click();await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(before);
    await restored.page.locator('#library-backup-input').setInputFiles(file);await expect(restored.page.locator('#library-import-dialog')).toBeVisible();expect(await snapshot()).toEqual(before);
    await restored.page.locator('#library-import-confirm').click();await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();await expect(restored.page.locator('#retained-storage-action-status')).toContainText('已恢复');
    const restoredValues=await snapshot();
    expect(restoredValues.piRecentPdfDocumentsV1).toEqual(backup.recentDocuments);expect(restoredValues.piPdfReadingStatesV1).toEqual(backup.readingStates);expect(restoredValues.piPdfReadingAnnotationsV1).toEqual(backup.readingAnnotations);
    if(backup.version===7){
      expect(restoredValues.piRecentPdfOverridesV1).toEqual(backup.recentReadingOverrides);
      for(const [id,raw] of Object.entries(backup.recentReadingOverrides)){
        const item=raw as {hidden:boolean;name:string},row=restored.page.locator(`[data-recent-id="${id}"]`);
        if(item.hidden)await expect(row).toHaveCount(0);else await expect(row.locator('.library-title')).toHaveText(item.name);
      }
    }
    await expect(restored.page.locator('#library-storage-tools')).not.toHaveAttribute('open','');
    await restored.page.locator('#library-storage-tools > summary').click();
    const downloading=restored.page.waitForEvent('download');await restored.page.locator('#export-library-backup').click();const download=await downloading;await download.saveAs(info.outputPath('restored-round-trip.json'));
    const again=JSON.parse(await readFile(info.outputPath('restored-round-trip.json'),'utf8'));
    const {exportedAt:oldDate,...expected}=backup,{exportedAt:newDate,...actual}=again;expect(actual).toEqual(expected);
    const older={...backup,version:5};delete older.recentDocuments;delete older.recentReadingOverrides;
    const beforeOld=await snapshot();await restored.page.locator('#library-backup-input').setInputFiles({name:'old-v5.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(older))});await expect(restored.page.locator('#library-import-dialog')).toBeVisible();expect(await snapshot()).toEqual(beforeOld);
    await restored.page.locator('#library-import-confirm').click();await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();
    expect((await snapshot()).piRecentPdfDocumentsV1).toEqual(backup.recentDocuments);
    expect((await snapshot()).piPdfReadingAnnotationsV1).toEqual(backup.readingAnnotations);
    if(backup.version===7){
      const v6={...backup,version:6};delete v6.recentReadingOverrides;
      await restored.page.locator('#library-backup-input').setInputFiles({name:'old-v6.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(v6))});await expect(restored.page.locator('#library-import-dialog')).toBeVisible();
      const preview=await snapshot();await restored.page.locator('#library-import-confirm').click();await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();
      expect((await snapshot()).piRecentPdfOverridesV1).toEqual(backup.recentReadingOverrides);
      const invalidVersion={...backup,version:6},beforeInvalidVersion=await snapshot();
      await restored.page.locator('#library-backup-input').setInputFiles({name:'invalid-version.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalidVersion))});await expect(restored.page.locator('#retained-storage-action-status')).toContainText('需要版本 7');await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(beforeInvalidVersion);
      expect(preview.piRecentPdfOverridesV1).toEqual(backup.recentReadingOverrides);
      const invalidOverride={...backup,recentReadingOverrides:{...backup.recentReadingOverrides,['e'.repeat(32)]:{name:'Invalid',hidden:'true',updatedAt:1}}},beforeInvalidOverride=await snapshot();
      await restored.page.locator('#library-backup-input').setInputFiles({name:'invalid-override.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalidOverride))});await expect(restored.page.locator('#retained-storage-action-status')).toContainText('列表设置无效');await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(beforeInvalidOverride);
    }
    const beforeInvalid=await snapshot(),invalid={...backup,recentDocuments:{...backup.recentDocuments,['f'.repeat(32)]:{title:'Invalid extra URL',updatedAt:1,url:'https://example.org/private.pdf'}}};
    await restored.page.locator('#library-backup-input').setInputFiles({name:'invalid-v6.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await expect(restored.page.locator('#retained-storage-action-status')).toContainText('最近阅读记录格式无效');await expect(restored.page.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(beforeInvalid);
    const pdf=await restored.context.newPage();const first=backup.documents.find((entry:any)=>entry.kind==='pdf');const record=first.record;
    const documentId=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
    await pdf.goto(`chrome-extension://${restored.extensionId}/pdf.html?library=${encodeURIComponent(documentId)}`);
    await expect(pdf.locator('.pdf-document-translation-block')).toHaveCount(record.blocks.length);await expect(pdf.locator('.katex').first()).toBeVisible();await pdf.close();
    const savedState=await snapshot();
    for(const entry of backup.documents.filter((entry:any)=>entry.kind==='pdf')){
      const r=entry.record,id=JSON.stringify(['pdf',r.documentKey,r.targetLanguage,r.sourceLanguage,r.style,r.contentMode]);
      const saved=entry.fixed?savedState[`fixedDocumentTranslationV1:${id}`]:savedState.pdfDocumentTranslationRetainedV1.find((v:any)=>JSON.stringify(['pdf',v.documentKey,v.targetLanguage,v.sourceLanguage,v.style,v.contentMode])===id);
      expect(saved).toBeDefined();expect(saved.blocks).toEqual(r.blocks);expect(saved.archivedBlocks).toEqual(r.archivedBlocks);
    }
    await restored.page.screenshot({path:info.outputPath('restored-library.png'),fullPage:true});expect(await restored.attempts()).toBe(0);
    await writeFile(info.outputPath('restore-report.json'),JSON.stringify({freshProfile:true,backupVersion:backup.version,previewAndCancelZeroWrites:true,exportImportExportEqualIgnoringExportedAt:true,version5KeepsRecentNames:true,...(backup.version===7?{version6KeepsListChoices:true,invalidOverrideAndWrongVersionZeroWrites:true,visibleNameAndHiddenRowVerified:true}:{}),invalidRecentMetadataZeroWrites:true,oldSavedBlocksAndArchivesUnchanged:true,providerAttempts:0},null,2));
  }finally{await restored.context.close()}
}

test(`fresh installation loads the exact ${targetVersion} ZIP without provider calls`, async ({}, info) => {
  test.skip(!packageZip, 'Set PI_RELEASE_PACKAGE_ZIP to the final ZIP.');
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(tmpdir(), 'pi-release-fresh-'));
  let context: BrowserContext | undefined;
  try {
    const manifest = await extract(packageZip!, path.join(root, 'extension'), root);
    expect(manifest.version).toBe(targetVersion);
    const app = await launch(path.join(root, 'profile'), path.join(root, 'extension'));
    context = app.context;
    expect(await app.worker.evaluate(()=>(globalThis as any).chrome.runtime.getManifest().version)).toBe(targetVersion);
    await expect(app.page.locator('#onboarding-dialog')).toBeVisible();
    await app.page.locator('#onboarding-skip').click();
    await expect(app.page.locator('#onboarding-dialog')).not.toBeVisible();
    await expect(app.page.locator('#status')).toContainText('已进入完整设置');
    const pdf = await context.newPage();
    await pdf.goto(`chrome-extension://${app.extensionId}/pdf.html`);
    await expect(pdf.locator('#file-input')).toBeAttached();
    await app.page.screenshot({ path: info.outputPath('fresh-settings.png'), fullPage: true });
    expect(await app.attempts()).toBe(0);
    await writeFile(info.outputPath('report.json'), JSON.stringify({ version: manifest.version,
      extensionId: app.extensionId, sha256: createHash('sha256').update(await readFile(packageZip!)).digest('hex'),
      providerAttempts: 0, onboarding: true, pdfReader: true }, null, 2));
  } finally {
    await context?.close();
    // root is the exact absolute directory returned by mkdtemp above.
    await removeTemporaryRoot(root);
  }
});

test('version 7 list choices survive same-ID reload, two restarts and fresh-profile restore with saved research intact',async({},info)=>{
  test.skip(!packageZip||!fixturePath,'Set final ZIP and storage fixture paths.');test.setTimeout(240_000);
  const fixture=JSON.parse(await readFile(fixturePath!,'utf8')),root=await mkdtemp(path.join(tmpdir(),'pi-release-v7-'));
  const install=path.join(root,'extension'),profile=path.join(root,'profile'),visibleId='c'.repeat(32);
  let context:BrowserContext|undefined;
  try{
    await extract(packageZip!,install,root);const app=await launch(profile,install);context=app.context;
    await app.page.locator('#onboarding-skip').click();await expect(app.page.locator('#onboarding-dialog')).not.toBeVisible();
    const local={...fixture.local,...fixture.developmentAdditions},hiddenId=Object.keys(local.piPdfReadingAnnotationsV1)[0]!;
    const recent={ [visibleId]:{title:'Visible original title',pageCount:2,updatedAt:100},[hiddenId]:{title:'Note original title',pageCount:1,updatedAt:101}};
    await app.worker.evaluate(async({local,recent,visibleId})=>{await(globalThis as any).chrome.storage.local.set({...local,piRecentPdfDocumentsV1:recent,piPdfReadingStatesV1:{...local.piPdfReadingStatesV1,[visibleId]:{pageNumber:2,pageRatio:.25,zoomLevel:1.25,fitWidth:false,sidebarExpanded:false,updatedAt:100}}})},{local,recent,visibleId});
    await app.page.locator('[data-settings-target="storage"]').click();
    for(const [id,name] of [[visibleId,'Visible <research> & notes'],[hiddenId,'Hidden notebook']] as const){
      const row=app.page.locator(`[data-recent-id="${id}"]`);await row.locator('.library-menu > summary').click();await row.getByRole('button',{name:'重命名',exact:true}).click();await row.getByRole('textbox',{name:'文档名称'}).fill(name);await row.getByRole('textbox',{name:'文档名称'}).press('Enter');await expect(row.locator('.library-title')).toHaveText(name);
    }
    const hiddenRow=app.page.locator(`[data-recent-id="${hiddenId}"]`);await hiddenRow.locator('.library-menu > summary').click();await hiddenRow.getByRole('button',{name:'从最近列表移除',exact:true}).click();await expect(hiddenRow).toHaveCount(0);
    const before=await app.worker.evaluate(async()=>(globalThis as any).chrome.storage.local.get(null));
    expect(before.piRecentPdfOverridesV1[hiddenId]).toMatchObject({name:'Hidden notebook',hidden:true});
    for(const key of Object.keys(local).filter(key=>key!=='piPdfReadingStatesV1'))expect(before[key]).toEqual(local[key]);
    for(const [id,state] of Object.entries(local.piPdfReadingStatesV1))expect(before.piPdfReadingStatesV1[id]).toEqual(state);
    await extract(packageZip!,install,root);
    const pending=context.waitForEvent('serviceworker',worker=>worker!==app.worker);
    await app.worker.evaluate(()=>(globalThis as any).chrome.runtime.reload()).catch(error=>{if(!(error instanceof Error)||!/closed|destroyed/i.test(error.message))throw error});
    const reloaded=await pending;expect(new URL(reloaded.url()).host).toBe(app.extensionId);
    expect(await executedExtensionBackground(context,app.extensionId)).toBe(createHash('sha256').update(await readFile(path.join(install,'background.js'))).digest('hex'));
    const expectedBuild=JSON.parse(await readFile(path.join(install,'build-info.json'),'utf8'));
    expect(await reloaded.evaluate(async()=>await(await fetch((globalThis as any).chrome.runtime.getURL('build-info.json'))).json())).toEqual(expectedBuild);
    expect(await reloaded.evaluate(async()=>(globalThis as any).chrome.storage.local.get(null))).toEqual(before);
    await context.close();context=undefined;
    let backup:any;
    for(let restart=1;restart<=2;restart++){
      const restarted=await launch(profile,install);context=restarted.context;expect(restarted.extensionId).toBe(app.extensionId);
      expect(await restarted.worker.evaluate(async()=>(globalThis as any).chrome.storage.local.get(null))).toEqual(before);
      await restarted.page.locator('[data-settings-target="storage"]').click();await expect(restarted.page.locator(`[data-recent-id="${hiddenId}"]`)).toHaveCount(0);await expect(restarted.page.locator(`[data-recent-id="${visibleId}"] .library-title`)).toHaveText('Visible <research> & notes');
      if(restart===2){
        await restarted.page.locator('#library-storage-tools > summary').click();const downloading=restarted.page.waitForEvent('download');await restarted.page.locator('#export-library-backup').click();await(await downloading).saveAs(info.outputPath('library-backup-v7.json'));backup=JSON.parse(await readFile(info.outputPath('library-backup-v7.json'),'utf8'));
        expect(backup.version).toBe(7);expect(backup.recentReadingOverrides).toEqual(before.piRecentPdfOverridesV1);expect(backup.readingStates).toEqual(before.piPdfReadingStatesV1);expect(backup.readingAnnotations).toEqual(before.piPdfReadingAnnotationsV1);
        await restarted.page.screenshot({path:info.outputPath('v7-after-second-restart.png'),fullPage:true});
      }
      expect(await restarted.attempts()).toBe(0);await context.close();context=undefined;
    }
    await restoreBackupInFreshProfile(root,install,backup,info);
    await writeFile(info.outputPath('report.json'),JSON.stringify({backupVersion:7,buildId:expectedBuild.buildId,packageSha256:createHash('sha256').update(await readFile(packageZip!)).digest('hex'),sameVersionReload:true,sameId:true,twoRestarts:true,allLocalValuesUnchanged:true,choicesCreatedThroughRowMenus:true,oldSavedResearchUnchanged:true,providerAttempts:0},null,2));
  }finally{await context?.close();await removeTemporaryRoot(root)}
});

for (const [name, baseline,fromVersion] of baselines) {
  test(`same-ID upgrade from ${name} ${fromVersion} preserves saved results and corrections`, async ({}, info) => {
    test.skip(!packageZip || !baseline || !fixturePath, 'Set final ZIP, baseline ZIP and storage fixture paths.');
    test.setTimeout(240_000);
    const fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
    const local={...fixture.local,...(name!=='archived'?fixture.developmentAdditions??{}:{})};
    const root = await mkdtemp(path.join(tmpdir(), `pi-release-upgrade-${name}-`));
    const install = path.join(root, 'extension'), profile = path.join(root, 'profile');
    let context: BrowserContext | undefined;
    try {
      expect((await extract(baseline!, install, root)).version).toBe(fromVersion);
      const old = await launch(profile, install);
      context = old.context;
      expect(await old.worker.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version)).toBe(fromVersion);
      await expect(old.page.locator('#onboarding-dialog')).toBeVisible();
      await old.page.locator('#onboarding-skip').click();
      await expect(old.page.locator('#onboarding-dialog')).not.toBeVisible();
      await expect(old.page.locator('#status')).toContainText('已进入完整设置');
      await old.worker.evaluate(async (values) => {
        const c=(globalThis as any).chrome,settings=(await c.storage.local.get('extensionSettings')).extensionSettings;
        await c.storage.local.set({...values,extensionSettings:{...settings,apiKeyStorage:'local',targetLanguage:'ja',style:'literal',generalPageMode:'allowlist',siteAllowlist:['docs.example.org'],sidebarWidth:412},apiKeysByProfile:{[settings.activeApiProfileId]:'release-upgrade-test-key'}});
      }, local);
      const keys = [...new Set([...Object.keys(local),'extensionSettings','apiKeysByProfile','piRecentPdfDocumentsV1'])];
      const before = await old.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      expect(Object.fromEntries(Object.keys(local).map(key=>[key,before[key]]))).toEqual(local);
      expect((await extract(packageZip!, install, root)).version).toBe(targetVersion);
      // Unpacked extensions require Reload to replace their cached worker code;
      // replacing files and restarting Edge alone can execute the old worker.
      const reloadedWorker = context.waitForEvent('serviceworker', worker => worker !== old.worker);
      await old.worker.evaluate(() => (globalThis as any).chrome.runtime.reload()).catch(error => {
        if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message)) throw error;
      });
      const newWorker = await reloadedWorker;
      expect(await newWorker.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version)).toBe(targetVersion);
      expect(await executedExtensionBackground(context,old.extensionId)).toBe(createHash('sha256').update(await readFile(path.join(install,'background.js'))).digest('hex'));
      const expectedBuild=JSON.parse(await readFile(path.join(install,'build-info.json'),'utf8'));
      expect(await newWorker.evaluate(async()=>await(await fetch((globalThis as any).chrome.runtime.getURL('build-info.json'))).json())).toEqual(expectedBuild);
      expect(await newWorker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys)).toEqual(before);
      await context.close(); context = undefined;

      const upgraded = await launch(profile, install);
      context = upgraded.context;
      expect(upgraded.extensionId).toBe(old.extensionId);
      await expect(upgraded.page.locator('#onboarding-dialog')).not.toBeVisible();
      const after = await upgraded.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      await writeFile(info.outputPath('after-upgrade.json'), JSON.stringify(after, null, 2));
      expect(after).toEqual(before);
      await upgraded.page.locator('[data-settings-target="storage"]').click();
      const entries = upgraded.page.locator('.library-entry');
      try {
        const annotationDocuments=Object.values(local.piPdfReadingAnnotationsV1??{}) as {annotations:unknown[]}[];
        const excerpts=(Object.values(local.piWebExcerptsV1??{}) as unknown[][]).reduce((count,items)=>count+items.length,0)+annotationDocuments.reduce((count,item)=>count+item.annotations.length,0);
        await expect(upgraded.page.locator('.library-entry:not(.library-source-result)')).toHaveCount(fixture.documentCount+annotationDocuments.length);
        await expect(upgraded.page.locator('.library-source-result')).toHaveCount(excerpts);
        await expect(entries).toHaveCount(fixture.documentCount+annotationDocuments.length+excerpts);
      } catch (error) {
        await writeFile(info.outputPath('library-error.txt'), await upgraded.page.locator('body').innerText());
        await upgraded.page.screenshot({ path: info.outputPath('library-error.png'), fullPage: true });
        throw error;
      }
      const pdf = await context.newPage();
      await pdf.goto(`chrome-extension://${upgraded.extensionId}/pdf.html?library=${encodeURIComponent(fixture.openDocumentId)}`);
      await expect(pdf.locator('.pdf-document-translation-block')).toHaveCount(fixture.visibleBlockCount);
      await expect(pdf.locator('.katex').first()).toBeVisible();
      await pdf.screenshot({ path: info.outputPath('upgraded-saved-formulas.png'), fullPage: true });
      await expect.poll(async () => upgraded.worker.evaluate(async () =>
        Object.keys((await (globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1).length))
        .toBe(Object.keys(before.piPdfReadingStatesV1).length + 1);
      await pdf.close();
      if(local.piPdfReadingAnnotationsV1){
        const reader=await context.newPage();await reader.goto(`chrome-extension://${upgraded.extensionId}/pdf.html`);
        await reader.locator('#file-input').setInputFiles({name:fixture.annotationPdf.name,mimeType:'application/pdf',buffer:Buffer.from(fixture.annotationPdf.base64,'base64')});
        await expect(reader.locator('#page-count')).toHaveText('1');
        await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready');
        await expect.poll(()=>reader.locator('.pdf-reading-highlight-layer [data-annotation-id]').evaluateAll(nodes=>new Set(nodes.map(n=>(n as HTMLElement).dataset.annotationId)).size)).toBe(2);
        await reader.locator('#pdf-reader-menu > summary').click();await reader.locator('#pdf-open-annotations').click();
        await expect(reader.locator('.pdf-reading-annotation')).toHaveCount(2);await expect(reader.locator('.pdf-reading-annotation-note').first()).toHaveText('升级前保存的阅读笔记。');
        await reader.screenshot({path:info.outputPath('upgraded-annotations.png')});await reader.locator('.pdf-annotation-close').click();await reader.close({runBeforeUnload:true});await expect.poll(()=>reader.isClosed()).toBe(true);
        await expect.poll(async()=>Object.keys((await upgraded.worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('piPdfReadingStatesV1')).piPdfReadingStatesV1))).length).toBe(Object.keys(before.piPdfReadingStatesV1).length+2);
      }
      await upgraded.page.locator('#library-storage-tools > summary').click();
      const pending = upgraded.page.waitForEvent('download');
      await upgraded.page.locator('#export-library-backup').click();
      await (await pending).saveAs(info.outputPath('library-backup.json'));
      const backup = JSON.parse(await readFile(info.outputPath('library-backup.json'), 'utf8'));
      expect(backup.version).toBe(6);
      const recent=await upgraded.worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('piRecentPdfDocumentsV1')).piRecentPdfDocumentsV1);
      expect(backup.recentDocuments).toEqual(recent);
      expect(Object.keys(recent)).toHaveLength(local.piPdfReadingAnnotationsV1?2:1);
      const cachedRecord=local.pdfDocumentTranslationRetainedV1.find((record:any)=>fixture.openDocumentId.includes(record.documentKey));
      const cachedReadingId=createHash('sha256').update(`pdf-content:${cachedRecord.sourceFingerprint}`).digest('hex').slice(0,32);
      const originalIds=Object.keys(local.piPdfReadingAnnotationsV1??{});
      expect(Object.keys(recent).sort()).toEqual([cachedReadingId,...originalIds].sort());
      for(const [id,item] of Object.entries(recent)){
        expect(id).toMatch(/^[a-f0-9]{32}$/u);
        expect(Object.keys(item as object).sort()).toEqual(originalIds.includes(id)?['pageCount','title','updatedAt']:['title','updatedAt']);
        expect(item).toMatchObject({title:expect.any(String),updatedAt:expect.any(Number)});
        if(originalIds.includes(id))expect((item as {pageCount:number}).pageCount).toBe(1);
      }
      expect(backup.documents).toHaveLength(fixture.documentCount);
      for (const record of local.pdfDocumentTranslationRetainedV1) {
        const exported = backup.documents.find((entry: any) => entry.record.documentKey === record.documentKey);
        expect(exported.record.blocks).toEqual(record.blocks);
        expect(exported.record.archivedBlocks).toEqual(record.archivedBlocks);
        expect(exported.record.documentSignatures).toEqual(record.documentSignatures);
      }
      expect(backup.documentTerms).toEqual(local.documentTranslationMemoryV1);
      expect(backup.webExcerpts).toEqual(local.piWebExcerptsV1);
      expect(backup.readingAnnotations).toEqual(local.piPdfReadingAnnotationsV1??{});
      if(local.piPdfReadingBookmarksV1)expect(backup.bookmarks).toEqual(local.piPdfReadingBookmarksV1);
      await expect(upgraded.page.locator('#target-language')).toHaveValue('ja');
      expect(JSON.stringify(backup)).not.toContain('release-upgrade-test-key');
      const afterOpen = await upgraded.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys);
      const { piPdfReadingStatesV1: oldPositions,piRecentPdfDocumentsV1:oldRecent, ...oldPayloads } = before;
      const { piPdfReadingStatesV1: newPositions,piRecentPdfDocumentsV1:newRecent, ...newPayloads } = afterOpen;
      expect(oldRecent).toBeUndefined();expect(newRecent).toEqual(recent);
      expect(newPayloads).toEqual(oldPayloads);
      for (const key of Object.keys(oldPositions)) expect(newPositions[key]).toEqual(oldPositions[key]);
      const addedPositions = Object.keys(newPositions).filter(key => !(key in oldPositions));
      expect(addedPositions).toHaveLength(local.piPdfReadingAnnotationsV1?2:1);
      expect(addedPositions.map(key=>newPositions[key]).find((position:any)=>position.translation?.signature===local.pdfDocumentTranslationRetainedV1.find((r:any)=>fixture.openDocumentId.includes(r.documentKey)).documentSignatures[0])).toMatchObject({translation:{ mode: 'reading',
        signature: local.pdfDocumentTranslationRetainedV1.find((r: any) =>
          fixture.openDocumentId.includes(r.documentKey)).documentSignatures[0] }});
      expect(await upgraded.attempts()).toBe(0);
      await context.close(); context = undefined;
      const restarted = await launch(profile, install);
      context = restarted.context;
      expect(restarted.extensionId).toBe(old.extensionId);
      expect(await restarted.worker.evaluate(async keys => (globalThis as any).chrome.storage.local.get(keys), keys)).toEqual(afterOpen);
      expect(await restarted.attempts()).toBe(0);
      await writeFile(info.outputPath('report.json'), JSON.stringify({ baseline: name,
        baselineSha256: createHash('sha256').update(await readFile(baseline!)).digest('hex'),
        packageSha256: createHash('sha256').update(await readFile(packageZip!)).digest('hex'),
        extensionId: old.extensionId, oldVersion:fromVersion,newVersion:targetVersion,buildId:expectedBuild.buildId,
        protectedKeys: keys, wholeLocalValuesUnchangedAtUpgrade: true, secondRestart: true,
        savedPayloadsAndOldPositionsUnchangedAfterReading: true, newReadingAnchors: addedPositions,
        backupVersion: backup.version, actualSavedResultsReplayed: fixture.actualSavedResults,
        providerAttempts: 0 }, null, 2));
      await context.close();context=undefined;
      await restoreBackupInFreshProfile(root,install,backup,info);
    } finally {
      await context?.close();
      await removeTemporaryRoot(root);
    }
  });
}

test('keeps glossary schemes, purpose preferences and document bindings across restart and settings backup restore',async({},info)=>{
  test.skip(!packageZip||!fixturePath,'Set the exact package and storage fixture.');test.setTimeout(120000);
  const root=await mkdtemp(path.join(tmpdir(),'pi-release-glossary-')),install=path.join(root,'extension'),profile=path.join(root,'profile');let running:Awaited<ReturnType<typeof launch>>|undefined;
  const scheme={glossaryProfiles:[{id:'statistics',name:'统计学',entries:[{source:'power',target:'检验效能'}]},{id:'energy',name:'能源',entries:[{source:'power',target:'功率'}]}],activeGlossaryProfileId:'statistics',documentGlossaryProfiles:{'doc-paper':'energy'},purposePreferences:{purposes:['research','learning'],researchField:'统计学与机器学习'}};
  try{
    await extract(packageZip!,install,root);running=await launch(profile,install);await expect(running.page.locator('#onboarding-dialog')).toBeVisible();await running.page.locator('#onboarding-skip').click();await expect(running.page.locator('#status')).toContainText('已进入完整设置');
    const fixture=JSON.parse(await readFile(fixturePath!,'utf8')),local={...fixture.local,...fixture.developmentAdditions};await running.worker.evaluate(async({local,scheme})=>{const c=(globalThis as any).chrome,s=(await c.storage.local.get('extensionSettings')).extensionSettings;await c.storage.local.set({...local,extensionSettings:{...s,...scheme,onboardingCompleted:true}})},{local,scheme});await running.context.close();running=undefined;
    running=await launch(profile,install);const state=await running.worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));expect(state.extensionSettings).toMatchObject(scheme);for(const key of Object.keys(local).filter(k=>!['extensionSettings','apiKeysByProfile','apiKey','deepseekApiKey'].includes(k)))expect(state[key]).toEqual(local[key]);
    await running.page.goto(`chrome-extension://${running.extensionId}/options.html#translation`);await running.page.locator('#academic-glossary').locator('xpath=ancestor::details').locator(':scope > summary').click();await expect(running.page.locator('#glossary-profile')).toHaveValue('statistics');await expect(running.page.locator('#academic-glossary')).toHaveValue('power = 检验效能');await running.page.locator('#purpose-preferences > summary').click();await expect(running.page.locator('#purpose-research-field')).toHaveValue('统计学与机器学习');await expect(running.page.locator('#purpose-preferences input[value=research]')).toBeChecked();await expect(running.page.locator('#purpose-preferences input[value=learning]')).toBeChecked();
    await running.page.locator('[data-settings-target="support"]').click();await running.page.locator('#export-settings').locator('xpath=ancestor::details').locator(':scope > summary').click();const downloading=running.page.waitForEvent('download');await running.page.locator('#export-settings').click();const download=await downloading,file=info.outputPath('settings-with-schemes.json');await download.saveAs(file);const config=JSON.parse(await readFile(file,'utf8'));expect(config.settings).toMatchObject(scheme);expect(config.containsApiKeys).toBe(false);const attempts=await running.attempts();expect(attempts).toBe(0);await running.context.close();running=undefined;
    running=await launch(path.join(root,'restored-profile'),install);await expect(running.page.locator('#onboarding-dialog')).toBeVisible();await running.page.locator('#onboarding-skip').click();await expect(running.page.locator('#status')).toContainText('已进入完整设置');await running.worker.evaluate(async local=>{const copy={...local};delete copy.extensionSettings;await(globalThis as any).chrome.storage.local.set(copy)},local);const before=await running.worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));await running.page.locator('[data-settings-target="support"]').click();await running.page.locator('#import-settings-file').setInputFiles(file);await expect(running.page.locator('#support-status')).toContainText('配置已导入');const restored=await running.worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));expect(restored.extensionSettings).toMatchObject(scheme);for(const key of Object.keys(before).filter(k=>!['extensionSettings','apiKeysByProfile','apiKey','deepseekApiKey','configurationRevision'].includes(k)&&!k.toLowerCase().includes('configurationrevision')))expect(restored[key]).toEqual(before[key]);expect(await running.attempts()).toBe(0);await running.context.close();running=undefined;
    running=await launch(path.join(root,'restored-profile'),install);expect((await running.worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings))).toMatchObject(scheme);expect(await running.attempts()).toBe(0);
    await writeFile(info.outputPath('glossary-restart-report.json'),JSON.stringify({exactZip:true,sourceRestart:true,keyFreeSettingsBackup:true,freshSettingsRestore:true,restoredRestart:true,oldResearchFieldsPreserved:true,purposePreferencesRestored:true,providerAttempts:0},null,2));
  }finally{await running?.context.close();await removeTemporaryRoot(root)}
});
