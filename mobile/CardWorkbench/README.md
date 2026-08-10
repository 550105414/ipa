# CardWorkbench

`CardWorkbench` 是仓库中的 Expo SDK 55 原生 iOS 待办客户端，使用 React Native、TypeScript、Expo Router、SQLite 与 WidgetKit。

- Bundle Identifier：`com.xiaoke.salesworkspace`
- 小组件 Bundle Identifier：`com.xiaoke.salesworkspace.TodoWidget`
- iPhone 显示名称：`个人工作台`
- iOS Deployment Target：`16.1`
- 正式产物：通过根目录 `.github/workflows/build.yaml` 在 GitHub macOS Runner 手动生成 TrollStore IPA

Windows 本地检查：

```powershell
npm ci
npx tsc --noEmit
npm run lint --if-present
npm run test --if-present
npx expo install --check
npx expo-doctor
```

App UI、待办 SQLite 数据与小组件快照同步在本项目内完成，不再依赖 WebView 或远程网页。Xcode Device Release、小组件 `.appex`、App Group entitlement 与 TrollStore IPA 打包只能在 macOS Runner 验证。完整说明见根目录 `docs/GITHUB_IPA_BUILD.md`。
