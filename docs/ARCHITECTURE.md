# 系统架构

## 设计原则

- 主进程拥有密钥、网络、SQLite 和文件访问；渲染进程不直接访问 Node 或密钥。
- 以协议适配器而非厂商适配器为主；ProviderPreset 只是默认配置。
- 领域引擎不依赖 React、Electron 或具体模型协议，便于 Vitest 覆盖。
- 状态转换由显式状态机完成，副作用由执行器处理。

## 分层与数据流

```text
React renderer (Zustand UI state)
  -> typed preload API / Zod-validated IPC
Electron main
  -> application services (session, turn, export, credential)
  -> DebateEngine + Protocol Router + Adapter Registry
  -> SQLite repositories / Keychain-or-local CredentialStore / local assets
  -> provider HTTP endpoints (only after first phase implementation)
```

`DebateEngine` 只产生命令结果和下一状态；`TurnRunner` 根据当前参与者创建 `UnifiedRequest`，消费流事件，持久化 `DebateTurn`，并把事件发布给 UI。停止、失败、重试、跳过等用户命令均先持久化，再由引擎决定合法状态转换。

## 主要模块

| 模块 | 职责 | 第一阶段 |
| --- | --- | --- |
| `domain` | 类型、状态机、规则、错误分类 | 实现 |
| `providers` | 协议适配器、流解析、能力校验 | Mock + OpenAI Chat |
| `persistence` | SQLite schema、仓储、迁移 | 实现 |
| `security` | 凭据存取与脱敏 | 接口与基础实现 |
| `assets` | 文本/图片导入和元数据 | 文本、图片 |
| `research` | 三层研究模型及隔离规则 | 类型与持久化边界；不自动搜索 |
| `export` | JSON / Markdown 安全导出 | 实现 |
| `main` / `preload` | Electron 生命周期和受限 IPC | 实现 |
| `renderer` | 页面路由与基础操作界面 | 框架，不追求精细视觉 |

## 推荐目录结构

```text
src/
  main/                 Electron main、IPC handlers
  preload/              窄接口 bridge
  renderer/             React routes、components、Zustand stores
  domain/               types、debate state machine、services
  providers/            adapters、protocol router、normalizers
  persistence/          SQLite client、migrations、repositories
  security/             CredentialStore implementations
  assets/               local asset import and validation
  export/               JSON and Markdown exporters
  shared/               IPC contracts and utilities
tests/                  unit and integration tests
docs/                   product and architecture decisions
```

## 存储与恢复

SQLite 保存非敏感业务数据：连接元数据（不含 Key）、模型配置、会话、参与者、轮次、研究数据、证据、快照、用量、错误和设置。每一流式增量可节流更新轮次文本；完成、失败、取消、暂停时强制落盘。凭据只通过 `credentialRef` 与连接关联。

应用启动时，未完成的轮次显示为“已中断”；用户可重试、跳过或结束，不自动重发网络请求。

## 不做的架构

不引入服务端、消息队列、事件总线、微服务、RBAC、远程审计、向量数据库或通用工作流编排器。这些均不能改善单机个人工具的第一阶段核心体验。

