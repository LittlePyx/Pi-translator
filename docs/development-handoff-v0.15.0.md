# Pi Translator v0.15.0 开发交接

更新时间：2026-09-01

## 1. 当前状态

| 项目 | 当前值 |
| --- | --- |
| 仓库 | `F:\research-papers\2026\July\Pi_translate` |
| 分支 | `main`；发布准备和随后发现的 CI 稳定性修复均已推送 |
| 功能基线 | `55e247a docs: prepare v0.14.0 release candidate`；其后为交接、v0.15.0 发布元数据和两项 CI 稳定性修复 |
| 当前版本 | `0.15.0` |
| 最终发布候选 | `.output/final-ci/tex-selection-translator-0.15.0-edge.zip`（来自 GitHub Actions） |
| 最终 ZIP 大小 | 1,149,132 bytes |
| 最终 SHA-256 | `F59C7CDC983A12CABAC8E7C8DF25C22CE77DBBF4004F7B07FDE2A40A181604AB` |
| 本地复现包 | `.output/tex-selection-translator-0.15.0-edge.zip`；1,149,297 bytes；`8104ED255115B23BA415000A2F83B2CE83E3246D8CDD81219023A39516DB3D41` |
| ZIP 内容 | 33 项，Manifest V3；CI 包已通过云端逐文件一致性门禁 |
| 发布状态 | 当前代码已通过云端 CI；未创建 `v0.15.0` tag、GitHub Release 或 Edge 商店提交 |

`store-assets/ads/` 下仍有用户的未跟踪广告素材。它们不属于本轮代码或发布提交，禁止删除、移动、修改或加入暂存区。

## 2. 版本治理结论

GitHub 已存在公开 `v0.14.0` tag 和 Release，tag 指向旧提交 `0d0428c`，其 ZIP 为较早的 1,112,382-byte 候选。后续本地 19 个功能提交加入了 PDF 全文翻译、扫描页 OCR、范围控制、暂停继续、导出、结果保留和超长网页完整翻译，因此当前候选按 minor release 调整为 `v0.15.0`。不得移动、覆盖或复用既有 `v0.14.0` tag。

发布准备首先只调整了版本、发布说明、验收记录和三个开发工具链传递依赖。第一次云端 CI 随后暴露两个 Windows Edge 差异：划词关闭按钮的装饰星标会在 hover 动画中抢占指针，以及 PDF 侧栏的 14px 断言没有容纳半像素字体舍入。最终候选修正了关闭按钮的真实命中层级，并把测试舍入余量放宽 1px；没有改变翻译、请求或隐私规则。

## 3. 已完成能力与必须保留的产品规则

- 普通网页、Overleaf、网页固定侧栏和 Edge 浏览器侧栏支持划词翻译。被动入口过滤高置信度目标语言和纯代码；固定侧栏代表明确意图，混合自然语言与代码仍翻译。
- 普通划词始终使用文字接口；用户主动“框选网页”始终使用多模态接口，不因框内可提取文字而降级。
- 网页截图、扫描页 OCR 和视觉识别必须由用户明确触发并确认；敏感表单区域禁止发送。
- 超过 100 段的网页先显示零请求确认、请求估算和“全部正文 / 当前章节 / 从当前位置”预设；预览、范围调整、取消和显示模式切换零请求。
- 网页与 PDF 全文翻译支持暂停、继续、停止、重试、恢复、范围控制和导出；公式、代码、表单及未成功段落不能在“只看译文”时消失。
- PDF 全文预览只在本地读取文字层；扫描页不自动 OCR，只有用户明确启动后才发送页面图像，并可中途停止。
- 不自动替换网页、Overleaf 或 PDF 原文；不引入 Pi 账号、自有后端或遥测。

## 4. v0.15.0 验证结果

- Node.js：官方 Windows x64 `v24.19.0`，下载包 SHA-256 与 Node 官方清单一致。
- 密钥和私钥模式扫描：通过。
- TypeScript 类型检查：通过。
- Vitest：666/666，通过，共 99 个测试文件。
- Microsoft Edge E2E：124/124，通过，Edge `151.0.4129.101`。
- Edge MV3 生产构建：通过，约 3.77 MB。
- 发布包一致性：通过；33 项，与生产构建逐文件一致。
- GitHub Actions：通过；云端再次完成密钥扫描、类型检查、666/666 单元测试、构建、124/124 真实 Edge E2E、打包、逐文件一致性和已验证 artifact 上传。
- 生产依赖在线安全审计：0 个漏洞。
- 开发工具链在线安全审计：非破坏性更新已修复 3 项；剩余 10 项位于 WXT / web-ext-run 等开发依赖，不进入扩展包。需要 WXT 破坏性升级的部分留待发布后单独分支验证。

本地复现包与云端最终包的 33 个条目、路径和 Manifest 完全一致；27 个可执行、样式和运行时条目字节完全一致。其余 6 个静态文本条目只受 Windows checkout 的换行和空行格式影响，忽略这些格式后逐行内容完全一致。最终采用云端通过门禁并上传的 artifact，避免把未经云端验证的本地字节作为 Release 资产。

云端最终 ZIP 还从解压目录直接加载到真实 Edge：Manifest V3、版本 `0.15.0`，设置页 API 配置控件、快捷面板和 Pi PDF 均正常，页面错误为 0。完整实机验收已覆盖：

1. 普通网页划词和纯代码被动过滤。
2. 网页框选渲染公式并确认走多模态、无文字接口回退。
3. 520 段网页的零请求确认、三个范围预设与全文完成。
4. PDF 全文预览、页码范围、暂停/继续、返回原文和导出。
5. 扫描 PDF 不自动 OCR，明确启动后才发送图像，并可停止。

## 5. 下一步

1. 检查当前候选提交不包含 `.output/`、广告素材或凭证，并确认文档收尾后的 HEAD GitHub Actions 仍为绿色。
2. 再次取得用户授权后，创建签名 `v0.15.0` tag、GitHub Release，并上传 `.output/final-ci/` 中的标准文件名 ZIP；旧 `0d0428c` 和第一次 v0.15.0 失败运行不能作为发布依据。
3. 上传前再次核对 Release 资产的大小和 SHA-256 与本文一致。
4. 最后按审核材料提交 Edge 商店；真实审核 Key 只能填写到 Partner Center，不得保存进仓库。

发布前不要开始架构重构、国际化或新功能。发布完成后，可优先拆分 `entrypoints/pdf/main.ts`、`entrypoints/background.ts`、`core/content/bilingual-page-translator.ts` 和巨型 E2E 文件，并单独验证 WXT 升级。

## 6. 新会话检查顺序

```powershell
Set-Location 'F:\research-papers\2026\July\Pi_translate'
Get-Content docs/development-handoff-v0.15.0.md
git status --short --branch
git log -4 --oneline
node -p "require('./package.json').version"
npm run check:release-artifact
npm run check:secrets
Get-FileHash -Algorithm SHA256 .output/final-ci/tex-selection-translator-0.15.0-edge.zip
```

`check:release-artifact` 验证本机重新构建的复现包；真正用于 Release 的是上表云端最终包。任何 HEAD、工作区、ZIP 大小或哈希不一致都应先查明原因，不得重置或覆盖用户内容。
