# Debate Studio macOS Release Checklist

当前 RC 版本为 `0.1.0-rc.1`，bundle identifier 为 `com.leander.debatestudio`。应用数据固定保存在：

`~/Library/Application Support/debate-studio`

## 未签名验收构建

```bash
npm ci
npm test
npm run typecheck
npm run release:mac:arm64
npm run release:check
```

产物位于 `release/Debate-Studio-0.1.0-rc.1-arm64.dmg`。这个命令明确关闭证书自动发现，只用于本地验收，不应直接公开分发。

## Developer ID 签名

需要有效的 Apple Developer Program 会员资格，以及安装在登录钥匙串中的 `Developer ID Application` 证书和私钥。项目不会生成或伪造证书。

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
npm run release:mac:signed
```

签名后应使用 `codesign --verify --deep --strict --verbose=2` 和 `codesign -dv --verbose=4` 检查应用包。

## 公证

先把 Apple 公证凭据安全保存到 macOS Keychain，避免把密码放进代码、日志或进程参数：

```bash
xcrun notarytool store-credentials "debate-studio-notary"
export APPLE_NOTARY_KEYCHAIN_PROFILE="debate-studio-notary"
npm run release:notarize -- /absolute/path/to/Debate-Studio-0.1.0-rc.1-arm64.dmg
```

脚本会等待 Apple 公证结果并执行 stapling。最后使用 `xcrun stapler validate` 与 `spctl --assess --type open --context context:primary-signature` 验证。

## 安全边界

- 主窗口启用 Renderer sandbox、`contextIsolation: true`、`nodeIntegration: false`。
- Hardened Runtime 与主进程/Helper entitlements 已配置；未启用仅适用于 Mac App Store 的 App Sandbox。
- SQLite、备份、日志、诊断文件和研究资产目录使用仅当前用户可读写权限。
- 凭据由 macOS `safeStorage` 加密后独立保存，不进入 SQLite 备份。
- 数据库升级前自动备份；migration 失败时自动恢复升级前快照。
