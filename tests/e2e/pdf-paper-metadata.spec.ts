import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {readLocalPdfLayout} from '../support/local-pdf-layout';
import {createPaperMetadataPdf} from '../support/paper-metadata-pdf';
import {pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey,pdfDocumentTranslationSessionDocumentKey} from '../../core/pdf/document-translation-session';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();test.use({trace:'off'});

const libraryId=(record:any)=>JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
async function checkPaperView(reader:Page,screenshot:(name:string)=>string){
  await expect(reader.locator('[data-paper-role="title"] > h1')).toHaveCount(1);
  const authors=reader.locator('[data-paper-role="authors"]').first(),body=reader.locator('.pdf-document-translation-block:not([data-paper-role]):not([data-heading-level])').first();
  await expect(authors).toBeVisible();
  expect(await authors.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(await body.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)));
  const publication=reader.locator('.pdf-paper-publication').first();
  await expect(publication).not.toHaveAttribute('open','');
  await publication.locator('summary').focus();await reader.keyboard.press('Enter');await expect(publication).toHaveAttribute('open','');
  await expect(publication.locator('.pdf-paper-publication-content')).toBeVisible();
  await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-view-mode','reading');
  await reader.keyboard.press('Enter');
  await reader.locator('[data-paper-role="title"]').scrollIntoViewIfNeeded();await reader.mouse.move(0,0);
  await reader.screenshot({path:screenshot('reading-wide.png')});
  for(const width of [360,300]){
    await reader.setViewportSize({width,height:800});await reader.emulateMedia({colorScheme:'dark'});
    await reader.locator('[data-paper-role="title"]').scrollIntoViewIfNeeded();
    expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    expect(await authors.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await publication.locator('summary').click();await expect(publication.locator('.pdf-paper-publication-content')).toBeVisible();
    expect(await publication.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await reader.screenshot({path:screenshot(`publication-${width}-dark.png`)});await publication.locator('summary').click();
  }
  await reader.setViewportSize({width:1100,height:900});await reader.emulateMedia({colorScheme:'light'});
}
async function exportHtml(reader:Page,file:string){
  const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
  const pending=reader.waitForEvent('download');await reader.locator('#pdf-document-translation-download-html').click();await(await pending).saveAs(file);
  const html=await readFile(file,'utf8');expect(html).toContain('data-paper-role="title"');expect(html).toContain('data-paper-role="authors"');expect(html).toContain('data-paper-role="publication"');
  return html;
}

for(const originalOnly of [false,true])test(originalOnly?'keeps original-only author warnings visible instead of hiding them as metadata':'distinguishes paper metadata, folds low-frequency publication details and restores the same library view',async({},info)=>{
  test.setTimeout(120000);
  const buffer=createPaperMetadataPdf(),file=info.outputPath('demonstration.pdf');await writeFile(file,buffer);
  const prepared=await readLocalPdfLayout(file),blocks=prepared.blocks;
  expect(blocks.filter(b=>b.paperRole==='title')).toHaveLength(1);expect(blocks.some(b=>b.paperRole==='authors')).toBe(true);expect(blocks.filter(b=>b.paperRole==='publication')).toHaveLength(1);
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('paper-metadata-demonstration'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('mock'),sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),documentSignatures:blocks.map(b=>pdfDocumentTranslationSessionBlockSignature(b.pageNumber,b.text,0)),activity:'complete',updatedAt:Date.now(),blocks:blocks.map(b=>({signature:pdfDocumentTranslationSessionBlockSignature(b.pageNumber,b.text,0),translatedText:b.paperRole==='title'?'演示文本：学术文献阅读':b.paperRole==='authors'?(originalOnly?b.text:b.text.replace('Institute of Science, Demonstration University','科学研究所，演示大学')):b.paperRole==='publication'?'演示期刊 2024 · DOI: 10.1000/example':b.text==='1. Introduction'?'1. 引言':b.text==='Abstract'?'摘要':'这是用于版式验收的演示正文，作者信息与出版信息采用不同的排版。'}))};
  const worker=context.serviceWorkers()[0]!;await worker.evaluate(async record=>{const s=(globalThis as any).chrome.storage;await s.session.clear();await s.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
  let reader=await context.newPage();
  try{
    await reader.setViewportSize({width:1100,height:900});await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(libraryId(record))}`);
    await reader.locator('#file-input').setInputFiles(file);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await reader.locator('#pdf-document-translation-view-reading').click();
    await writeFile(info.outputPath('rendered.json'),JSON.stringify({source:blocks,rendered:await reader.locator('.pdf-document-translation-block').evaluateAll(nodes=>nodes.map(n=>({data:{...(n as HTMLElement).dataset},text:n.textContent})))},null,2));
    await reader.screenshot({path:info.outputPath('initial-reading.png')});
    if(originalOnly){
      const author=reader.locator(`[data-translation-block="${blocks.find(b=>b.paperRole==='authors')!.id}"]`);
      await expect(author).toContainText('未取得可靠译文');await expect(author).toContainText('模型返回内容与原文相同');await expect(author).not.toHaveAttribute('data-paper-role','authors');
      expect(textRequests.length+visionRequests.length).toBe(0);return;
    }
    await checkPaperView(reader,n=>info.outputPath(n));
    const html=await exportHtml(reader,info.outputPath('bilingual.html'));expect(html).toContain('DOI: 10.1000/example');
    await reader.close();reader=await context.newPage();await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(libraryId(record))}`);
    await expect(reader.locator('[data-paper-role="title"] > h1')).toHaveText('演示文本：学术文献阅读');await expect(reader.locator('.pdf-paper-publication')).toHaveCount(1);
    await expect(reader.locator('[data-paper-role="authors"]').first()).toContainText('Alice');
    expect(textRequests.length+visionRequests.length).toBe(0);
  }finally{await reader.close()}
});

test('reuses real saved paper translations with display-only roles and keeps all old formulas, corrections and archives',async({},info)=>{
  test.skip(!process.env.PI_METADATA_RESTORED,'Opt-in public paper with actual saved model outputs; provider blocked.');test.setTimeout(180000);
  const seed=JSON.parse(await readFile(process.env.PI_METADATA_RESTORED!,'utf8'));
  const worker=context.serviceWorkers()[0]!;let attempts=0;
  await context.route('https://dashscope.aliyuncs.com/**',r=>{attempts++;return r.abort()});
  await worker.evaluate(()=>{const g=globalThis as any,original=g.fetch.bind(g);g.metadataProviderAttempts=0;g.fetch=(...a:any[])=>{const url=typeof a[0]==='string'?a[0]:a[0]?.url??String(a[0]);if(new URL(url).hostname==='dashscope.aliyuncs.com'){g.metadataProviderAttempts++;throw Error('Provider blocked in display-only acceptance')}return original(...a)}});
  await worker.evaluate(async({seed,base,model})=>{const s=(globalThis as any).chrome.storage,stored=await s.local.get('extensionSettings');await s.local.set({...seed.local,extensionSettings:{...stored.extensionSettings,apiBaseUrl:base,model,visionModel:model,activeApiProfileId:'default',visionApiProfileId:'vision-e2e',apiProfiles:[{id:'default',name:'保存结果排版验收',apiBaseUrl:base,model},{id:'vision-e2e',name:'保存结果排版验收',apiBaseUrl:base,model}]}});await s.session.set({...seed.session,apiKeysByProfile:{default:'offline-no-credentials','vision-e2e':'offline-no-credentials'}})},{seed,base:process.env.QWEN_BASE_URL!,model:process.env.QWEN_MODEL!});
  const old=seed.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.sourceFingerprint.startsWith('f233'));
  let reader=await context.newPage(),preview:Page|undefined;
  try{
    await reader.setViewportSize({width:1100,height:900});await reader.goto(`chrome-extension://${extensionId}/pdf.html`);await reader.locator('#file-input').setInputFiles(path.resolve('output/pdf/number-fonts-2026-10-16/source/rezende15.pdf'));await reader.locator('#translate-document').click();await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await reader.locator('#pdf-document-translation-view-reading').click();
    await expect(reader.locator('.pdf-document-translation-block')).toHaveCount(101);await expect(reader.locator('.pi-equation-tag')).toHaveCount(20);
    await checkPaperView(reader,n=>info.outputPath(`actual-${n}`));
    const html=await exportHtml(reader,info.outputPath('actual-bilingual.html'));expect(html).toContain('2015');
    const menu=reader.locator('#pdf-document-translation-copy-menu');if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();const pending=context.waitForEvent('page');await reader.locator('#pdf-document-translation-print-layout').click();preview=await pending;await expect(preview.locator('body')).toHaveAttribute('data-pi-layout-ready','true',{timeout:90000});
    await expect(preview.locator('[data-paper-role="title"] h1')).toHaveCount(1);await expect(preview.locator('[data-paper-role="publication"]')).toContainText('2015');await expect(preview.locator('.pi-equation-tag')).toHaveCount(20);
    const overflow=await preview.locator('[data-layout-translation-page]').evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1).length);expect(overflow).toBe(0);
    await preview.locator('[data-layout-translation-page]').first().screenshot({path:info.outputPath('actual-print-first.png')});
    const cdp=await context.newCDPSession(preview),pdf=await cdp.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(info.outputPath('actual-bilingual.pdf'),Buffer.from(pdf.data,'base64'));await cdp.detach();await preview.close();preview=undefined;
    const snapshot=await worker.evaluate(async()=>{const s=(globalThis as any).chrome.storage;return{local:await s.local.get(['pdfDocumentTranslationRetainedV1','pdfDocumentTranslationFixedV1']),session:await s.session.get('pdfDocumentTranslationSessionsV1')}}) as any;
    const current=snapshot.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.documentKey===old.documentKey);
    const strip=(b:any)=>{const {paperRole:_,...value}=b;return value};
    await writeFile(info.outputPath('after-metadata.json'),JSON.stringify(snapshot,null,2));
    for(const before of seed.session.pdfDocumentTranslationSessionsV1){
      const after=snapshot.session.pdfDocumentTranslationSessionsV1.find((d:any)=>d.documentKey===before.documentKey);
      expect(after.documentSignatures).toEqual(before.documentSignatures);expect(after.blocks).toHaveLength(before.blocks.length);
      for(const block of before.blocks)expect(strip(after.blocks.find((b:any)=>b.signature===block.signature))).toEqual(strip(block));
      expect(after.archivedBlocks).toEqual(before.archivedBlocks);
    }
    expect(current.blocks.filter((b:any)=>b.paperRole).map((b:any)=>b.paperRole).sort()).toEqual(['authors','publication','title']);
    await reader.close();reader=await context.newPage();await reader.setViewportSize({width:1100,height:900});await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(libraryId(current))}`);await expect(reader.locator('[data-paper-role="title"] > h1')).toHaveCount(1);await expect(reader.locator('[data-paper-role="authors"]')).toHaveCount(1);await expect(reader.locator('.pdf-paper-publication')).toHaveCount(1);await reader.locator('[data-paper-role="title"]').scrollIntoViewIfNeeded();await reader.screenshot({path:info.outputPath('actual-library-reading.png')});
    expect(attempts).toBe(0);expect(await worker.evaluate(()=>(globalThis as any).metadataProviderAttempts)).toBe(0);
    await writeFile(info.outputPath('reopened.json'),JSON.stringify(snapshot,null,2));await writeFile(info.outputPath('report.json'),JSON.stringify({evidence:'Display-only replay of actual model outputs from the previous acceptance; no new provider calls.',providerAttempts:0,blocks:101,translatedRecords:current.blocks.length,archives:current.archivedBlocks?.length,roles:current.blocks.filter((b:any)=>b.paperRole).map((b:any)=>({signature:b.signature,role:b.paperRole})),allOldTranslationsFormulasCorrectionsUnchanged:true,oldNashUntouched:true,exportEquationTags:20,exportOverflow:overflow},null,2));
  }finally{await preview?.close();await reader.close()}
});
