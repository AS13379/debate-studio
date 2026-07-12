# 服务商与协议设计

## 协议优先

`ProviderPreset` 提供名称、默认 Base URL、推荐协议、模型列表端点、控制台链接与能力提示；它不决定运行时行为。`ProviderConnection` 保存用户实际 Base URL、选用协议和凭据引用；`ModelProfile` 保存 Model ID、别名与经用户确认的能力覆盖。

适配器注册表按 `ProtocolType` 选择实现：

| 协议 | 第一阶段 | 用途 |
| --- | --- | --- |
| `mock` | 实现 | 可预测的本地演示与测试 |
| `openai-chat` | 实现 | OpenAI Chat Completions 与兼容端点的文本流、基础图片 |
| `openai-responses` | 仅接口 | 后续使用原生能力 |
| `gemini-native` | 仅接口 | 后续 |
| `dashscope-native` | 仅接口 | 后续 |
| `anthropic-messages` | 仅接口 | 后续 |
| `mimo-native`、`custom-native` | 仅接口 | 后续 |

## 统一请求与响应

业务层只使用 `UnifiedRequest`、`UnifiedResponse` 和 `UnifiedStreamEvent`。适配器负责协议字段映射、SSE/流解析、取消请求、usage 提取和错误标准化。所有调用都携带 `AbortSignal`，并返回可持久化的 provider request 标识（若服务端提供）。

能力校验在请求前完成：文本、图片、流式、工具、结构化输出、联网搜索、思考控制及上下文限制均由 `ModelCapabilities` 描述。第一阶段只会请求文本、图片和流式；其他字段被明确拒绝，不能悄悄降级。

## 模型列表

`ModelCatalogService` 可调用预设定义的列表接口，失败不阻止保存连接或手填 Model ID。列表是缓存提示而非真实性保证；实际调用失败由统一错误层解释。

## 错误规范

适配器转换供应商错误至 `NormalizedError`，包含稳定类别、中文标题/说明、原始状态/代码、可重试标志、建议操作和可折叠技术详情。日志及导出中对 API Key 执行脱敏，绝不写入完整密钥。

