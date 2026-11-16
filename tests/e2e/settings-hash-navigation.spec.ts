import {context,expect,extensionId,installEdgeExtensionHooks,test,textRequests,visionRequests} from './support/edge-extension-fixture';
import {pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey} from '../../core/pdf/document-translation-session';
installEdgeExtensionHooks();
for(const populated of [false,true])test(`routes same-document settings hashes with ${populated?'saved documents':'an empty library'} without losing drafts or writing settings`,async()=>{
  const page=await context.newPage(),worker=context.serviceWorkers()[0]!,original=await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null)),calls=textRequests.length+visionRequests.length;
  const checkLibrary=async()=>{
    await expect(page.locator('#settings-storage')).toBeVisible();
    if(populated){await expect(page.locator('#retained-library-search')).toBeVisible();await expect(page.locator('.library-entry')).toHaveCount(1)}
    else{await expect(page.locator('#library-empty-import')).toBeVisible();await expect(page.locator('#retained-library-search')).toBeHidden()}
  };
  try{
    if(populated){
      const signature=pdfDocumentTranslationSessionBlockSignature(1,'Saved research passage',0);
      await worker.evaluate(async record=>await(globalThis as any).chrome.storage.local.set({pdfDocumentTranslationRetainedV1:[record]}),{
        documentKey:pdfDocumentTranslationSessionDocumentKey('hash-navigation.pdf'),targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:1,documentSignatures:[signature],blocks:[{signature,translatedText:'保留的人工修正。',manualCorrection:true}],activity:'complete',behaviorKey:pdfDocumentTranslationSessionBehaviorKey('model'),
      });
    }
    await page.goto(`chrome-extension://${extensionId}/options.html#connection`);await expect(page.locator('#model')).toHaveValue('e2e-model');
    const before=await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null));
    await page.locator('#model').fill('unsaved-model-draft');
    await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await checkLibrary();
    await page.goto(`chrome-extension://${extensionId}/options.html#cost`);await expect(page.locator('#settings-cost')).toHaveAttribute('open','');await expect(page.locator('#model')).toHaveValue('unsaved-model-draft');
    await page.setViewportSize({width:360,height:780});await page.goto(`chrome-extension://${extensionId}/options.html#storage`);await checkLibrary();
    await page.goBack();await expect(page.locator('#settings-cost')).toBeVisible();await expect(page.locator('#model')).toHaveValue('unsaved-model-draft');
    expect(await worker.evaluate(()=> (globalThis as any).chrome.storage.local.get(null))).toEqual(before);expect(textRequests.length+visionRequests.length).toBe(calls);
  }finally{await page.close({runBeforeUnload:false});await worker.evaluate(async original=>{const s=(globalThis as any).chrome.storage.local;await s.clear();await s.set(original)},original)}
});
