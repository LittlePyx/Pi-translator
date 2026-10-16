import type {Locator,Page} from '@playwright/test';

export async function openTranslationMore(surface:Locator|Page):Promise<void>{
  const menu=surface.locator('details.more, #panel-more');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}

export async function openPdfReaderMore(reader:Page):Promise<void>{
  const menu=reader.locator('#pdf-reader-menu');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}

export async function clickPdfReaderAction(reader:Page,id:string):Promise<void>{
  await openPdfReaderMore(reader);
  await reader.locator(`#${id}`).click();
  if(await reader.locator('#pdf-reader-menu').getAttribute('open')!==null)await reader.keyboard.press('Escape');
}

export async function openWebReadingMore(sidePanel:Page):Promise<void>{
  const menu=sidePanel.locator('#bilingual-page-copy-menu');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
}
