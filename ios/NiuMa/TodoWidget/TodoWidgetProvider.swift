import WidgetKit

struct TodoWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodoWidgetEntry {
        TodoWidgetEntry(date: .now, snapshot: previewSnapshot)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodoWidgetEntry) -> Void) {
        let snapshot = TodoWidgetStore.load()
        completion(
            TodoWidgetEntry(
                date: .now,
                snapshot: context.isPreview && snapshot.items.isEmpty ? previewSnapshot : snapshot
            )
        )
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodoWidgetEntry>) -> Void) {
        let entry = TodoWidgetEntry(date: .now, snapshot: TodoWidgetStore.load())
        let refreshDate = Date.now.addingTimeInterval(15 * 60)
        completion(Timeline(entries: [entry], policy: .after(refreshDate)))
    }

    private var previewSnapshot: TodoWidgetSnapshot {
        TodoWidgetSnapshot(
            version: 1,
            updatedAt: .now,
            items: [
                TodoWidgetItem(id: "preview-1", title: "回访客户并确认资料", dueAt: .now),
                TodoWidgetItem(id: "preview-2", title: "补充商户进件信息", dueAt: nil),
            ]
        )
    }
}
