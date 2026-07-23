# Debate Studio v0.6.2

## 手动 DMG 更新链路验收

- 本版本不包含产品功能、业务逻辑或数据结构变化。
- 用于验证 v0.6.1 启用的 GitHub Release 检查、DMG 下载、大小与 SHA-256 校验以及手动覆盖安装流程。
- 应用不会自行移动、删除或覆盖 `/Applications/Debate Studio.app`。
- 本地 SQLite、API Key、模型配置、Prompt、辩论和研究数据保持原位。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或上传本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This no-feature-change validation release supports in-app update checks and verified DMG downloads, but it intentionally does not replace the installed application automatically. It contains no cloud services, telemetry, or changes to local user data.
