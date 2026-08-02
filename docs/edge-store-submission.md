# Pi Translator：Microsoft Edge Add-ons 提交材料

> 适用版本：0.8.0
>
> 更新日期：2026-07-29

## 1. 上传文件

- 扩展包：`.output/tex-selection-translator-0.8.0-edge.zip`
- 商店 Logo：`store-assets/logo-300.png`
- 小型宣传图：`store-assets/small-promo-440x280.png`
- 大型宣传图：`store-assets/large-promo-1400x560.png`
- PDF 框选截图：`store-assets/screenshots/product-pdf-region-1280x800.png`
- 隐私政策 URL：`https://github.com/LittlePyx/Pi-translator/blob/main/PRIVACY.md`

上传前必须先把 `PRIVACY.md` 推送到公开 GitHub 仓库，并用未登录/无痕窗口确认 URL 可访问。

## 2. Single Purpose

Pi Translator translates text that the user explicitly selects in Microsoft Edge webpages, Overleaf, the native Edge PDF reader, or its packaged PDF reader. In its packaged PDF reader, it can also recognize and translate a local image region only after the user enables region mode, draws a rectangle, and confirms the upload. It also protects LaTeX structures and provides sentence-aligned viewing.

## 3. 权限说明

| 权限 | 可粘贴到 Partner Center 的说明 |
| --- | --- |
| `storage` | Stores user-selected translation settings, text and vision API profiles, site access choices, user-provided API Keys, session history/cache entries, resumable long-text chunk checkpoints, API/model compatibility hints, local error-code summaries, and reading state for up to 30 PDFs. It also stores document-scoped translation memory for up to 40 recently used documents: at most 20 explicitly translated source/translation pairs, 100 user-confirmed terms, and 20 unconfirmed term suggestions per document. Document keys are anonymous local hashes rather than full page URLs. Suggestions do not affect translation until the user confirms them, and all document memory can be edited, removed, or cleared from the sidebar. Session history may include a PDF page number and normalized region coordinates so the user can return to a translated area. Image-region deduplication stores only a SHA-256 crop hash, recognized text, translation, and request metadata; PDF image crops, Data URLs, Blob data, and Base64 image data are never stored. PDF reading state uses an anonymous local hash and contains only page position, zoom, fit mode, and sidebar state; it does not store the original URL, filename, document text, or image. PDF translation markers are session-only by default. Only after the user explicitly enables “Save markers for this PDF” can up to 100 marked source/translation pairs, page numbers, source title, and a short text quote context or normalized region coordinates be stored locally for that document; up to 30 documents are retained, the document key is an anonymous local hash, and the user can stop saving or clear the document's markers. Checkpoints, cache region coordinates, crop hashes, and compatibility hints are session-only. Error summaries exclude messages and content and expire with the browser session. API Keys are session-only by default and can be cleared by the user. |
| `contextMenus` | Adds a “Translate with Pi Translator” item only when the user has selected text. |
| `activeTab` | Temporarily accesses the current tab only after the user invokes the shortcut or context-menu command in on-demand mode. |
| `scripting` | Injects the packaged selection UI into the active page after an explicit user action, or into sites for which the user granted optional access. |
| `sidePanel` | Displays streaming translation results after the user selects text in Microsoft Edge's protected native PDF reader and explicitly invokes the Pi Translator context-menu command. The panel is enabled only for the PDF tab that triggered it and is hidden on unrelated webpages. It does not open automatically during browsing. |
| `https://www.overleaf.com/*` | Detects user text selections and displays the translation UI on Overleaf project pages. |
| 可选 `http://*/*`、`https://*/*` | Requests only the exact API origin configured by the user for translation calls. Website origins are additionally requested only when the user enables automatic selection buttons, or explicitly opens an online PDF from that origin in the packaged reader. The default on-demand mode does not request persistent access to all websites. HTTP API access is limited by the extension to localhost services. |
| 可选 `file:///*` | Allows the packaged Pi PDF reader to inherit a local PDF only after the user explicitly clicks “用 Pi 打开” and separately enables “Allow access to file URLs” on Edge's extension details page. The complete file is parsed locally; only text the user explicitly selects and translates is sent to the configured translation API. |

## 4. Remote code

选择：**No, I am not using remote code.**

说明：扩展包不下载或执行远程 JavaScript/Wasm。翻译 API 返回的数据只作为 JSON/纯文本解析并显示，不作为代码执行。

## 5. 数据披露

建议在 Partner Center 中如实声明扩展会处理/传输 **Website content（用户主动选中的文本，以及用户确认发送的 PDF 局部截图）** 和 **Authentication information（用户提供的 API Key）**。

- 选中文本和相关翻译约束只在用户主动触发翻译后发送到用户配置的 API。
- PDF 框选会先在本机尝试读取框内已有文字层；只有文字缺失、乱码或覆盖不可靠，并且用户点击确认后，局部截图才发送到用户选择的视觉 API。完整 PDF、完整页面和未确认框选不会发送，截图不会写入扩展存储；会话去重只保存截图 SHA-256 哈希和翻译结果。
- 页面 URL 不发送到翻译 API。
- 不出售数据，不用于广告、画像、信用或借贷。
- 用户启用时，仅在浏览器会话内按标签页保留最近 5、10 或 20 条翻译以及最多 20 条重复翻译缓存；长文失败时会话内暂存已完成分段以供续翻，并保留不含密钥或用户内容的 API/模型兼容性提示；不进行分析或遥测。
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

提交时粘贴以下内容，并把占位内容替换为审核专用兼容 API 配置。不要把真实 Key 写入仓库或扩展包。

```text
Pi Translator uses a user-configured OpenAI-compatible API. Translation requests are sent directly from the extension to that API; the publisher does not operate a proxy server.

Certification test API Base URL:
[PASTE THE REVIEW API BASE URL HERE]

Certification test model:
[PASTE THE REVIEW MODEL NAME HERE]

Certification test API Key:
[PASTE A TEMPORARY, LOW-BALANCE REVIEW-ONLY KEY HERE IN PARTNER CENTER]

Test steps:
1. Install the extension. The options page opens automatically with a three-step setup wizard.
2. Choose an API preset or custom endpoint, enter the review API Base URL and API Key, approve access to that exact API domain, and select an available model.
3. Click “测试并完成”. The full settings page remains available for advanced configuration.
4. Open https://www.overleaf.com/project/<any accessible project>, select prose in the editor, and click the Pi floating button.
5. Verify that a translation card appears, can be dragged, copied, switched between full translation and sentence alignment, and browsed with the history arrows.
6. Pin the card to the continuous translation sidebar. Select another sentence and verify that translation starts automatically only while the sidebar remains pinned. Collapse, resize, and close the sidebar.
7. On a normal HTTPS page, select text and use the context menu or Alt+Shift+T.
8. Click the toolbar icon. Change the target language, switch an API profile if available, and toggle “暂停本网站自动划词” for the current site.
9. Enable sentence context under “更多结果设置”, translate a short phrase, and verify the result shows the local “含上下文” badge. Context is used only for disambiguation.
10. Click “打开 PDF 阅读器”, choose a local text-based PDF, select a sentence or paragraph, and verify the same translation card appears. The full PDF file remains local; only the selected text is translated.
11. Open a text-based PDF in Microsoft Edge's native PDF reader, select text, and choose “使用 Pi Translator 翻译选中文本” from the context menu. Verify that the Pi Translator Edge side panel opens and receives the translation progressively. The original PDF stays in the native reader. The optional “用 Pi 打开” button inherits the current online or local PDF after a second explicit user action, then closes the Edge side panel. Local inheritance additionally requires the user-controlled file-URL access toggle.
12. Run “兼容性诊断”, copy the local diagnostic report, and verify it contains no API Key, selected text, translation, page URL, glossary entry, or site name.
13. Export settings and verify the JSON file declares `containsApiKeys: false`. Importing it must require the API Key to be entered again.
14. Under “PDF 图像区域翻译”, click “测试视觉能力”. The extension sends only its bundled 130×58 high-contrast character challenge and verifies that the model actually reads the image; no PDF or website content is used or stored by this test.

The extension does not execute remote code. API responses are parsed as JSON and rendered as plain text.
```

审核完成后立即撤销审核专用 Key。
