import { expect, type Page } from '@playwright/test';

export async function openSettingsSection(page: Page, section: string): Promise<void> {
  if(section==='cost'){
    await openSettingsSection(page,'connection');
    const more=page.locator('#connection-more');
    if(await more.getAttribute('open')===null)await more.locator(':scope > summary').click();
    const cost=page.locator('#settings-cost');
    if(await cost.getAttribute('open')===null)await cost.locator(':scope > summary').click();
    await expect(cost).toBeVisible();
    return;
  }
  const select = page.locator('#settings-section-select');
  if (await select.isVisible()) {
    await expect(select.locator(`option[value="${section}"]`)).toHaveCount(1);
    await select.selectOption(section);
  } else {
    await page.locator(`[data-settings-target="${section}"]`).click();
  }
  await expect(page.locator(`#settings-${section}`)).toBeVisible();
}
