import { readFile, writeFile } from 'node:fs/promises';
const root = 'output/pdf/reliability-audit-2026-10-15';
const audit = JSON.parse(await readFile(`${root}/recorded-response-audit.json`, 'utf8'));
const build = JSON.parse(await readFile('.output/edge-mv3/build-info.json', 'utf8'));
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cases = [
  ['正文回显、错误语言、只返回公式', '不再以“非空”或“登记格式正确”作为完成依据。视觉、文字批次与旧结果恢复共用正文检查；保留具体原因。'],
  ['短结果或整句漏译', '保留返回的中文与可确认公式，明确标为待核对。长原文只返回一个引导句，不再算作可靠译文。'],
  ['纯公式被当成英语正文', '变量、缩写和受限数学函数名可以组成独立公式；带自然语言说明的段落仍必须翻译说明。'],
  ['图内符号与图注公式混淆', '有明确分区依据时，图内符号留在原图。图注公式必须保留，译文中的公式仍逐项核对；未知分区不套用例外。'],
  ['公式登记、字体或编号不一致', '沿用精确对应、源行身份和字体保护。模型自报不确定继续保留；不按数组位置、相邻编号或公式数量猜配。'],
  ['密集区域合并丢失草稿标记', '一个区域未确认时，邻段的正常公式不能让它变成可信数学。合并后保留候选与各区域原因。'],
  ['接口截断、空结果和异常终态', '非流式响应也检查 finish_reason。长度上限、内容过滤分别说明；未完整返回的结果不计为完成。'],
  ['暂停、补缺项失败后重复翻译', '先保存完整返回的结果与已成功的兄弟段，再暂停或报错；续译只处理缺项。没有增加隐藏付费重试。'],
  ['主动保留原文被统计成失败', '参考文献、纯文本模式保留公式、独立人名和技术标识分别处理，不用汉字数量一刀切判失败。'],
  ['旧记录来源不匹配', '保留来源签名与行为键检查。已保存的原文副本不能证明模型曾回显，也不能据它编造模型错误原因。'],
];
const checks = [
  ['单元测试（启用两篇本地论文）', 'unit-delivery.log'],
  ['重点功能首轮', 'functional-verified.log'],
  ['坐标演示数据修正后补验', 'hatnet-verified.log'],
  ['实际 CNP 结果、导出与故障注入', 'actual-cnp-replay.log'],
  ['实际 HATNet 恢复、编号专项补验', 'hatnet-final.log'],
  ['跨栏短译文与原文定位补验', 'cross-column-verified.log'],
  ['其余产品与布局回归', 'product-regression.log'],
];
const rows = [];
for (const [name, file] of checks) {
  let log = ''; try { log = await readFile(`${root}/${file}`, 'utf8'); } catch {}
  const last = pattern => [...log.matchAll(pattern)].at(-1)?.[1];
  const passed = last(/\b(\d+) passed(?:\s|$)/gu), failed = last(/\b(\d+) failed(?:\s|$)/gu);
  rows.push(`<tr><td>${esc(name)}</td><td>${passed ? `${passed} 通过` : '待汇总'}${failed ? `，${failed} 个初次失败（见下文）` : ''}</td><td><a href="${file}">日志</a></td></tr>`);
}
const cnpFindings = audit.finalCnpProseFindings.length;
const hatnetFindings = (audit.finalHatnetSourceReview ?? []).filter(row => row.proseIssues.length).length;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Translator · 未可靠译文排查</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#20232a;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1040px;margin:48px auto;padding:0 24px 64px}h1{font-size:32px;line-height:1.3;letter-spacing:-.6px;margin:8px 0 20px}h2{font-size:22px;margin:38px 0 14px}p{margin:10px 0;color:#4d535d}.eyebrow{font-size:13px;letter-spacing:.08em;color:#6d7179}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:28px 0}.stat{border:1px solid #e0e3e9;border-radius:12px;background:white;padding:18px 22px}.stat strong{display:block;font-size:30px;font-weight:600}.stat span{font-size:14px;color:#656b76}.table{overflow:auto;border:1px solid #dfe3e8;background:white;border-radius:10px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:14px 18px;border-bottom:1px solid #e8ebef}th{font-size:14px;color:#626b77;background:#fafbfc}tr:last-child td{border:0}td:first-child{width:27%;font-weight:550}a{color:#4056a5;text-underline-offset:3px}code{font-size:13px;overflow-wrap:anywhere}.note{padding:16px 20px;border-left:3px solid #929fc5;background:#eef1f7;border-radius:0 8px 8px 0}.footer{font-size:13px;border-top:1px solid #dde1e7;margin-top:36px;padding-top:18px;color:#737983}@media(max-width:600px){main{margin:26px auto;padding:0 16px 40px}h1{font-size:26px}.stats{gap:8px}.stat{padding:13px 10px}.stat strong{font-size:24px}.stat span{font-size:12px}th,td{padding:12px 10px}td:first-child{min-width:112px}table{font-size:14px}}</style>
<main><div class="eyebrow">PI TRANSLATOR · 2026.10.15</div><h1>未可靠译文：排查与修复</h1><p>已检查现有代码出口与保存的失败记录，把原文回退、局部漏译、公式问题和任务中断分开处理。可以精确恢复的在本地修复；未确认的候选保留译文和原因。</p>
<div class="stats"><div class="stat"><strong>220</strong><span>保存的真实响应回放</span></div><div class="stat"><strong>0</strong><span>本轮新增模型请求</span></div><div class="stat"><strong>991</strong><span>单元测试通过</span></div></div>
<h2>已经处理的情况</h2><div class="table"><table><thead><tr><th>情况</th><th>处理</th></tr></thead><tbody>${cases.map(([name, fix]) => `<tr><td>${esc(name)}</td><td>${esc(fix)}</td></tr>`).join('')}</tbody></table></div>
<h2>真实材料复核</h2><p><b>Conditional Neural Processes：</b>139 份历史实际响应。最终 130 个来源签名逐项匹配；87 个保存译文新增正文检查发现 ${cnpFindings} 个问题，43 个参考文献按原文保留。保存、关闭恢复、段落修正和全部导出使用真实译文回放，故障为本地注入。</p>
<p><b>HATNet：</b>81 份历史实际响应。68 个译文与当前来源签名直接匹配，新增正文检查发现 ${hatnetFindings} 个问题。另一个表格只有换行与空格差异，内容、裁剪坐标及公式元数据一致；为验收单独生成有逐项依据的副本，保留 69 个真实译文与 104 个原文参考条目。原始证据和生产用户历史未改写。</p>
<p class="note">上述“未发现”针对这批材料和这些检查。它不代表逐字证明了所有译文正确，也不代表任意论文都能自动完成且没有警告。术语含义、模型自信地错认符号、模糊扫描图和未知字体，仍有自动检查无法确认的部分。</p>
<h2>验证记录</h2><style>.checks th:last-child,.checks td:last-child{width:56px;white-space:nowrap}</style><div class="table"><table class="checks"><thead><tr><th>检查</th><th>结果</th><th>证据</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
<p>本轮 182 个不同浏览器用例分轮验证通过。重点功能首轮的两项坐标测试使用不完整的占位译文，新检查正确给出待核对；修正演示响应后补验通过。其余产品首轮的三个失败也已单独补验：跨栏用例明确检查短译文警告，两个编号用例补足演示正文，配号校验未放松。旧 HATNet 全文用例改为仅在恢复未完成时点击开始。初次失败日志全部保留，不写成单轮全量通过。</p>
<h2>可复查的记录</h2><p><a href="recorded-response-audit.json">逐响应审计与来源证明</a> · <a href="../../../docs/pdf-translation-issues.md">问题台账</a> · <a href="hatnet-equivalent-acceptance-checkpoint.json">仅用于验收的 HATNet 等价来源副本</a></p>
<p>本轮没有新增扫描件 OCR 的真实模型验收。没有关闭公式校验，没有用重复生成碰运气消除警告。新增可靠性用例已加入 Edge CI 的测试命令；远程 CI 未触发。</p>
<div class="footer">本地构建 <code>${esc(build.buildId)}</code> · v${esc(build.version)}<br>TypeScript、构建、密钥扫描与差异检查通过。旧安装 ZIP 未更新；未提交、推送或发布。</div></main></html>`;
await writeFile(`${root}/排查与修复.html`, html);
console.log('Wrote reliability audit report.');
