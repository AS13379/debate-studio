# Debate Studio v0.5.8

## 自动更新启动确认修复

- 更新助手现在直接启动已校验的新 App 主进程，不再把系统“接受打开请求”误认为应用已经运行。
- Electron 进程真正就绪后立即完成确认；若新进程提前退出，会显示启动日志并自动恢复旧版本。
- 健康确认最长等待缩短为约 30 秒，不再无反馈地等待两分钟。

## 数据安全

- 更新仍只替换 Debate Studio 应用程序文件。
- SQLite、API Key、模型配置、Prompt、辩论和研究数据保持原位。

## macOS notice

This community build is not notarized by Apple. The updater verifies the project signature, SHA256, version and bundle identity before replacing the application.
