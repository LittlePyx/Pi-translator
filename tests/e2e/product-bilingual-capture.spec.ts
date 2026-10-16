import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_FIXTURE_URL, context, expect, extensionId, installEdgeExtensionHooks, page, test } from './support/edge-extension-fixture';

installEdgeExtensionHooks();

test('captures the bilingual product view with explicitly simulated translations', async () => {
  const pairs = [
    ['Reading research papers', '阅读研究论文'],
    ['Start with the abstract and introduction to identify the research question. Then read the method section and check how the experiments support the main claims.', '先阅读摘要和引言，了解研究问题。再阅读方法部分，检查实验如何支持论文的主要结论。'],
    ['When comparing two methods, keep the dataset and evaluation settings in mind. A higher score alone does not explain whether the improvement will transfer to a different task.', '比较两种方法时，需要留意数据集和评估设置。仅凭更高的分数，无法判断改进是否适用于其他任务。'],
  ] as const;
  await page.setViewportSize({ width: 1100, height: 600 });
  await page.route(ARTICLE_FIXTURE_URL, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>双语阅读演示</title><style>body{margin:0;background:#fff;color:#25314c;font:23px/1.65 Georgia,'Microsoft YaHei',serif}header{padding:20px 60px;background:#f2f3fa;font:17px 'Microsoft YaHei',sans-serif;color:#6c7390}main{max-width:970px;margin:auto;padding:18px 36px 90px}h1{font:700 30px/1.3 'Segoe UI',sans-serif;margin:12px 0 20px}p{margin:22px 0}</style><header>Pi Translator · 全文双语阅读　｜　演示文本 / 模拟译文</header><main><article><h1>${pairs[0][0]}</h1><p>${pairs[1][0]}</p><p>${pairs[2][0]}</p></article></main></html>` }));
  const translate = (text: string) => {
    const found = pairs.find(([source]) => source === text.trim());
    if (!found) throw new Error(`Unexpected demo input: ${text.slice(0,80)}`);
    return found[1];
  };
  await context.route('**/pi-translator-e2e-api/chat/completions', async route => {
    const body = route.request().postDataJSON();
    const payload = JSON.parse(body.messages.find((m: {role: string}) => m.role === 'user').content);
    const segments = (payload.segments ?? []).map((s: {id: string; text: string}) => ({id:s.id,translation:translate(s.text)}));
    const response = {translation:segments.length ? segments.map((s: {translation: string})=>s.translation).join('\n') : translate(payload.text),detectedLanguage:'en',warnings:[],segments};
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]})});
  });
  await page.goto(ARTICLE_FIXTURE_URL);
  const popup=await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  const started=await popup.evaluate(async url=>{
    const api=(globalThis as any).chrome;
    const tab=(await api.tabs.query({})).find((item: {url:string})=>item.url===url);
    return api.runtime.sendMessage({type:'START_BILINGUAL_PAGE',payload:{tabId:tab.id,targetLanguage:'zh-CN'}});
  },ARTICLE_FIXTURE_URL);
  expect(started.ok).toBe(true);
  await expect(page.locator('[data-pi-bilingual-translation]')).toHaveCount(3);
  await expect(page.locator('#pi-translator-bilingual-page-control output')).toContainText('已完成 3/3');
  await expect(page.getByText(pairs[1][1],{exact:true})).toBeVisible();
  await expect(page.getByText(pairs[2][1],{exact:true})).toBeVisible();
  await page.mouse.move(5,5);
  const out=path.resolve('output/pi-translator-overview-2026-09-20');
  await mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'网页全文双语-演示.png')});
  await popup.close();
});
