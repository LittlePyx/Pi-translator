# Pi Translator：Microsoft Edge Add-ons 提交材料

> 适用版本：0.7.1
>
> 更新日期：2026-07-29

## 1. 上传文件

- 扩展包：`.output/tex-selection-translator-0.7.1-edge.zip`
- 商店 Logo：`store-assets/logo-300.png`
- 小型宣传图：`store-assets/small-promo-440x280.png`
- 大型宣传图：`store-assets/large-promo-1400x560.png`
- 隐私政策 URL：`https://github.com/LittlePyx/Pi-translator/blob/main/PRIVACY.md`

上传前必须先把 `PRIVACY.md` 推送到公开 GitHub 仓库，并用未登录/无痕窗口确认 URL 可访问。

## 2. Single Purpose

Pi Translator translates text that the user explicitly selects in Microsoft Edge, including selections made after the user deliberately pins the continuous-translation sidebar. It also protects LaTeX structures in Overleaf and provides sentence-aligned viewing.

## 3. 权限说明

| 权限 | 可粘贴到 Partner Center 的说明 |
| --- | --- |
| `storage` | Stores user-selected translation settings, API profiles, site access choices, user-provided API Keys, session history/cache entries, local error-code summaries, and translations the user explicitly favorites. Error summaries exclude messages and content and expire with the browser session. Favorites are local-only and can be individually deleted. API Keys are session-only by default and can be cleared by the user. |
| `contextMenus` | Adds a “Translate with Pi Translator” item only when the user has selected text. |
| `activeTab` | Temporarily accesses the current tab only after the user invokes the shortcut or context-menu command in on-demand mode. |
| `scripting` | Injects the packaged selection UI into the active page after an explicit user action, or into sites for which the user granted optional access. |
| `https://www.overleaf.com/*` | Detects user text selections and displays the translation UI on Overleaf project pages. |
| 可选 `http://*/*`、`https://*/*` | Requests only the exact API origin configured by the user for translation calls. Website origins are additionally requested only when the user enables automatic selection buttons for specified sites or all sites. The default on-demand mode does not request persistent access to all websites. HTTP API access is limited by the extension to localhost services. |

## 4. Remote code

选择：**No, I am not using remote code.**

说明：扩展包不下载或执行远程 JavaScript/Wasm。翻译 API 返回的数据只作为 JSON/纯文本解析并显示，不作为代码执行。

## 5. 数据披露

建议在 Partner Center 中如实声明扩展会处理/传输 **Website content（用户主动选中的文本）** 和 **Authentication information（用户提供的 API Key）**。

- 选中文本和相关翻译约束只在用户主动触发翻译后发送到用户配置的 API。
- 页面 URL 不发送到翻译 API。
- 不出售数据，不用于广告、画像、信用或借贷。
- 用户启用时，仅在浏览器会话内按标签页保留最近 5、10 或 20 条翻译以及最多 20 条重复翻译缓存；用户主动收藏的翻译最多 100 条并保存在本机，可逐条删除；不进行分析或遥测。
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
8. Click the toolbar icon. Change the target language, switch an API profile if available, and toggle “暂停自动划词” for the current site.
9. Enable sentence context under “更多结果设置”, translate a short phrase, and verify the result shows the local “含上下文” badge. Context is used only for disambiguation.
10. Favorite a result, open “浏览收藏与搜索”, search for it, and delete it.
11. Run “兼容性诊断”, copy the local diagnostic report, and verify it contains no API Key, selected text, translation, page URL, glossary entry, or site name.
12. Export settings and verify the JSON file declares `containsApiKeys: false`. Importing it must require the API Key to be entered again.

The extension does not execute remote code. API responses are parsed as JSON and rendered as plain text.
```

审核完成后立即撤销审核专用 Key。
