# CardWorkbench

`CardWorkbench` 是仓库中的 Expo SDK 55 iOS 客户端，使用 React Native、TypeScript、Expo Router、SQLite 和 WebView。

- Bundle Identifier：`com.xiaoke.salesworkspace`
- iPhone 显示名称：`个人工作台`
- iOS Deployment Target：`16.1`
- 正式 IPA：仅通过根目录 `.github/workflows/build.yaml` 在 GitHub macOS Runner 手动构建

Windows 本地检查：

```powershell
npm ci
npx tsc --noEmit
npm run lint --if-present
npm run test --if-present
npx expo-doctor
```

Apple 签名和 IPA 导出只能在 macOS Runner 上验证。完整配置见根目录 `docs/GITHUB_IPA_BUILD.md`。
