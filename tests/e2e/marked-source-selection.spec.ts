import {context,expect,installEdgeExtensionHooks,page,selectElementText,test,textRequests} from './support/edge-extension-fixture';
installEdgeExtensionHooks();

async function markedSource(){
  const source=page.locator('#source'),text=(await source.textContent())!;
  await source.evaluate(node=>{const text=node.textContent!,word='academic',i=text.indexOf(word),a=document.createElement('a');a.href='#native-source-link';a.textContent=word;node.replaceChildren(text.slice(0,i),a,text.slice(i+word.length))});
  await selectElementText('#source');const overlay=page.locator('#tex-selection-translator-root');await overlay.locator('.trigger').click();await expect(overlay.locator('.copy-action')).toBeEnabled();await overlay.locator('.mark-action').click();await overlay.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>getSelection()?.removeAllRanges());await expect(page.locator('#pi-translation-marker-layer .marker').first()).toBeVisible();
  return {text,source,overlay};
}
test('allows native drag and double-click in a marked source while keeping single-click revisit',async({},info)=>{
  const {text,source,overlay}=await markedSource(),calls=textRequests.length;
  const points=await source.evaluate(node=>{const first=node.firstChild!,last=node.lastChild!,a=document.createRange(),b=document.createRange();a.setStart(first,0);a.setEnd(first,1);b.setStart(last,last.textContent!.length-1);b.setEnd(last,last.textContent!.length);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {a:{x:x.left+.2,y:x.top+x.height/2},b:{x:y.right-.2,y:y.top+y.height/2}}});
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:24});await page.mouse.up();
  expect(await page.evaluate(()=>getSelection()?.toString().trim())).toBe(text.trim());await expect(overlay.locator('.trigger')).toBeVisible();expect(textRequests.length).toBe(calls);
  await page.evaluate(()=>getSelection()?.removeAllRanges());await page.mouse.click(points.a.x,points.a.y);await expect(overlay.locator('.copy-action')).toBeVisible();expect(textRequests.length).toBe(calls);
  await overlay.getByRole('button',{name:'关闭',exact:true}).click();
  const word=await source.evaluate(node=>{const text=node.firstChild!,start=text.textContent!.indexOf('consistent'),r=document.createRange();r.setStart(text,start);r.setEnd(text,start+10);const b=r.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}});
  await page.mouse.dblclick(word.x,word.y);expect(await page.evaluate(()=>getSelection()?.toString().trim())).toBe('consistent');await expect(overlay.locator('.trigger')).toBeVisible();expect(textRequests.length).toBe(calls);
  await page.screenshot({path:info.outputPath('marked-native-selection.png')});
});

test('keeps links inside marked text usable without opening a cached result',async()=>{
  const {source,overlay}=await markedSource(),calls=textRequests.length;await source.locator('a').click();
  await expect(page).toHaveURL(/#native-source-link$/);await expect(overlay.locator('.copy-action')).toBeHidden();expect(textRequests.length).toBe(calls);
});
