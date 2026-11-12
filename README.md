# Pi Translator（PI划词翻译器）

在 Microsoft Edge 里读外文。网页上的一句话可以划词翻译，整段可以中英对照。在 Overleaf 里可以边看源码边查句子，在 PDF 里可以对照译文读论文、标记原句，再从笔记回到出处。

[安装 Edge 扩展](https://microsoftedge.microsoft.com/addons/detail/edfkcddhenkhdkedhnmcebmmfacabcjf) · [首次设置](#首次设置) · [网页阅读](#网页阅读) · [Overleaf](#overleaf) · [科研阅读图解](#科研阅读图解) · [文档库与笔记](#文档库与笔记)

## 网页阅读

### 查一句

MIT Missing Semester 的 Git 讲义画了一幅提交历史图。箭头指向父提交，第三个提交处分出了两条线。选中图下解释分支的那句话，点选区旁的翻译按钮，就能一边看中文，一边顺着图读。连续查词时，可以从卡片切到侧栏。[查看讲义中的提交历史图](https://missing.csail.mit.edu/2026/version-control/#modeling-history-relating-snapshots)

![Git 提交分支图下方选中了讲解第三次提交的英文句子，Pi 卡片显示对应中文](docs/images/article-selection.png)

### 对照读一段

在同一篇讲义的 *Snapshots* 一节，分别翻译目录树上下的两段英文。上面一段解释 blob 和 tree，下面一段说明 `bar.txt` 属于子树 `foo`。两段之间保留着原页上的目录树，可以顺着缩进核对。要通读整篇，从扩展面板点 **翻译网页正文**。[查看讲义中的目录树](https://missing.csail.mit.edu/2026/version-control/#snapshots)

![Snapshots 的两段英文下方各有对应中文，中间是原讲义的 Git 目录树](docs/images/article-bilingual.png)

## Overleaf

Roshan Mammen Abraham 等人的论文 *Tau Neutrinos in the Next Decade: from GeV to EeV* 有公开的 Overleaf 只读项目。打开理论部分，左侧源码第 23 行的公式给出振荡振幅的估计值，约为 0.95。选中公式后那句关于三个实验的说明，就能看到中文。右侧编译稿第 15 页第一段是它的出处。[打开 Overleaf 项目](https://www.overleaf.com/read/khpgmxpdccwv) · [期刊论文](https://doi.org/10.1088/1361-6471/ac89d2)

![Overleaf 只读编辑器中，左侧源码包含振荡公式与选中句的中文卡片，右侧 PDF 显示对应的排版结果](docs/images/overleaf-manuscript.png)

## 科研阅读图解

下面三步都用同一篇论文。Thivin Anandh、Divij Ghose 和 Sashikumaar Ganesan 的 *FastVPINNs* 介绍了如何用神经网络求解偏微分方程。[期刊原版 PDF](https://joss.theoj.org/papers/10.21105/joss.06764.pdf) · [论文与 DOI](https://doi.org/10.21105/joss.06764)

### 在原页旁读正文译文

从扩展面板点 **打开 PDF 阅读器**，选择论文。点 **译全文**，选择整篇、当前页或指定页码，再点 **开始翻译**。图中翻译了第 3 页。点右侧讲 hp-VPINNs 如何求解 PDE 的译段，左侧会标出对应英文，下面的模块图也可以一起看。

![FastVPINNs 第 3 页，左侧是英文段落与模块图，右侧是对应中文](docs/images/paper-body.png)

<details>
<summary>查看翻译范围与单段试译入口</summary>

![全文翻译面板已读取五页 PDF，翻译范围为整篇文档](docs/images/paper-range.png)

只想先看一个段落的译法，可以展开 **先试译一段**。

</details>

### 框选方程与边界条件

回到第 1 页，点工具栏的**虚线方框**，把式（1）的泊松方程和式（2）的边界条件一起框住。确认右侧的区域符号也在框内，再点 **发送并翻译**。这一步使用支持图像输入的模型。

![原论文的两行方程和区域符号完整落在选框内，框下方显示发送按钮](docs/images/paper-formula.png)

<details>
<summary>查看这两行公式的识别结果</summary>

<img src="docs/images/paper-equation-result.png" alt="公式识别卡片显示第 1 页的泊松方程和边界条件" width="440">

展开「查看识别原文」可逐项核对负号、上标和边界符号 ∂Ω。

</details>

### 约定本文的术语

想让 *partial differential equations* 在这篇论文里统一译为“偏微分方程”，打开 **译全文 → ··· → 检查术语 → 本文术语**，填入原词和译法，点 **保存词条**。后续翻译会优先使用本文约定。已有译段可以在「检查术语」中逐段核对。

<img src="docs/images/paper-term.png" alt="本文术语列表中已保存 partial differential equations 对应的约定译法“偏微分方程”" width="561">

<a id="功能介绍"></a>

## 文档库与笔记

在 PDF 中选中原句，点 **高亮 / 笔记**，写下自己的理解。下次只记得中文也能找到这段话。例如，在文档库搜“路面温度”，就能找到给街道测温示例写的笔记。点 **定位原 PDF**，回到原句所在的第 1 页。

![文档库按中文笔记“路面温度”找到英文摘录、页码和定位原 PDF 的入口](docs/images/find-note.png)

<details>
<summary>查看写笔记和返回原句的界面</summary>

<img src="docs/images/write-note.png" alt="在英文摘录旁记下“区分路面温度与气温”" width="496">

![返回示例 PDF 后，原句在第 1 页被标出](docs/images/source-mark.png)

</details>

资料可以按项目和标签筛选。再次打开文档时，阅读回顾会列出上次停留位置附近的标记和最近修改的笔记。需要整理多条笔记时，可以勾选要纳入的内容生成小结，再沿小结中的出处回读。

<details>
<summary>查看文档库</summary>

![文档库中的演示资料、筛选和阅读入口](docs/images/library.png)

</details>

<a id="快速上手"></a>

## 首次设置

1. 安装扩展，点 Edge 工具栏中的 Pi 图标，选择用途和目标语言。[Edge 扩展商店](https://microsoftedge.microsoft.com/addons/detail/edfkcddhenkhdkedhnmcebmmfacabcjf)
2. 选择文字服务商，填写自己的 API Key 和模型。可选 DeepSeek、Qwen、OpenAI、Anthropic、Gemini、OpenRouter、本机 Ollama 或自定义兼容接口。保存后即可开始划词。需要验证配置时，点 **测试连接** 会发送一次示例请求。
3. 第一次在普通网页使用持续划词，按提示授权网站访问。也可以使用右键菜单或 `Alt+Shift+T` 翻译选区。若某个网站上没有按钮，可在扩展面板检查该站点是否已授权、是否暂停了划词。

文字翻译配置好就能读网页和有文字层的 PDF。需要框选公式、图片或网页截图时，再到设置中配置图像模型。扫描页的 OCR 有单独的配置入口。

<details>
<summary>研究领域和术语方案</summary>

在 **翻译偏好** 填写研究领域，Pi 会在本机推荐已有的术语方案，由你确认应用。也可以选择让翻译参考研究领域，之后相关请求会将领域名称发给所选服务商。某篇文稿有自己的约定时，优先采用本文术语。

![翻译偏好中的用途、研究领域和术语设置](docs/images/preferences.png)

</details>

## 隐私与备份

笔记、术语和阅读位置保存在本机。原 PDF 可以在文档库中选择保留副本，导出备份时再选择是否包含原件。导入前可以预览恢复范围。

划词和段落翻译会将所选文本发给你配置的服务商。框选翻译发送确认后的图像区域，笔记小结发送勾选的笔记。费用由所选服务商决定。[隐私政策与权限说明](PRIVACY.md)

## 从源码运行

使用 Node.js 24 和 npm 构建 Edge 扩展。

```bash
git clone https://github.com/LittlePyx/Pi-translator.git
cd Pi-translator
npm ci
npm run build:edge
```

在 `edge://extensions` 开启开发人员模式，点 **加载解压缩的扩展**，选择 `.output/edge-mv3`。更新源码并重新构建后，在同一张扩展卡片上点重新加载，再刷新已打开的网页。

```bash
npm run typecheck
npm test
npm run test:e2e       # 需要本机 Microsoft Edge
npm run check:secrets
```

反馈时请附上复现步骤、预期结果和实际表现，并隐去密钥和私人资料。[提交问题](https://github.com/LittlePyx/Pi-translator/issues) · [验证报告](docs/verification-report.md) · [PDF 翻译问题台账](docs/pdf-translation-issues.md) · [更新记录](CHANGELOG.md)

<details>
<summary>截图与素材来源</summary>

- Git 讲义截自 MIT Missing Semester 的 *Version Control and Git*，截图中的中文节选沿用讲义许可。[原页](https://missing.csail.mit.edu/2026/version-control/#snapshots) · [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- Overleaf 截图来自 Abraham 等人的公开论文项目。科研阅读截图来自 Anandh、Ghose 和 Ganesan 的 *FastVPINNs*，公式图截取了第 1 页局部。[中微子论文](https://doi.org/10.1088/1361-6471/ac89d2) · [FastVPINNs](https://doi.org/10.21105/joss.06764) · [CC BY 许可](https://creativecommons.org/licenses/by/4.0/)
- 配图使用实际扩展界面。中文译文和公式识别结果由离线演示接口提供，街道测温笔记使用示例资料。

</details>

由 P&I Lab 开发。
