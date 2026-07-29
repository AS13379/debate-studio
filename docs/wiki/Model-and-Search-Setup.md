# 模型与搜索服务配置

## ProviderConnection 与 ModelProfile

Debate Studio 将平台连接和模型配置分开：

- **ProviderConnection**：平台、协议、Base URL、启用状态和凭据引用。
- **ModelProfile**：具体 Model ID、显示名称、上下文长度、最大输出以及文本、视觉和流式能力。

ModelProfile 只引用连接，不复制 API Key。

## 新建连接

进入“设置 → 模型与平台”：

1. 点击新建连接。
2. 选择 OpenAI、DeepSeek、Moonshot / Kimi、智谱、阿里云百炼、Gemini OpenAI Compatible、小米 MiMo 等预设。
3. 如平台文档要求，调整 Base URL。
4. 保存 API Key。
5. 等待最小连接测试结果。

编辑连接不会自动删除已经保存的凭据。删除连接时，应用会区分“只删除配置”和“同时删除系统加密凭据”。

## 新建模型

1. 在连接卡片中点击“新建模型”。
2. 从平台模型预设列表选择模型，或选择自定义。
3. 检查上下文长度、最大输出和能力标签。
4. 保存后完成测试。

模型目录和能力会随平台变化。预设用于减少手工填写，不应取代平台官方文档；自定义入口始终保留。

## 模型策略

进入“设置 → 模型策略”，可以分别配置：

- `debate_planning`：辩题规划
- `research`：研究
- `search_summary`：搜索摘要
- `argument_generation`：论证生成
- `rebuttal`：反驳
- `judge`：裁判
- `vision_analysis`：图片分析

普通用户可以让多个任务使用同一模型；高级用户可以让快速模型负责研究与摘要、强模型负责正式辩论和裁判。

## 思考模型

思考模型可能长时间只返回 reasoning 内容。应用会显示可公开的思考活动和等待时间，让你知道请求仍在运行。最终保存和导出的核心仍是公开回答，不把隐藏思维链当作辩论正文。

如果思考耗尽服务商输出额度，建议：

- 使用平台建议的输出范围；
- 缩短单个任务；
- 在研究与总结任务使用更快模型；
- 不要反复无条件重试同一个失败请求。

## Tavily 搜索

在“设置 → 模型与平台”的搜索服务区域：

1. 新建 Tavily 连接。
2. 保存 Tavily API Key。
3. 测试搜索。
4. 设为默认搜索工具。

搜索 Key 与模型 Key 采用相同的安全边界，不进入 SQLite、日志和 Web 返回值。自动测试只使用 MockSearchTool，不访问 Tavily。
