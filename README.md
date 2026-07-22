# TeX Selection Translator

Microsoft Edge 扩展：在 Overleaf 中翻译选中的学术文本，并保护常见 LaTeX 公式、引用和命令。

当前状态：Edge MVP 已构建，自动化检查和 DeepSeek 实时 API 契约已通过；实际 Overleaf 交互等待人工冒烟验证。完整设计见 [`docs/edge-translation-extension-design.md`](docs/edge-translation-extension-design.md)，验证结果见 [`docs/verification-report.md`](docs/verification-report.md)。

## 本地开发

要求：

- Node.js 20 或更高版本
- Microsoft Edge

```powershell
npm install
npm run dev
```

如果 WXT 没有自动发现 Edge，将 `web-ext.config.ts.example` 复制为 `web-ext.config.ts`，并按本机情况修改 `msedge.exe` 路径。

也可以执行生产构建后，在 `edge://extensions` 开启开发人员模式，并加载 `.output/edge-mv3`：

```powershell
npm run build:edge
```

## 检查

```powershell
npm run typecheck
npm test
npm run build:edge
```

## 隐私

只有用户主动选择并触发翻译的文本会发送到 DeepSeek。API Key 默认存储在浏览器会话中，扩展不保存翻译历史。
