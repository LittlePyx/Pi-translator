import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';
import {context,extensionId,installEdgeExtensionHooks,createTwoPageTextPdf,test,expect,textRequests,visionRequests} from './support/edge-extension-fixture';
import {parseFormulaDocument} from '../../core/translation/formula-document';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();
const memoryKey='documentTranslationMemoryV1';
async function preserve(){const w=context.serviceWorkers()[0]!,saved=await w.evaluate(async()=>{const s=(globalThis as any).chrome.storage;return{local:await s.local.get(null),session:await s.session.get(null)}});return()=>w.evaluate(async saved=>{const s=(globalThis as any).chrome.storage;await s.local.clear();await s.session.clear();await s.local.set(saved.local);await s.session.set(saved.session)},saved)}
function paper(name:string,manual=false){
 const texts=['The kernel describes the sample.','The calibration describes observations.'],buffer=createTwoPageTextPdf(...texts as [string,string]);
 const signatures=texts.map((text,i)=>pdfDocumentTranslationSessionBlockSignature(i+1,text,0));
 const formula=parseFormulaDocument({recognizedText:'{{m1}}',translation:'演示文本：内核描述样本 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
 const record={documentKey:pdfDocumentTranslationSessionDocumentKey(name),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:Date.now(),behaviorKey:pdfDocumentTranslationSessionBehaviorKey('old'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:signatures,scopeSignatures:signatures,preservedSignatures:[],blocks:[{signature:signatures[0],pageNumber:1,translatedText:formula.translationTemplate,formulaDocument:formula,revisions:[{id:'revision-demo',createdAt:1,reason:'correction',translatedText:'旧历史译文'}]},{signature:signatures[1],pageNumber:2,translatedText:'人工修正的校准说明。',...(manual?{manualCorrection:true}:{})}]};
 return {record,buffer,name,file:undefined as string|undefined};
}
async function open(reader:Page,p:ReturnType<typeof paper>){const id=JSON.stringify(['pdf',p.record.documentKey,'zh-CN','auto','academic','auto']);await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles(p.file??{name:p.name,mimeType:'application/pdf',buffer:p.buffer});await expect(reader.locator('.pdf-page[data-page-number="1"]')).toHaveAttribute('data-rendered','ready',{timeout:30000});await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await reader.locator('#pdf-document-translation-copy-menu > summary').click();await reader.locator('#pdf-document-terms').click()}
async function add(reader:Page,source:string,target:string){const manage=reader.locator('#pdf-terms-manage');if(!await manage.evaluate((e:HTMLDetailsElement)=>e.open))await manage.locator('summary').first().click();await reader.locator('#pdf-term-source').fill(source);await reader.locator('#pdf-term-target').fill(target);await reader.locator('#pdf-terms-add button').click();await expect(reader.locator('#pdf-term-source')).toHaveValue('')}

test('explicitly reuses confirmed paper terms with provenance, preserves all old paragraphs and restores evidence from backup',async({},info)=>{
 test.setTimeout(120000);const restore=await preserve(),worker=context.serviceWorkers()[0]!,reader=await context.newPage(),options=await context.newPage();
 const a=paper('演示文本-来源A.pdf'),b=paper('演示文本-目标B.pdf',true);
 // Give B distinct source content while keeping its first two natural-language anchors.
 b.buffer=createTwoPageTextPdf('The kernel describes the sample in paper B.','The calibration describes observations in paper B.');b.record.sourceFingerprint=createHash('sha256').update(b.buffer).digest('hex');b.record.documentSignatures=['The kernel describes the sample in paper B.','The calibration describes observations in paper B.'].map((t,i)=>pdfDocumentTranslationSessionBlockSignature(i+1,t,0));b.record.scopeSignatures=[...b.record.documentSignatures];b.record.blocks.forEach((block,i)=>block.signature=b.record.documentSignatures[i]!);
 const readMemory=()=>worker.evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key))[key]??{},memoryKey);
 try{
  a.file=info.outputPath(a.name);b.file=info.outputPath(b.name);await writeFile(a.file,a.buffer);await writeFile(b.file,b.buffer);
  await worker.evaluate(async({records,key})=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:records,[key]:{}})},{records:[a.record,b.record],key:memoryKey});
  await open(reader,a);await add(reader,'kernel','核函数');await add(reader,'calibration','标定');
  const sourceMemory=Object.values(await readMemory()).find((m:any)=>m.confirmedTerms.some((t:any)=>t.source==='kernel')) as any;
  expect(sourceMemory.confirmedTerms.find((t:any)=>t.source==='kernel').provenance.origin).toMatchObject({title:a.name,pageNumber:1});
  await reader.locator('#pdf-terms-close').click();await open(reader,b);await add(reader,'calibration','本文人工约定');
  const before=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1);
  const requestCount=textRequests.length+visionRequests.length;
  await expect(reader.locator('#pdf-term-reuse')).not.toHaveAttribute('open');await reader.locator('#pdf-term-reuse > summary').click();await reader.locator('#pdf-term-reuse-source').selectOption(sourceMemory.documentId);
  const kernel=reader.locator('.pdf-term-reuse-row').filter({hasText:'kernel → 核函数'}),conflict=reader.locator('.pdf-term-reuse-row').filter({hasText:'calibration → 标定'});
  await expect(kernel).toContainText(a.name);await expect(kernel).toContainText('第 1 页');await expect(conflict.locator('input')).toBeDisabled();await expect(conflict).toContainText('冲突');
  await kernel.locator('input').check();await expect(reader.locator('#pdf-term-reuse-apply')).toBeDisabled();await reader.locator('#pdf-term-reuse-confirm').check();
  for(const [width,scheme] of [[1100,'light'],[360,'dark'],[300,'light']] as const){await reader.setViewportSize({width,height:800});await reader.emulateMedia({colorScheme:scheme});expect(await reader.locator('#pdf-terms-dialog').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await reader.screenshot({path:info.outputPath(`reuse-${width}-${scheme}.png`)})}
  await reader.locator('#pdf-term-reuse-apply').click();await expect(reader.locator('#pdf-term-reuse-status')).toContainText('旧译文未改变');
  const memories=await readMemory(),destination=Object.values(memories).find((m:any)=>m.documentId!==sourceMemory.documentId&&m.confirmedTerms.some((t:any)=>t.source==='kernel')) as any;
  const reused=destination.confirmedTerms.find((t:any)=>t.source==='kernel');expect(reused.provenance).toMatchObject({origin:{title:a.name,pageNumber:1},confirmed:{title:b.name,targetLanguage:'zh-CN'},via:{documentId:sourceMemory.documentId}});
  expect(memories[sourceMemory.documentId]).toEqual(sourceMemory);expect(await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1)).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(requestCount);
  await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#library-storage-tools > summary').click();const download=options.waitForEvent('download');await options.locator('#export-library-backup').click();await(await download).saveAs(info.outputPath('term-source-backup.json'));
  const backup=JSON.parse(await readFile(info.outputPath('term-source-backup.json'),'utf8'));expect(backup.documentTerms[destination.documentId].confirmedTerms.find((t:any)=>t.source==='kernel').provenance).toEqual(reused.provenance);
  await reader.locator('#pdf-terms-close').click();await reader.goto('about:blank');
  await worker.evaluate(async({key,id})=>{const s=(globalThis as any).chrome.storage.local,m=(await s.get(key))[key];delete m[id];await s.set({[key]:m})},{key:memoryKey,id:destination.documentId});
  await options.locator('#library-backup-input').setInputFiles(info.outputPath('term-source-backup.json'));await expect(options.locator('#retained-storage-action-status')).toContainText('未调用翻译接口');
  await open(reader,b);await reader.locator('#pdf-terms-manage > summary').click();const saved=reader.locator('#pdf-confirmed-terms-list details').filter({hasText:'kernel → 核函数'});await saved.locator('summary').click();await expect(saved).toContainText(a.name);await expect(saved).toContainText('本文确认');expect(textRequests.length+visionRequests.length).toBe(requestCount);
  // A deliberate local mocked request proves the existing prompt path uses wording only.
  const response=await reader.evaluate(async docId=>(globalThis as any).chrome.runtime.sendMessage({type:'TRANSLATE_SELECTION',payload:{requestId:'reuse-follow-up',documentId:docId,text:'The kernel describes a new sample.',pageUrl:'https://www.overleaf.com/term-reuse-new',targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'plain',bypassCache:true}}),destination.documentId);
  expect(response.ok).toBe(true);expect(textRequests.length+visionRequests.length).toBe(requestCount+1);const request=JSON.stringify(textRequests.at(-1));expect(request).toContain('核函数');expect(request).not.toContain(a.name);expect(request).not.toContain('provenance');
 }finally{await reader.close();await options.close();await restore()}
});

test('rejects stale source choices without overwriting paper wording, and requires renewed confirmation after refresh',async()=>{
 const restore=await preserve(),worker=context.serviceWorkers()[0]!,reader=await context.newPage(),p=paper('演示文本-冲突检查.pdf',true);
 const term={id:'term-old',source:'kernel',target:'核函数',createdAt:1,updatedAt:1};
 try{
  await worker.evaluate(async({record,key,term})=>{await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record],[key]:{'doc-old':{schemaVersion:1,documentId:'doc-old',label:'历史论文',updatedAt:1,confirmedTerms:[term],candidateTerms:[{id:'candidate',source:'not confirmed',target:'不可复用',createdAt:1}],recentTranslations:[],dismissedTermKeys:[]}}})},{record:p.record,key:memoryKey,term});
  await open(reader,p);const before=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);const requests=textRequests.length+visionRequests.length;await reader.locator('#pdf-term-reuse > summary').click();const row=reader.locator('.pdf-term-reuse-row');await expect(row).toHaveCount(1);await expect(row).toContainText('未记录语言');await row.locator('input').check();await reader.locator('#pdf-term-reuse-confirm').check();
  await worker.evaluate(async key=>{const s=(globalThis as any).chrome.storage.local,m=(await s.get(key))[key];m['doc-old'].confirmedTerms[0].target='来源后来修改';m['doc-old'].confirmedTerms[0].updatedAt=2;await s.set({[key]:m})},memoryKey);
  await reader.locator('#pdf-term-reuse-apply').click();await expect(reader.locator('#pdf-term-reuse-status')).toContainText('已变化');await expect(reader.locator('#pdf-term-reuse-confirm')).not.toBeChecked();
  await reader.locator('#pdf-term-reuse-refresh').click();await expect(row).toContainText('来源后来修改');await expect(reader.locator('#pdf-term-reuse-apply')).toBeDisabled();expect(textRequests.length+visionRequests.length).toBe(requests);
  const kept=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);expect(kept.blocks).toEqual(before.blocks);const memories=await worker.evaluate(async key=>(await(globalThis as any).chrome.storage.local.get(key))[key],memoryKey);expect(Object.keys(memories)).toEqual(['doc-old']);
 }finally{await reader.close();await restore()}
});
