# Pi Translator：Microsoft Edge Add-ons 提交材料

> 适用版本：0.4.0
>
> 更新日期：2026-07-23

## 1. 上传文件

- 扩展包：`.output/tex-selection-translator-0.4.0-edge.zip`
- 商店 Logo：`store-assets/logo-300.png`
- 小型宣传图：`store-assets/small-promo-440x280.png`
- 大型宣传图：`store-assets/large-promo-1400x560.png`
- 隐私政策 URL：`https://github.com/LittlePyx/Pi-translator/blob/main/PRIVACY.md`

上传前必须先把 `PRIVACY.md` 推送到公开 GitHub 仓库，并用未登录/无痕窗口确认 URL 可访问。

## 2. Single Purpose

Pi Translator translates text that the user explicitly selects in Microsoft Edge, with special support for protecting LaTeX structures in Overleaf and applying a user-defined academic glossary.

## 3. 权限说明

| 权限 | 可粘贴到 Partner Center 的说明 |
| --- | --- |
| `storage` | Stores user-selected translation settings, academic glossary, site access choices, and the user-provided DeepSeek API Key. The API Key is session-only by default and can be cleared by the user. |
| `contextMenus` | Adds a “Translate with Pi Translator” item only when the user has selected text. |
| `activeTab` | Temporarily accesses the current tab only after the user invokes the shortcut or context-menu command in on-demand mode. |
| `scripting` | Injects the packaged selection UI into the active page after an explicit user action, or into sites for which the user granted optional access. |
| `https://api.deepseek.com/*` | Sends user-triggered translation requests directly to the DeepSeek API over HTTPS using the user's own API Key. |
| `https://www.overleaf.com/*` | Detects user text selections and displays the translation UI on Overleaf project pages. |
| 可选 `http://*/*`、`https://*/*` | Requested only when the user explicitly enables automatic selection buttons for specified sites or all sites. The default on-demand mode does not request persistent access to all sites. |

## 4. Remote code

选择：**No, I am not using remote code.**

说明：扩展包不下载或执行远程 JavaScript/Wasm。DeepSeek API 返回的是作为纯文本/JSON 解析并显示的翻译数据，不作为代码执行。

## 5. 数据披露

建议在 Partner Center 中如实声明扩展会处理/传输 **Website content（用户主动选中的文本）**。若表单提供“Authentication information”分类，也应声明用户提供的 DeepSeek API Key 用于直接向 DeepSeek 鉴权。

- 选中文本和相关术语映射只在用户主动触发翻译后发送到 DeepSeek。
- 页面 URL 不发送到 DeepSeek。
- 不出售数据，不用于广告、画像、信用或借贷。
- 不保存翻译历史，不进行分析或遥测。
- P&I Lab 没有接收翻译内容的中转服务器。
- 所有披露必须与 `PRIVACY.md` 保持一致。

## 6. Properties

- Category：Productivity
- Mature content：No
- Website：`https://github.com/LittlePyx/Pi-translator`
- Support：`https://github.com/LittlePyx/Pi-translator/issues`
- Visibility：首次审核可选 Hidden；验证商店安装体验后再改为 Public。

## 7. 审核测试说明

提交时粘贴以下内容，并把占位内容替换为短期、低额度的审核专用 DeepSeek API Key。不要把真实 Key 写入仓库或扩展包。

```text
Pi Translator requires a user-provided DeepSeek API Key because translation requests are sent directly from the extension to DeepSeek; the publisher does not operate a proxy server.

Certification test API Key:
[PASTE A TEMPORARY, LOW-BALANCE REVIEW-ONLY KEY HERE IN PARTNER CENTER]

Test steps:
1. Install the extension. The options page opens automatically.
2. Paste the review API Key, click “读取可用模型”, select an available model, and click “测试连接”.
3. Save settings.
4. Open https://www.overleaf.com/project/<any accessible project>, select prose in the editor, and click the Pi floating button.
5. Verify that a translation card appears, can be dragged by its header, copied, retried, and dismissed with Escape.
6. On a normal HTTPS page, select text and use the context menu or Alt+Shift+T.
7. Click the toolbar icon. Change the target language and toggle “暂停自动划词” for the current site.
8. In the full settings page, add “large language model = 大语言模型” to the glossary, save, and verify the mapping is applied to a translation.

The extension does not execute remote code. DeepSeek responses are parsed as JSON and rendered as plain text.
```

审核完成后立即撤销审核专用 Key。
