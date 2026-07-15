# 本地数据存储

## 默认目录

macOS 默认使用：

```text
~/Library/Application Support/debate-studio/
```

开发和自动测试可用 `DEBATE_STUDIO_USER_DATA_DIR` 指向隔离的绝对路径。

## 目录内容

| 路径 | 内容 |
| --- | --- |
| `debate-studio.sqlite` | 辩论、模型配置、研究、证据、Usage、历史、导出记录和设置 |
| `security/credentials.bin` | `safeStorage` 加密的独立凭据库 |
| `assets/research/` | 用户导入的图片、PDF 与图片缩略图 |
| `logs/` | 自动轮转、已脱敏的结构化日志 |
| `diagnostics/` | 错误中心记录和用户主动生成的诊断报告 |
| `exports/` | Markdown / HTML 辩论导出 |
| `backups/` | 手动与 migration 前 SQLite 备份 |

目录权限为 `0700`，数据库、凭据和资产文件以 `0600` 写入。

## 备份与恢复

- migration 前自动创建 SQLite 备份。
- 设置页支持手动备份、列出备份和二次确认恢复。
- 备份不包含 `credentials.bin`，不会出现 API Key 明文。
- 恢复前停止在途 Session；恢复后重启应用。

## 删除

历史页默认软删除辩论，关联 Turn、研究和证据仍可恢复。Provider、ModelProfile 和凭据不随辩论删除。若要彻底清除本地数据，请退出应用后删除整个 `debate-studio` 数据目录；此操作不可撤销。
