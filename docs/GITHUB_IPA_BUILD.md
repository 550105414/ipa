# GitHub Actions 构建 iOS IPA

本项目的最终交付链路为：Windows 开发 → Git → GitHub → GitHub Actions → macOS Runner → Expo Prebuild → Xcode → Apple 签名 → IPA Artifact。

工作流文件是 `.github/workflows/build.yaml`，名称为 `Build iOS IPA`，只支持 `workflow_dispatch` 手动触发。普通 `push` 不会启动 IPA 构建。

## 固定构建配置

- Expo SDK：55
- React Native：0.83
- Node.js：20.19.x（GitHub Actions）
- Xcode Scheme：`CardWorkbench`
- Bundle Identifier：`com.xiaoke.salesworkspace`
- iOS Deployment Target：`16.1`
- 签名方式：Apple Distribution + Ad Hoc Provisioning Profile

## 准备 Apple 签名文件

需要准备两项文件：

1. Apple Distribution 证书及其私钥导出的 `.p12` 文件。
2. 与 Team ID 和 `com.xiaoke.salesworkspace` 完全匹配的 Ad Hoc `.mobileprovision` 文件；其中应包含需要安装 IPA 的设备 UDID。

不要把证书、Provisioning Profile、Apple 密码或任何密钥放进 Git。Base64 只是编码，不是加密。

在 Windows PowerShell 中可直接把文件编码复制到剪贴板，不需要生成中间文件：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\AppleSigning\distribution.p12')) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\AppleSigning\CardWorkbench_AdHoc.mobileprovision')) | Set-Clipboard
```

每次执行一条命令，并立即把剪贴板内容保存到对应 GitHub Secret。不要把输出粘贴到终端、聊天、Issue、提交或构建日志中。

## 配置 5 个 GitHub Secrets

进入目标仓库：`Settings` → `Secrets and variables` → `Actions` → `New repository secret`，只配置以下五项：

| Secret | 内容 |
| --- | --- |
| `BUILD_CERTIFICATE_BASE64` | `.p12` 文件的 Base64 完整内容 |
| `P12_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `BUILD_PROVISION_PROFILE_BASE64` | Ad Hoc `.mobileprovision` 文件的 Base64 完整内容 |
| `KEYCHAIN_PASSWORD` | 本次 CI 临时 Keychain 使用的随机强密码，不是 Apple ID 密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID，必须是 10 位字母或数字 |

工作流不会读取 Apple ID 密码，也不会创建或提交包含真实 Secret 的 `.env` 文件。签名 Secret 仅注入签名相关步骤；证书、描述文件、临时 Keychain 和 `ExportOptions.plist` 会在 job 结束时清理。

建议限制仓库写权限，并保护 `main` 分支。任何能够修改并运行 workflow 的写入者，都可能设法读取构建 Secret。

## 手动运行 Workflow

1. 打开目标 GitHub 仓库。
2. 进入 `Actions`。
3. 在左侧选择 `Build iOS IPA`。
4. 点击 `Run workflow`。
5. 选择 `main`，再次点击绿色的 `Run workflow`。
6. 等待 `Build signed IPA` job 完成。

workflow 会依次执行依赖安装、TypeScript、lint、tests、Expo 依赖检查、`expo-doctor`、Expo Prebuild、CocoaPods、签名校验、Xcode Archive 和 IPA Export。

## 下载 IPA 和构建日志

进入完成的 workflow run，在页面底部 `Artifacts` 区域下载：

- `CardWorkbench-ipa-<run number>`：包含 `CardWorkbench.ipa`。
- `CardWorkbench-xcode-logs-<run number>`：包含已脱敏的 Expo Prebuild、CocoaPods 和 Xcode 日志。

Artifact 保留 5 天。请及时下载；不要把 IPA、证书或 Provisioning Profile 再提交回仓库。

## 常见错误排查

### Expo Prebuild

- `expo-doctor` 或 `expo install --check` 失败：先在 `mobile/CardWorkbench` 运行 `npx expo install --fix`，再重新执行本地检查。
- 生成的 scheme 不是 `CardWorkbench`：确认 `app.json` 中 `expo.name` 仍为 `CardWorkbench`，不要提交手工生成的 `ios` 目录覆盖配置。
- Deployment Target 不是 16.1：确认 `expo-build-properties` 的 `ios.deploymentTarget` 为字符串 `16.1`。

### CocoaPods

- `pod install` 找不到 podspec：通常是依赖版本与 Expo SDK 55 不匹配，先运行 `npx expo-doctor` 和 `npx expo install --check`。
- Specs 或下载超时：重跑同一 workflow；若持续失败，再检查日志中的具体 Pod 和网络错误。

### Xcode / Archive

- 找不到 `.xcworkspace`：检查 Expo Prebuild 和 CocoaPods 两份日志，确认前面的步骤已经成功。
- 找不到 `CardWorkbench` scheme：不要把 `expo.name` 或项目目录名称改成其他值。
- 依赖要求 iOS 16.4 或更高：不要升级该依赖；改用与 Expo SDK 55、iOS 16.1 兼容的版本。

### Code Signing / Provisioning Profile

- `No valid Apple Distribution signing identity`：`.p12` 不含私钥、证书已失效，或 `P12_PASSWORD` 错误。
- Team ID 不匹配：`APPLE_TEAM_ID` 与 Provisioning Profile 的 Team 不一致。
- Bundle Identifier 不匹配：Ad Hoc Profile 必须精确匹配 `com.xiaoke.salesworkspace`，不接受通配符 Profile。
- `Provisioning Profile is not an Ad Hoc profile`：上传的是 Development 或 App Store Profile；重新创建 Ad Hoc Profile。
- Profile 过期：在 Apple Developer 后台重新生成并替换 `BUILD_PROVISION_PROFILE_BASE64`。
- IPA 无法安装：确认目标 iPhone 的 UDID 已包含在该 Ad Hoc Profile 中，并重新生成 Profile。

### Export Archive

- Archive 成功但 Export 失败：优先查看 `xcodebuild-export.log`，核对证书类型、Profile、Team ID 与 Bundle Identifier。
- 没有生成 IPA：workflow 会要求导出目录中恰好存在一个非空 IPA；查看 export 日志中的第一条 signing error。

## 验证状态

- Windows TypeScript、lint、tests、依赖和 `expo-doctor`：可在本地验证。
- iOS Expo Prebuild 原生工程生成、CocoaPods、Xcode Archive、Apple 签名、IPA Export：Windows 无法完成，必须由 macOS Runner 验证。
- **GitHub macOS IPA Build：等待 GitHub Actions 验证。**
