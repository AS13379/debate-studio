# 安全设计

## Electron 边界

- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer 只能通过 preload 白名单调用主进程。
- 所有 IPC 输入使用 Zod 严格校验，未知字段被拒绝。

## 凭据

API Key 在 UI 提交后只短暂存在于 Renderer 表单和 IPC 入参。主进程使用 Electron `safeStorage` 加密整个凭据库，再以 `0600` 权限写入应用数据目录。SQLite 只保存内部引用，DTO 不返回该引用。

禁止记录或导出的字段包括：API Key、Authorization Header、token、secret、`credentialRef`、私有研究全文和完整网页正文。Logger、ErrorCenter、事件与导出均使用递归脱敏。

如果系统加密不可用，保存凭据会返回结构化中文错误；不会回退到默认明文存储。

## 网络

- 只有用户主动测试连接、运行真实辩论或启用真实研究时才发起请求。
- 自动测试不访问真实网络。
- 网页读取拒绝 `file://`、回环、本机、局域网和非 HTTP(S) 地址。
- 图片不会发送给纯文本模型；必须存在 `vision_analysis` 路由且 ModelProfile 声明 `imageInput`。

## 开源检查

提交前运行：

```bash
git ls-files | rg '\.(sqlite|db|log|jsonl)$'
rg -n '/Users/|Authorization:|sk-[A-Za-z0-9]|tvly-' --glob '!package-lock.json'
```

测试可以使用明显标注的假密钥，但不得复制真实日志、数据库、导出或截图到仓库。
