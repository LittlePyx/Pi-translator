import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {context,createCaptionedTableAndTextPdf,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {readLocalPdfLayout} from '../support/local-pdf-layout';
import {pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();

test('positions a short-window disclosure before native toggle observers can see its panel',async({},info)=>{
  const target=await context.newPage(),sender=await context.newPage();
  try{
    await target.addInitScript(()=>{(globalThis as any).menuObservations=[];document.addEventListener('toggle',event=>{
      const menu=event.target;if(!(menu instanceof HTMLDetailsElement)||menu.id!=='panel-more'||!menu.open)return;
      const panel=menu.querySelector<HTMLElement>(':scope > div')!;(globalThis as any).menuObservations.push({position:panel.style.position,bounds:panel.getBoundingClientRect().toJSON()});
    },true)});
    await target.setViewportSize({width:300,height:420});await target.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sender.goto(`chrome-extension://${extensionId}/popup.html`);
    await sender.evaluate(async()=>{const c=(globalThis as any).chrome;await c.runtime.sendMessage({type:'PDF_SIDE_PANEL_SESSION_UPDATED',payload:{tabId:(await c.tabs.getCurrent()).id,startedAt:Date.now(),requestId:'research-menu',sourceText:'Research reading context',targetLanguage:'zh-CN',pageUrl:'https://www.overleaf.com/demonstration.pdf',sourceLabel:'演示论文',status:'complete',result:{requestId:'research-menu',originalText:'Research reading context',translatedText:'演示译文，用于检查菜单位置。',warnings:[],latencyMs:1,completedAt:Date.now()}}})});
    await expect(target.locator('#session')).toBeVisible();await target.locator('#panel-more > summary').click();
    await expect.poll(()=>target.evaluate(()=>(globalThis as any).menuObservations.length)).toBeGreaterThan(0);
    const observations=await target.evaluate(()=>(globalThis as any).menuObservations);
    await writeFile(info.outputPath('menu-observations.json'),JSON.stringify(observations,null,2));
    for(const item of observations){expect(item.position).toBe('fixed');expect(item.bounds.x).toBeGreaterThanOrEqual(0);expect(item.bounds.y).toBeGreaterThanOrEqual(0);expect(item.bounds.right).toBeLessThanOrEqual(301);expect(item.bounds.bottom).toBeLessThanOrEqual(421)}
    await target.screenshot({path:info.outputPath('short-menu.png')});await target.keyboard.press('Escape');await expect(target.locator('#panel-more')).not.toHaveAttribute('open');await expect(target.locator('#panel-more > summary')).toBeFocused();
    await target.locator('#panel-more > summary').press('Enter');await expect(target.locator('#panel-more')).toHaveAttribute('open');
  }finally{await target.close();await sender.close()}
});

test('resolves a translated table reference using the original local PDF caption without translating again',async({},info)=>{
  const worker=context.serviceWorkers()[0]!,reader=await context.newPage(),file=info.outputPath('table-reference.pdf');
  const buffer=createCaptionedTableAndTextPdf('Table 1. Demonstration results',[['Model','PSNR','Time'],['ISTA-Net','31.53','0.039 s'],['ISTA-Net+','32.57','0.047 s']],'We compare the methods in Table 1. This paragraph explains the experimental results.');await writeFile(file,buffer);
  const prepared=await readLocalPdfLayout(file);expect(prepared.blocks.filter(b=>b.kind==='table')).toHaveLength(1);
  const signatures=prepared.blocks.map(b=>pdfDocumentTranslationSessionBlockSignature(b.pageNumber,b.text,0));
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('research-table'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('e2e-model'),documentSignatures:signatures,activity:'complete',sourceFingerprint:createHash('sha256').update(buffer).digest('hex'),updatedAt:Date.now(),blocks:prepared.blocks.map((b,i)=>({signature:signatures[i],pageNumber:b.pageNumber,translatedText:b.kind==='table'?'表 1. 演示结果\n\n| 模型 | PSNR | 时间 |\n| --- | --- | --- |\n| ISTA-Net | 31.53 | 0.039 s |\n| ISTA-Net+ | 32.57 | 0.047 s |':'我们在表 1 中比较不同方法，本段说明实验结果及其比较条件。'}))};
  const keys=['pdfDocumentTranslationRetainedV1'],old=await worker.evaluate(async keys=>await(globalThis as any).chrome.storage.local.get(keys),keys);
  try{
    await worker.evaluate(async record=>{const s=(globalThis as any).chrome.storage;await s.session.remove('pdfDocumentTranslationSessionsV1');await s.local.set({pdfDocumentTranslationRetainedV1:[record]})},record);
    const id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);await reader.goto(`chrome-extension://${extensionId}/pdf.html?restore=${encodeURIComponent(id)}`);await reader.locator('#file-input').setInputFiles(file);await expect(reader.locator('#pdf-document-translation')).toHaveAttribute('data-phase','complete');await reader.locator('#pdf-document-translation-view-reading').click();
    const reference=reader.locator('.pdf-research-reference');await expect(reference).toHaveCount(1);await expect(reference).toHaveText('表 1');const calls=textRequests.length+visionRequests.length;await reference.click();await expect(reader.locator('.pdf-research-destination')).toHaveAttribute('data-object-role','table');await expect(reader.locator('.pdf-research-destination table')).toBeVisible();await reader.screenshot({path:info.outputPath('table-destination.png')});await reader.locator('#pdf-research-return').click();await expect(reference).toBeFocused();expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await reader.close();await worker.evaluate(async({keys,old})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set(old)},{keys,old})}
});

test('jumps from a saved paper reference to its bound equation and returns to the same reading position without requests',async({},info)=>{
  const worker=context.serviceWorkers()[0]!,reader=await context.newPage();
  const signatures=['Context','Equation'].map((text,i)=>pdfDocumentTranslationSessionBlockSignature(i+1,text,0));
  const formulaDocument={version:1,sourceTemplate:'{{m1}}',translationTemplate:'{{m1}}',formulas:[{id:'m1',latex:'E=mc^2',display:true,sourceEquationId:'eq-p2-x90-y200',equationNumber:'15'}],issues:[]};
  const record={documentKey:pdfDocumentTranslationSessionDocumentKey('research-navigation'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('e2e-model'),documentSignatures:signatures,activity:'complete',updatedAt:Date.now(),blocks:[{signature:signatures[0],pageNumber:1,translatedText:'参见式（15）所示。未确认的式（99）保持普通文字。\n\n'+('这是用于检查连续阅读位置的演示内容。'.repeat(180))},{signature:signatures[1],pageNumber:2,translatedText:'公式结果',formulaDocument}]};
  const old=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1'));
  try{
    await worker.evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),record);
    const id=JSON.stringify(['pdf',record.documentKey,record.targetLanguage,record.sourceLanguage,record.style,record.contentMode]);
    await reader.setViewportSize({width:1000,height:780});await reader.goto(`chrome-extension://${extensionId}/pdf.html?library=${encodeURIComponent(id)}`);
    const reference=reader.locator('.pdf-research-reference');await expect(reference).toHaveCount(1);await expect(reference).toHaveText('式（15）');await expect(reader.locator('#pdf-research-return')).toBeHidden();
    expect(await reference.evaluate(el=>getComputedStyle(el).fontSize===getComputedStyle(el.parentElement!).fontSize&&getComputedStyle(el).lineHeight===getComputedStyle(el.parentElement!).lineHeight)).toBe(true);
    const pages=reader.locator('#pdf-document-translation-pages');const before=await pages.evaluate(el=>el.scrollTop);const calls=textRequests.length+visionRequests.length;
    await reference.focus();await reference.press('Enter');await expect(reader.locator('.pdf-research-destination')).toHaveCount(1);await expect(reader.locator('#pdf-research-return')).toBeVisible();
    expect(await pages.evaluate(el=>el.scrollTop)).toBeGreaterThan(before+100);await expect(reader.locator('.pi-equation-tag')).toHaveText('(15)');await reader.screenshot({path:info.outputPath('equation-destination.png')});
    await reader.locator('#pdf-research-return').click();await expect(reader.locator('#pdf-research-return')).toBeHidden();expect(Math.abs(await pages.evaluate(el=>el.scrollTop)-before)).toBeLessThanOrEqual(1);await expect(reference).toBeFocused();
    await reader.setViewportSize({width:360,height:780});await reader.emulateMedia({colorScheme:'dark'});await reference.click();await reader.screenshot({path:info.outputPath('equation-destination-dark.png')});expect(await reader.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await reader.locator('#pdf-research-return').click();expect(textRequests.length+visionRequests.length).toBe(calls);
    const after=await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('pdfDocumentTranslationRetainedV1')).pdfDocumentTranslationRetainedV1[0]);expect(after.blocks).toEqual(record.blocks);
  }finally{await reader.close();await worker.evaluate(async old=>await(globalThis as any).chrome.storage.local.set(old),old)}
});

test('reads PDF and web excerpts together, edits guarded notes and exports the selected sources with provenance',async({},info)=>{
  const worker=context.serviceWorkers()[0]!,options=await context.newPage(),webUrl='https://example.org/research';
  const documentId=createHash('sha256').update('research-excerpt-pdf').digest('hex').slice(0,32),webId=createHash('sha256').update(webUrl).digest('hex').slice(0,32);
  const marker={markerId:'same-id',anchor:{kind:'text-quote',pageNumber:3,sourceText:'Energy $E=mc^2$',prefix:'',suffix:''},content:{sourceTitle:'演示论文',originalText:'Energy $E=mc^2$',translatedText:'演示能量 $E=mc^2$',pageNumber:3,note:'PDF 阅读笔记'},createdAt:1};
  const keys=['piPdfTranslationMarkersV1','piWebExcerptsV1'];const old=await worker.evaluate(async keys=>await(globalThis as any).chrome.storage.local.get(keys),keys);
  try{
    await worker.evaluate(async({documentId,webId,webUrl,marker})=>await(globalThis as any).chrome.storage.local.set({piPdfTranslationMarkersV1:{[documentId]:{enabled:true,markers:[marker],updatedAt:20}},piWebExcerptsV1:{[webId]:[{markerId:'same-id',pageUrl:webUrl,anchor:{sourceText:'Web source',prefix:'',suffix:''},content:{sourceTitle:'演示网页',originalText:'Web source',translatedText:'演示网页译文',note:'网页笔记'},createdAt:1,updatedAt:10}]}}),{documentId,webId,webUrl,marker});
    const calls=textRequests.length+visionRequests.length;
    await options.goto(`chrome-extension://${extensionId}/options.html#storage`);await options.locator('#web-excerpts-library > summary').click();const rows=options.locator('.saved-web-excerpt');await expect(rows).toHaveCount(2);
    await options.locator('#research-excerpts-kind').selectOption('pdf');await expect(rows).toHaveCount(1);await expect(rows).toContainText('第 3 页');await rows.locator('.saved-web-excerpt-content > summary').click();await rows.getByRole('button',{name:'编辑笔记与出处'}).click();
    let editor=rows.locator('form');await editor.getByLabel('个人笔记').fill('已确认的实验笔记');await editor.getByLabel('DOI（可选）').fill('10.1000/demo');await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor).toHaveCount(0);await expect(rows).toContainText('已确认的实验笔记');
    const saved=await worker.evaluate(async documentId=>(await(globalThis as any).chrome.storage.local.get('piPdfTranslationMarkersV1')).piPdfTranslationMarkersV1[documentId].markers[0],documentId);expect(saved.anchor).toEqual(marker.anchor);expect(saved.content.translatedText).toBe(marker.content.translatedText);expect(saved.content.originalText).toBe(marker.content.originalText);
    await rows.getByRole('button',{name:'编辑笔记与出处'}).click();editor=rows.locator('form');await editor.getByLabel('个人笔记').fill('尚未保存的草稿');
    await worker.evaluate(async documentId=>{const s=(globalThis as any).chrome.storage.local,stored=await s.get('piPdfTranslationMarkersV1');stored.piPdfTranslationMarkersV1[documentId].markers[0].content.note='其他窗口的新笔记';await s.set(stored)},documentId);
    await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor).toContainText('其他窗口');await expect(editor.getByLabel('个人笔记')).toHaveValue('尚未保存的草稿');await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(rows).toContainText('其他窗口的新笔记');
    await options.locator('#research-excerpts-kind').selectOption('all');await options.locator('#web-excerpts-search').fill('笔记');await expect(rows).toHaveCount(2);
    await options.locator('#library-storage-tools > summary').click();let downloading=options.waitForEvent('download');await options.locator('#export-web-excerpts').click();const file=info.outputPath('research-notes.md');await(await downloading).saveAs(file);const markdown=await readFile(file,'utf8');for(const text of ['第 3 页','其他窗口的新笔记','10.1000/demo','$E=mc^2$','网页笔记',webUrl])expect(markdown).toContain(text);
    await options.locator('#research-excerpts-kind').selectOption('web');await expect(rows).toHaveCount(1);await options.locator('#library-storage-tools > summary').click();downloading=options.waitForEvent('download');await options.locator('#export-web-excerpts').click();const webFile=info.outputPath('web-only.md');await(await downloading).saveAs(webFile);expect(await readFile(webFile,'utf8')).not.toContain('第 3 页');
    await options.locator('#research-excerpts-kind').selectOption('all');await options.setViewportSize({width:300,height:800});await options.emulateMedia({colorScheme:'dark'});await options.locator('#web-excerpts-library').scrollIntoViewIfNeeded();expect(await options.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await options.screenshot({path:info.outputPath('research-excerpts-dark.png')});expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await options.close();await worker.evaluate(async({keys,old})=>{const s=(globalThis as any).chrome.storage.local;await s.remove(keys);await s.set(old)},{keys,old})}
});
