# Debate Studio v0.5.5

## 可观察的更新安装

- 应用内安装更新时打开独立终端，完整展示退出旧版本、备份、替换、启动、健康确认及回滚进度。
- 支持中文和 English 安装说明；没有及时选择时自动使用中文。
- 安装失败会显示稳定错误代码、回滚状态和日志位置，终端保持打开，方便截图和排查。
- 安装成功后终端自动关闭，并保留一份不含用户内容和凭据的轻量诊断日志。
- 更新仍只替换应用程序文件，不修改 SQLite、API Key、模型配置、Prompt、辩论或研究数据。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或修改本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This community build is not signed or notarized with Apple Developer ID. The in-app updater verifies update packages with the Debate Studio project's Ed25519 key and SHA256 before installation; it does not bypass Gatekeeper.
