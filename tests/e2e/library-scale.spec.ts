import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('measures a fixed thousand-note library without changing saved records',async({},info)=>{
  test.setTimeout(120_000);
  const worker=context.serviceWorkers()[0]!,options=await context.newPage();
  const before=await worker.evaluate(async()=>await(globalThis as any).chrome.storage.local.get(null));
  const calls=textRequests.length+visionRequests.length,records:Record<string,unknown>={};
  for(let p=0;p<10;p++){
    const url=`https://example.org/paper-${p}`,key=createHash('sha256').update(url).digest('hex').slice(0,32);
    records[key]=Array.from({length:100},(_,i)=>({markerId:`sample-${p}-${i}`,pageUrl:url,anchor:{sourceText:`Source paragraph ${p}-${i}.`,prefix:'',suffix:''},content:{sourceTitle:`Research paper ${p}`,originalText:`Source paragraph ${p}-${i}.`,translatedText:`完整译文 ${p}-${i}：保留结果与变量。`,note:`人工笔记 ${p}-${i} ${p===9&&i===99?'uniqueneedle':'common'}`},createdAt:1,updatedAt:p*100+i+1}));
  }
  const measurements:any={evidence:'Synthetic bounded library, no model calls',count:1000,searches:[]};
  try{
    await options.addInitScript(()=>{
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'className')!;
      (globalThis as any).sourceDetailCreations=0;
      Object.defineProperty(Element.prototype,'className',{...descriptor,set(value:string){if(value==='library-source-detail')(globalThis as any).sourceDetailCreations++;descriptor.set!.call(this,value)}});
    });
    await worker.evaluate(async records=>{const s=(globalThis as any).chrome.storage.local;await s.remove(['pdfDocumentTranslationRetainedV1','bilingualPageRetainedV1','piPdfReadingAnnotationsV1','pdfTranslationMarkersV1','documentTranslationMemoryV1','piRecentPdfDocumentsV1']);await s.set({piWebExcerptsV1:records})},records);
    await options.setViewportSize({width:1100,height:850});
    const start=performance.now();await options.goto(`chrome-extension://${extensionId}/options.html#storage`);
    await expect(options.locator('.library-source-result')).toHaveCount(1000,{timeout:30_000});
    measurements.openMs=Math.round(performance.now()-start);
    const cdp=await context.newCDPSession(options);
    measurements.memory=await cdp.send('Runtime.getHeapUsage');
    measurements.nodes=await options.locator('*').count();
    measurements.detailsCreatedOnOpen=await options.evaluate(()=>(globalThis as any).sourceDetailCreations);
    expect(measurements.detailsCreatedOnOpen).toBeLessThanOrEqual(2);
    for(const [query,count] of [['uniqueneedle',1],['common',999],['',1000]] as const){
      const started=performance.now();await options.locator('#retained-library-search').fill(query);
      await expect(options.locator('.library-source-result')).toHaveCount(count,{timeout:30_000});
      measurements.searches.push({query,count,ms:Math.round(performance.now()-started)});
    }
    const last=options.locator('.library-source-result').filter({hasText:'人工笔记 0-0'});await last.locator('.library-select').click();
    await expect(options.locator('#library-detail')).toContainText('完整译文 0-0');
    expect(await worker.evaluate(async()=>(await(globalThis as any).chrome.storage.local.get('piWebExcerptsV1')).piWebExcerptsV1)).toEqual(records);
    expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{
    writeFileSync(info.outputPath('library-scale.json'),JSON.stringify(measurements,null,2));
    await options.close();await worker.evaluate(async before=>{const s=(globalThis as any).chrome.storage.local;await s.clear();await s.set(before)},before);
  }
});
