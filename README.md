# Pi Translator（PI划词翻译器）

适用于 Microsoft Edge 的翻译扩展。支持网页划词与原位双语、Overleaf 源码划词、PDF 全文对照和批注。翻译使用你配置的 API。

[安装 Edge 扩展](https://microsoftedge.microsoft.com/addons/detail/edfkcddhenkhdkedhnmcebmmfacabcjf) · [首次设置](#首次设置) · [网页阅读](#网页阅读) · [Overleaf](#overleaf) · [科研阅读图解](#科研阅读图解) · [文档库与笔记](#文档库与笔记)

## 网页阅读

### 划词翻译

选中文字，点选区旁的翻译按钮。连续查词时，可以从译文卡片切到侧栏。

![Git 讲义中选中的英文句子和旁边的中文译文卡片](docs/images/article-selection.png)

### 原位双语

在扩展面板点 **翻译网页正文**，译文会出现在原段落下方。只想翻译其中一段，可以在设置中开启 **单段快捷翻译**，选用 `Alt + 单击` 或 `Shift + 单击`。

![Git 讲义中两段英文各有对应中文，中间保留原页的目录树](docs/images/article-bilingual.png)

## Overleaf

在 LaTeX 源码中选中要翻译的句子，点翻译按钮。译文在编辑器内打开，右侧仍可对照编译后的公式。[打开示例论文项目](https://www.overleaf.com/read/khpgmxpdccwv)

![Overleaf 左侧源码中的选区和中文译文，右侧为同一段的 PDF 编译预览](docs/images/overleaf-manuscript.png)

## 科研阅读图解

### PDF 全文翻译

从扩展面板点 **打开 PDF 阅读器**，选好文件，点 **译全文**。选择整篇、当前页或指定页码，点 **开始翻译**。阅读时，点右侧译段即可定位左侧原文。[下载示例论文 FastVPINNs](https://joss.theoj.org/papers/10.21105/joss.06764.pdf)

![FastVPINNs 第 3 页，左侧高亮英文段落，右侧显示对应中文](docs/images/paper-body.png)

<details>
<summary>翻译范围与「先试译一段」入口</summary>

![全文翻译面板的页码范围和单段试译入口](docs/images/paper-range.png)

</details>

### 公式框选

点工具栏的**虚线方框**，框住公式和相关条件，点 **发送并翻译**。公式识别需要支持图像输入的模型。

![选框覆盖泊松方程、边界条件和区域符号](docs/images/paper-formula.png)

<details>
<summary>公式识别结果</summary>

<img src="docs/images/paper-equation-result.png" alt="公式识别卡片中的泊松方程和边界条件" width="440">

点 **查看识别原文** 可核对符号和上下标。

</details>

### 本文术语

打开 **译全文 → ··· → 检查术语 → 本文术语**，填入原词和约定译法，点 **保存词条**。后续翻译优先使用本文术语，已有译段可在「检查术语」中核对。

<img src="docs/images/paper-term.png" alt="已保存的本文术语 partial differential equations 及其约定译法“偏微分方程”" width="561">

<a id="功能介绍"></a>

## 文档库与笔记

在 PDF 中选中原句，点 **高亮 / 笔记** 写下批注。在文档库搜索笔记里的词，点 **定位原 PDF** 即可回到原句。

![搜索“路面温度”后找到的笔记、英文摘录和定位原 PDF 按钮](docs/images/find-note.png)

<details>
<summary>添加笔记与返回原句</summary>

<img src="docs/images/write-note.png" alt="在英文摘录旁写下中文笔记" width="496">

![返回 PDF 后，笔记对应的原句在第 1 页高亮](docs/images/source-mark.png)

</details>

文档库支持按项目和标签筛选。重开文档时，阅读回顾会列出上次停留处附近的标记和最近修改的笔记。勾选笔记可生成带出处的小结。

<details>
<summary>文档库界面</summary>

![文档库中的筛选和继续阅读入口](docs/images/library.png)

</details>

<a id="快速上手"></a>

## 首次设置

1. 安装后点 Edge 工具栏的 Pi 图标，选择用途和目标语言。
2. 选择文字服务商，填写模型和所需的 API Key，保存。支持 DeepSeek、Qwen、OpenAI 等服务商，也支持本机 Ollama 和自定义兼容接口。点 **测试连接** 会发送一次示例请求。
3. 首次在普通网页划词时，按提示授权网站访问。若按钮未出现，可在扩展面板检查当前网站的授权和划词开关，也可用右键菜单或 `Alt+Shift+T` 翻译选区。

框选公式、图片或网页截图时再配置图像模型。扫描页使用单独的 OCR 设置。

<details>
<summary>研究领域和术语方案</summary>

在 **翻译偏好** 填写研究领域，可获得本机已有术语方案的推荐，确认后应用。启用「后续翻译参考此领域」后，领域名称会随相关翻译请求发送给服务商。

![翻译偏好中的用途、研究领域和术语设置](docs/images/preferences.png)

</details>

## 隐私与备份

笔记、术语和阅读位置保存在本机。可在文档库保留原 PDF 副本，导出备份时选择是否包含原件，导入前预览恢复范围。

文字翻译发送待译文本，框选翻译发送确认后的图像区域，笔记小结发送勾选的笔记。请求由你配置的服务商处理并按其规则计费。[隐私政策与权限说明](PRIVACY.md)

## 从源码运行

需要 Node.js 24 和 npm。

```bash
git clone https://github.com/LittlePyx/Pi-translator.git
cd Pi-translator
npm ci
npm run build:edge
```

在 `edge://extensions` 开启开发人员模式，点 **加载解压缩的扩展**，选择 `.output/edge-mv3`。重新构建后，重新加载扩展并刷新网页。

```bash
npm run typecheck
npm test
npm run test:e2e       # 需要本机 Microsoft Edge
npm run check:secrets
```

反馈问题时请附复现步骤，隐去密钥和私人资料。[提交问题](https://github.com/LittlePyx/Pi-translator/issues) · [验证报告](docs/verification-report.md) · [PDF 翻译问题台账](docs/pdf-translation-issues.md) · [更新记录](CHANGELOG.md)

<details>
<summary>截图与素材来源</summary>

- 网页截图取自 MIT Missing Semester 的 *Version Control and Git*，中文节选沿用原讲义许可。[提交历史](https://missing.csail.mit.edu/2026/version-control/#modeling-history-relating-snapshots) · [快照](https://missing.csail.mit.edu/2026/version-control/#snapshots) · [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- Overleaf 论文为 Abraham 等人的 *Tau Neutrinos in the Next Decade: from GeV to EeV*。PDF 示例为 Anandh、Ghose 和 Ganesan 的 *FastVPINNs*，公式图截取自第 1 页。[中微子论文](https://doi.org/10.1088/1361-6471/ac89d2) · [FastVPINNs](https://doi.org/10.21105/joss.06764) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 截图中的中文译文和公式识别结果由离线演示接口提供。街道测温笔记为示例资料。

</details>

由 P&I Lab 开发。
