# Pi Translator 发布前验收清单

预计人工验收约 7 分钟。本文始终适用于 `package.json` 中准备发布的当前版本，不在文档中写死版本号。

## 0. 确认候选版本与工作区

```powershell
$releaseVersion = (Get-Content package.json | ConvertFrom-Json).version
$packagePath = ".output/tex-selection-translator-$releaseVersion-edge.zip"
$certificationNotesPath = "docs/edge-certification-notes-v$releaseVersion.txt"
git status --short --branch
```

- `package.json`、`package-lock.json`、扩展清单、`CHANGELOG.md` 标题和发布说明必须使用同一版本。
- `$certificationNotesPath` 必须存在；真实审核 API Key 只能粘贴到 Partner Center，不能保存进仓库。
- 广告源文件和导出图不是扩展发布提交的一部分，不得意外加入暂存区或 ZIP。
- 使用 Node.js 24；`.node-version` 是本地与 CI 的版本基准。

## 1. 自动化验证

```powershell
npm ci
npm run check:secrets
npm run typecheck
npm test
npm run test:e2e
npm run check:release
```

`check:release` 会重新生成 `$packagePath`，并核对源码版本、构建清单、Manifest V3、ZIP 路径、文件清单、内容及 SHA-256。任何一步失败都不能创建 tag 或上传商店。

## 2. 网页与 Overleaf 翻译

1. 在 Overleaf 选中一句英文，确认小型 Pi 按钮出现，取消选区后按钮消失。
2. 点击按钮，确认译文能够流式显示；翻译过程中固定到侧栏，流式输出应继续。
3. 在普通网页选中文字，通过右键菜单和快捷键各翻译一次。
4. 打开浏览器侧栏，连续翻译两个选区，确认最近译文导航不会重复调用 API。

通过标准：没有重复按钮；关闭卡片或点击页面空白处后菜单正确收起；浮层与浏览器侧栏不会同时遗留冲突状态。

## 3. 网页区域框选

1. 打开浏览器侧栏，确认空状态和已有译文状态的顶部都显示“框选网页”；点击后在普通文章文字上拖出选框并调整位置与四角尺寸。工具栏快捷面板的“框选网页区域”仍应可用。
2. 确认界面应优先显示本地提取文字；不切换模式时不得截图。
3. 在图像或 Canvas 上框选，确认只有再次点击发送后才提交局部截图。
4. 在包含密码、验证码或支付字段的区域框选，确认发送被阻止。
5. 从成功结果和失败提示分别进入“调整区域”，确认恢复原矩形及文字/截图模式；进入“重新框选”时应从空白开始。两种入口在再次确认前都不得请求 API。
6. 从空白框选界面按 `Enter` 建框，以方向键移动、`Shift + 方向键` 缩放、`Ctrl + 方向键` 细调；按 `Escape` 取消并确认不产生翻译请求。
7. 确认不存在整页、自动滚动或连续截图入口。

通过标准：发送内容与确认界面一致，截图只覆盖当前可见页中的选框范围。

## 4. Pi PDF 文字、框选与导航

1. 打开一份含文字层的论文，划选跨行句子并翻译。
2. 打开右侧翻译栏，确认 PDF 在剩余区域居中；关闭侧栏后恢复全宽居中。
3. 点“框选翻译”，在含文字层区域框选一次，应优先提取文字；在扫描页框选时才调用视觉 API。
4. 缩放一次，确认当前页和大致阅读位置保持不变。
5. 翻译一句后添加轻标记，打开“查看本文标记”，测试定位、复制、删除和重新打开后的恢复。

通过标准：文字清晰、选区可调整、工具栏没有重复入口或遮挡；无法定位的旧标记明确显示“原文位置已变化”。

## 5. Edge 原生 PDF

1. 用 Edge 原生阅读器打开 PDF，选中文字后右键“使用 Pi Translator 翻译选中文本”。
2. 确认译文在 Edge 原生侧边栏流式显示。
3. 切到其他标签页后侧边栏不跟随；切回原 PDF 时会话仍属于原文档。

## 6. 设置、安全与发布文件

1. 从结果菜单打开完整设置，确认新标签页正常出现。
2. 测试当前 API 连接和模型读取；视觉模型可用时确认自动绑定。
3. 导出配置，确认文件不包含 API Key。
4. 核对 `$packagePath`、`$certificationNotesPath` 和 `docs/edge-store-submission.md`。
5. 用 `git diff --cached --name-only` 再次确认提交中没有广告素材、密钥、`.env`、测试报告或构建目录。
6. 安装最终 ZIP 并重复网页文字翻译与网页区域框选的最短路径；只有该 ZIP 通过后才创建签名 tag 和 GitHub Release。
