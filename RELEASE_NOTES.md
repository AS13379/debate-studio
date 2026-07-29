# Debate Studio v0.7.0

## Sparkle 2 自动更新

- macOS 客户端正式接入 Sparkle 2 原生更新。
- 支持检查、下载、EdDSA 校验、自动替换应用和重新启动。
- 更新包发布前会检查 `app.asar`、Sparkle Framework、原生桥接、Bundle 信息、ZIP 文件清单和深层代码签名。
- 首次安装仍提供 DMG；后续版本可以通过应用内 Sparkle 更新。

## 数据与隐私

- 更新只替换 Debate Studio 应用程序。
- SQLite、API Key、模型配置、历史辩论、研究资料和 LAN 设置保留在原位置。
- 不提供云同步、遥测或用户数据收集。

## macOS

This is an unsigned Apple Silicon community build. Sparkle update archives are independently verified with the Debate Studio EdDSA release key.
