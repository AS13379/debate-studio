# Debate Studio v0.6.3

## Markdown / GFM 表格修复

- 裁决、赛后分析、实时辩论和历史详情中的标准 Markdown 表格现在会显示为真正的表格。
- Electron 客户端与局域网 Web 使用相同的 GFM 解析配置。
- 增加适配深浅色界面的表格样式；手机端表格可独立横向滚动。
- 同时支持 GFM 删除线、任务列表和自动链接。
- 原始 HTML 继续保持禁用，不开放脚本或不安全内容执行。

## 隐私

- 本版本不修改 SQLite 数据结构、模型配置、API Key、Prompt、辩论或研究数据。
- 应用更新只访问 GitHub Releases，不读取或上传本地内容。

## macOS notice

This unsigned Apple Silicon build renders GFM tables consistently in Electron and the LAN Web console. It contains no cloud services, telemetry, or changes to local user data. The in-app updater downloads and verifies the DMG but does not replace the installed application automatically.
