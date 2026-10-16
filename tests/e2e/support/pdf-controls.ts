import {expect,type Page} from '@playwright/test';

export async function openPdfTranslationSettings(reader: Page): Promise<void> {
  await expect(reader.locator('#pdf-document-translation')).not.toHaveAttribute('data-phase', /^(?:idle|preparing)$/u);
  const settings = reader.locator('#pdf-document-translation-settings');
  if (await settings.isHidden()) {
    const menu = reader.locator('#pdf-document-translation-copy-menu');
    if (await menu.getAttribute('open') === null) await menu.locator(':scope > summary').click();
    await reader.locator('#pdf-document-translation-show-settings').click();
  } else if (await settings.getAttribute('open') === null) {
    await settings.locator(':scope > summary').click();
  }
}

export async function openPdfTranslationOptions(reader: Page): Promise<void> {
  await openPdfTranslationSettings(reader);
  for (const id of ['pdf-document-options-more']) {
    if (await reader.locator(`#${id}`).getAttribute('open') === null) await reader.locator(`#${id} > summary`).click();
  }
}

/** Shared PDF bytes can restore fit-width from an earlier case. Complete the
 * initial reflow before caching mouse coordinates for a capture gesture. */
export async function fitPdfBeforeRegionCapture(reader:Page):Promise<void>{
  await reader.locator('#pdf-reader-menu > summary').click();
  await reader.locator('#fit-width').click();
  const menu=reader.locator('#pdf-reader-menu');if(await menu.getAttribute('open')!==null)await reader.keyboard.press('Escape');
  const page=reader.locator('.pdf-page').first();
  await expect.poll(()=>page.evaluate(element=>{
    const padding=matchMedia('(max-width:720px)').matches?30:70;
    return Math.abs(element.getBoundingClientRect().width-(document.querySelector<HTMLElement>('#document-stage')!.clientWidth-padding));
  })).toBeLessThanOrEqual(1);
  await expect(page).toHaveAttribute('data-rendered','ready');
}
