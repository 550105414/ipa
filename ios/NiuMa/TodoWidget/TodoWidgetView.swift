import SwiftUI
import WidgetKit

struct TodoWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodoWidgetEntry

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("今天")
                        .font(.title2.bold())
                        .foregroundStyle(Color.accentColor)

                    Text("\(entry.snapshot.items.count)")
                        .font(.headline)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Image(systemName: "checklist")
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }

                if entry.snapshot.items.isEmpty {
                    Spacer()
                    Label("今天暂无待办", systemImage: "checkmark.circle")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                } else {
                    VStack(spacing: 9) {
                        ForEach(entry.snapshot.items.prefix(maximumVisibleItems)) { item in
                            TodoWidgetTaskRow(item: item)
                        }
                    }

                    Spacer(minLength: 0)

                    if entry.snapshot.items.count > maximumVisibleItems {
                        Text("还有 \(entry.snapshot.items.count - maximumVisibleItems) 项")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(16)
        }
        .widgetURL(URL(string: "niuma://tasks"))
    }

    private var maximumVisibleItems: Int {
        family == .systemSmall ? 3 : 5
    }
}
