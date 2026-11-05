import {delayStorageWrite,releaseStorageWrite} from './support/storage-delay';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
import {parseFormulaDocument} from '../../core/translation/formula-document';
import {openPdfTranslationOptions} from './support/pdf-controls';
installEdgeExtensionHooks();
const pdf=createTwoPageTextPdf('First page describes a local search workflow.','The quantum result matches the saved source passage.');
const fingerprint=createHash('sha256').update(pdf).digest('hex');
const pdfId=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
const webpage='https://www.overleaf.com/pi-library-source';
const webId=createHash('sha256').update(webpage).digest('hex').slice(0,32);
const quote='The quantum source passage belongs to this webpage.';
const sig=pdfDocumentTranslationSessionBlockSignature(2,'Saved source paragraph',0);
const seed={
  pdfDocumentTranslationRetainedV1:[{documentKey:pdfDocumentTranslationSessionDocumentKey('library-search'),sourceFingerprint:fingerprint,targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:1,documentSignatures:[sig],scopeSignatures:[sig],blocks:[{signature:sig,pageNumber:2,translatedText:'quantum 人工修正 {{m1}}。',manualCorrection:true,formulaDocument:parseFormulaDocument({recognizedText:'Source {{m1}}.',translation:'quantum 人工修正 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]}),revisions:[{id:'revision-old',createdAt:1,reason:'correction',translatedText:'旧译文'}]}],activity:'complete',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model')}],
  piPdfReadingAnnotationsV1:{[pdfId]:{annotations:[{id:'saved-note',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'quantum',prefix:'The ',suffix:' result matches the saved source passage.'},sourceTitle:'Local quantum paper',note:'quantum 本机人工笔记',createdAt:1,updatedAt:2}],updatedAt:2}},
  piWebExcerptsV1:{[webId]:[{markerId:'saved-web',pageUrl:webpage,anchor:{sourceText:quote,prefix:'Before',suffix:'after.'},content:{sourceTitle:'Web quantum paper',originalText:quote,translatedText:'quantum 网页译文',sourceUrl:'https://example.org/edited-citation',note:'quantum 网页笔记'},createdAt:1,updatedAt:2}]},
  documentTranslationMemoryV1:{'doc-terms':{schemaVersion:1,documentId:'doc-terms',label:'Term paper',updatedAt:3,confirmedTerms:[{id:'term-source',source:'quantum',target:'量子',createdAt:1,updatedAt:3,provenance:{origin:{documentId:'doc-terms',title:'Original term paper',sourceUrl:webpage},confirmed:{documentId:'doc-terms',title:'Confirmed term paper',targetLanguage:'zh-CN',at:3}}},{id:'old-term',source:'legacy',target:'旧词条',createdAt:1,updatedAt:2}],candidateTerms:[{id:'candidate',source:'quantum hidden candidate',target:'不可列出',createdAt:1}],recentTranslations:[],dismissedTermKeys:[]}},
};
const keys=Object.keys(seed);
const worker=()=>context.serviceWorkers()[0]!;
async function setup(){
  const isolatedKeys=[...keys,'piRecentPdfDocumentsV1','piPdfReadingStatesV1'];
  const before=await worker().evaluate(async keys=>await(globalThis as any).chrome.storage.local.get(keys),isolatedKeys);
  await worker().evaluate(async keys=>await(globalThis as any).chrome.storage.local.remove(keys),isolatedKeys);
  await worker().evaluate(async seed=>await(globalThis as any).chrome.storage.local.set(seed),seed);
  return async()=>worker().evaluate(async({before,keys})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set(before)},{before,keys:isolatedKeys});
}
async function stored(){return worker().evaluate(async keys=>await(globalThis as any).chrome.storage.local.get(keys),keys)}

const organizationKey='piLibraryOrganizationV1',webNoteId=JSON.stringify(['web',webpage,'saved-web']),pdfNoteId=JSON.stringify(['pdf-note',pdfId,'saved-note']);
const organizationSeed={tags:{[webNoteId]:{tags:['课题 A'],updatedAt:2},[pdfNoteId]:{tags:['课题 B'],updatedAt:2}},views:{topic:{name:'课题 A 笔记',query:'quantum',kind:'excerpt',tag:'课题 A',updatedAt:2},missing:{name:'已移除标签的笔记',query:'quantum',kind:'excerpt',tag:'已移除标签',updatedAt:2}}};
const storedOrganization=()=>worker().evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key))[key],organizationKey);
test('organizes materials into a project without deleting existing records',async({},info)=>{
  const restore=await setup(),options=await context.newPage(),key='piLibraryProjectsV1',previous=await worker().evaluate(async keys=>await(globalThis as any).chrome.storage.local.get(keys),[key,organizationKey]);const calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.remove(key),key);await options.setViewportSize({width:1100,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const original=await stored();await options.locator('#library-project-create').click();let dialog=options.getByRole('dialog',{name:'项目名称'});await dialog.getByRole('textbox').fill('实验课题');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);const filter=options.locator('#library-project-filter');await expect(filter).toHaveValue(/.+/u);
    await filter.selectOption('');await options.locator('.library-source-result').filter({hasText:'Web quantum paper'}).locator('.library-select').click();await options.locator('#library-detail').getByRole('button',{name:'加入 实验课题',exact:true}).click();await expect.poll(async()=>worker().evaluate(async({key,id})=>(await(globalThis as any).chrome.storage.local.get(key))[key]?.members?.[id]?.projects?.length??0,{key,id:webNoteId})).toBe(1);
    const row=options.locator('.library-entry:not(.library-source-result)').first();await row.locator('.library-select').click();await options.locator('#library-detail').getByRole('button',{name:'加入项目…'}).click();dialog=options.getByRole('dialog',{name:'选择项目'});await dialog.getByRole('checkbox',{name:'实验课题'}).check();await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await filter.selectOption({label:'实验课题'});await expect(options.locator('.library-entry:not(.library-source-result)')).toHaveCount(1);await expect(options.locator('.library-entry:not(.library-source-result) .library-access')).toContainText('1 条批注');await expect(options.locator('.library-source-result')).toHaveCount(2);await options.setViewportSize({width:360,height:850});await options.emulateMedia({colorScheme:'dark'});expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath('project-library-360.png')});await options.setViewportSize({width:1100,height:850});
    await options.locator('.library-source-result').filter({hasText:'Local quantum paper'}).locator('.library-select').click();await expect(options.locator('#library-detail')).toContainText('随文档显示');await options.locator('#library-detail').getByRole('button',{name:'加入项目…'}).click();dialog=options.getByRole('dialog',{name:'选择项目'});await expect(dialog.getByRole('checkbox',{name:'实验课题 · 随文档显示'})).toBeDisabled();await dialog.getByRole('button',{name:'取消'}).click();
    expect(await stored()).toEqual(original);await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'保存当前筛选…'}).click();dialog=options.getByRole('dialog',{name:'筛选名称'});await dialog.getByRole('textbox').fill('实验课题资料');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await filter.selectOption('');await options.locator('#library-saved-view').selectOption({label:'实验课题资料'});await expect(filter).toHaveValue(/.+/u);
    await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'移除当前项目…'}).click();dialog=options.getByRole('dialog',{name:'输入项目名称以移除，资料不会删除'});await dialog.getByRole('textbox').fill('实验课题');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(filter).toBeHidden();await options.locator('#library-saved-view').selectOption({label:'实验课题资料'});await expect(filter).toBeVisible();await expect(filter.locator('option:checked')).toHaveText('已移除项目');await expect(options.locator('.library-entry')).toHaveCount(0);expect(await stored()).toEqual(original);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await worker().evaluate(async({keys,previous})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set(previous)},{keys:[key,organizationKey],previous});await restore()}
});
test('adds a newly retained PDF to the project it was opened from',async()=>{
  const restore=await setup(),options=await context.newPage(),key='piLibraryProjectsV1',previous=await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key);let reader:import('@playwright/test').Page|undefined;
  try{
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.set({[key]:{projects:{'project-one':{name:'实验课题',updatedAt:1}},members:{}}}),key);
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const filter=options.locator('#library-project-filter');await expect(filter).toBeVisible();await filter.selectOption('project-one');const opened=context.waitForEvent('page');await options.getByRole('button',{name:'在项目中打开 PDF'}).click();reader=await opened;await reader.waitForURL(/project=project-one/u);await reader.locator('#file-input').setInputFiles({name:'project-paper.pdf',mimeType:'application/pdf',buffer:pdf});await reader.locator('#translate-document').click();await openPdfTranslationOptions(reader);await reader.locator('#pdf-document-translation-retention-toggle').check();await expect(reader.locator('#pdf-document-translation-retention-status')).toContainText('已加入项目 实验课题');
    const stored=await worker().evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key))[key],key);expect(Object.values(stored.members).some((item:any)=>item.projects.includes('project-one'))).toBe(true);
  }finally{await reader?.close();await options.close();await worker().evaluate(async({key,previous})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(key);await s.set(previous)},{key,previous});await restore()}
});
async function setupOrganization(){
  const restore=await setup(),before=await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),organizationKey);
  await worker().evaluate(async({key,value})=>await(globalThis as any).chrome.storage.local.set({[key]:value}),{key:organizationKey,value:organizationSeed});
  return async()=>{await worker().evaluate(async({key,before})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(key);await s.set(before)},{key:organizationKey,before});await restore()};
}

for(const width of [1100,360])test(`keeps saved filter selection truthful while changing search and source type at ${width}px`,async({},info)=>{
  const restore=await setupOrganization(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    const before=await stored();await options.setViewportSize({width,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const views=options.locator('#library-saved-view'),search=options.locator('#retained-library-search'),kind=options.locator('#retained-library-filter');await expect(views).toContainText('课题 A 笔记');await views.selectOption('topic');await expect(options.locator('.library-source-result')).toHaveCount(1);
    await search.fill('网页笔记');await expect(views).toHaveValue('');await expect(options.locator('#library-tag-filter')).toHaveValue('课题 A');
    await views.selectOption('topic');await kind.selectOption('web');await expect(views).toHaveValue('');await expect(search).toHaveValue('quantum');
    await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'保存当前筛选…',exact:true}).click();const dialog=options.getByRole('dialog',{name:'筛选名称',exact:true});await dialog.getByRole('textbox').fill('当前网页课题');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(views.locator('option:checked')).toHaveText('当前网页课题');await expect(views).toBeFocused();
    const saved=await storedOrganization(),savedId=await views.inputValue();expect(saved.tags).toEqual(organizationSeed.tags);expect(saved.views.topic).toEqual(organizationSeed.views.topic);expect(saved.views.missing).toEqual(organizationSeed.views.missing);expect(saved.views[savedId]).toMatchObject({name:'当前网页课题',query:'quantum',kind:'web',tag:'课题 A'});
    await expect(options.locator('#library-clear-filters')).toBeVisible();await options.locator('#library-clear-filters').click();await expect(search).toHaveValue('');await expect(kind).toHaveValue('all');await expect(options.locator('#library-tag-filter')).toHaveValue('');await expect(views).toHaveValue('');await expect(search).toBeFocused();await expect(options.locator('#library-clear-filters')).toBeHidden();
    expect(await storedOrganization()).toEqual(saved);expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath(`saved-filter-clear-${width}.png`)});
  }finally{await options.close();await restore()}
});

for(const width of [1100,360])test(`does not broaden a saved filter when its tag has disappeared at ${width}px`,async({},info)=>{
  const restore=await setupOrganization(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    const before=await stored();await options.setViewportSize({width,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const view=options.locator('#library-saved-view');await expect(view).toContainText('已移除标签的笔记');await view.selectOption('missing');
    await expect(options.locator('#library-tag-filter')).toHaveValue('已移除标签');await expect(options.locator('#library-tag-filter')).toBeVisible();await expect(options.locator('.library-entry')).toHaveCount(0);await expect(options.locator('.library-empty')).toContainText('没有匹配');await options.screenshot({path:info.outputPath(`missing-tag-${width}.png`)});
    await options.locator('.library-empty').getByRole('button',{name:'清除筛选',exact:true}).click();await expect(options.locator('.library-entry')).toHaveCount(3);expect(await storedOrganization()).toEqual(organizationSeed);expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await restore()}
});

test('offers saved-filter deletion only for the actual selected view and preserves concurrent edits',async()=>{
  const restore=await setupOrganization(),options=await context.newPage();
  try{
    const before=await stored();await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const view=options.locator('#library-saved-view'),menu=options.locator('#library-storage-tools'),remove=menu.getByRole('button',{name:'删除当前保存筛选…',exact:true});await expect(view).toContainText('课题 A 笔记');await menu.locator(':scope > summary').click();await expect(remove).toBeHidden();await menu.locator(':scope > summary').click();await view.selectOption('topic');await menu.locator(':scope > summary').click();await expect(remove).toBeVisible();await remove.click();const dialog=options.getByRole('dialog',{name:'输入筛选名称以确认删除',exact:true});await dialog.getByRole('textbox').fill('课题 A 笔记');
    await worker().evaluate(async key=>{const s=(globalThis as any).chrome.storage.local,value=(await s.get(key))[key];value.views.topic={...value.views.topic,name:'另一窗口的课题',updatedAt:9};await s.set({[key]:value})},organizationKey);
    await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('其他窗口');await expect(dialog.getByRole('textbox')).toHaveValue('课题 A 笔记');await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await view.selectOption('topic');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();await remove.click();await dialog.getByRole('textbox').fill('另一窗口的课题');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(view).toHaveValue('');await expect(view).not.toContainText('另一窗口的课题');await expect(options.locator('#library-tag-filter')).toHaveValue('课题 A');expect(await stored()).toEqual(before);
    const saved=await storedOrganization();expect(saved.tags).toEqual(organizationSeed.tags);expect(saved.views.missing).toEqual(organizationSeed.views.missing);expect(saved.views.topic).toMatchObject({name:'另一窗口的课题',query:'quantum',kind:'excerpt',tag:'课题 A',deleted:true});expect(saved.views.topic.updatedAt).toBeGreaterThan(9);
  }finally{await options.close();await restore()}
});

test('returns tag editing to the same detail and keeps an active tag restrictive after it is removed',async()=>{
  const restore=await setupOrganization(),options=await context.newPage();
  try{
    const before=await stored();await options.setViewportSize({width:360,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('网页笔记');await options.locator('.library-source-result .library-select').click();const edit=options.locator('#library-detail .library-tag-edit');await edit.click();const dialog=options.getByRole('dialog',{name:'主题标签（逗号分隔，最多 12 个）',exact:true});await dialog.getByRole('textbox').fill('课题 A, 精读');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(edit).toBeFocused();await expect(options.locator('#retained-library-search')).toHaveValue('网页笔记');
    await options.locator('.library-detail-back').click();await options.locator('#library-tag-filter').selectOption('精读');await options.locator('.library-source-result .library-select').click();await edit.click();await dialog.getByRole('textbox').fill('课题 A');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(options.locator('.library-source-result')).toHaveCount(0);await expect(options.locator('#library-tag-filter')).toHaveValue('精读');await expect(options.locator('#retained-library-search')).toBeFocused();expect(await stored()).toEqual(before);
  }finally{await options.close();await restore()}
});

test('keeps current conditions when another window changes a saved view and hides empty controls after clearing',async()=>{
  const restore=await setupOrganization(),options=await context.newPage();
  try{
    const before=await stored();await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const view=options.locator('#library-saved-view'),tag=options.locator('#library-tag-filter'),search=options.locator('#retained-library-search');await expect(view).toContainText('课题 A 笔记');await view.selectOption('topic');
    await worker().evaluate(async key=>{const s=(globalThis as any).chrome.storage.local,value=(await s.get(key))[key];value.views.topic={...value.views.topic,query:'different query',updatedAt:9};await s.set({[key]:value})},organizationKey);
    await expect(view).toHaveValue('');await expect(search).toHaveValue('quantum');await expect(tag).toHaveValue('课题 A');await expect(options.locator('.library-source-result')).toHaveCount(1);
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.set({[key]:{tags:{},views:{}}}),organizationKey);await expect(view).toBeHidden();await expect(tag).toHaveValue('课题 A');await expect(tag).toBeVisible();await expect(options.locator('.library-entry')).toHaveCount(0);
    await options.locator('.library-empty').getByRole('button',{name:'清除筛选',exact:true}).click();await expect(tag).toBeHidden();await expect(view).toBeHidden();await expect(search).toHaveValue('');expect(await stored()).toEqual(before);
  }finally{await options.close();await restore()}
});

test('keeps tag and saved-filter controls compact and keyboard accessible in English at 360px',async({},info)=>{
  const restore=await setupOrganization(),options=await context.newPage(),preference=await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get('uiLanguagePreference'));
  try{
    const before=await stored();await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en',[key]:{tags:{},views:{}}}),organizationKey);await options.setViewportSize({width:360,height:850});await options.emulateMedia({colorScheme:'dark'});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await expect(options.locator('#library-tag-filter')).toBeHidden();await expect(options.locator('#library-saved-view')).toBeHidden();await expect(options.locator('#library-clear-filters')).toBeHidden();
    await options.locator('#retained-library-search').fill('网页笔记');await options.locator('.library-source-result .library-select').click();await options.getByRole('button',{name:'Edit topic tags…',exact:true}).click();let dialog=options.getByRole('dialog',{name:'Topic tags (comma-separated, up to 12)',exact:true});await dialog.getByRole('textbox').fill('课题 α');await dialog.getByRole('textbox').press('Enter');await expect(dialog).toHaveCount(0);await expect(options.locator('#library-detail .library-tag-edit')).toBeFocused();
    await options.locator('.library-detail-back').click();await options.locator('#library-tag-filter').selectOption('课题 α');await options.locator('#library-storage-tools > summary').click();await options.getByRole('button',{name:'Save current filter…',exact:true}).click();dialog=options.getByRole('dialog',{name:'Filter name',exact:true});await dialog.getByRole('textbox').fill('Detailed reading with an explicit long filter name');await dialog.getByRole('textbox').press('Enter');await expect(dialog).toHaveCount(0);await expect(options.locator('#library-saved-view')).toBeFocused();await expect(options.locator('#library-saved-view option:checked')).toHaveText('Detailed reading with an explicit long filter name');await expect(options.locator('#library-clear-filters')).toHaveText('Clear filters');
    expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath('filters-360-en-dark.png')});expect(await stored()).toEqual(before);
  }finally{await options.close();await worker().evaluate(async before=>{const s=(globalThis as any).chrome.storage.local;await s.remove('uiLanguagePreference');await s.set(before)},preference);await restore()}
});

test('shows saved notes without a query or retained document and reuses the existing note editor',async({},info)=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.remove(['pdfDocumentTranslationRetainedV1','piPdfReadingAnnotationsV1','documentTranslationMemoryV1']));
    const before=await stored();await page.setViewportSize({width:1100,height:850});await page.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await expect(page.locator('#retained-library-count')).toHaveText('1');await expect(page.locator('.library-empty')).toHaveCount(0);
    const list=page.locator('#retained-document-library'),detail=page.locator('#library-detail');
    await expect(list).toContainText('quantum 网页笔记');await expect(detail.locator('.library-personal-note')).toHaveText('quantum 网页笔记');
    const columns=await page.evaluate(()=>{const list=document.getElementById('retained-document-library')!.getBoundingClientRect(),detail=document.getElementById('library-detail')!.getBoundingClientRect();return{listRight:list.right,detailLeft:detail.left,listTop:list.top,detailTop:detail.top}});
    expect(columns.detailLeft).toBeGreaterThan(columns.listRight);expect(Math.abs(columns.listTop-columns.detailTop)).toBeLessThanOrEqual(1);
    await expect(detail.locator('.library-source-open')).toHaveAttribute('href',/pi-library-source#pi-excerpt=/);
    await page.screenshot({path:info.outputPath('notes-only-desktop.png')});
    await detail.getByRole('button',{name:'编辑笔记与出处'}).click();
    const editor=page.locator('#web-excerpts-list .saved-web-excerpt-editor');await expect(editor).toBeVisible();
    const note=editor.getByRole('textbox',{name:'个人笔记'});await expect(note).toHaveValue('quantum 网页笔记');await expect(note).toBeFocused();
    await note.fill('未保存草稿：保留旧笔记');await editor.getByRole('button',{name:'取消',exact:true}).click();
    expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await page.close();await restore()}
});

test('uses one pane on narrow screens and preserves the selected source, formula and all saved records',async({},info)=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    const before=await stored();await page.setViewportSize({width:360,height:800});await page.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const list=page.locator('#retained-document-library'),detail=page.locator('#library-detail');
    await expect(list.locator('.library-entry')).toHaveCount(3);await expect(list).toBeVisible();await expect(detail).toBeHidden();
    const select=list.locator('[data-source-kind="excerpt"]').filter({hasText:'Web quantum paper'}).locator('.library-select');
    await select.focus();await page.keyboard.press('Enter');await expect(list).toBeHidden();await expect(detail).toBeVisible();await expect(detail.locator('h3')).toBeFocused();
    await expect(detail.locator('.library-personal-note')).toHaveText('quantum 网页笔记');
    await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:info.outputPath('note-detail-dark-360.png')});
    await page.locator('.library-detail-back').click();await expect(select).toBeFocused();await expect(list).toBeVisible();
    await page.screenshot({path:info.outputPath('note-list-dark-360.png')});
    const document=list.locator('[data-library-id]').filter({has:page.locator('.library-open[href*="library="]')});
    await document.locator('.library-select').click();await expect(detail.locator('.katex')).not.toHaveCount(0);await expect(detail).toContainText('quantum 人工修正');
    await page.setViewportSize({width:1100,height:850});await expect(list).toBeVisible();await expect(detail).toContainText('quantum 人工修正');
    await page.locator('#retained-library-search').fill('no such material');await expect(list.locator('.library-entry')).toHaveCount(0);await expect(detail).toBeHidden();
    await page.getByRole('button',{name:'清除搜索',exact:true}).click();await expect(list.locator('.library-entry')).toHaveCount(3);
    expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await page.close();await restore()}
});

for(const width of [1100,360])test(`returns from note editing to its library detail at ${width}px without losing search or saved work`,async({},info)=>{
  const restore=await setup(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    const before=await stored();await options.setViewportSize({width,height:800});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const search=options.locator('#retained-library-search'),filter=options.locator('#retained-library-filter');
    await search.fill('quantum');await filter.selectOption('excerpt');
    await options.locator('[data-source-kind="excerpt"]').filter({hasText:'Web quantum paper'}).locator('.library-select').click();
    const detail=options.locator('#library-detail'),edit=detail.getByRole('button',{name:'编辑笔记与出处'}),editor=options.locator('#web-excerpts-list .saved-web-excerpt-editor'),legacy=options.locator('#web-excerpts-library');
    await expect(legacy).not.toHaveAttribute('open','');await edit.click();await expect(editor.getByRole('textbox',{name:'个人笔记'})).toBeFocused();
    await editor.getByRole('textbox',{name:'个人笔记'}).fill('取消草稿，不改旧笔记');await editor.getByRole('button',{name:'取消',exact:true}).click();
    await expect(edit).toBeFocused();await expect(edit).toBeInViewport();await expect(legacy).not.toHaveAttribute('open','');
    await expect(search).toHaveValue('quantum');await expect(filter).toHaveValue('excerpt');expect(await stored()).toEqual(before);
    await options.screenshot({path:info.outputPath(`cancel-return-${width}.png`)});
    await edit.click();await editor.getByRole('textbox',{name:'个人笔记'}).fill('quantum 更新笔记：保留来源与译文');await editor.getByRole('button',{name:'保存',exact:true}).click();
    await expect(edit).toBeFocused();await expect(edit).toBeInViewport();await expect(legacy).not.toHaveAttribute('open','');await expect(detail.locator('.library-personal-note')).toHaveText('quantum 更新笔记：保留来源与译文');
    const after=await stored(),record=Object.values(after.piWebExcerptsV1 as Record<string,any[]>).flat()[0]!;
    expect(record).toEqual({...Object.values(before.piWebExcerptsV1 as Record<string,any[]>).flat()[0],content:{...seed.piWebExcerptsV1[webId]![0]!.content,note:'quantum 更新笔记：保留来源与译文'},updatedAt:record.updatedAt});
    for(const key of keys.filter(key=>key!=='piWebExcerptsV1'))expect(after[key]).toEqual(before[key]);
    await expect(search).toHaveValue('quantum');await expect(filter).toHaveValue('excerpt');await options.screenshot({path:info.outputPath(`save-return-${width}.png`)});
    // Saving a note that no longer matches must return to the unchanged search, not another detail.
    if(width===360)await options.locator('.library-detail-back').click();await search.fill('更新笔记');
    await options.locator('[data-source-kind="excerpt"] .library-select').click();await edit.click();await editor.getByRole('textbox',{name:'个人笔记'}).fill('改后的笔记保留原有译文和出处');await editor.getByRole('button',{name:'保存',exact:true}).click();
    await expect(search).toBeFocused();await expect(search).toBeInViewport();await expect(search).toHaveValue('更新笔记');await expect(options.locator('.library-source-result')).toHaveCount(0);await expect(legacy).not.toHaveAttribute('open','');
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await restore()}
});

test('keeps a conflicting library edit open and restores an already open excerpt panel only after cancel',async()=>{
  const restore=await setup(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await options.setViewportSize({width:360,height:800});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    const legacy=options.locator('#web-excerpts-library'),legacySearch=options.locator('#web-excerpts-search'),legacyFilter=options.locator('#research-excerpts-kind');
    await legacy.locator(':scope > summary').click();await legacySearch.fill('quantum 网页笔记');await legacyFilter.selectOption('web');
    await options.locator('#retained-library-search').fill('quantum');await options.locator('[data-source-kind="excerpt"]').filter({hasText:'Web quantum paper'}).locator('.library-select').click();
    const edit=options.locator('#library-detail .library-detail-edit'),editor=options.locator('.saved-web-excerpt-editor');await edit.click();
    await editor.getByRole('textbox',{name:'个人笔记'}).fill('未保存草稿应继续留在编辑框');
    await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=await c.storage.local.get('piWebExcerptsV1'),item=Object.values(s.piWebExcerptsV1).flat()[0] as any;item.content.note='quantum 另一窗口的新笔记';item.updatedAt=50;await c.storage.local.set(s)});
    const concurrent=await stored();await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor.locator('.saved-web-excerpt-editor-error')).toBeVisible();
    await expect(editor.getByRole('textbox',{name:'个人笔记'})).toHaveValue('未保存草稿应继续留在编辑框');await expect(legacy).toHaveAttribute('open','');expect(await stored()).toEqual(concurrent);
    await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(edit).toBeFocused();await expect(edit).toBeInViewport();await expect(options.locator('#library-detail .library-personal-note')).toHaveText('quantum 另一窗口的新笔记');
    await expect(legacy).toHaveAttribute('open','');await expect(legacySearch).toHaveValue('quantum 网页笔记');await expect(legacyFilter).toHaveValue('web');expect(await stored()).toEqual(concurrent);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await restore()}
});

test('searches all saved types, opens full details and locates the retained translation without changing records',async({},info)=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;let reader:import('@playwright/test').Page|undefined;
  try{
    const before=await stored();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await expect(page.locator('#retained-document-library .library-entry')).toHaveCount(3);
    await page.locator('#retained-library-search').fill('quantum');
    await expect(page.locator('#retained-document-library .library-entry')).toHaveCount(4);
    await expect(page.locator('#retained-library-count')).toHaveText('4');
    await expect(page.locator('#retained-library-count')).toHaveAttribute('aria-label','4 项结果');
    await expect(page.locator('#retained-document-library')).not.toContainText('hidden candidate');
    const note=page.locator('[data-source-kind="excerpt"]').filter({hasText:'Local quantum paper'});
    await note.locator('.library-select').click();await expect(note).toContainText('quantum 本机人工笔记');await expect(note).toContainText('第 2 页');
    const term=page.locator('[data-source-kind="term"]');await term.locator('.library-select').press('Enter');await expect(page.locator('#library-detail')).toContainText('Original term paper');await expect(page.locator('#library-detail')).toContainText('Confirmed term paper');
    for(const [value,count] of [['pdf',2],['web',1],['excerpt',2],['term',1],['review',0]] as const){await page.locator('#retained-library-filter').selectOption(value);await expect(page.locator('#retained-document-library .library-entry')).toHaveCount(count)}
    await expect(page.locator('#retained-library-filter')).toHaveValue('review');
    await page.locator('#retained-library-filter').selectOption('term');
    await expect(page.locator('#retained-library-filter')).toHaveValue('term');
    await page.locator('#retained-library-search').fill('legacy');await expect(page.locator('[data-source-kind="term"]')).toHaveCount(1);await page.locator('[data-source-kind="term"] .library-select').click();await expect(page.locator('#library-detail')).toContainText('未记录来源');await expect(page.locator('#library-detail a')).toHaveCount(0);
    await page.locator('#retained-library-search').fill('quantum');await page.locator('#retained-library-filter').selectOption('all');
    const popup=page.waitForEvent('popup');await page.locator('.library-open').click();reader=await popup;
    await expect(reader.locator('#pdf-document-translation-pages')).toContainText('quantum 人工修正');await expect(reader.locator('#pdf-document-translation-pages .katex')).not.toHaveCount(0);
    expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
    await page.screenshot({path:info.outputPath('search-light.png')});
    await page.setViewportSize({width:360,height:900});await page.emulateMedia({colorScheme:'dark'});
    if(await page.locator('#library-detail').isVisible())await page.locator('.library-detail-back').click();
    await page.locator('[data-source-kind="term"] .library-select').click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath('search-dark-360.png')});
    await writeFile(info.outputPath('preserved-records.json'),JSON.stringify({unchanged:true,realModelCalls:0,formula:'x=y',manualCorrection:true,oldRevision:true}));
  }finally{await reader?.close();await page.close();await restore()}
});

test('verifies the original PDF before locating a saved note and keeps stale or mismatched sources intact',async({},info)=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;let reader:import('@playwright/test').Page|undefined;
  try{
    const before=await stored();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await page.locator('#retained-library-search').fill('本机人工笔记');
    const row=page.locator('[data-source-kind="excerpt"]');await row.locator('.library-select').click();
    const popup=page.waitForEvent('popup');await page.locator('#library-detail .library-source-open').click();reader=await popup;
    await expect(reader.locator('.pdf-excerpt-source-preview')).toContainText('本机人工笔记');
    await reader.locator('#file-input').setInputFiles({name:'wrong.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('An unrelated document.','Different second page.')});
    await expect(reader.locator('#notice')).toContainText('文件身份不符');await expect(reader.locator('[data-library-source]')).toHaveCount(0);expect(await stored()).toEqual(before);
    await reader.locator('#file-input').setInputFiles({name:'renamed-original.pdf',mimeType:'application/pdf',buffer:pdf});
    await expect(reader.locator('[data-library-source="saved-note"]').first()).toBeInViewport();await expect(reader.locator('#page-number')).toHaveValue('2');await expect(reader.locator('#notice')).toContainText('已定位原文');
    const geometry=await reader.locator('[data-library-source="saved-note"]').first().evaluate(el=>({page:el.closest('.pdf-page')!.getAttribute('data-page-number'),...el.getBoundingClientRect().toJSON()}));
    await writeFile(info.outputPath('source-location.json'),JSON.stringify(geometry,null,2));await reader.screenshot({path:info.outputPath('pdf-source-located.png')});
    expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
    await reader.close();reader=undefined;
    const staleId=JSON.stringify(['pdf-note',pdfId,'saved-note']);
    await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.remove(key),'piPdfReadingAnnotationsV1');
    reader=await context.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(staleId)}`);await expect(reader.locator('#notice')).toContainText('已移除');await expect(reader.locator('[data-library-source]')).toHaveCount(0);
  }finally{await reader?.close();await page.close();await restore()}
});

test('opens the captured webpage at its quoted passage and refreshes search when another window changes a note',async({},info)=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;let source:import('@playwright/test').Page|undefined;
  await context.route(webpage,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Captured source</title></head><body><div style="height:3000px">Fixed source fixture</div><p id="quote">Before ${quote} after.</p><div style="height:2000px"></div></body></html>`}));
  try{
    const before=await stored();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await page.locator('#retained-library-search').fill('网页笔记');
    const row=page.locator('[data-source-kind="excerpt"]');await row.locator('.library-select').click();await expect(page.locator('#library-detail .library-source-open')).toHaveAttribute('href',/pi-library-source#pi-excerpt=[^:]+:~:text=/);
    const popup=page.waitForEvent('popup');await page.locator('#library-detail .library-source-open').click();source=await popup;
    await expect(source.locator('#quote')).toBeInViewport();expect(await source.evaluate(()=>scrollY)).toBeGreaterThan(2000);
    await source.screenshot({path:info.outputPath('web-source-located.png')});expect(await stored()).toEqual(before);
    await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local;const all=(await s.get('piWebExcerptsV1')).piWebExcerptsV1;Object.values(all).forEach((items:any)=>{items[0].content.note='changed note in another window';items[0].updatedAt=4});await s.set({piWebExcerptsV1:all})});
    await expect(page.locator('[data-source-kind="excerpt"]')).toHaveCount(0);await page.locator('#retained-library-search').fill('changed note');await expect(page.locator('[data-source-kind="excerpt"]')).toHaveCount(1);
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await source?.close();await page.close();await context.unroute(webpage);await restore()}
});

test('uses the saved unique webpage quote when native context is truncated, and refuses a changed quote',async()=>{
  const restore=await setup(),page=await context.newPage(),calls=textRequests.length+visionRequests.length;let source:import('@playwright/test').Page|undefined,changed=false;
  const projectPage='https://www.overleaf.com/project/pi-library-local-quote',projectKey=createHash('sha256').update(projectPage).digest('hex').slice(0,32);
  await worker().evaluate(async({key,nextKey,url})=>{const s=(globalThis as any).chrome.storage.local,all=(await s.get('piWebExcerptsV1')).piWebExcerptsV1,record=all[key][0];record.pageUrl=url;record.anchor.prefix='tached. A missing block boundary';record.anchor.suffix='a partial suffix rej';delete all[key];all[nextKey]=[record];await s.set({piWebExcerptsV1:all})},{key:webId,nextKey:projectKey,url:projectPage});
  await context.route(projectPage,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Source quote</title><div style="height:3000px">Fixed fixture</div><p id="quote">${changed?'The source now makes a different claim.':quote}</p><div style="height:2000px"></div>`}));
  try{
    const before=await stored();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await page.locator('#retained-library-search').fill('网页笔记');const row=page.locator('[data-source-kind="excerpt"]');await row.locator('.library-select').click();
    let popup=page.waitForEvent('popup');await page.locator('#library-detail .library-source-open').click();source=await popup;await expect(source.locator('#quote')).toBeInViewport();expect(await source.evaluate(()=>scrollY)).toBeGreaterThan(2000);expect(await stored()).toEqual(before);await source.close();source=undefined;
    changed=true;popup=page.waitForEvent('popup');await page.locator('#library-detail .library-source-open').click();source=await popup;await source.waitForLoadState('load');await expect(source.locator('#quote')).not.toBeInViewport();expect(await source.evaluate(()=>scrollY)).toBe(0);expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await source?.close();await page.close();await context.unroute(projectPage);await restore()}
});

test('keeps translations readable when an auxiliary record is invalid and restores search after it is repaired',async()=>{
  const restore=await setup(),page=await context.newPage();
  try{
    await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{invalid:{annotations:[],updatedAt:1}}}));
    const before=await stored();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await expect(page.locator('.library-open')).toHaveCount(1);await expect(page.locator('#retained-storage-action-status')).toContainText('部分资料读取失败');
    await page.locator('#retained-library-search').fill('quantum');await expect(page.locator('.library-open')).toHaveCount(1);expect(await stored()).toEqual(before);
    await worker().evaluate(async value=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:value}),seed.piPdfReadingAnnotationsV1);
    await expect(page.locator('#retained-document-library .library-entry')).toHaveCount(4);await expect(page.locator('#retained-storage-action-status')).toBeEmpty();
    await page.locator('#retained-library-search').fill('no such saved material');await expect(page.locator('.library-entry')).toHaveCount(0);await expect(page.locator('#retained-document-library')).toContainText('没有匹配的资料');
    await page.getByRole('button',{name:'清除搜索',exact:true}).click();await expect(page.locator('.library-open')).toHaveCount(1);
  }finally{await page.close();await restore()}
});

test('reports a missing quote without inventing a precise match or rewriting the saved note',async()=>{
  const restore=await setup(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  try{
    await worker().evaluate(async()=>{
      const s=(globalThis as any).chrome.storage.local,all=(await s.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1;
      Object.values(all).forEach((state:any)=>{state.annotations[0].anchor.sourceText='This exact quote is no longer present.'});
      await s.set({piPdfReadingAnnotationsV1:all});
    });
    const before=await stored(),id=JSON.stringify(['pdf-note',pdfId,'saved-note']);
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(id)}`);
    await expect(reader.locator('.pdf-excerpt-source-preview')).toContainText('no longer present');
    await reader.locator('#file-input').setInputFiles({name:'unchanged-original.pdf',mimeType:'application/pdf',buffer:pdf});
    await expect(reader.locator('#notice')).toContainText('暂时无法精确定位');
    await expect(reader.locator('[data-library-source]')).toHaveCount(0);
    await expect(reader.locator('.pdf-page[data-page-number="2"]')).toBeInViewport();
    expect(await stored()).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close();await restore()}
});

test('locates an existing PDF region marker without replacing its translation, formula or note',async({},info)=>{
  const restore=await setup(),reader=await context.newPage(),calls=textRequests.length+visionRequests.length;
  const key='piPdfTranslationMarkersV1';
  const previous=await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key);
  try{
    const marker={markerId:'old-region',anchor:{kind:'region',pageNumber:2,leftRatio:.1,topRatio:.15,widthRatio:.6,heightRatio:.12},content:{sourceTitle:'Saved region paper',originalText:'A source formula $x=y$',translatedText:'人工修正 $x=y$',pageNumber:2,note:'Original region note'},createdAt:1};
    await worker().evaluate(async({key,pdfId,marker})=>await(globalThis as any).chrome.storage.local.set({[key]:{[pdfId]:{enabled:true,markers:[marker],updatedAt:1}}}),{key,pdfId,marker});
    const before=await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key),id=JSON.stringify(['pdf',pdfId,'old-region']);
    await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(id)}`);
    await expect(reader.locator('.pdf-excerpt-source-preview')).toContainText('Original region note');
    await reader.locator('#file-input').setInputFiles({name:'region-original.pdf',mimeType:'application/pdf',buffer:pdf});
    const mark=reader.locator('[data-library-source="old-region"]');await expect(mark).toBeInViewport();await expect(reader.locator('#notice')).toContainText('已定位原文');
    const geometry=await mark.evaluate(el=>{
      const page=el.closest<HTMLElement>('.pdf-page')!,box=el.getBoundingClientRect(),base=page.getBoundingClientRect();
      return {page:page.dataset.pageNumber,left:(box.left-base.left)/base.width,top:(box.top-base.top)/base.height,width:box.width/base.width,height:box.height/base.height};
    });
    expect(geometry.page).toBe('2');expect(geometry.left).toBeCloseTo(.1,2);expect(geometry.top).toBeCloseTo(.15,2);expect(geometry.width).toBeCloseTo(.6,2);expect(geometry.height).toBeCloseTo(.12,2);
    expect(await worker().evaluate(async key=>await(globalThis as any).chrome.storage.local.get(key),key)).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
    await writeFile(info.outputPath('old-region-location.json'),JSON.stringify(geometry,null,2));await reader.screenshot({path:info.outputPath('old-region-located.png')});
  }finally{
    await reader.close();await worker().evaluate(async({key,previous})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(key);await s.set(previous)},{key,previous});await restore();
  }
});

for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`keeps submitted note and citation fields readable but locked until saving finishes in ${language}`,async({},info)=>{
 const restore=await setup(),options=await context.newPage(),preference=await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get('uiLanguagePreference'));
 try{
  await worker().evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);await options.setViewportSize({width,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('网页笔记');await options.locator('.library-source-result .library-select').click();await options.locator('#library-detail .library-detail-edit').click();const form=options.locator('.saved-web-excerpt-editor'),note=form.locator('textarea'),before=await stored(),calls=textRequests.length+visionRequests.length;await note.fill('第一份已提交的研究笔记');await delayStorageWrite(options,'piWebExcerptsV1');await form.locator('button[type="submit"]').click();await expect.poll(()=>options.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);
  for(const field of await form.locator('input,textarea').all())await expect(field).toHaveJSProperty('readOnly',true);await options.locator('#web-excerpts-search').fill('Web quantum paper');await expect(options.locator('.saved-web-excerpt')).toHaveCount(1);for(const field of await form.locator('input,textarea').all())await expect(field).toHaveJSProperty('readOnly',true);await note.press('End');await note.pressSequentially('late draft');await expect(note).toHaveValue('第一份已提交的研究笔记');await note.selectText();await expect(note).toBeFocused();await options.screenshot({path:info.outputPath(`note-saving-${language}.png`)});await releaseStorageWrite(options);await expect(form).toHaveCount(0);
  const after=await stored(),old=seed.piWebExcerptsV1[webId]![0]!,saved=(after.piWebExcerptsV1 as any)[webId][0];expect(saved.content).toEqual({...old.content,note:'第一份已提交的研究笔记'});for(const key of keys.filter(key=>key!=='piWebExcerptsV1'))expect(after[key]).toEqual(before[key]);expect(textRequests.length+visionRequests.length).toBe(calls);
  await options.locator('#web-excerpts-library > summary').click();await options.locator('#web-excerpts-search').fill('第一份已提交');await options.locator('.saved-web-excerpt-edit').click();await expect(note).toHaveJSProperty('readOnly',false);await note.fill('随后主动保存的第二份笔记');await form.locator('button[type="submit"]').click();await expect(form).toHaveCount(0);expect((await stored()).piWebExcerptsV1[webId][0].content.note).toBe('随后主动保存的第二份笔记');
 }finally{await releaseStorageWrite(options);await options.close();await worker().evaluate(async preference=>{const s=(globalThis as any).chrome.storage.local;await s.remove('uiLanguagePreference');await s.set(preference)},preference);await restore()}
});

test('locks a submitted tag edit until acknowledgement without changing saved filters or research material',async()=>{
 const restore=await setupOrganization(),options=await context.newPage();
 try{
  await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('网页笔记');await options.locator('.library-source-result .library-select').click();await options.locator('#library-detail .library-tag-edit').click();const dialog=options.getByRole('dialog',{name:'主题标签（逗号分隔，最多 12 个）',exact:true}),input=dialog.getByRole('textbox'),before=await stored();await input.fill('课题 A, 阅读中');await delayStorageWrite(options,organizationKey);await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(()=>options.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);await expect(input).toHaveJSProperty('readOnly',true);await input.press('End');await input.pressSequentially(',lost');await expect(input).toHaveValue('课题 A, 阅读中');await releaseStorageWrite(options);await expect(dialog).toHaveCount(0);expect((await storedOrganization()).views).toEqual(organizationSeed.views);expect((await storedOrganization()).tags[webNoteId].tags).toEqual(['课题 A','阅读中']);expect(await stored()).toEqual(before);
 }finally{await releaseStorageWrite(options);await options.close();await restore()}
});

test('unlocks the current note editor after a delayed storage failure even if search rebuilt it',async()=>{
 const restore=await setup(),options=await context.newPage();
 try{
  await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();await options.locator('#web-excerpts-search').fill('Web quantum paper');await options.locator('.saved-web-excerpt-edit').click();const form=options.locator('.saved-web-excerpt-editor'),note=form.locator('textarea'),before=await stored();await note.fill('存储失败时仍保留的笔记草稿');await delayStorageWrite(options,'piWebExcerptsV1',true);await form.locator('button[type="submit"]').click();await expect.poll(()=>options.evaluate(()=>(globalThis as any).storageWriteReady)).toBe(true);await options.locator('#web-excerpts-search').fill('quantum');await expect(options.locator('.saved-web-excerpt')).toHaveCount(2);await expect(note).toHaveJSProperty('readOnly',true);await releaseStorageWrite(options);await expect(form.locator('.saved-web-excerpt-editor-error')).toBeVisible();await expect(note).toBeEditable();await expect(note).toHaveValue('存储失败时仍保留的笔记草稿');await expect(form.locator('button[type="submit"]')).toBeEnabled();expect(await stored()).toEqual(before);await note.fill('修正后重试保存的笔记');await form.locator('button[type="submit"]').click();await expect(form).toHaveCount(0);expect((await stored()).piWebExcerptsV1[webId][0].content.note).toBe('修正后重试保存的笔记');
 }finally{await releaseStorageWrite(options);await options.close();await restore()}
});
for(const [language,width] of [['zh-CN',1100],['en',360]] as const)test(`filters through a detail tag without dropping the existing search or changing saved records in ${language}`,async({},info)=>{
 const restore=await setupOrganization(),options=await context.newPage(),preference=await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get('uiLanguagePreference'));
 try{
  await worker().evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);await options.setViewportSize({width,height:850});await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const search=options.locator('#retained-library-search'),kind=options.locator('#retained-library-filter'),views=options.locator('#library-saved-view');await expect(views).toContainText('课题 A 笔记');await views.selectOption('topic');await options.locator('.library-source-result .library-select').click();const before=await stored(),organization=await storedOrganization(),calls=textRequests.length+visionRequests.length;const chip=options.locator('#library-detail .library-tag-chip');await expect(chip).toHaveText('课题 A');await chip.press('Enter');await expect(options.locator('#library-tag-filter')).toHaveValue('课题 A');await expect(options.locator('#library-tag-filter')).toBeFocused();await expect(search).toHaveValue('quantum');await expect(kind).toHaveValue('excerpt');await expect(views).toHaveValue('');await expect(options.locator('.library-source-result')).toHaveCount(1);if(width===360)await expect(options.locator('#library-detail')).toBeHidden();await options.screenshot({path:info.outputPath(`tag-navigation-${language}.png`)});expect(await stored()).toEqual(before);expect(await storedOrganization()).toEqual(organization);expect(textRequests.length+visionRequests.length).toBe(calls);await options.locator('#library-clear-filters').click();await expect(search).toHaveValue('');await expect(options.locator('.library-entry')).toHaveCount(3);
 }finally{await options.close();await worker().evaluate(async value=>{const s=(globalThis as any).chrome.storage.local;await s.remove('uiLanguagePreference');await s.set(value)},preference);await restore()}
});
