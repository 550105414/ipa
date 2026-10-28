# 工作台 Android 待办小组件

这是 Expo SDK 55 使用的 Android-only 本地模块。iOS 继续由已有的 WidgetKit 实现负责；本模块不会创建 Apple target，也不需要服务器、EAS 或推送证书。

## 桥接接口

`requireNativeModule('CardWorkbenchWidget')` 提供：

- `updateSnapshot(json: string): Promise<void>`：验证 schema v2，将允许的待办字段写入 App 私有 SharedPreferences，然后刷新全部已添加的小组件。
- `canScheduleExactAlarms(): boolean`：Android 12 起检查“闹钟和提醒”特殊权限，旧版返回 true。
- `openExactAlarmSettings(): boolean`：Android 12 起尝试打开本 App 的精确闹钟授权页，设备不支持时返回 false。

Metro 选择 `src/widgets/todo-widget.android.tsx`。此适配器使用现有 `createWidgetSnapshot` 排除已完成待办，保留未来待办供原生定时显示，并串行执行写入以防快速编辑覆盖为旧快照。调用失败会向现有计划页报告错误，而不是伪报写入成功。

## 显示与刷新

- 默认 2 列 × 2 行紧凑卡片；Android 12 起声明 `targetCellWidth/Height=2`，旧系统使用 110dp 的最小宽高，允许继续拖大。实际像素形状由桌面网格决定，不保证所有桌面都完全正方形。已放置的旧 3×2 卡片可能保留旧尺寸，安装新版后可缩放或移除重加。
- 白底圆角列表，显示“全部”、已到时间数量、标题、日期和星标。常见 2×2 高度约显示 2 条带日期待办或 3 条无日期待办；具体受系统字体和桌面分配高度影响。标题、日期单行省略，剩余条目显示“还有 N 项”，不删除 App/快照内的任务。没有到期待办时只显示两行简短提示，不再重复占用“点击打开工作台”页脚。
- 布局按实际高度及系统字体倍率预算，仅显示完整行，不再强塞第一行；极小高度或超大字体放不下时保留数量/点击查看入口。窄卡片会隐藏装饰图标；窄卡片配超大字体时隐藏可视计数以保留标题，读屏仍可读出总数。点击列表进入计划，点击某行打开相应待办。
- 无日期待办立即显示；仅日期从设备当地零点显示；带时分待办达到其时间点才显示；格式错误的日期不会误当无日期显示。App 内仍能提前查看和编辑。
- 写入快照即刷新；存在未来待办时，只为下一次到期设置一个 AlarmManager 闹钟。闹钟到达后从持久化快照重绘并继续安排下一个，不要求 React Native 或 App 页面保持运行。
- 精确闹钟权限允许时使用 `setExactAndAllowWhileIdle`，否则降级 `setAndAllowWhileIdle`。宿主需声明 `android.permission.SCHEDULE_EXACT_ALARM`，不使用 `USE_EXACT_ALARM`。未授权精确闹钟、Doze 或厂商省电策略均可能延迟显示，不能保证强制准点、亮屏或绕过省电。
- 开机、设备时间/时区变化、App 更新及精确闹钟授权变化时恢复刷新；另有系统 30 分钟更新作为补充。移除最后一个小组件后取消专用闹钟。
- 两个 receiver 均 `exported=false`，闹钟使用显式广播、immutable PendingIntent。只从 App 私有偏好读取数据，不接受广播注入的快照，不持久化密码、Token 或整个数据库。

## 验证

`tests/android-widget.test.mjs` 覆盖 JS 桥接的写入内容、顺序、失败恢复和字段隔离。

`tests/android-widget-layout.test.mjs` 防止默认网格、最小尺寸及 XML 字体与原生布局预算回归。原生 `TodoWidgetLayoutTest` 覆盖 2×2 行数、剩余数量、完整行边界、字体放大、缩放和空数据；可与日期测试一起运行模块的 `testReleaseUnitTest`。

原生 `TodoWidgetDatesTest` 覆盖时区、仅日期零点、ISO 偏移、无效日期、DST 缺失小时、到时边界和下一次闹钟选择。可在生成 Android 工程后运行模块的 `testReleaseUnitTest` Gradle 任务。本地已用实际 Kotlin 编译器/JUnit 运行其 6 项测试；这不等于 APK 编译或桌面真机渲染已验证，后两项需要交付时单独确认。

依据：[Android 小组件尺寸与布局](https://developer.android.com/develop/ui/views/appwidgets/layouts)、[Android 闹钟及权限](https://developer.android.com/develop/background-work/services/alarms)。
