import {expect,type Locator,type Page} from '@playwright/test';

export async function openTranslationMore(surface:Locator|Page):Promise<void>{
  const menu=surface.locator('details.more, #panel-more');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}

export async function openPdfReaderMore(reader:Page):Promise<void>{
  const menu=reader.locator('#pdf-reader-menu');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}

export async function clickPdfReaderAction(reader:Page,id:string):Promise<void>{
  const control=reader.locator(`#${id}`);
  if(await control.evaluate(node=>Boolean(node.closest('#pdf-reader-menu'))))await openPdfReaderMore(reader);
  else if(await reader.locator('#pdf-reader-menu').getAttribute('open')!==null){
    await reader.locator('#pdf-reader-menu > summary').click();
    await expect(reader.locator('#pdf-reader-menu')).toHaveJSProperty('open',false);
  }
  await control.click();
  if(await reader.locator('#pdf-reader-menu').getAttribute('open')!==null)await reader.keyboard.press('Escape');
}

export async function openWebReadingMore(sidePanel:Page):Promise<void>{
  const menu=sidePanel.locator('#bilingual-page-copy-menu');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}
