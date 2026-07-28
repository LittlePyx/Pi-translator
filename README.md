# Pi Translator

Pi Translator 是由 P&I Lab 开发的 Microsoft Edge Manifest V3 扩展，用于翻译 Overleaf 或普通网页中选中的文本。它支持用户自备的 OpenAI 兼容 API、LaTeX 结构保护、浮动翻译卡片、右键菜单和快捷键。

## 当前功能

- Overleaf 划词后显示翻译按钮。
- 普通网页右键或快捷键按需翻译，默认不申请所有网站的长期权限。
- 可选择仅 Overleaf、普通网页按需、指定网站自动启用或所有网站自动启用。
- 自定义 API Base URL、API Key 和模型名称，可接入采用 OpenAI Chat Completions 协议的服务。
- 最多保存 6 组 API 配置，并从工具栏快速切换。
- 使用当前 API Key 自动读取接口可用模型。
- 兼容性诊断会检查模型列表、鉴权、对话接口、结构化输出和逐句能力。
- 源语言、目标语言、翻译风格和内容模式设置。
- 工具栏快速面板可切换目标语言，并临时暂停当前网站的自动划词。
- 普通网页高置信度判断选区已是目标语言时，可自动隐藏浮动按钮。
- 自动、纯文本和 LaTeX 三种内容模式。
- API Key 默认仅保存到浏览器会话，也可选择本机持久保存。
- 复制译文、复制原文和译文、重新翻译。
- 完整译文与逐句对照即时切换；逐句原文来自本地选区，不由模型回写。
- 可把结果固定为页面侧栏；固定后新选区会自动翻译，侧栏可收起、调整宽度和切换左右位置。
- 当前标签页最近 5、10 或 20 条翻译可上下切换、固定、删除或导出 Markdown。
- 相同选区和设置可命中会话缓存，也可强制忽略缓存重新翻译。
- 普通文本在兼容接口上可流式显示；限流、暂时性网络错误和服务端错误会自动退避重试。
- 长文本自动按句子或段落安全拆分，侧栏显示分段进度；新选区会取消已经过时的请求。
- 可选“所在句子”或“所在段落”作为消歧上下文，默认关闭且上下文不会进入译文。
- 翻译结果可主动收藏到本机，并在侧栏内搜索原文、译文或来源网站。
- 连续翻译默认跳过密码、验证码和支付字段，并可从侧栏更多菜单暂停当前网站。
- 提供 DeepSeek、OpenRouter 和本机 Ollama 接口预设，同时保留完全自定义配置。
- 新安装时通过三步向导选择接口、授权 API 域名并读取可用模型；设置页可随时重新运行向导。
- 可导出和导入不含 API Key 的安全配置文件；导入后会清除旧 Key，避免误发给新接口。
- 可复制本地诊断报告用于排查问题；报告不包含 API Key、选区、译文、页面地址、术语或网站名称。
- 逐句对照支持联动高亮、单句复制和单句重新翻译。
- 翻译卡片支持拖动，`Escape` 可关闭并取消进行中的请求。
- `Alt+Shift+T` 有选区时翻译，无选区或页面不支持注入时打开设置页。
- 使用 Pi Translator 与 P&I Lab 官方 Logo；网页浮层根据页面实际明暗主题自动适配。
- 不自动替换网页或 Overleaf 原文。

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
npm run check:secrets
npm run test:e2e
npm run build:edge
npm run zip:edge
```

GitHub Actions 会在每次提交和拉取请求中自动执行密钥扫描、类型检查、单元测试、真实 Edge 端到端测试、构建与打包。宣传截图生成使用独立的 `npm run test:marketing`，不会混入功能回归测试。

详细设计见 [Edge MVP 设计文档](docs/edge-translation-extension-design.md)、[v0.5 历史记录、逐句对照与兼容 API 设计](docs/v0.5-history-alignment-api-design.md)、[v0.6 连续翻译侧栏与稳定性设计](docs/v0.6-continuous-sidebar-design.md)、[v0.7 稳定性、上下文与收藏设计](docs/v0.7-stability-context-favorites-design.md) 和 [v0.7.1 首次向导、支持工具与 CI 设计](docs/v0.7.1-onboarding-support-ci-design.md)。

## 隐私与密钥

只有用户主动触发翻译的选中文本和已配置的相关翻译约束会发送到用户指定的 API。API Key 不会注入网页，也不会打包进源码。请不要把真实 API Key 提交到 Git 仓库。

完整说明见 [隐私政策](PRIVACY.md)。上架材料见 [Edge Add-ons 提交材料](docs/edge-store-submission.md)。
