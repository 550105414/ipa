# 牛马 iOS 个人版

这是销售工作台的原生 iOS 外壳。App 名称为“牛马”，Bundle ID 为 `com.xiaoke.salesworkspace`，最低系统版本为 iOS 16.0（支持 iOS 16.2）。

## 已包含

- App 启动后直接打开现有私有销售工作台，不再设置额外的本机账号密码门禁。
- 使用持久化 `WKWebView` Cookie 打开现有私有销售工作台。
- 支持网页里的相册选择、相机拍照、电话和短信链接。
- 支持网络失败重试、网页返回、重新加载和主动退出。
- 支持深浅色模式、Dynamic Type、VoiceOver 和不小于 44pt 的点击区域。
- 1024×1024 正式 App 图标。

> App 不保存工作台账号密码。网站登录和客户数据权限仍由私有站点及后端控制。

## 用 GitHub Actions 生成 IPA

仓库根目录的 `.github/workflows/build.yaml` 提供手动打包。工作流在 GitHub 的 macOS runner 上运行单元测试、临时导入签名证书和描述文件、生成签名 IPA，然后将 IPA 保存为 5 天有效的 Artifact。证书和描述文件会在任务结束时清理。

建议将仓库设为私有。不要把 `.p12`、`.mobileprovision`、私钥或密码提交到 Git。

在 GitHub 仓库打开 **Settings → Secrets and variables → Actions**，添加以下 Repository secrets：

- `APPLE_TEAM_ID`：Apple Developer Team ID，通常为 10 位字母数字。
- `BUILD_CERTIFICATE_BASE64`：包含私钥的 `.p12` 文件转换后的 Base64 全文。
- `P12_PASSWORD`：导出 `.p12` 时设置的密码。
- `BUILD_PROVISION_PROFILE_BASE64`：匹配 `com.xiaoke.salesworkspace` 的 `.mobileprovision` 文件转换后的 Base64 全文。
- `KEYCHAIN_PASSWORD`：只给 GitHub runner 临时钥匙串使用的随机强密码。

在 Windows PowerShell 中，可以从 D 盘读取签名文件并把 Base64 复制到剪贴板。不要把输出保存进仓库或发送到聊天：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\signing\distribution.p12')) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\signing\app.mobileprovision')) | Set-Clipboard
```

配置完成后：

1. 进入 GitHub 仓库的 **Actions**。
2. 选择 **Build signed IPA**。
3. 点击 **Run workflow**。
4. 个人安装通常选择 `release-testing`；描述文件必须包含目标 iPhone 的 UDID，并搭配 Apple Distribution 证书。
5. 如需开发调试包，选择 `debugging`，并改用 Apple Development 证书和开发描述文件。
6. 成功后，在本次运行页面的 **Artifacts** 下载 `NiuMa-...` 压缩包，解压即可得到 IPA。

工作流会提前校验 Team ID、Bundle ID、描述文件和签名材料。任何一项不匹配都会停止，不会生成未签名的假 IPA。

## 在 Mac 上本地生成 IPA

要求：macOS、Xcode 16 或更新版本，以及与 Bundle ID 匹配的证书和描述文件。

在 Xcode 中打开 `NiuMa.xcodeproj`，在 **Signing & Capabilities** 选择自己的 Team 后，可以直接真机运行或使用 **Product → Archive** 导出。

也可以在终端执行：

```zsh
cd ios/NiuMa
chmod +x scripts/export-ipa.sh
./scripts/export-ipa.sh 你的TEAM_ID release-testing 描述文件UUID
```

开发调试包：

```zsh
./scripts/export-ipa.sh 你的TEAM_ID debugging 描述文件UUID
```

输出位于 `ios/NiuMa/build/ipa/`。脚本也兼容旧参数名 `development` 和 `ad-hoc`。

## 安全说明

- Base64 只是编码，不是加密；签名材料只放在 GitHub 加密 Secrets 中。
- 不要通过聊天发送证书私钥或密码。
- GitHub Actions 日志不会主动输出证书、描述文件或密码。
- App 没有内置账号密码，真正的数据安全边界是网站登录、后端权限和数据库加密。

## 工程结构

- `NiuMa.xcodeproj`：Xcode 工程与共享 Scheme。
- `NiuMa/App`：App 入口和根视图。
- `NiuMa/Design`：主题颜色和品牌标识。
- `NiuMa/Features/Workspace`：`WKWebView` 工作台、导航和错误状态。
- `NiuMa/Resources`：`Info.plist`、颜色和 App 图标。
- `NiuMaTests`：工作台原生外壳单元测试。
- `scripts/export-ipa.sh`：Mac 上归档和导出 IPA。
