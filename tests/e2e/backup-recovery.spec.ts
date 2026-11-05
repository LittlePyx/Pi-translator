import {readFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
import {parseFormulaDocument,formulaDocumentText} from '../../core/translation/formula-document';

installEdgeExtensionHooks();
const file=(data:unknown)=>({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
const worker=()=>context.serviceWorkers()[0]!;
async function snapshot(){return worker().evaluate(async()=>(globalThis as any).chrome.storage.local.get(null))}
async function restore(previous:Record<string,unknown>){await worker().evaluate(async previous=>{const c=(globalThis as any).chrome;await c.storage.local.clear();await c.storage.local.set(previous)},previous)}

test('migrates explicit site choices and UI language, preserves v1 choices, and rejects invalid configuration before clearing keys',async({},info)=>{
  const previous=await snapshot(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({siteReadingPreferencesV1:{'local.example':{targetLanguage:'ja',paused:true,apiKey:'extra-field-not-for-export'}},uiLanguagePreference:'zh-CN'})});
    await options.goto(`chrome-extension://${extensionId}/options.html#support`);
    await expect(options.locator('#model')).toHaveValue('e2e-model');
    await options.locator('.support-disclosure').filter({has:options.locator('#export-settings')}).locator('summary').click();
    const downloading=options.waitForEvent('download');await options.locator('#export-settings').click();await(await downloading).saveAs(info.outputPath('configuration.json'));
    const content=await readFile(info.outputPath('configuration.json'),'utf8'),data=JSON.parse(content);
    expect(data).toMatchObject({version:2,containsApiKeys:false,readingPreferences:{sites:{'local.example':{targetLanguage:'ja',paused:true}},uiLanguage:'zh-CN'}});
    expect(content).not.toContain('extra-field-not-for-export');expect(content).not.toContain('e2e-test-key');expect(content).not.toContain('pausedSiteHosts');
    data.readingPreferences={sites:{'local.example':{targetLanguage:'en',paused:false},'new.example':{targetLanguage:'de',paused:true}},uiLanguage:'en'};
    await options.locator('#import-settings-file').setInputFiles(file(data));
    await expect(options.locator('#support-status')).toContainText('同一网站保留本机选择');
    let stored=await snapshot();expect(stored.siteReadingPreferencesV1).toEqual({'local.example':{targetLanguage:'ja',paused:true},'new.example':{targetLanguage:'de',paused:true}});expect(stored.uiLanguagePreference).toBe('en');
    data.version=1;delete data.readingPreferences;
    await options.locator('#import-settings-file').setInputFiles(file(data));await expect(options.locator('#support-status')).toContainText('配置已导入');await expect(options.locator('#import-settings')).toBeEnabled();
    stored=await snapshot();expect(stored.siteReadingPreferencesV1).toEqual({'local.example':{targetLanguage:'ja',paused:true},'new.example':{targetLanguage:'de',paused:true}});expect(stored.uiLanguagePreference).toBe('en');
    data.version=2;data.readingPreferences={sites:{'invalid.example/path':{targetLanguage:'en',paused:false}},uiLanguage:'en'};
    const before=await snapshot();
    await options.locator('#import-settings-file').setInputFiles(file(data));await expect(options.locator('#support-status')).toContainText('偏好或界面语言无效');
    expect(await snapshot()).toEqual(before);
    await options.screenshot({path:info.outputPath('configuration-migration.png')});
    await options.reload();await expect(options.locator('html')).toHaveAttribute('lang','en');
    await options.locator('.support-disclosure').filter({has:options.locator('#export-settings')}).locator('summary').click();
    await options.locator('#import-settings-file').setInputFiles(file(data));await expect(options.locator('#support-status')).toContainText('Invalid website preferences or UI language');
    await options.locator('[data-settings-target="storage"]').click();
    const beforePreview=await snapshot();await options.locator('#library-backup-input').setInputFiles(file({format:'pi-translator-document-library',version:1,documents:[]}));
    await expect(options.locator('#library-import-title')).toHaveText('Import preview');
    await expect(options.locator('#library-import-summary')).toContainText('This backup excludes original PDFs');
    await expect(options.locator('#library-import-summary')).toContainText('original PDFs');
    await expect(options.locator('#library-import-summary')).toContainText('API settings and keys');
    await options.setViewportSize({width:360,height:620});await options.screenshot({path:info.outputPath('import-preview-360-en-light.png')});
    await options.keyboard.press('Escape');await expect(options.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(beforePreview);
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await restore(previous)}
});

test('backs up and restores both retained divergent versions',async({},info)=>{
  const previous=await snapshot(),options=await context.newPage(),key='pdfFormulaRepairArchivesV1',signature=pdfDocumentTranslationSessionBlockSignature(1,'Synthetic source',0),descriptor={documentKey:pdfDocumentTranslationSessionDocumentKey('archive-paper'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto'};
  const archive={id:'archive-fixture',fingerprint:'a'.repeat(64),descriptor,behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model'),signature,createdAt:1,session:{signature,translatedText:'会话人工修正',manualCorrection:true},local:{signature,translatedText:'本机人工修正',manualCorrection:true},visible:{signature,translatedText:'原阅读译文'}};
  try{
    await worker().evaluate(async({key,archive})=>await(globalThis as any).chrome.storage.local.set({[key]:[archive]}),{key,archive});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(options.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const path=info.outputPath('archive-backup.json');await(await downloading).saveAs(path);const data=JSON.parse(await readFile(path,'utf8'));expect(data.version).toBe(10);expect(data.pdfRepairArchives).toEqual([archive]);
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.remove(key),key);await options.locator('#library-backup-input').setInputFiles(file(data));await expect(options.locator('#library-import-summary')).toContainText('分歧版本存档 1 份');await options.locator('#library-import-confirm').click();await expect(options.locator('#library-import-dialog')).not.toBeVisible();expect((await snapshot())[key]).toEqual([archive]);
  }finally{await options.close();await restore(previous)}
});

test('previews and restores project membership through the library backup',async({},info)=>{
  const previous=await snapshot(),options=await context.newPage(),key='piLibraryProjectsV1';
  try{
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.set({[key]:{projects:{p1:{name:'研究项目',updatedAt:10}},members:{doc:{projects:['p1'],updatedAt:11}}}}),key);
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(options.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();const path=info.outputPath('project-backup.json');await(await downloading).saveAs(path);const data=JSON.parse(await readFile(path,'utf8'));expect(data.version).toBe(9);expect(data.libraryProjects.members.doc.projects).toEqual(['p1']);
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.remove(key),key);await options.locator('#library-backup-input').setInputFiles(file(data));await expect(options.locator('#library-import-dialog')).toBeVisible();await expect(options.locator('#library-import-summary')).toContainText('包含项目和归属');await options.locator('#library-import-confirm').click();await expect(options.locator('#library-import-dialog')).not.toBeVisible();const after=await snapshot();expect((after[key] as any).members.doc.projects).toEqual(['p1']);
  }finally{await options.close();await restore(previous)}
});

test('blocks a backup preview that would discard revision history',async()=>{
  const previous=await snapshot(),options=await context.newPage();const signature=pdfDocumentTranslationSessionBlockSignature(1,'History overflow fixture',0);
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('history-overflow'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:10,behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model'),sourceFingerprint:'a'.repeat(64),documentSignatures:[signature],blocks:[{signature,translatedText:'当前译文',revisions:Array.from({length:50},(_,index)=>({id:`revision-local-${index}`,createdAt:index+1,reason:'correction',translatedText:`人工历史 ${index}`,manualCorrection:true}))}]};
  const incoming=structuredClone(record);incoming.updatedAt=100;incoming.blocks[0]!.revisions=[{id:'revision-backup',createdAt:99,reason:'correction',translatedText:'备份人工历史',manualCorrection:true}];
  try{
    await worker().evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),record);await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(options.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');const before=await snapshot();
    await options.locator('#library-backup-input').setInputFiles(file({format:'pi-translator-document-library',version:10,documents:[{kind:'pdf',fixed:false,record:incoming}]}));await expect(options.locator('#retained-storage-action-status')).toContainText('修订历史超过保存上限');await expect(options.locator('#library-import-dialog')).not.toBeVisible();expect(await snapshot()).toEqual(before);
  }finally{await options.close();await restore(previous)}
});

test('previews without writes, cancels safely, protects formulas and manual corrections, and blocks stale confirmation',async({},info)=>{
  const previous=await snapshot(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  const signature=pdfDocumentTranslationSessionBlockSignature(1,'Source paragraph',0);
  const formula=parseFormulaDocument({recognizedText:'Source {{m1}}',translation:'旧译文 {{m1}}',formulas:[{id:'m1',latex:'x=y',display:false}]});
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('backup-preview-paper'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:10,behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model'),sourceFingerprint:'a'.repeat(64),documentSignatures:[signature],blocks:[{signature,translatedText:formulaDocumentText(formula),formulaDocument:formula}]};
  try{
    await worker().evaluate(async record=>{const c=(globalThis as any).chrome;await c.storage.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(options.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');
    await options.locator('#library-storage-tools > summary').click();const downloading=options.waitForEvent('download');await options.locator('#export-library-backup').click();await(await downloading).saveAs(info.outputPath('old-library.json'));
    await expect(options.locator('#retained-storage-action-status')).toContainText('不含原 PDF、API 配置或 Key');
    const data=JSON.parse(await readFile(info.outputPath('old-library.json'),'utf8'));data.documents[0].record.updatedAt=100;
    const localFormula={...formula,translationTemplate:'人工校订 {{m1}}'};
    await worker().evaluate(async({signature,localFormula})=>{const c=(globalThis as any).chrome,s=await c.storage.local.get('pdfDocumentTranslationRetainedV1');s.pdfDocumentTranslationRetainedV1[0].blocks=[{signature,translatedText:'人工校订 $x=y$',formulaDocument:localFormula,manualCorrection:true}];await c.storage.local.set(s)},{signature,localFormula});
    let before=await snapshot();await options.locator('#library-backup-input').setInputFiles(file(data));
    const dialog=options.locator('#library-import-dialog');await expect(dialog).toBeVisible();await expect(options.locator('#library-import-summary')).toContainText('保留本机人工修正 1 处冲突');await expect(options.locator('#library-import-summary')).toContainText('不含原 PDF（包括本机副本）、API 配置或 Key');expect(await snapshot()).toEqual(before);
    await options.locator('#library-import-cancel').click();await expect(dialog).not.toBeVisible();expect(await snapshot()).toEqual(before);
    await options.locator('#library-backup-input').setInputFiles(file(data));await expect(dialog).toBeVisible();
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,r=(await c.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0],id=JSON.stringify(['pdf',r.documentKey,r.targetLanguage,r.sourceLanguage,r.style,r.contentMode]);await c.storage.local.set({retainedDocumentNamesV1:{[id]:'预览后新名称'}})});
    before=await snapshot();await options.locator('#library-import-confirm').click();await expect(options.locator('#library-import-status')).toContainText('文档库已变化');expect(await snapshot()).toEqual(before);
    await options.locator('#library-import-confirm').click();await expect(options.locator('#library-import-confirm')).toHaveText('确认导入');expect(await snapshot()).toEqual(before);
    await options.setViewportSize({width:360,height:620});await options.emulateMedia({colorScheme:'dark'});await options.screenshot({path:info.outputPath('import-preview-360-dark.png')});
    const layout=await dialog.evaluate(dialog=>{const r=dialog.getBoundingClientRect();return{width:innerWidth,dialog:{left:r.left,right:r.right},overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...dialog.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})}});
    expect(layout.overflow).toBe(false);expect(layout.dialog.left).toBeGreaterThanOrEqual(0);expect(layout.dialog.right).toBeLessThanOrEqual(layout.width);expect(layout.buttons).toEqual([true,true]);
    await options.locator('#library-import-confirm').click();await expect(dialog).not.toBeVisible();await expect(options.locator('#retained-storage-action-status')).toContainText('已恢复');
    await expect(options.locator('#retained-storage-action-status')).toContainText('本机已有副本与配置不变');
    const stored=await snapshot(),saved=(stored.pdfDocumentTranslationRetainedV1 as any[])[0].blocks[0];
    expect(saved).toMatchObject({translatedText:'人工校订 {{m1}}',manualCorrection:true});expect(formulaDocumentText(saved.formulaDocument)).toBe('人工校订 $x=y$');expect(saved.formulaDocument.formulas).toEqual(formula.formulas);expect(saved.revisions.some((revision:any)=>revision.translatedText.includes('旧译文'))).toBe(true);
    const invalid=structuredClone(data);invalid.documents[0].record.blocks[0].formulaDocument={broken:true};before=await snapshot();
    await options.locator('#library-backup-input').setInputFiles(file(invalid));await expect(options.locator('#retained-storage-action-status')).toContainText('公式结构无效');await expect(dialog).not.toBeVisible();expect(await snapshot()).toEqual(before);
    expect(textRequests.length+visionRequests.length).toBe(calls);
    await info.attach('verification',{body:JSON.stringify({layout,manualCorrectionPreserved:true,formulaRegistryPreserved:true,noWriteBeforeConfirmation:true,stalePreviewBlocked:true,newModelRequests:0}),contentType:'application/json'});
  }finally{await options.close();await restore(previous)}
});


for(const language of ['zh-CN','en'] as const)test(`reports successful restore and a failed library refresh separately (${language})`,async()=>{
  const previous=await snapshot(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async language=>await (globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await expect(options.locator('#retained-pdf-storage-status')).not.toContainText(language==='en'?'Loading':'正在读取');
    await options.locator('#library-backup-input').setInputFiles(file({format:'pi-translator-document-library',version:1,documents:[]}));
    await expect(options.locator('#library-import-dialog')).toBeVisible();
    await options.evaluate(()=>{
      const storage=(globalThis as any).chrome.storage.local, get=storage.get.bind(storage), set=storage.set.bind(storage);
      (globalThis as any).restoreStorageHooks=()=>{storage.get=get;storage.set=set};
      let committed=false;
      storage.set=async(value:Record<string,unknown>)=>{await set(value);if('pdfDocumentTranslationRetainedV1' in value){committed=true;(globalThis as any).restoreCommitted=true}};
      storage.get=async(...args:any[])=>{if(committed)throw new Error('Injected refresh read failure');return get(...args)};
    });
    await options.locator('#library-import-confirm').click();
    await expect.poll(()=>options.evaluate(()=>(globalThis as any).restoreCommitted)).toBe(true);
    await expect(options.locator('#library-import-dialog')).not.toBeVisible();
    await expect(options.locator('#retained-pdf-storage-status')).toHaveText(language==='en'?'Read failed':'读取失败');
    await expect(options.locator('#retained-storage-action-status')).toContainText(language==='en'?'Backup merged':'备份已合并');
    await expect(options.locator('#retained-storage-action-status')).toContainText(language==='en'?'list could not be fully refreshed':'列表未能完整刷新');
    await options.evaluate(()=>(globalThis as any).restoreStorageHooks());
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await restore(previous)}
});


test('blocks restore after another window changes saved data and preserves its unsaved draft',async()=>{
  const previous=await snapshot(),first=await context.newPage(),second=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await first.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await second.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(first.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');
    await first.locator('#library-backup-input').setInputFiles(file({format:'pi-translator-document-library',version:1,documents:[]}));
    await expect(first.locator('#library-import-dialog')).toBeVisible();
    await second.evaluate(async()=>{const field=document.querySelector<HTMLTextAreaElement>('#academic-glossary')!;field.value='unsaved draft = 人工草稿';field.dispatchEvent(new Event('input',{bubbles:true}));await (globalThis as any).chrome.storage.local.set({retainedDocumentNamesV1:{external:'另一个窗口保存的名称'}})});
    const before=await snapshot();
    await first.locator('#library-import-confirm').click();
    await expect(first.locator('#library-import-status')).toContainText('文档库已变化');
    expect(await snapshot()).toEqual(before);
    await expect(second.locator('#academic-glossary')).toHaveValue('unsaved draft = 人工草稿');
    await first.locator('#library-import-cancel').click();
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await first.close();await second.close();await restore(previous)}
});


test('successful restore keeps an unsaved settings draft in another window',async()=>{
  const previous=await snapshot(),first=await context.newPage(),second=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await first.goto(`chrome-extension://${extensionId}/options.html#storage`);await second.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(first.locator('#retained-pdf-storage-status')).not.toContainText('正在读取');
    await second.evaluate(()=>{const field=document.querySelector<HTMLTextAreaElement>('#academic-glossary')!;field.value='preserve = 人工未保存';field.dispatchEvent(new Event('input',{bubbles:true}))});
    await first.locator('#library-backup-input').setInputFiles(file({format:'pi-translator-document-library',version:1,documents:[]}));await expect(first.locator('#library-import-dialog')).toBeVisible();
    await first.locator('#library-import-confirm').click();await expect(first.locator('#library-import-dialog')).not.toBeVisible();
    await expect(first.locator('#retained-storage-action-status')).toContainText('备份已合并');
    await expect(second.locator('#academic-glossary')).toHaveValue('preserve = 人工未保存');
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await first.close();await second.close();await restore(previous)}
});
