# Debate Studio v0.6.1

## 安全的 DMG 手动覆盖更新

- 停用未签名 macOS 构建中的自定义 App 替换安装器。
- 应用继续检查 GitHub Releases、显示版本与发布说明，并下载对应 arm64 DMG。
- 下载完成后校验 GitHub Release 提供的文件大小和 SHA-256。
- 用户通过标准 DMG 窗口手动把 Debate Studio 拖入 Applications 并选择替换。
- 应用不会自行移动、删除或覆盖 `/Applications/Debate Studio.app`。
- 本地 SQLite、API Key、模型配置、Prompt、辩论和研究数据继续保存在原 userData 目录。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或上传本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This unsigned community build supports in-app update checks and verified DMG downloads, but it intentionally does not replace the installed application automatically. It contains no cloud services, telemetry, or changes to local user data.
