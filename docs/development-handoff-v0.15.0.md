# Pi Translator v0.15.0 开发交接

更新时间：2026-09-02

## 1. 当前状态

| 项目 | 当前值 |
| --- | --- |
| 仓库 | `F:\research-papers\2026\July\Pi_translate` |
| 分支 | `main`；公开 v0.15.0 已发布，当前实现基线 `b3fce7f` 尚未推送或发布，其后可以只有交接文档提交 |
| 功能基线 | 已发布 `v0.15.0` 指向 `40a51bf`；当前发布后修复基线为 `b3fce7f fix: translate PDF figures and tables as objects` |
| 当前版本 | `0.15.0` |
| 最终发布候选 | `.output/final-ci/tex-selection-translator-0.15.0-edge.zip`（来自 GitHub Actions） |
| 最终 ZIP 大小 | 1,150,261 bytes |
| 最终 SHA-256 | `2BF94E9E787B462772284B37180142BAC3D8442F115348B8983C73965A3BD372` |
| 本地发布后验证包 | `.output/tex-selection-translator-0.15.0-edge.zip`；1,175,980 bytes；`2EDF6B197A6A947068506F97E1C985EF84407A0CAC368800D7579FBE801AF088` |
| ZIP 内容 | 公开 Release 包 33 项；当前本地发布后验证包 36 项，Manifest V3，已通过逐文件一致性门禁 |
| 发布状态 | GitHub 已发布签名且验证有效的 `v0.15.0` tag 和 Release；当前修复未推送、未打 tag、未建 Release、未提交 Edge 商店 |

`store-assets/ads/` 下仍有用户的未跟踪广告素材。它们不属于本轮代码或发布提交，禁止删除、移动、修改或加入暂存区。

## 2. 版本治理结论

GitHub 已存在公开 `v0.14.0` tag 和 Release，tag 指向旧提交 `0d0428c`，其 ZIP 为较早的 1,112,382-byte 候选。后续本地 19 个功能提交加入了 PDF 全文翻译、扫描页 OCR、范围控制、暂停继续、导出、结果保留和超长网页完整翻译，因此当前候选按 minor release 调整为 `v0.15.0`。不得移动、覆盖或复用既有 `v0.14.0` tag。

发布准备首先只调整了版本、发布说明、验收记录和三个开发工具链传递依赖。连续的真实 Windows Edge CI 随后暴露并固定了六处测试或交互竞态：划词关闭按钮的装饰星标与外层容器命中竞争、PDF 侧栏半像素字体舍入、设置页同 URL 导航被新导航中断、拖动卡片时 Edge 提前触发 `lostpointercapture`、PDF 懒加载重绘后持久标记状态滞后，以及适宽重绘的等待条件不够精确。最终候选只加固这些真实交互边界和对应断言，没有改变翻译、请求或隐私规则。

公开发布后又完成三组本地修复：`9c7976b` 将用户已经启动的 PDF 文字和多模态队列移到扩展后台文档，解决切屏后页面被冻结、翻译停滞的问题；`fe47ebf` 区分正文中的 Figure 引用与真正图注，修复第 5 页正文被错误切碎并并入公式的问题；`b3fce7f` 将图和表按完整语义对象分组，加入正文文字 + 图表视觉的混合后台队列、整对象高亮、真实 Markdown 表格渲染以及保留原图表的导出策略。三组修复均未改变扫描页授权边界，也不会在预览阶段发送请求。

## 3. 已完成能力与必须保留的产品规则

- 普通网页、Overleaf、网页固定侧栏和 Edge 浏览器侧栏支持划词翻译。被动入口过滤高置信度目标语言和纯代码；固定侧栏代表明确意图，混合自然语言与代码仍翻译。
- 普通划词始终使用文字接口；用户主动“框选网页”始终使用多模态接口，不因框内可提取文字而降级。
- 网页截图、扫描页 OCR 和视觉识别必须由用户明确触发并确认；敏感表单区域禁止发送。
- 超过 100 段的网页先显示零请求确认、请求估算和“全部正文 / 当前章节 / 从当前位置”预设；预览、范围调整、取消和显示模式切换零请求。
- 网页与 PDF 全文翻译支持暂停、继续、停止、重试、恢复、范围控制和导出；公式、代码、表单及未成功段落不能在“只看译文”时消失。
- PDF 全文预览只在本地读取文字层；扫描页不自动 OCR，只有用户明确启动后才发送页面图像，并可中途停止。
- 不自动替换网页、Overleaf 或 PDF 原文；不引入 Pi 账号、自有后端或遥测。

## 4. 发布后本地修复验证（未发布）

- TypeScript 类型检查：通过。
- Vitest：699/699，通过，共 102 个测试文件。
- Microsoft Edge E2E：132/132，通过；覆盖纯文字、统一多模态和图表混合任务在 PDF 标签页被冻结后的后台继续执行。
- 真实 `CVPR-2018-ISTA-Net- Interpretable...Deep Network for Image Compressive Sensing.pdf`：第 5 页 Figure 引用正文保持连续；第 6 页 Figure 4 合并为一个图对象；第 7 页 Figure 5、Table 1 和 Table 2 各形成一个完整对象，未生成刻度或单元格碎片，也未吞入后续正文和 `5.3` 标题。
- Edge MV3 生产构建：通过，约 3.86 MB；密钥扫描通过。
- 本地 ZIP：36 项，与生产构建逐文件一致；大小 1,175,980 bytes，SHA-256 为 `2EDF6B197A6A947068506F97E1C985EF84407A0CAC368800D7579FBE801AF088`。

这个 ZIP 的版本字段仍为 `0.15.0`，但内容晚于公开的 v0.15.0 Release，只能用于本地 Edge 实机验收。不得用它覆盖现有 Release 资产或直接提交 Edge 商店；如需发布这些修复，必须先明确新版本号并重新走 tag、Release 和候选包门禁。

## 5. v0.15.0 正式发布验证结果

- Node.js：官方 Windows x64 `v24.19.0`，下载包 SHA-256 与 Node 官方清单一致。
- 密钥和私钥模式扫描：通过。
- TypeScript 类型检查：通过。
- Vitest：666/666，通过，共 99 个测试文件。
- Microsoft Edge E2E：124/124，通过，Edge `151.0.4129.101`。
- Edge MV3 生产构建：通过，约 3.77 MB。
- 发布包一致性：通过；33 项，与生产构建逐文件一致。
- GitHub Actions：代码候选 `13422d7` 的运行 `33472574136` 通过；云端再次完成密钥扫描、类型检查、666/666 单元测试、构建、124/124 真实 Edge E2E、打包、逐文件一致性和已验证 artifact 上传。
- GitHub 发布：SSH 签名 tag `v0.15.0` 指向 `40a51bf`，GitHub 验证结果为 `valid`；Release 资产下载后与已验收候选逐字节一致。
- 生产依赖在线安全审计：0 个漏洞。
- 开发工具链在线安全审计：非破坏性更新已修复 3 项；剩余 10 项位于 WXT / web-ext-run 等开发依赖，不进入扩展包。需要 WXT 破坏性升级的部分留待发布后单独分支验证。

本地复现包与云端最终包的 33 个条目、路径和 Manifest 完全一致；27 个可执行、样式和运行时条目字节完全一致。其余 6 个静态文本条目只受 Windows checkout 的换行和空行格式影响，忽略这些格式后逐行内容完全一致。最终采用云端通过门禁并上传的 artifact，避免把未经云端验证的本地字节作为 Release 资产。

云端最终 ZIP 还从解压目录直接加载到真实 Edge：Manifest V3、版本 `0.15.0`，设置页 API 配置控件、快捷面板和 Pi PDF 均正常，页面错误为 0。完整实机验收已覆盖：

1. 普通网页划词和纯代码被动过滤。
2. 网页框选渲染公式并确认走多模态、无文字接口回退。
3. 520 段网页的零请求确认、三个范围预设与全文完成。
4. PDF 全文预览、页码范围、暂停/继续、返回原文和导出。
5. 扫描 PDF 不自动 OCR，明确启动后才发送图像，并可停止。

## 6. 下一步

1. GitHub 发布已经完成，不要移动或覆盖 `v0.15.0` tag，也不要替换现有 Release 资产。
2. 先用当前本地 ZIP 在真实 Edge 中验收目标论文第 6—7 页：检查整图/整表边界、视觉模型实际输出、整对象高亮、切屏后台继续和导出结果。
3. 验收无阻塞后，由用户决定这些发布后修复的新版本号（建议补丁版）；提升版本并生成新的候选包后，才可考虑新 tag、GitHub Release 或 Edge 商店提交，所有发布动作仍需单独授权。

当前优先级仍是图表语义对象的真实模型实机验收，不是新增低价值功能。验收和后续发布稳定后，可优先拆分 `entrypoints/pdf/main.ts`、`entrypoints/background.ts`、`core/content/bilingual-page-translator.ts` 和巨型 E2E 文件，并单独验证 WXT 升级。

## 7. 新会话检查顺序

```powershell
Set-Location 'F:\research-papers\2026\July\Pi_translate'
Get-Content docs/development-handoff-v0.15.0.md
git status --short --branch
git log -7 --oneline
node -p "require('./package.json').version"
npm run check:release
npm run check:secrets
Get-FileHash -Algorithm SHA256 .output/tex-selection-translator-0.15.0-edge.zip
```

`check:release` 验证并重新生成当前本地发布后验证包；已经公开发布的 v0.15.0 Release 资产仍是上表云端最终包。任何 HEAD、工作区、ZIP 大小或哈希不一致都应先查明原因，不得重置或覆盖用户内容。
