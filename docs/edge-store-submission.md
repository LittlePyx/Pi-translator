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

Pi Translator translates user-selected content and the main prose of user-requested webpages in Microsoft Edge, Overleaf, and PDF documents. A one-shot webpage region selector sends only a cropped screenshot of the current visible tab to the configured multimodal model, and only after explicit confirmation; ordinary text selection and webpage body translation continue to use the text API. When selectable PDF text is unavailable, the packaged PDF reader can likewise translate a user-confirmed image region. Translation results are shown in the page or side panel, with LaTeX notation preserved when present. All features serve this single translation purpose.

## 3. 权限说明

### Host permission justification

```text
Uses host access to display the selection translation interface on Overleaf, send user-triggered requests directly to the OpenAI-compatible API selected by the user, and operate on websites or online PDFs only when the user grants optional access. Translation requests contain only text the user explicitly selects or locally extracts from a drawn region, a webpage or PDF image region the user explicitly confirms, and applicable translation constraints. The extension requests the configured API origin or user-approved website origins; its default on-demand webpage mode does not require persistent access to all sites. Plain HTTP API access is restricted to localhost services.
```

| 权限 | 可粘贴到 Partner Center 的说明 |
| --- | --- |
| `storage` | Stores user-selected translation settings, API profiles, optional site-access choices, session history/cache, anonymous PDF reading state and page bookmarks, and user-created terminology or translation markers so extension components can share and restore the user's chosen state. PDF page bookmarks contain only a page number and the user-entered label or note; they do not contain the PDF filename, URL, text, or image. It also stores user-provided API keys: session storage is the default, and local storage is used only when the user explicitly enables persistent saving. Stored items remain on the user's device and can be cleared from the extension. PDF images and complete PDF files are not stored. |
| `contextMenus` | Adds the “Use Pi Translator to translate selected text” context-menu item when the user has selected text on a webpage or in Edge's native PDF reader. The command is an explicit user gesture that starts translation of only that selection; it is not used to monitor browsing. |
| `activeTab` | Temporarily accesses only the currently active tab after the user invokes Pi Translator through its context-menu command, keyboard shortcut, toolbar popup, or PDF open action. This access is used to retrieve the current selection, display the packaged translation interface, pass the user-selected PDF to the packaged reader, or capture only a user-drawn region of the visible tab after a second explicit confirmation. It is not used for full-page or continuous capture, to collect browsing history, or to monitor tabs in the background. |
| `scripting` | Uses the packaged content script to display the selection button, translation card, pinned sidebar, and one-shot webpage region selector, and to read only the active selection or confirmed region after an explicit user action. It runs on Overleaf, on the active tab through `activeTab`, or on sites for which the user has granted optional access. The extension does not download or execute remote code. |
| `sidePanel` | Displays streaming translation results when the user explicitly chooses the browser side panel on a supported webpage, or after the user selects text in Microsoft Edge's protected native PDF reader and invokes the Pi Translator context-menu command. Webpage results remain scoped to the current tab, native-PDF panels are enabled only for the PDF tab that triggered them, and the panel does not open automatically during ordinary browsing. |
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
- 网页区域框选只处理当前可见标签页：用户在确认界面明确点击后，扩展才截取并向其配置的多模态翻译 API 发送选框范围。普通网页划词继续使用文字接口，不会因为选区含公式而与框选入口混用。扩展不自动滚动、不截取完整网页、不发送选框外内容，并会禁止发送包含密码、验证码或支付字段的区域。截图不会写入扩展存储。
- PDF 框选会先在本机尝试读取框内已有文字层；只有文字缺失、乱码或覆盖不可靠，并且用户点击确认后，局部截图才发送到用户选择的视觉 API。完整 PDF、完整页面和未确认框选不会发送，截图不会写入扩展存储；会话去重只保存截图 SHA-256 哈希和翻译结果。
- 页面 URL 不发送到翻译 API。
- 不出售数据，不用于广告、画像、信用或借贷。
- 用户启用时，仅在浏览器会话内按标签页保留最近 5、10 或 20 条翻译以及最多 20 条重复翻译缓存；用户主动开启网页正文翻译后，会话内还会暂存匿名页面/段落指纹、已生成译文、正文范围和显示状态，以便同一标签页刷新后恢复匹配段落并只补译变化内容，不保存原始页面 URL 或段落原文；主动清除、改变翻译配置、关闭标签页或关闭 Edge 时删除。长文失败时会话内暂存已完成分段以供续翻，并保留不含密钥或用户内容的 API/模型兼容性提示；不进行分析或遥测。
- 用户主动添加的整段或单句轻标记默认只保存在当前页面的运行内存中，用于显示原文浅色标记和悬停译文；它不会修改网页正文或产生额外 API 请求。只有用户在 Pi PDF 中为当前文档明确开启保存后，标记原文、译文、来源标题、页码和短前后文或相对区域坐标才会写入本机扩展存储；普通网页和 Edge 原生 PDF 不持久保存标记。Pi PDF 的本文导航器只在本机整理这些已有标记，支持定位、复制、逐条删除和复制全部；原文无法可靠匹配时明确显示位置变化且不恢复着色。只有用户主动选择复制时，标记原文、译文和来源信息才会整理为 Markdown 并写入系统剪贴板。
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
1. Install the extension. The options page opens automatically with a three-step setup wizard.
2. Select the service provider that matches the credential above. For a custom provider, choose “自定义 OpenAI 兼容 API” and enter the Base URL under “高级接口设置”.
3. Paste the review API Key and click “连接并自动配置”. The extension requests access only to the displayed API origin, reads the models available to this Key, recommends and verifies a text model, and tests whether an available model supports PDF image input. If the API does not expose a model list, enter the exact model ID above and click “仅验证当前模型”. Save settings after the capability summary appears.
4. Open any public HTTPS article that does not require an account, select an English sentence, and use the context menu item “使用 Pi Translator 翻译选中文本” or Alt+Shift+T.
5. Verify that the result streams into a translation card, can be copied, and can be switched between full translation and sentence alignment.
6. Click “固定侧栏”, select another sentence, and verify that the pinned sidebar translates the new selection. Collapse and close the sidebar.
7. Click the toolbar icon and verify the target language can be changed without opening the full settings page.
8. Optional webpage-region test: click the toolbar icon, choose “框选网页区域”, and draw over visible article text or a rendered formula. Verify that the confirmation clearly states that the cropped visible region will use the multimodal model, and that no screenshot or request is made until the user explicitly confirms.
9. Optional PDF test: open any public text-based PDF in Edge, select text, and choose the Pi Translator context-menu item. Verify that the native Edge side panel receives the translation while the PDF remains open.
10. Optional packaged-reader test: click “打开 PDF 阅读器”, choose a local text-based PDF, and translate selected text. Only selected text is sent; the complete PDF remains local.

No Microsoft, Overleaf, or Pi Translator account is needed for steps 1–7. The extension does not execute remote code. API responses are parsed as data and never executed. The review API Key is not bundled with the extension and is not exposed to webpages.
```

审核完成后立即撤销审核专用 Key。
