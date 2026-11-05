import {createHash} from 'node:crypto';
import type {Page} from '@playwright/test';
import {context,expect,extensionId,installEdgeExtensionHooks,test,createTwoPageTextPdf,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
import {parseFormulaDocument} from '../../core/translation/formula-document';
installEdgeExtensionHooks();
const source=['Alpha research reading source.','Beta passage returns to the second page.'];
const pdf=createTwoPageTextPdf(source[0]!,source[1]!);
const fingerprint=createHash('sha256').update(pdf).digest('hex'),id=createHash('sha256').update(`pdf-content:${fingerprint}`).digest('hex').slice(0,32);
const note={id:'saved-note',kind:'highlight',anchor:{kind:'text-quote',pageNumber:2,sourceText:'Beta',prefix:'',suffix:' passage returns to the second page.'},sourceTitle:'Reading source',note:'旧笔记保留',createdAt:1,updatedAt:2};
const signatures=source.map((text,index)=>pdfDocumentTranslationSessionBlockSignature(index+1,text,0));
const record={documentKey:pdfDocumentTranslationSessionDocumentKey('reading-navigation'),sourceFingerprint:fingerprint,targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:1,behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:signatures.map((signature,index)=>({signature,pageNumber:index+1,translatedText:(index?'阅读定位目标。':'保留人工修正。')+'研究记录与阅读内容保持不变。'.repeat(160),manualCorrection:true,revisions:[{id:'revision-old-'+index,createdAt:1,reason:'correction',translatedText:'旧译文与人工记录'}]}))};
const worker=()=>context.serviceWorkers()[0]!;
const snapshot=()=>worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
async function preserve(run:()=>Promise<void>){
 const old=await worker().evaluate(async()=>{const s=(globalThis as any).chrome.storage;return{local:await s.local.get(null),session:await s.session.get(null)}});
 try{await worker().evaluate(async()=>{const c=(globalThis as any).chrome,s=c.storage.local;await s.remove(['pdfDocumentTranslationRetainedV1','piRecentPdfDocumentsV1','piPdfReadingStatesV1','piPdfReadingAnnotationsV1','piPdfAreaNotesV1','piPdfTranslationMarkersV1','piWebExcerptsV1']);await c.storage.session.remove('pdfDocumentTranslationSessionsV1')});await run()}
 finally{await worker().evaluate(async old=>{const s=(globalThis as any).chrome.storage;await s.local.clear();await s.session.clear();await s.local.set(old.local);await s.session.set(old.session)},old)}
}
async function open(reader:Page,retained=false,buffer=pdf){
 if(retained)await worker().evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),record);
 const savedId=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);
 await reader.goto(`chrome-extension://${extensionId}/pdf.html${retained?'?restore='+encodeURIComponent(savedId):''}`);
 await reader.locator('#file-input').setInputFiles({name:'same-name.pdf',mimeType:'application/pdf',buffer});await expect(reader.locator('.pdf-page').first()).toHaveAttribute('data-rendered','ready');
 if(retained)await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
}
async function select(reader:Page,word:string,root='.textLayer'){
 await reader.locator('#document-stage').focus();
 await reader.locator(root).first().evaluate((root,word)=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.textContent!.indexOf(word);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+word.length);getSelection()!.removeAllRanges();getSelection()!.addRange(range);return}throw Error('Missing selected word')},word);
}
async function originalLink(options:Page){
 await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#retained-library-search').fill('旧笔记保留');await options.locator('.library-select').first().click();return options.locator('#library-detail .library-source-open');
}
test('uses selected reading text for search and preserves an edited or intentionally cleared query',async({},info)=>preserve(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
  await open(reader);await reader.locator('#pdf-annotation-mode').click();
  await select(reader,'Alpha');await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('Alpha');await reader.keyboard.press('Escape');
  await select(reader,'research');await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('research');
  await reader.locator('#pdf-search-query').fill('my manual query');await reader.keyboard.press('Escape');await select(reader,'Alpha');await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('my manual query');
  await reader.locator('#pdf-search-query').fill('');await reader.keyboard.press('Escape');await select(reader,'research');await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('');
  await reader.setViewportSize({width:360,height:800});await reader.screenshot({path:info.outputPath('selected-search-manual-preserved-360.png')});expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await reader.close()}
}));
test('returns from both translated and original search to the previous reading view and paragraph',async({},info)=>preserve(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
  await open(reader,true);await reader.locator('#pdf-document-translation-view-reading').click();
  const panel=reader.locator('#pdf-document-translation-pages');await panel.evaluate(n=>n.scrollTop=450);const before=await panel.evaluate(n=>n.scrollTop),saved=(await snapshot()).pdfDocumentTranslationRetainedV1;
  await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-query').fill('阅读定位目标');await expect(reader.locator('.pdf-search-translation-current')).toBeAttached();await reader.keyboard.press('Escape');
  await reader.locator('#pdf-link-return').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');await expect.poll(()=>panel.evaluate((n,old)=>Math.abs(n.scrollTop-old),before)).toBeLessThan(3);
  await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-scope').selectOption('source');await reader.locator('#pdf-search-query').fill('Beta');await expect(reader.locator('#page-number')).toHaveValue('2');await reader.keyboard.press('Escape');await reader.locator('#pdf-link-return').click();
  await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');await expect.poll(()=>panel.evaluate((n,old)=>Math.abs(n.scrollTop-old),before)).toBeLessThan(3);
  expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual(saved);expect(textRequests.length+visionRequests.length).toBe(calls);await reader.screenshot({path:info.outputPath('search-return-reading.png')});
 }finally{await reader.close()}
}));
test('reuses the verified original PDF from a note, then returns to reading without changing saved work',async({},info)=>preserve(async()=>{
 const reader=await context.newPage(),options=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
  await worker().evaluate(async({id,note})=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[id]:{annotations:[note],updatedAt:2}}}),{id,note});
  await open(reader,true);await reader.locator('#pdf-document-translation-view-reading').click();const panel=reader.locator('#pdf-document-translation-pages');await panel.evaluate(n=>n.scrollTop=420);const top=await panel.evaluate(n=>n.scrollTop),before=await snapshot(),count=context.pages().length;
  const link=await originalLink(options);await link.click();await expect(reader.locator('#page-number')).toHaveValue('2');expect(context.pages().length).toBe(count);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','compare');await expect(reader.locator('.region-source-highlight')).toBeAttached();
  await reader.locator('#pdf-link-return').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');await expect.poll(()=>panel.evaluate((n,old)=>Math.abs(n.scrollTop-old),top)).toBeLessThan(3);
  expect((await snapshot()).piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1);expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual(before.pdfDocumentTranslationRetainedV1);expect(textRequests.length+visionRequests.length).toBe(calls);await reader.screenshot({path:info.outputPath('source-reuse-return.png')});
 }finally{await reader.close();await options.close()}
}));
test('focuses a reader with an unsaved correction without moving or replacing its draft',async()=>preserve(async()=>{
 const reader=await context.newPage(),options=await context.newPage();try{
  await worker().evaluate(async({id,note})=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[id]:{annotations:[note],updatedAt:2}}}),{id,note});await open(reader,true);
  const block=reader.locator('[data-translation-block="P1B1"]');await block.hover();await block.locator('.pdf-paragraph-edit-action').click();await reader.locator('#pdf-paragraph-editor textarea').first().fill('尚未保存的人工修正');
  const position=await reader.locator('#pdf-viewer').evaluate(n=>n.scrollTop),before=await snapshot(),count=context.pages().length;
  await(await originalLink(options)).click();await expect(reader.locator('#pdf-paragraph-editor')).toBeVisible();await expect(reader.locator('#pdf-paragraph-editor textarea').first()).toHaveValue('尚未保存的人工修正');expect(context.pages().length).toBe(count);expect(await reader.locator('#pdf-viewer').evaluate(n=>n.scrollTop)).toBe(position);expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual(before.pdfDocumentTranslationRetainedV1);
 }finally{await reader.close();await options.close()}
}));
test('continues in a verified recent PDF and opens a new source for a different file with the same name',async()=>preserve(async()=>{
 const reader=await context.newPage(),options=await context.newPage();let extra:Page|undefined;try{
  await open(reader);await reader.locator('#page-number').fill('2');await reader.locator('#page-number').press('Enter');await expect(reader.locator('#page-number')).toHaveValue('2');
  await options.goto(`chrome-extension://${extensionId}/options.html#storage`);const count=context.pages().length,link=options.locator(`[data-recent-id="${id}"] .library-open`);await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');expect(context.pages().length).toBe(count);await expect(reader.locator('#page-number')).toHaveValue('2');
  const modified=context.waitForEvent('page');await link.click({modifiers:['Control']});extra=await modified;await extra.waitForURL(/pdf\.html\?recent=/u);await extra.close();extra=undefined;
  await open(reader,false,createTwoPageTextPdf('Different content with the same file name.','Other content.'));await options.reload();const popup=options.waitForEvent('popup');await options.locator(`[data-recent-id="${id}"] .library-open`).click();extra=await popup;await extra.waitForURL(/pdf\.html\?recent=/u);expect(new URL(extra.url()).searchParams.get('recent')).toBe(id);await expect(extra.locator('#file-input')).toBeAttached();
 }finally{await extra?.close();await reader.close();await options.close()}
}));
test('reuses the exact web source while preserving an unsaved local page draft',async()=>preserve(async()=>{
 const web=await context.newPage(),options=await context.newPage(),url='https://www.overleaf.com/project/pi-reading-navigation',webId=createHash('sha256').update(url).digest('hex').slice(0,32);try{
  await context.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reading source</title><p>Before</p><div style="height:1200px"></div><p id="quote">A saved research passage.</p><p>After</p><textarea aria-label="Draft"></textarea><div style="height:1000px"></div>'}));
  await worker().evaluate(async({url,webId})=>await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[webId]:[{markerId:'saved-web',pageUrl:url,anchor:{sourceText:'A saved research passage.',prefix:'Before',suffix:'After'},content:{sourceTitle:'Web reading source',originalText:'A saved research passage.',translatedText:'保留旧网页译文',note:'旧笔记保留'},createdAt:1,updatedAt:2}]}}),{url,webId});
  await web.goto(url);await expect(web.locator('#tex-selection-translator-root')).toBeAttached();const count=context.pages().length,before=await snapshot(),link=await originalLink(options);await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');expect(context.pages().length).toBe(count);await expect.poll(()=>web.evaluate(()=>scrollY)).toBeGreaterThan(400);
  await expect.poll(()=>web.locator('#quote').evaluate(node=>Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-innerHeight/2))).toBeLessThan(2);
  await web.getByRole('textbox',{name:'Draft',exact:true}).fill('尚未保存的网页草稿');await web.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await expect.poll(()=>web.evaluate(()=>scrollY)).toBe(0);await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');expect(context.pages().length).toBe(count);await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('尚未保存的网页草稿');expect(await web.evaluate(()=>scrollY)).toBe(0);expect(web.url()).toBe(url);expect((await snapshot()).piWebExcerptsV1).toEqual(before.piWebExcerptsV1);
 }finally{await web.close();await options.close();await context.unroute(url)}
}));
test('searches selected translated prose while excluding rendered formulas and preserving manual history',async()=>preserve(async()=>{
 const reader=await context.newPage();try{
  const formula=parseFormulaDocument({recognizedText:'Source {{m1}}',translation:'人工修正 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
  const saved={...record,blocks:[{...record.blocks[0],translatedText:formula.translationTemplate,formulaDocument:formula},record.blocks[1]]};
  await worker().evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),saved);
  const savedId=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(savedId)}`);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
  await select(reader,'人工修正','[data-translation-block]');await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('人工修正');await reader.keyboard.press('Escape');await reader.locator('#document-stage').focus();
  await reader.locator('.katex').first().evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection()!.removeAllRanges();getSelection()!.addRange(range)});await reader.keyboard.press('Control+f');await expect(reader.locator('#pdf-search-query')).toHaveValue('人工修正');expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual([saved]);
 }finally{await reader.close()}
}));
test('returns to a saved translation paragraph without requiring its original PDF',async()=>preserve(async()=>{
 const reader=await context.newPage();try{
  await worker().evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),record);
  const savedId=JSON.stringify(['pdf',record.documentKey,'zh-CN','auto','academic','auto']);await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(savedId)}`);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');
  const panel=reader.locator('#pdf-document-translation-pages');await panel.evaluate(n=>n.scrollTop=380);const before=await panel.evaluate(n=>n.scrollTop);await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-query').fill('阅读定位目标');await expect(reader.locator('.pdf-search-translation-current')).toBeAttached();await reader.keyboard.press('Escape');await reader.locator('#pdf-link-return').click();await expect.poll(()=>panel.evaluate((n,old)=>Math.abs(n.scrollTop-old),before)).toBeLessThan(3);expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual([record]);
 }finally{await reader.close()}
}));
test('keeps legacy filename-based notes on the explicit file verification path',async()=>preserve(async()=>{
 const reader=await context.newPage(),options=await context.newPage();let extra:Page|undefined;try{
  await reader.addInitScript(()=>document.addEventListener('change',event=>{const input=event.target;if(input instanceof HTMLInputElement&&input.id==='file-input'&&input.files?.[0]){const file=input.files[0];(globalThis as any).fixtureReadingIdentity=`local:${file.name}:${file.size}:${file.lastModified}`}},true));
  await open(reader);const identity=await reader.evaluate(()=>(globalThis as any).fixtureReadingIdentity);expect(typeof identity).toBe('string');const legacyId=createHash('sha256').update(identity).digest('hex').slice(0,32);
  await worker().evaluate(async({legacyId,note})=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[legacyId]:{annotations:[note],updatedAt:2}}}),{legacyId,note});
  const count=context.pages().length,link=await originalLink(options),opening=options.waitForEvent('popup');await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');await expect.poll(()=>context.pages().length).toBe(count+1);extra=await opening;await extra.waitForURL(/pdf\.html\?excerpt=/u);await expect(extra.locator('.pdf-excerpt-source-preview')).toContainText('旧笔记保留');await expect(reader.locator('#pdf-link-return')).toBeHidden();
 }finally{await extra?.close();await reader.close();await options.close()}
}));
test('restores the horizontally panned source after looking up and panning a search result',async({},info)=>preserve(async()=>{
 const reader=await context.newPage();try{
  await reader.setViewportSize({width:360,height:800});await open(reader);const stage=reader.locator('#document-stage');await stage.evaluate(n=>n.scrollLeft=180);const left=await stage.evaluate(n=>n.scrollLeft);expect(left).toBeGreaterThan(100);
  await reader.keyboard.press('Control+f');await reader.locator('#pdf-search-query').fill('Beta');await expect(reader.locator('#page-number')).toHaveValue('2');await reader.keyboard.press('Escape');await stage.evaluate(n=>n.scrollLeft=0);await reader.locator('#pdf-link-return').click();await expect(reader.locator('#page-number')).toHaveValue('1');await expect.poll(()=>stage.evaluate(n=>n.scrollLeft)).toBe(left);await reader.screenshot({path:info.outputPath('horizontal-reading-return-360.png')});
 }finally{await reader.close()}
}));

async function retainedCopy(run:()=>Promise<void>,corrupt=false){
 const previous=await worker().evaluate(async({id,fingerprint,bytes,corrupt})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('pi-original-pdfs-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('metadata',{keyPath:'id'});r.result.createObjectStore('files')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  try{return await new Promise<any>((resolve,reject)=>{const tx=db.transaction(['metadata','files'],'readwrite'),meta=tx.objectStore('metadata'),files=tx.objectStore('files'),m=meta.get(id),f=files.get(id);let previous:any;
   f.onsuccess=()=>{previous={metadata:m.result,bytes:f.result?Array.from(new Uint8Array(f.result)):undefined};const data=new Uint8Array(bytes);if(corrupt)data[data.length-1]=data[data.length-1]!^1;meta.put({id,fingerprint,name:'Locally retained.pdf',size:data.length,savedAt:3});files.put(data.buffer,id)};
   tx.oncomplete=()=>resolve(previous);tx.onabort=()=>reject(tx.error);
  })}finally{db.close()}
 },{id,fingerprint,bytes:[...pdf],corrupt});
 try{await run()}finally{await worker().evaluate(async({id,previous})=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('pi-original-pdfs-v1',1);r.onsuccess=()=>resolve(r.result)});try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['metadata','files'],'readwrite');if(previous.metadata){tx.objectStore('metadata').put(previous.metadata);tx.objectStore('files').put(new Uint8Array(previous.bytes).buffer,id)}else{tx.objectStore('metadata').delete(id);tx.objectStore('files').delete(id)}tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)})}finally{db.close()}},{id,previous})}
}
async function savedPdfNote(documentId=id){await worker().evaluate(async({documentId,note,record})=>await(globalThis as any).chrome.storage.local.set({piPdfReadingAnnotationsV1:{[documentId]:{annotations:[note],updatedAt:2}},pdfDocumentTranslationRetainedV1:[record]}),{documentId,note,record});return JSON.stringify(['pdf-note',documentId,note.id])}

test('opens a retained local original directly from a note without asking for the file',async({},info)=>preserve(async()=>retainedCopy(async()=>{
 const reader=await context.newPage(),calls=textRequests.length+visionRequests.length;try{
  const excerpt=await savedPdfNote(),before=await snapshot();await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(excerpt)}`);
  await expect(reader.locator('#page-number')).toHaveValue('2');await expect(reader.locator('.region-source-highlight')).toBeAttached();await expect(reader.locator('#empty-state')).toBeHidden();expect(new URL(reader.url()).searchParams.has('excerpt')).toBe(false);
  expect((await snapshot()).piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1);expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual(before.pdfDocumentTranslationRetainedV1);expect(textRequests.length+visionRequests.length).toBe(calls);await reader.screenshot({path:info.outputPath('note-local-copy-open.png')});
 }finally{await reader.close()}
})));
for(const mode of ['missing','corrupt','legacy'] as const)test(`retains manual note location when the local original is ${mode}`,async()=>preserve(async()=>{
 const run=async()=>{const reader=await context.newPage();try{
  const excerpt=await savedPdfNote(mode==='legacy'?'b'.repeat(32):id),before=await snapshot();await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(excerpt)}`);await expect(reader.locator('.pdf-excerpt-source-preview')).toContainText('旧笔记保留');await expect(reader.locator('#empty-open')).toBeEnabled();await expect(reader.locator('.pdf-page')).toHaveCount(0);
  if(mode==='corrupt')await expect(reader.locator('#notice')).toContainText('本机 PDF 副本内容不符');
  if(mode!=='legacy'){await reader.locator('#file-input').setInputFiles({name:'Renamed original.pdf',mimeType:'application/pdf',buffer:pdf});await expect(reader.locator('#page-number')).toHaveValue('2')}
  expect((await snapshot()).piPdfReadingAnnotationsV1).toEqual(before.piPdfReadingAnnotationsV1);expect((await snapshot()).pdfDocumentTranslationRetainedV1).toEqual(before.pdfDocumentTranslationRetainedV1);
 }finally{await reader.close()}};
 if(mode==='missing')await run();else await retainedCopy(run,mode==='corrupt');
}));
for(const nested of [false,true])test(`returns to web reading after source lookup with draft and route protection (${nested?'nested':'page'} scrolling)`,async({},info)=>preserve(async()=>{
 const web=await context.newPage(),options=await context.newPage(),url='https://www.overleaf.com/project/pi-source-return-'+nested,webId=createHash('sha256').update(url).digest('hex').slice(0,32),calls=textRequests.length+visionRequests.length;
 try{
  await context.route(url,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Reading return</title><style>body{margin:0}#scroller{${nested?'height:600px;overflow:auto;':''}}</style><div id="scroller"><p>Before</p><div style="height:1500px"></div><p id="quote">A saved research passage.</p><p>After</p><div style="height:1200px"></div></div><textarea aria-label="Draft" style="position:fixed;top:4px;left:4px"></textarea>`}));
  await worker().evaluate(async({url,webId})=>await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[webId]:[{markerId:'saved-web',pageUrl:url,anchor:{sourceText:'A saved research passage.',prefix:'Before',suffix:'After'},content:{sourceTitle:'Web reading source',originalText:'A saved research passage.',translatedText:'保留旧网页译文',note:'旧笔记保留'},createdAt:1,updatedAt:2}]}}),{url,webId});
  await web.goto(url);await expect(web.locator('#tex-selection-translator-root')).toBeAttached();
  const position=()=>web.evaluate(nested=>nested?document.querySelector('#scroller')!.scrollTop:scrollY,nested);
  await web.evaluate(nested=>{if(nested)document.querySelector('#scroller')!.scrollTop=180;else scrollTo({top:180,behavior:'instant'})},nested);const start=await position(),before=await snapshot(),link=await originalLink(options),root=web.locator('#tex-selection-translator-root'),back=root.locator('.source-reading-back');
  await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');await expect.poll(position).toBeGreaterThan(800);await expect(back).toBeVisible();
  await expect.poll(()=>web.locator('#quote').evaluate((node,nested)=>{const container=nested?document.querySelector('#scroller')!.getBoundingClientRect():{top:0,height:innerHeight};return Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-container.top-container.height/2)},nested)).toBeLessThan(2);
  const settled=()=>expect.poll(()=>web.locator('#quote').evaluate((node,nested)=>{const container=nested?document.querySelector('#scroller')!.getBoundingClientRect():{top:0,height:innerHeight};return Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-container.top-container.height/2)},nested)).toBeLessThan(2);
  // Repeated source lookups retain the initial reading point.
  await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');await back.click();await expect.poll(position).toBe(start);await expect(back).toHaveCount(0);
  await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');await expect.poll(position).toBeGreaterThan(800);await settled();await web.getByRole('textbox',{name:'Draft',exact:true}).fill('尚未保存的草稿');const draftPosition=await position();await back.click();expect(await position()).toBe(draftPosition);await expect(back).toBeVisible();await expect(root.locator('.source-reading-return [role="status"]')).toContainText('请先保存');await expect(root.locator('.source-reading-status')).toBeVisible();await expect(web.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('尚未保存的草稿');
  await web.getByRole('textbox',{name:'Draft',exact:true}).fill('');await back.click();await expect.poll(position).toBe(start);
  await web.setViewportSize({width:360,height:800});await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');await expect(back).toBeVisible();await settled();await web.screenshot({path:info.outputPath(`web-reading-return-${nested}-360.png`)});const box=await root.locator('.source-reading-return').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);
  await web.evaluate(()=>history.pushState(null,'','#different-route'));const changed=await position();await back.click();await expect(back).toHaveCount(0);expect(await position()).toBe(changed);expect((await snapshot()).piWebExcerptsV1).toEqual(before.piWebExcerptsV1);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await web.close();await options.close();await context.unroute(url)}
}));

for(const gate of ['digest','prefix'] as const)test(`does not replace a manually opened PDF when the retained original finishes reading later (${gate})`,async()=>preserve(async()=>retainedCopy(async()=>{
 const reader=await context.newPage();try{
  const excerpt=await savedPdfNote();await reader.addInitScript(gate=>{let held=false;const hold=async()=>{if(!held){held=true;(globalThis as any).copyReadPending=true;await new Promise<void>(resolve=>(globalThis as any).releaseCopyRead=resolve)}};if(gate==='digest'){const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args:Parameters<SubtleCrypto['digest']>)=>{await hold();return digest(...args)}}else{const read=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=async function(){await hold();return read.call(this)}}},gate);
  await reader.goto(`chrome-extension://${extensionId}/pdf.html?excerpt=${encodeURIComponent(excerpt)}`);await expect.poll(()=>reader.evaluate(()=>(globalThis as any).copyReadPending)).toBe(true);
  await reader.locator('#file-input').setInputFiles({name:'My next paper.pdf',mimeType:'application/pdf',buffer:createTwoPageTextPdf('Different paper opened by the user.','New second page.')});await expect(reader.locator('.textLayer')).toContainText(['Different paper opened by the user.']);
  await reader.evaluate(()=>(globalThis as any).releaseCopyRead());await expect(reader.locator('#document-name')).toHaveText('My next paper.pdf');await expect(reader.locator('.textLayer').first()).toContainText('Different paper opened by the user.');await expect(reader.locator('.region-source-highlight')).toHaveCount(0);
 }finally{await reader.close()}
})));
test('keeps an open web note editor when navigating its source, and offers a dismissible return in English dark narrow layout',async({},info)=>preserve(async()=>{
 const web=await context.newPage(),options=await context.newPage(),url='https://www.overleaf.com/project/pi-editor-return',webId=createHash('sha256').update(url).digest('hex').slice(0,32),calls=textRequests.length+visionRequests.length;
 try{
  await context.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Reading editor</title><style>html,body{background:#171717;color:#eee;color-scheme:dark}body{margin:0}</style><p>Before</p><div style="height:1500px"></div><p id="quote">A saved research passage.</p><p>After</p><div style="height:1200px"></div>'}));
  await worker().evaluate(async({url,webId})=>await(globalThis as any).chrome.storage.local.set({piWebExcerptsV1:{[webId]:[{markerId:'saved-web',pageUrl:url,anchor:{sourceText:'A saved research passage.',prefix:'Before',suffix:'After'},content:{sourceTitle:'Web reading source',originalText:'A saved research passage.',translatedText:'保留旧网页译文',note:'旧笔记保留'},createdAt:1,updatedAt:2}]}}),{url,webId});
  await web.goto(url);await expect(web.locator('#tex-selection-translator-root')).toBeAttached();await worker().evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({})).find((tab:any)=>tab.url===url);await c.tabs.sendMessage(tab.id,{type:'OPEN_SIDEBAR'})},url);
  const root=web.locator('#tex-selection-translator-root');await root.locator('details.more > summary').click();await root.getByRole('button',{name:/查看本文标记/}).click();
  await root.locator('.marker-note-more > summary').click();await root.getByRole('button',{name:'编辑这条标记的出处和笔记'}).click();const draft=root.getByRole('textbox',{name:'个人笔记（可选）'});await draft.fill('尚未保存的笔记草稿');const position=await web.evaluate(()=>scrollY),before=await snapshot();await root.locator('.marker-note-main').click();await expect(draft).toHaveValue('尚未保存的笔记草稿');expect(await web.evaluate(()=>scrollY)).toBe(position);await expect(root.locator('.source-reading-back')).toHaveCount(0);expect((await snapshot()).piWebExcerptsV1).toEqual(before.piWebExcerptsV1);
  // Cancel using the existing editor action, then use the same navigation entry.
  await root.locator('.excerpt-citation-editor').getByRole('button',{name:'取消编辑出处',exact:true}).click();await root.locator('.marker-note-main').click();await expect(root.locator('.source-reading-back')).toBeVisible();await expect.poll(()=>web.locator('#quote').evaluate(node=>Math.abs(node.getBoundingClientRect().top+node.clientHeight/2-innerHeight/2))).toBeLessThan(2);
  await root.locator('.source-reading-dismiss').click();await expect(root.locator('.source-reading-back')).toHaveCount(0);
  await worker().evaluate(async()=>await(globalThis as any).chrome.storage.local.set({uiLanguagePreference:'en'}));await web.setViewportSize({width:300,height:480});await web.reload();await expect(root).toBeAttached();const link=await originalLink(options);await link.click();await expect(link).not.toHaveAttribute('aria-busy','true');const back=root.locator('.source-reading-back');await expect(back).toHaveText('← Back to reading position');await expect(root).toHaveAttribute('data-pi-theme','dark');await web.screenshot({path:info.outputPath('return-english-dark-300.png')});const box=await root.locator('.source-reading-return').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(300);await back.focus();await web.keyboard.press('Enter');await expect(back).toHaveCount(0);expect((await snapshot()).piWebExcerptsV1).toEqual(before.piWebExcerptsV1);expect(textRequests.length+visionRequests.length).toBe(calls);
 }finally{await web.close();await options.close();await context.unroute(url)}
}));
