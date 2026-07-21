# Debate Studio v0.5.2

## 社区更新修复

- 修复更新包重复下载与末段校验失败时缺少具体反馈的问题。
- 增加分阶段校验错误码、缓存包 Finder 入口和重新下载并校验操作。
- 设置中新增可选的自动下载开关；自动安装仍需手动确认。

## 隐私

- 自动更新只访问 GitHub Releases，只替换程序文件。
- 不读取或修改本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256 before installation; it does not bypass Gatekeeper.
