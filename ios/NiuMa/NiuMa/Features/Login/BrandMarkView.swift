import SwiftUI

struct BrandMarkView: View {
    var compact = false

    var body: some View {
        HStack(spacing: AppTheme.mediumSpacing) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(compact ? .headline : .title2)
                .bold()
                .foregroundStyle(AppTheme.surface)
                .frame(width: compact ? 40 : 48, height: compact ? 40 : 48)
                .background(AppTheme.brass)
                .clipShape(RoundedRectangle(cornerRadius: AppTheme.mediumRadius))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text("牛马")
                    .font(compact ? .title3 : .largeTitle)
                    .bold()
                    .foregroundStyle(AppTheme.ink)

                if !compact {
                    Text("个人销售工作台")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.mutedInk)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    BrandMarkView()
        .padding()
        .background(AppTheme.paper)
}
