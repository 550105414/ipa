# GitHub Actions 构建 TrollStore IPA

本项目的最终交付链路为：Windows 开发 → Git → GitHub → GitHub Actions → macOS Runner → Expo Prebuild → Xcode Device Release Build → 无证书临时签名 → TrollStore IPA Artifact。

工作流文件是 `.github/workflows/build.yaml`，名称为 `Build iOS IPA`，只支持 `workflow_dispatch` 手动触发。普通 `push` 不会自动开始构建。

## 固定构建配置

- Expo SDK：55
- React Native：0.83
- Node.js：20.19.x（GitHub Actions）
- Xcode：26.3（GitHub `macos-15` Runner 中显式选择）
- Xcode Scheme：`CardWorkbench`
- 主 App Bundle Identifier：`com.xiaoke.salesworkspace`
- 小组件 Bundle Identifier：`com.xiaoke.salesworkspace.TodoWidget`
- App Group：`group.com.xiaoke.salesworkspace`
- 主 App 与小组件 iOS Deployment Target：`16.1`
- 产物：`CardWorkbench-TrollStore.ipa`

## 不需要 Apple 证书或 GitHub Secrets

这个工作流专门生成 TrollStore 使用的 IPA，不使用 Apple Distribution 证书、`.p12`、Provisioning Profile、设备 UDID、Team ID、Apple ID 密码或 App Store Connect 密钥。

因此仓库不需要配置任何 IPA 构建 Secret。旧方案中的下列 Secret 均不再读取：

- `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `BUILD_PROVISION_PROFILE_BASE64`
- `KEYCHAIN_PASSWORD`
- `APPLE_TEAM_ID`

工作流先用 `CODE_SIGNING_ALLOWED=NO` 构建 iPhone Release `.app`，再使用 macOS 内置 `codesign` 的 `-` pseudo-identity 进行 certificate-free ad-hoc 签名。这个签名不包含 Apple 证书或 Provisioning Profile，不能让普通 iOS 信任 App；它用于在上传前验证 App、小组件和所有嵌套 Framework 的结构，同时把 App Group entitlement 与 TrollStore 标准 fallback entitlements 写入主 App 和小组件。TrollStore 安装时仍会用自己的 ldid/CoreTrust 流程重新签名。

不要把证书、Provisioning Profile、Apple 密码、token 或真实 Secret 提交到 Git。仓库的 `.gitignore` 仍保留相关忽略规则，作为防误提交保护。

## 小组件同步

项目使用与 Expo SDK 55 同代的 `expo-widgets ~55.0.20`。App 首次初始化以及新增、完成、恢复或星标待办后，会把最新未完成任务快照写入 App Group，并请求 WidgetKit 刷新。

小号和中号“待办列表”组件显示当前未完成总数与最新任务。点击组件会打开 App 的计划页。

需要注意：

- App 必须至少打开过一次，才能写入第一份小组件快照。
- iOS 会自行调度桌面组件刷新，通常很快，但不保证每次写入都在同一毫秒更新画面。
- iOS 16.1 支持显示和刷新 WidgetKit 小组件，但系统原生交互式小组件从 iOS 17 才开始支持。因此在 iOS 16.1 上点击待办会打开 App，不能直接在桌面组件内勾选完成。
- `expo-widgets` 55 默认把 extension target 写成 iOS 16.2。本项目通过后置配置插件固定改回 16.1，并在 GitHub Actions 中同时断言主 target 与 extension target 都是 16.1。

## 手动运行 Workflow

1. 打开 `https://github.com/550105414/ipa`。
2. 进入 `Actions`。
3. 在左侧选择 `Build iOS IPA`。
4. 点击 `Run workflow`。
5. 选择 `main`，再次点击绿色的 `Run workflow`。
6. 等待 `Build TrollStore IPA` job 完成。

Workflow 会依次执行依赖安装、TypeScript、lint、tests、Expo 依赖检查、`expo-doctor`、Expo Prebuild、CocoaPods、Xcode target 校验、iPhone Release 编译、无证书临时签名、Payload 打包与 IPA 解包复验。

Push 成功后不会自动执行这套 Workflow，必须由你手动点击。

## 下载与安装 IPA

进入成功的 workflow run，在页面底部 `Artifacts` 区域下载：

- `CardWorkbench-TrollStore-<run number>`：包含 `CardWorkbench-TrollStore.ipa`。
- `CardWorkbench-xcode-logs-<run number>`：包含 Expo Prebuild、CocoaPods、Xcode、签名验证和 SHA-256 日志。

Artifact 保留 5 天。下载后把 IPA 发送到 iPhone，在分享菜单中用 TrollStore 打开并安装。

该 IPA 仅适用于 TrollStore 兼容设备，不能用于 App Store、TestFlight、系统普通安装、Apple Ad Hoc 分发或没有 TrollStore 的设备。TrollStore 官方当前列出的兼容范围包括 iOS 14.0 beta 2–16.6.1、特定的 iOS 16.7 RC 和 iOS 17.0；16.7.x 的其他版本以及 17.0.1+ 不适用。项目本身的最低系统仍为 iOS 16.1。

如果设备上已经存在相同 Bundle Identifier 的普通安装版本，请先卸载旧版本；如果旧版本本来就由 TrollStore 管理，可以在 TrollStore 中处理替换。卸载前先确认是否需要保留旧 App 数据。

## 常见错误排查

### Expo Prebuild / 依赖

- `expo-doctor` 或 `expo install --check` 失败：不要升级到 Expo SDK 56+；在 `mobile/CardWorkbench` 修复为 SDK 55 兼容版本后重新提交。
- 生成的 Scheme 不是 `CardWorkbench`：确认 `app.json` 中 `expo.name` 仍为 `CardWorkbench`。
- target 不是 iOS 16.1：检查 `expo-build-properties` 与 `plugins/with-widget-deployment-target.js`，不要把最低版本提高。
- 出现 `aps-environment`：小组件不使用推送，后置插件应移除该 entitlement；Workflow 会主动拒绝它。

### CocoaPods / expo-widgets

- `pod install` 找不到 Pod：先查看 `expo-prebuild.log`，确认 `expo-widgets ~55.0.20` 和 `@expo/ui ~55.0.17` 已安装。
- 小组件 target 不存在：检查 `app.json` 的 `expo-widgets` 插件配置与 `xcode-project.log`。
- 小组件空白：查看 Xcode 日志并确认生成的 `.appex/ExpoWidgets.bundle/ExpoWidgets.bundle` JS runtime 存在且非空；Workflow 会在打包前和解包后各检查一次。
- App 更新但组件不刷新：先打开 App 一次；确认主 App 与 `.appex` 的签名 entitlement 都包含 `group.com.xiaoke.salesworkspace`。

### Xcode Device Build

- 找不到 `.xcworkspace`：检查 Expo Prebuild 与 CocoaPods 两份日志。
- 找不到 `CardWorkbench` Scheme：不要修改 `expo.name` 或原生项目名。
- `Release-iphoneos` 没有生成 `.app`：查看 `xcodebuild-device.log` 中第一条编译错误。
- 某依赖要求 iOS 16.4 或更高：不要提高 Deployment Target；移除或降回 Expo SDK 55、iOS 16.1 兼容版本。

### Certificate-free 签名 / App Group

- 不应出现 Apple Distribution、Provisioning Profile 或 Team ID 错误；工作流完全不读取这些资料。
- `Signature=adhoc` 校验失败：查看 `codesign-app.log`、`codesign-widget.log` 和 `codesign-verify.log`，通常是嵌套 Framework 或 `.appex` 没有按由内到外的顺序签名。
- App Group entitlement 缺失：主 App 与小组件必须分别使用 prebuild 生成的 entitlement 文件临时签名，否则两者不能共享待办快照。
- 发现 `embedded.mobileprovision`：Workflow 会拒绝产物，确保没有把任何描述文件手工复制进工程。

### IPA / TrollStore

- IPA 结构错误：压缩包根目录必须只有 `Payload/CardWorkbench.app`；Workflow 会打包后解压复验。
- TrollStore 提示无法签名：更新或修复设备上的 TrollStore/ldid，然后重新安装；GitHub 产物本身不附带 Apple 证书。
- TrollStore 提示相同 Bundle ID 冲突：先处理设备上已有的 `com.xiaoke.salesworkspace` 安装。
- 安装后无法运行：确认设备版本受 TrollStore 支持，且主可执行文件包含 arm64、未加密；Workflow 会对这些项目做预检查。

## 验证状态

- Windows：`npm ci`、TypeScript、lint、tests、Expo 依赖检查与 `expo-doctor` 可在本地验证。
- macOS：Expo Prebuild 原生工程、CocoaPods、真实 widget extension、Xcode Device Release、App Group entitlement、certificate-free 签名和 IPA 打包只能由 GitHub macOS Runner 验证。
- **GitHub macOS IPA Build：等待 GitHub Actions 验证。**

参考：

- [Expo SDK 55 Widgets 文档](https://docs.expo.dev/versions/v55.0.0/sdk/widgets/)
- [TrollStore 官方仓库](https://github.com/opa334/TrollStore)
