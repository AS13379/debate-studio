# Debate Studio v0.5.3

## 导出体验与历史菜单修复

- 导出 Markdown 或 HTML 前会先打开 macOS 原生保存窗口，由用户选择文件名和保存位置。
- 导出任务创建、完成和失败状态均提供明确提示，成功后显示最终保存位置，提示可主动关闭。
- 取消保存窗口时不再创建空导出任务。
- 修复辩论历史卡片中的“管理”菜单被卡片内容或相邻区域遮挡的问题。

## 隐私

- 导出文件只写入用户主动选择的位置。
- 应用更新只访问 GitHub Releases，不读取或修改本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256 before installation; it does not bypass Gatekeeper.
