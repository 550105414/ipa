# CardWorkbench

`CardWorkbench` 是仓库中的 Expo SDK 55 原生 iOS 待办客户端，使用 React Native、TypeScript、Expo Router、SQLite 与 WidgetKit。

- Bundle Identifier：`com.xiaoke.salesworkspace`
- 小组件 Bundle Identifier：`com.xiaoke.salesworkspace.TodoWidget`
- iPhone 显示名称：`工作台`
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

App 首页、待办、已完成和桌面小组件均为 React Native / WidgetKit 原生界面；客户云端资料在独立的原生容器中打开，并隐藏网站导航外壳。Xcode Device Release、小组件 `.appex`、App Group entitlement 与 TrollStore IPA 打包只能在 macOS Runner 验证。完整说明见根目录 `docs/GITHUB_IPA_BUILD.md`。
