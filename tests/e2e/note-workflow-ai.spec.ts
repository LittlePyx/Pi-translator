import {createHash} from 'node:crypto';
import type {Page,Route} from '@playwright/test';
import {clickPdfReaderAction} from './support/translation-controls';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
import {parseFormulaDocument} from '../../core/translation/formula-document';
installEdgeExtensionHooks();
const worker=()=>context.serviceWorkers()[0]!;
const local=()=>worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
const sentences=['Kernel estimation may be limited.','A second observation supports further reading.'];
const pdf=createTwoPageTextPdf(sentences[0]!,sentences[1]!),fingerprint=createHash('sha256').update(pdf).digest('hex'),documentId=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
const annotations=sentences.map((sourceText,index)=>({id:`summary-note-${index}`,kind:'highlight',anchor:{kind:'text-quote',pageNumber:index+1,sourceText,prefix:'',suffix:''},sourceTitle:'Summary research source',...(index===0?{note:'个人想法：需要独立验证。'}:{}),createdAt:index+1,updatedAt:index+1}));
const signatures=sentences.map((source,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,source,0));
const formula=parseFormulaDocument({recognizedText:'{{m1}}',translation:'人工修正 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
const record={documentKey:pdfDocumentTranslationSessionDocumentKey('note-workflow-summary'),sourceFingerprint:fingerprint,targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:1,behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:signatures.map((signature,index)=>({signature,pageNumber:index+1,translatedText:index===0?'核函数估计可能有限。':formula.translationTemplate,...(index===1?{formulaDocument:formula}:{}),manualCorrection:true,revisions:[{id:`revision-preserved-${index}`,createdAt:1,reason:'correction',translatedText:'旧人工修正'}]}))};
async function preserve(run:()=>Promise<void>){const old=await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage;return {local:await s.local.get(null),session:await s.session.get(null)}});try{await run()}finally{await worker().evaluate(async old=>{const s=(globalThis as any).chrome.storage;await s.local.clear();await s.session.clear();await s.local.set(old.local);await s.session.set(old.session)},old)}}
async function seed(){await worker().evaluate(async({documentId,annotations,record})=>{const s=(globalThis as any).chrome.storage.local,settings=(await s.get('extensionSettings')).extensionSettings;await s.set({uiLanguagePreference:'zh-CN',extensionSettings:{...settings,purposePreferences:{purposes:['learning','research'],researchField:'保留手填领域'}},piPdfReadingAnnotationsV1:{[documentId]:{annotations,updatedAt:3}},piPdfAreaNotesV1:{},piPdfTranslationMarkersV1:{},piWebExcerptsV1:{},pdfDocumentTranslationRetainedV1:[record],documentTranslationMemoryV1:{}})},{documentId,annotations,record})}
async function openPdf(page:Page){await page.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']))}`);await page.locator('#file-input').setInputFiles({name:'summary-source.pdf',mimeType:'application/pdf',buffer:pdf});await expect(page.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete')}
async function openSummary(page:Page){const menu=page.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();await page.locator('#pdf-note-summary').click();const dialog=page.locator('.pi-note-summary');await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();return dialog}
async function mockSummary(mode:'success'|'bad'|'hold'|'error'='success'){
 let pause=false;const attempts:Record<string,any>[]=[],gates:{release?:()=>void}={};const held=new Promise<void>(resolve=>gates.release=resolve);
 const handler=async(route:Route)=>{const body=route.request().postDataJSON();if(!body?.messages?.[0]?.content?.startsWith('Summarize only the supplied'))return route.fallback();attempts.push(body);if(mode==='hold'||pause)await held;if(mode==='error'){await route.fulfill({status:500,contentType:'application/json',body:'{"error":{"message":"offline summary failure"}}'});return}const excerpts=JSON.parse(body.messages[1].content).excerpts,source=excerpts.find((item:any)=>item.originalText||item.translatedText),note=excerpts.find((item:any)=>item.note);const points=[...(source?[{kind:'source',text:'所选摘录提示结论存在范围限制。',sources:[mode==='bad'?'s99':source.id]}]:[]),...(note?[{kind:'note',text:'个人笔记提出进一步验证的想法。',sources:[note.id]}]:[])];try{await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({points})},finish_reason:'stop'}],usage:{prompt_tokens:80,completion_tokens:30}})})}catch{/* Cancelled fixture requests may already be closed. */}};
 await context.route('https://www.overleaf.com/pi-translator-e2e-api/**',handler);return {attempts,pause:()=>{pause=true},release:()=>gates.release?.(),dispose:async()=>{gates.release?.();await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/**',handler)}};
}
function assertSaved(before:any,after:any){expect(after.piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1);expect(after.piWebExcerptsV1).toEqual(before.piWebExcerptsV1);expect(Object.fromEntries(after.pdfDocumentTranslationRetainedV1.map((item:any)=>[item.documentKey,Object.fromEntries(item.blocks.map((block:any)=>[block.signature,block]))]))).toEqual(Object.fromEntries(before.pdfDocumentTranslationRetainedV1.map((item:any)=>[item.documentKey,Object.fromEntries(item.blocks.map((block:any)=>[block.signature,block]))])));expect(after.extensionSettings).toEqual(before.extensionSettings)}

test('offers a reversible no-result source/translation search without editing saved work',async({},info)=>preserve(async()=>{
 const page=await context.newPage();try{await seed();await openPdf(page);const before=await local(),calls=textRequests.length+visionRequests.length;await page.keyboard.press('Control+f');await page.locator('#pdf-search-scope').selectOption('source');await page.locator('#pdf-search-query').fill('核函数');await expect(page.locator('#pdf-search-status')).toHaveText('未找到');await page.locator('#pdf-search-assistance .search-assistance-broaden').click();await expect(page.locator('#pdf-search-scope')).toHaveValue('all');await expect(page.locator('.pdf-search-translation-current')).toBeAttached();await expect(page.locator('#pdf-search-query')).toHaveValue('核函数');await page.locator('#pdf-search-assistance .search-assistance-restore').click();await expect(page.locator('#pdf-search-scope')).toHaveValue('source');await expect(page.locator('#pdf-search-query')).toHaveValue('核函数');assertSaved(before,await local());expect(textRequests.length+visionRequests.length).toBe(calls);await page.setViewportSize({width:360,height:480});const button=page.locator('#pdf-search-assistance .search-assistance-broaden');const box=await button.boundingBox();expect(box!.width).toBeGreaterThan(80);expect(box!.height).toBeLessThanOrEqual(60);await page.screenshot({path:info.outputPath('search-assistance-360.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)}finally{await page.close()}
}));
test('previews saved notes without API calls and generates cited source and personal-note groups',async({},info)=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();try{await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);expect(mock.attempts).toHaveLength(0);await expect(dialog.locator('.note-summary-count')).toContainText('科研');await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toContainText('原文要点');await expect(dialog.locator('.note-summary-result')).toContainText('个人笔记整理');await expect(dialog.locator('.note-summary-sources a')).toHaveCount(2);expect(mock.attempts).toHaveLength(1);const payload=JSON.stringify(mock.attempts[0]);expect(payload).not.toContain(documentId);expect(payload).not.toContain('保留手填领域');expect(payload).not.toContain('summary-source.pdf');expect(payload).not.toContain('http');assertSaved(before,await local());await page.screenshot({path:info.outputPath('summary-source-groups.png')});const count=context.pages().length;await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeHidden();await expect(page.locator('.region-source-highlight')).toBeAttached();await expect(page.locator('#pdf-link-return')).toHaveText('← 返回小结');await page.locator('#pdf-link-return').click();await expect(dialog).toBeVisible();expect(mock.attempts).toHaveLength(1);expect(context.pages().length).toBe(count)}finally{await page.close();await mock.dispose()}
}));
test('opens a cited original natively when no PDF reader is open',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();let source:Page|undefined;try{await seed();await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await page.locator('#retained-library-search').fill('个人想法：需要独立验证。');await page.locator('.library-entry .library-select').first().click();await page.locator('#library-detail .library-menu > summary').click();await page.locator('#library-detail .note-summary-action').click();const dialog=page.locator('.pi-note-summary');await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();const before=await local();await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();const opening=page.waitForEvent('popup');await dialog.locator('.note-summary-sources a').first().click();source=await opening;await source.waitForURL(/pdf\.html\?excerpt=/u);await expect(source.locator('.pdf-excerpt-source-preview')).toBeVisible();await expect(dialog).toBeVisible();assertSaved(before,await local());expect(mock.attempts).toHaveLength(1)}finally{await source?.close();await page.close();await mock.dispose()}
}));
test('sends only selected saved excerpts and keeps an unsaved PDF note editor mounted',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();try{await seed();await openPdf(page);const dialog=await openSummary(page);await dialog.locator('.note-summary-range > summary').click();await dialog.getByRole('button',{name:'清空选择',exact:true}).click();await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'全选',exact:true}).click();await dialog.locator('input[type=checkbox]').first().uncheck();await dialog.getByRole('combobox',{name:'小结用途（仅本次）'}).selectOption('learning');await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();expect(JSON.parse(mock.attempts[0]!.messages[1].content).excerpts).toHaveLength(1);expect(mock.attempts[0]!.messages[0].content).toContain('Focus on meaning');expect((await local()).extensionSettings.purposePreferences.purposes).toEqual(['learning','research']);await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#pdf-document-translation-view-compare').click();await clickPdfReaderAction(page,'pdf-open-annotations');await page.locator('#pdf-annotations-dialog .pdf-annotation-edit').first().click();const field=page.locator('#pdf-annotations-dialog textarea');await field.fill('尚未保存的人工笔记');const before=await local();const target={kind:'pdf',documentId};const response=await page.evaluate(async target=>await(globalThis as any).chrome.runtime.sendMessage({type:'PREVIEW_NOTE_SUMMARY',payload:{target}}),target);expect(JSON.stringify(response)).not.toContain('尚未保存的人工笔记');await expect(field).toHaveValue('尚未保存的人工笔记');assertSaved(before,await local())}finally{await page.close();await mock.dispose()}
}));
for(const mode of ['bad','error'] as const)test(`rejects ${mode} summaries without retrying or changing notes`,async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary(mode);try{await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();await expect(dialog.locator('[role=status]')).not.toHaveText('正在生成小结…');await expect(dialog.locator('.note-summary-result')).toBeHidden();expect(mock.attempts).toHaveLength(1);assertSaved(before,await local())}finally{await page.close();await mock.dispose()}
}));
test('cancels an in-flight summary and ignores a late fixture response',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary('hold');try{await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect.poll(()=>mock.attempts.length).toBe(1);await dialog.getByRole('button',{name:'取消生成',exact:true}).click();mock.release();await expect(dialog.locator('[role=status]')).toHaveText('小结已取消，原笔记未改变。');await expect(dialog.locator('.note-summary-result')).toBeHidden();expect(mock.attempts).toHaveLength(1);assertSaved(before,await local())}finally{mock.release();await page.close();await mock.dispose()}
}));
test('keeps a previous summary when a later generation is cancelled',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();try{await seed();await openPdf(page);const dialog=await openSummary(page);await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();const result=await dialog.locator('.note-summary-result').innerText();mock.pause();await dialog.locator('.note-summary-range > summary').click();await dialog.getByRole('button',{name:'重新生成',exact:true}).click();await expect.poll(()=>mock.attempts.length).toBe(2);await dialog.getByRole('button',{name:'取消生成',exact:true}).click();mock.release();await expect(dialog.locator('[role=status]')).toHaveText('小结已取消，原笔记未改变。');expect(await dialog.locator('.note-summary-result').innerText()).toBe(result);await expect(dialog.getByRole('button',{name:'复制小结',exact:true})).toBeVisible()}finally{mock.release();await page.close();await mock.dispose()}
}));
test('isolates summary cancellation between extension documents',async()=>preserve(async()=>{
 const first=await context.newPage(),second=await context.newPage(),mock=await mockSummary('hold');let pending:Promise<any>|undefined;try{await seed();await first.goto(`chrome-extension://${extensionId}/options.html`);await second.goto(`chrome-extension://${extensionId}/options.html`);const target={kind:'pdf',documentId},preview=await first.evaluate(async target=>await(globalThis as any).chrome.runtime.sendMessage({type:'PREVIEW_NOTE_SUMMARY',payload:{target}}),target),payload={target,configuration:preview.data.configuration,requestId:'owned-summary',selections:preview.data.sources.map(({id,revision}:any)=>({id,revision}))};pending=first.evaluate(async payload=>await(globalThis as any).chrome.runtime.sendMessage({type:'GENERATE_NOTE_SUMMARY',payload}),payload);await expect.poll(()=>mock.attempts.length).toBe(1);const cancellation=await second.evaluate(async()=>await(globalThis as any).chrome.runtime.sendMessage({type:'CANCEL_NOTE_SUMMARY',payload:{requestId:'owned-summary'}}));expect(cancellation).toEqual({ok:true,data:{cancelled:false}});mock.release();expect((await pending).ok).toBe(true);expect(mock.attempts).toHaveLength(1)}finally{mock.release();await pending?.catch(()=>undefined);await first.close();await second.close();await mock.dispose()}
}));
test('rejects summaries whose selected saved note changed while the API was pending',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary('hold');try{await seed();await openPdf(page);const dialog=await openSummary(page);await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect.poll(()=>mock.attempts.length).toBe(1);await worker().evaluate(async documentId=>{const s=(globalThis as any).chrome.storage.local,map=(await s.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1;map[documentId].annotations[0].note='另一窗口已保存的新笔记';map[documentId].annotations[0].updatedAt=20;await s.set({piPdfReadingAnnotationsV1:map})},documentId);const changed=await local();mock.release();await expect(dialog.locator('[role=status]')).toContainText('笔记已修改或删除');await expect(dialog.locator('.note-summary-result')).toBeHidden();assertSaved(changed,await local());expect(mock.attempts).toHaveLength(1)}finally{mock.release();await page.close();await mock.dispose()}
}));
test('checks preview revisions, sender scope and missing credentials before sending any API request',async()=>preserve(async()=>{
 const page=await context.newPage(),web=await context.newPage(),mock=await mockSummary();try{await seed();await page.goto(`chrome-extension://${extensionId}/options.html`);const target={kind:'pdf',documentId};const preview=await page.evaluate(async target=>await(globalThis as any).chrome.runtime.sendMessage({type:'PREVIEW_NOTE_SUMMARY',payload:{target}}),target);expect(preview.ok).toBe(true);const selections=preview.data.sources.map(({id,revision}:any)=>({id,revision}));const payload={target,requestId:'offline-guard',configuration:preview.data.configuration,selections};await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.session.remove(['apiKeysByProfile','apiKey','deepseekApiKey']);await(globalThis as any).chrome.storage.local.remove(['apiKeysByProfile','apiKey','deepseekApiKey'])});const noKey=await page.evaluate(async payload=>await(globalThis as any).chrome.runtime.sendMessage({type:'GENERATE_NOTE_SUMMARY',payload}),payload);expect(noKey.ok).toBe(false);expect(mock.attempts).toHaveLength(0);const stale=await page.evaluate(async payload=>await(globalThis as any).chrome.runtime.sendMessage({type:'GENERATE_NOTE_SUMMARY',payload:{...payload,selections:payload.selections.map((item:any)=>({...item,revision:'0'.repeat(64)}))}}),payload);expect(stale.ok).toBe(false);expect(mock.attempts).toHaveLength(0);
  const url='https://www.overleaf.com/project/pi-summary-scope';await context.route(url,r=>r.fulfill({contentType:'text/html',body:'<p>A scope check.</p>'}));await web.goto(url);const denied=await page.evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((t:any)=>t.url===url);return c.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:async()=>await(globalThis as any).chrome.runtime.sendMessage({type:'PREVIEW_NOTE_SUMMARY',payload:{target:{kind:'pdf',documentId:'a'.repeat(32)}}})})},url);expect(denied[0].result.ok).toBe(false);expect(mock.attempts).toHaveLength(0);await context.unroute(url);
 }finally{await web.close();await page.close();await mock.dispose()}
}));
test('broadens library types reversibly without clearing the query',async()=>preserve(async()=>{
 const page=await context.newPage();try{await seed();await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({documentTranslationMemoryV1:{}})});await page.goto(`chrome-extension://${extensionId}/options.html#storage`);const query=page.locator('#retained-library-search'),kind=page.locator('#retained-library-filter');await kind.selectOption('web');await query.fill('Kernel');await expect(page.locator('.library-entry')).toHaveCount(0);await page.locator('.search-assistance-broaden').click();await expect(query).toHaveValue('Kernel');await expect(kind).toHaveValue('all');await expect(page.locator('.library-entry')).not.toHaveCount(0);await page.locator('.search-assistance-restore').click();await expect(query).toHaveValue('Kernel');await expect(kind).toHaveValue('web')}finally{await page.close()}
}));
test('automatically supplements a saved-view search without changing the query, tag or filters',async()=>preserve(async()=>{
 const page=await context.newPage();try{await seed();const id=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);await worker().evaluate(async id=>{await(globalThis as any).chrome.storage.local.set({documentTranslationMemoryV1:{'doc-local':{schemaVersion:1,documentId:'doc-local',label:'Confirmed terminology',updatedAt:3,confirmedTerms:[{id:'term',source:'estimator',target:'核函数',createdAt:1,updatedAt:3}],candidateTerms:[],recentTranslations:[],dismissedTermKeys:[]}},piLibraryOrganizationV1:{tags:{[id]:{tags:['课题 A'],updatedAt:1}},views:{topic:{name:'本课题PDF',query:'estimator',kind:'pdf',tag:'课题 A',updatedAt:2}}}})},id);await page.goto(`chrome-extension://${extensionId}/options.html#storage`);const view=page.locator('#library-saved-view'),query=page.locator('#retained-library-search'),kind=page.locator('#retained-library-filter');await expect(view).toContainText('本课题PDF');await view.selectOption('topic');await expect(page.locator('.search-assistance-matched')).toContainText('核函数');const before=await local(),calls=textRequests.length+visionRequests.length;await expect(query).toHaveValue('estimator');await expect(kind).toHaveValue('pdf');await expect(page.locator('#library-tag-filter')).toHaveValue('课题 A');await expect(page.locator('.library-entry')).not.toHaveCount(0);await expect(page.locator('.search-assistance-restore')).toHaveCount(0);await expect(query).toHaveValue('estimator');await expect(view).toHaveValue('topic');await expect(kind).toHaveValue('pdf');await expect(page.locator('#library-tag-filter')).toHaveValue('课题 A');expect((await local()).piLibraryOrganizationV1).toEqual(before.piLibraryOrganizationV1);assertSaved(before,await local());expect(textRequests.length+visionRequests.length).toBe(calls)}finally{await page.close()}
}));
test('summarizes saved webpage notes while preserving a separate unsaved page draft',async()=>preserve(async()=>{
 const web=await context.newPage(),url='https://www.overleaf.com/project/pi-web-note-summary',key=createHash('sha256').update(url).digest('hex').slice(0,32),quote='A saved research passage may have limits.',mock=await mockSummary();try{await seed();await context.route(url,r=>r.fulfill({contentType:'text/html',body:`<p>Before</p><div style="height:1200px"></div><p id="quote">${quote}</p><p>After</p><div style="height:1000px"></div><textarea aria-label="Draft" style="position:fixed;top:4px;left:4px"></textarea>`}));await worker().evaluate(async({url,key,quote})=>await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[key]:[{markerId:'web-summary',pageUrl:url,anchor:{sourceText:quote,prefix:'Before',suffix:'After'},content:{sourceTitle:'Web research source',originalText:quote,translatedText:'已保存的网页译文',note:'已保存的个人想法'},createdAt:1,updatedAt:2}]}}),{url,key,quote});await web.goto(url);const root=web.locator('#tex-selection-translator-root');await expect(root).toBeAttached();await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((tab:any)=>tab.url===url);await c.tabs.sendMessage(tab.id,{type:'OPEN_SIDEBAR'})},url);await root.locator('details.more > summary').click();await root.getByRole('button',{name:/查看本文标记/}).click();await web.getByRole('textbox',{name:'Draft',exact:true}).fill('未保存的网页草稿不发送');const before=await local();await root.locator('.note-summary-action').click();const dialog=root.locator('.pi-note-summary');await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();expect(mock.attempts).toHaveLength(0);await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();expect(JSON.stringify(mock.attempts)).not.toContain('未保存的网页草稿不发送');await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('未保存的网页草稿不发送');await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeVisible();await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('未保存的网页草稿不发送');const closed=dialog.evaluate(node=>new Promise<void>(resolve=>node.addEventListener('close',()=>resolve(),{once:true})));await dialog.getByRole('button',{name:'关闭',exact:true}).click();await closed;await web.getByRole('textbox',{name:'Draft',exact:true}).fill('');await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('');await root.locator('.note-summary-action').click();const sourceDialog=root.locator('.pi-note-summary');await expect(sourceDialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();await sourceDialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(sourceDialog.locator('.note-summary-result')).toBeVisible();const pages=context.pages().length;await sourceDialog.locator('.note-summary-sources a').first().click();await expect(sourceDialog).toBeHidden();await expect.poll(()=>web.locator('#quote').evaluate(node=>Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-innerHeight/2))).toBeLessThan(2);expect(context.pages().length).toBe(pages);assertSaved(before,await local());await root.locator('.source-reading-back').click();await expect(sourceDialog).toBeVisible();await sourceDialog.getByRole('button',{name:'关闭',exact:true}).click();await web.getByRole('textbox',{name:'Draft',exact:true}).fill('Esc 后仍保留的草稿');mock.pause();await root.locator('.note-summary-action').click();const again=root.locator('.pi-note-summary');await expect(again.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();await again.getByRole('button',{name:'生成小结',exact:true}).click();await expect.poll(()=>mock.attempts.length).toBe(3);await web.keyboard.press('Escape');await expect(again).toHaveCount(0);mock.release();await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('Esc 后仍保留的草稿');assertSaved(before,await local());await context.unroute(url)}finally{await web.close();await mock.dispose()}
}));
test('reopens an existing PDF note and retains an already open unsaved note draft',async()=>preserve(async()=>{
 const page=await context.newPage();try{await seed();await openPdf(page);await page.locator('#pdf-document-translation-view-compare').click();await page.locator('.textLayer').first().evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range)});await page.locator('#pdf-annotation-mode').click();await page.locator('.textLayer').first().evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const root=page.locator('#tex-selection-translator-root');await root.getByRole('button',{name:'保存阅读批注'}).click();await expect(page.locator('#pdf-annotations-dialog textarea')).toHaveValue(annotations[0]!.note!);await page.locator('#pdf-annotations-dialog textarea').fill('继续编辑的草稿');const before=await local();await expect(page.locator('#pdf-annotations-dialog textarea')).toHaveValue('继续编辑的草稿');expect((await local()).piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1)}finally{await page.close()}
}));
test('opens an existing saved web note after a duplicate save and preserves the current note draft',async()=>preserve(async()=>{
 const web=await context.newPage(),url='https://www.overleaf.com/project/pi-summary-duplicate',quote='A saved research passage is useful.';try{await seed();await context.route(url,r=>r.fulfill({contentType:'text/html',body:`<p id="source">${quote}</p>`}));await web.goto(url);await expect(web.locator('#tex-selection-translator-root')).toBeAttached();await web.locator('#source').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'))});const root=web.locator('#tex-selection-translator-root');await root.locator('.trigger').click();await root.getByRole('button',{name:'标记原文，悬停查看译文',exact:true}).click();await root.locator('details.more > summary').click();await root.getByRole('button',{name:/查看本文标记/}).click();await root.locator('.marker-note-more > summary').click();await root.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();await expect.poll(async()=>Object.keys((await local()).piWebExcerptsV1??{}).length).toBe(1);const map=(await local()).piWebExcerptsV1,old=(Object.values(map)[0] as any[])[0];await root.locator('.marker-note-more > summary').click();await root.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();await expect.poll(async()=>Object.keys((await local()).piWebExcerptsV1??{}).length).toBe(0);const oldNote={...old,markerId:'existing-old-note',content:{...old.content,note:'旧人工笔记保留',translatedText:'旧人工译文保留'}};await worker().evaluate(async({map,oldNote})=>{const key=Object.keys(map)[0];await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[key!]:[oldNote]}})},{map,oldNote});await root.locator('.marker-note-more > summary').click();await root.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();const draft=root.getByRole('textbox',{name:'个人笔记（可选）'});await draft.fill('新摘录尚未保存的想法');const before=(await local()).piWebExcerptsV1;await root.locator('.marker-note-more > summary').click();await root.getByRole('button',{name:'保存或取消保存这条网页摘录'}).click();await expect(root.locator('.existing-note-open')).toBeVisible();await expect(draft).toHaveValue('新摘录尚未保存的想法');await root.locator('.existing-note-open').click();const existing=root.locator('.pi-existing-note');await expect(existing).toContainText('旧人工笔记保留');await expect(existing).toContainText('旧人工译文保留');await existing.getByRole('button',{name:'关闭',exact:true}).click();await expect(draft).toHaveValue('新摘录尚未保存的想法');expect((await local()).piWebExcerptsV1).toEqual(before);await context.unroute(url)}finally{await web.close()}
}));
for(const language of ['zh-CN','en'])test(`keeps the summary preview and actions usable in a dark 300px ${language} layout`,async({},info)=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();try{await seed();await worker().evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);await page.setViewportSize({width:300,height:480});await page.emulateMedia({colorScheme:'dark'});await openPdf(page);const menu=page.locator('#pdf-document-translation-copy-menu');await menu.locator(':scope > summary').click();await page.locator('#pdf-note-summary').click();const dialog=page.locator('.pi-note-summary');await expect(dialog.locator('.note-summary-count')).toContainText('e2e-model');const generate=dialog.locator('.primary');await expect(generate).toBeEnabled();await generate.click();await expect(dialog.locator('.note-summary-result')).toBeVisible();expect(await dialog.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(300);expect(box!.y+box!.height).toBeLessThanOrEqual(480);await page.screenshot({path:info.outputPath(`summary-${language}-dark-300.png`)})}finally{await page.close();await mock.dispose()}
}));


async function addConfirmedSearchTerm(page:Page,source:string,target:string){
 const menu=page.locator('#pdf-document-translation-copy-menu');
 if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
 await page.locator('#pdf-document-terms').click();
 const manage=page.locator('#pdf-terms-manage');
 if(!await manage.evaluate((node:HTMLDetailsElement)=>node.open))await manage.locator('summary').first().click();
 await page.locator('#pdf-term-source').fill(source);await page.locator('#pdf-term-target').fill(target);
 await page.locator('#pdf-terms-add button').click();await expect(page.locator('#pdf-term-source')).toHaveValue('');
 await page.locator('#pdf-terms-close').click();
}

test('returns from PDF sources to the same summary, selection, purpose, focus and scroll without regenerating',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);
  await dialog.locator('.note-summary-range > summary').click();
  await dialog.locator('.note-summary-range input[type=checkbox]').last().uncheck();
  await dialog.locator('.note-summary-purpose select').selectOption('learning');
  await dialog.getByRole('button',{name:'生成小结',exact:true}).click();
  await expect(dialog.locator('.note-summary-result')).toBeVisible();
  const content=await dialog.locator('.note-summary-result').innerText(),originalPage=await page.locator('#page-number').inputValue();
  for(let round=0;round<2;round++){
   await dialog.locator('.note-summary-range > summary').click();
   const source=dialog.locator('.note-summary-sources a').first();await source.scrollIntoViewIfNeeded();
   const scroll=await dialog.locator('.pi-task-body').evaluate(node=>node.scrollTop);
   await source.click();await expect(dialog).toBeHidden();await expect(page.locator('#pdf-link-return')).toHaveText('← 返回小结');
   await page.locator('#pdf-link-return').click();await expect(dialog).toBeVisible();
   await expect(page.locator('#page-number')).toHaveValue(originalPage);
   expect(await dialog.locator('.note-summary-result').innerText()).toBe(content);
   await expect(dialog.locator('.note-summary-range input:checked')).toHaveCount(1);
   await expect(dialog.locator('.note-summary-purpose select')).toHaveValue('learning');
   await expect(source).toBeFocused();expect(Math.abs(await dialog.locator('.pi-task-body').evaluate(node=>node.scrollTop)-scroll)).toBeLessThanOrEqual(2);
   if(round===0)await dialog.locator('.note-summary-range > summary').click();
  }
  expect(mock.attempts).toHaveLength(1);assertSaved(before,await local());
 }finally{await page.close();await mock.dispose()}
}));

test('retains the generated snapshot when notes change while viewing a source and requires a new preview',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await openPdf(page);const dialog=await openSummary(page);
  await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();
  const content=await dialog.locator('.note-summary-result').innerText();
  await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeHidden();
  await worker().evaluate(async id=>{const s=(globalThis as any).chrome.storage.local,map=(await s.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1;map[id].annotations[0].note='查看出处时另一窗口保存的新笔记';map[id].annotations[0].updatedAt=200;await s.set({piPdfReadingAnnotationsV1:map})},documentId);
  const changed=await local();await page.locator('#pdf-link-return').click();await expect(dialog).toBeVisible();
  await expect(dialog.locator('[role=status]')).toContainText('笔记或接口已变化');
  expect(await dialog.locator('.note-summary-result').innerText()).toBe(content);
  await expect(dialog.locator('.note-summary-range')).toHaveAttribute('open','');
  await expect(dialog.getByRole('button',{name:'重新生成',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'重新预览',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'重新生成',exact:true})).toBeEnabled();
  await expect(dialog.locator('.note-summary-source-preview')).toContainText(['查看出处时另一窗口保存的新笔记','A second observation supports further reading.']);
  expect(mock.attempts).toHaveLength(1);assertSaved(changed,await local());
 }finally{await page.close();await mock.dispose()}
}));

test('does not consume the summary return or replace an unsaved reading draft',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);
  await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();
  await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeHidden();
  // A dirty, visible page field exercises the shared draft guard without saving it.
  await page.evaluate(()=>{const draft=document.createElement('textarea');draft.id='summary-reading-draft';draft.ariaLabel='Unsubmitted reading draft';draft.style.cssText='position:fixed;top:0;left:0;z-index:100';document.body.append(draft);draft.value='保留未保存的阅读草稿'});
  await page.locator('#pdf-link-return').evaluate((button:HTMLButtonElement)=>button.click());
  await expect(dialog).toBeHidden();await expect(page.locator('#summary-reading-draft')).toHaveValue('保留未保存的阅读草稿');
  await expect(page.locator('#pdf-link-return')).toHaveText('← 返回小结');
  await page.locator('#summary-reading-draft').fill('');await page.locator('#pdf-link-return').click();await expect(dialog).toBeVisible();
  expect(mock.attempts).toHaveLength(1);assertSaved(before,await local());
 }finally{await page.close();await mock.dispose()}
}));

test('drops a suspended summary when the verified PDF changes without changing saved notes',async()=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await openPdf(page);const before=await local(),dialog=await openSummary(page);
  await dialog.getByRole('button',{name:'生成小结',exact:true}).click();await expect(dialog.locator('.note-summary-result')).toBeVisible();
  await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeHidden();
  await page.locator('#file-input').setInputFiles({name:'other-document.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('A different research document.','Another page.')});
  await expect(dialog).toHaveCount(0);await expect(page.locator('#pdf-link-return')).toBeHidden();
  expect(mock.attempts).toHaveLength(1);expect((await local()).piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1);
 }finally{await page.close();await mock.dispose()}
}));

test('keeps a library summary mounted while reusing another original-reader window',async()=>preserve(async()=>{
 const reader=await context.newPage(),library=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await openPdf(reader);await library.goto(`chrome-extension://${extensionId}/options.html#storage`);
  await library.locator('#retained-library-filter').selectOption('pdf');
  await library.locator('.library-source-result .library-select').first().click();
  const detail=library.locator('#library-detail');await detail.locator('details.library-menu > summary').click();
  await detail.locator('.note-summary-action').click();const dialog=library.locator('.pi-note-summary');
  await expect(dialog.getByRole('button',{name:'生成小结',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'生成小结',exact:true}).click();
  await expect(dialog.locator('.note-summary-result')).toBeVisible();const content=await dialog.locator('.note-summary-result').innerText(),pages=context.pages().length,before=await local();
  await dialog.locator('.note-summary-sources a').first().click();await expect(reader.locator('.region-source-highlight')).toBeAttached();
  await library.bringToFront();await expect(dialog).toBeVisible();expect(await dialog.locator('.note-summary-result').innerText()).toBe(content);
  expect(context.pages().length).toBe(pages);expect(mock.attempts).toHaveLength(1);assertSaved(before,await local());
  await dialog.locator('.note-summary-sources a').first().click();
  await worker().evaluate(async id=>{const s=(globalThis as any).chrome.storage.local,map=(await s.get('piPdfReadingAnnotationsV1')).piPdfReadingAnnotationsV1;map[id].annotations[0].note='跨窗口查看出处后保存的新笔记';map[id].annotations[0].updatedAt=500;await s.set({piPdfReadingAnnotationsV1:map})},documentId);
  const changed=await local();await library.bringToFront();await expect(dialog.locator('[role=status]')).toContainText('笔记或接口已变化');
  expect(await dialog.locator('.note-summary-result').innerText()).toBe(content);expect(mock.attempts).toHaveLength(1);assertSaved(changed,await local());

 }finally{await reader.close();await library.close();await mock.dispose()}
}));

test('automatically searches confirmed PDF wording within the current scope and keeps direct hits first',async()=>preserve(async()=>{
 const page=await context.newPage();
 try{
  await seed();await openPdf(page);await addConfirmedSearchTerm(page,'Kernel','核函数');
  const before=await local(),calls=textRequests.length+visionRequests.length;
  await page.keyboard.press('Control+f');await page.locator('#pdf-search-scope').selectOption('source');
  await page.locator('#pdf-search-query').fill('核函数');await expect(page.locator('.search-assistance-matched')).toContainText('Kernel');
  await expect(page.locator('#pdf-search-query')).toHaveValue('核函数');await expect(page.locator('#pdf-search-scope')).toHaveValue('source');
  await expect(page.locator('.pdf-search-result mark')).toHaveText(['Kernel']);
  await page.locator('#pdf-search-query').fill('Kernel');await expect(page.locator('.search-assistance-matched')).toHaveCount(0);
  await expect(page.locator('.pdf-search-result mark')).toHaveText(['Kernel']);
  await page.locator('#pdf-search-query').fill('没有确认映射的词');await expect(page.locator('#pdf-search-status')).toHaveText('未找到');
  await expect(page.locator('.pdf-search-result')).toHaveCount(0);assertSaved(before,await local());expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await page.close()}
}));

for(const language of ['zh-CN','en'])test(`returns to the same summary in a dark 300px ${language} layout`,async({},info)=>preserve(async()=>{
 const page=await context.newPage(),mock=await mockSummary();
 try{
  await seed();await worker().evaluate(async language=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:language}),language);
  await page.setViewportSize({width:300,height:480});await page.emulateMedia({colorScheme:'dark'});await openPdf(page);
  const menu=page.locator('#pdf-document-translation-copy-menu');await menu.locator(':scope > summary').click();await page.locator('#pdf-note-summary').click();
  const dialog=page.locator('.pi-note-summary');await expect(dialog.locator('.primary')).toBeEnabled();await dialog.locator('.primary').click();await expect(dialog.locator('.note-summary-result')).toBeVisible();
  await dialog.locator('.note-summary-sources a').first().click();await expect(dialog).toBeHidden();
  if(language==='en')await expect(page.locator('#pdf-link-return')).toHaveText('← Back to summary');
  await page.screenshot({path:info.outputPath(`summary-source-${language}-300.png`)});
  await page.locator('#pdf-link-return').click();await expect(dialog).toBeVisible();expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
  const copy=dialog.getByRole('button',{name:language==='en'?'Copy summary':'复制小结',exact:true});await expect(copy).toBeEnabled();await copy.hover();
  const copyStyle=await copy.evaluate(button=>{
   const style=getComputedStyle(button),luminance=(color:string)=>{const channels=(color.match(/[\d.]+/gu)??[]).slice(0,3).map(value=>{const c=Number(value)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return .2126*channels[0]!+.7152*channels[1]!+.0722*channels[2]!};
   const foreground=luminance(style.color),background=luminance(style.backgroundColor);
   return {disabled:(button as HTMLButtonElement).disabled,color:style.color,background:style.backgroundColor,opacity:style.opacity,contrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)};
  });
  expect(copyStyle.contrast).toBeGreaterThanOrEqual(4.5);await info.attach('summary-copy-control',{body:JSON.stringify(copyStyle),contentType:'application/json'});
  await page.screenshot({path:info.outputPath(`summary-return-${language}-300.png`)});expect(mock.attempts).toHaveLength(1);
  await dialog.getByRole('button',{name:language==='en'?'Close':'关闭',exact:true}).click();
  const calls=textRequests.length+visionRequests.length;await addConfirmedSearchTerm(page,'Kernel','核函数');await page.keyboard.press('Control+f');
  await page.locator('#pdf-search-scope').selectOption('source');await page.locator('#pdf-search-query').fill('核函数');
  await expect(page.locator('.search-assistance-matched')).toContainText(language==='en'?'Found using confirmed terms: Kernel':'按已确认译法补查：Kernel');
  await expect(page.locator('#pdf-search-query')).toHaveValue('核函数');expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(`confirmed-search-${language}-300.png`)});expect(textRequests.length+visionRequests.length).toBe(calls);

 }finally{await page.close();await mock.dispose()}
}));


test('supplements a dictionary-only library hit with matching reading material and ignores unconfirmed candidates',async()=>preserve(async()=>{
 const page=await context.newPage();
 try{
  await seed();await worker().evaluate(async()=>{await(globalThis as any).chrome.storage.local.set({documentTranslationMemoryV1:{'doc-local':{schemaVersion:1,documentId:'doc-local',label:'Confirmed terminology',updatedAt:3,confirmedTerms:[{id:'term',source:'estimator',target:'核函数',createdAt:1,updatedAt:3}],candidateTerms:[],recentTranslations:[],dismissedTermKeys:[]}}})});
  await page.goto(`chrome-extension://${extensionId}/options.html#storage`);const before=await local(),calls=textRequests.length+visionRequests.length;
  await page.locator('#retained-library-search').fill('estimator');await expect(page.locator('.search-assistance-matched')).toContainText('核函数');
  await expect(page.locator('.library-entry[data-library-id]')).toHaveCount(1);await expect(page.locator('.library-source-result[data-source-kind=term]')).toHaveCount(1);
  await expect(page.locator('#retained-library-search')).toHaveValue('estimator');await expect(page.locator('#retained-library-filter')).toHaveValue('all');
  assertSaved(before,await local());expect(textRequests.length+visionRequests.length).toBe(calls);
  await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage.local,map=(await s.get('documentTranslationMemoryV1')).documentTranslationMemoryV1;map['doc-local'].confirmedTerms=[];map['doc-local'].candidateTerms=[{id:'candidate',source:'estimator',target:'核函数',createdAt:1}];await s.set({documentTranslationMemoryV1:map})});
  await page.reload();await page.locator('#retained-library-filter').selectOption('pdf');await page.locator('#retained-library-search').fill('estimator');
  await expect(page.locator('.library-entry')).toHaveCount(0);await expect(page.locator('.search-assistance-matched')).toHaveCount(0);
 }finally{await page.close()}
}));
