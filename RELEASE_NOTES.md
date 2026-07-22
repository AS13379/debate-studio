# Debate Studio v0.5.10

## 自动更新流程简化

- 安装过程现在只执行退出旧版、替换应用、清除隔离属性和打开新版，不再等待容易误判的进程健康确认。
- macOS 接受打开请求后安装终端会显示完成并自动关闭，不会因新版短暂退出而擅自回滚。
- 旧版临时备份只用于安装步骤失败时回滚；macOS 接受打开新版后由安装终端立即清理。
- 更新仍只替换 Debate Studio 应用程序文件，不修改 SQLite、API Key、模型配置、Prompt、辩论或研究数据。

## 隐私

- 应用更新只访问 GitHub Releases，不读取或上传本地模型凭据、SQLite 数据库、辩论和研究记录。

## macOS notice

This release simplifies the project-signed community updater and removes false startup-health rollbacks. It contains no product feature changes.
