import SwiftUI
import WidgetKit

struct TodoWidget: Widget {
    let kind = TodoWidgetStore.widgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodoWidgetProvider()) { entry in
            TodoWidgetView(entry: entry)
        }
        .configurationDisplayName("牛马待办")
        .description("查看今天需要处理的客户待办。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
