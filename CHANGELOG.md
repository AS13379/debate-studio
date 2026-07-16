# Debate Studio 更新日志

本文件记录 Debate Studio 各公开版本的重要变化。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.2.4] - 2026-07-16

### 新增

- 本地 AI 辩论工作台，支持创建、运行、暂停、继续、停止和恢复辩论。
- OpenAI Compatible 模型连接，可为主持人、正方、反方和裁判配置不同模型。
- AI 辩题规划，支持自动规划、辅助完善和完全手动三种创建方式。
- 自动研究与证据系统，支持隔离的正反方研究空间、公共资源池、网页研究和证据状态历史。
- Prompt Studio，支持 Prompt 版本创建、比较、回滚和调用记录。
- 结构化裁判评分、赛后复盘和辩论质量分析。
- 多模态基础能力，包括图片与 PDF 资产管理、缩略图以及 Vision 模型能力检查。
- Markdown 与 HTML 辩论导出、历史管理、诊断日志、数据库备份与恢复。

### 本地数据与隐私

- 辩论、研究、证据、设置和运行记录保存在本地 SQLite 数据库中。
- API Key 仅保存在本机加密凭据存储中，不写入 SQLite、日志、导出文件或 Renderer。
- 用户主动调用模型或搜索服务时，凭据只发送给用户选择的第三方服务商；Debate Studio 不提供自有云服务，也不会把密钥或用户数据上传给项目方。
- Renderer 启用沙箱和上下文隔离，并通过类型安全的白名单 IPC 访问主进程能力。

### macOS

- 提供 Apple Silicon（arm64）DMG 构建。
- 修复开发环境与打包应用的 Dock 图标，并提供可复现的透明 PNG/ICNS 生成流程。
- 当前公开 DMG 未经过 Apple Developer ID 签名和 Apple 公证。首次打开时，macOS 可能要求用户在“系统设置 → 隐私与安全性”中手动允许。

### 改进

- 优化辩论历史、质量分析、新建辩论、Prompt Studio、设置和实时辩论页面的布局与中文排版。
- 增加长辩论分页、增量读取、流式写入节流和可取消导出，改善大量 Turn、事件和证据下的性能。
- 统一 Provider、网络、运行时、持久化和 Renderer 错误的中文说明与脱敏诊断。

## [0.1.0-rc.1] - 2026-07-15

### 新增

- Electron、React、TypeScript 和 Vite 桌面应用基础。
- DebateEngine、TurnRunner、SessionRunner 和 Mock 辩论闭环。
- SQLite migration、Repository、运行持久化及 macOS 安全凭据存储。
- OpenAI Compatible Adapter、SSE 流式请求和中文结构化错误处理。
- macOS arm64 DMG、Hardened Runtime、签名与公证脚本准备。
