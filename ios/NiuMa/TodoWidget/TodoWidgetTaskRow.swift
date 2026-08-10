import SwiftUI

struct TodoWidgetTaskRow: View {
    let item: TodoWidgetItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Circle()
                .stroke(Color.secondary.opacity(0.65), lineWidth: 1.5)
                .frame(width: 12, height: 12)

            Text(item.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer(minLength: 4)

            if let dueAt = item.dueAt {
                if Calendar.current.isDateInToday(dueAt) {
                    Text(dueAt, style: .time)
                        .foregroundStyle(dueAt < .now ? Color.red : Color.secondary)
                } else {
                    Text(dueAt, format: .dateTime.month().day())
                        .foregroundStyle(dueAt < .now ? Color.red : Color.secondary)
                }
            }
        }
    }
}
