# Debate Studio 0.6.1 macOS Release Checklist

当前版本为 `0.6.1`，bundle identifier 为 `com.leander.debatestudio`。

## 发布策略

- 0.6.1 作为个人/社区维护的本地 macOS 应用发布。
- 当前 GitHub Release 提供未签名、未公证的 Apple Silicon（arm64）DMG。
- Debate Studio 不提供账号、云同步或项目自有服务器，不会把用户数据库、凭据、研究资料或辩论记录上传给项目方。
- DMG 只作为 GitHub Release 附件和 CI artifact 提供，不进入 Git 仓库。
- 应用运行数据保存在 `~/Library/Application Support/debate-studio`，不得复制到源码、构建上下文或 Release 附件中。

## 提交前安全检查

确认工作树中没有数据库、凭据、日志、诊断报告、导出文件或 Electron userData：

```bash
git status --short --ignored
git ls-files
git diff --check
```

重点确认以下内容未被 Git 跟踪：

- `.env`、`.env.*`、`.DS_Store`
- `release/`、`*.dmg`、`*.blockmap`
- `*.sqlite`、`*.sqlite-*`、`*.sqlite3`、`*.db`
- `*.log`、`*.jsonl`、`credentials.bin`
- `userData/`、日志、诊断、导出和备份目录
- Keychain 导出、safeStorage 文件、签名证书和私钥

源码和测试中允许使用明确的 Mock/测试假凭据，但不得包含任何真实 API Key、Bearer Token 或服务商账号数据。

## 干净构建

从无旧产物的工作区安装依赖、验证并构建：

```bash
rm -rf out release
npm ci
npm test
npm run typecheck
npm run build
npm run release:mac:arm64
npm run release:check
```

预期产物：

`release/Debate-Studio-0.6.1-arm64.dmg`

构建完成后检查 DMG 内部的 `app.asar` 和 `Contents/Resources`，确认没有数据库、凭据、用户内容、日志、诊断报告或导出文件。记录最终文件大小和 SHA-256。

## GitHub Release

- 使用与 `package.json` 版本一致的 Git tag 和 Release 标题。
- 将 `release/Debate-Studio-0.6.1-arm64.dmg` 作为附件上传；不要提交 `release/` 目录。
- Release 说明必须明确标注“未签名、未公证”和 Apple Silicon（arm64）。
- 发布后从 GitHub 下载附件，重新核对 SHA-256，并在隔离的新用户数据目录中执行首次启动验收。

GitHub Actions 会运行测试、类型检查、构建检查，并将未签名 DMG 作为 workflow artifact 或 Release 附件上传。

## 未签名版本的更新策略

- 应用内只检查 GitHub Releases、下载 arm64 DMG，并校验 GitHub 提供的文件大小与 SHA-256。
- 应用不得退出后移动或替换 `/Applications/Debate Studio.app`，不得创建 App 备份、执行安装 shell 脚本、循环拉起或自动删除旧版本。
- 下载完成后由用户打开 DMG、拖入 Applications 并选择替换。
- 只有未来完成 Apple Developer ID 签名与 notarization 后，才可以另行评估标准 `electron-updater` 自动安装。

## 用户首次打开

由于当前 DMG 没有 Apple Developer ID 签名和公证，macOS Gatekeeper 可能阻止首次打开。用户应仅从可信的项目 Release 页面下载，并可在“系统设置 → 隐私与安全性”中选择“仍要打开”。

不要要求用户关闭 Gatekeeper，也不要在发布包、文档示例或日志中提供真实 API Key。

## 可选的 Developer ID 签名与公证

未来如使用 Apple Developer Program 证书，可执行：

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
npm run release:mac:signed
```

签名后使用 `codesign --verify --deep --strict --verbose=2` 验证。公证凭据应保存在 macOS Keychain，再通过 `APPLE_NOTARY_KEYCHAIN_PROFILE` 调用 `npm run release:notarize`；不得把证书、私钥或公证密码提交到仓库。

## 应用安全边界

- 主窗口启用 Renderer sandbox、`contextIsolation: true`、`nodeIntegration: false`。
- Hardened Runtime 与主进程/Helper entitlements 已配置；当前未启用仅适用于 Mac App Store 的 App Sandbox。
- SQLite、备份、日志、诊断文件和研究资产目录限制为当前用户访问。
- 凭据由 macOS `safeStorage` 加密后独立保存，不进入 SQLite、数据库备份或导出文件。
- 数据库升级前自动备份；migration 失败时恢复升级前快照。
