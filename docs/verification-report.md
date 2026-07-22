# Edge 扩展验证报告

> 验证日期：2026-07-22  
> 版本：0.1.0  
> 构建目标：Microsoft Edge Manifest V3

## 自动化检查

| 检查项 | 结果 |
| --- | --- |
| WXT 类型生成 | 通过 |
| TypeScript 严格检查 | 通过 |
| Vitest 单元/契约测试 | 15/15 通过 |
| Edge MV3 生产构建 | 通过 |
| Edge ZIP 打包 | 通过 |
| API Key 模式扫描 | 未在源码和构建配置中发现 Key |

## DeepSeek 实时验证

使用用户临时授权的 API Key 在独立进程内完成测试，Key 未写入源码、构建产物、环境文件或本报告。

| 检查项 | 结果 |
| --- | --- |
| `GET /models` 鉴权 | 通过 |
| 可用模型 | `deepseek-v4-flash`、`deepseek-v4-pro` |
| `POST /chat/completions` | 通过 |
| 使用模型 | `deepseek-v4-flash` |
| JSON Output | 通过 |
| UTF-8 响应解析 | 通过 |
| `⟦TEX_0001⟧` 保留次数 | 1 |
| `⟦TEX_0002⟧` 保留次数 | 1 |
| LaTeX 占位符校验 | 通过 |

测试输入仅为虚构学术句子和两个占位符，不包含用户论文内容。

## 尚待人工验证

- 在 Edge 中加载 `.output/edge-mv3`。
- 在设置页把 API Key 保存到 `storage.session`。
- 在用户实际登录的 Overleaf Code Editor 中验证鼠标选区。
- 验证浮动按钮、右键菜单、快捷键和复制按钮。
- 验证包含公式、引用和文本宏的真实选区。

由于 API Key 曾通过聊天提供，完成测试后应在 DeepSeek 控制台轮换，并将新 Key 只输入扩展设置页。
