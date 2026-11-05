import {ARTICLE_FIXTURE_URL,context,expect,extensionId,installEdgeExtensionHooks,page,test,textRequests} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
test('translates Git prose before a code block while leaving the code intact',async()=>{
 const popup=await context.newPage();
 const prose='Git models the history of a collection of files and folders within some top-level directory as a series of snapshots. In Git terminology, a file is called a “blob”, and it’s just a bunch of bytes. A directory is called a “tree”, and it maps names to blobs or trees (so directories can contain other directories). A snapshot is the top-level tree that is being tracked. For example, we might have a tree as follows:';
 try{
  await page.goto(ARTICLE_FIXTURE_URL);await page.evaluate(text=>{const article=document.querySelector('article')!,p=document.createElement('p'),pre=document.createElement('pre'),next=document.createElement('p');p.id='git-prose';p.textContent=text;pre.id='git-code';pre.textContent='git_protected_code_example()';next.id='git-follow';next.textContent='The top-level tree contains two elements and represents the contents of this project.';article.prepend(p,pre,next)},prose);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);const before=textRequests.length;
  const response=await popup.evaluate(async url=>{const c=(globalThis as any).chrome,tab=(await c.tabs.query({url}))[0];return c.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId:tab.id,targetLanguage:'zh-CN'}})},ARTICLE_FIXTURE_URL);expect(response.ok).toBe(true);
  await expect(page.locator('#pi-translator-bilingual-page-control .bar')).toHaveAttribute('data-phase','complete');
  await expect(page.locator('#git-prose + [data-pi-bilingual-translation]')).toBeVisible();await expect(page.locator('#git-follow + [data-pi-bilingual-translation]')).toBeVisible();
  await expect(page.locator('#git-prose')).toHaveText(prose);await expect(page.locator('#git-code')).toHaveText('git_protected_code_example()');await expect(page.locator('#git-code + [data-pi-bilingual-translation]')).toHaveCount(0);
  const requests=JSON.stringify(textRequests.slice(before));expect(requests).toContain('Git models the history');expect(requests).not.toContain('git_protected_code_example');
 }finally{await popup.close()}
});
