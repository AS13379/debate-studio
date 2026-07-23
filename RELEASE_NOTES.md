# Debate Studio v0.6.0

## 简洁可靠的社区自动更新

- 安装流程正式收缩为安全退出、替换应用、清除隔离属性和直接打开四步。
- 移除进程健康等待、启动确认超时和循环拉起，避免新版已经替换却被错误回滚。
- 只有必要安装步骤失败时才恢复旧版；macOS 接受打开请求后立即完成并自动关闭终端。
- 旧版临时备份和更新缓存采用容错清理，不会把清理问题误报成安装失败。
- 更新仍只替换 Debate Studio 应用程序文件，不修改 SQLite、API Key、模型配置、Prompt、辩论或研究数据。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或上传本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This release makes the project-signed community updater intentionally simple and removes false startup-health rollbacks. It contains no cloud services, telemetry, or changes to local user data.
