# Pi Translator 隐私政策

更新日期：2026 年 7 月 23 日

Pi Translator 是由 P&I Lab 开发的 Microsoft Edge 扩展。本政策说明 Pi Translator 如何处理用户数据。

## 1. 扩展的单一用途

Pi Translator 用于翻译用户在 Overleaf 或普通网页中主动选中的文本，并可在翻译过程中保护 LaTeX 结构、应用用户配置的学术术语表。

## 2. 处理的数据

Pi Translator 仅在用户点击浮动按钮、右键翻译菜单或使用快捷键时处理选中文本。

- **选中的文本**：发送到 DeepSeek API 以生成译文。
- **学术术语表**：如果用户配置了术语表，相关术语映射会与翻译请求一同发送到 DeepSeek API，用于保持术语一致。
- **DeepSeek API Key**：仅用于向 DeepSeek API 发起经过 HTTPS 加密的鉴权请求。
- **扩展设置**：包括语言、模型、翻译风格、网站范围和术语表，保存在用户本机的 Microsoft Edge 扩展存储中。
- **临时暂停的网站域名**：仅保存在当前浏览器会话中，关闭 Microsoft Edge 后自动清除。

页面 URL 只在本机用于判断页面类型、LaTeX 处理方式和网站权限，不会作为翻译请求内容发送给 DeepSeek。Pi Translator 不会自动读取或发送未被用户主动选中并触发翻译的网页正文。

## 3. 数据存储

- API Key 默认保存在 Microsoft Edge 的会话存储中；用户也可以明确选择保存在本机持久存储中。
- Pi Translator 不保存翻译历史。
- Pi Translator 不使用分析、遥测、广告或用户跟踪服务。
- P&I Lab 不运营用于接收选中文本、API Key 或翻译结果的中转服务器。

## 4. 第三方服务

翻译请求从扩展后台直接发送到 `https://api.deepseek.com`。DeepSeek 对其收到的数据的处理受 [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)约束。用户不应选择并发送自己无权处理的个人信息、机密信息或敏感信息。

## 5. 用户控制

用户可以随时：

- 不触发翻译，从而不发送任何选中文本；
- 在设置页清除 API Key 和学术术语表；
- 在快速面板中暂停当前网站的自动划词按钮；
- 在 Microsoft Edge 的扩展详情页管理网站访问权限；
- 卸载扩展以移除扩展及其本机数据。

## 6. 数据保留与删除

P&I Lab 不接收或保留用户的翻译请求。DeepSeek 对 API 请求的保留和删除规则由 DeepSeek 的政策及用户与 DeepSeek 之间的账户设置决定。扩展本机保存的数据可通过设置页清除 API Key、清空设置字段或卸载扩展删除。

## 7. 儿童

Pi Translator 不以儿童为目标用户，也不会故意收集儿童个人信息。

## 8. 政策更新与联系

功能或数据处理方式变化时，本政策会同步更新。如有隐私或支持问题，请通过 [Pi Translator GitHub Issues](https://github.com/LittlePyx/Pi-translator/issues) 联系维护者。
