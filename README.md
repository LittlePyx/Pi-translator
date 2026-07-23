# Pi Translator

Pi Translator 是由 P&I Lab 开发的 Microsoft Edge Manifest V3 扩展，用于翻译 Overleaf 或普通网页中选中的文本。它支持 DeepSeek API、自定义模型、LaTeX 结构保护、浮动翻译卡片、右键菜单和快捷键。

## 当前功能

- Overleaf 划词后显示翻译按钮。
- 普通网页右键或快捷键按需翻译，默认不申请所有网站的长期权限。
- 可选择仅 Overleaf、普通网页按需、指定网站自动启用或所有网站自动启用。
- DeepSeek 模型预设以及自定义模型名称。
- 使用当前 API Key 自动读取 DeepSeek 可用模型。
- 源语言、目标语言、翻译风格和内容模式设置。
- 工具栏快速面板可切换目标语言，并临时暂停当前网站的自动划词。
- 全局学术术语表可固定论文术语翻译。
- 普通网页高置信度判断选区已是目标语言时，可自动隐藏浮动按钮。
- 自动、纯文本和 LaTeX 三种内容模式。
- API Key 默认仅保存到浏览器会话，也可选择本机持久保存。
- 复制译文、复制原文和译文、重新翻译。
- 翻译卡片支持拖动，`Escape` 可关闭并取消进行中的请求。
- `Alt+Shift+T` 有选区时翻译，无选区或页面不支持注入时打开设置页。
- 使用 Pi Translator 与 P&I Lab 官方 Logo；网页浮层根据页面实际明暗主题自动适配。
- 默认不保存翻译历史，不自动替换网页或 Overleaf 原文。

## 加载扩展

```powershell
npm install
npm run build:edge
```

然后在 Edge 中：

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择 `.output/edge-mv3`。

代码更新后需要在扩展管理页点击“重新加载”，并刷新已经打开的网页。

## 普通网页权限

默认的“按需翻译”模式只在用户点击右键菜单或按快捷键时，通过 `activeTab` 临时访问当前页面。

“指定网站”和“所有网站”模式用于持续显示划词按钮，保存设置时 Edge 会显示相应的网站权限请求。切换回“按需翻译”会停止自动注入；已经授予的网站权限可在 Edge 扩展详情页中手动管理。

浏览器内部页面、扩展商店及其他禁止脚本注入的页面无法翻译。

## 开发与验证

```powershell
npm run typecheck
npm test
npm run build:edge
npm run zip:edge
```

详细设计见 [Edge MVP 设计文档](docs/edge-translation-extension-design.md)、[v0.2 普通网页扩展设计](docs/v0.2-general-web-design.md)、[v0.3 交互设计](docs/v0.3-interaction-design.md) 和 [v0.4 发布设计](docs/v0.4-release-design.md)。

## 隐私与密钥

只有用户主动触发翻译的选中文本和已配置的相关术语约束会发送到 DeepSeek。API Key 不会注入网页，也不会打包进源码。请不要把真实 API Key 提交到 Git 仓库。

完整说明见 [隐私政策](PRIVACY.md)。上架材料见 [Edge Add-ons 提交材料](docs/edge-store-submission.md)。
