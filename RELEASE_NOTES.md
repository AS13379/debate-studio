# Debate Studio v0.5.6

## macOS 更新启动修复

- 已验证的更新 App 在启动前自动清除 `com.apple.quarantine`，解决未签名社区构建可能提示“应用已损坏”的问题。
- 普通权限不足时会询问用户，并通过 macOS 系统授权窗口重试，不修改全局安全策略。
- 新版本只启动一次；无法完成健康确认时自动恢复旧版本，不再循环拉起 Dock 图标。
- 安装终端完整记录隔离修复、授权、启动确认和回滚原因，便于排查。
- 更新仍只替换应用程序文件，不修改 SQLite、API Key、模型配置、Prompt、辩论或研究数据。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或修改本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256, then removes quarantine only from that verified app bundle after explicit authorization when required.
