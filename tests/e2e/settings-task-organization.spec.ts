import {context,extensionId,installEdgeExtensionHooks,test,expect,textRequests,visionRequests} from './support/edge-extension-fixture';
import {openSettingsSection} from './support/settings-navigation';

installEdgeExtensionHooks();

test('keeps translation and webpage shortcut drafts together when changing sections',async()=>{
 const worker=context.serviceWorkers()[0]!,options=await context.newPage();
 const saved=await worker.evaluate(async()=>{const c=(globalThis as any).chrome;return (await c.storage.local.get('extensionSettings')).extensionSettings});
 try{
  await options.goto(`chrome-extension://${extensionId}/options.html#translation`);await openSettingsSection(options,'translation');
  await options.locator('#context-mode').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('#context-mode').selectOption('paragraph');
  const contextHelp=options.locator('#context-mode').locator('xpath=..').locator('small');await expect(contextHelp).toBeVisible();await expect(contextHelp).toContainText('发送给所配置的 API');
  await openSettingsSection(options,'pages');await options.locator('#paragraph-shortcut').locator('xpath=ancestor::details').locator(':scope > summary').click();await options.locator('#paragraph-shortcut').selectOption('alt');
  await openSettingsSection(options,'translation');await expect(options.locator('#context-mode')).toHaveValue('paragraph');await expect(options.locator('#save-button')).toBeEnabled();
  await openSettingsSection(options,'pages');await expect(options.locator('#paragraph-shortcut')).toHaveValue('alt');const before=textRequests.length+visionRequests.length;
  await options.locator('#save-button').click();await expect(options.locator('#save-button')).toBeDisabled();
  const after=await worker.evaluate(async()=>(await (globalThis as any).chrome.storage.local.get('extensionSettings')).extensionSettings);
  expect(after.contextMode).toBe('paragraph');expect(after.paragraphShortcut).toBe('alt');expect(after.apiProfiles).toEqual(saved.apiProfiles);expect(after.purposePreferences).toEqual(saved.purposePreferences);expect(textRequests.length+visionRequests.length).toBe(before);
 }finally{await options.close();await worker.evaluate(async value=>await (globalThis as any).chrome.storage.local.set({extensionSettings:value}),saved)}
});
