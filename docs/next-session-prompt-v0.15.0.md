# Pi Translator 新会话交接 Prompt

将下面整段复制到新的 Codex 任务中：

```text
继续维护 Pi Translator。项目位于 F:\research-papers\2026\July\Pi_translate，当前分支 main。请先完整阅读 docs/development-handoff-v0.15.0.md，再检查 git status、最近提交、package 版本和候选包，不要直接新增功能。

当前功能基线为 55e247a，其后为交接、v0.15.0 发布元数据和真实 Edge CI 交互稳定性修复；代码候选为 13422d7。package 版本为 0.15.0；最终候选包是 GitHub Actions 运行 33472574136 生成的 .output/final-ci/tex-selection-translator-0.15.0-edge.zip，大小 1,150,261 bytes，SHA-256 为 2BF94E9E787B462772284B37180142BAC3D8442F115348B8983C73965A3BD372。本地 check:release-artifact 会复现一个内容等价但受 Windows checkout 换行格式影响的 .output/tex-selection-translator-0.15.0-edge.zip（1,150,427 bytes，SHA-256 4846AB38EAA54230E6FB6F357BDBE356828268EDB29C2B0696C2A89B55EDFF19），不能误拿它覆盖云端最终包。最终候选已通过 Node 24、TypeScript、666/666 单元测试、124/124 Edge E2E、生产构建、密钥扫描、生产依赖在线审计、发布包逐文件一致性和精确 ZIP 的真实 Edge 安装级烟测。

GitHub 已存在公开 v0.14.0 tag 和 Release，指向旧提交 0d0428c；不得移动或覆盖。v0.15.0 已正式发布：SSH 签名 tag 指向 40a51bf，GitHub 验证为 valid；GitHub Release 的正式资产重新下载后仍为 1,150,261 bytes，SHA-256 为 2BF94E9E787B462772284B37180142BAC3D8442F115348B8983C73965A3BD372。尚未提交 Edge 商店，下一步应在单独获得用户授权后按现有审核材料提交，不要在审核前增加低价值功能。

必须保留这些产品规则：普通网页自动划词过滤高置信度目标语言和纯代码；固定侧栏代表明确翻译意图，混合自然语言和代码仍翻译；普通划词使用文字接口，用户主动框选网页始终使用多模态接口；网页截图、扫描页 OCR 和视觉识别必须由用户确认；全文预览、范围调整、取消和显示模式切换零请求；公式、代码、表单和未成功段落不能在只看译文时消失；不自动替换原文；不引入 Pi 账号、自有后端或遥测。

store-assets/ads/ 下有用户的未跟踪广告素材。不要删除、移动、修改或加入提交。只处理本任务明确涉及的文件；若 HEAD、候选包哈希或工作区状态与交接不一致，先查清原因并说明，不要重置或覆盖现有内容。
```
