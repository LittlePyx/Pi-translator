import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {context,expect,installEdgeExtensionHooks,page,selectElementText,test} from './support/edge-extension-fixture';

const replayFile=process.env.PI_WEB_CORE_REPLAY;
const bytes=replayFile?readFileSync(replayFile):undefined;
const replay=bytes?JSON.parse(bytes.toString()):undefined;
installEdgeExtensionHooks();
test.skip(!replay,'Opt-in exact historical real responses, replayed without external model requests.');

test('replays every fixed real response with complete meanings and no new model generation',async({},info)=>{
  test.setTimeout(120_000);
  const responses=replay.api.filter((item:any)=>item.status===200);
  expect(responses).toHaveLength(6);
  let attempts=0;
  const results=[];
  for(const entry of responses){
    const response=JSON.parse(entry.providerContent);
    const selected=replay.jobs.find((item:any)=>item.id===entry.caseId&&item.selection)?.selection.source;
    expect(selected).toBeTruthy();
    const fulfill=async(route:any)=>{
      attempts++;
      await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:entry.providerContent}}]})});
    };
    const before=attempts;
    await context.route('https://www.overleaf.com/pi-translator-e2e-api/**',fulfill);
    try{
      await page.setViewportSize({width:360,height:780});
      await page.locator('#source').evaluate((node,text)=>{node.textContent=text;},selected);
      await selectElementText('#source');
      const overlay=page.locator('#tex-selection-translator-root');
      await overlay.locator('.trigger').click();
      const meaning=overlay.locator('.lexical-meaning,.body').first();
      await expect(meaning).toHaveText(response.translation);
      const details=overlay.locator('.lexical-details');
      const senses=(response.lookup?.senses??[]).filter((sense:any)=>sense.meaning.trim().replace(/\s+/gu,' ').toLocaleLowerCase()!==response.translation.trim().replace(/\s+/gu,' ').toLocaleLowerCase());
      if(senses.length){
        await expect(details).not.toHaveAttribute('open','');
        await expect(overlay.locator('.lexical-sense')).toBeHidden();
        await overlay.locator('.surface').screenshot({path:info.outputPath(`${entry.caseId}-collapsed.png`)});
        await details.locator('summary').focus();await page.keyboard.press('Enter');
        await expect(overlay.locator('.lexical-sense-meaning')).toHaveText(senses.map((sense:any)=>sense.meaning));
        await expect(overlay.locator('.lexical-sense').first()).toBeVisible();
        await overlay.locator('.surface').screenshot({path:info.outputPath(`${entry.caseId}-expanded.png`)});
      }else await expect(details).toHaveCount(0);
      expect(await overlay.locator('.surface').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
      expect(attempts-before).toBe(1);
      results.push({caseId:entry.caseId,translation:await meaning.innerText(),completeSenses:senses.map((sense:any)=>sense.meaning),mockRequests:attempts-before});
      await overlay.getByRole('button',{name:'关闭',exact:true}).click();
      await page.evaluate(()=>{getSelection()?.removeAllRanges();document.dispatchEvent(new Event('selectionchange'));});
    }finally{await context.unroute('https://www.overleaf.com/pi-translator-e2e-api/**',fulfill);}
  }
  writeFileSync(info.outputPath('response-replay.json'),JSON.stringify({evidence:'Offline browser replay of six first real responses; not six additional live acceptances.',inputSha256:createHash('sha256').update(bytes!).digest('hex'),newModelRequests:0,results},null,2));
});
