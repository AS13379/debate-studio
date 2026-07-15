# 系统架构

## 目标与边界

Debate Studio 是单机 Electron 应用。架构优先保证本地数据所有权、安全边界、可恢复的长任务和可测试性，不引入服务端、账号、云同步、RBAC、消息队列或微服务。

## 进程边界

```text
React Renderer
  → typed preload whitelist
  → Zod-validated IPC
Electron Main
  → Application services
  → Domain / Runtime / Research / Export
  → Repositories / Adapters / CredentialStore / AssetProcessor
```

- Renderer 只接触 DTO；不能导入 `node:*`、Electron 主进程 API、Repository 或 CredentialStore。
- preload 只暴露 `DebateStudioApi` 中的白名单调用与可取消事件订阅。
- Main 拥有 SQLite、网络、文件和加密凭据访问权。
- `contextIsolation: true`，`nodeIntegration: false`。

## 核心运行链路

```text
sessionId
  → DebateSetupLoader / Validator
  → DebateRuntimeResolver
  → ModelRoutingPolicy (按任务可选覆盖角色模型)
  → TurnRunnerFactory / RuntimeTurnExecutor
  → PromptBuilder
  → ModelAdapter
  → SessionRunner events
  → SQLite Turn / Event / Usage
```

角色决定立场与可见研究上下文；路由策略决定 `research`、`search_summary`、`argument_generation`、`rebuttal`、`judge` 和 `vision_analysis` 使用哪个 ModelProfile。没有策略时回退到角色绑定模型，保持旧配置兼容。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `domain` | 辩论类型与显式状态机，不依赖 Electron/React/SQLite |
| `execution` | TurnRunner、SessionRunner 与取消/重试语义 |
| `runtime` | 配置解析、Prompt 构造前的模型路由、Adapter 调用 |
| `model-routing` | 按任务持久化和解析 ModelProfile |
| `providers` | Mock/OpenAI Compatible Adapter、HTTP/SSE 与错误标准化 |
| `research` | 搜索工具循环、可见性隔离、来源与证据 |
| `persistence` | SQLite migrations 与唯一数据访问入口 |
| `security` | CredentialStore 和递归脱敏 |
| `assets` | 图片/PDF 校验、存储、缩略图与 Vision 边界 |
| `cost` | 仅基于已知 Usage 和用户定价计算成本 |
| `application` | 用例编排和 Renderer DTO |
| `main` / `preload` | Electron 生命周期与窄 IPC |
| `renderer` | React 页面与显示状态 |

## 恢复语义

Turn 开始立即落库，流式文本节流写入，完成/失败/取消时强制保存。应用重启把 `running`/`streaming` 标记为 `interrupted`，保留部分文本但不自动重发模型请求。搜索和网页读取通过 operation key 避免重启后重复执行。

数据库升级前自动备份；migration 失败时恢复备份。凭据库不在 SQLite 备份中，因此恢复业务数据不会覆盖系统加密凭据。
