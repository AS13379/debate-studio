# Debate Studio v0.5.4

## 社区更新安装修复

- 修复 macOS 单实例锁尚未释放时，新版应用在 Dock 中短暂跳动后退出并触发回滚的问题。
- 安装助手会等待旧进程完全结束，并在更长的健康确认窗口内自动重试启动新版本。
- 安装成功后自动清理旧应用 backup 与更新缓存；回滚后不再遗留错误的 pending 状态。
- 更新替换与失败回滚均新增真实安装流程测试。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或修改本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256 before installation; it does not bypass Gatekeeper.
