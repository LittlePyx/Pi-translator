# Pi Translator：Microsoft Edge Add-ons 提交材料

> 适用版本：`package.json` 中准备发布的当前版本。本文不写死版本号；上传前按下面的命令解析并核对文件。

## 1. 上传文件

```powershell
$releaseVersion = (Get-Content package.json | ConvertFrom-Json).version
$packagePath = ".output/tex-selection-translator-$releaseVersion-edge.zip"
$certificationNotesPath = "docs/edge-certification-notes-v$releaseVersion.txt"
@($packagePath, $certificationNotesPath) | ForEach-Object { "$_ : $(Test-Path -LiteralPath $_)" }
```

- 扩展包：上述 `$packagePath`
- 审核说明：上述 `$certificationNotesPath`
- 商店 Logo：`store-assets/logo-300.png`
- 小型宣传图：`store-assets/small-promo-440x280.png`
- 大型宣传图：`store-assets/large-promo-1400x560.png`
- PDF 框选截图：`store-assets/screenshots/product-pdf-region-1280x800.png`
- 隐私政策 URL：`https://github.com/LittlePyx/Pi-translator/blob/main/PRIVACY.md`

上传前必须先把 `PRIVACY.md` 推送到公开 GitHub 仓库，并用未登录/无痕窗口确认 URL 可访问。

## 2. Single Purpose

Pi Translator translates user-selected content and explicitly requested webpage/PDF prose in Microsoft Edge and Overleaf. Confirmed regions use reliable locally extracted text first; screenshot mode sends only the confirmed visible region to the selected multimodal API. The PDF reader previews locally before a user starts text or multimodal translation. Local source navigation, excerpts/notes, retained translations, manual corrections and confirmed terminology reuse support reading and reviewing those translations. No general-purpose cloud research service is provided. All features serve this single translation and reading purpose.

## 3. 权限说明

版本对照：与已发布 0.15.0 ZIP 相比，0.16.0 增加 `offscreen` 以支持已授权 PDF 后台队列；必要网站权限仍仅为 Overleaf，可选 `<all_urls>` 范围不变。不能将“本轮未改权限代码”写成“相较旧发布包无新增权限”。

### Host permission justification

```text
Uses host access to display the selection translation interface on Overleaf, send user-triggered requests directly to the OpenAI-compatible API selected by the user, and operate on websites or online PDFs only when the user grants optional access. Translation requests contain only text the user explicitly selects or locally extracts from a drawn region, a webpage or PDF image region the user explicitly confirms, and applicable translation constraints. The extension requests the configured API origin or user-approved website origins; its default on-demand webpage mode does not require persistent access to all sites. Plain HTTP API access is restricted to localhost services.
```

| 权限 | 可粘贴到 Partner Center 的说明 |
| --- | --- |
| `storage` | Stores settings, API profiles, optional site choices, session history/cache, reading positions and page bookmarks. Explicitly retained translations, formulas, correction history, fixed documents, PDF markers, saved web excerpts/notes and confirmed terminology provenance remain local. Saved excerpts/provenance can contain original text, translations, user-confirmed titles, URLs, PDF pages or a local filename; ordinary anonymous page bookmarks do not. User-created library backups include these selected records, not API keys. Keys use session storage by default; persistent saving requires opt-in. PDF images and files are not retained in settings/history/result caches; the extension-internal PDF handoff for an authorized background task is deleted after it is read. Users control retention, backup and deletion. |
| `contextMenus` | Adds the “Use Pi Translator to translate selected text” context-menu item when the user has selected text on a webpage or in Edge's native PDF reader. The command is an explicit user gesture that starts translation of only that selection; it is not used to monitor browsing. |
| `activeTab` | Temporarily accesses only the currently active tab after the user invokes Pi Translator through its context-menu command, keyboard shortcut, toolbar popup, or PDF open action. This access is used to retrieve the current selection, display the packaged translation interface, pass the user-selected PDF to the packaged reader, or capture only a user-drawn region of the visible tab after a second explicit confirmation. It is not used for full-page or continuous capture, to collect browsing history, or to monitor tabs in the background. |
| `scripting` | Uses the packaged content script to display the selection button, translation card, pinned sidebar, and one-shot webpage region selector, and to read only the active selection or confirmed region after an explicit user action. It runs on Overleaf, on the active tab through `activeTab`, or on sites for which the user has granted optional access. The extension does not download or execute remote code. |
| `sidePanel` | Displays streaming translation results when the user explicitly chooses the browser side panel on a supported webpage, or after the user selects text in Microsoft Edge's protected native PDF reader and invokes the Pi Translator context-menu command. Webpage results remain scoped to the current tab, native-PDF panels are enabled only for the PDF tab that triggered them, and the panel does not open automatically during ordinary browsing. |
| `offscreen` | Keeps a user-confirmed Pi PDF full-document translation task running when Microsoft Edge freezes the background reader tab. The packaged offscreen document uses only bundled PDF.js code to manage the queue and, for an explicitly authorized multimodal task, render the already approved paragraph regions locally. It does not read browsing history, start translation or OCR automatically, capture webpages, or send a complete PDF to an API. Closing or navigating the source tab disposes its task. |
| `https://www.overleaf.com/*` | Access to Overleaf project pages is required to detect user-initiated selections in the editor and display the translation interface. Only content the user explicitly translates is sent to the user's selected API; the extension does not upload an entire project. |
| 可选 `<all_urls>` | This is an optional host permission and is not required at installation. The extension requests exact API or site origins for model calls, persistent selection controls, and online-PDF handoff. Chromium's `captureVisibleTab` specifically requires either `activeTab` or `<all_urls>`; a click inside Edge's browser side panel does not grant `activeTab`. Therefore the extension requests `<all_urls>` only when the user explicitly clicks “Select webpage region” in that side panel and Edge displays its runtime permission prompt. The implementation still rejects non-HTTP(S) pages for side-panel webpage capture. If the user declines, the toolbar popup remains available for one-time `activeTab` capture. Even after permission is granted, capture occurs only after the user draws and confirms a visible-tab region; the extension never performs full-page, scrolling, continuous, or background capture. Plain HTTP API access is limited to localhost services. |
| `file://`（包含于可选 `<all_urls>`，仍受 Edge 独立开关限制） | Allows the packaged Pi PDF reader to inherit a local PDF only after the user explicitly chooses “Open with Pi” and separately enables “Allow access to file URLs” on Edge's extension details page. The PDF is parsed locally; only text or an image region that the user explicitly confirms for translation is sent to the configured API. Side-panel webpage capture rejects `file://` pages. |

## 4. Remote code

选择：**No, I am not using remote code.**

Justification：

```text
All executable JavaScript, PDF.js, KaTeX, workers, and other required resources are packaged with the extension. The extension does not download or execute remote scripts, modules, WebAssembly, or code strings, and it does not use eval or similar mechanisms. User-selected translation APIs return JSON or text data that is parsed and rendered only as content and is never executed as code. Changing an API endpoint or model changes only the data service used for translation, not the extension's executable code.
```

## 5. 数据披露

在数据类型列表中仅勾选：

- **Authentication information**：用户提供的 API Key。
- **Website content**：用户主动选中或从网页选框本地提取的文本，以及用户确认发送的网页或 PDF 局部截图。

不要勾选 Personally identifiable information、Health information、Financial and payment information、Personal communications、Location、Web history 或 User activity。扩展不以这些类别为收集目的，不发送页面 URL，不监控浏览行为，也不进行分析或遥测。

- 选中文本和相关翻译约束只在用户主动触发翻译后发送到用户配置的 API。
- 网页区域框选只处理当前可见标签页：可靠文字层在本机提取，确认后使用文字 API；无可靠文字或用户选择“改用截图”时，确认后才向视觉 API 发送选框范围。界面显示本次发送方式；不自动滚动、不截取完整网页、不发送选框外内容，敏感字段区域禁止发送。截图不写入历史、设置或诊断。
- PDF 框选先尝试已有文字层，只有覆盖不可靠并经确认才发送选定图像。全文先在本机预览；用户明确开始统一多模态任务后，当前范围的段落图像与扫描页 OCR 按该任务授权处理，受暂停 / 停止和请求上限控制。单页“识别本页”另需选框确认。完整 PDF 不发送给 API；临时内部交接文件在后台读取后删除，全文 OCR 的临时恢复遵循隐私政策，不等于自动永久保存原文。
- 页面 URL 不发送到翻译 API。
- 不出售数据，不用于广告、画像、信用或借贷。
- 最近译文和缓存遵循现有浏览器会话规则；用户明确开启“关闭后保留译文”或固定文档后，网页 / PDF 译文、公式、待核对提示与有限校订历史可保存在本机文档库，并可备份、恢复或删除。会话内存不是永久保存。容量预警不等于全部浏览器空间，固定与最近记录按既有限额管理；不进行云同步、分析或遥测。
- 未保存轻标记只在当前页面内存中；用户为 PDF 明确开启保存，或主动保存普通网页摘录后，原文、译文、定位前后文、出处与个人笔记才进入本机存储。网页摘录可保存页面地址；PDF 词条来源可含原文件名。来源页无法唯一匹配时提示位置变化，不猜测锚点。Edge 原生 PDF 标记不持久保存。复制、Markdown 导出和文档库备份是用户主动操作，会包含所选出处 / 笔记；不要把这些本机备份称为匿名数据。
- PDF 与网页来源引用跳转、文档库搜索、笔记编辑及术语来源查询在本机完成。跨论文词条须逐条选择并确认适用性；不自动查询 DOI 或外部论文，不自动改写旧译文。作为后续翻译约束时仅发送词条与译法，不附出处记录。
- P&I Lab 没有接收翻译内容的中转服务器。
- 所有披露必须与 `PRIVACY.md` 保持一致。

## 6. Properties

- Category：Productivity
- Mature content：No
- Website：`https://github.com/LittlePyx/Pi-translator`
- Support：`https://github.com/LittlePyx/Pi-translator/issues`
- Visibility：首次审核可选 Hidden；验证商店安装体验后再改为 Public。

## 7. 审核测试说明

上次审核因未提供凭证或合理解释而触发 **1.3.1 Product is Testable**。微软允许解释为什么不能提供测试账户，但 Pi Translator 的核心翻译仍需要第三方 API，因此仅解释 BYOK 很可能仍不足以完成测试。重新提交时应：

1. 单独创建一个临时、低额度、审核专用 API Key；不要使用日常 Key。
2. 把 Key 只粘贴到 Partner Center 的 **Submission Options > Notes for certification**。
3. 不要把 Key 写进源码、文档、截图、GitHub、ZIP 或商店描述。
4. 保证接口至少在预计审核期内可用；审核完成后立即撤销。

可直接使用当前版本对应的 `$certificationNotesPath` 中不超过 2,000 字符的英文审核说明，并只在 Partner Center 内替换 API Key、模型和到期日期占位符。不要把填写过真实 Key 的副本保存到项目目录。

下面保留较完整的说明版本，供需要补充审核信息时参考：

```text
Pi Translator does not have a Pi Translator user account, login, subscription, or publisher-operated backend. It is a bring-your-own-API-key client. Translation requests go directly from the extension to the OpenAI-compatible API selected by the user. Therefore, there is no Pi Translator test account to provide.

To make the complete core translation flow testable, we provide the following temporary, review-only API credential. It is entered only in the extension settings and will remain active through the certification period.

Certification test API Base URL:
[PASTE THE REVIEW API BASE URL HERE]

Certification test model:
[PASTE THE REVIEW MODEL NAME HERE]

Certification test API Key:
[PASTE A TEMPORARY, LOW-BALANCE REVIEW-ONLY KEY HERE IN PARTNER CENTER]

Credential expiration date:
[PASTE A DATE AFTER THE EXPECTED REVIEW WINDOW]

Test steps:
1. Install the extension. Settings opens with a three-step wizard. Complete it, or skip to the full settings page for the steps below.
2. Select the provider matching the review credential. For a custom provider, choose “自定义 OpenAI 兼容 API” and enter the Base URL under “高级与诊断”.
3. Paste the review API Key and click “连接并保存”. The extension requests the displayed API origin, reads available models, verifies a text model and saves the connection. If no model list is available, enter the exact model ID and use “仅验证当前模型” under “高级与诊断”, then save. Configure the image model separately under “图像翻译与扫描件” for optional vision tests.
4. Open any public HTTPS article that does not require an account, select an English sentence, and use the context menu item “使用 Pi Translator 翻译选中文本” or Alt+Shift+T.
5. Verify that the result streams into a translation card, can be copied, and can be switched between full translation and sentence alignment.
6. Click “固定侧栏”, select another sentence, and verify that the pinned sidebar translates the new selection. Collapse and close the sidebar.
7. Click the toolbar icon and verify the target language can be changed without opening the full settings page.
8. Optional webpage-region test: choose “框选网页区域” and draw over article text or a rendered formula. The confirmation states whether locally extracted text or a cropped screenshot will be sent. Reliable text uses the text API; screenshot mode uses the configured vision API. Nothing is sent before explicit confirmation; cancelling sends nothing.
9. Optional PDF test: open any public text-based PDF in Edge, select text, and choose the Pi Translator context-menu item. Verify that the native Edge side panel receives the translation while the PDF remains open.
10. Optional packaged-reader test: click “打开 PDF 阅读器”, choose a local text-based PDF, and translate selected text. Only selected text is sent; the complete PDF remains local.

No Microsoft, Overleaf, or Pi Translator account is needed for steps 1–7. The extension does not execute remote code. API responses are parsed as data and never executed. The review API Key is not bundled with the extension and is not exposed to webpages.
```

审核完成后立即撤销审核专用 Key。
