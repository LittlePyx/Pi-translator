import {context,expect,installEdgeExtensionHooks,OVERLEAF_FIXTURE_URL,page,selectElementText,test} from './support/edge-extension-fixture';

installEdgeExtensionHooks();
const endpoint='https://www.overleaf.com/pi-translator-e2e-api/**';
let requested:string[]=[];
const submitted=()=>context.serviceWorkers()[0]!.evaluate(()=>(globalThis as any).identitySubmissions as string[]);
test.beforeAll(async()=>{
  await context.serviceWorkers()[0]!.evaluate(async()=>{
    const scope=globalThis as any,c=scope.chrome,stored=await c.storage.local.get('extensionSettings');
    await c.storage.local.set({extensionSettings:{...stored.extensionSettings,enableSessionCache:false}});
    scope.identitySubmissions=[];
    c.runtime.onMessage.addListener((message:any)=>{
      if(message.type==='TRANSLATE_SELECTION'||message.type==='TRANSLATE_SELECTION_IN_BROWSER_SIDEBAR')scope.identitySubmissions.push(message.payload.text);
    });
  });
  await context.route(endpoint,async route=>{
    const payload=route.request().postDataJSON(),user=payload.messages.findLast((item:{role:string})=>item.role==='user');
    const {text}=JSON.parse(user.content);requested.push(text);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({translation:text==='alpha'?'阿尔法':'贝塔',detectedLanguage:'en',warnings:[],lookup:{partOfSpeech:'noun',senses:[]}})}}]})});
  });
});
test.beforeEach(async()=>{
  requested=[];
  await context.serviceWorkers()[0]!.evaluate(()=>(globalThis as any).identitySubmissions=[]);
  await page.goto(OVERLEAF_FIXTURE_URL);
  await page.locator('#lookup-source').evaluate(element=>{
    const a=document.createElement('span');a.id='identity-a';a.textContent='alpha';
    const b=document.createElement('span');b.id='identity-b';b.textContent='beta';b.style.marginLeft='60px';
    const field=document.createElement('textarea');field.id='identity-field';field.value='alpha';field.setAttribute('aria-label','Identity fixture');
    element.replaceChildren(a,b,document.createElement('br'),field);
  });
});

test('uses the current selection when an old trigger is activated before the refresh debounce',async({},info)=>{
  await selectElementText('#identity-a');const trigger=page.locator('#tex-selection-translator-root .trigger');await expect(trigger).toBeVisible();
  const selected=await page.evaluate(()=>{
    const range=document.createRange();range.selectNodeContents(document.getElementById('identity-b')!);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    const current=selection.toString();(document.getElementById('tex-selection-translator-root')!.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click();return current;
  });
  expect(selected).toBe('beta');await expect.poll(()=>requested).toEqual(['beta']);
  expect(await submitted()).toEqual(['beta']);
  await expect(page.locator('#tex-selection-translator-root .lexical-source')).toHaveText('beta');
  await expect(page.locator('#tex-selection-translator-root .lexical-meaning')).toHaveText('贝塔');
  await info.attach('request-identity',{body:JSON.stringify({selected,requested}),contentType:'application/json'});
});

test('does not send a cached selection when its residual trigger is activated after clearing',async()=>{
  await selectElementText('#identity-a');await expect(page.locator('#tex-selection-translator-root .trigger')).toBeVisible();
  await page.evaluate(()=>{getSelection()!.removeAllRanges();document.dispatchEvent(new Event('selectionchange'));(document.getElementById('tex-selection-translator-root')!.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click()});
  await expect(page.locator('#tex-selection-translator-root .trigger')).toBeHidden();
  await page.waitForTimeout(350);expect(requested).toEqual([]);expect(await submitted()).toEqual([]);
});

test('keeps keyboard activation usable for a selected text control after focus moves to the trigger',async()=>{
  await page.locator('#identity-field').click();await page.keyboard.press('Control+A');
  const trigger=page.locator('#tex-selection-translator-root .trigger');await expect(trigger).toBeVisible();await trigger.focus();await page.waitForTimeout(150);await expect(trigger).toBeFocused();await page.keyboard.press('Enter');
  await expect.poll(()=>requested).toEqual(['alpha']);expect(await submitted()).toEqual(['alpha']);await expect(page.locator('#tex-selection-translator-root .lexical-meaning')).toHaveText('阿尔法');
});

test('reads a changed text control range at keyboard activation rather than its earlier text',async({},info)=>{
  await page.locator('#identity-field').click();await page.keyboard.press('Control+A');
  const trigger=page.locator('#tex-selection-translator-root .trigger');await expect(trigger).toBeVisible();await trigger.focus();
  await page.locator('#identity-field').evaluate(element=>{const field=element as HTMLTextAreaElement;field.value='beta';field.setSelectionRange(0,4)});
  await page.waitForTimeout(150);await expect(trigger).toBeFocused();
  const observation=await page.evaluate(()=>{
    const host=document.getElementById('tex-selection-translator-root')!,field=document.getElementById('identity-field') as HTMLTextAreaElement,selection=getSelection();
    return{activeElementId:document.activeElement?.id,triggerFocused:host.shadowRoot?.activeElement?.classList.contains('trigger'),anchorInPi:selection?.anchorNode?.getRootNode()===host.shadowRoot,windowText:selection?.toString(),field:{value:field.value,start:field.selectionStart,end:field.selectionEnd,connected:field.isConnected}};
  });
  await info.attach('focused-control-diagnosis',{body:JSON.stringify(observation),contentType:'application/json'});
  await page.keyboard.press('Enter');await expect.poll(()=>requested).toEqual(['beta']);
  expect(await submitted()).toEqual(['beta']);
  await expect(page.locator('#tex-selection-translator-root .lexical-meaning')).toHaveText('贝塔');
});

test('does not submit a text control whose range was cleared while the trigger had keyboard focus',async()=>{
  await page.locator('#identity-field').click();await page.keyboard.press('Control+A');
  const trigger=page.locator('#tex-selection-translator-root .trigger');await expect(trigger).toBeVisible();await trigger.focus();
  await page.locator('#identity-field').evaluate(element=>(element as HTMLTextAreaElement).setSelectionRange(0,0));
  await page.keyboard.press('Enter');await expect(trigger).toBeHidden();await page.waitForTimeout(350);expect(requested).toEqual([]);expect(await submitted()).toEqual([]);
});
