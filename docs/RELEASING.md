# macOS 发布说明

## 发布前安全检查

每次公开发布前运行：

```bash
npm ci
npm run test:secrets
npm run build
npm run test:rules
npm run test:xhs
```

`test:secrets` 会检查已跟踪文件和所有可达 Git 提交；它只报告文件或提交，不会输出疑似密钥的值。任何 API Key、Cookie、报告原件、`.env` 文件或本机数据都不能提交到仓库。

用户在 App 内填写的 AI API Key 仅通过 macOS Keychain 加密后保存在该用户的本机，不会进入 GitHub、安装包或应用日志。若密钥曾出现在聊天、终端历史、Issue 或提交中，应立刻在对应服务商后台撤销并轮换。

## 本地 Beta 包

```bash
npm run package:mac
```

输出位于 `release/`：

- `研报笔记-Agent-mac-arm64.zip`
- 对应的 `.sha256` 校验文件

这是 M 系列芯片（Apple Silicon）的开发测试包，使用 ad-hoc 签名。它通过完整性校验，但没有 Apple 公证；其他用户首次打开可能会被 Gatekeeper 拦截。

## 面向公众的正式版

在 GitHub Release 分发前，必须完成：

1. 分别提供 `mac-arm64` 与 `mac-x64` 包，或构建经过验证的 universal 包。
2. 使用 Apple Developer 的 `Developer ID Application` 证书签名，并启用 Hardened Runtime 和时间戳。
3. 通过 `xcrun notarytool submit --wait` 提交 Apple 公证，再用 `xcrun stapler staple` 写入公证票据。
4. 在干净的另一台 Mac 上验证：`spctl --assess --type execute --verbose=4 "研报笔记 Agent.app"` 返回 accepted。
5. 上传 ZIP、SHA-256 校验文件和版本说明到 GitHub Release。

签名证书、Apple ID、App 专用密码和公证凭据只能保存在发布机器的受控钥匙串或 CI Secret 中，绝不能写入仓库、`.env.example` 或聊天记录。

当前版本没有自动更新功能；用户升级时需从 GitHub Release 手动下载新版本并覆盖旧 App。
